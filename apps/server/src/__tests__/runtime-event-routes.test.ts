import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../database';
import { registerRuntimeEventRoutes } from '../routes/runtime-events';

const databases: DatabaseConnection[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('runtime event routes', () => {
  it('accepts local metadata events and returns reference-only pages', async () => {
    const database = createDatabase(':memory:');
    databases.push(database);
    const app = Fastify({ logger: false });
    registerRuntimeEventRoutes(app, { database, clock: () => 1_800_000_000_100 });

    const accepted = await app.inject({
      method: 'POST',
      url: '/api/runtime/events',
      payload: {
        schemaVersion: 'runtime-event-batch/v1',
        events: [
          {
            schemaVersion: 'runtime-event/v1',
            eventId: 'event-1',
            taskId: 'task-1',
            runId: 'run-1',
            sequence: 1,
            capturedAt: 1_800_000_000_001,
            kind: 'verification_finished',
            payload: { verificationKind: 'test', status: 'passed' },
          },
        ],
      },
    });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json()).toMatchObject({ accepted: 1, coverage: { status: 'complete' } });

    const page = await app.inject({ method: 'GET', url: '/api/runtime/runs/run-1/events' });
    expect(page.statusCode).toBe(200);
    expect(page.json()).toMatchObject({
      schemaVersion: 'runtime-event-page/v1',
      events: [{ eventId: 'event-1', payloadFields: ['status', 'verificationKind'] }],
    });
    expect(page.body).not.toContain('passed');
    await app.close();
  });

  it('rejects unsupported content and malformed request versions', async () => {
    const database = createDatabase(':memory:');
    databases.push(database);
    const app = Fastify({ logger: false });
    registerRuntimeEventRoutes(app, { database, clock: () => 1_800_000_000_100 });

    const invalidVersion = await app.inject({
      method: 'POST',
      url: '/api/runtime/events',
      payload: { schemaVersion: 'runtime-event/v2', events: [] },
    });
    expect(invalidVersion.statusCode).toBe(400);

    const rawContent = await app.inject({
      method: 'POST',
      url: '/api/runtime/events',
      payload: {
        schemaVersion: 'runtime-event-batch/v1',
        events: [
          {
            schemaVersion: 'runtime-event/v1',
            eventId: 'event-raw',
            taskId: 'task-1',
            runId: 'run-1',
            sequence: 1,
            capturedAt: 1_800_000_000_001,
            kind: 'tool_call',
            payload: { input: 'private' },
          },
        ],
      },
    });
    expect(rawContent.statusCode).toBe(400);
    expect(rawContent.json()).toEqual({ error: 'invalid_event' });
    await app.close();
  });
});
