import { describe, expect, it } from 'vitest';
import { buildProjectProfile } from '../project-profile';

describe('project profile aggregation', () => {
  it('aggregates resources, reliability, tools, and trends without filling missing evidence', () => {
    const report = buildProjectProfile({
      project: { key: '/workspace/app', label: 'app' },
      range: { from: 1_751_939_200_000, to: null },
      sessions: [
        {
          id: 's1',
          available: true,
          agent: 'codex',
          sourceKind: 'codex',
          startTime: Date.UTC(2025, 6, 1),
          endTime: Date.UTC(2025, 6, 1) + 500,
          inputTokens: 10,
          cacheCreationTokens: 2,
          cacheReadTokens: 3,
          outputTokens: 5,
          totalCost: 2,
          costUnknownCount: 0,
          cacheHitRate: 0.5,
          peakContextTokens: 100,
        },
        {
          id: 's2',
          available: true,
          agent: 'claude-code',
          startTime: Date.UTC(2025, 6, 2),
          inputTokens: 20,
          outputTokens: 5,
          costUnknownCount: 1,
        },
      ],
      tools: [
        { sessionId: 's1', name: 'Read', startTime: Date.UTC(2025, 6, 1) + 100, isError: false },
        { sessionId: 's1', name: 'Read', startTime: Date.UTC(2025, 6, 1) + 200, isError: true },
      ],
    });

    expect(report.schemaVersion).toBe('project-profile/v1');
    expect(report.metrics).toMatchObject({
      totalTokens: 45,
      totalCost: 2,
      toolCalls: 2,
      toolErrors: 1,
      toolErrorRate: 0.5,
      cacheHitRate: 0.5,
      peakContextTokens: 100,
      durationMs: 500,
    });
    expect(report.metrics.costCoverage).toEqual({ observed: 1, total: 2, ratio: 0.5 });
    expect(report.scope.sources).toEqual([
      { sourceKind: 'codex', sessions: 1, observed: true },
      { sourceKind: 'unknown', sessions: 1, observed: false },
    ]);
    expect(report.tools).toEqual([{ name: 'Read', calls: 2, errors: 1, sessions: 1 }]);
    expect(report.coverage.files.status).toBe('not_captured');
    expect(report.limitations).toContain(
      'Some Sessions have no captured source kind; source coverage is partial.',
    );
  });

  it('marks sampled and unavailable sessions in coverage', () => {
    const report = buildProjectProfile({
      project: { key: '/workspace/app', label: 'app' },
      sampled: true,
      toolSampled: true,
      sessions: [{ id: 'missing', available: false }],
      tools: [],
    });

    expect(report.scope).toMatchObject({ linkedSessions: 1, availableSessions: 0, sampled: true });
    expect(report.coverage.sessions).toEqual({ observed: 0, total: 1, ratio: 0, sampled: true });
    expect(report.coverage.tools.status).toBe('not_captured');
    expect(report.limitations).toEqual(
      expect.arrayContaining([
        'Session scope is sampled; aggregates describe the selected local sample.',
        'Tool evidence is sampled; tool counts are lower bounds for this scope.',
      ]),
    );
  });
});
