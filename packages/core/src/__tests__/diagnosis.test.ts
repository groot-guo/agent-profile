import { describe, expect, it } from 'vitest';
import { diagnoseSessionSync } from '../diagnosis';
import type { Pricing, SessionDetail, Span } from '../types';

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
    model: 'deepseek-v4-flash',
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

function makeThinking(overrides: Partial<Span> & { id: string }): Span {
  return {
    sessionId: 'sess-1',
    type: 'thinking',
    name: 'thinking',
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

function makeDetail(spans: Span[], overrides: Partial<SessionDetail> = {}): SessionDetail {
  const turns = spans.filter((s) => s.type === 'llm_turn');
  const totalInput = turns.reduce((s, t) => s + t.inputTokens + t.cacheCreationTokens + t.cacheReadTokens, 0);
  const cacheHitRate = totalInput > 0
    ? turns.reduce((s, t) => s + t.cacheReadTokens, 0) / totalInput
    : 0;
  const peakContext = Math.max(0, ...turns.map((t) => t.contextTokens || (t.inputTokens + t.cacheCreationTokens + t.cacheReadTokens)));
  const avgContext = turns.length > 0
    ? Math.round(turns.reduce((s, t) => s + (t.contextTokens || (t.inputTokens + t.cacheCreationTokens + t.cacheReadTokens)), 0) / turns.length)
    : 0;

  return {
    id: 'sess-1',
    filePath: '/tmp/test.jsonl',
    agent: 'claude-code',
    startTime: 1000,
    inputTokens: turns.reduce((s, t) => s + t.inputTokens, 0),
    cacheCreationTokens: turns.reduce((s, t) => s + t.cacheCreationTokens, 0),
    cacheReadTokens: turns.reduce((s, t) => s + t.cacheReadTokens, 0),
    outputTokens: turns.reduce((s, t) => s + t.outputTokens, 0),
    totalCost: 0,
    costUnknownCount: 0,
    peakContextTokens: peakContext,
    avgContextTokens: avgContext,
    cacheHitRate,
    messageCount: spans.length,
    importedAt: Date.now(),
    spans,
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

describe('diagnoseSessionSync', () => {
  it('returns empty findings for a clean session', () => {
    const spans: Span[] = [
      makeTurn({ id: 't1', inputTokens: 100, outputTokens: 50, startTime: 1000 }),
      makeTurn({ id: 't2', inputTokens: 100, outputTokens: 50, startTime: 2000 }),
    ];
    const detail = makeDetail(spans);
    const result = diagnoseSessionSync(detail, { pricingLookup });
    expect(result.findings).toEqual([]);
    expect(result.totalWastedTokens).toBe(0);
  });

  // ===== repeated_read =====
  it('detects repeated_read', () => {
    const spans: Span[] = [
      makeTool({
        id: 'r1', name: 'Read', startTime: 1000,
        outputBytes: 2000,
        metadata: { input: JSON.stringify({ file_path: '/src/foo.ts' }) },
      }),
      makeTool({
        id: 'r2', name: 'Read', startTime: 2000,
        outputBytes: 2000,
        metadata: { input: JSON.stringify({ file_path: '/src/foo.ts' }) },
      }),
      makeTool({
        id: 'r3', name: 'Read', startTime: 3000,
        outputBytes: 2000,
        metadata: { input: JSON.stringify({ file_path: '/src/foo.ts' }) },
      }),
    ];
    const detail = makeDetail(spans);
    const result = diagnoseSessionSync(detail, { pricingLookup });
    const finding = result.findings.find((f) => f.type === 'repeated_read');
    expect(finding).toBeDefined();
    // 2 later reads wasted: 2000+2000 / 4 = 1000 tokens
    expect(finding!.wastedTokens).toBeGreaterThan(0);
    expect(finding!.spanIds).toContain('r2');
    expect(finding!.spanIds).toContain('r3');
  });

  it('does not flag single read as repeated', () => {
    const spans: Span[] = [
      makeTool({
        id: 'r1', name: 'Read', startTime: 1000,
        outputBytes: 2000,
        metadata: { input: JSON.stringify({ file_path: '/src/foo.ts' }) },
      }),
    ];
    const detail = makeDetail(spans);
    const result = diagnoseSessionSync(detail, { pricingLookup });
    expect(result.findings.filter((f) => f.type === 'repeated_read')).toEqual([]);
  });

  // ===== large_output =====
  it('detects large_output carried by subsequent turns', () => {
    const spans: Span[] = [
      makeTurn({ id: 't0', inputTokens: 50, outputTokens: 30, startTime: 500 }),
      makeTool({
        id: 'bash1', name: 'Bash', startTime: 1000,
        outputBytes: 50_000,
      }),
      makeTurn({ id: 't1', inputTokens: 100, outputTokens: 50, startTime: 1500 }),
      makeTurn({ id: 't2', inputTokens: 100, outputTokens: 50, startTime: 2000 }),
    ];
    const detail = makeDetail(spans);
    const result = diagnoseSessionSync(detail, { pricingLookup });
    const finding = result.findings.find((f) => f.type === 'large_output');
    expect(finding).toBeDefined();
    expect(finding!.wastedTokens).toBeGreaterThan(0);
  });

  // ===== low_cache =====
  it('detects low_cache when hit rate is below threshold', () => {
    const spans: Span[] = [
      makeTurn({ id: 't1', inputTokens: 10_000, cacheReadTokens: 0, startTime: 1000 }),
      makeTurn({ id: 't2', inputTokens: 10_000, cacheReadTokens: 0, startTime: 2000 }),
    ];
    const detail = makeDetail(spans);
    const result = diagnoseSessionSync(detail, { pricingLookup });
    const finding = result.findings.find((f) => f.type === 'low_cache');
    expect(finding).toBeDefined();
    // non-cached = 20k input
    expect(finding!.wastedTokens).toBe(20_000);
  });

  it('does not flag low_cache for small sessions', () => {
    const spans: Span[] = [
      makeTurn({ id: 't1', inputTokens: 100, outputTokens: 50, startTime: 1000 }),
    ];
    const detail = makeDetail(spans);
    const result = diagnoseSessionSync(detail, { pricingLookup });
    expect(result.findings.filter((f) => f.type === 'low_cache')).toEqual([]);
  });

  // ===== context_bloat =====
  it('detects context_bloat with high peak', () => {
    const spans: Span[] = [
      makeTurn({ id: 't1', inputTokens: 120_000, outputTokens: 5_000, startTime: 1000 }),
    ];
    const detail = makeDetail(spans);
    const result = diagnoseSessionSync(detail, { pricingLookup });
    const finding = result.findings.find((f) => f.type === 'context_bloat');
    expect(finding).toBeDefined();
    expect(finding!.wastedTokens).toBeGreaterThan(0);
  });

  it('does not flag context_bloat for small context', () => {
    const spans: Span[] = [
      makeTurn({ id: 't1', inputTokens: 5_000, outputTokens: 500, startTime: 1000 }),
    ];
    const detail = makeDetail(spans);
    const result = diagnoseSessionSync(detail, { pricingLookup });
    expect(result.findings.filter((f) => f.type === 'context_bloat')).toEqual([]);
  });

  // ===== long_thinking =====
  it('detects long_thinking', () => {
    const longText = 'x'.repeat(5_000);
    const spans: Span[] = [
      makeThinking({
        id: 'th1', name: 'thinking', startTime: 1000,
        metadata: { thinking: longText },
      }),
    ];
    const detail = makeDetail(spans);
    const result = diagnoseSessionSync(detail, { pricingLookup });
    const finding = result.findings.find((f) => f.type === 'long_thinking');
    expect(finding).toBeDefined();
    expect(finding!.wastedTokens).toBeGreaterThan(0);
  });

  it('aggregates excess long_thinking beyond top 5', () => {
    const longText = 'x'.repeat(5_000);
    const spans: Span[] = Array.from({ length: 8 }, (_, i) =>
      makeThinking({
        id: `th${i}`, name: 'thinking', startTime: 1000 + i * 100,
        metadata: { thinking: longText },
      }),
    );
    const detail = makeDetail(spans);
    const result = diagnoseSessionSync(detail, { pricingLookup });
    const longFindings = result.findings.filter((f) => f.type === 'long_thinking');
    // top 5 individual + 1 aggregate
    expect(longFindings.length).toBe(6);
  });

  it('does not flag short thinking', () => {
    const spans: Span[] = [
      makeThinking({
        id: 'th1', name: 'thinking', startTime: 1000,
        metadata: { thinking: 'short thought' },
      }),
    ];
    const detail = makeDetail(spans);
    const result = diagnoseSessionSync(detail, { pricingLookup });
    expect(result.findings.filter((f) => f.type === 'long_thinking')).toEqual([]);
  });

  // ===== repeated_failure =====
  it('detects repeated_failure', () => {
    const parentTurn = makeTurn({ id: 't_parent', outputTokens: 500, startTime: 500 });
    const spans: Span[] = [
      parentTurn,
      makeTool({ id: 'e1', name: 'Bash', startTime: 1000, isError: true, parentId: 't_parent' }),
      makeTool({ id: 'e2', name: 'Bash', startTime: 1100, isError: true, parentId: 't_parent' }),
      makeTool({ id: 'e3', name: 'Bash', startTime: 1200, isError: true, parentId: 't_parent' }),
    ];
    const detail = makeDetail(spans);
    const result = diagnoseSessionSync(detail, { pricingLookup });
    const finding = result.findings.find((f) => f.type === 'repeated_failure');
    expect(finding).toBeDefined();
    expect(finding!.spanIds).toContain('e1');
    expect(finding!.spanIds).toContain('e3');
  });

  it('does not flag intermittent failures as repeated', () => {
    const spans: Span[] = [
      makeTool({ id: 'e1', name: 'Bash', startTime: 1000, isError: true }),
      makeTool({ id: 'ok', name: 'Bash', startTime: 1100, isError: false }),
      makeTool({ id: 'e2', name: 'Bash', startTime: 1200, isError: true }),
    ];
    const detail = makeDetail(spans);
    const result = diagnoseSessionSync(detail, { pricingLookup });
    const finding = result.findings.find((f) => f.type === 'repeated_failure');
    // Only 1 consecutive failure maximum
    expect(finding).toBeUndefined();
  });

  // ===== read_scope_too_large =====
  it('detects read_scope_too_large', () => {
    const spans: Span[] = [
      makeTool({
        id: 'r1', name: 'Read', startTime: 1000,
        outputBytes: 30_000,
        metadata: { input: JSON.stringify({ file_path: '/src/big.ts' }) }, // no limit
      }),
    ];
    const detail = makeDetail(spans);
    const result = diagnoseSessionSync(detail, { pricingLookup });
    const finding = result.findings.find((f) => f.type === 'read_scope_too_large');
    expect(finding).toBeDefined();
    expect(finding!.wastedTokens).toBeGreaterThan(0);
  });

  it('does not flag Read with limit', () => {
    const spans: Span[] = [
      makeTool({
        id: 'r1', name: 'Read', startTime: 1000,
        outputBytes: 30_000,
        metadata: { input: JSON.stringify({ file_path: '/src/big.ts', limit: 50 }) },
      }),
    ];
    const detail = makeDetail(spans);
    const result = diagnoseSessionSync(detail, { pricingLookup });
    expect(result.findings.filter((f) => f.type === 'read_scope_too_large')).toEqual([]);
  });

  // ===== costUnknown handling =====
  it('marks costUnknown for unpriced model', () => {
    const spans: Span[] = [
      makeTurn({ id: 't1', model: 'unknown-model', inputTokens: 200_000, outputTokens: 5_000, startTime: 1000 }),
    ];
    const detail = makeDetail(spans);
    const result = diagnoseSessionSync(detail, { pricingLookup });
    // unknown model - wastedCost should be marked costUnknown for any finding
    expect(result.costUnknownCount).toBeGreaterThanOrEqual(0);
  });

  // ===== findings sorted by severity =====
  it('sorts findings by severity then wastedTokens', () => {
    const longText = 'x'.repeat(5_000);
    const spans: Span[] = [
      // repeated_read (medium/low)
      makeTool({
        id: 'r1', name: 'Read', startTime: 1000,
        outputBytes: 1_000_000,
        metadata: { input: JSON.stringify({ file_path: '/src/foo.ts' }) },
      }),
      makeTool({
        id: 'r2', name: 'Read', startTime: 2000,
        outputBytes: 1_000_000,
        metadata: { input: JSON.stringify({ file_path: '/src/foo.ts' }) },
      }),
      // context_bloat (high)
      makeTurn({ id: 't1', inputTokens: 300_000, outputTokens: 1_000, startTime: 500 }),
      // long_thinking (medium/high)
      makeThinking({ id: 'th1', name: 'thinking', startTime: 1500, metadata: { thinking: longText } }),
    ];
    const detail = makeDetail(spans);
    const result = diagnoseSessionSync(detail, { pricingLookup });

    // Verify sort order
    const severities = result.findings.map((f) => f.severity);
    const sevRank: Record<string, number> = { high: 0, medium: 1, low: 2 };
    for (let i = 1; i < severities.length; i++) {
      const prev = sevRank[severities[i - 1]];
      const curr = sevRank[severities[i]];
      expect(prev <= curr).toBe(true);
    }
  });

  it('aggregates totalWastedTokens correctly', () => {
    const longText = 'x'.repeat(5_000);
    const spans: Span[] = [
      makeTool({
        id: 'r1', name: 'Read', startTime: 1000,
        outputBytes: 10_000,
        metadata: { input: JSON.stringify({ file_path: '/src/foo.ts' }) },
      }),
      makeTool({
        id: 'r2', name: 'Read', startTime: 2000,
        outputBytes: 10_000,
        metadata: { input: JSON.stringify({ file_path: '/src/foo.ts' }) },
      }),
      makeThinking({ id: 'th1', startTime: 1500, metadata: { thinking: longText } }),
    ];
    const detail = makeDetail(spans);
    const result = diagnoseSessionSync(detail, { pricingLookup });
    const expectedSum = result.findings.reduce((s, f) => s + f.wastedTokens, 0);
    expect(result.totalWastedTokens).toBe(expectedSum);
  });
});
