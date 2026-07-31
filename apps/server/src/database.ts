import { classifySessionProject, type Pricing } from '@agent-profile/core';
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
  {
    version: 3,
    name: 'source_revision',
    up(database) {
      addColumn(database, 'sessions', 'source_kind', 'TEXT');
      addColumn(database, 'sessions', 'source_updated_at', 'INTEGER');
      addColumn(database, 'sessions', 'source_fingerprint', 'TEXT');
      database.exec('CREATE INDEX IF NOT EXISTS idx_sessions_source_kind ON sessions(source_kind)');
    },
  },
  {
    version: 4,
    name: 'agent_column',
    up(database) {
      addColumn(database, 'sessions', 'agent', "TEXT NOT NULL DEFAULT 'unknown'");
    },
  },
  {
    version: 5,
    name: 'task_outcome_experiments',
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS tasks (
          id                  TEXT PRIMARY KEY,
          project_id          TEXT,
          title               TEXT NOT NULL,
          type                TEXT NOT NULL,
          status              TEXT NOT NULL DEFAULT 'planned'
                              CHECK (status IN ('planned', 'in_progress', 'completed', 'failed', 'cancelled')),
          content_mode        TEXT NOT NULL DEFAULT 'structured'
                              CHECK (content_mode IN ('structured', 'local_text')),
          goal                TEXT,
          acceptance_criteria TEXT,
          complexity          TEXT CHECK (complexity IS NULL OR complexity IN ('small', 'medium', 'large')),
          created_at          INTEGER NOT NULL,
          updated_at          INTEGER NOT NULL,
          CHECK (content_mode = 'local_text' OR (goal IS NULL AND acceptance_criteria IS NULL))
        );

        CREATE INDEX IF NOT EXISTS idx_tasks_project_status
          ON tasks(project_id, status, updated_at DESC);

        CREATE TABLE IF NOT EXISTS config_snapshots (
          id                      TEXT PRIMARY KEY,
          agent                   TEXT NOT NULL,
          model                   TEXT,
          agent_rules_version     TEXT,
          tool_policy_version     TEXT,
          prompt_template_version TEXT,
          source_hash             TEXT NOT NULL,
          created_at              INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_config_snapshots_agent_created
          ON config_snapshots(agent, created_at DESC);

        CREATE TABLE IF NOT EXISTS task_sessions (
          task_id            TEXT NOT NULL,
          session_id         TEXT NOT NULL,
          config_snapshot_id TEXT,
          role               TEXT NOT NULL DEFAULT 'primary'
                             CHECK (role IN ('primary', 'continuation', 'subagent', 'verification')),
          started_at         INTEGER,
          finished_at        INTEGER,
          created_at         INTEGER NOT NULL,
          PRIMARY KEY (task_id, session_id),
          FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
          FOREIGN KEY (config_snapshot_id) REFERENCES config_snapshots(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_task_sessions_session ON task_sessions(session_id);

        CREATE TABLE IF NOT EXISTS task_outcomes (
          task_id         TEXT PRIMARY KEY,
          build_status    TEXT CHECK (build_status IS NULL OR build_status IN ('passed', 'failed', 'skipped', 'not_run')),
          test_status     TEXT CHECK (test_status IS NULL OR test_status IN ('passed', 'failed', 'skipped', 'not_run')),
          lint_status     TEXT CHECK (lint_status IS NULL OR lint_status IN ('passed', 'failed', 'skipped', 'not_run')),
          git_commit      TEXT,
          human_rating    INTEGER CHECK (human_rating IS NULL OR human_rating BETWEEN 1 AND 5),
          rework_reason   TEXT,
          completed_at    INTEGER,
          evidence_json   TEXT CHECK (evidence_json IS NULL OR json_valid(evidence_json)),
          updated_at      INTEGER NOT NULL,
          FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS cohorts (
          id              TEXT PRIMARY KEY,
          title           TEXT NOT NULL,
          definition_json TEXT NOT NULL CHECK (json_valid(definition_json)),
          status          TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'archived')),
          created_at      INTEGER NOT NULL,
          updated_at      INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS experiments (
          id                  TEXT PRIMARY KEY,
          title               TEXT NOT NULL,
          cohort_id           TEXT NOT NULL,
          control_config_id   TEXT NOT NULL,
          candidate_config_id TEXT NOT NULL,
          primary_metric      TEXT NOT NULL,
          guardrails_json     TEXT NOT NULL CHECK (json_valid(guardrails_json)),
          status              TEXT NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft', 'running', 'completed', 'cancelled')),
          evidence_status     TEXT NOT NULL DEFAULT 'not_collected'
                              CHECK (evidence_status IN ('not_collected', 'insufficient_evidence', 'ready')),
          decision            TEXT CHECK (decision IS NULL OR decision IN ('keep', 'rollback', 'insufficient_evidence')),
          created_at          INTEGER NOT NULL,
          updated_at          INTEGER NOT NULL,
          FOREIGN KEY (cohort_id) REFERENCES cohorts(id) ON DELETE RESTRICT,
          FOREIGN KEY (control_config_id) REFERENCES config_snapshots(id) ON DELETE RESTRICT,
          FOREIGN KEY (candidate_config_id) REFERENCES config_snapshots(id) ON DELETE RESTRICT,
          CHECK (control_config_id <> candidate_config_id),
          CHECK (evidence_status = 'ready' OR decision IS NULL OR decision = 'insufficient_evidence')
        );

        CREATE INDEX IF NOT EXISTS idx_experiments_cohort_status
          ON experiments(cohort_id, status, updated_at DESC);
      `);
    },
  },
  {
    version: 6,
    name: 'bounded_session_discovery',
    up(database) {
      addColumn(database, 'sessions', 'project_key', 'TEXT');
      const sessions = database
        .prepare(
          `SELECT id, agent, cwd, file_path as filePath
           FROM sessions
           WHERE project_key IS NULL OR TRIM(project_key) = ''`,
        )
        .all() as Array<{
        id: string;
        agent: string | null;
        cwd: string | null;
        filePath: string;
      }>;
      const updateProject = database.prepare('UPDATE sessions SET project_key = ? WHERE id = ?');
      for (const session of sessions) {
        updateProject.run(
          classifySessionProject({
            agent: session.agent ?? undefined,
            cwd: session.cwd ?? undefined,
            filePath: session.filePath,
          }),
          session.id,
        );
      }
      database.exec(`
        CREATE INDEX IF NOT EXISTS idx_sessions_discovery_time
          ON sessions(start_time DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_sessions_discovery_agent_time
          ON sessions(agent, start_time DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_sessions_discovery_project_time
          ON sessions(project_key, start_time DESC, id DESC);
      `);
    },
  },
  {
    version: 7,
    name: 'bounded_session_evidence',
    up(database) {
      database.exec(`
        CREATE INDEX IF NOT EXISTS idx_spans_session_time_id
          ON spans(session_id, start_time, id);
      `);
    },
  },
  {
    version: 8,
    name: 'model_catalog_provenance',
    up(database) {
      addColumn(database, 'pricing', 'source_kind', "TEXT NOT NULL DEFAULT 'legacy'");
      addColumn(database, 'pricing', 'source_reference', 'TEXT');
      addColumn(
        database,
        'pricing',
        'pricing_scheme',
        "TEXT NOT NULL DEFAULT 'flat_four_token_classes'",
      );
      addColumn(database, 'pricing', 'revision', 'INTEGER NOT NULL DEFAULT 1');
      addColumn(database, 'pricing', 'status', "TEXT NOT NULL DEFAULT 'active'");
      addColumn(database, 'pricing', 'created_at', 'INTEGER NOT NULL DEFAULT 0');
      addColumn(database, 'pricing', 'superseded_at', 'INTEGER');
      addColumn(database, 'model_context', 'source_kind', "TEXT NOT NULL DEFAULT 'legacy'");
      addColumn(database, 'model_context', 'source_reference', 'TEXT');
      addColumn(database, 'model_context', 'audited_at', 'INTEGER');
      addColumn(database, 'model_context', 'revision', 'INTEGER NOT NULL DEFAULT 1');
      addColumn(database, 'model_context', 'user_override', 'INTEGER NOT NULL DEFAULT 0');
      addColumn(database, 'spans', 'pricing_model', 'TEXT');
      addColumn(database, 'spans', 'pricing_revision', 'INTEGER');
      database.exec(`
        CREATE TABLE IF NOT EXISTS pricing_history (
          id                 TEXT PRIMARY KEY,
          model              TEXT NOT NULL,
          input_price        REAL NOT NULL,
          cache_creation_price REAL NOT NULL,
          cache_read_price   REAL NOT NULL,
          output_price       REAL NOT NULL,
          currency           TEXT NOT NULL,
          unit               TEXT NOT NULL,
          effective_from     INTEGER NOT NULL,
          source_kind        TEXT NOT NULL,
          source_reference   TEXT,
          pricing_scheme     TEXT NOT NULL,
          revision           INTEGER NOT NULL,
          status             TEXT NOT NULL,
          created_at         INTEGER NOT NULL,
          superseded_at      INTEGER
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_pricing_history_key
          ON pricing_history(model, effective_from, revision);
        INSERT OR IGNORE INTO pricing_history (
          id, model, input_price, cache_creation_price, cache_read_price,
          output_price, currency, unit, effective_from, source_kind,
          source_reference, pricing_scheme, revision, status, created_at
        )
        SELECT lower(hex(randomblob(16))), model, input_price,
          cache_creation_price, cache_read_price, output_price, currency, unit,
          COALESCE(effective_from, 0), source_kind, source_reference,
          pricing_scheme, revision, status, created_at
        FROM pricing;
        CREATE TABLE IF NOT EXISTS cost_recalculation_runs (
          id                 TEXT PRIMARY KEY,
          scope_json         TEXT NOT NULL CHECK (json_valid(scope_json)),
          pricing_revision   TEXT NOT NULL,
          calculator_version TEXT NOT NULL,
          previewed_at       INTEGER NOT NULL,
          executed_at        INTEGER,
          updated_spans      INTEGER NOT NULL DEFAULT 0,
          updated_sessions   INTEGER NOT NULL DEFAULT 0,
          unknown_before     INTEGER NOT NULL DEFAULT 0,
          unknown_after      INTEGER NOT NULL DEFAULT 0,
          status             TEXT NOT NULL CHECK (status IN ('previewed', 'completed', 'failed')),
          error_code         TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_cost_recalculation_runs_created
          ON cost_recalculation_runs(previewed_at DESC);
        CREATE TABLE IF NOT EXISTS pricing_aliases (
          raw_model          TEXT PRIMARY KEY,
          pricing_model      TEXT NOT NULL,
          pricing_equivalent INTEGER NOT NULL CHECK (pricing_equivalent = 1),
          source_kind        TEXT NOT NULL,
          source_reference   TEXT,
          audited_at         INTEGER,
          revision           INTEGER NOT NULL
        );
      `);
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
      source_kind             TEXT,
      source_updated_at       INTEGER,
      source_fingerprint      TEXT,
      start_time              INTEGER NOT NULL,
      end_time                INTEGER,
      cwd                     TEXT,
      project_key             TEXT,
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
      pricing_model           TEXT,
      pricing_revision        INTEGER,
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
    CREATE INDEX IF NOT EXISTS idx_spans_session_time_id ON spans(session_id, start_time, id);

    CREATE TABLE IF NOT EXISTS pricing (
      model                  TEXT NOT NULL,
      input_price            REAL NOT NULL,
      cache_creation_price   REAL NOT NULL,
      cache_read_price       REAL NOT NULL,
      output_price           REAL NOT NULL,
      currency               TEXT NOT NULL DEFAULT 'CNY',
      unit                   TEXT NOT NULL DEFAULT 'per_million_tokens',
      effective_from        INTEGER,
      source_kind            TEXT NOT NULL DEFAULT 'legacy',
      source_reference       TEXT,
      pricing_scheme         TEXT NOT NULL DEFAULT 'flat_four_token_classes',
      revision               INTEGER NOT NULL DEFAULT 1,
      status                 TEXT NOT NULL DEFAULT 'active',
      created_at             INTEGER NOT NULL DEFAULT 0,
      superseded_at          INTEGER,
      PRIMARY KEY (model, effective_from)
    );

    CREATE TABLE IF NOT EXISTS model_context (
      model                  TEXT PRIMARY KEY,
      context_window         INTEGER NOT NULL,
      source_kind            TEXT NOT NULL DEFAULT 'legacy',
      source_reference       TEXT,
      audited_at             INTEGER,
      revision               INTEGER NOT NULL DEFAULT 1,
      user_override          INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS pricing_aliases (
      raw_model          TEXT PRIMARY KEY,
      pricing_model      TEXT NOT NULL,
      pricing_equivalent INTEGER NOT NULL CHECK (pricing_equivalent = 1),
      source_kind        TEXT NOT NULL,
      source_reference   TEXT,
      audited_at         INTEGER,
      revision           INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cost_recalculation_runs (
      id                 TEXT PRIMARY KEY,
      scope_json         TEXT NOT NULL CHECK (json_valid(scope_json)),
      pricing_revision   TEXT NOT NULL,
      calculator_version TEXT NOT NULL,
      previewed_at       INTEGER NOT NULL,
      executed_at        INTEGER,
      updated_spans      INTEGER NOT NULL DEFAULT 0,
      updated_sessions   INTEGER NOT NULL DEFAULT 0,
      unknown_before     INTEGER NOT NULL DEFAULT 0,
      unknown_after      INTEGER NOT NULL DEFAULT 0,
      status             TEXT NOT NULL CHECK (status IN ('previewed', 'completed', 'failed')),
      error_code         TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_cost_recalculation_runs_created
      ON cost_recalculation_runs(previewed_at DESC);

    CREATE TABLE IF NOT EXISTS pricing_history (
      id                   TEXT PRIMARY KEY,
      model                TEXT NOT NULL,
      input_price          REAL NOT NULL,
      cache_creation_price REAL NOT NULL,
      cache_read_price     REAL NOT NULL,
      output_price         REAL NOT NULL,
      currency             TEXT NOT NULL,
      unit                 TEXT NOT NULL,
      effective_from       INTEGER NOT NULL,
      source_kind          TEXT NOT NULL,
      source_reference     TEXT,
      pricing_scheme       TEXT NOT NULL,
      revision             INTEGER NOT NULL,
      status               TEXT NOT NULL,
      created_at           INTEGER NOT NULL,
      superseded_at        INTEGER
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pricing_history_key
      ON pricing_history(model, effective_from, revision);

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
  const exact = database
    .prepare(
      `SELECT model, input_price as inputPrice, cache_creation_price as cacheCreationPrice,
              cache_read_price as cacheReadPrice, output_price as outputPrice,
              currency, unit, COALESCE(effective_from, 0) as effectiveFrom,
              source_kind as sourceKind, source_reference as sourceReference,
              pricing_scheme as pricingScheme, revision, status,
              created_at as createdAt, superseded_at as supersededAt
       FROM pricing
       WHERE model = ? AND COALESCE(effective_from, 0) <= ?
         AND COALESCE(status, 'active') IN ('active', 'unsupported')
       ORDER BY COALESCE(effective_from, 0) DESC, revision DESC LIMIT 1`,
    )
    .get(model, at) as Pricing | undefined;
  if (exact) {
    return isSupportedPricing(exact) ? { ...exact, pricingModel: exact.model } : undefined;
  }
  const alias = database
    .prepare(
      `SELECT pricing_model as pricingModel FROM pricing_aliases
       WHERE raw_model = ? AND pricing_equivalent = 1`,
    )
    .get(model) as { pricingModel: string } | undefined;
  if (!alias) return undefined;
  const selected = database
    .prepare(
      `SELECT model, input_price as inputPrice, cache_creation_price as cacheCreationPrice,
              cache_read_price as cacheReadPrice, output_price as outputPrice,
              currency, unit, COALESCE(effective_from, 0) as effectiveFrom,
              source_kind as sourceKind, source_reference as sourceReference,
              pricing_scheme as pricingScheme, revision, status,
              created_at as createdAt, superseded_at as supersededAt
       FROM pricing
       WHERE model = ? AND COALESCE(effective_from, 0) <= ?
         AND COALESCE(status, 'active') IN ('active', 'unsupported')
       ORDER BY COALESCE(effective_from, 0) DESC, revision DESC LIMIT 1`,
    )
    .get(alias.pricingModel, at) as Pricing | undefined;
  return selected && isSupportedPricing(selected)
    ? { ...selected, pricingModel: selected.model }
    : undefined;
}

function isSupportedPricing(pricing: Pricing): boolean {
  return (
    (pricing.status ?? 'active') === 'active' &&
    (pricing.pricingScheme ?? 'flat_four_token_classes') === 'flat_four_token_classes'
  );
}
