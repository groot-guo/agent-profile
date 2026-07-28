import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { applyMigrations, createDatabase, lookupPricing } from '../database';

// Pre-migration baseline: every base-schema column that is NOT added by a
// migration. Keeping this in sync with `createBaseSchema` is enforced by the
// `keeps fresh schema and migrated legacy schema in sync` test below — adding a
// column to `createBaseSchema` without a matching migration (or vice versa)
// makes that test fail.
function createLegacyDatabase() {
  const database = new Database(':memory:');
  database.exec(`
    CREATE TABLE sessions (
      id                      TEXT PRIMARY KEY,
      name                    TEXT,
      file_path               TEXT NOT NULL,
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
      peak_context_tokens     INTEGER DEFAULT 0,
      avg_context_tokens      INTEGER DEFAULT 0,
      cache_hit_rate          REAL DEFAULT 0,
      message_count           INTEGER DEFAULT 0,
      imported_at             INTEGER NOT NULL DEFAULT (unixepoch()*1000)
    );
    CREATE TABLE spans (
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
      stop_reason             TEXT,
      is_error                INTEGER DEFAULT 0,
      is_sidechain            INTEGER DEFAULT 0,
      metadata                TEXT,
      created_at              INTEGER NOT NULL DEFAULT (unixepoch()*1000),
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );
    CREATE TABLE pricing (
      model                  TEXT NOT NULL,
      input_price            REAL NOT NULL,
      cache_creation_price   REAL NOT NULL,
      cache_read_price       REAL NOT NULL,
      output_price           REAL NOT NULL,
      effective_from        INTEGER,
      PRIMARY KEY (model, effective_from)
    );
    CREATE TABLE model_context (
      model                  TEXT PRIMARY KEY,
      context_window         INTEGER NOT NULL
    );
    INSERT INTO sessions (id, file_path, start_time, imported_at)
      VALUES ('legacy-session', '/tmp/legacy.jsonl', 1000, 2000);
    INSERT INTO pricing (
      model, input_price, cache_creation_price, cache_read_price, output_price, effective_from
    ) VALUES ('legacy-model', 1, 2, 0.1, 3, 0);
  `);
  return database;
}

function columnsOf(database: InstanceType<typeof Database>, table: string): string[] {
  return (database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[])
    .map((row) => row.name)
    .sort();
}

describe('database migrations', () => {
  it('upgrades a legacy database additively and records ordered migrations', () => {
    const database = createLegacyDatabase();
    applyMigrations(database);

    const migrations = database
      .prepare('SELECT version, name FROM schema_migrations ORDER BY version')
      .all();
    expect(migrations).toEqual([
      { version: 1, name: 'session_annotations' },
      { version: 2, name: 'cost_provenance' },
      { version: 3, name: 'source_revision' },
      { version: 4, name: 'agent_column' },
      { version: 5, name: 'task_outcome_experiments' },
    ]);

    const legacySession = database
      .prepare(
        `SELECT id, agent, tags, notes, cost_currency as costCurrency,
          cost_calculator_version as costCalculatorVersion,
          source_kind as sourceKind, source_fingerprint as sourceFingerprint
         FROM sessions WHERE id = 'legacy-session'`,
      )
      .get();
    expect(legacySession).toEqual({
      id: 'legacy-session',
      agent: 'unknown',
      tags: '',
      notes: '',
      costCurrency: 'CNY',
      costCalculatorVersion: 'legacy',
      sourceKind: null,
      sourceFingerprint: null,
    });

    const legacyPricing = lookupPricing(database, 'legacy-model', 1000);
    expect(legacyPricing).toMatchObject({
      model: 'legacy-model',
      inputPrice: 1,
      currency: 'CNY',
      unit: 'per_million_tokens',
      effectiveFrom: 0,
    });

    applyMigrations(database);
    const count = database.prepare('SELECT COUNT(*) as count FROM schema_migrations').get() as {
      count: number;
    };
    expect(count.count).toBe(5);
    database.close();
  });

  it('keeps fresh schema and migrated legacy schema in sync', () => {
    const fresh = createDatabase(':memory:');
    const migrated = createLegacyDatabase();
    applyMigrations(migrated);

    for (const table of [
      'sessions',
      'spans',
      'pricing',
      'model_context',
      'tasks',
      'config_snapshots',
      'task_sessions',
      'task_outcomes',
      'cohorts',
      'experiments',
    ]) {
      expect(columnsOf(migrated, table)).toEqual(columnsOf(fresh, table));
    }

    fresh.close();
    migrated.close();
  });

  it('selects the price effective at the requested event time', () => {
    const database = createDatabase(':memory:');
    const insert = database.prepare(
      `INSERT INTO pricing (
        model, input_price, cache_creation_price, cache_read_price, output_price,
        currency, unit, effective_from
      ) VALUES (?, ?, ?, ?, ?, 'CNY', 'per_million_tokens', ?)`,
    );
    insert.run('versioned-model', 1, 1, 0.1, 2, 1000);
    insert.run('versioned-model', 5, 5, 0.5, 10, 2000);

    expect(lookupPricing(database, 'versioned-model', 500)).toBeUndefined();
    expect(lookupPricing(database, 'versioned-model', 1500)?.inputPrice).toBe(1);
    expect(lookupPricing(database, 'versioned-model', 2500)).toMatchObject({
      inputPrice: 5,
      effectiveFrom: 2000,
    });
    database.close();
  });
});
