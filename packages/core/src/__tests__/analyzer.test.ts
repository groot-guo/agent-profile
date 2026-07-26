import { describe, expect, it } from 'vitest';
import { analyzeCostAttribution, analyzeEfficiency, analyzePerformance, analyzeSession, analyzeToolParams, calcEfficiencyScore } from '../analyzer';
import type { ParsedSession, Pricing, Span } from '../types';

function makeTurn(overrides: Partial<Span> & { id: string }): Span {
  return {
    sessionId: 'sess-1',
    type: 'llm_turn',
    name: 'assistant',
    startTime: 1000,
    inputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    contextTokens: 0,
    outputBytes: 0,
    cost: 0,
    costUnknown: false,
    isError: false,
    isSidechain: false,
    ...overrides,
  };
}

function makeTool(overrides: Partial<Span> & { id: string }): Span {
  return {
    sessionId: 'sess-1',
    type: 'tool_call',
    name: 'Read',
    startTime: 1000,
    inputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    contextTokens: 0,
    outputBytes: 0,
    cost: 0,
    costUnknown: false,
    isError: false,
    isSidechain: false,
    ...overrides,
  };
}

const FLASH_PRICING: Pricing = {
  model: 'deepseek-v4-flash',
  inputPrice: 1,
  cacheCreationPrice: 1,
  cacheReadPrice: 0.02,
  outputPrice: 2,
};

function pricingLookup(model?: string): Pricing | undefined {
  if (model === 'deepseek-v4-flash') return FLASH_PRICING;
  return undefined;
}

