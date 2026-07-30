import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../database';
import { registerSessionRoutes } from '../routes/sessions';

const databases: DatabaseConnection[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('bounded session analysis route', () => {
  it('returns exact aggregates with bounded content-free windows', async () => {
    const { app, database } = createApp();
    insertSession(database, 'session-1', '/fixture/project', 100);
    insertSession(database, 'session-2', '/fixture/project', 200);
    insertLargeSpanFixture(database, 'session-1');
    insertLargeSpanFixture(database, 'session-2', 10);

    const response = await app.inject({
      method: 'GET',
      url: '/api/session/session-1/analysis-summary',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.schemaVersion).toBe('session-analysis/v1');
    expect(body.session.id).toBe('session-1');
    expect(body.session).not.toHaveProperty('spans');
    expect(body.spanSummary).toMatchObject({
      events: 445,
      llmTurns: 325,
      mainToolCalls: 120,
      sidechainToolCalls: 0,
      observedToolErrors: 12,
    });
    expect(body.context).toMatchObject({ total: 325, isSampled: true });
    expect(body.context.points).toHaveLength(240);
    expect(body.toolWindow).toMatchObject({ total: 120, isWindowed: true });
    expect(body.toolWindow.events).toHaveLength(50);
    expect(body.sidechainTurnWindow).toMatchObject({ total: 25, isWindowed: true });
    expect(body.sidechainTurnWindow.events).toHaveLength(20);
    expect(body.score.cohortSize).toBe(2);
    expect(response.body).not.toContain('analysis-secret-marker');
    await app.close();
  });

  it('returns 404 for an unknown Session', async () => {
    const { app } = createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/session/missing/analysis-summary',
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'session not found' });
    await app.close();
  });
});

function createApp() {
  const database = createDatabase(':memory:');
  databases.push(database);
  const app = Fastify({ logger: false });
  registerSessionRoutes(app, {
    database,
    pricingResolver: () => undefined,
    contextWindowResolver: () => 200_000,
  });
  return { app, database };
}

function insertSession(
  database: DatabaseConnection,
  id: string,
  cwd: string,
  startTime: number,
): void {
  database
    .prepare(
      `INSERT INTO sessions (
        id, file_path, agent, start_time, end_time, cwd, input_tokens,
        cache_read_tokens, output_tokens, cost_unknown_count, total_cost,
        cache_hit_rate, peak_context_tokens, avg_context_tokens, message_count
      ) VALUES (?, ?, 'codex', ?, ?, ?, 1000, 500, 100, 0, 0.1, 0.33, 500, 300, 10)`,
    )
    .run(id, `fixture://${id}`, startTime, startTime + 10_000, cwd);
}

function insertLargeSpanFixture(database: DatabaseConnection, sessionId: string, size = 300): void {
  const insert = database.prepare(
    `INSERT INTO spans (
      id, session_id, parent_id, type, name, start_time, end_time,
      input_tokens, cache_read_tokens, output_tokens, context_tokens,
      output_bytes, model, cost, cost_unknown, is_error, is_sidechain, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (let index = 0; index < size; index++) {
    insert.run(
      `${sessionId}-turn-${index}`,
      sessionId,
      null,
      'llm_turn',
      `turn-${index}`,
      1_000 + index,
      1_001 + index,
      100,
      50,
      10,
      150,
      0,
      'fixture-model',
      0.001,
      0,
      0,
      0,
      JSON.stringify({ text: 'analysis-secret-marker' }),
    );
  }
  for (let index = 0; index < Math.min(size, 120); index++) {
    insert.run(
      `${sessionId}-tool-${index}`,
      sessionId,
      `${sessionId}-turn-0`,
      'tool_call',
      index % 2 === 0 ? 'Read' : 'Bash',
      2_000 + index,
      2_001 + index,
      0,
      0,
      0,
      0,
      index,
      null,
      0,
      0,
      index % 10 === 0 ? 1 : 0,
      0,
      JSON.stringify({ input: 'analysis-secret-marker', output: 'ok' }),
    );
  }
  for (let index = 0; index < Math.min(size, 25); index++) {
    insert.run(
      `${sessionId}-side-${index}`,
      sessionId,
      null,
      'llm_turn',
      `subtask-${index}`,
      3_000 + index,
      3_001 + index,
      20,
      30,
      5,
      50,
      0,
      'fixture-model',
      0.01,
      0,
      0,
      1,
      JSON.stringify({ thinking: 'analysis-secret-marker' }),
    );
  }
}
