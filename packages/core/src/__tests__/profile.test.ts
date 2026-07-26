import { describe, expect, it } from 'vitest';
import {
  AGENT_PROFILE_SCHEMA_VERSION,
  type AgentProfileSessionSample,
  buildAgentProfileReport,
} from '../profile';

describe('agent profile report', () => {
  it('returns a versioned empty report without inventing comparisons', () => {
    const report = buildAgentProfileReport([], 1234);
    expect(report).toMatchObject({
      schemaVersion: AGENT_PROFILE_SCHEMA_VERSION,
      generatedAt: 1234,
      scope: { agents: [], sessions: 0 },
      comparison: { status: 'insufficient_data' },
      profiles: [],
    });
  });

  it('keeps sparse profiles visible but suppresses relative claims', () => {
    const report = buildAgentProfileReport([sample('claude-code', 1, 100)], 1234);
    expect(report.profiles[0]).toMatchObject({
      agent: 'claude-code',
      comparisonStatus: 'insufficient_data',
      sample: { sessions: 1 },
      relativeCharacteristics: [],
    });
    expect(report.profiles[0].coverage.outcome.status).toBe('not_collected');
    expect(report.profiles[0].limitations[0]).toContain('at least 3');
  });

  it('compares eligible Agents using distributions and explicit coverage', () => {
    const samples = [
      sample('claude-code', 1, 100, { totalCostCny: 1, toolErrors: 1 }),
      sample('claude-code', 2, 200, { totalCostCny: 2 }),
      sample('claude-code', 3, 300, { totalCostCny: undefined }),
      sample('codex', 1, 400, { totalCostCny: 4 }),
      sample('codex', 2, 500, { totalCostCny: 5 }),
      sample('codex', 3, 600, { totalCostCny: 6 }),
    ];
    const report = buildAgentProfileReport(samples, 1234);
    const claude = report.profiles.find((profile) => profile.agent === 'claude-code');
    const codex = report.profiles.find((profile) => profile.agent === 'codex');

    expect(report.comparison.status).toBe('ready');
    expect(claude?.dimensions.resourceUsage.tokensPerSession).toMatchObject({
      observed: 3,
      total: 3,
      coverage: 1,
      median: 200,
      p90: 300,
    });
    expect(claude?.dimensions.resourceUsage.costPerSession).toMatchObject({
      observed: 2,
      total: 3,
      coverage: 2 / 3,
      median: 1,
    });
    expect(claude?.comparisonStatus).toBe('ready');
    expect(codex?.comparisonStatus).toBe('ready');
    expect(
      claude?.relativeCharacteristics.find(
        (characteristic) => characteristic.metric === 'resource.tokens_per_session',
      ),
    ).toMatchObject({
      value: 200,
      peerMedian: 500,
      direction: 'lower',
      confidence: 'medium',
      evidence: {
        agentSessions: 3,
        peerAgents: 1,
        peerSessions: 3,
        targetCoverage: 1,
        peerCoverage: 1,
      },
    });
  });

  it('omits a relative metric when target coverage is below the minimum', () => {
    const samples = [
      sample('claude-code', 1, 100, { totalCostCny: 1 }),
      sample('claude-code', 2, 200, { totalCostCny: undefined }),
      sample('claude-code', 3, 300, { totalCostCny: undefined }),
      sample('codex', 1, 100, { totalCostCny: 1 }),
      sample('codex', 2, 200, { totalCostCny: 2 }),
      sample('codex', 3, 300, { totalCostCny: 3 }),
    ];
    const report = buildAgentProfileReport(samples);
    const claude = report.profiles.find((profile) => profile.agent === 'claude-code');
    expect(
      claude?.relativeCharacteristics.some(
        (characteristic) => characteristic.metric === 'resource.cost_cny_per_session',
      ),
    ).toBe(false);
  });
});

function sample(
  agent: string,
  index: number,
  totalTokens: number,
  overrides: Partial<AgentProfileSessionSample> = {},
): AgentProfileSessionSample {
  return {
    id: `${agent}-${index}`,
    agent,
    totalTokens,
    totalCostCny: totalTokens / 100,
    durationMs: totalTokens * 10,
    cacheHitRate: 0.5,
    peakContextTokens: totalTokens / 2,
    averageContextTokens: totalTokens / 3,
    llmTurns: 2,
    modelKnownTurns: 2,
    toolCalls: 2,
    toolErrors: 0,
    toolEvidenceCalls: 2,
    sidechainTurns: 0,
    sidechainTools: 0,
    ...overrides,
  };
}
