import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../database';
import { registerSessionUpdateRoutes } from '../routes/session-updates';
import type { AppRuntime } from '../runtime';
import { createRuntime } from '../runtime';

describe('Session update routes', () => {
  let app: ReturnType<typeof Fastify>;
  let runtime: AppRuntime;

  beforeEach(async () => {
    app = Fastify();
    runtime = createRuntime({
      database: createDatabase(':memory:'),
      autoScanDir: null,
      defaultScanDir: '~/.claude/projects',
    });
    registerSessionUpdateRoutes(app, runtime);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await runtime.close();
  });

  it('returns a content-free bounded update cursor and validates query values', async () => {
    runtime.imports.updates.publish(['session-a']);

    const response = await app.inject({
      method: 'GET',
      url: '/api/session-updates?after=0&wait=0',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      version: 1,
      reset: false,
      sessionIds: ['session-a'],
    });
    expect(JSON.stringify(response.json())).not.toContain('path');

    const invalid = await app.inject({
      method: 'GET',
      url: '/api/session-updates?after=-1&wait=0',
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({ error: 'invalid session update cursor' });
  });
});
