# Roadmap & Task Breakdown

Each task records status, purpose, scope, affected files, acceptance criteria, risks, and verification. Repository-wide execution rules are defined in `../AGENTS.md`.

Task IDs T5–T15 are retained from the historical task system. T36 and later IDs are repository-local.

Completed task bodies below preserve their original execution plans and may
mention superseded file paths or one-time migration steps. Use
`../ARCHITECTURE.md` and the focused current-state documents for present
behavior.

## Current Progress (done)

| module                                                        | status                        |
| ------------------------------------------------------------- | ----------------------------- |
| P0 data listing (scanner/parser/analyzer/server/web/demo)     | done                          |
| P1 quantified diagnosis (7 heuristic rules + API + web)       | done                          |
| P2.18 read_scope_too_large heuristic                          | done                          |
| P2.19 LLM semantic diagnosis                                  | done                          |
| UI light theme + paginated tables + project grouping (by cwd) | done                          |
| pricing seed (DeepSeek) + typecheck fix                       | done                          |
| data source                                                   | Claude Code + Codex + Zed + MiMo |
| Architecture refactor (async scanner, DB abs path, routes split, config/theme extraction, auto-scan) | done |
| IDE-style UI (sidebar project tree + dashboard + embed detail) | done |
| @lobehub/icons (agent & model SVG icons)                      | done |
| pricing seed + total-cost recompute                            | done |
| session efficiency, attribution, comparison, trends, export   | done |
| stability hardening (schema, server types, metric correctness) | done |

## Batch 1 · Multi-Agent Data Ingestion

Foundation for batch 2 (filter) and batch 3 (stats). See `multi-agent.md`.

### T5 db schema: add agent column

- status: done
- depends: none
- steps:
  1. `db.ts` sessions table add `agent TEXT NOT NULL DEFAULT 'claude-code'`
  2. `routes.ts` SESSION_COLS + insertSession + scan body include agent
  3. `core/types.ts` SessionSummary add `agent: string`
  4. `core/parser.ts` parseTranscript accept agent param, stamp into ParsedSession
  5. the original rollout rebuilt the generated local database; later schema
     work introduced additive migration as the normal upgrade path
- affected: apps/server/src/db.ts, apps/server/src/routes.ts, packages/core/src/types.ts, packages/core/src/parser.ts
- acceptance: sessions table has agent column; existing Claude Code sessions agent='claude-code'
- risk: deleting trace.db loses current data (re-scan recovers)

### T6 Codex parser

- status: done
- depends: T5
- steps:
  1. new `core/codex-parser.ts`: parse rollout jsonl
     - `session_meta` → session meta (cwd, cli_version, session_id)
     - `response_item|reasoning` → thinking span
     - `response_item|custom_tool_call` ↔ `custom_tool_call_output` → tool_call span (pair by call id)
     - `response_item|message` → answer span
     - `event_msg|token_count` → 4 token types for nearest turn
  2. export from core/index.ts
  3. smoke test: parse one `~/.codex/sessions/.../rollout-*.jsonl`, verify spans
- affected: packages/core/src/codex-parser.ts (new), packages/core/src/index.ts
- acceptance: Codex session parsed into spans with 4 tokens + tool calls + thinking; agent='codex'
- risk: `token_count` event schema (4 token types) needs verification against real file

### T7 Zed parser

- status: done
- depends: T5
- steps:
  1. verify data format: decompress one threads.db `data` BLOB (zstd), inspect (JSON or MessagePack?)
  2. add zstd dep (`@lib/zstd` or system `zstd` CLI)
  3. new `core/zed-parser.ts`: read threads.db (better-sqlite3 readonly) → per thread decompress data → parse → spans
  4. project = `folder_paths`
- affected: packages/core/src/zed-parser.ts (new), packages/core/src/index.ts, package.json (zstd dep)
- acceptance: Zed thread parsed into spans; agent='zed'
- risk: data format unknown until decompressed; may need format-specific parser

### T8 scanner multi-source + scan API

