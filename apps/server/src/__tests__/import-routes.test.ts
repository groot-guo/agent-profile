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
    expect(response.json().sources).toHaveLength(4);
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
});
