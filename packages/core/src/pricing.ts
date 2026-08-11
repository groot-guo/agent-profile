import { identifyModel } from './model-identity';
import type { CostStatus, Pricing, Span } from './types';

export const COST_CURRENCY = 'CNY' as const;
export const COST_UNIT = 'per_million_tokens' as const;
export const COST_CALCULATOR_VERSION = 'v1';

// 按 model + 四类 token + 定价表算 cost（CNY / 1M tokens）
// cache_read 用折扣价，不与 input 混算 —— cost 准确性的核心
export function calcCost(
  span: Span,
  pricing?: Pricing,
): { cost: number; unknown: boolean; status: CostStatus } {
  // 非 llm_turn（thinking/tool_call/answer）不消耗 LLM token，cost=0
  if (span.type !== 'llm_turn') {
    return { cost: 0, unknown: false, status: 'not_applicable' };
  }

  // 合成占位数据永不视为免费账单。
  if (identifyModel(span.model).kind === 'synthetic') {
    return { cost: 0, unknown: true, status: 'excluded_synthetic' };
  }

  // 源没有捕获 token 用量 → not_captured，绝不渲染为 ¥0。
  const tokenSource = span.metadata?.tokenUsageSource;
  if (
    tokenSource === 'not_captured' ||
    (tokenSource === undefined &&
      span.inputTokens === 0 &&
      span.cacheCreationTokens === 0 &&
      span.cacheReadTokens === 0 &&
      span.outputTokens === 0)
  ) {
    return { cost: 0, unknown: true, status: 'token_usage_not_captured' };
  }

  // 未验证的供应商托管路由（如 big-pickle）在没有显式 tariff 前不可计费。
  if (identifyModel(span.model).kind === 'review_required') {
    return { cost: 0, unknown: true, status: 'unverified_provider_route' };
  }

  // 模型无定价 → unknown_pricing，绝不估算假装有值。
  if (!pricing) {
    return { cost: 0, unknown: true, status: 'unknown_pricing' };
  }

  // 定价结构不受支持或非 active → unsupported_scheme。
  if (
    (pricing.status !== undefined && pricing.status !== 'active') ||
    (pricing.pricingScheme !== undefined && pricing.pricingScheme !== 'flat_four_token_classes')
  ) {
    return { cost: 0, unknown: true, status: 'unsupported_scheme' };
  }

  const cost =
    (span.inputTokens * pricing.inputPrice +
      span.cacheCreationTokens * pricing.cacheCreationPrice +
      span.cacheReadTokens * pricing.cacheReadPrice +
      span.outputTokens * pricing.outputPrice) /
    1_000_000;

  return { cost, unknown: false, status: 'known' };
}
