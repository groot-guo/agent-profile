import { describe, expect, it } from 'vitest';
import { calcCost } from '../pricing';
import type { Pricing, Span } from '../types';

function makeTurn(overrides: Partial<Span> = {}): Span {
  return {
    id: 'turn-1',
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
    costStatus: 'unknown_pricing',
    isError: false,
    isSidechain: false,
    ...overrides,
  };
}

const DEEPSEEK_FLASH: Pricing = {
  model: 'deepseek-v4-flash',
  inputPrice: 1,
  cacheCreationPrice: 1,
  cacheReadPrice: 0.02,
  outputPrice: 2,
  currency: 'CNY',
  unit: 'per_million_tokens',
};

describe('calcCost', () => {
  it('returns zero cost for non-llm_turn spans', () => {
    const span = makeTurn({ type: 'tool_call' });
    const result = calcCost(span, DEEPSEEK_FLASH);
    expect(result).toEqual({ cost: 0, unknown: false, status: 'not_applicable' });
  });

  it('returns costUnknown when no pricing provided', () => {
    const span = makeTurn({ inputTokens: 1000, outputTokens: 500 });
    const result = calcCost(span, undefined);
    expect(result).toEqual({ cost: 0, unknown: true, status: 'unknown_pricing' });
  });

  it('returns costUnknown for an unsupported pricing scheme', () => {
    const span = makeTurn({ inputTokens: 1_000_000 });
    const result = calcCost(span, {
      ...DEEPSEEK_FLASH,
      pricingScheme: 'long_context_tiered',
      status: 'unsupported',
    });
    expect(result).toEqual({ cost: 0, unknown: true, status: 'unsupported_scheme' });
  });

  it('calculates cost correctly with all four token types', () => {
    const span = makeTurn({
      inputTokens: 1_000_000,
      cacheCreationTokens: 500_000,
      cacheReadTokens: 300_000,
      outputTokens: 200_000,
    });
    const result = calcCost(span, DEEPSEEK_FLASH);
    // input: 1M * 1 = 1
    // cc: 0.5M * 1 = 0.5
    // cr: 0.3M * 0.02 = 0.006
    // output: 0.2M * 2 = 0.4
    // total = 1.906
    expect(result.unknown).toBe(false);
    expect(result.cost).toBeCloseTo(1.906, 5);
  });

  it('handles all-zero tokens', () => {
    const span = makeTurn();
    const result = calcCost(span, DEEPSEEK_FLASH);
    expect(result).toEqual({
      cost: 0,
      unknown: true,
      status: 'token_usage_not_captured',
    });
  });

  it('handles only output tokens', () => {
    const span = makeTurn({ outputTokens: 1_000_000 });
    const result = calcCost(span, DEEPSEEK_FLASH);
    expect(result.cost).toBeCloseTo(2, 5);
  });

  it('handles only input tokens without cache', () => {
    const span = makeTurn({ inputTokens: 1_000_000 });
    const result = calcCost(span, DEEPSEEK_FLASH);
    expect(result.cost).toBeCloseTo(1, 5);
  });

  it('handles cache_read being cheaper than input', () => {
    // same total tokens, but with cache_hit the cost is much lower
    const noCache = makeTurn({ inputTokens: 1_000_000 });
    const withCache = makeTurn({ cacheReadTokens: 1_000_000 });
    const noCacheResult = calcCost(noCache, DEEPSEEK_FLASH);
    const withCacheResult = calcCost(withCache, DEEPSEEK_FLASH);
    expect(noCacheResult.cost).toBeCloseTo(1, 5);
    expect(withCacheResult.cost).toBeCloseTo(0.02, 5);
    expect(withCacheResult.cost).toBeLessThan(noCacheResult.cost);
  });

  it('excludes synthetic placeholder spans from any billable cost', () => {
    const span = makeTurn({ model: '<synthetic>', inputTokens: 1_000_000 });
    const result = calcCost(span, DEEPSEEK_FLASH);
    expect(result).toEqual({
      cost: 0,
      unknown: true,
      status: 'excluded_synthetic',
    });
  });

  it('marks not-captured token usage as non-billable instead of ¥0', () => {
    const stub = makeTurn({
      model: 'gpt-5.6-sol',
      metadata: { tokenUsageSource: 'not_captured', stubTurn: true },
    });
    expect(calcCost(stub, DEEPSEEK_FLASH)).toEqual({
      cost: 0,
      unknown: true,
      status: 'token_usage_not_captured',
    });

    const empty = makeTurn({ model: 'gpt-5.6-sol' });
    expect(calcCost(empty, DEEPSEEK_FLASH)).toEqual({
      cost: 0,
      unknown: true,
      status: 'token_usage_not_captured',
    });
  });

  it('marks unverified provider-managed routes as non-billable pending tariff evidence', () => {
    const span = makeTurn({
      model: 'big-pickle',
      inputTokens: 1_000_000,
      metadata: { tokenUsageSource: 'token_count' },
    });
    const result = calcCost(span, DEEPSEEK_FLASH);
    expect(result).toEqual({
      cost: 0,
      unknown: true,
      status: 'unverified_provider_route',
    });
  });
});