describe('analyzeSession', () => {
  it('computes contextTokens as input + cc + cr', () => {
    const spans: Span[] = [
      makeTurn({ id: 't1', inputTokens: 1000, cacheCreationTokens: 500, cacheReadTokens: 300, outputTokens: 200 }),
    ];
    const parsed: ParsedSession = {
      sessionId: 'sess-1',
      meta: { filePath: '/tmp/test.jsonl', startTime: 1000, messageCount: 1, agent: 'claude-code' },
      spans,
    };
    const { summary, spans: resultSpans } = analyzeSession(parsed, pricingLookup);
    expect(resultSpans[0].contextTokens).toBe(1800); // 1000 + 500 + 300
    expect(summary.peakContextTokens).toBe(1800);
    expect(summary.avgContextTokens).toBe(1800);
  });

  it('aggregates session-level token totals', () => {
    const spans: Span[] = [
      makeTurn({ id: 't1', inputTokens: 1000, cacheCreationTokens: 200, cacheReadTokens: 100, outputTokens: 300, startTime: 1000 }),
      makeTurn({ id: 't2', inputTokens: 2000, cacheCreationTokens: 400, cacheReadTokens: 200, outputTokens: 600, startTime: 2000 }),
    ];
    const parsed: ParsedSession = {
      sessionId: 'sess-1',
      meta: { filePath: '/tmp/test.jsonl', startTime: 1000, messageCount: 2, agent: 'claude-code' },
      spans,
    };
    const { summary } = analyzeSession(parsed, pricingLookup);
    expect(summary.inputTokens).toBe(3000);
    expect(summary.cacheCreationTokens).toBe(600);
    expect(summary.cacheReadTokens).toBe(300);
    expect(summary.outputTokens).toBe(900);
  });

  it('calculates cacheHitRate correctly', () => {
    const spans: Span[] = [
      makeTurn({ id: 't1', inputTokens: 500, cacheCreationTokens: 500, cacheReadTokens: 2000, outputTokens: 200, startTime: 1000 }),
    ];
    const parsed: ParsedSession = {
      sessionId: 'sess-1',
      meta: { filePath: '/tmp/test.jsonl', startTime: 1000, messageCount: 1, agent: 'claude-code' },
      spans,
    };
    const { summary } = analyzeSession(parsed, pricingLookup);
    // cacheHitRate = 2000 / (500 + 500 + 2000) = 2000 / 3000 = 0.666...
    expect(summary.cacheHitRate).toBeCloseTo(0.6667, 3);
  });

  it('returns cacheHitRate 0 when total input is 0', () => {
    const spans: Span[] = [
      makeTurn({ id: 't1', outputTokens: 200, startTime: 1000 }),
    ];
    const parsed: ParsedSession = {
      sessionId: 'sess-1',
      meta: { filePath: '/tmp/test.jsonl', startTime: 1000, messageCount: 1, agent: 'claude-code' },
      spans,
    };
    const { summary } = analyzeSession(parsed, pricingLookup);
    expect(summary.cacheHitRate).toBe(0);
  });

  it('calculates peak and avg context correctly', () => {
    const spans: Span[] = [
      makeTurn({ id: 't1', inputTokens: 1000, cacheReadTokens: 500, outputTokens: 100, startTime: 1000 }),
      makeTurn({ id: 't2', inputTokens: 3000, cacheReadTokens: 2000, outputTokens: 100, startTime: 2000 }),
      makeTurn({ id: 't3', inputTokens: 1000, cacheReadTokens: 500, outputTokens: 100, startTime: 3000 }),
    ];
    const parsed: ParsedSession = {
      sessionId: 'sess-1',
      meta: { filePath: '/tmp/test.jsonl', startTime: 1000, messageCount: 3, agent: 'claude-code' },
      spans,
    };
    const { summary } = analyzeSession(parsed, pricingLookup);
    expect(summary.peakContextTokens).toBe(5000); // t2: 3000+2000=5000
    // avg = (1500 + 5000 + 1500) / 3 = 2666
    expect(summary.avgContextTokens).toBe(2667); // Math.round
  });

  it('sets costUnknownCount for unpriced models', () => {
    const spans: Span[] = [
      makeTurn({ id: 't1', model: 'unknown-model', inputTokens: 1000, outputTokens: 100, startTime: 1000 }),
    ];
    const parsed: ParsedSession = {
      sessionId: 'sess-1',
      meta: { filePath: '/tmp/test.jsonl', startTime: 1000, messageCount: 1, agent: 'claude-code' },
      spans,
    };
    const { summary } = analyzeSession(parsed, pricingLookup);
    expect(summary.costUnknownCount).toBe(1);
    expect(summary.totalCost).toBe(0);
  });

  it('sets cost for priced models', () => {
    const spans: Span[] = [
      makeTurn({ id: 't1', model: 'deepseek-v4-flash', inputTokens: 1_000_000, outputTokens: 0, startTime: 1000 }),
    ];
    const parsed: ParsedSession = {
      sessionId: 'sess-1',
      meta: { filePath: '/tmp/test.jsonl', startTime: 1000, messageCount: 1, agent: 'claude-code' },
      spans,
    };
    const { summary } = analyzeSession(parsed, pricingLookup);
    expect(summary.costUnknownCount).toBe(0);
    expect(summary.totalCost).toBeCloseTo(1, 5); // 1M input * 1 per 1M
  });

  it('skips non-llm_turn spans for context and cost', () => {
    const spans: Span[] = [
      makeTool({ id: 'tool1', outputBytes: 500 }),
      makeTurn({ id: 't1', inputTokens: 1000, outputTokens: 200, startTime: 1000 }),
    ];
    const parsed: ParsedSession = {
      sessionId: 'sess-1',
      meta: { filePath: '/tmp/test.jsonl', startTime: 1000, messageCount: 2, agent: 'claude-code' },
      spans,
    };
    const { summary, spans: resultSpans } = analyzeSession(parsed, pricingLookup);
    expect(resultSpans[0].contextTokens).toBe(0); // tool_call
    expect(resultSpans[1].contextTokens).toBe(1000); // llm_turn
    expect(summary.inputTokens).toBe(1000); // only from llm_turn
  });

  it('uses provided importedAt', () => {
    const spans: Span[] = [
      makeTurn({ id: 't1', inputTokens: 100, outputTokens: 50, startTime: 1000 }),
    ];
    const parsed: ParsedSession = {
      sessionId: 'sess-1',
      meta: { filePath: '/tmp/test.jsonl', startTime: 1000, messageCount: 1, agent: 'claude-code' },
      spans,
    };
    const fixedTime = 1700000000000;
    const { summary } = analyzeSession(parsed, pricingLookup, undefined, fixedTime);
    expect(summary.importedAt).toBe(fixedTime);
  });
});

