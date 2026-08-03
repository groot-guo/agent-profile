import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../database';
import {
  getSessionDiagnosisReport,
  getSessionEvidenceReport,
  getTaskFeedbackReports,
  recordTaskOutcomeEvidence,
} from '../reports-service';
import { TaskRepository } from '../task-repository';

const databases: DatabaseConnection[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('content-free local reports', () => {
  it('returns diagnosis references without source content', async () => {
    const database = createDatabase(':memory:');
    databases.push(database);
    insertFixture(database);

    const report = await getSessionDiagnosisReport(runtime(database), 'session-1');

    expect(report).toMatchObject({
      schemaVersion: 'cli-diagnosis/v1',
      session: { id: 'session-1', agent: 'codex' },
      semantic: { requested: false, audit: { rawContentStored: false } },
    });
    expect(JSON.stringify(report)).not.toContain('private-command-marker');
    expect(JSON.stringify(report)).not.toContain('sk-supersecret123456');
  });

  it('returns bounded evidence references and reuses validated Outcome writes', () => {
    const database = createDatabase(':memory:');
    databases.push(database);
    insertFixture(database);
    const runtimeValue = runtime(database);

    const evidence = getSessionEvidenceReport(runtimeValue, 'session-1');
    expect(evidence).toMatchObject({
      schemaVersion: 'cli-evidence/v1',
      privacy: { contentMode: 'none', rawContentIncluded: false },
    });
    expect(evidence.references.map((reference) => reference.id)).toEqual([
      'turn-1',
      'tool-1',
      'thinking-1',
    ]);
    expect(JSON.stringify(evidence)).not.toContain('private-command-marker');

    const task = new TaskRepository(database).createTask({ title: 'Report task', type: 'feature' });
    const saved = recordTaskOutcomeEvidence(runtimeValue, task.id, {
      kind: 'review',
      status: 'observed',
      reference: 'local://span/tool-1',
    });
    expect(saved).toMatchObject({
      evidenceCount: 1,
      kind: 'review',
      status: 'observed',
      coverage: { status: 'not_collected', totalFields: 5 },
    });
    expect(getTaskFeedbackReports(runtimeValue, task.id)).toEqual([]);
  });
});

function runtime(database: DatabaseConnection) {
  return {
    database,
    clock: () => 1_800_000_000_000,
    pricingResolver: () => undefined,
    contextWindowResolver: () => undefined,
  };
}

function insertFixture(database: DatabaseConnection): void {
  database
    .prepare(
      `INSERT INTO sessions (id, file_path, agent, start_time, end_time)
       VALUES ('session-1', 'fixture://session-1', 'codex', 100, 200)`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO spans (id, session_id, type, name, start_time, end_time, metadata)
       VALUES ('turn-1', 'session-1', 'llm_turn', 'turn', 100, 110, NULL)`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO spans (id, session_id, parent_id, type, name, start_time, end_time, metadata)
       VALUES ('tool-1', 'session-1', 'turn-1', 'tool_call', 'Bash', 120, 130, ?)`,
    )
    .run(JSON.stringify({ input: 'private-command-marker', output: 'sk-supersecret123456' }));
  database
    .prepare(
      `INSERT INTO spans (id, session_id, parent_id, type, name, start_time, end_time, metadata)
       VALUES ('thinking-1', 'session-1', 'turn-1', 'thinking', 'thinking', 125, ?, ?)`,
    )
    .run(126, JSON.stringify({ thinking: 'private-command-marker' }));
}
