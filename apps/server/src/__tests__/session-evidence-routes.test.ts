import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../database';
import { registerSessionEvidenceRoutes } from '../routes/session-evidence';

const databases: DatabaseConnection[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('session evidence route', () => {
  it('returns every normalized event without content by default', async () => {
    const { app, database } = createApp();
    insertFixture(database);

    const response = await app.inject({
      method: 'GET',
      url: '/api/session/session-1/evidence',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      schemaVersion: 'session-evidence/v1',
      scope: {
        events: 3,
        byType: { llm_turn: 1, tool_call: 1, thinking: 1, answer: 0 },
      },
      privacy: {
        contentMode: 'none',
        previewCharacters: 0,
        secretRedaction: true,
        rawContentIncluded: false,
      },
    });
    expect(response.body).not.toContain('private-command-marker');
    expect(response.body).not.toContain('supersecret');
    await app.close();
  });

  it('returns bounded redacted previews only when explicitly requested', async () => {
    const { app, database } = createApp();
    insertFixture(database);

    const response = await app.inject({
      method: 'GET',
      url: '/api/session/session-1/evidence?content=preview',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('private-command-marker');
    expect(response.body).toContain('[REDACTED');
    expect(response.body).not.toContain('sk-supersecret123456');
    expect(response.json().privacy).toMatchObject({
      contentMode: 'preview',
      previewCharacters: 500,
      rawContentIncluded: false,
    });
    await app.close();
  });

  it('validates preview mode and returns 404 for an unknown session', async () => {
    const { app } = createApp();
    const invalid = await app.inject({
      method: 'GET',
      url: '/api/session/missing/evidence?content=full',
    });
    expect(invalid.statusCode).toBe(400);

    const missing = await app.inject({
      method: 'GET',
      url: '/api/session/missing/evidence',
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: 'session not found' });
    await app.close();
  });
});

function createApp() {
  const database = createDatabase(':memory:');
  databases.push(database);
  const app = Fastify({ logger: false });
  registerSessionEvidenceRoutes(app, {
    database,
  });
  return { app, database };
}

function insertFixture(database: DatabaseConnection): void {
  database
    .prepare(
      `INSERT INTO sessions (
        id, file_path, agent, start_time, end_time, input_tokens,
        cost_unknown_count, total_cost, cache_hit_rate, peak_context_tokens,
        avg_context_tokens
      ) VALUES (?, ?, ?, ?, ?, ?, 0, 0.1, 0.5, ?, ?)`,
    )
    .run('session-1', 'fixture://session-1', 'codex', 100, 200, 1000, 500, 300);
  database
    .prepare(
      `INSERT INTO spans (
        id, session_id, type, name, start_time, end_time, model, metadata
      ) VALUES (?, ?, 'llm_turn', 'fixture', 100, 190, 'fixture-model', NULL)`,
    )
    .run('turn-1', 'session-1');
  database
    .prepare(
      `INSERT INTO spans (
        id, session_id, parent_id, type, name, start_time, end_time,
        output_bytes, is_error, metadata
      ) VALUES (?, ?, ?, 'tool_call', 'Bash', 120, 140, 24, 0, ?)`,
    )
    .run(
      'tool-1',
      'session-1',
      'turn-1',
      JSON.stringify({
        input: 'private-command-marker api_key=sk-supersecret123456',
        output: 'done',
      }),
    );
  database
    .prepare(
      `INSERT INTO spans (
        id, session_id, parent_id, type, name, start_time, metadata
      ) VALUES (?, ?, ?, 'thinking', 'reasoning', 121, ?)`,
    )
    .run(
      'thinking-1',
      'session-1',
      'turn-1',
      JSON.stringify({ thinking: 'token=sk-supersecret123456' }),
    );
}