- status: done
- depends: T6, T7
- steps:
  1. file-based Claude/Codex import dispatches parser by detected agent
  2. Zed database import runs through its read-only thread adapter
  3. later MiMo work adds the fourth database-backed source
  4. startup performs background multi-source import; `POST /api/scan` accepts
     a selected transcript directory for file-based sources
- affected: source scanners/parsers, `apps/server/src/routes/scan.ts`, `apps/server/src/index.ts`
- acceptance: supported sources are imported into one session/span model without blocking service startup; optional source failure does not remove already imported data
- risk: scan latency and differences in source-field coverage

## Batch 2 · UI Optimization & Filtering

### T9.5 startup auto-scan

- status: done
- depends: none
- steps:
  1. server 启动后自动扫描默认目录 `~/.claude/projects`（`AUTO_SCAN_DIR` env 覆盖，空字符串跳过）
  2. 扫描失败不阻塞 server 启动
  3. scanner 异步化（`fs/promises`），保留同步版本供兼容
- affected: packages/core/src/scanner.ts, apps/server/src/index.ts, apps/server/src/routes/scan.ts, apps/server/src/config.ts
- acceptance: server 启动后 `GET /api/sessions` 直接返回已扫描列表，无需手动 Scan
- risk: 首次扫描大目录可能慢（后台异步，不阻塞请求）

### T9 UI style adjustment + remove redundant requests

- status: done
- depends: none
- steps:
  1. UI style: await user direction (current = GitHub light)
  2. home: remove 5s `setInterval` polling → manual refresh button + post-scan refresh
  3. audit other redundant fetches
  4. extract shared theme (C, TOOL_CAT, DIAG_LABEL, fmt*) + config (API, DEFAULT_SCAN_DIR) to shared modules
- affected: apps/web/app/page.tsx, apps/web/app/session/[id]/page.tsx, apps/web/app/layout.tsx, apps/web/app/theme.ts (new), apps/web/app/config.ts (new)
- acceptance: no 5s polling; session list refreshes on scan complete + manual button
- risk: none

### T10 agent filter

- status: done
- depends: T5
- steps:
  1. home: add agent type filter (tab or dropdown: all / claude-code / codex / zed)
  2. client-side filter on sessions array, or `/api/sessions?agent=` query
- affected: apps/web/app/page.tsx, apps/server/src/routes.ts (optional query param)
- acceptance: filter narrows session list by agent
- risk: none

### T11 sub-agent call chain merge

- status: done
- depends: none
- steps:
  1. session detail: identify spans with `isSidechain` or parentId chain under Workflow/Task
  2. collapse sub-agent spans into summary card ("called N sub-agents, X tool calls, Y tokens")
  3. expandable to show sub-chain
- affected: apps/web/app/session/[id]/page.tsx, possibly core (sub-chain aggregation helper)
- acceptance: sub-agent calls collapsed with summary, expandable
- risk: parentUuid chain correctness across files (P3 full nesting deferred)

## Batch 3 · Consumption Statistics

See `stats.md`.

### T12 stats API + overview page

- status: done
- depends: T5 (agent column for by-agent grouping)
- steps:
  1. server: GET /api/stats — aggregate over sessions (overview + byAgent + byProject + byModel)
  2. web: new /stats page — overview cards + group tables
- affected: apps/server/src/routes.ts, apps/web/app/stats/page.tsx (new)
- acceptance: /stats shows total tokens/cost/session/agent/project + group tables
- risk: none

### T13 distribution charts

- status: done
- depends: T12
- steps:
  1. /api/stats add costDistribution (log bins) + tokenDistribution + modelDistribution
  2. /stats page: cost histogram (log bins) + model pie + stacked bar
- affected: apps/server/src/routes.ts, apps/web/app/stats/page.tsx
- acceptance: charts render with log-bin distribution + model breakdown
- risk: none

## Batch 4 · LLM Semantic Analysis

See `diagnosis.md`. Requires model/key decision (deferred).

### T14 LlmDiagnoser implementation (P2.19a)

- status: done
- depends: none (interface ready)
- steps:
  1. implement LlmDiagnoser in server (call LLM API, OpenAI-compatible)
  2. pre-filter suspects + build batch prompt
  3. inject into routes diagnosis handler
  4. record analysis cost separately
