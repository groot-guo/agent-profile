import { classifySessionProject } from '@agent-profile/core';
import type Database from 'better-sqlite3';

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
  {
    version: 9,
    name: 'model_catalog_span_provenance_recovery',
    up(database) {
      addColumn(database, 'spans', 'pricing_model', 'TEXT');
      addColumn(database, 'spans', 'pricing_revision', 'INTEGER');
    },
  },
  {
    version: 10,
    name: 'source_native_session_relationships',
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS session_relationships (
          child_session_id  TEXT PRIMARY KEY,
          parent_session_id TEXT NOT NULL,
          source_kind       TEXT NOT NULL,
          relation_kind     TEXT NOT NULL CHECK (relation_kind = 'source_parent'),
          updated_at        INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_session_relationships_parent
          ON session_relationships(parent_session_id);
      `);
    },
  },
  {
    version: 11,
    name: 'task_assistance_provenance',
    up(database) {
      addColumn(database, 'task_sessions', 'link_producer', 'TEXT');
      addColumn(database, 'task_sessions', 'link_captured_at', 'INTEGER');
      addColumn(database, 'task_sessions', 'link_provenance_json', 'TEXT');
    },
  },
  {
    version: 12,
    name: 'runtime_event_collector',
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS runtime_events (
          event_id         TEXT NOT NULL,
          task_id          TEXT NOT NULL,
          run_id           TEXT NOT NULL,
          sequence         INTEGER NOT NULL CHECK (sequence >= 0),
          captured_at      INTEGER NOT NULL,
          kind             TEXT NOT NULL,
          parent_event_id  TEXT,
          payload_json     TEXT NOT NULL CHECK (json_valid(payload_json)),
          received_at      INTEGER NOT NULL,
          PRIMARY KEY (run_id, event_id),
          UNIQUE (run_id, sequence)
        );
        CREATE INDEX IF NOT EXISTS idx_runtime_events_task_time
          ON runtime_events(task_id, captured_at, run_id, sequence);
        CREATE INDEX IF NOT EXISTS idx_runtime_events_run_sequence
          ON runtime_events(run_id, sequence);
      `);
    },
  },
  {
    version: 13,
    name: 'runtime_hint_policy',
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS runtime_hints (
          hint_id       TEXT PRIMARY KEY,
          task_id       TEXT NOT NULL,
          run_id        TEXT NOT NULL,
          generated_at  INTEGER NOT NULL,
          expires_at    INTEGER NOT NULL,
          category      TEXT NOT NULL,
          payload_json  TEXT NOT NULL CHECK (json_valid(payload_json)),
          evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
          created_at    INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_runtime_hints_run_time
          ON runtime_hints(run_id, generated_at DESC);
        CREATE TABLE IF NOT EXISTS runtime_hint_adoptions (
          hint_id       TEXT PRIMARY KEY REFERENCES runtime_hints(hint_id),
          task_id       TEXT NOT NULL,
          run_id        TEXT NOT NULL,
          status        TEXT NOT NULL CHECK (status IN ('adopted', 'ignored', 'not_recorded')),
          producer      TEXT NOT NULL,
          recorded_at   INTEGER NOT NULL,
          evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
          updated_at    INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_runtime_hint_adoptions_task_time
          ON runtime_hint_adoptions(task_id, recorded_at DESC);
      `);
    },
  },
  {
    version: 14,
    name: 'runtime_event_coverage',
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS runtime_event_coverage (
          run_id           TEXT PRIMARY KEY,
          task_id          TEXT NOT NULL,
          submitted_events INTEGER NOT NULL CHECK (submitted_events >= 0),
          observed_events  INTEGER NOT NULL CHECK (observed_events >= 0),
          rejected_events  INTEGER NOT NULL CHECK (rejected_events >= 0),
          coverage_known   INTEGER NOT NULL DEFAULT 1 CHECK (coverage_known IN (0, 1)),
          updated_at       INTEGER NOT NULL
        );
        INSERT OR IGNORE INTO runtime_event_coverage (
          run_id, task_id, submitted_events, observed_events, rejected_events,
          coverage_known, updated_at
        )
        SELECT run_id, MIN(task_id), COUNT(*), COUNT(*), 0, 0, MAX(received_at)
          FROM runtime_events GROUP BY run_id;
      `);
    },
  },
  {
    version: 15,
    name: 'evidence_safe_cost_status',
    up(database) {
      addColumn(database, 'spans', 'cost_status', "TEXT NOT NULL DEFAULT 'unknown_pricing'");
      addColumn(database, 'sessions', 'cost_status', "TEXT NOT NULL DEFAULT 'unknown'");
    },
  },
  {
    version: 16,
    name: 'retire_synthetic_zero_price_seed',
    up(database) {
      // 退休 active 的合成占位零价 seed：synthetic 数据永不视为免费账单。
      database
        .prepare(
          `UPDATE pricing SET status = 'superseded', superseded_at = COALESCE(superseded_at, created_at)
           WHERE model = '<synthetic>' AND status = 'active'`,
        )
        .run();
    },
  },
  {
    version: 17,
    name: 'source_native_relationship_evidence',
    up(database) {
      addColumn(database, 'session_relationships', 'call_started_at', 'INTEGER');
      addColumn(database, 'session_relationships', 'callback_at', 'INTEGER');
      addColumn(
        database,
        'session_relationships',
        'callback_status',
        "TEXT CHECK (callback_status IS NULL OR callback_status IN ('observed', 'final_answer'))",
      );
      addColumn(database, 'session_relationships', 'agent_nickname', 'TEXT');
      addColumn(database, 'session_relationships', 'agent_role', 'TEXT');
      addColumn(database, 'session_relationships', 'agent_path', 'TEXT');
    },
  },
  {
    version: 18,
    name: 'codex_session_scoped_span_ids',
    up(database) {
      const temporaryPrefix = '__agent_profile_codex_scope__';
      database.exec(`
        UPDATE spans
        SET id = '${temporaryPrefix}' || session_id || ':' || id
        WHERE id NOT LIKE 'codex:%'
          AND EXISTS (
            SELECT 1 FROM sessions
            WHERE sessions.id = spans.session_id
              AND (sessions.agent = 'codex' OR sessions.source_kind = 'codex')
          );

        UPDATE spans
        SET parent_id = '${temporaryPrefix}' || session_id || ':' || parent_id
        WHERE parent_id IS NOT NULL
          AND id LIKE '${temporaryPrefix}%'
          AND EXISTS (
            SELECT 1 FROM spans parent
            WHERE parent.session_id = spans.session_id
              AND parent.id = '${temporaryPrefix}' || spans.session_id || ':' || spans.parent_id
          );

        UPDATE spans
        SET id = 'codex:' || session_id || ':' ||
          substr(id, length('${temporaryPrefix}' || session_id || ':') + 1)
        WHERE id LIKE '${temporaryPrefix}%';

        UPDATE spans
        SET parent_id = 'codex:' || session_id || ':' ||
          substr(parent_id, length('${temporaryPrefix}' || session_id || ':') + 1)
        WHERE parent_id LIKE '${temporaryPrefix}%';
      `);
    },
  },
  {
    version: 19,
    name: 'codex_review_initiator_sessions',
    up(database) {
      addColumn(database, 'sessions', 'is_review_initiator', 'INTEGER NOT NULL DEFAULT 0');
    },
  },
  {
    version: 20,
    name: 'model_catalog_price_sync_lookup',
    up(database) {
      database.exec(`
        CREATE INDEX IF NOT EXISTS idx_spans_model_type_price_sync
          ON spans(model, type, pricing_model, pricing_effective_from, pricing_revision);
      `);
    },
  },
  {
    version: 21,
    name: 'semantic_diagnosis_results',
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS semantic_diagnoses (
          session_id          TEXT PRIMARY KEY,
          source_fingerprint   TEXT,
          requested_at         INTEGER NOT NULL,
          status               TEXT NOT NULL CHECK (
            status IN ('not_requested', 'not_configured', 'insufficient_evidence', 'completed', 'failed')
          ),
          provider             TEXT CHECK (provider IS NULL OR provider IN ('anthropic', 'openai')),
          semantic_json        TEXT NOT NULL CHECK (json_valid(semantic_json)),
          findings_json        TEXT NOT NULL CHECK (json_valid(findings_json)),
          updated_at           INTEGER NOT NULL,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_semantic_diagnoses_updated
          ON semantic_diagnoses(updated_at DESC);
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
      cost_status             TEXT NOT NULL DEFAULT 'unknown',
      cost_currency           TEXT NOT NULL DEFAULT 'CNY',
      cost_calculated_at      INTEGER,
      cost_calculator_version TEXT NOT NULL DEFAULT 'legacy',
      peak_context_tokens     INTEGER DEFAULT 0,
      avg_context_tokens      INTEGER DEFAULT 0,
      cache_hit_rate          REAL DEFAULT 0,
      message_count           INTEGER DEFAULT 0,
      is_review_initiator     INTEGER NOT NULL DEFAULT 0,
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
      cost_status             TEXT NOT NULL DEFAULT 'unknown_pricing',
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

    CREATE TABLE IF NOT EXISTS session_relationships (
      child_session_id  TEXT PRIMARY KEY,
      parent_session_id TEXT NOT NULL,
      source_kind       TEXT NOT NULL,
      relation_kind     TEXT NOT NULL CHECK (relation_kind = 'source_parent'),
      call_started_at   INTEGER,
      callback_at       INTEGER,
      callback_status   TEXT CHECK (callback_status IS NULL OR callback_status IN ('observed', 'final_answer')),
      agent_nickname    TEXT,
      agent_role        TEXT,
      agent_path        TEXT,
      updated_at        INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_session_relationships_parent
      ON session_relationships(parent_session_id);

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
