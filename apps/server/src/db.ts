import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pricing } from '@agent-profile/core';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const db = new Database(resolve(__dirname, '..', 'trace.db'));

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id                    TEXT PRIMARY KEY,
    name                  TEXT,
    file_path             TEXT NOT NULL,
    agent                 TEXT NOT NULL DEFAULT 'unknown',
    file_mtime            INTEGER,
    file_size             INTEGER,
    file_lines            INTEGER,
    start_time            INTEGER NOT NULL,
    end_time              INTEGER,
    cwd                   TEXT,
    git_branch            TEXT,
    claude_version        TEXT,
    input_tokens          INTEGER DEFAULT 0,
    cache_creation_tokens INTEGER DEFAULT 0,
    cache_read_tokens     INTEGER DEFAULT 0,
    output_tokens         INTEGER DEFAULT 0,
    total_cost            REAL DEFAULT 0,
    cost_unknown_count    INTEGER DEFAULT 0,
    peak_context_tokens   INTEGER DEFAULT 0,
    avg_context_tokens    INTEGER DEFAULT 0,
    cache_hit_rate        REAL DEFAULT 0,
    message_count         INTEGER DEFAULT 0,
    tags                  TEXT DEFAULT '',
    notes                 TEXT DEFAULT '',
    imported_at           INTEGER NOT NULL DEFAULT (unixepoch()*1000)
  );

  CREATE TABLE IF NOT EXISTS spans (
    id                     TEXT PRIMARY KEY,
    session_id             TEXT NOT NULL,
    parent_id              TEXT,
    type                   TEXT NOT NULL,
    name                   TEXT NOT NULL,
    start_time             INTEGER NOT NULL,
    end_time               INTEGER,
    input_tokens           INTEGER DEFAULT 0,
    cache_creation_tokens  INTEGER DEFAULT 0,
    cache_read_tokens      INTEGER DEFAULT 0,
    output_tokens          INTEGER DEFAULT 0,
    context_tokens         INTEGER DEFAULT 0,
    output_bytes           INTEGER DEFAULT 0,
    model                  TEXT,
    cost                   REAL DEFAULT 0,
    cost_unknown           INTEGER DEFAULT 0,
    stop_reason            TEXT,
    is_error               INTEGER DEFAULT 0,
    is_sidechain           INTEGER DEFAULT 0,
    metadata               TEXT,
    created_at             INTEGER NOT NULL DEFAULT (unixepoch()*1000),
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  );

  CREATE INDEX IF NOT EXISTS idx_spans_session ON spans(session_id);
  CREATE INDEX IF NOT EXISTS idx_spans_parent ON spans(parent_id);

  CREATE TABLE IF NOT EXISTS pricing (
    model                  TEXT NOT NULL,
    input_price            REAL NOT NULL,
    cache_creation_price   REAL NOT NULL,
    cache_read_price       REAL NOT NULL,
    output_price           REAL NOT NULL,
    effective_from        INTEGER,
    PRIMARY KEY (model, effective_from)
  );

  CREATE TABLE IF NOT EXISTS model_context (
    model                  TEXT PRIMARY KEY,
    context_window         INTEGER NOT NULL
  );
`);

// Existing databases predate session annotations. Run this after CREATE TABLE so
// a brand-new database and an upgraded database have the same schema.
for (const col of ['tags', 'notes']) {
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN ${col} TEXT DEFAULT ''`);
  } catch {
    /* column already exists */
  }
}

// 默认定价种子（人民币元/百万 token，官方定价；effective_from=0 表示最早，INSERT OR IGNORE 不覆盖用户手改）
db.exec(`
  INSERT OR IGNORE INTO pricing (model, input_price, cache_creation_price, cache_read_price, output_price, effective_from) VALUES
    -- DeepSeek 系列
    ('deepseek-v4-flash', 1, 1, 0.02, 2, 0),
    ('deepseek-v4-pro', 3, 3, 0.025, 6, 0),
    ('DeepSeek-V4-Flash', 1, 1, 0.02, 2, 0),
    ('deepseek-v4-flash-202605', 1, 1, 0.02, 2, 0),
    ('deepseek-v4-flash-260425', 1, 1, 0.02, 2, 0),
    -- Claude 系列
    ('claude-fable-5', 21, 26.25, 1.5, 105, 0),
    ('claude-opus-4-8', 21, 26.25, 1.5, 105, 0),
    ('claude-sonnet-5', 4.2, 5.25, 0.3, 21, 0),
    ('claude-haiku-4-5-20251001', 1.4, 1.75, 0.1, 7, 0),
    ('claude-3.5-sonnet', 4.2, 5.25, 0.3, 21, 0),
    -- GLM 系列
    ('glm-5.2', 7, 7, 0.05, 14, 0),
    ('glm-5.1', 7, 7, 0.05, 14, 0),
    ('glm-4.7', 7, 7, 0.05, 14, 0),
    ('glm-4.6', 7, 7, 0.05, 14, 0),
    -- Gemini 系列
    ('gemini-2.5-pro', 8.75, 10.5, 0.6, 42, 0),
    ('gemini-2.5-flash', 1.05, 1.4, 0.07, 5.25, 0),
    ('gemini-2.0-flash', 0.7, 0.7, 0.035, 2.8, 0),
    -- GPT 系列
    ('gpt-4o', 17.5, 17.5, 0.875, 70, 0),
    ('gpt-4o-mini', 1.05, 1.05, 0.0525, 4.2, 0),
    -- 国产模型
    ('qwen-plus', 2, 2, 0.05, 8, 0),
    ('qwen-max', 5.6, 5.6, 0.14, 14, 0),
    ('moonshot-v1', 8.4, 8.4, 0.42, 8.4, 0),
    ('doubao-pro', 2, 2, 0.1, 8, 0),
    -- MiMo 系列
    ('mimo-v2.5-pro', 3, 3, 0.025, 6, 0),
    ('mimo-v2.5-pro-ultraspeed', 3, 3, 0.025, 6, 0),
    -- Kimi 系列
    ('kimi-k3', 2, 2, 0.05, 8, 0),
    ('kimi-k2', 2, 2, 0.05, 8, 0),
    -- OpenAI 系列
    ('openai', 5, 5, 0.25, 15, 0),
    -- 内部标记模型（synthetic 为 Claude Code 内部占位，cost=0）
    ('<synthetic>', 0, 0, 0, 0, 0)
`);

// 模型上下文窗口种子
db.exec(`
  INSERT OR IGNORE INTO model_context (model, context_window) VALUES
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
    ('qwen-max', 32768),
    ('moonshot-v1', 131072),
    ('doubao-pro', 131072),
    ('mimo-v2.5-pro', 131072)
`);

export function getPricing(model?: string): Pricing | undefined {
  if (!model) return undefined;
  const row = db
    .prepare(
      `SELECT model, input_price as inputPrice, cache_creation_price as cacheCreationPrice,
              cache_read_price as cacheReadPrice, output_price as outputPrice, effective_from as effectiveFrom
       FROM pricing
       WHERE model = ? AND (effective_from IS NULL OR effective_from <= ?)
       ORDER BY effective_from DESC LIMIT 1`,
    )
    .get(model, Date.now()) as Pricing | undefined;
  return row;
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
