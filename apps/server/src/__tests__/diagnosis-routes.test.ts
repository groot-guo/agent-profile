import type { LlmDiagnosisResponse } from '@agent-profile/core';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../database';
import { createSemanticDiagnosisAuditStore, type SemanticDiagnoser } from '../llm-diagnoser';
import { registerDiagnosisRoutes } from '../routes/diagnosis';

const databases: DatabaseConnection[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('diagnosis route semantic consent boundary', () => {
  it('does not call the semantic Provider without request-scoped opt-in', async () => {
    const { app, database, diagnoser } = createApp();
    insertSession(database);

    const response = await app.inject({
      method: 'GET',
      url: '/api/session/session-1/diagnosis',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      semantic: {
        requested: false,
        consent: 'not_granted',
        status: 'not_requested',
        payload: { mode: 'not_sent', rawContentIncluded: false },
      },
    });
    expect(diagnoser.diagnoseWithMetadata).not.toHaveBeenCalled();
    await app.close();
  });

  it('requires the explicit opt-in query and records only bounded audit metadata', async () => {
    const { app, database, diagnoser, auditStore } = createApp();
    insertSession(database);

    const response = await app.inject({
      method: 'GET',
      url: '/api/session/session-1/diagnosis?semantic=opt_in',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      semantic: {
        requested: true,
        consent: 'granted',
        status: 'completed',
        audit: { recorded: true, rawContentStored: false },
      },
    });
    expect(diagnoser.diagnoseWithMetadata).toHaveBeenCalledOnce();
    expect(auditStore.snapshot()).toMatchObject([
      {
        sessionId: 'session-1',
        status: 'completed',
        payload: { mode: 'bounded_redacted', rawContentIncluded: false },
      },
    ]);
    expect(JSON.stringify(auditStore.snapshot())).not.toContain('raw-session-content');
    await app.close();
  });

  it('rejects unrecognized semantic query values', async () => {
    const { app, database } = createApp();
    insertSession(database);

    const response = await app.inject({
      method: 'GET',
      url: '/api/session/session-1/diagnosis?semantic=true',
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('suppresses semantic conclusions when no LLM turn has captured telemetry', async () => {
    const { app, database, diagnoser } = createApp();
    insertSession(database);
    // 把 session 的唯一 turn 标记为 stub（token 未捕获），语义推断必须被抑制。
    database
      .prepare(
        `INSERT INTO spans (
          id, session_id, type, name, start_time, model, metadata
        ) VALUES ('stub-turn', 'session-1', 'llm_turn', 'codex', 100, 'gpt-5.6-sol',
          '{"tokenUsageSource":"not_captured","stubTurn":true}')`,
      )
      .run();

    const response = await app.inject({
      method: 'GET',
      url: '/api/session/session-1/diagnosis?semantic=opt_in',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().semantic).toMatchObject({
      requested: true,
      consent: 'granted',
      status: 'insufficient_evidence',
      payload: { mode: 'not_sent', rawContentIncluded: false },
    });
    expect(diagnoser.diagnoseWithMetadata).not.toHaveBeenCalled();
    await app.close();
  });

  function createApp() {
    const database = createDatabase(':memory:');
    databases.push(database);
    const auditStore = createSemanticDiagnosisAuditStore();
    const response: LlmDiagnosisResponse = {
      findings: [],
      semantic: {
        requested: true,
        consent: 'granted',
        status: 'completed',
        provider: 'openai',
        payload: {
          mode: 'bounded_redacted',
          thinkingItems: 0,
          toolItems: 0,
          characters: 0,
          redactions: 0,
          rawContentIncluded: false,
        },
        audit: {
          recorded: false,
          retention: 'process_bounded_content_free',
          rawContentStored: false,
        },
        limitations: ['fixture'],
      },
    };
    const diagnoser: SemanticDiagnoser = {
      provider: 'openai',
      diagnose: vi.fn(async () => response.findings),
      diagnoseWithMetadata: vi.fn(async () => response),
    };
    const app = Fastify();
    registerDiagnosisRoutes(app, {
      database,
      clock: () => 1000,
      pricingResolver: () => undefined,
      contextWindowResolver: () => undefined,
      auditStore,
      provider: {
        status: () => ({
          configured: true,
          provider: 'openai' as const,
          model: 'route-model',
          endpointHost: 'api.example.com',
          endpointLocality: 'external' as const,
          configSource: 'file' as const,
          testStatus: 'passed' as const,
          restartRequired: false,
          keyConfigured: true,
        }),
        configure: () => undefined,
        diagnoser: () => diagnoser,
      },
    });
    return { app, database, diagnoser, auditStore };
  }

  function insertSession(database: DatabaseConnection): void {
    database
      .prepare(
        `INSERT INTO sessions (id, file_path, agent, start_time, imported_at)
       VALUES ('session-1', 'fixture://session-1', 'codex', 100, 200)`,
      )
      .run();
  }
});
