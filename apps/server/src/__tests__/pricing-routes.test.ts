import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../database';
import { registerPricingRoutes } from '../routes/pricing';
import { registerScanRoutes } from '../routes/scan';
import type { AppRuntime } from '../runtime';
import { createRuntime } from '../runtime';

describe('pricing route validation', () => {
  const app = Fastify();
  const scanDir = mkdtempSync(join(tmpdir(), 'agent-profile-t39-'));
  let runtime: AppRuntime;

  beforeAll(async () => {
    runtime = createRuntime({
      database: createDatabase(':memory:'),
      autoScanDir: null,
      defaultScanDir: '~/.claude/projects',
    });
    registerPricingRoutes(app, runtime);
    registerScanRoutes(app, runtime);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await runtime.close();
    rmSync(scanDir, { recursive: true, force: true });
  });

  it('rejects invalid pricing payloads', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/pricing',
      payload: {
        model: 'test-model',
        inputPrice: -1,
        cacheCreationPrice: 1,
        cacheReadPrice: 0.1,
        outputPrice: 2,
        currency: 'USD',
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it('stores the explicit CNY contract and assigns an effective time', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/pricing',
      payload: {
        model: 'test-model',
        inputPrice: 1,
        cacheCreationPrice: 1,
        cacheReadPrice: 0.1,
        outputPrice: 2,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      currency: 'CNY',
      unit: 'per_million_tokens',
    });
    expect(response.json().effectiveFrom).toBeTypeOf('number');
  });

  it('rejects invalid context-window payloads', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/model-context',
      payload: { model: '', contextWindow: 0 },
    });
    expect(response.statusCode).toBe(400);
  });

  it('persists imported cost provenance through migrated scan statements', async () => {
    writeFileSync(
      join(scanDir, 'session.jsonl'),
      `${JSON.stringify({
        uuid: 'turn-1',
        sessionId: 'session-1',
        timestamp: '2026-01-01T00:00:00.000Z',
        type: 'assistant',
        message: {
          role: 'assistant',
          model: 'deepseek-v4-flash',
          content: [{ type: 'text', text: 'done' }],
          usage: {
            input_tokens: 1000,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            output_tokens: 100,
          },
        },
      })}\n`,
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/scan',
      payload: { dir: scanDir },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ scanned: 1, imported: 1 });

    const span = runtime.database
      .prepare(
        `SELECT cost_currency as costCurrency,
          pricing_effective_from as pricingEffectiveFrom,
          cost_calculator_version as costCalculatorVersion
         FROM spans WHERE id = 'turn-1'`,
      )
      .get();
    expect(span).toEqual({
      costCurrency: 'CNY',
      pricingEffectiveFrom: 0,
      costCalculatorVersion: 'v1',
    });
  });
});
