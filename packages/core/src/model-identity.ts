export type ModelIdentityKind =
  | 'model'
  | 'provider_only'
  | 'runtime_mode'
  | 'synthetic'
  | 'opaque'
  | 'review_required'
  | 'unknown';

export type BillingEligibility = 'billable' | 'review_required' | 'excluded';

export interface ModelIdentity {
  key: string;
  label: string;
  kind: ModelIdentityKind;
  billingEligibility: BillingEligibility;
}

const ALIASES = new Map<string, string>([
  ['deepseek-v4-flash', 'deepseek-v4-flash'],
  ['deepseek-v4-pro', 'deepseek-v4-pro'],
  ['deepseek-ai/deepseek-v4-pro', 'deepseek-v4-pro'],
  ['gpt-5.6-luna', 'gpt-5.6-luna'],
  ['gpt-5.6-sol', 'gpt-5.6-sol'],
  ['gpt-5.6-terra', 'gpt-5.6-terra'],
  ['glm-5-2', 'glm-5.2'],
  ['glm-5-1', 'glm-5.1'],
]);

const CONCRETE_MODEL_IDS = new Set([
  'claude-3.5-sonnet',
  'claude-fable-5',
  'claude-haiku-4-5-20251001',
  'claude-opus-4-8',
  'claude-sonnet-5',
  'deepseek-v4-flash-202605',
  'deepseek-v4-flash-260425',
  'doubao-pro',
  'gemini-2.0-flash',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'glm-4.6',
  'glm-4.7',
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-5.6-luna',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'kimi-k2',
  'kimi-k3',
  'mimo-v2.5-pro',
  'mimo-v2.5-pro-ultraspeed',
  'moonshot-v1',
  'qwen-max',
  'qwen-plus',
]);

const PROVIDER_ONLY = new Set(['litellm', 'openai']);
const RUNTIME_MODES = new Set(['codex-auto-review']);
const SYNTHETIC_LABELS = new Set(['<synthetic>']);
const OPAQUE_LABELS = new Set(['astron-code-latest']);
const REVIEW_REQUIRED_LABELS = new Set(['big-pickle']);

export function isRuntimeMode(raw?: string | null): boolean {
  return RUNTIME_MODES.has(raw?.trim().toLowerCase() ?? '');
}

/**
 * True when an observed raw label must be excluded from model statistics and
 * Model Catalog inventory (runtime modes, synthetic placeholders, opaque
 * rolling labels, and unverified provider-managed routes). Exclusion is a
 * presentation decision; the raw Span label is never deleted.
 */
export function isExcludedModel(raw?: string | null): boolean {
  return identifyModel(raw).billingEligibility === 'excluded';
}

// This is presentation/aggregation identity only. Pricing must use the raw
// source model because an alias alone cannot establish an applicable price.
export function identifyModel(raw?: string | null): ModelIdentity {
  const value = raw?.trim();
  if (!value) {
    return {
      key: 'unknown',
      label: '未提供模型',
      kind: 'unknown',
      billingEligibility: 'excluded',
    };
  }

  const normalized = value.toLowerCase();
  if (RUNTIME_MODES.has(normalized)) {
    return {
      key: `runtime:${normalized}`,
      label: `${value}（运行模式）`,
      kind: 'runtime_mode',
      billingEligibility: 'excluded',
    };
  }
  if (SYNTHETIC_LABELS.has(normalized)) {
    return {
      key: `synthetic:${normalized}`,
      label: `${value}（合成占位）`,
      kind: 'synthetic',
      billingEligibility: 'excluded',
    };
  }
  if (OPAQUE_LABELS.has(normalized)) {
    return {
      key: `opaque:${normalized}`,
      label: `${value}（滚动标签，待核验）`,
      kind: 'opaque',
      billingEligibility: 'excluded',
    };
  }
  if (REVIEW_REQUIRED_LABELS.has(normalized)) {
    return {
      key: `review:${normalized}`,
      label: `${value}（供应商托管路由，待核验）`,
      kind: 'review_required',
      billingEligibility: 'excluded',
    };
  }
  const canonical = ALIASES.get(normalized);
  if (canonical || CONCRETE_MODEL_IDS.has(normalized)) {
    const model = canonical ?? normalized;
    return {
      key: `model:${model}`,
      label: model,
      kind: 'model',
      billingEligibility: 'billable',
    };
  }
  if (PROVIDER_ONLY.has(normalized)) {
    return {
      key: `provider:${normalized}`,
      label: `${value}（未提供具体模型）`,
      kind: 'provider_only',
      billingEligibility: 'excluded',
    };
  }
  return {
    key: `unknown:${normalized}`,
    label: value,
    kind: 'unknown',
    billingEligibility: 'review_required',
  };
}
