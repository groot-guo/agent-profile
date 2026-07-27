import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pricing } from '@agent-profile/core';
import { createDatabase, lookupPricing } from './database';

const serverDir = dirname(fileURLToPath(import.meta.url));
export const databasePath = process.env.TRACE_DB_PATH || resolve(serverDir, '..', 'trace.db');
export const db = createDatabase(databasePath);

// Default seed prices are CNY per million tokens. INSERT OR IGNORE preserves
// existing and user-edited rows; effective_from=0 is the earliest known price.
db.exec(`
  INSERT OR IGNORE INTO pricing (model, input_price, cache_creation_price, cache_read_price, output_price, effective_from) VALUES
    -- DeepSeek
    ('deepseek-v4-flash', 1, 1, 0.02, 2, 0),
    ('deepseek-v4-pro', 3, 3, 0.025, 6, 0),
    ('DeepSeek-V4-Flash', 1, 1, 0.02, 2, 0),
    ('deepseek-v4-flash-202605', 1, 1, 0.02, 2, 0),
    ('deepseek-v4-flash-260425', 1, 1, 0.02, 2, 0),
    -- Claude
    ('claude-fable-5', 21, 26.25, 1.5, 105, 0),
    ('claude-opus-4-8', 21, 26.25, 1.5, 105, 0),
    ('claude-sonnet-5', 4.2, 5.25, 0.3, 21, 0),
    ('claude-haiku-4-5-20251001', 1.4, 1.75, 0.1, 7, 0),
    ('claude-3.5-sonnet', 4.2, 5.25, 0.3, 21, 0),
    -- GLM
    ('glm-5.2', 7, 7, 0.05, 14, 0),
    ('glm-5.1', 7, 7, 0.05, 14, 0),
    ('glm-4.7', 7, 7, 0.05, 14, 0),
    ('glm-4.6', 7, 7, 0.05, 14, 0),
    -- Gemini
    ('gemini-2.5-pro', 8.75, 10.5, 0.6, 42, 0),
    ('gemini-2.5-flash', 1.05, 1.4, 0.07, 5.25, 0),
    ('gemini-2.0-flash', 0.7, 0.7, 0.035, 2.8, 0),
    -- GPT
    ('gpt-4o', 17.5, 17.5, 0.875, 70, 0),
    ('gpt-4o-mini', 1.05, 1.05, 0.0525, 4.2, 0),
    -- Other providers
    ('qwen-plus', 2, 2, 0.05, 8, 0),
    ('qwen-max', 5.6, 5.6, 0.14, 14, 0),
    ('moonshot-v1', 8.4, 8.4, 0.42, 8.4, 0),
    ('doubao-pro', 2, 2, 0.1, 8, 0),
    ('mimo-v2.5-pro', 3, 3, 0.025, 6, 0),
    ('mimo-v2.5-pro-ultraspeed', 3, 3, 0.025, 6, 0),
    ('kimi-k3', 2, 2, 0.05, 8, 0),
    ('kimi-k2', 2, 2, 0.05, 8, 0),
    ('openai', 5, 5, 0.25, 15, 0),
    -- Claude Code internal placeholder
    ('<synthetic>', 0, 0, 0, 0, 0)
`);

db.exec(`
  INSERT OR IGNORE INTO model_context (model, context_window) VALUES
    -- Audited 2026-07-27. Vendor specification entry points:
    -- DeepSeek: https://api-docs.deepseek.com/quick_start/pricing
    -- Anthropic: https://docs.anthropic.com/en/docs/about-claude/models
    -- Google: https://ai.google.dev/gemini-api/docs/models
    -- OpenAI: https://platform.openai.com/docs/models
    -- Alibaba Qwen: https://help.aliyun.com/zh/model-studio/models
    ('deepseek-v4-flash', 131072),
    ('deepseek-v4-pro', 131072),
    ('DeepSeek-V4-Flash', 131072),
    ('claude-fable-5', 200000),
    ('claude-opus-4-8', 200000),
    ('claude-sonnet-5', 200000),
    ('claude-haiku-4-5-20251001', 200000),
    ('claude-3.5-sonnet', 200000),
    ('glm-5.2', 131072),
    ('glm-5.1', 131072),
    ('gemini-2.5-pro', 1048576),
    ('gemini-2.5-flash', 1048576),
    ('gemini-2.0-flash', 1048576),
    ('gpt-4o', 128000),
    ('gpt-4o-mini', 128000),
    ('qwen-plus', 131072),
    ('qwen-max', 131072),
    ('moonshot-v1', 131072),
    ('doubao-pro', 131072),
    ('mimo-v2.5-pro', 131072)
`);

export function getPricing(model?: string, at?: number): Pricing | undefined {
  return lookupPricing(db, model, at);
}

export function getModelContext(model?: string): number | undefined {
  if (!model) return undefined;
  const row = db
    .prepare('SELECT context_window as contextWindow FROM model_context WHERE model = ?')
    .get(model) as { contextWindow: number } | undefined;
  return row?.contextWindow;
}

export function closeDb() {
  db.close();
}
