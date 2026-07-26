import type { Pricing } from '@agent-profile/core';
import Database from 'better-sqlite3';

export type DatabaseConnection = InstanceType<typeof Database>;

interface Migration {
  version: number;
  name: string;
  up: (database: DatabaseConnection) => void;
}

function tableColumns(database: DatabaseConnection, table: string): Set<string> {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(rows.map((row) => row.name));
}

function addColumn(
  database: DatabaseConnection,
  table: string,
  column: string,
  definition: string,
): void {
  if (tableColumns(database, table).has(column)) return;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'session_annotations',
    up(database) {
      addColumn(database, 'sessions', 'tags', "TEXT DEFAULT ''");
      addColumn(database, 'sessions', 'notes', "TEXT DEFAULT ''");
    },
  },
  {
    version: 2,
    name: 'cost_provenance',
    up(database) {
      addColumn(database, 'pricing', 'currency', "TEXT NOT NULL DEFAULT 'CNY'");
      addColumn(database, 'pricing', 'unit', "TEXT NOT NULL DEFAULT 'per_million_tokens'");

      addColumn(database, 'sessions', 'cost_currency', "TEXT NOT NULL DEFAULT 'CNY'");
      addColumn(database, 'sessions', 'cost_calculated_at', 'INTEGER');
      addColumn(database, 'sessions', 'cost_calculator_version', "TEXT NOT NULL DEFAULT 'legacy'");

      addColumn(database, 'spans', 'cost_currency', "TEXT NOT NULL DEFAULT 'CNY'");
      addColumn(database, 'spans', 'pricing_effective_from', 'INTEGER');
      addColumn(database, 'spans', 'cost_calculated_at', 'INTEGER');
      addColumn(database, 'spans', 'cost_calculator_version', "TEXT NOT NULL DEFAULT 'legacy'");
    },
  },
];

function createBaseSchema(database: DatabaseConnection): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id                      TEXT PRIMARY KEY,
      name                    TEXT,
      file_path               TEXT NOT NULL,
      agent                   TEXT NOT NULL DEFAULT 'unknown',
      file_mtime              INTEGER,
      file_size               INTEGER,
      file_lines              INTEGER,
      start_time              INTEGER NOT NULL,
      end_time                INTEGER,
      cwd                     TEXT,
      git_branch              TEXT,
      claude_version          TEXT,
      input_tokens            INTEGER DEFAULT 0,
      cache_creation_tokens   INTEGER DEFAULT 0,
      cache_read_tokens       INTEGER DEFAULT 0,
      output_tokens           INTEGER DEFAULT 0,
      total_cost              REAL DEFAULT 0,
      cost_unknown_count      INTEGER DEFAULT 0,
      cost_currency           TEXT NOT NULL DEFAULT 'CNY',
      cost_calculated_at      INTEGER,
      cost_calculator_version TEXT NOT NULL DEFAULT 'legacy',
      peak_context_tokens     INTEGER DEFAULT 0,
      avg_context_tokens      INTEGER DEFAULT 0,
      cache_hit_rate          REAL DEFAULT 0,
      message_count           INTEGER DEFAULT 0,
      tags                    TEXT DEFAULT '',
      notes                   TEXT DEFAULT '',
      imported_at             INTEGER NOT NULL DEFAULT (unixepoch()*1000)
    );

    CREATE TABLE IF NOT EXISTS spans (
      id                      TEXT PRIMARY KEY,
      session_id              TEXT NOT NULL,
      parent_id               TEXT,
      type                    TEXT NOT NULL,
      name                    TEXT NOT NULL,
      start_time              INTEGER NOT NULL,
      end_time                INTEGER,
      input_tokens            INTEGER DEFAULT 0,
      cache_creation_tokens   INTEGER DEFAULT 0,
      cache_read_tokens       INTEGER DEFAULT 0,
      output_tokens           INTEGER DEFAULT 0,
      context_tokens          INTEGER DEFAULT 0,
      output_bytes            INTEGER DEFAULT 0,
      model                   TEXT,
      cost                    REAL DEFAULT 0,
      cost_unknown            INTEGER DEFAULT 0,
      cost_currency           TEXT NOT NULL DEFAULT 'CNY',
      pricing_effective_from  INTEGER,
      cost_calculated_at      INTEGER,
      cost_calculator_version TEXT NOT NULL DEFAULT 'legacy',
      stop_reason             TEXT,
      is_error                INTEGER DEFAULT 0,
      is_sidechain            INTEGER DEFAULT 0,
      metadata                TEXT,
      created_at              INTEGER NOT NULL DEFAULT (unixepoch()*1000),
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
      currency               TEXT NOT NULL DEFAULT 'CNY',
      unit                   TEXT NOT NULL DEFAULT 'per_million_tokens',
      effective_from        INTEGER,
      PRIMARY KEY (model, effective_from)
    );

    CREATE TABLE IF NOT EXISTS model_context (
      model                  TEXT PRIMARY KEY,
      context_window         INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schema_migrations (
      version                INTEGER PRIMARY KEY,
      name                   TEXT NOT NULL,
      applied_at             INTEGER NOT NULL
    );
  `);
}

export function applyMigrations(database: DatabaseConnection): void {
  createBaseSchema(database);
  const applied = new Set(
    (
      database.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as {
        version: number;
      }[]
    ).map((row) => row.version),
  );
  const insertMigration = database.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    database.transaction(() => {
      migration.up(database);
      insertMigration.run(migration.version, migration.name, Date.now());
    })();
  }
}

export function createDatabase(filePath: string): DatabaseConnection {
  const database = new Database(filePath);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  applyMigrations(database);
  return database;
}

export function lookupPricing(
  database: DatabaseConnection,
  model?: string,
  at = Date.now(),
): Pricing | undefined {
  if (!model) return undefined;
  return database
    .prepare(
      `SELECT model, input_price as inputPrice, cache_creation_price as cacheCreationPrice,
              cache_read_price as cacheReadPrice, output_price as outputPrice,
              currency, unit, COALESCE(effective_from, 0) as effectiveFrom
       FROM pricing
       WHERE model = ? AND COALESCE(effective_from, 0) <= ?
       ORDER BY COALESCE(effective_from, 0) DESC LIMIT 1`,
    )
    .get(model, at) as Pricing | undefined;
}
