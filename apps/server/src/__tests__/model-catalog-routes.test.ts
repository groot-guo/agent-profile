import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { createDatabase } from '../database';
import type { AppRuntime } from '../runtime';
import { createRuntime } from '../runtime';

describe('Model Catalog routes', () => {
  let runtime: AppRuntime;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    runtime = createRuntime({
      database: createDatabase(':memory:'),
      autoScanDir: null,
      defaultScanDir: '~/.claude/projects',
      clock: () => 10_000,
    });
    runtime.database
      .prepare(
        `INSERT INTO sessions (id, file_path, agent, start_time, imported_at)
         VALUES ('catalog-session', 'fixture://catalog', 'fixture', 1000, 1000)`,
      )
      .run();
    runtime.database
      .prepare(
        `INSERT INTO spans (
          id, session_id, type, name, start_time, model, input_tokens,
          cache_creation_tokens, cache_read_tokens, output_tokens, cost, cost_unknown
        ) VALUES ('catalog-span', 'catalog-session', 'llm_turn', 'turn', 1000,
          'route-model', 100, 20, 10, 30, 0, 1)`,
      )
      .run();
    app = createApp(runtime, { logger: false, webOrigins: [] });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await runtime.close();
  });

  it('exposes inventory, pricing history, context, and explicit alias operations', async () => {
    const inventory = await app.inject({ method: 'GET', url: '/api/model-catalog/models' });
    expect(inventory.statusCode).toBe(200);
    expect(inventory.json().models).toMatchObject([
      { model: 'route-model', observedSpans: 1, pricingKnown: false },
    ]);

    const pricing = await app.inject({
      method: 'POST',
      url: '/api/model-catalog/models/route-model/pricing',
      payload: {
        inputPrice: 1,
        cacheCreationPrice: 2,
        cacheReadPrice: 0.1,
        outputPrice: 3,
        effectiveFrom: 0,
        sourceReference: 'local:test',
      },
    });
    expect(pricing.statusCode).toBe(200);
    expect(pricing.json()).toMatchObject({ model: 'route-model', sourceKind: 'manual' });

    const context = await app.inject({
      method: 'PUT',
      url: '/api/model-catalog/models/route-model/context',
      payload: { contextWindow: 32000, auditedAt: 9000 },
    });
    expect(context.statusCode).toBe(200);
    expect(context.json()).toMatchObject({ contextWindow: 32000, userOverride: true });

    const alias = await app.inject({
      method: 'PUT',
      url: '/api/model-catalog/models/route-alias/pricing-alias',
      payload: { pricingModel: 'route-model', pricingEquivalent: true },
    });
    expect(alias.statusCode).toBe(200);
    expect(runtime.pricingResolver('route-alias', 1000)).toMatchObject({
      pricingModel: 'route-model',
    });
  });

  it('keeps preview read-only and rejects execute after pricing revision changes', async () => {
    const before = runtime.database
      .prepare("SELECT cost, cost_unknown as costUnknown FROM spans WHERE id = 'catalog-span'")
      .get();
    const preview = await app.inject({
      method: 'POST',
      url: '/api/model-catalog/recalculation/preview',
      payload: { models: ['route-model'] },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({ after: { spans: 1, unknown: 0 } });
    expect(
      runtime.database
        .prepare("SELECT cost, cost_unknown as costUnknown FROM spans WHERE id = 'catalog-span'")
        .get(),
    ).toEqual(before);

    await app.inject({
      method: 'POST',
      url: '/api/model-catalog/models/route-model/pricing',
      payload: {
        inputPrice: 4,
        cacheCreationPrice: 4,
        cacheReadPrice: 0.4,
        outputPrice: 8,
        effectiveFrom: 0,
      },
    });
    const stale = await app.inject({
      method: 'POST',
      url: '/api/model-catalog/recalculation/execute',
      payload: {
        scope: preview.json().scope,
        pricingRevision: preview.json().pricingRevision,
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ error: 'pricing_revision_changed' });
  });

  it('exports and imports only versioned local Model Catalog configuration', async () => {
    const exported = await app.inject({
      method: 'GET',
      url: '/api/model-catalog/configuration',
    });
    expect(exported.statusCode).toBe(200);
    expect(exported.json()).toMatchObject({
      schemaVersion: 'model-catalog/v1',
      pricing: expect.any(Array),
      modelContext: expect.any(Array),
      pricingAliases: expect.any(Array),
    });
    expect(exported.body).not.toContain('catalog-session');

    const imported = await app.inject({
      method: 'POST',
      url: '/api/model-catalog/configuration',
      payload: exported.json(),
    });
    expect(imported.statusCode).toBe(200);
    expect(imported.json()).toMatchObject({ ok: true });
  });

  it('preserves Model Catalog history and recalculation audit during generated-data reset', async () => {
    const preview = runtime.modelCatalog.previewRecalculation({});
    runtime.modelCatalog.executeRecalculation(preview.scope, preview.pricingRevision);
    const historyBefore = (
      runtime.database.prepare('SELECT COUNT(*) as count FROM pricing_history').get() as {
        count: number;
      }
    ).count;

    const reset = await app.inject({
      method: 'POST',
      url: '/api/data-management/reset',
      payload: { confirmation: 'RESET LOCAL DATA' },
    });
    expect(reset.statusCode).toBe(200);
    expect(runtime.database.prepare('SELECT COUNT(*) as count FROM sessions').get()).toEqual({
      count: 0,
    });
    expect(runtime.database.prepare('SELECT COUNT(*) as count FROM pricing_history').get()).toEqual(
      {
        count: historyBefore,
      },
    );
    expect(
      runtime.database.prepare('SELECT COUNT(*) as count FROM cost_recalculation_runs').get(),
    ).toEqual({ count: 1 });
  });
});
