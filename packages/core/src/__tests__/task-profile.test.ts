import { describe, expect, it } from 'vitest';
import { buildTaskProfile } from '../task-profile';

describe('Task Profile', () => {
  const task = {
    id: 'task-1',
    title: 'Implement feature',
    type: 'feature',
    status: 'completed' as const,
  };

  it('keeps a missing Outcome distinct from an explicitly failed check', () => {
    const missing = buildTaskProfile({ task, configurations: [], sessions: [], generatedAt: 1 });
    expect(missing.outcome).toBeNull();
    expect(missing.coverage.outcome).toEqual({
      status: 'not_collected',
      observedFields: 0,
      totalFields: 5,
    });

    const failed = buildTaskProfile({
      task,
      configurations: [],
      sessions: [],
      generatedAt: 1,
      outcome: {
        buildStatus: null,
        testStatus: 'failed',
        lintStatus: null,
        gitCommit: null,
        humanRating: null,
        reworkReason: null,
        completedAt: null,
        evidence: [],
      },
    });
    expect(failed.outcome?.testStatus).toBe('failed');
    expect(failed.coverage.outcome.status).toBe('partial');
  });

  it('aggregates only available linked Sessions and exposes coverage limits', () => {
    const report = buildTaskProfile({
      task,
      configurations: [],
      generatedAt: 1,
      cohortIds: ['cohort-1'],
      sessions: [
        {
          id: 'available',
          available: true,
          role: 'primary',
          agent: 'codex',
          inputTokens: 10,
          cacheCreationTokens: 2,
          cacheReadTokens: 3,
          outputTokens: 4,
          totalCost: 1.5,
          costUnknownCount: 0,
          startTime: 100,
          endTime: 250,
          peakContextTokens: 15,
          cacheHitRate: 0.2,
          toolCalls: 5,
          toolErrors: 1,
        },
        { id: 'missing', available: false, role: 'continuation' },
      ],
    });

    expect(report.schemaVersion).toBe('task-profile/v1');
    expect(report.profile).toMatchObject({
      linkedSessions: 2,
      availableSessions: 1,
      agents: ['codex'],
      totalTokens: 19,
      totalCost: 1.5,
      durationMs: 150,
      toolErrorRate: 0.2,
    });
    expect(report.coverage.sessions.ratio).toBe(0.5);
    expect(report.comparison.status).toBe('definition_only');
    expect(report.comparison.interpretation).toContain('No configuration is labelled better');
  });
});
