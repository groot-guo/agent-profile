import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { applyMigrations, createDatabase, lookupPricing } from '../database';

function createLegacyDatabase() {
  const database = new Database(':memory:');
  database.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      start_time INTEGER NOT NULL,
      imported_at INTEGER NOT NULL
    );
    CREATE TABLE spans (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      parent_id TEXT,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      start_time INTEGER NOT NULL
    );
    CREATE TABLE pricing (
      model TEXT NOT NULL,
      input_price REAL NOT NULL,
      cache_creation_price REAL NOT NULL,
      cache_read_price REAL NOT NULL,
      output_price REAL NOT NULL,
      effective_from INTEGER,
      PRIMARY KEY (model, effective_from)
    );
    CREATE TABLE model_context (
      model TEXT PRIMARY KEY,
      context_window INTEGER NOT NULL
    );
    INSERT INTO sessions (id, file_path, start_time, imported_at)
      VALUES ('legacy-session', '/tmp/legacy.jsonl', 1000, 2000);
    INSERT INTO pricing (
      model, input_price, cache_creation_price, cache_read_price, output_price, effective_from
    ) VALUES ('legacy-model', 1, 2, 0.1, 3, 0);
  `);
  return database;
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
    ]);

    const legacySession = database
      .prepare(
        `SELECT id, tags, notes, cost_currency as costCurrency,
          cost_calculator_version as costCalculatorVersion,
          source_kind as sourceKind, source_fingerprint as sourceFingerprint
         FROM sessions WHERE id = 'legacy-session'`,
      )
      .get();
    expect(legacySession).toEqual({
      id: 'legacy-session',
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
    expect(count.count).toBe(3);
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
});