// ===== analyzeEfficiency =====
describe('analyzeEfficiency', () => {
  it('computes tool success rates', () => {
    const spans: Span[] = [
      makeTool({ id: 't1', name: 'Bash' }),
      makeTool({ id: 't2', name: 'Bash', isError: true }),
      makeTool({ id: 't3', name: 'Read' }),
    ];
    const result = analyzeEfficiency(spans);
    expect(result.toolSuccessRates.length).toBe(2);
    const bash = result.toolSuccessRates.find((t) => t.name === 'Bash')!;
    expect(bash.total).toBe(2);
    expect(bash.errors).toBe(1);
    expect(bash.successRate).toBe(0.5);
    const read = result.toolSuccessRates.find((t) => t.name === 'Read')!;
    expect(read.successRate).toBe(1);
  });

  it('returns empty data for no tools', () => {
    const result = analyzeEfficiency([]);
    expect(result.toolSuccessRates).toEqual([]);
    expect(result.thinkingActionRatios).toEqual([]);
    expect(result.contextGrowthVelocity).toBe(0);
    expect(result.fileOperations).toEqual([]);
    expect(result.readToEditRate).toBe(0);
  });

  it('computes context growth velocity', () => {
    const spans: Span[] = [
      makeTurn({ id: 't1', inputTokens: 1000, startTime: 1000 }),
      makeTurn({ id: 't2', inputTokens: 3000, startTime: 2000 }),
      makeTurn({ id: 't3', inputTokens: 4000, startTime: 3000 }),
    ];
    const result = analyzeEfficiency(spans);
    expect(result.contextGrowthVelocity).toBeGreaterThan(0);
  });

  it('identifies file operations', () => {
    const spans: Span[] = [
      makeTool({ id: 'r1', name: 'Read', metadata: { input: JSON.stringify({ file_path: '/src/a.ts' }) } }),
      makeTool({ id: 'r2', name: 'Read', metadata: { input: JSON.stringify({ file_path: '/src/a.ts' }) } }),
      makeTool({ id: 'e1', name: 'Edit', metadata: { input: JSON.stringify({ file_path: '/src/a.ts' }) } }),
      makeTool({ id: 'w1', name: 'Write', metadata: { input: JSON.stringify({ file_path: '/src/b.ts' }) } }),
    ];
    const result = analyzeEfficiency(spans);
    expect(result.fileOperations.length).toBe(2);
    const a = result.fileOperations.find((f) => f.path === '/src/a.ts')!;
    expect(a.reads).toBe(2);
    expect(a.edits).toBe(1);
    // a.ts was read+edited; b.ts was only written, so it does not count as a Read→Edit conversion.
    expect(result.readToEditRate).toBe(1);
  });
});

