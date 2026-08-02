export type ModelIdentityKind = 'model' | 'provider_only' | 'runtime_mode' | 'unknown';

export interface ModelIdentity {
  key: string;
  label: string;
  kind: ModelIdentityKind;
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

export function isRuntimeMode(raw?: string | null): boolean {
  return RUNTIME_MODES.has(raw?.trim().toLowerCase() ?? '');
}

// This is presentation/aggregation identity only. Pricing must use the raw
// source model because an alias alone cannot establish an applicable price.
export function identifyModel(raw?: string | null): ModelIdentity {
  const value = raw?.trim();
  if (!value) return { key: 'unknown', label: '未提供模型', kind: 'unknown' };

  const normalized = value.toLowerCase();
  if (RUNTIME_MODES.has(normalized)) {
    return {
      key: `runtime:${normalized}`,
      label: `${value}（运行模式）`,
      kind: 'runtime_mode',
    };
  }
  const canonical = ALIASES.get(normalized);
  if (canonical || CONCRETE_MODEL_IDS.has(normalized)) {
    const model = canonical ?? normalized;
    return { key: `model:${model}`, label: model, kind: 'model' };
  }
  if (PROVIDER_ONLY.has(normalized)) {
    return {
      key: `provider:${normalized}`,
      label: `${value}（未提供具体模型）`,
      kind: 'provider_only',
    };
  }
  return { key: `unknown:${normalized}`, label: value, kind: 'unknown' };
}