- affected: apps/server/src/llm-diagnoser.ts (new), apps/server/src/routes.ts
- acceptance: long_thinking top5 analyzed, LLM findings merged with "semantic" tag
- risk: LLM cost/latency; needs env config (LLM_API_KEY / LLM_MODEL / LLM_BASE_URL)

## Batch 5 · Leftover

### T15 glm-5.2 pricing + totalCost recompute

- status: done
- depends: none
- steps:
  1. add glm-5.2 to pricing seed (db.ts) once price provided
  2. totalCost recompute: `/api/recompute-cost` endpoint or re-scan trigger to recalc stored cost with current pricing
- affected: apps/server/src/db.ts, apps/server/src/routes.ts
- acceptance: glm-5.2 sessions show cost; pricing change updates totalCost
- risk: none

## Batch 6 · Stability & Data Correctness

### T36 stability hardening

- status: done
- scope:
  1. server TypeScript build: fix nullable parser values, Zed zstd API usage/field aliases, and distribution-bin types
  2. schema migration: create annotation columns for new databases before querying them; retain additive migration for existing databases
  3. cost attribution: allocate each LLM turn's cost across its tool categories without double counting; show tool-free turns explicitly
  4. efficiency metrics: make Read→Edit conversion bounded to 0–100%, weight tool success by calls, and rank efficiency score by the same composite score within a project
  5. export + Git: CSV escapes fields and includes session aggregates; Git uses `execFileSync` instead of a shell command
  6. detail performance: one `/api/session/:id/analysis` response replaces repeated full-span reads from eight detail endpoints
- affected: `apps/server/src/db.ts`, `apps/server/src/routes/{scan,stats,sessions,diagnosis}.ts`, `packages/core/src/{analyzer,types}.ts`, session detail UI and tests
- acceptance: core tests, server typecheck, and web production build all pass

## Batch 7 · Documentation Governance

### T37 task-driven documentation consistency

- status: completed
- purpose: make every repository change traceable to an explicit task, require a targeted document plan before code changes, and close the task with synchronized documentation after validation
- scope:
  1. add repository-wide task and documentation lifecycle rules
  2. define the source of truth and responsibility of each primary document
  3. synchronize README, current architecture, Chinese overview, roadmap, and future runtime-profile design
  4. correct stale current-state claims in agent guidance and focused diagnosis/multi-agent documents
  5. synchronize the focused statistics document with the implemented response shape
  6. label the original improvement analysis as a historical snapshot where its old task bodies are retained
  7. record validation evidence and close T37 only after the document set is consistent
- affected:
  - `AGENTS.md` (new)
  - `README.md`
  - `ARCHITECTURE.md`
  - `docs/roadmap.md`
  - `docs/zh/OVERVIEW.md`
  - `docs/agent-runtime-profile-design.md`
  - `CLAUDE.md`
  - `docs/diagnosis.md`
  - `docs/multi-agent.md`
  - `docs/stats.md`
  - `docs/improvement-analysis.md`
- acceptance:
  - a task must exist and be marked `in_progress` before code, schema, API, UI, configuration, or behavior changes begin
  - the task contains a targeted documentation plan and concrete acceptance/verification criteria
  - completion requires updating affected current-state/design docs and marking the task `completed`
  - primary documents describe the same current data sources, implemented capabilities, and current-versus-future boundary
- risks:
  - process rules that are too heavy can discourage small maintenance; the rule therefore scales task detail to change risk while retaining explicit task ownership
- verification:
  - `git diff --check` — passed
  - targeted stale-claim scan across current-state documents — passed with no
    matches for the retired “LLM not implemented”, “Claude only”, planned
    Codex/Zed, missing GLM pricing, or delete-database upgrade claims
  - Fastify route-path extraction compared with the API table in
    `ARCHITECTURE.md` — all current route paths represented
  - primary/focused document path existence check — passed
  - final task-status review — T37 changed from `in_progress` to `completed`
