import type { Pricing } from '@agent-profile/core';
import Database from 'better-sqlite3';

export const db = new Database('trace.db');

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id                    TEXT PRIMARY KEY,
    name                  TEXT,
    file_path             TEXT NOT NULL,
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

// 默认定价种子（人民币元/百万 token，官方定价；effective_from=0 表示最早，INSERT OR IGNORE 不覆盖用户手改）
db.exec(`
  INSERT OR IGNORE INTO pricing (model, input_price, cache_creation_price, cache_read_price, output_price, effective_from) VALUES
    ('deepseek-v4-flash', 1, 1, 0.02, 2, 0),
    ('deepseek-v4-pro', 3, 3, 0.025, 6, 0),
    ('DeepSeek-V4-Flash', 1, 1, 0.02, 2, 0),
    ('deepseek-v4-flash-202605', 1, 1, 0.02, 2, 0),
    ('deepseek-v4-flash-260425', 1, 1, 0.02, 2, 0)
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
