export type ModelIdentityKind = 'model' | 'provider_only' | 'unknown';

export interface ModelIdentity {
  key: string;
  label: string;
  kind: ModelIdentityKind;
}

const ALIASES = new Map<string, string>([
  ['codex-auto-review', 'codex-auto-review'],
  ['deepseek-v4-flash', 'deepseek-v4-flash'],
  ['deepseek-v4-pro', 'deepseek-v4-pro'],
  ['deepseek-ai/deepseek-v4-pro', 'deepseek-v4-pro'],
  ['gpt-5.6-luna', 'gpt-5.6-luna'],
  ['gpt-5.6-sol', 'gpt-5.6-sol'],
  ['gpt-5.6-terra', 'gpt-5.6-terra'],
  ['glm-5-2', 'glm-5.2'],
  ['glm-5-1', 'glm-5.1'],
]);

const PROVIDER_ONLY = new Set(['litellm', 'openai']);

// This is presentation/aggregation identity only. Pricing must use the raw
// source model because an alias alone cannot establish an applicable price.
export function identifyModel(raw?: string | null): ModelIdentity {
  const value = raw?.trim();
  if (!value) return { key: 'unknown', label: '未提供模型', kind: 'unknown' };

  const normalized = value.toLowerCase();
  const canonical = ALIASES.get(normalized);
  if (canonical) return { key: `model:${canonical}`, label: canonical, kind: 'model' };
  if (PROVIDER_ONLY.has(normalized)) {
    return {
      key: `provider:${normalized}`,
      label: `${value}（未提供具体模型）`,
      kind: 'provider_only',
    };
  }
  return { key: `unknown:${normalized}`, label: value, kind: 'unknown' };
}