- completion:
  - completed_at: 2026-07-26
  - result: repository-wide documentation-first rules added; current-state,
    historical-snapshot, and future-proposal boundaries defined; current
    capabilities, sources, migrations, diagnosis, statistics, APIs, and runtime
    design documents synchronized
  - implementation impact: documentation/process only; no application code,
    schema, API behavior, or generated database changed

### T38 unify agent guidance entry points

- status: completed
- purpose: eliminate drift between `AGENTS.md` and `CLAUDE.md` while preserving
  both tools' expected repository instruction entry points
- scope:
  1. classify existing Claude guidance into repository-wide rules, durable
     technical invariants, and duplicated/current-progress content
  2. integrate only the repository-wide and durable technical guidance into a
     structured, agent-neutral `AGENTS.md`
  3. replace duplicated architecture/progress prose with links to the
     corresponding source-of-truth documents
  4. replace `CLAUDE.md` with a relative symbolic link to `AGENTS.md`
  5. document the canonical-file/compatibility-alias relationship
- affected:
  - `AGENTS.md`
  - `CLAUDE.md` (regular file → symbolic link)
  - `README.md`
  - `docs/roadmap.md`
- acceptance:
  - `AGENTS.md` contains the Task lifecycle plus the commands and technical
    invariants an implementation Agent needs before editing code
  - Claude-specific duplication and independently maintained current-progress
    claims are removed
  - `CLAUDE.md` is a relative symlink whose target is `AGENTS.md`
  - reading either path yields identical repository instructions
  - source-of-truth documents remain responsible for detailed architecture and
    current task status
- risks:
  - environments that materialize Git symlinks as plain files may not follow
    the alias; Git mode and target-content checks must therefore be recorded
  - overloading `AGENTS.md` with full architecture prose would recreate drift;
    only durable working context belongs in the instruction file
- verification:
  - `test -L CLAUDE.md` — passed
  - `readlink CLAUDE.md` — returned the relative target `AGENTS.md`
  - `cmp -s AGENTS.md CLAUDE.md` — passed; both entry points resolve to
    identical instructions
  - `git ls-files -s AGENTS.md CLAUDE.md` — canonical file mode `100644`;
    compatibility alias mode `120000`
  - duplicate/stale guidance scan — no Claude-specific title or independently
    maintained Current Progress section remains in the canonical instructions
  - `git diff --check` — passed
- completion:
  - completed_at: 2026-07-26
  - integration decision: retained the Task lifecycle, common commands, and
    durable metric/parser/migration invariants; replaced duplicated
    architecture and dynamic progress prose with source-of-truth links
  - result: `AGENTS.md` is the only maintained repository instruction body and
    `CLAUDE.md` is its relative compatibility symlink
  - implementation impact: instructions and repository file layout only; no
    application behavior, API, schema, or generated data changed

## Batch 8 · Runtime Profile Architecture Foundation

### T39 correctness contracts, migrations, and server verification

- status: completed
- purpose: establish reproducible cost semantics and a verifiable server
  foundation before changing ingestion or adding Task/Outcome entities
- scope:
  1. define one explicit pricing currency/unit contract across core, database,
     API, and documentation
  2. select effective pricing by LLM span time instead of analysis/recompute
     wall-clock time
  3. record the pricing/calculator provenance used for derived span and session
     costs
  4. replace ad-hoc column try/catch upgrades with ordered, idempotent
     `schema_migrations`
  5. add server build/typecheck and focused database/pricing integration tests
     to the root verification path
  6. add runtime request validation to mutable pricing/model-context endpoints
- affected:
  - `docs/roadmap.md`
  - `AGENTS.md`
  - `ARCHITECTURE.md`
  - `docs/stats.md`
  - `docs/zh/OVERVIEW.md`
  - `packages/core/src/types.ts`
  - `packages/core/src/analyzer.ts`
  - `packages/core/src/pricing.ts`
  - related core tests
  - `package.json`
  - `pnpm-lock.yaml`
  - `apps/server/package.json`
  - `apps/server/src/database.ts` (new)
  - `apps/server/src/db.ts`
  - `apps/server/src/routes/scan.ts`
  - `apps/server/src/routes/pricing.ts`
  - `apps/server/src/routes/shared.ts`
  - related server tests/config
