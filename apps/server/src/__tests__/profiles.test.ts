import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../database';
import { registerProfileRoutes } from '../routes/profiles';

const databases: DatabaseConnection[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('Agent profile routes', () => {
  it('returns an empty, versioned report', async () => {
    const { app } = createApp();
    const response = await app.inject({ method: 'GET', url: '/api/profiles/agents' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      schemaVersion: 'agent-profile/v1',
      scope: { agents: [], sessions: 0 },
      comparison: { status: 'insufficient_data' },
      profiles: [],
    });
    await app.close();
  });

  it('returns eligible multi-Agent profiles and a single-Agent view', async () => {
    const { app, database } = createApp();
    for (let index = 0; index < 3; index++) {
      insertProfileFixture(database, 'claude-code', index, 100 + index * 10);
      insertProfileFixture(database, 'codex', index, 300 + index * 10);
    }
    insertProfileFixture(database, 'zed', 0, 50);
    insertSidechainOnlyCodexFixture(database);

    const response = await app.inject({ method: 'GET', url: '/api/profiles/agents' });
    expect(response.statusCode).toBe(200);
    const report = response.json();
    expect(report.scope).toEqual({
      agents: ['claude-code', 'codex', 'zed'],
      sessions: 7,
    });
    expect(
      report.profiles.find((profile: { agent: string }) => profile.agent === 'claude-code'),
    ).toMatchObject({
      comparisonStatus: 'ready',
      sample: { sessions: 3, llmTurns: 3, toolCalls: 3 },
      coverage: {
        knownCost: { value: 1 },
        duration: { value: 1 },
        modelIdentity: { value: 1 },
        toolEvidence: { value: 1 },
        outcome: { status: 'not_collected' },
      },
    });
    expect(
      report.profiles.find((profile: { agent: string }) => profile.agent === 'zed'),
    ).toMatchObject({
      comparisonStatus: 'insufficient_data',
      relativeCharacteristics: [],
    });
    expect(
      report.profiles.find((profile: { agent: string }) => profile.agent === 'codex'),
    ).toMatchObject({
      sample: { sessions: 3 },
    });
    expect(database.prepare('SELECT id FROM sessions WHERE id = ?').get('codex-guardian')).toEqual({
      id: 'codex-guardian',
    });

    const single = await app.inject({
      method: 'GET',
      url: '/api/profiles/agents/claude-code',
    });
    expect(single.statusCode).toBe(200);
    expect(single.json().profiles).toHaveLength(1);
    expect(single.json().profiles[0].agent).toBe('claude-code');
    await app.close();
  });

  it('returns 404 for an unknown Agent', async () => {
    const { app } = createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/profiles/agents/not-observed',
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: 'agent profile not found',
      agent: 'not-observed',
    });
    await app.close();
  });
});

function createApp() {
  const database = createDatabase(':memory:');
  databases.push(database);
  const app = Fastify();
  registerProfileRoutes(app, {
    database,
    clock: () => Date.now(),
  });
  return { app, database };
}

function insertProfileFixture(
  database: DatabaseConnection,
  agent: string,
  index: number,
  tokens: number,
): void {
  const sessionId = `${agent}-${index}`;
  database
    .prepare(
      `INSERT INTO sessions (
        id, file_path, agent, start_time, end_time, input_tokens, output_tokens,
        total_cost, cost_unknown_count, cache_hit_rate, peak_context_tokens,
        avg_context_tokens
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0.5, ?, ?)`,
    )
    .run(
      sessionId,
      `fixture://${sessionId}`,
      agent,
      1000,
      2000 + index,
      tokens,
      10,
      tokens / 100,
      tokens / 2,
      tokens / 3,
    );
  database
    .prepare(
      `INSERT INTO spans (
        id, session_id, type, name, start_time, model, is_error, is_sidechain,
        metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      `${sessionId}-turn`,
      sessionId,
      'llm_turn',
      'fixture-model',
      1000,
      'fixture-model',
      0,
      0,
      null,
    );
  database
    .prepare(
      `INSERT INTO spans (
        id, session_id, type, name, start_time, is_error, is_sidechain, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      `${sessionId}-tool`,
      sessionId,
      'tool_call',
      'Read',
      1100,
      index === 0 ? 1 : 0,
      agent === 'codex' ? 1 : 0,
      JSON.stringify({ input: '{}' }),
    );
}

function insertSidechainOnlyCodexFixture(database: DatabaseConnection): void {
  database
    .prepare(
      `INSERT INTO sessions (
        id, file_path, agent, start_time, end_time, input_tokens, output_tokens,
        total_cost, cost_unknown_count, cache_hit_rate, peak_context_tokens,
        avg_context_tokens
      ) VALUES (?, ?, 'codex', 1000, 2000, 50, 5, 0, 1, 0, 50, 50)`,
    )
    .run('codex-guardian', 'fixture://codex-guardian');
  database
    .prepare(
      `INSERT INTO spans (
        id, session_id, type, name, start_time, model, is_error, is_sidechain
      ) VALUES (?, ?, 'llm_turn', 'codex-auto-review', 1000, 'codex-auto-review', 0, 1)`,
    )
    .run('codex-guardian-turn', 'codex-guardian');
}
