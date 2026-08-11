import { describe, expect, it } from 'vitest';
import { createDatabase } from '../database';
import { createRuntime } from '../runtime';

function insertSessionAndSpan(
  database: ReturnType<typeof createDatabase>,
  options: {
    sessionId: string;
    spanId: string;
    model: string;
    startTime: number;
    unknown?: boolean;
  },
): void {
  database
    .prepare(
      `INSERT OR IGNORE INTO sessions (id, file_path, agent, start_time, imported_at)
       VALUES (?, ?, 'fixture', ?, ?)`,
    )
    .run(options.sessionId, `fixture://${options.sessionId}`, options.startTime, options.startTime);
  database
    .prepare(
      `INSERT INTO spans (
        id, session_id, type, name, start_time, model, input_tokens,
        cache_creation_tokens, cache_read_tokens, output_tokens, cost, cost_unknown
      ) VALUES (?, ?, 'llm_turn', 'turn', ?, ?, 1000000, 1000000, 1000000, 1000000, 7, ?)`,
    )
    .run(
      options.spanId,
      options.sessionId,
      options.startTime,
      options.model,
      options.unknown ? 1 : 0,
    );
}

describe('ModelCatalogService', () => {
  it('retires the active synthetic zero-price seed and never treats it as free usage', async () => {
    const database = createDatabase(':memory:');
    const runtime = createRuntime({
      database,
      autoScanDir: null,
      defaultScanDir: '~/.claude/projects',
      clock: () => 1000,
    });

    const synthetic = runtime.database
      .prepare(
        `SELECT status FROM pricing WHERE model = '<synthetic>'`,
      )
      .get();
    expect(synthetic).toBeUndefined();

    // 合成 spans 即使有 pricing 也永不产生 billable cost。
    runtime.database
      .prepare(
        `INSERT INTO sessions (id, file_path, agent, start_time, imported_at)
         VALUES ('synthetic-session', 'fixture://synthetic', 'fixture', 1000, 1000)`,
      )
      .run();
    runtime.database
      .prepare(
        `INSERT INTO spans (
          id, session_id, type, name, start_time, model, input_tokens,
          cache_creation_tokens, cache_read_tokens, output_tokens, cost,
          cost_unknown, cost_status, metadata
        ) VALUES ('synthetic-span', 'synthetic-session', 'llm_turn', 'turn', 1000,
          '<synthetic>', 1000000, 0, 0, 0, 0, 1, 'excluded_synthetic',
          '{"tokenUsageSource":"token_count"}')`,
      )
      .run();
    const preview = runtime.modelCatalog.previewRecalculation({
      models: ['<synthetic>'],
    });
    expect(preview.after).toMatchObject({ spans: 1, unknown: 1 });
    await runtime.close();
  });

  it('preserves local applicability rows while seeding bundled defaults', async () => {
    const database = createDatabase(':memory:');
    database
      .prepare(
        `INSERT INTO pricing (
          model, input_price, cache_creation_price, cache_read_price, output_price,
          effective_from, source_kind, revision, status, created_at
        ) VALUES ('gpt-4o', 99, 99, 99, 99, 0, 'manual', 1, 'active', 1)`,
      )
      .run();

    const runtime = createRuntime({
      database,
      autoScanDir: null,
      defaultScanDir: '~/.claude/projects',
      clock: () => 1000,
    });

    expect(runtime.modelCatalog.lookupPricing('gpt-4o', 1000)).toMatchObject({
      inputPrice: 99,
      sourceKind: 'manual',
    });
    await runtime.close();
  });

  it('recovers repeated bundled NULL residues beside an existing epoch-zero row', async () => {
    const database = createDatabase(':memory:');
    const insert = database.prepare(
      `INSERT INTO pricing (
        model, input_price, cache_creation_price, cache_read_price, output_price,
        effective_from, source_kind, revision, status, created_at
      ) VALUES (?, ?, 1, 0.1, 2, ?, ?, 1, 'active', 1)`,
    );
    insert.run('gpt-4o', 99, 0, 'manual');
    insert.run('gpt-4o', 17.5, null, 'bundled');
    insert.run('gpt-4o', 17.5, null, 'bundled');

    const runtime = createRuntime({
      database,
      autoScanDir: null,
      defaultScanDir: '~/.claude/projects',
      clock: () => 1000,
    });

    expect(runtime.modelCatalog.lookupPricing('gpt-4o', 1000)).toMatchObject({
      inputPrice: 99,
      sourceKind: 'manual',
    });
    expect(runtime.modelCatalog.listPricing('gpt-4o')).toHaveLength(1);
    expect(
      database
        .prepare(
          `SELECT status, COUNT(*) as count FROM pricing
           WHERE model = 'gpt-4o' AND effective_from IS NULL`,
        )
        .get(),
    ).toEqual({ status: 'superseded', count: 2 });

    const pricingCount = database.prepare('SELECT COUNT(*) as count FROM pricing').get();
    const historyCount = database.prepare('SELECT COUNT(*) as count FROM pricing_history').get();
    runtime.modelCatalog.seedDefaults();
    expect(database.prepare('SELECT COUNT(*) as count FROM pricing').get()).toEqual(pricingCount);
    expect(database.prepare('SELECT COUNT(*) as count FROM pricing_history').get()).toEqual(
      historyCount,
    );
    await runtime.close();
  });

  it('normalizes one repeated bundled NULL residue when no epoch-zero row exists', async () => {
    const database = createDatabase(':memory:');
    const insert = database.prepare(
      `INSERT INTO pricing (
        model, input_price, cache_creation_price, cache_read_price, output_price,
        effective_from, source_kind, revision, status, created_at
      ) VALUES ('residue-only-model', 1, 1, 0.1, 2, NULL, 'bundled', 1, 'active', 1)`,
    );
    insert.run();
    insert.run();

    const runtime = createRuntime({
      database,
      autoScanDir: null,
      defaultScanDir: '~/.claude/projects',
      clock: () => 1000,
    });

    expect(runtime.modelCatalog.listPricing('residue-only-model')).toHaveLength(1);
    expect(
      database
        .prepare(
          `SELECT status, effective_from as effectiveFrom, COUNT(*) as count
           FROM pricing WHERE model = 'residue-only-model'
           GROUP BY status, effective_from ORDER BY status`,
        )
        .all(),
    ).toEqual([
      { status: 'active', effectiveFrom: 0, count: 1 },
      { status: 'superseded', effectiveFrom: null, count: 1 },
    ]);
    await runtime.close();
  });

  it('revises one applicability key and retains superseded history', async () => {
    const runtime = createRuntime({
      database: createDatabase(':memory:'),
      autoScanDir: null,
      defaultScanDir: '~/.claude/projects',
      clock: () => 2000,
    });

    runtime.modelCatalog.upsertPricing(
      {
        model: 'gpt-4o',
        inputPrice: 10,
        cacheCreationPrice: 11,
        cacheReadPrice: 1,
        outputPrice: 20,
        effectiveFrom: 0,
      },
      'manual',
    );

    expect(runtime.modelCatalog.listPricing('gpt-4o')).toHaveLength(1);
    expect(runtime.modelCatalog.listPricingHistory('gpt-4o').slice(-2)).toMatchObject([
      { status: 'superseded', revision: 1 },
      { status: 'active', revision: 2, inputPrice: 10, sourceKind: 'manual' },
    ]);
    await runtime.close();
  });

  it('uses pricing aliases only after an explicit equivalence record', async () => {
    const runtime = createRuntime({
      database: createDatabase(':memory:'),
      autoScanDir: null,
      defaultScanDir: '~/.claude/projects',
      clock: () => 1000,
    });

    expect(runtime.modelCatalog.lookupPricing('raw-gpt', 1000)).toBeUndefined();
    runtime.modelCatalog.upsertAlias(
      { rawModel: 'raw-gpt', pricingModel: 'gpt-4o', sourceReference: 'local:test' },
      'manual',
    );
    expect(runtime.modelCatalog.lookupPricing('raw-gpt', 1000)).toMatchObject({
      model: 'gpt-4o',
      pricingModel: 'gpt-4o',
    });
    await runtime.close();
  });

  it('previews without mutation and executes a fixed revision transactionally', async () => {
    let now = 3000;
    const runtime = createRuntime({
      database: createDatabase(':memory:'),
      autoScanDir: null,
      defaultScanDir: '~/.claude/projects',
      clock: () => now++,
    });
    insertSessionAndSpan(runtime.database, {
      sessionId: 's1',
      spanId: 'known',
      model: 'gpt-4o',
      startTime: 1000,
      unknown: true,
    });
    insertSessionAndSpan(runtime.database, {
      sessionId: 's1',
      spanId: 'unsupported',
      model: 'tiered-model',
      startTime: 1001,
      unknown: true,
    });
    runtime.modelCatalog.upsertPricing({
      model: 'tiered-model',
      inputPrice: 1,
      cacheCreationPrice: 1,
      cacheReadPrice: 1,
      outputPrice: 1,
      effectiveFrom: 0,
      pricingScheme: 'long_context_tiered',
    });

    const before = runtime.database
      .prepare("SELECT cost, cost_unknown as costUnknown FROM spans WHERE id = 'known'")
      .get();
    const preview = runtime.modelCatalog.previewRecalculation({ models: ['gpt-4o'] });
    expect(preview).toMatchObject({
      scope: { models: ['gpt-4o'] },
      before: { spans: 1, unknown: 1 },
      after: { spans: 1, unknown: 0 },
    });
    expect(
      runtime.database
        .prepare("SELECT cost, cost_unknown as costUnknown FROM spans WHERE id = 'known'")
        .get(),
    ).toEqual(before);
    expect(() =>
      runtime.modelCatalog.executeRecalculation({ models: ['gpt-4o'] }, 'stale'),
    ).toThrow('pricing_revision_changed');

    const result = runtime.modelCatalog.executeRecalculation(
      preview.scope,
      preview.pricingRevision,
    );
    expect(result).toMatchObject({ updatedSpans: 1, updatedSessions: 1, status: 'completed' });
    expect(
      runtime.database
        .prepare(
          `SELECT cost_unknown as costUnknown, pricing_model as pricingModel,
            pricing_revision as pricingRevision FROM spans WHERE id = 'known'`,
        )
        .get(),
    ).toMatchObject({ costUnknown: 0, pricingModel: 'gpt-4o', pricingRevision: 1 });
    expect(
      runtime.database.prepare('SELECT COUNT(*) as count FROM cost_recalculation_runs').get(),
    ).toEqual({ count: 1 });
    const unsupported = runtime.modelCatalog.previewRecalculation({ models: ['tiered-model'] });
    expect(unsupported.after.unknown).toBe(1);
    expect(unsupported.unsupportedModels).toEqual(['tiered-model']);
    await runtime.close();
  });

  it('applies a newly configured price to older spans during explicit recalculation', async () => {
    const runtime = createRuntime({
      database: createDatabase(':memory:'),
      autoScanDir: null,
      defaultScanDir: '~/.claude/projects',
      clock: () => 3_000,
    });
    insertSessionAndSpan(runtime.database, {
      sessionId: 'retroactive-session',
      spanId: 'retroactive-span',
      model: 'retroactive-model',
      startTime: 100,
      unknown: true,
    });
    runtime.modelCatalog.upsertPricing({
      model: 'retroactive-model',
      inputPrice: 2,
      cacheCreationPrice: 3,
      cacheReadPrice: 4,
      outputPrice: 5,
      effectiveFrom: 2_000,
    });

    const preview = runtime.modelCatalog.previewRecalculation({
      models: ['retroactive-model'],
    });
    expect(preview).toMatchObject({
      before: { spans: 1, unknown: 1 },
      after: { spans: 1, unknown: 0 },
    });
    const result = runtime.modelCatalog.executeRecalculation(
      preview.scope,
      preview.pricingRevision,
    );
    expect(result.updatedSpans).toBe(1);
    expect(
      runtime.database
        .prepare(
          `SELECT cost, cost_unknown as costUnknown, pricing_effective_from as pricingEffectiveFrom
           FROM spans WHERE id = 'retroactive-span'`,
        )
        .get(),
    ).toMatchObject({ cost: 14, costUnknown: 0, pricingEffectiveFrom: 2_000 });
    await runtime.close();
  });

  it('publishes a session-update signal after successful recalculation execution', async () => {
    const runtime = createRuntime({
      database: createDatabase(':memory:'),
      autoScanDir: null,
      defaultScanDir: '~/.claude/projects',
      clock: () => 3000,
    });
    insertSessionAndSpan(runtime.database, {
      sessionId: 'refresh-session',
      spanId: 'refresh-span',
      model: 'gpt-4o',
      startTime: 1000,
      unknown: true,
    });

    const preview = runtime.modelCatalog.previewRecalculation({ models: ['gpt-4o'] });
    const before = await runtime.imports.updates.waitFor(0, 0);
    // Preview 是只读的，不得发布任何刷新信号。
    expect((await runtime.imports.updates.waitFor(before.version, 0)).version).toBe(
      before.version,
    );
    const result = runtime.modelCatalog.executeRecalculation(
      preview.scope,
      preview.pricingRevision,
    );
    expect(result.status).toBe('completed');

    const after = await runtime.imports.updates.waitFor(before.version, 0);
    expect(after.version).toBeGreaterThan(before.version);
    expect(after.sessionIds).toContain('refresh-session');
    expect(after.reset).toBe(false);
    await runtime.close();
  });

  it('rolls back Span updates and audit insertion when Session rebuild fails', async () => {
    const runtime = createRuntime({
      database: createDatabase(':memory:'),
      autoScanDir: null,
      defaultScanDir: '~/.claude/projects',
      clock: () => 4000,
    });
    insertSessionAndSpan(runtime.database, {
      sessionId: 'rollback-session',
      spanId: 'rollback-span',
      model: 'gpt-4o',
      startTime: 1000,
      unknown: true,
    });
    runtime.database.exec(`
      CREATE TRIGGER fail_recalculation BEFORE UPDATE OF total_cost ON sessions
      BEGIN SELECT RAISE(ABORT, 'forced rollback'); END
    `);
    const preview = runtime.modelCatalog.previewRecalculation({ models: ['gpt-4o'] });

    expect(() =>
      runtime.modelCatalog.executeRecalculation(preview.scope, preview.pricingRevision),
    ).toThrow('forced rollback');
    expect(
      runtime.database
        .prepare("SELECT cost, cost_unknown as costUnknown FROM spans WHERE id = 'rollback-span'")
        .get(),
    ).toEqual({ cost: 7, costUnknown: 1 });
    expect(
      runtime.database.prepare('SELECT COUNT(*) as count FROM cost_recalculation_runs').get(),
    ).toEqual({ count: 0 });
    await runtime.close();
  });

  it('validates an entire configuration before importing any records', async () => {
    const runtime = createRuntime({
      database: createDatabase(':memory:'),
      autoScanDir: null,
      defaultScanDir: '~/.claude/projects',
      clock: () => 5000,
    });
    const before = runtime.modelCatalog.listPricing().length;
    const configuration = runtime.modelCatalog.exportConfiguration();
    configuration.pricing.push({
      ...configuration.pricing[0],
      model: 'imported-model',
      effectiveFrom: 1,
    });
    configuration.modelContext.push({
      model: 'bad-context',
      contextWindow: 0,
      sourceKind: 'imported',
      revision: 1,
      userOverride: false,
    });

    expect(() => runtime.modelCatalog.importConfiguration(configuration)).toThrow(
      'invalid_model_context_payload',
    );
    expect(runtime.modelCatalog.listPricing()).toHaveLength(before);
    expect(JSON.stringify(runtime.modelCatalog.exportConfiguration())).not.toContain('sessionId');
    await runtime.close();
  });
});