// ===== analyzeCostAttribution =====
describe('analyzeCostAttribution', () => {
  it('splits cost by tool category', () => {
    const spans: Span[] = [
      makeTurn({ id: 't1', cost: 0.5, startTime: 1000 }),
      makeTool({ id: 'bash1', name: 'Bash', parentId: 't1' }),
      makeTool({ id: 'read1', name: 'Read', parentId: 't1' }),
      makeTurn({ id: 't2', cost: 0.3, startTime: 2000 }),
      makeTool({ id: 'read2', name: 'Read', parentId: 't2' }),
    ];
    const result = analyzeCostAttribution(spans);
    expect(result.totalCost).toBeCloseTo(0.8);
    expect(result.costByCategory.reduce((sum, item) => sum + item.cost, 0)).toBeCloseTo(0.8);
    expect(result.costByCategory.reduce((sum, item) => sum + item.percentage, 0)).toBeCloseTo(1);
    expect(result.costByCategory.find((item) => item.category === '命令执行')?.cost).toBeCloseTo(0.25);
    expect(result.costByCategory.find((item) => item.category === '文件操作')?.cost).toBeCloseTo(0.55);
  });

  it('attributes tool-free turns explicitly instead of dropping their cost', () => {
    const result = analyzeCostAttribution([makeTurn({ id: 't1', cost: 0.5 })]);
    expect(result.costByCategory).toEqual([expect.objectContaining({ category: '无工具调用', cost: 0.5 })]);
  });

  it('splits by 3 phases', () => {
    const spans: Span[] = Array.from({ length: 6 }, (_, i) =>
      makeTurn({ id: `t${i}`, cost: 1, inputTokens: 100, outputTokens: 50, startTime: 1000 + i * 100 }),
    );
    const result = analyzeCostAttribution(spans);
    expect(result.costByPhase.length).toBe(3);
    expect(result.costByPhase.reduce((s, p) => s + p.turnCount, 0)).toBe(6);
  });

  it('computes wastedCostRatio', () => {
    const spans: Span[] = [
      makeTurn({ id: 't1', cost: 1, startTime: 1000 }),
    ];
    const result = analyzeCostAttribution(spans, 0.3);
    expect(result.wastedCostRatio).toBeCloseTo(0.3);
  });

  it('caps wastedCostRatio at 1', () => {
    const spans: Span[] = [
      makeTurn({ id: 't1', cost: 0.1, startTime: 1000 }),
    ];
    const result = analyzeCostAttribution(spans, 0.5);
    expect(result.wastedCostRatio).toBe(1);
  });
});

// ===== calcEfficiencyScore =====
describe('calcEfficiencyScore', () => {
  it('computes score between 0-100', () => {
    const eff = analyzeEfficiency([
      makeTool({ id: 't1', name: 'Read' }),
      makeTool({ id: 't2', name: 'Bash' }),
    ]);
    const score = calcEfficiencyScore(eff, 0.5, 10000, 3000, 0.1, 0.02);
    expect(score.score).toBeGreaterThanOrEqual(0);
    expect(score.score).toBeLessThanOrEqual(100);
  });

  it('gives high score for efficient session', () => {
    const eff = analyzeEfficiency([
      makeTool({ id: 't1', name: 'Read' }),
    ]);
    const score = calcEfficiencyScore(eff, 0.9, 1000, 800, 0.01, 0);
    expect(score.score).toBeGreaterThan(70);
  });

  it('gives low score for inefficient session', () => {
    const eff = analyzeEfficiency([
      makeTool({ id: 't1', name: 'Bash', isError: true }),
      makeTool({ id: 't2', name: 'Bash', isError: true }),
      makeTool({ id: 't3', name: 'Bash', isError: true }),
    ]);
    const score = calcEfficiencyScore(eff, 0.1, 100000, 1000, 5, 4);
    expect(score.score).toBeLessThan(50);
  });
});

