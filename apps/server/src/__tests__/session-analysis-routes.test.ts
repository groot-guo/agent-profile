import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../database';
import { registerSessionRoutes } from '../routes/sessions';
import { SemanticDiagnosisRepository } from '../semantic-diagnosis-repository';

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
    expect(body.relationships).toEqual({
      parent: null,
      children: [],
      coverage: { status: 'not_captured', supportedSources: ['codex'] },
    });
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

  it('restores a saved semantic result in the refreshed analysis summary', async () => {
    const { app, database, semanticDiagnosis } = createApp();
    insertSession(database, 'session-1', '/fixture/project', 100);
    semanticDiagnosis.save(
      'session-1',
      undefined,
      {
        requested: true,
        consent: 'granted',
        status: 'completed',
        provider: 'openai',
        findingCount: 1,
        payload: {
          mode: 'bounded_redacted',
          thinkingItems: 0,
          toolItems: 1,
          characters: 10,
          redactions: 0,
          rawContentIncluded: false,
        },
        audit: {
          recorded: true,
          retention: 'process_bounded_content_free',
          rawContentStored: false,
        },
        limitations: ['fixture'],
      },
      [
        {
          type: 'tool_off_target',
          severity: 'medium',
          title: '[LLM] fixture finding',
          detail: 'bounded',
          suggestion: 'review',
          wastedTokens: 0,
          wastedCost: 0,
          costUnknown: false,
          spanIds: ['session-1-tool'],
        },
      ],
      1234,
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/session/session-1/analysis-summary',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().diagnosis).toMatchObject({
      semantic: { status: 'completed', findingCount: 1, savedAt: 1234 },
      findings: [expect.objectContaining({ title: '[LLM] fixture finding' })],
    });
    await app.close();
  });

  it('shows linked and unavailable source-native parent coverage without inference', async () => {
    const { app, database } = createApp();
    insertSession(database, 'codex-parent', '/fixture/project', 100);
    insertSession(database, 'codex-child', '/fixture/project', 200);
    database
      .prepare(
        `INSERT INTO session_relationships (
          child_session_id, parent_session_id, source_kind, relation_kind,
          call_started_at, callback_at, callback_status,
          agent_nickname, agent_role, agent_path, updated_at
        ) VALUES (?, ?, 'codex', 'source_parent', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'codex-child',
        'codex-parent',
        2,
        3,
        'final_answer',
        'Audit',
        'review',
        '/root/audit',
        1,
      );

    const linked = await app.inject({
      method: 'GET',
      url: '/api/session/codex-child/analysis-summary',
    });
    expect(linked.json().relationships).toEqual({
      parent: {
        id: 'codex-parent',
        availability: 'available',
        sourceKind: 'codex',
        callStartedAt: 2,
        callbackAt: 3,
        callbackStatus: 'final_answer',
        agentNickname: 'Audit',
        agentRole: 'review',
        agentPath: '/root/audit',
      },
      children: [],
      coverage: { status: 'linked', supportedSources: ['codex'] },
    });

    database
      .prepare('UPDATE session_relationships SET parent_session_id = ? WHERE child_session_id = ?')
      .run('codex-parent-missing', 'codex-child');
    const unavailable = await app.inject({
      method: 'GET',
      url: '/api/session/codex-child/analysis-summary',
    });
    expect(unavailable.json().relationships).toEqual({
      parent: {
        id: 'codex-parent-missing',
        availability: 'unavailable',
        sourceKind: 'codex',
        callStartedAt: 2,
        callbackAt: 3,
        callbackStatus: 'final_answer',
        agentNickname: 'Audit',
        agentRole: 'review',
        agentPath: '/root/audit',
      },
      children: [],
      coverage: { status: 'parent_unavailable', supportedSources: ['codex'] },
    });
    await app.close();
  });
});

function createApp() {
  const database = createDatabase(':memory:');
  databases.push(database);
  const semanticDiagnosis = new SemanticDiagnosisRepository(database);
  const app = Fastify({ logger: false });
  registerSessionRoutes(app, {
    database,
    pricingResolver: () => undefined,
    contextWindowResolver: () => 200_000,
    semanticDiagnosis,
  });
  return { app, database, semanticDiagnosis };
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