- acceptance:
  - cost currency is explicit and consistent; no USD/CNY contradiction remains
  - importing and recomputing use the price effective at each LLM span's
    timestamp
  - derived cost exposes pricing/calculator provenance and unknown-price status
  - migrations run once, are recorded, and upgrade an existing pre-T39 database
  - invalid pricing/context write requests return validation errors
  - core tests, server tests/typecheck, changed-file lint, and production build
    pass; any unrelated pre-existing full-repository lint failures are isolated
    and recorded rather than folded into T39
- risks:
  - existing user-edited pricing rows must retain their numeric values and be
    assigned the documented legacy currency without destructive replacement
  - historical rows may lack exact provenance until recomputed; migration must
    represent that state honestly
  - root lint/build may reveal unrelated pre-existing failures; record rather
    than silently broadening scope
- documentation plan:
  - update `ARCHITECTURE.md` with migration ownership and versioned cost
    semantics
  - update `docs/stats.md` with currency/provenance and recomputation meaning
  - record actual migration, compatibility, commands, and results here before
    marking T39 completed
- verification:
  - `pnpm test` — passed: core 124/124 tests; server 6/6 tests
  - `pnpm build` — passed: core and server TypeScript checks plus the Next.js
    production build
  - changed-file Biome check — passed with 18 existing warnings in touched
    legacy files; no new changed-file lint errors
  - migration integration test — passed: a pre-T39 schema is upgraded without
    losing values, ordered migration records are written, and re-running the
    migration is idempotent
  - pricing integration test — passed: the effective price is selected by span
    timestamp and a real imported Claude fixture persists cost provenance
  - request validation tests — passed for invalid pricing/model-context payloads
    and the supported CNY-per-million contract
  - `git diff --check`, canonical instruction symlink check, and stale
    currency/table documentation scan — passed
  - full `pnpm lint` baseline — still red with 48 errors, 24 warnings, and 3
    infos in pre-existing repository files; isolated as T44 rather than
    broadening this correctness task
- completion:
  - completed_at: 2026-07-26
  - compatibility: existing pricing values are preserved and marked as legacy
    CNY per million tokens; historical costs retain honest `legacy` provenance
    until a new import or explicit recomputation records calculator `v1`
  - result: import and recomputation use span-time pricing, derived cost carries
    currency/effective-time/calculator provenance, and database evolution is
    owned by ordered `schema_migrations`
  - implementation impact: additive schema migration and stricter mutable API
    validation; no destructive database reset or silent historical repricing

### T40 source adapters and session repository boundary

- status: completed
- purpose: separate source discovery/parsing from normalized analysis and
  persistence so additional Agent Runtime event sources can be added without
  duplicating route logic or SQL
- scope:
  1. define a source-adapter contract that exposes discoverable session items,
     source revision metadata, and lazy normalized-session loading
  2. introduce a session repository that owns revision lookup and atomic
     replacement of a normalized session plus all spans
  3. introduce one import coordinator shared by manual file scans, startup
     scans, Zed, and MiMo
  4. move Claude/Codex transcript, Zed, and MiMo source-specific reading into
     adapters while keeping normalization in `@agent-profile/core`
  5. add ordered migration fields for source kind, update time, and stable
     fingerprint so unchanged records are skipped and changed Zed/MiMo sessions
     are refreshed
  6. add integration tests for repository replacement and source revision
     decisions, including database-backed source updates
- affected:
  - `docs/roadmap.md`
  - `ARCHITECTURE.md`
  - `AGENTS.md`
  - `README.md`
  - `docs/multi-agent.md`
  - `docs/zh/OVERVIEW.md`
  - `apps/server/src/database.ts`
  - `apps/server/src/routes/scan.ts`
  - `apps/server/src/index.ts`
  - new modules under `apps/server/src/ingestion/`
  - related server tests
  - parser input types/exports under `packages/core` only if required to remove
    unsafe adapter casts
