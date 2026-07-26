import type { Pricing, Span } from './types';

export const COST_CURRENCY = 'CNY' as const;
export const COST_UNIT = 'per_million_tokens' as const;
export const COST_CALCULATOR_VERSION = 'v1';

// 按 model + 四类 token + 定价表算 cost（CNY / 1M tokens）
// cache_read 用折扣价，不与 input 混算 —— cost 准确性的核心
export function calcCost(span: Span, pricing?: Pricing): { cost: number; unknown: boolean } {
  // 非 llm_turn（thinking/tool_call/answer）不消耗 LLM token，cost=0
  if (span.type !== 'llm_turn') return { cost: 0, unknown: false };

  // 模型无定价 → 不估算假装有值，标 unknown
  if (!pricing) return { cost: 0, unknown: true };

  const cost =
    (span.inputTokens * pricing.inputPrice +
      span.cacheCreationTokens * pricing.cacheCreationPrice +
      span.cacheReadTokens * pricing.cacheReadPrice +
      span.outputTokens * pricing.outputPrice) /
    1_000_000;

  return { cost, unknown: false };
}
