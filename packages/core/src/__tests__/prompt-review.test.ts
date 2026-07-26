import { describe, expect, it } from 'vitest';
import type { AgentProcessProfile } from '../profile';
import {
  buildPromptIterationReport,
  MAX_PROMPT_CHARACTERS,
  MAX_PROMPT_EVIDENCE_CHARACTERS,
  reviewPromptStructure,
} from '../prompt-review';

describe('prompt structure review', () => {
  it('returns six deterministic checks without echoing the raw prompt', () => {
    const prompt = [
      '目标：修复登录页面的超时问题并更新接口。',
      '范围：只修改 auth 模块，不改数据库。',
      '验收：登录请求返回 200，超时场景不再复现。',
      '约束：不得上传日志，保持向后兼容。',
      '背景：当前 production 日志显示 timeout error。',
      '验证：运行 auth test 和 pnpm build，必须通过。',
    ].join('\n');
    const report = reviewPromptStructure(prompt, {
      includeEvidence: false,
      generatedAt: 123,
    });

    expect(report).toMatchObject({
      schemaVersion: 'prompt-review/v1',
      generatedAt: 123,
      summary: { present: 6, partial: 0, missing: 0 },
      privacy: {
        retention: 'not_stored',
        semanticProvider: 'not_used',
        evidenceIncluded: false,
      },
    });
    expect(report.checks).toHaveLength(6);
    expect(report.checks.every((check) => check.evidence.length === 0)).toBe(true);
    expect(JSON.stringify(report)).not.toContain(prompt);
  });

  it('keeps evidence opt-in, bounded, and redacts common secrets', () => {
    const secret = `sk-${'a'.repeat(40)}`;
    const prompt = `目标：修复服务问题 api_key=${secret} ${'x'.repeat(300)}`;
    const report = reviewPromptStructure(prompt, {
      includeEvidence: true,
      generatedAt: 123,
    });
    const evidence = report.checks.flatMap((check) => check.evidence);

    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence.every((item) => item.length <= MAX_PROMPT_EVIDENCE_CHARACTERS + 1)).toBe(true);
    expect(evidence.join(' ')).not.toContain(secret);
    expect(evidence.join(' ')).toContain('[REDACTED]');
  });

  it('rejects input beyond the shared size limit', () => {
    expect(() => reviewPromptStructure('x'.repeat(MAX_PROMPT_CHARACTERS + 1))).toThrow(RangeError);
  });

  it('combines prompt gaps with eligible runtime evidence', () => {
    const review = reviewPromptStructure('请优化这个功能，当前代码有问题。', {
      generatedAt: 123,
    });
    const report = buildPromptIterationReport(review, profileFixture(), 456);

    expect(report.schemaVersion).toBe('iteration-hints/v1');
    expect(report.agentProfile).toEqual({
      agent: 'claude-code',
      comparisonStatus: 'ready',
      sessions: 12,
    });
    expect(report.hints[0]).toMatchObject({
      source: 'combined',
      priority: 'high',
      requiresOutcomeValidation: true,
    });
    expect(
      report.hints.some(
        (hint) =>
          hint.evidence.some((evidence) => evidence.includes('resource.tokens_per_session')) &&
          hint.evidence.some((evidence) => evidence.includes('prompt check scope')),
      ),
    ).toBe(true);
  });
});

function profileFixture(): AgentProcessProfile {
  const emptyDistribution = {
    unit: 'tokens' as const,
    observed: 12,
    total: 12,
    coverage: 1,
    mean: 100,
    median: 100,
    p90: 100,
    min: 100,
    max: 100,
  };
  const zeroRate = { unit: 'ratio' as const, value: 0, numerator: 0, denominator: 12 };
  return {
    agent: 'claude-code',
    comparisonStatus: 'ready',
    sample: { sessions: 12, llmTurns: 24, toolCalls: 12 },
    dimensions: {
      resourceUsage: {
        tokensPerSession: emptyDistribution,
        costPerSession: { ...emptyDistribution, unit: 'CNY' },
        durationPerSession: { ...emptyDistribution, unit: 'milliseconds' },
        cacheHitRate: { ...emptyDistribution, unit: 'ratio' },
      },
      contextDiscipline: {
        peakContextPerSession: emptyDistribution,
        averageContextPerSession: emptyDistribution,
      },
      executionReliability: {
        toolErrorRate: zeroRate,
        sessionsWithToolErrors: zeroRate,
      },
      collaboration: {
        sidechainTurnShare: zeroRate,
        sidechainToolShare: zeroRate,
        sessionsWithSidechains: zeroRate,
      },
    },
    coverage: {
      knownCost: { ...zeroRate, value: 1, numerator: 12 },
      duration: { ...zeroRate, value: 1, numerator: 12 },
      modelIdentity: { ...zeroRate, value: 1, numerator: 12 },
      toolEvidence: { ...zeroRate, value: 1, numerator: 12 },
      outcome: {
        status: 'not_collected',
        value: 0,
        explanation: 'fixture',
      },
    },
    relativeCharacteristics: [
      {
        metric: 'resource.tokens_per_session',
        label: 'Median tokens per session',
        unit: 'tokens',
        value: 200,
        peerMedian: 100,
        deltaRatio: 1,
        direction: 'higher',
        confidence: 'high',
        evidence: {
          agentSessions: 12,
          peerAgents: 1,
          peerSessions: 12,
          targetCoverage: 1,
          peerCoverage: 1,
        },
      },
      {
        metric: 'resource.duration_ms_per_session',
        label: 'Median duration per session',
        unit: 'milliseconds',
        value: 200,
        peerMedian: 100,
        deltaRatio: 1,
        direction: 'higher',
        confidence: 'high',
        evidence: {
          agentSessions: 12,
          peerAgents: 1,
          peerSessions: 12,
          targetCoverage: 1,
          peerCoverage: 1,
        },
      },
    ],
    limitations: [],
  };
}
