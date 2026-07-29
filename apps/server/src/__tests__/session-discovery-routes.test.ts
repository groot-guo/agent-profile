import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../database';
import { registerSessionRoutes } from '../routes/sessions';
import type { AppRuntime } from '../runtime';
import { createRuntime } from '../runtime';

describe('Session discovery routes', () => {
  const app = Fastify();
  let runtime: AppRuntime;

  beforeAll(async () => {
    runtime = createRuntime({
      database: createDatabase(':memory:'),
      autoScanDir: null,
      defaultScanDir: '~/.claude/projects',
    });
    runtime.database
      .prepare(
        `INSERT INTO sessions (id, file_path, agent, start_time, imported_at)
         VALUES ('primary-session', 'fixture://primary', 'claude-code', 1, 1)`,
      )
      .run();
    runtime.database
      .prepare(
        `INSERT INTO spans (id, session_id, type, name, start_time, is_sidechain)
         VALUES ('primary-span', 'primary-session', 'llm_turn', 'fixture', 1, 0)`,
      )
      .run();
    runtime.database
      .prepare(
        `INSERT INTO sessions (id, file_path, agent, start_time, imported_at)
         VALUES ('codex-child', 'fixture://child', 'codex', 2, 2)`,
      )
      .run();
    runtime.database
      .prepare(
        `INSERT INTO spans (id, session_id, type, name, start_time, is_sidechain)
         VALUES ('child-span', 'codex-child', 'llm_turn', 'fixture', 2, 1)`,
      )
      .run();
    registerSessionRoutes(app, runtime);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await runtime.close();
  });

  it('retains the compatibility list response while using shared primary discovery', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/sessions' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      expect.objectContaining({ id: 'primary-session', filePath: 'fixture://primary' }),
    ]);
  });
});
