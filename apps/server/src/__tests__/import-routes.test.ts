import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('import status routes', () => {
  const app = Fastify();

  beforeAll(async () => {
    process.env.TRACE_DB_PATH = ':memory:';
    const { registerScanRoutes } = await import('../routes/scan');
    registerScanRoutes(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    const { closeDb } = await import('../db');
    closeDb();
    delete process.env.TRACE_DB_PATH;
  });

  it('returns bounded source state without local paths or transcript identifiers', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/imports/status' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ active: false });
    expect(response.json().sources).toHaveLength(5);
    expect(response.json().sources.map((source: { id: string }) => source.id)).toContain(
      'opencode',
    );
    for (const source of response.json().sources) {
      expect(source).toMatchObject({
        id: expect.any(String),
        label: expect.any(String),
        available: expect.any(Boolean),
        state: expect.any(String),
        storedSessions: expect.any(Number),
      });
      expect(source).not.toHaveProperty('path');
    }
    expect(response.body).not.toContain('/Users/');
    expect(response.body).not.toContain('sessionIds');
  });

  it('rejects unknown source IDs before starting work', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/imports',
      payload: { sources: ['unknown-source'] },
    });
    expect(response.statusCode).toBe(400);
  });

  it('requires explicit confirmation and resets only generated analysis data', async () => {
    const { db } = await import('../db');
    db.prepare(
      `INSERT INTO sessions (id, file_path, agent, start_time, imported_at, tags)
       VALUES ('reset-session', 'fixture://reset', 'fixture', 1, 1, 'important')`,
    ).run();
    db.prepare(
      `INSERT INTO spans (id, session_id, type, name, start_time)
       VALUES ('reset-span', 'reset-session', 'llm_turn', 'fixture', 1)`,
    ).run();

    const summary = await app.inject({ method: 'GET', url: '/api/data-management/summary' });
    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toMatchObject({ sessions: 1, spans: 1, annotatedSessions: 1 });

    const rejected = await app.inject({
      method: 'POST',
      url: '/api/data-management/reset',
      payload: { confirmation: 'RESET' },
    });
    expect(rejected.statusCode).toBe(400);

    const reset = await app.inject({
      method: 'POST',
      url: '/api/data-management/reset',
      payload: { confirmation: summary.json().resetConfirmation },
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toMatchObject({
      deleted: { sessions: 1, spans: 1, annotatedSessions: 1 },
      retained: {
        pricingRows: expect.any(Number),
        modelContextRows: expect.any(Number),
        migrations: expect.any(Number),
      },
    });
    expect(db.prepare('SELECT COUNT(*) as count FROM sessions').get()).toEqual({ count: 0 });
  });
});
