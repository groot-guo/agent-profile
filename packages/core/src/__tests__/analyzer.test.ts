import { describe, expect, it } from 'vitest';
import { analyzeSession } from '../analyzer';
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
