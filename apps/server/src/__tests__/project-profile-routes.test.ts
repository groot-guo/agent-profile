import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { createDatabase } from '../database';
import { registerProjectProfileRoutes } from '../routes/project-profile';

describe('project profile routes', () => {
  it('returns bounded cross-Session evidence with source and tool coverage', async () => {
    const database = createDatabase(':memory:');
    const app = Fastify();
    registerProjectProfileRoutes(app, { database, clock: () => 9_000 });
    database
      .prepare(
        `INSERT INTO sessions (
          id, file_path, agent, source_kind, project_key, start_time, end_time,
          input_tokens, output_tokens, total_cost, cost_unknown_count, cache_hit_rate,
          peak_context_tokens
        ) VALUES
          ('s1', 'fixture://s1', 'codex', 'codex', '/workspace/app', 1000, 1200, 10, 5, 2, 0, 0.5, 100),
          ('s2', 'fixture://s2', 'claude-code', NULL, '/workspace/app', 2000, NULL, 20, 5, 9, 1, NULL, NULL),
          ('other', 'fixture://other', 'zed', 'zed', '/workspace/other', 3000, 3100, 99, 1, 1, 0, 1, 10)`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO spans (id, session_id, type, name, start_time, is_error, is_sidechain)
         VALUES ('tool-1', 's1', 'tool_call', 'Read', 1050, 0, 0),
                ('tool-2', 's1', 'tool_call', 'Read', 1100, 1, 0),
                ('other-tool', 'other', 'tool_call', 'Edit', 3050, 0, 0)`,
      )
      .run();

    const response = await app.inject({
      method: 'GET',
      url: '/api/projects/profile?project=%2Fworkspace%2Fapp&from=900&to=2500',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      schemaVersion: 'project-profile/v1',
      generatedAt: 9_000,
      project: { key: '/workspace/app' },
      scope: { linkedSessions: 2, availableSessions: 2, from: 900, to: 2500 },
      metrics: { totalTokens: 40, totalCost: 2, toolCalls: 2, toolErrors: 1 },
      coverage: { sources: { observed: 1, total: 2 }, files: { status: 'not_captured' } },
      tools: [{ name: 'Read', calls: 2, errors: 1, sessions: 1 }],
    });
    expect(response.body).not.toContain('fixture://s1');
    await app.close();
    database.close();
  });

  it('rejects missing projects and inverted ranges', async () => {
    const database = createDatabase(':memory:');
    const app = Fastify();
    registerProjectProfileRoutes(app, { database, clock: () => 9_000 });
    expect((await app.inject({ method: 'GET', url: '/api/projects/profile' })).statusCode).toBe(
      400,
    );
    expect(
      (await app.inject({ method: 'GET', url: '/api/projects/profile?project=app&from=20&to=10' }))
        .statusCode,
    ).toBe(400);
    await app.close();
    database.close();
  });
});
