import type { DatabaseConnection } from '../database';

// Bundled reference data is kept outside Runtime composition so the Model
// Catalog owns its seed policy. INSERT OR IGNORE preserves local edits.
export function seedPricingDefaults(database: DatabaseConnection): void {
  database.exec(`
  INSERT OR IGNORE INTO pricing (
    model, input_price, cache_creation_price, cache_read_price, output_price,
    source_kind, source_reference, pricing_scheme, status, revision, created_at, effective_from
  ) VALUES
    -- DeepSeek
    ('deepseek-v4-flash', 1, 1, 0.02, 2, 'bundled', 'https://api-docs.deepseek.com/quick_start/pricing', 'flat_four_token_classes', 'active', 1, 0, 0),
    ('deepseek-v4-pro', 3, 3, 0.025, 6, 'bundled', 'https://api-docs.deepseek.com/quick_start/pricing', 'flat_four_token_classes', 'active', 1, 0, 0),
    ('DeepSeek-V4-Flash', 1, 1, 0.02, 2, 'bundled', 'https://api-docs.deepseek.com/quick_start/pricing', 'flat_four_token_classes', 'active', 1, 0, 0),
    ('deepseek-v4-flash-202605', 1, 1, 0.02, 2, 'bundled', 'https://api-docs.deepseek.com/quick_start/pricing', 'flat_four_token_classes', 'active', 1, 0, 0),
    ('deepseek-v4-flash-260425', 1, 1, 0.02, 2, 'bundled', 'https://api-docs.deepseek.com/quick_start/pricing', 'flat_four_token_classes', 'active', 1, 0, 0),
    -- Claude
    ('claude-fable-5', 21, 26.25, 1.5, 105, 'bundled', 'https://docs.anthropic.com/en/docs/about-claude/models', 'flat_four_token_classes', 'active', 1, 0, 0),
    ('claude-opus-4-8', 21, 26.25, 1.5, 105, 'bundled', 'https://docs.anthropic.com/en/docs/about-claude/models', 'flat_four_token_classes', 'active', 1, 0, 0),
    ('claude-sonnet-5', 4.2, 5.25, 0.3, 21, 'bundled', 'https://docs.anthropic.com/en/docs/about-claude/models', 'flat_four_token_classes', 'active', 1, 0, 0),
    ('claude-haiku-4-5-20251001', 1.4, 1.75, 0.1, 7, 'bundled', 'https://docs.anthropic.com/en/docs/about-claude/models', 'flat_four_token_classes', 'active', 1, 0, 0),
    ('claude-3.5-sonnet', 4.2, 5.25, 0.3, 21, 'bundled', 'https://docs.anthropic.com/en/docs/about-claude/models', 'flat_four_token_classes', 'active', 1, 0, 0),
    -- GLM
    ('glm-5.2', 7, 7, 0.05, 14, 'bundled', 'https://open.bigmodel.cn/dev/howuse/model', 'flat_four_token_classes', 'active', 1, 0, 0),
    ('glm-5.1', 7, 7, 0.05, 14, 'bundled', 'https://open.bigmodel.cn/dev/howuse/model', 'flat_four_token_classes', 'active', 1, 0, 0),
    ('glm-4.7', 7, 7, 0.05, 14, 'bundled', 'https://open.bigmodel.cn/dev/howuse/model', 'flat_four_token_classes', 'active', 1, 0, 0),
    ('glm-4.6', 7, 7, 0.05, 14, 'bundled', 'https://open.bigmodel.cn/dev/howuse/model', 'flat_four_token_classes', 'active', 1, 0, 0),
    -- Gemini
    ('gemini-2.5-pro', 8.75, 10.5, 0.6, 42, 'bundled', 'https://ai.google.dev/gemini-api/docs/models', 'flat_four_token_classes', 'active', 1, 0, 0),
    ('gemini-2.5-flash', 1.05, 1.4, 0.07, 5.25, 'bundled', 'https://ai.google.dev/gemini-api/docs/models', 'flat_four_token_classes', 'active', 1, 0, 0),
    ('gemini-2.0-flash', 0.7, 0.7, 0.035, 2.8, 'bundled', 'https://ai.google.dev/gemini-api/docs/models', 'flat_four_token_classes', 'active', 1, 0, 0),
    -- GPT
    ('gpt-4o', 17.5, 17.5, 0.875, 70, 'bundled', 'https://platform.openai.com/docs/models', 'flat_four_token_classes', 'active', 1, 0, 0),
    ('gpt-4o-mini', 1.05, 1.05, 0.0525, 4.2, 'bundled', 'https://platform.openai.com/docs/models', 'flat_four_token_classes', 'active', 1, 0, 0),
    -- Other providers
    ('qwen-plus', 2, 2, 0.05, 8, 'bundled', 'https://help.aliyun.com/zh/model-studio/models', 'flat_four_token_classes', 'active', 1, 0, 0),
    ('qwen-max', 5.6, 5.6, 0.14, 14, 'bundled', 'https://help.aliyun.com/zh/model-studio/models', 'flat_four_token_classes', 'active', 1, 0, 0),
    ('moonshot-v1', 8.4, 8.4, 0.42, 8.4, 'bundled', 'https://platform.moonshot.cn/docs/intro', 'flat_four_token_classes', 'active', 1, 0, 0),
    ('doubao-pro', 2, 2, 0.1, 8, 'bundled', 'https://www.volcengine.com/docs/82379/1099320', 'flat_four_token_classes', 'active', 1, 0, 0),
    ('mimo-v2.5-pro', 3, 3, 0.025, 6, 'bundled', 'https://platform.xiaomimimo.com/#/docs', 'flat_four_token_classes', 'active', 1, 0, 0),
    ('mimo-v2.5-pro-ultraspeed', 3, 3, 0.025, 6, 'bundled', 'https://platform.xiaomimimo.com/#/docs', 'flat_four_token_classes', 'active', 1, 0, 0),
    ('kimi-k3', 2, 2, 0.05, 8, 'bundled', 'https://platform.moonshot.cn/docs/intro', 'flat_four_token_classes', 'active', 1, 0, 0),
    ('kimi-k2', 2, 2, 0.05, 8, 'bundled', 'https://platform.moonshot.cn/docs/intro', 'flat_four_token_classes', 'active', 1, 0, 0),
    ('openai', 5, 5, 0.25, 15, 'bundled', 'https://platform.openai.com/docs/models', 'flat_four_token_classes', 'active', 1, 0, 0),
    ('<synthetic>', 0, 0, 0, 0, 'bundled', 'internal:synthetic-fixture', 'flat_four_token_classes', 'active', 1, 0, 0)
  `);
  database
    .prepare(
      `UPDATE pricing SET effective_from = 0
       WHERE source_kind = 'bundled' AND effective_from IS NULL`,
    )
    .run();
  database.exec(`
    INSERT OR IGNORE INTO pricing_history (
      id, model, input_price, cache_creation_price, cache_read_price,
      output_price, currency, unit, effective_from, source_kind,
      source_reference, pricing_scheme, revision, status, created_at
    )
    SELECT lower(hex(randomblob(16))), model, input_price, cache_creation_price,
      cache_read_price, output_price, currency, unit, COALESCE(effective_from, 0),
      source_kind, source_reference, pricing_scheme, revision, status, created_at
    FROM pricing
  `);
}

