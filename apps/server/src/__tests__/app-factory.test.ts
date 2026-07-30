import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import { createDatabase } from '../database';
import type { AppRuntime } from '../runtime';
import { createRuntime } from '../runtime';

describe('application factory', () => {
  let app: ReturnType<typeof createApp>;
  let runtime: AppRuntime;

  beforeAll(async () => {
    runtime = createRuntime({
      database: createDatabase(':memory:'),
      autoScanDir: null,
      defaultScanDir: '~/.claude/projects',
      clock: () => 1000,
    });
    app = createApp(runtime, { logger: false, webOrigins: [] });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await runtime.close();
  });

  it('registers all compatibility endpoints', async () => {
    const endpoints = [
      '/api/health',
      '/api/pricing',
      '/api/model-context',
      '/api/sessions',
      '/api/stats',
      '/api/imports/status',
      '/api/data-management/summary',
    ];
    for (const url of endpoints) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode, `${url} should return 2xx`).toBeLessThan(300);
    }
  });

  it('health endpoint returns uptime', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true });
    expect(response.json().uptime).toBeGreaterThanOrEqual(0);
  });

  it('pricing and model-context endpoints use the injected database', async () => {
    const pricing = await app.inject({ method: 'GET', url: '/api/pricing' });
    const modelContext = await app.inject({ method: 'GET', url: '/api/model-context' });
    expect(pricing.json().some((row: { model: string }) => row.model === 'claude-sonnet-5')).toBe(
      true,
    );
    expect(
      modelContext.json().some((row: { model: string }) => row.model === 'claude-sonnet-5'),
    ).toBe(true);
  });

  it('uses the injected clock for pricing lookups without an explicit timestamp', () => {
    const insert = runtime.database.prepare(
      `INSERT INTO pricing (
        model, input_price, cache_creation_price, cache_read_price, output_price, effective_from
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    insert.run('clock-priced-model', 1, 2, 3, 4, 500);
    insert.run('clock-priced-model', 10, 20, 30, 40, 1500);

    expect(runtime.pricingResolver('clock-priced-model')).toMatchObject({
      inputPrice: 1,
      effectiveFrom: 500,
    });
    expect(runtime.pricingResolver('clock-priced-model', 2000)).toMatchObject({
      inputPrice: 10,
      effectiveFrom: 1500,
    });
  });

  it('keeps API routes local and proxies unmatched Web routes to the private upstream', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('web response', { status: 200 }));
    const proxyRuntime = createRuntime({
      database: createDatabase(':memory:'),
      autoScanDir: null,
      defaultScanDir: '~/.claude/projects',
    });
    const proxyApp = createApp(proxyRuntime, {
      logger: false,
      webOrigins: [],
      webUpstream: 'http://127.0.0.1:4101',
    });
    await proxyApp.ready();

    const health = await proxyApp.inject({ method: 'GET', url: '/api/health' });
    const page = await proxyApp.inject({ method: 'GET', url: '/session/local-id?view=evidence' });

    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ ok: true });
    expect(page.statusCode).toBe(200);
    expect(page.body).toBe('web response');
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('http://127.0.0.1:4101/session/local-id?view=evidence'),
      expect.objectContaining({ method: 'GET', redirect: 'manual' }),
    );

    await proxyApp.close();
    await proxyRuntime.close();
    fetchMock.mockRestore();
  });

  it('keeps separately constructed runtimes isolated', async () => {
    const otherRuntime = createRuntime({
      database: createDatabase(':memory:'),
      autoScanDir: null,
      defaultScanDir: '~/.claude/projects',
    });
    const otherApp = createApp(otherRuntime, { logger: false, webOrigins: [] });
    otherRuntime.database
      .prepare(
        `INSERT INTO sessions (id, file_path, agent, start_time, imported_at)
         VALUES ('isolated', 'fixture://isolated', 'fixture', 1, 1)`,
      )
      .run();

    const originalSessions = await app.inject({ method: 'GET', url: '/api/sessions' });
    const otherSessions = await otherApp.inject({ method: 'GET', url: '/api/sessions' });
    expect(originalSessions.json()).toEqual([]);
    expect(otherSessions.json()).toHaveLength(1);

    await otherApp.close();
    await otherRuntime.close();
  });
});
