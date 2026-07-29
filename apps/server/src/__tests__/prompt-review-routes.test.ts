import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../database';
import { registerPromptReviewRoutes } from '../routes/prompt-review';

const databases: DatabaseConnection[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('prompt review route', () => {
  it('reviews ephemerally without echoing or persisting the raw prompt', async () => {
    const { app, database } = createApp();
    const tablesBefore = tableNames(database);
    const prompt = '目标：修复登录接口。范围：只改 auth。验收：返回 200。验证：运行测试并通过。';
    const response = await app.inject({
      method: 'POST',
      url: '/api/prompt-review',
      payload: { prompt },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      schemaVersion: 'iteration-hints/v1',
      review: {
        schemaVersion: 'prompt-review/v1',
        privacy: {
          retention: 'not_stored',
          semanticProvider: 'not_used',
          evidenceIncluded: false,
        },
      },
    });
    expect(response.body).not.toContain(prompt);
    expect(tableNames(database)).toEqual(tablesBefore);
    expect(database.prepare('SELECT COUNT(*) as count FROM sessions').get()).toEqual({ count: 0 });
    await app.close();
  });

  it('validates empty and oversized prompts', async () => {
    const { app } = createApp();
    const whitespace = await app.inject({
      method: 'POST',
      url: '/api/prompt-review',
      payload: { prompt: '   ' },
    });
    expect(whitespace.statusCode).toBe(400);

    const oversized = await app.inject({
      method: 'POST',
      url: '/api/prompt-review',
      payload: { prompt: 'x'.repeat(20_001) },
    });
    expect(oversized.statusCode).toBe(400);
    await app.close();
  });

  it('combines an observed Agent profile and rejects unknown Agents', async () => {
    const { app, database } = createApp();
    for (let index = 0; index < 3; index++) {
      insertSession(database, 'claude-code', index, 1000);
      insertSession(database, 'codex', index, 100);
    }

    const combined = await app.inject({
      method: 'POST',
      url: '/api/prompt-review',
      payload: {
        prompt: '请优化当前功能。',
        agent: 'claude-code',
      },
    });
    expect(combined.statusCode).toBe(200);
    expect(combined.json()).toMatchObject({
      agentProfile: {
        agent: 'claude-code',
        comparisonStatus: 'ready',
        sessions: 3,
      },
    });
    expect(
      combined.json().hints.some((hint: { source: string }) => hint.source === 'combined'),
    ).toBe(true);

    const missing = await app.inject({
      method: 'POST',
      url: '/api/prompt-review',
      payload: {
        prompt: '请检查。',
        agent: 'not-observed',
      },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({
      error: 'agent profile not found',
      agent: 'not-observed',
    });
    await app.close();
  });

  it('redacts opt-in evidence', async () => {
    const { app } = createApp();
    const secret = `sk-${'z'.repeat(40)}`;
    const response = await app.inject({
      method: 'POST',
      url: '/api/prompt-review',
      payload: {
        prompt: `目标：修复服务 api_key=${secret}`,
        includeEvidence: true,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain(secret);
    expect(response.body).toContain('[REDACTED]');
    await app.close();
  });
});

function createApp() {
  const database = createDatabase(':memory:');
  databases.push(database);
  const app = Fastify({ logger: false });
  registerPromptReviewRoutes(app, {
    database,
    clock: () => Date.now(),
  });
  return { app, database };
}

function tableNames(database: DatabaseConnection): string[] {
  return (
    database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((row) => row.name);
}

function insertSession(
  database: DatabaseConnection,
  agent: string,
  index: number,
  tokens: number,
): void {
  const id = `${agent}-${index}`;
  database
    .prepare(
      `INSERT INTO sessions (
        id, file_path, agent, start_time, end_time, input_tokens,
        cost_unknown_count, total_cost, cache_hit_rate, peak_context_tokens,
        avg_context_tokens
      ) VALUES (?, ?, ?, 1000, ?, ?, 0, ?, 0.5, ?, ?)`,
    )
    .run(id, `fixture://${id}`, agent, 2000 + index, tokens, tokens / 100, tokens / 2, tokens / 3);
  database
    .prepare(
      `INSERT INTO spans (
        id, session_id, type, name, start_time, model, metadata
      ) VALUES (?, ?, 'llm_turn', 'fixture', 1000, 'fixture-model', NULL)`,
    )
    .run(`${id}-turn`, id);
  database
    .prepare(
      `INSERT INTO spans (
        id, session_id, type, name, start_time, metadata
      ) VALUES (?, ?, 'tool_call', 'Read', 1100, ?)`,
    )
    .run(`${id}-tool`, id, JSON.stringify({ input: '{}' }));
}
