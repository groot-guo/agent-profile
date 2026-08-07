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

    const verified = buildTaskProfile({
      task,
      configurations: [],
      sessions: [],
      generatedAt: 1,
      outcome: {
        buildStatus: 'passed',
        testStatus: 'passed',
        lintStatus: 'passed',
        gitCommit: 'abc123',
        humanRating: 5,
        reworkReason: null,
        completedAt: 1,
        evidence: [{ kind: 'test', status: 'passed' }],
      },
    });
    expect(verified.coverage.outcome.status).toBe('verified');
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

  it('counts only the five verification fields toward verified Outcome coverage', () => {
    const supplementalOnly = buildTaskProfile({
      task,
      configurations: [],
      sessions: [],
      generatedAt: 1,
      outcome: {
        buildStatus: null,
        testStatus: null,
        lintStatus: null,
        gitCommit: null,
        humanRating: null,
        reworkReason: 'Needs another pass',
        completedAt: 100,
        evidence: [{ kind: 'review', status: 'failed' }],
      },
    });

    expect(supplementalOnly.coverage.outcome).toEqual({
      status: 'not_collected',
      observedFields: 0,
      totalFields: 5,
    });
  });

  it('exposes a flat Task graph without relationships as absent coverage', () => {
    const report = buildTaskProfile({
      task,
      configurations: [],
      generatedAt: 1,
      sessions: [
        { id: 'a', available: true, role: 'primary', agent: 'codex' },
        { id: 'b', available: true, role: 'continuation', agent: 'codex' },
      ],
    });
    expect(report.graph.nodes).toHaveLength(2);
    expect(report.graph.edges).toEqual([]);
    expect(report.graph.coverage.relationships).toEqual({
      captured: 0,
      partial: 0,
      absent: 2,
    });
    expect(
      report.limitations.some((item) => item.includes('no stored source-native relationship')),
    ).toBe(true);
  });

  it('builds a typed Task graph with source-native edges and per-Agent attribution', () => {
    const report = buildTaskProfile({
      task,
      configurations: [],
      generatedAt: 1,
      sessions: [
        {
          id: 'parent',
          available: true,
          role: 'primary',
          agent: 'codex',
          inputTokens: 10,
          outputTokens: 2,
          totalCost: 1,
          costUnknownCount: 0,
          toolCalls: 4,
          toolErrors: 1,
        },
        {
          id: 'child',
          available: true,
          role: 'subagent',
          agent: 'codex',
          inputTokens: 5,
          outputTokens: 1,
          totalCost: 0.5,
          costUnknownCount: 0,
          toolCalls: 2,
          toolErrors: 0,
        },
      ],
      relationships: [
        {
          from: 'child',
          to: 'parent',
          kind: 'source_parent',
          source: 'codex',
          counterpartAvailable: true,
          counterpartLinked: true,
        },
      ],
    });
    expect(report.graph.edges).toEqual([
      expect.objectContaining({
        from: 'child',
        to: 'parent',
        kind: 'source_parent',
        source: 'codex',
        counterpartAvailable: true,
        counterpartLinked: true,
      }),
    ]);
    expect(report.graph.coverage.relationships).toEqual({
      captured: 1,
      partial: 0,
      absent: 0,
    });
    expect(report.graph.attribution).toEqual([
      expect.objectContaining({
        agent: 'codex',
        linkedSessions: 2,
        availableSessions: 2,
        totalTokens: 18,
        totalCost: 1.5,
        toolCalls: 6,
        toolErrors: 1,
      }),
    ]);
    // The flat aggregate must reconcile exactly to the linked Sessions, never
    // summing the child twice through the parent edge.
    expect(report.profile.totalTokens).toBe(18);
    expect(report.profile.totalCost).toBe(1.5);
    expect(report.profile.toolCalls).toBe(6);
    expect(report.profile.toolErrors).toBe(1);
    expect(
      report.limitations.some((item) => item.includes('never merged into a parent twice')),
    ).toBe(true);
  });

  it('reports partial relationship coverage when the counterpart is unavailable or unlinked', () => {
    const report = buildTaskProfile({
      task,
      configurations: [],
      generatedAt: 1,
      sessions: [
        { id: 'child', available: true, role: 'subagent', agent: 'codex' },
        { id: 'solo', available: true, role: 'primary', agent: 'zed' },
      ],
      relationships: [
        {
          from: 'child',
          to: 'missing-parent',
          kind: 'source_parent',
          source: 'codex',
          counterpartAvailable: false,
          counterpartLinked: false,
        },
      ],
    });
    expect(report.graph.edges[0]).toMatchObject({
      counterpartAvailable: false,
      counterpartLinked: false,
    });
    expect(report.graph.coverage.relationships).toEqual({
      captured: 1,
      partial: 1,
      absent: 1,
    });
    expect(report.limitations.some((item) => item.includes('stored row is unavailable'))).toBe(
      true,
    );
    expect(report.limitations.some((item) => item.includes('outside the Task'))).toBe(true);
    expect(
      report.limitations.some((item) => item.includes('no stored source-native relationship')),
    ).toBe(true);
  });

  it('reconciles per-Agent attribution across multiple Agents', () => {
    const report = buildTaskProfile({
      task,
      configurations: [],
      generatedAt: 1,
      sessions: [
        {
          id: 'a1',
          available: true,
          role: 'primary',
          agent: 'codex',
          inputTokens: 10,
          totalCost: 1,
          costUnknownCount: 0,
          toolCalls: 3,
          toolErrors: 0,
        },
        {
          id: 'a2',
          available: true,
          role: 'subagent',
          agent: 'claude',
          inputTokens: 4,
          totalCost: 0.2,
          costUnknownCount: 0,
          toolCalls: 1,
          toolErrors: 1,
        },
        { id: 'a3', available: false, role: 'verification', agent: 'codex' },
      ],
    });
    expect(report.graph.attribution).toEqual([
      expect.objectContaining({
        agent: 'claude',
        linkedSessions: 1,
        availableSessions: 1,
        totalTokens: 4,
        totalCost: 0.2,
        toolCalls: 1,
        toolErrors: 1,
      }),
      expect.objectContaining({
        agent: 'codex',
        linkedSessions: 2,
        availableSessions: 1,
        totalTokens: 10,
        totalCost: 1,
        toolCalls: 3,
        toolErrors: 0,
      }),
    ]);
    expect(report.profile.agents).toEqual(['claude', 'codex']);
  });
});
