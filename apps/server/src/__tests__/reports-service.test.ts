import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../database';
import { getAgentProfileReport, getStatsReport, getTaskProfileReport } from '../reports-service';
import { type AppRuntime, createRuntime } from '../runtime';
import { TaskRepository } from '../task-repository';

describe('report service', () => {
  let runtime: AppRuntime;

  beforeEach(() => {
    runtime = createRuntime({
      database: createDatabase(':memory:'),
      autoScanDir: null,
      defaultScanDir: '~/.claude/projects',
      clock: () => 1_000,
    });
    runtime.database
      .prepare(
        `INSERT INTO sessions (
          id, file_path, agent, start_time, end_time, input_tokens, output_tokens,
          total_cost, cache_hit_rate, peak_context_tokens, imported_at
        ) VALUES ('report-session', 'fixture://report', 'codex', 1, 2, 10, 5, 0.25, 0.5, 10, 2)`,
      )
      .run();
    runtime.database
      .prepare(
        `INSERT INTO spans (id, session_id, type, name, start_time, is_sidechain)
         VALUES ('report-turn', 'report-session', 'llm_turn', 'fixture', 1, 0)`,
      )
      .run();
  });

  afterEach(async () => {
    await runtime.close();
  });

  it('returns existing statistics and Agent Process Profile reports over primary Sessions', () => {
    const statistics = getStatsReport(runtime);
    const profiles = getAgentProfileReport(runtime);

    expect(statistics.overview).toMatchObject({ totalSessions: 1, totalTokens: 15 });
    expect(profiles).toMatchObject({
      schemaVersion: 'agent-profile/v1',
      generatedAt: 1_000,
      scope: { agents: ['codex'], sessions: 1 },
    });
  });

  it('returns the existing Task Profile without creating a new outcome conclusion', () => {
    const task = new TaskRepository(runtime.database).createTask({
      title: 'Report fixture',
      type: 'feature',
    });

    const report = getTaskProfileReport(runtime, task.id);

    expect(report).toMatchObject({
      schemaVersion: 'task-profile/v1',
      task: { id: task.id },
      coverage: { outcome: { status: 'not_collected' } },
    });
    expect(report.generatedAt).toEqual(expect.any(Number));
  });
});