- acceptance:
  - scan routes and source adapters contain no session/span persistence SQL
  - one repository transaction persists every normalized source consistently
  - the same source revision is skipped; a changed revision replaces the
    session and spans and is reported as `updated`
  - Zed and MiMo no longer permanently skip an existing session after its
    source `updated_at`/`time_updated` changes
  - one malformed source item does not abort unrelated imports and is counted
    explicitly
  - server/core tests, server typecheck, changed-file lint, production build,
    migration compatibility, and documentation consistency checks pass
- risks:
  - legacy sessions have no source fingerprint; their first post-migration scan
    must refresh safely rather than be treated as permanently current
  - SQLite source timestamps may use different units; adapters must preserve
    their raw value consistently and compare fingerprints, not infer duration
  - database connections and compressed payloads must close on error paths
- documentation plan:
  - update `ARCHITECTURE.md` with the implemented adapter/coordinator/repository
    boundaries and incremental revision semantics
  - update `AGENTS.md` with the invariant that routes do not own import SQL and
    source changes require adapter contract tests
  - record exact migration behavior, tests, compatibility, and known gaps here
    before marking T40 completed
- verification:
  - `pnpm test` — passed: core 124/124 tests; server 10/10 tests
  - `pnpm build` — passed: core and server TypeScript plus the Next.js
    production build
  - focused server build/test rerun — passed after final formatting:
    TypeScript clean and 10/10 tests
  - changed-file Biome check — passed with no errors, warnings, or infos
  - migration compatibility test — passed: migration 3 adds nullable source
    revision fields to a legacy database, preserves existing values, records
    once, and remains idempotent
  - repository integration test — passed: changed spans replace atomically
    while user tags/notes and source provenance remain correct
  - coordinator tests — passed: imported, skipped, updated, and failed outcomes
    are counted independently and a failure does not abort unrelated work
  - source tests — passed: transcript, Zed, and MiMo revisions skip when
    unchanged and refresh after file/source update metadata changes
  - persistence-boundary scan — no session/span write SQL remains in scan routes
    or source adapters; writes are isolated in `SessionRepository`
  - `git diff --check`, `CLAUDE.md` canonical symlink check, and current-state
    documentation consistency checks — passed
- completion:
  - completed_at: 2026-07-26
  - migration behavior: legacy sessions keep null source revision fields and
    therefore refresh once on their next source scan; no backfill guesses a
    fingerprint that was never observed
  - incremental behavior: file sources use mtime/size; Zed uses `updated_at`
    plus payload metadata; MiMo uses `time_updated` plus message/part counts
  - result: every source now flows through adapter → coordinator → analyzer/
    repository, Zed/MiMo updates are no longer permanently skipped, and scan
    results expose failures as well as imported/updated/skipped counts
  - compatibility: session IDs and existing API entry points remain unchanged;
    replacement now preserves user-authored tags and notes

### T44 repository lint baseline cleanup

- status: planned
- purpose: establish a green full-repository lint baseline independently from
  feature and architecture work
- scope:
  1. classify and fix the 48 existing lint errors without changing runtime
     behavior
  2. review security-sensitive findings such as raw HTML rendering separately
     from mechanical formatting
  3. run the full lint, test, and production build paths before completion
- acceptance:
  - `pnpm lint`, `pnpm test`, and `pnpm build` pass
  - behavior-affecting suppressions are documented rather than added silently
- execution constraint:
  - do not start before T40–T43 unless the errors block one of those tasks

## Execution Order

T5–T15 and T36–T40 are complete. T41 is next and has not started. T44 remains a
separate lint-debt task and must not be folded into feature work.

## Task Lifecycle

The detailed workflow is maintained in `../AGENTS.md`. The canonical transition is:

`planned` → `in_progress` → `completed`

`blocked` and `cancelled` are terminal alternatives when completion is not possible or no longer desired.

User authorization can be given by the request that starts the work; a second confirmation is required only when scope, risk, or external effects materially exceed that authorization. A task may be marked `completed` only after its implementation, affected documentation, and verification evidence have all been recorded.