// ===== analyzePerformance =====
describe('analyzePerformance', () => {
  it('computes turn latency stats', () => {
    const spans: Span[] = [
      makeTurn({ id: 't1', startTime: 1000, endTime: 2000 }),
      makeTurn({ id: 't2', startTime: 2000, endTime: 3500 }),
      makeTurn({ id: 't3', startTime: 3500, endTime: 4500 }),
    ];
    const result = analyzePerformance(spans);
    expect(result.turnLatency.avg).toBeGreaterThan(0);
    expect(result.turnLatency.max).toBe(1500);
  });

  it('detects slow turns', () => {
    // Create many fast turns so P95 is low, then one very slow turn
    const fastTurns = Array.from({ length: 20 }, (_, i) =>
      makeTurn({ id: `f${i}`, startTime: i * 1000, endTime: i * 1000 + 500 }),
    );
    const slow = makeTurn({ id: 'slow', startTime: 20000, endTime: 81000 }); // 61s > threshold
    const result = analyzePerformance([...fastTurns, slow]);
    expect(result.slowTurns.length).toBe(1);
    expect(result.slowTurns[0].turnId).toBe('slow');
  });

  it('computes throughput', () => {
    const spans: Span[] = [
      makeTurn({ id: 't1', inputTokens: 5000, outputTokens: 1000, startTime: 0, endTime: 60000 }),
      makeTurn({ id: 't2', inputTokens: 3000, outputTokens: 2000, startTime: 60000, endTime: 120000 }),
    ];
    const result = analyzePerformance(spans);
    expect(result.throughput).toBeGreaterThan(0);
    expect(result.sessionDuration).toBe(120000);
  });

  it('computes tool latency by name', () => {
    const spans: Span[] = [
      makeTool({ id: 'bash1', name: 'Bash', startTime: 1000, endTime: 3000 }),
      makeTool({ id: 'bash2', name: 'Bash', startTime: 3000, endTime: 7000 }),
      makeTool({ id: 'read1', name: 'Read', startTime: 7000, endTime: 7500 }),
    ];
    const result = analyzePerformance(spans);
    expect(result.toolLatencyByName.length).toBe(2);
    const bash = result.toolLatencyByName.find((t) => t.name === 'Bash')!;
    expect(bash.count).toBe(2);
    expect(bash.avg).toBe(3000);
  });
});

// ===== analyzeToolParams =====
describe('analyzeToolParams', () => {
  it('classifies Bash commands', () => {
    const spans: Span[] = [
      makeTool({ id: 'b1', name: 'Bash', metadata: { input: JSON.stringify({ command: 'git status' }) } }),
      makeTool({ id: 'b2', name: 'Bash', metadata: { input: JSON.stringify({ command: 'npm install' }) } }),
      makeTool({ id: 'b3', name: 'Bash', metadata: { input: JSON.stringify({ command: 'ls -la' }) } }),
      makeTool({ id: 'b4', name: 'Bash', metadata: { input: JSON.stringify({ command: 'grep -r foo' }) } }),
    ];
    const result = analyzeToolParams(spans);
    expect(result.bashCategories.length).toBe(4);
    expect(result.bashCategories.find((c) => c.category === 'git')).toBeDefined();
    expect(result.bashCategories.find((c) => c.category === 'npm')).toBeDefined();
  });

  it('analyzes Read params', () => {
    const spans: Span[] = [
      makeTool({ id: 'r1', name: 'Read', metadata: { input: JSON.stringify({ file_path: '/a.ts' }) } }),
      makeTool({ id: 'r2', name: 'Read', metadata: { input: JSON.stringify({ file_path: '/b.ts', limit: 50 }) } }),
      makeTool({ id: 'r3', name: 'Read', metadata: { input: JSON.stringify({ file_path: '/c.ts', limit: 100 }) } }),
    ];
    const result = analyzeToolParams(spans);
    expect(result.readParamStats.withLimit).toBe(2);
    expect(result.readParamStats.withoutLimit).toBe(1);
    expect(result.readParamStats.avgLimit).toBe(75);
  });

  it('finds frequent tool pairs', () => {
    const spans: Span[] = [
      makeTool({ id: 'r1', name: 'Read', startTime: 1000 }),
      makeTool({ id: 'e1', name: 'Edit', startTime: 1100 }),
      makeTool({ id: 'r2', name: 'Read', startTime: 1200 }),
      makeTool({ id: 'e2', name: 'Edit', startTime: 1300 }),
    ];
    const result = analyzeToolParams(spans);
    const pair = result.frequentPairs[0];
    expect(pair.pair).toBe('Read → Edit');
    expect(pair.count).toBeGreaterThanOrEqual(1);
  });
});