export function seedModelContextDefaults(database: DatabaseConnection): void {
  database.exec(`
  INSERT OR IGNORE INTO model_context (
    model, context_window, source_kind, source_reference, audited_at, revision, user_override
  ) VALUES
    ('deepseek-v4-flash', 131072, 'bundled', 'https://api-docs.deepseek.com/quick_start/pricing', 20260727, 1, 0),
    ('deepseek-v4-pro', 131072, 'bundled', 'https://api-docs.deepseek.com/quick_start/pricing', 20260727, 1, 0),
    ('DeepSeek-V4-Flash', 131072, 'bundled', 'https://api-docs.deepseek.com/quick_start/pricing', 20260727, 1, 0),
    ('claude-fable-5', 200000, 'bundled', 'https://docs.anthropic.com/en/docs/about-claude/models', 20260727, 1, 0),
    ('claude-opus-4-8', 200000, 'bundled', 'https://docs.anthropic.com/en/docs/about-claude/models', 20260727, 1, 0),
    ('claude-sonnet-5', 200000, 'bundled', 'https://docs.anthropic.com/en/docs/about-claude/models', 20260727, 1, 0),
    ('claude-haiku-4-5-20251001', 200000, 'bundled', 'https://docs.anthropic.com/en/docs/about-claude/models', 20260727, 1, 0),
    ('claude-3.5-sonnet', 200000, 'bundled', 'https://docs.anthropic.com/en/docs/about-claude/models', 20260727, 1, 0),
    ('glm-5.2', 131072, 'bundled', 'https://open.bigmodel.cn/dev/howuse/model', 20260727, 1, 0),
    ('glm-5.1', 131072, 'bundled', 'https://open.bigmodel.cn/dev/howuse/model', 20260727, 1, 0),
    ('gemini-2.5-pro', 1048576, 'bundled', 'https://ai.google.dev/gemini-api/docs/models', 20260727, 1, 0),
    ('gemini-2.5-flash', 1048576, 'bundled', 'https://ai.google.dev/gemini-api/docs/models', 20260727, 1, 0),
    ('gemini-2.0-flash', 1048576, 'bundled', 'https://ai.google.dev/gemini-api/docs/models', 20260727, 1, 0),
    ('gpt-4o', 128000, 'bundled', 'https://platform.openai.com/docs/models', 20260727, 1, 0),
    ('gpt-4o-mini', 128000, 'bundled', 'https://platform.openai.com/docs/models', 20260727, 1, 0),
    ('qwen-plus', 131072, 'bundled', 'https://help.aliyun.com/zh/model-studio/models', 20260727, 1, 0),
    ('qwen-max', 131072, 'bundled', 'https://help.aliyun.com/zh/model-studio/models', 20260727, 1, 0),
    ('moonshot-v1', 131072, 'bundled', 'https://platform.moonshot.cn/docs/intro', 20260727, 1, 0),
    ('doubao-pro', 131072, 'bundled', 'https://www.volcengine.com/docs/82379/1099320', 20260727, 1, 0),
    ('mimo-v2.5-pro', 131072, 'bundled', 'https://platform.xiaomimimo.com/#/docs', 20260727, 1, 0)
  `);
}
