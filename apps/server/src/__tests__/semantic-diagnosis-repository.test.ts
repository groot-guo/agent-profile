import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../database';
import { SemanticDiagnosisRepository } from '../semantic-diagnosis-repository';

const databases: DatabaseConnection[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('SemanticDiagnosisRepository', () => {
  it('persists bounded findings and restores only for the same source revision', () => {
    const database = createDatabase(':memory:');
    databases.push(database);
    database
      .prepare(
        `INSERT INTO sessions (id, file_path, agent, start_time, source_fingerprint)
         VALUES ('session-1', 'fixture://session-1', 'codex', 100, 'revision-1')`,
      )
      .run();
    const repository = new SemanticDiagnosisRepository(database);
    const semantic = {
      requested: true as const,
      consent: 'granted' as const,
      status: 'completed' as const,
      provider: 'openai' as const,
      findingCount: 1,
      payload: {
        mode: 'bounded_redacted' as const,
        thinkingItems: 0,
        toolItems: 1,
        characters: 12,
        redactions: 0,
        rawContentIncluded: false as const,
      },
      audit: {
        recorded: true,
        retention: 'process_bounded_content_free' as const,
        rawContentStored: false as const,
      },
      limitations: ['bounded'],
    };
    const finding = {
      type: 'tool_off_target' as const,
      severity: 'medium' as const,
      title: '[LLM] off target',
      detail: 'bounded detail',
      suggestion: 'narrow the scope',
      wastedTokens: 0,
      wastedCost: 0,
      costUnknown: false,
      spanIds: ['tool-1'],
    };

    repository.save('session-1', 'revision-1', semantic, [finding], 1234);

    expect(repository.load('session-1', 'revision-1')).toMatchObject({
      sessionId: 'session-1',
      sourceFingerprint: 'revision-1',
      savedAt: 1234,
      semantic: { status: 'completed', findingCount: 1, savedAt: 1234 },
      findings: [finding],
    });
    expect(repository.load('session-1', 'revision-2')).toBeNull();
    expect(JSON.stringify(repository.load('session-1', 'revision-1'))).not.toContain(
      'raw-session-content',
    );
  });

  it('fails closed when stored JSON is malformed', () => {
    const database = createDatabase(':memory:');
    databases.push(database);
    database
      .prepare(
        `INSERT INTO sessions (id, file_path, agent, start_time, source_fingerprint)
         VALUES ('session-1', 'fixture://session-1', 'codex', 100, 'revision-1')`,
      )
      .run();
    database.pragma('ignore_check_constraints = ON');
    database
      .prepare(
        `INSERT INTO semantic_diagnoses (
          session_id, source_fingerprint, requested_at, status, semantic_json,
          findings_json, updated_at
        ) VALUES ('session-1', 'revision-1', 1, 'completed', '{', '[]', 1)`,
      )
      .run();

    expect(new SemanticDiagnosisRepository(database).load('session-1', 'revision-1')).toBeNull();
  });

  it('fails closed when valid JSON has an invalid semantic shape', () => {
    const database = createDatabase(':memory:');
    databases.push(database);
    database
      .prepare(
        `INSERT INTO sessions (id, file_path, agent, start_time, source_fingerprint)
         VALUES ('session-1', 'fixture://session-1', 'codex', 100, 'revision-1')`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO semantic_diagnoses (
          session_id, source_fingerprint, requested_at, status, semantic_json,
          findings_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'session-1',
        'revision-1',
        1,
        'completed',
        JSON.stringify({ status: 'completed', payload: null }),
        '[]',
        1,
      );

    expect(new SemanticDiagnosisRepository(database).load('session-1', 'revision-1')).toBeNull();
  });
});
