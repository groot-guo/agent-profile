import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { createDatabase, lookupPricing } from '../database';
import { applyMigrations } from '../schema';

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
      { version: 6, name: 'bounded_session_discovery' },
      { version: 7, name: 'bounded_session_evidence' },
      { version: 8, name: 'model_catalog_provenance' },
      { version: 9, name: 'model_catalog_span_provenance_recovery' },
      { version: 10, name: 'source_native_session_relationships' },
      { version: 11, name: 'task_assistance_provenance' },
      { version: 12, name: 'runtime_event_collector' },
      { version: 13, name: 'runtime_hint_policy' },
      { version: 14, name: 'runtime_event_coverage' },
      { version: 15, name: 'evidence_safe_cost_status' },
      { version: 16, name: 'retire_synthetic_zero_price_seed' },
      { version: 17, name: 'source_native_relationship_evidence' },
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
      sourceKind: 'legacy',
      revision: 1,
    });

    applyMigrations(database);
    const count = database.prepare('SELECT COUNT(*) as count FROM schema_migrations').get() as {
      count: number;
    };
    expect(count.count).toBe(17);
    expect(columnsOf(database, 'session_relationships')).toEqual(
      expect.arrayContaining([
        'call_started_at',
        'callback_at',
        'callback_status',
        'agent_nickname',
        'agent_role',
        'agent_path',
      ]),
    );
    expect(columnsOf(database, 'runtime_hints')).toEqual(
      expect.arrayContaining(['hint_id', 'task_id', 'run_id', 'payload_json', 'evidence_json']),
    );
    expect(columnsOf(database, 'runtime_hint_adoptions')).toEqual(
      expect.arrayContaining(['hint_id', 'status', 'producer', 'recorded_at', 'evidence_json']),
    );
    expect(columnsOf(database, 'runtime_event_coverage')).toEqual(
      expect.arrayContaining([
        'run_id',
        'task_id',
        'submitted_events',
        'observed_events',
        'rejected_events',
        'coverage_known',
      ]),
    );
    database.close();
  });

  it('recovers span provenance when an early migration v8 was already recorded', () => {
    const database = createDatabase(':memory:');
    database.exec(`
      ALTER TABLE spans DROP COLUMN pricing_model;
      ALTER TABLE spans DROP COLUMN pricing_revision;
    `);
    database.prepare('DELETE FROM schema_migrations WHERE version = ?').run(9);

    applyMigrations(database);

    expect(columnsOf(database, 'spans')).toEqual(
      expect.arrayContaining(['pricing_model', 'pricing_revision']),
    );
    expect(database.prepare('SELECT name FROM schema_migrations WHERE version = ?').get(9)).toEqual(
      { name: 'model_catalog_span_provenance_recovery' },
    );
    database.close();
  });

  it('backfills analytical project keys and creates discovery ordering indexes', () => {
    const database = createLegacyDatabase();
    applyMigrations(database);

    const session = database
      .prepare("SELECT project_key as projectKey FROM sessions WHERE id = 'legacy-session'")
      .get();
    expect(session).toEqual({ projectKey: 'agent-profile:session-records:unknown' });

    const indexes = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_sessions_discovery_%'",
      )
      .all() as Array<{ name: string }>;
    expect(indexes.map((index) => index.name).sort()).toEqual([
      'idx_sessions_discovery_agent_time',
      'idx_sessions_discovery_project_time',
      'idx_sessions_discovery_time',
    ]);
    database.close();
  });

  it('creates the stable Session evidence ordering index', () => {
    const database = createLegacyDatabase();
    applyMigrations(database);

    const index = database
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get('idx_spans_session_time_id') as { sql: string } | undefined;
    expect(index?.sql).toContain('spans(session_id, start_time, id)');
    database.close();
  });

  it('retires an existing active synthetic seed on migration and keeps it excluded', () => {
    const database = createLegacyDatabase();
    database
      .prepare(
        `INSERT INTO pricing (
          model, input_price, cache_creation_price, cache_read_price, output_price,
          effective_from
        ) VALUES ('<synthetic>', 0, 0, 0, 0, 0)`,
      )
      .run();

    applyMigrations(database);

    const active = database
      .prepare(
        `SELECT status FROM pricing
         WHERE model = '<synthetic>' AND status = 'active'`,
      )
      .get();
    expect(active).toBeUndefined();
    const retired = database
      .prepare(
        `SELECT status, superseded_at as supersededAt FROM pricing
         WHERE model = '<synthetic>' AND status = 'superseded'`,
      )
      .get() as { status: string; supersededAt: number } | undefined;
    expect(retired).toMatchObject({ status: 'superseded' });
    expect(retired?.supersededAt).toEqual(expect.any(Number));
    // 退休后 lookup 不再返回 free pricing。
    expect(lookupPricing(database, '<synthetic>', 1000)).toBeUndefined();
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
      'pricing_aliases',
      'pricing_history',
      'cost_recalculation_runs',
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

  it('backfills legacy pricing into revision history without changing its values', () => {
    const database = createLegacyDatabase();
    applyMigrations(database);

    const history = database
      .prepare(
        `SELECT model, input_price as inputPrice, effective_from as effectiveFrom,
          source_kind as sourceKind, revision, status
         FROM pricing_history WHERE model = 'legacy-model'`,
      )
      .get();
    expect(history).toEqual({
      model: 'legacy-model',
      inputPrice: 1,
      effectiveFrom: 0,
      sourceKind: 'legacy',
      revision: 1,
      status: 'active',
    });
    database.close();
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

  it('does not fall back to an older flat price after an unsupported schedule applies', () => {
    const database = createDatabase(':memory:');
    const insert = database.prepare(
      `INSERT INTO pricing (
        model, input_price, cache_creation_price, cache_read_price, output_price,
        currency, unit, effective_from, pricing_scheme, status
      ) VALUES (?, 1, 1, 1, 1, 'CNY', 'per_million_tokens', ?, ?, ?)`,
    );
    insert.run('tiered-model', 1000, 'flat_four_token_classes', 'active');
    insert.run('tiered-model', 2000, 'long_context_tiered', 'unsupported');

    expect(lookupPricing(database, 'tiered-model', 1500)).toBeDefined();
    expect(lookupPricing(database, 'tiered-model', 2500)).toBeUndefined();
    database.close();
  });
});
