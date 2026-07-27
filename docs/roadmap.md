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

### T41 runtime-consumable Agent profiles and difference view

- status: completed
- purpose: turn normalized Session/Span evidence into a stable, transparent
  process profile that a person or another Agent Runtime can use to understand
  how one observed Agent differs from peers
- scope:
  1. define a versioned `AgentProfileReport` contract in core with explicit
     sample sizes, metric distributions, coverage, comparison basis, and
     limitations
  2. compute resource usage, context discipline, execution reliability, and
     collaboration dimensions without introducing a universal quality score
  3. generate neutral relative characteristics only when minimum sample
     requirements are met; report higher/lower/similar rather than better/worse
  4. expose aggregate and single-Agent profile APIs from current normalized
     sessions/spans
  5. add a human-readable Agent profile page that emphasizes evidence,
     coverage, and fair-comparison limits
  6. document the current report schema, formulas, interpretation boundaries,
     and Agent Runtime consumption path
- affected:
  - `docs/roadmap.md`
  - `AGENTS.md`
  - `ARCHITECTURE.md`
  - `README.md`
  - `docs/agent-runtime-profile-design.md`
  - `docs/stats.md`
  - `docs/zh/OVERVIEW.md`
  - `packages/core/src/profile.ts` (new)
  - `packages/core/src/index.ts`
  - related core tests
  - `apps/server/src/routes/profiles.ts` (new)
  - `apps/server/src/routes/index.ts`
  - related server tests
  - `apps/web/app/profiles/page.tsx` (new)
  - `apps/web/app/header.tsx`
- acceptance:
  - report schema is versioned and includes generation time, scope, sample
    counts, units, coverage ratios, comparison method, and limitations
  - per-Agent profiles expose distribution statistics instead of relying on
    aggregate totals that primarily measure usage volume
  - relative characteristics require at least three sessions and at least one
    peer Agent; sparse data returns `insufficient_data` rather than a claim
  - outcome quality is explicitly unavailable until Task/Outcome capture is
    implemented; cost or token efficiency is never labeled overall quality
  - API supports all-Agent and single-Agent consumption and returns a clear 404
    for an unknown Agent
  - the web page lets a user compare observed behavior and data coverage without
    presenting a leaderboard
  - core/server tests, typecheck, changed-file lint, production build, and
    documentation consistency checks pass
- risks:
  - agents may be used for different task types; current comparison is
    observational and cannot control for task complexity
  - missing model, timing, cost, or tool metadata can skew naïve comparisons;
    every affected metric must carry coverage
  - small samples can look decisive; minimum sample and confidence must be
    enforced in code rather than left to UI copy
- documentation plan:
  - update current architecture and statistics documents with the implemented
    report contract and formulas
  - keep `docs/agent-runtime-profile-design.md` future phases distinct from this
    session-derived Phase 0 capability
  - update README/Chinese overview and record exact verification here before
    marking T41 completed
- verification:
  - `pnpm test` — passed: core 132/132 tests; server 13/13 tests
  - `pnpm build` — passed: core and server TypeScript plus the Next.js
    production build; `/profiles` is included as a static route
  - changed-file Biome check — passed with no errors, warnings, or infos
  - pure profile tests — passed for empty input, sparse samples, multi-Agent
    distributions/comparisons, and sub-threshold metric coverage
  - API tests — passed for empty report, eligible and sparse Agents,
    single-Agent consumption, and unknown-Agent 404
  - live API smoke test — passed against the local database: 57 sessions across
    three Agents produced `agent-profile/v1` with ready comparison status
  - browser UI verification — desktop layout rendered all three real profiles;
    390px viewport retained three cards without horizontal overflow and the
    header navigation remained single-line after the responsive correction
  - transparency review — Outcome is `not_collected`, higher/lower has no
    preferred direction, sparse profiles emit `insufficient_data`, and explicit
    tool-error observation limits are visible in report/docs
  - `git diff --check`, canonical instruction symlink check, API/doc schema
    string scan, and current/future documentation boundary check — passed
- completion:
  - completed_at: 2026-07-26
  - report contract: `agent-profile/v1`, derived on demand from normalized
    sessions/spans with no new persistence or migration
  - comparison contract: target and peer require three sessions, metric
    coverage requires 50%, and ±10% from the eligible peer-Agent median is
    `similar`
  - result: people can use `/profiles`, and an Agent Runtime can consume
    `/api/profiles/agents` or `/api/profiles/agents/:agent`, to distinguish
    observed resource, context, reliability, and collaboration behavior
  - limitation: current cohorts do not control task complexity and tool-error
    availability is not separately captured by every source; neither a 0%
    observed error rate nor lower resource use establishes better outcomes
  - design decision: the page uses comparable runtime-signature rails and
    evidence coverage instead of a total score or leaderboard

### T42 prompt-structure review and evidence-backed iteration hints

- status: completed
- purpose: help people and Agent Runtimes improve prompt/configuration inputs
  without storing raw prompts by default or claiming that process correlations
  prove a prompt caused the observed behavior
- scope:
  1. define a versioned, deterministic prompt-structure review contract for
     goal, scope, acceptance, constraints, context, and verification
  2. analyze prompt text ephemerally with bounded evidence excerpts and no
     database persistence or semantic-provider dependency
  3. combine optional Agent Profile evidence with prompt gaps to produce
     prioritized iteration hints, confidence, guardrails, and evidence sources
  4. expose one local API endpoint for prompt review and optional
     Agent-specific iteration hints with runtime request validation and size
     limits
  5. add a human prompt-review page that states privacy/retention boundaries and
     returns clauses to consider rather than silently rewriting the prompt
  6. document which checks are deterministic heuristics, which hints are
     correlations, and how a future Outcome closes the validation loop
- affected:
  - `docs/roadmap.md`
  - `AGENTS.md`
  - `ARCHITECTURE.md`
  - `README.md`
  - `docs/agent-runtime-profile-design.md`
  - `docs/zh/OVERVIEW.md`
  - `packages/core/src/prompt-review.ts` (new)
  - `packages/core/src/index.ts`
  - related core tests
  - `apps/server/src/routes/prompt-review.ts` (new)
  - `apps/server/src/routes/index.ts`
  - related server tests
  - `apps/web/app/prompt-review/page.tsx` (new)
  - `apps/web/app/header.tsx`
  - `apps/web/app/layout.tsx`
- acceptance:
  - `prompt-review/v1` returns six named checks with present/partial/missing
    status, bounded evidence, concrete clause suggestions, and explicit limits
  - raw prompt text and review results are not written to SQLite, logs, or
    response echoes; the API rejects empty and over-limit input
  - review remains deterministic and available without any LLM configuration
  - combined hints cite prompt checks and/or Agent Profile metrics, distinguish
    correlation from causality, and require Outcome validation before a
    recommendation is treated as proven
  - the UI clearly states local ephemeral processing and lets users choose
    whether to combine an observed Agent profile
  - core/server tests, typecheck, changed-file lint, production build, privacy
    scan, and documentation consistency checks pass
- risks:
  - keyword heuristics can miss semantically valid clauses or match incidental
    words; status and confidence must remain conservative
  - returning long excerpts can leak prompt content into browser history or
    logs; excerpts must be short, opt-in within the response, and never logged
  - process metrics may reflect task complexity rather than prompt quality;
    combined hints must retain causal and Outcome guardrails
- documentation plan:
  - update current architecture and user docs with the implemented ephemeral
    review/hint flow and non-retention promise
  - update the future design doc to mark the structural-review portion of the
    prompt boundary as implemented without claiming experiments/Outcome exist
  - record exact validation, privacy checks, and remaining limitations here
    before marking T42 completed
- verification:
  - `pnpm test` — passed: core 140/140 tests; server 17/17 tests
  - `pnpm build` — passed: Core and Server TypeScript plus the Next.js
    production build; `/prompt-review` is included as a static route
  - changed-source Biome check — passed for eight T42 Core, Server, and Web
    files; `apps/web/app/layout.tsx` was formatted and production-built, while
    its two pre-existing inline-theme `noDangerouslySetInnerHtml` findings
    remain explicitly owned by T44
  - deterministic Core tests — passed for all six checks, conservative status,
    no default raw-text echo, opt-in secret redaction, 140-character excerpt
    bounds, 20,000-character request limit, and combined runtime evidence
  - API tests — passed for ephemeral/non-persistent review, whitespace and
    oversized rejection, optional known-Agent combination, unknown-Agent 404,
    and opt-in redacted evidence
  - privacy source scan — no prompt-review SQL mutation or logging call found;
    tests also confirm table names remain unchanged and the default response
    does not echo a unique raw prompt marker
  - browser UI verification — the production `/prompt-review` page rendered at
    1280px with all four navigation links, privacy boundaries, evidence opt-in,
    optional Agent selector, and no horizontal overflow
  - responsive static verification — at 760px the two-column review bench
    collapses to one column; at 470px the brand label is hidden, nav padding is
    reduced, and form controls stack
  - `git diff --check`, `CLAUDE.md -> AGENTS.md` canonical symlink check, and
    prompt-review schema/API documentation scans — passed
- completion:
  - completed_at: 2026-07-26
  - contracts: `prompt-review/v1` for six deterministic structural checks and
    `iteration-hints/v1` for prioritized, source-labeled hypotheses
  - retention: request text is processed only in memory, not written to the
    current five-table SQLite model or application logs, and no semantic
    provider is invoked
  - evidence: omitted by default; opt-in excerpts are secret-redacted, limited
    to two per check, and bounded to 140 characters each
  - result: a person can use `/prompt-review`, while an Agent Runtime can call
    `POST /api/prompt-review`, optionally selecting an observed Agent profile
    to receive combined structural/runtime hypotheses
  - limitation: keyword/heading checks can miss implicit meaning or match
    incidental text, Agent comparisons do not control task complexity, and no
    Task Outcome exists yet; every hint therefore remains an experiment to
    validate rather than a proven optimization
  - design decision: expose clause suggestions and evidence sources without a
    prompt score or automatic rewrite

### T43 normalized session evidence timeline and transparency

- status: completed
- purpose: let people and Agent Runtimes inspect what the profiler actually
  observed in one execution, including tool-call process evidence and data
  gaps, without confusing normalized spans with a complete original
  conversation or exposing stored content by default
- scope:
  1. define a versioned `session-evidence/v1` report derived on demand from one
     normalized Session and its ordered Spans, with no schema migration
  2. expose every normalized LLM turn, tool call, thinking block, and answer
     block in one ordered timeline with sequence, parent relationship,
     main/sidechain lane, timing, resource fields, and conservative outcome
     labels
  3. report coverage for timing, parent links, tool inputs, tool outputs,
     model identity, and content-bearing spans; distinguish `not_captured`
     from an observed empty/zero value
  4. omit stored content by default and support an explicit bounded-preview
     mode with secret redaction and truncation provenance; do not add a
     full-raw-content API
  5. add a Session-detail evidence panel with type/lane/status filters,
     progressive disclosure, coverage explanations, and an explicit statement
     that normalized evidence is not a complete source transcript
  6. document how this evidence surface supports debugging and future Runtime
     consumption while Task/Outcome semantics remain absent
- affected:
  - `docs/roadmap.md`
  - `AGENTS.md`
  - `ARCHITECTURE.md`
  - `README.md`
  - `docs/agent-runtime-profile-design.md`
  - `docs/zh/OVERVIEW.md`
  - `packages/core/src/session-evidence.ts` (new)
  - `packages/core/src/index.ts`
  - related Core tests
  - `apps/server/src/routes/session-evidence.ts` (new)
  - `apps/server/src/routes/index.ts`
  - `apps/server/src/routes/sessions.ts`
  - related Server tests
  - `apps/web/app/session/[id]/page.tsx`
  - `apps/web/app/session/[id]/evidence-panel.tsx` (new)
- acceptance:
  - `session-evidence/v1` includes every stored normalized span exactly once in
    stable chronological order and exposes counts by event type/lane/outcome
  - parent references are classified as root, linked, or missing parent, and
    sidechain evidence remains visible rather than being merged into main-chain
    totals
  - a tool with `isError=false` is labeled `no_error_observed`, never
    universally “successful”; missing inputs/outputs and missing end times are
    reported as not captured
  - default API responses contain no input/output/thinking/answer text;
    `content=preview` returns only secret-redacted bounded previews and declares
    whether stored source content was already truncated
  - the UI can inspect all normalized events, filter them, and expand details
    without presenting a raw-chat viewer or loading content previews by default
  - Core/Server tests, typecheck, changed-file lint, production build, privacy
    scans, UI checks, and documentation consistency checks pass
- risks:
  - current parsers do not create first-class user-message spans, so “all
    events” must mean all normalized stored spans rather than the complete
    conversation
  - `isError=false` does not prove success for every source; outcome wording
    must remain conservative
  - stored parser metadata can contain sensitive local paths, commands, or
    output; preview mode must be explicit, redacted, and bounded
  - large sessions can contain many events; UI filtering and collapsed details
    must avoid rendering all content bodies eagerly
- documentation plan:
  - add the report/API/privacy contract to current architecture and user docs
  - update the future runtime-profile design to mark the normalized evidence
    timeline portion as implemented while retaining raw transcript and
    Task/Outcome layers as future/authorized surfaces
  - record exact coverage semantics, test counts, privacy scans, UI validation,
    and remaining source limitations here before marking T43 completed
- verification:
  - `pnpm test` — passed: Core 148/148 tests; Server 20/20 tests
  - `pnpm build` — passed: Core and Server TypeScript plus the Next.js
    production build; the dynamic `/session/[id]` route includes the evidence
    panel
  - changed-source Biome check — passed for seven new/modified T43 Core,
    Server, and evidence-panel files; the existing Session page and route use
    targeted minimal insertions and were production-built, while their
    unrelated historical lint findings remain owned by T44
  - pure report tests — passed for stable chronological ordering, exactly-once
    event inclusion, parent/lane/outcome semantics, partial/not-applicable
    coverage, default content omission, secret redaction, 500-character preview
    bounds, and parser-truncation provenance
  - API tests — passed for default non-content responses, explicit preview
    disclosure, invalid `content=full` rejection, and unknown-Session 404
  - real-database API smoke test — one 60-Span Session produced
    `session-evidence/v1` with 30 LLM turns, 22 tool calls, 4 thinking blocks,
    and 4 answer blocks; default mode contained no preview fields, preview mode
    exposed 52 bounded fields and identified 5 already-truncated source fields
  - default Session-detail privacy smoke test — `/analysis` returned all 60
    structural Spans with zero `metadata` fields
  - privacy source scan — no full-content enum/mode exists; default content mode
    is `none`, raw-content declaration is always false, and the Session-detail
    response applies `withoutStoredContent`
  - browser production-page verification — the Session page rendered the
    evidence-panel heading and explicit API version-skew fallback at 1280px;
    document width was 1270px with no horizontal overflow. The already-running
    port-3000 API was intentionally not replaced during the check
  - `git diff --check`, canonical `CLAUDE.md -> AGENTS.md` symlink check, and
    report/API documentation scans — passed
- completion:
  - completed_at: 2026-07-26
  - report contract: `session-evidence/v1`, derived on demand with no new table,
    migration, or retained report
  - event contract: every normalized stored Span appears exactly once in stable
    time/source order with parent status, main/sidechain lane, conservative
    outcome, timing, resource fields, and content availability
  - privacy contract: no content by default; explicit preview only, common
    secrets redacted, 500-character per-field bound, no full-raw API, and
    Session-detail metadata stripped from the default page payload
  - result: people can inspect and filter the normalized execution process in a
    Session detail page, and Agent Runtimes can consume the same evidence and
    coverage through `GET /api/session/:id/evidence`
  - limitation: this is complete for normalized Spans, not the original source
    conversation; user messages and some Runtime events are not first-class
    Spans across all adapters, and `no_error_observed` does not prove success
  - design decision: keep complete transcript/raw-output access outside the
    default evidence contract and use progressive disclosure for bounded local
    previews

### T44 repository lint baseline cleanup

- status: completed
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
- active scope and verification plan:
  - resolve the current Biome diagnostics across server, core, web, and helper
    scripts without changing public runtime behavior
  - preserve the deliberate document theme bootstrap and static global CSS
    injection while documenting any narrowly-scoped security suppression
  - run `pnpm lint`, `pnpm test`, and `pnpm build`; inspect the final diff for
    unintended behavioral changes before closing the Task
- implemented:
  - applied Biome's safe repository-wide formatting and import organization;
    resolved its blocking accessibility and React-key findings
  - removed unsafe non-null assumptions in production paths where needed and
    retained non-blocking advisory diagnostics for explicitly bounded test or
    parser cases
  - replaced static `dangerouslySetInnerHTML` theme bootstrap/style injection
    with static script/style child content, retaining no-flash theme behavior
    without suppressing the security rule
  - added a descriptive title to the embedded Session iframe
- verification:
  - `pnpm lint` — passed with 21 warnings and 2 informational diagnostics,
    no errors; warnings are advisory and did not require behavior-changing
    suppressions
  - `pnpm test` — passed: core 14 files / 154 tests; server 6 files / 20 tests
  - `pnpm build` — passed: core TypeScript build, server type check, and Next
    production build
  - `git diff --check` — passed
- completion:
  - changed files: Biome-formatted server, core, web, and helper-script files,
    plus the T51 UI files and this roadmap
  - no schema, API, metric, or source-adapter behavior was intentionally
    changed; the inline theme bootstrap remains local static content

### T45 unified development startup and Session detail information architecture

- status: completed
- purpose:
  - make the documented `pnpm dev` command reliably start the API and Web
    development processes together, so session data is available without two
    terminals
  - turn the Session detail page from one long stack of equally weighted
    panels into a progressive, decision-oriented workspace
- expected outcome:
  - one root command starts both long-running applications and server source
    changes restart the API development process
  - the Session page keeps the always-visible identity, token fingerprint, and
    primary KPIs, then separates analysis into clear task-based views so the
    default view answers “how did this run and what should I inspect first?”
- scope:
  1. correct root workspace development-process orchestration and the server
     development watch command
  2. add a four-view Session navigation model: overview, context/cost,
     tools/chain, and normalized evidence
  3. move existing panels into those views without changing metric
     calculations, API contracts, privacy defaults, or evidence semantics
  4. add responsive layout rules, keyboard-visible view controls, and compact
     overview composition while preserving the existing theme and token
     fingerprint identity
  5. synchronize quick-start and current UI descriptions with implemented
     behavior
- affected:
  - `docs/roadmap.md`
  - `package.json`
  - `apps/server/package.json`
  - `apps/web/app/session/[id]/page.tsx`
  - `apps/web/app/layout.tsx`
  - `README.md`
  - `ARCHITECTURE.md`
  - `docs/zh/OVERVIEW.md`
- dependencies and assumptions:
  - the Fastify API remains a separate process on port 3000 and the Next.js
    application remains on port 3001
  - `pnpm` recursive parallel execution is the intended local process manager;
    no new runtime dependency is required
  - existing Session analysis data and evidence endpoints remain authoritative
- risks:
  - hiding panels behind views can reduce discoverability unless view labels,
    counts, and the default overview make the available depth explicit
  - responsive two-column compositions must collapse before tables or charts
    become cramped
  - the existing Session page has historical lint debt owned by T44; this Task
    must not silently broaden into repository-wide lint cleanup
- acceptance:
  - `pnpm dev` starts both `trace-server` and `agent-profile-web` concurrently,
    and server development uses watch mode
  - the Session identity, export actions, token fingerprint, and primary KPIs
    stay visible above the view navigation
  - overview prioritizes diagnosis and decision-useful summaries; context/cost,
    tools/chain, and evidence views contain the existing specialized panels
    with no duplicated long-form sections
  - normalized evidence still omits stored content by default and requires the
    existing explicit bounded-preview action
  - the page is usable at desktop and mobile widths with no new horizontal page
    overflow, and view controls remain keyboard accessible
  - targeted lint/type/build checks, root development smoke checks, and visual
    verification pass in proportion to the change
- verification plan:
  - smoke `pnpm dev` and confirm both ports/health endpoints
  - run changed-file Biome checks plus server and Web production builds
  - verify the Session page in a browser at desktop and mobile widths,
    including view switching and evidence privacy defaults
  - run `git diff --check` and review current-state documentation for stale
    two-terminal or all-panels-at-once claims
- documentation plan:
  - clarify one-command local startup and the separate-process architecture in
    `README.md` and `ARCHITECTURE.md`
  - describe the Session progressive-disclosure views and retained evidence
    limits in the English and Chinese current-state overviews
  - record actual changed files, verification results, design decisions, and
    remaining limitations here before marking T45 completed
- verification:
  - process-selection smoke:
    `pnpm --parallel --stream --filter trace-server --filter
    agent-profile-web exec node -e 'console.log(process.cwd())'` — passed and
    executed once in `apps/server` and once in `apps/web`, confirming both
    long-running package targets are selected by the root orchestration
  - `pnpm --filter trace-server exec tsx watch --help` — passed and confirmed
    the configured watch subcommand; `pnpm --filter trace-server build` —
    passed
  - final Web production build from an isolated copy of the exact source —
    passed, including Next.js lint/type validation and the dynamic
    `/session/[id]` route; final direct Web TypeScript check also passed
  - browser production verification at 1280px — passed: all four view controls
    rendered with their live counts, overview was selected by default,
    context/cost and evidence switching worked, and the focused content
    hierarchy matched the selected view
  - browser responsive verification at 390px — passed: the direct Session page
    reported document width 380px for a 380px client width, with no page-level
    horizontal overflow; overview KPIs used two columns and context/cost,
    efficiency, tool-parameter, and tool-summary grids collapsed to one column
  - evidence privacy check — before entering the evidence view the bounded
    preview control count was zero; after entering, exactly one
    “加载脱敏内容预览” control appeared, confirming the report is mounted on
    demand and content remains opt-in
  - focused Biome checks — package/configuration and documentation inputs
    passed; the new ARIA usage and stabilized chart keys passed their targeted
    rules
  - full checks on the two historical UI files still report the pre-existing
    `dangerouslySetInnerHTML` and whole-file formatter findings assigned to
    T44; this Task did not add suppressions or broaden into that cleanup
  - `git diff --check` — passed
- completion:
  - completed_at: 2026-07-26
  - changed files:
    - `package.json`
    - `apps/server/package.json`
    - `apps/web/app/session/[id]/page.tsx`
    - `apps/web/app/layout.tsx`
    - `README.md`
    - `ARCHITECTURE.md`
    - `docs/zh/OVERVIEW.md`
    - `docs/roadmap.md`
  - result: `pnpm dev` now selects the API and Web packages in parallel and
    server development runs in watch mode; Session detail keeps the identity,
    exports, token fingerprint, and KPI layer fixed while specialized content
    is split into overview, context/cost, tools/chain, and evidence views
  - design decision: retain the current profiler palette and Token fingerprint
    rather than restyling the product; use an instrument-like sticky view rail
    as the single new signature element and mount the privacy-sensitive
    evidence workspace only when selected
  - operational note: a full root launch was not started over the user's
    already-listening 3000/3001 processes; package selection, watch support,
    the existing API, and an isolated production Web process were verified
    instead. Existing separately launched development processes must be
    stopped once before starting the new root command
  - remaining limitation: the overall dashboard shell still preserves its
    desktop sidebar at very narrow widths; the standalone Session route is
    responsive, while a future dashboard-shell Task should decide whether the
    sidebar becomes a drawer on mobile

### T46 Codex import completeness and reliable Web navigation

- status: completed
- purpose:
  - restore missing current Codex projects and sessions by aligning the manual
    scan path and Codex thread identity with the actual rollout format
  - eliminate mixed Next.js development/production artifacts that cause
    missing Webpack chunks and make top-level navigation feel unresponsive
- observed evidence:
  - the local Codex source currently contains 13 rollout JSONL files while the
    database contains only 4 Codex Sessions, all from July 16/21; current
    `agent-profile` and `agent-rules` rollouts from July 26 are absent
  - the Web “重新扫描” action submits only `~/.claude/projects`, although
    startup configuration also knows `~/.codex/sessions`
  - Codex top-level rollouts use matching `payload.id` and
    `payload.session_id`, while child rollouts have a unique `payload.id`, a
    parent `session_id`, and `parent_thread_id`; using only `session_id` makes
    multiple files replace the same stored Session
  - the reported `Cannot find module './58.js'` stack comes from the shared
    `apps/web/.next` development/build output after `next dev` and `next build`
    wrote incompatible artifacts
- scope:
  1. use the Codex rollout thread `id` as the stable Session identity, retain a
     `session_id` fallback for older files, and mark child-thread Spans as
     Sidechain evidence
  2. add parser coverage for top-level and child-thread identity so one rollout
     cannot overwrite another
  3. make the Web manual scan action cover both configured transcript sources
     and aggregate per-source results without changing Zed/MiMo database
     ingestion behavior
  4. isolate the Next.js development output from production `.next`, ignore the
     generated development directory, and repair the current local runtime
  5. provide immediate pending feedback and intent prefetching for top-level
     route navigation so first-load compilation/fetch work is visible
  6. synchronize current startup, scanning, Codex identity, and operational
     documentation
- affected:
  - `docs/roadmap.md`
  - `.gitignore`
  - `apps/web/next.config.js`
  - `apps/web/app/config.ts`
  - `apps/web/app/page.tsx`
  - `apps/web/app/header.tsx`
  - `apps/web/app/layout.tsx`
  - `packages/core/src/parsers/codex.ts`
  - related Core tests
  - `README.md`
  - `ARCHITECTURE.md`
  - `docs/multi-agent.md`
  - `docs/zh/OVERVIEW.md`
- dependencies and assumptions:
  - each Codex rollout `payload.id` is its stable thread identity; legacy
    rollouts without `id` continue to use `session_id`
  - a child thread remains a separate imported Session in the current
    session-centric model, with every generated Span marked Sidechain; merging
    cross-file parent/child Sessions remains a future data-model concern
  - the existing local API/Web processes may be restarted after implementation
    because applying the output-directory change and repairing mixed chunks
    requires a clean development launch
- risks:
  - importing child threads separately increases visible Session counts and
    must not imply they are independent top-level Tasks
  - changing a previously imported child Session from parent `session_id` to
    thread `id` can leave an obsolete parent-keyed revision only when no
    top-level rollout exists; current observed parents have top-level files
  - route prefetching should remain bounded to the small static top navigation
    and must not trigger API mutations
- acceptance:
  - all 13 currently discoverable Codex rollout files import without identity
    collisions; current `agent-profile` and `agent-rules` project groups appear
    in the Session list
  - top-level Codex Sessions use their own thread ID and child Sessions use
    their distinct thread ID with Sidechain Spans
  - one manual “重新扫描” action scans both Claude and Codex transcript
    directories and reports source-aware totals
  - development uses an output directory distinct from production `.next`;
    restarting `pnpm dev` clears the reported missing-chunk runtime error and
    `pnpm build` no longer corrupts the active development output
  - top navigation acknowledges a click immediately, prefetches only the known
    static destinations, and clears pending state after route completion
  - focused Core tests, server/Web type/build checks, runtime API/database
    checks, navigation smoke tests, and documentation checks pass
- verification plan:
  - add deterministic Codex parser tests for top-level and child thread IDs,
    cwd, and Sidechain flags
  - scan the real local Codex directory against the local database and compare
    discovered/imported/session/project counts
  - restart the root development command, verify API health and Web routes,
    then run an isolated production build while development remains active and
    confirm both outputs continue working
  - exercise 会话/画像/迭代/统计 navigation and confirm pending feedback,
    final active state, and no missing-chunk runtime errors
  - run focused Biome checks, `git diff --check`, and current-state
    documentation consistency checks
- documentation plan:
  - document manual multi-source transcript scanning and Codex thread identity
    in current architecture/source-ingestion docs
  - document separate Next.js development/production outputs and the one-time
    clean restart needed after this fix
  - record actual changed files, real local import counts, verification
    results, and remaining cross-file child-parent limitations here before
    completion
- implemented:
  - Codex parsing now prefers `session_meta.id`, falls back to the legacy
    `session_id`, and marks every generated Span from a rollout with
    `parent_thread_id` as Sidechain evidence
  - the parser fixture suite covers top-level, child, and legacy identity
    behavior, including cwd and Span Sidechain flags
  - the Web manual scan runs the Claude Code and Codex transcript sources
    sequentially, identifies the agent explicitly, aggregates all result
    counters, reports the source file counts, and continues with the remaining
    source when one request fails
  - Next.js development output now uses `apps/web/.next-dev`; production
    output remains `apps/web/.next`, and both generated directories are ignored
  - the four static top-level routes are prefetched after an idle delay and on
    hover/focus; a clicked destination immediately receives pending styling and
    a spinner until the pathname changes
  - the old API/Web processes were stopped, only the generated `.next` and
    `.next-dev` directories were removed, and the repaired root development
    command was started successfully
- actual changed files:
  - `.gitignore`
  - `apps/web/next.config.js`
  - `apps/web/tsconfig.json`
  - `apps/web/app/config.ts`
  - `apps/web/app/page.tsx`
  - `apps/web/app/header.tsx`
  - `apps/web/app/layout.tsx`
  - `packages/core/src/parsers/codex.ts`
  - `packages/core/src/__tests__/codex-parser.test.ts`
  - `README.md`
  - `ARCHITECTURE.md`
  - `docs/multi-agent.md`
  - `docs/zh/OVERVIEW.md`
  - `docs/roadmap.md`
- verification:
  - `pnpm --filter @agent-profile/core test -- codex-parser.test.ts` — passed;
    Vitest ran all 14 Core files and 154 tests
  - clean root `pnpm dev` — passed; API listened on `3000`, Web on `3001`,
    server watch mode restarted after a Core parser edit, and startup scanned
    both transcript directories
  - real Codex startup scan — 13 files, 9 imported, 4 updated, 0 failed on the
    first repaired launch; the database then contained 13 distinct Codex IDs
  - real API/database check — 68 total Sessions and 13 Codex Sessions; Codex
    project cwd values include `/Users/guogenyuan/Desktop/agent-profile` and
    `/Users/guogenyuan/Desktop/agent-rules`
  - real Web check — the Session list showed 9 Sessions in `agent-profile` and
    3 in `agent-rules`; the manual action reported
    `Claude Code 55、Codex 13 个文件` with counters totaling all 68 scanned
    files
  - `pnpm build` while `pnpm dev` remained active — passed for Core TypeScript,
    Server TypeScript, and all eight Next.js routes; the active development
    routes remained healthy afterward
  - route smoke — `/`, `/profiles`, `/prompt-review`, and `/stats` returned
    HTTP 200; browser clicks reached the Agent-profile and prompt-review pages,
    set the final active route, and produced no console errors or missing-chunk
    runtime errors
  - focused Biome check for the new parser/test, navigation/config, Next
    config, and tsconfig changes — passed
  - final review hardening — a failed source request no longer prevents the
    other transcript source from scanning; the updated Web production build and
    Core parser suite both passed
  - `git diff --check` and stale current-document operational-claim scan —
    passed
  - root `pnpm lint` still reports the pre-existing repository-wide formatting,
    import-order, security-rule, and unused-code backlog recorded under T44;
    T46 introduced no focused-check failure and intentionally did not absorb
    that unrelated cleanup
- remaining limitations:
  - child Codex rollouts remain separately visible Sessions in the current
    session-centric model; their parent relationship is represented by
    Sidechain Span evidence rather than a persisted cross-file Session graph
  - first visits in Next.js development can still pay normal route compilation
    cost, but bounded prefetching warms the four static destinations and the UI
    now acknowledges clicks immediately

### T47 product documentation and bilingual README

- status: completed
- purpose:
  - make the current local profiler understandable to a new user without
    requiring them to read architecture documents or source code
  - provide a Chinese README equivalent to the user-facing English entry point
  - distinguish verified current behavior from future product work
- scope:
  1. rewrite the English README around installation prerequisites, first run,
     source discovery/import, core views, configuration, data ownership,
     troubleshooting, and explicit product boundaries
  2. add a root-level Chinese README with equivalent current-state claims and
     link the two language entry points
  3. align the Chinese overview and architecture entry points without claiming
     source-health, Task/Outcome, remote deployment, or other unimplemented
     behavior
  4. add a concise documented roadmap of known product gaps and their status
- dependencies and assumptions:
  - documentation describes only behavior already implemented and verified in
    T45–T46 or pre-existing completed Tasks
  - installation remains developer-oriented because no distributable desktop
    package or non-watch local start command exists yet
- risks:
  - a polished README can overstate the product if it does not keep the
    Session-only evidence and missing Outcome boundaries explicit
- acceptance:
  - a new local developer can follow either README through install, launch,
    first import, basic navigation, and recovery from an empty list
  - both language entry points agree on sources, ports, scan behavior, privacy,
    limitations, and current-versus-future boundary
  - no document claims a packaged app, source-health UI, Task/Outcome capture,
    experiment loop, or remote deployment as current behavior
- verification plan:
  - compare README commands and configuration descriptions with package
    scripts, server configuration, and the verified local launch
  - run stale-claim searches across the English and Chinese entry points and
    review the rendered Markdown structure
- documentation plan:
  - update README, add `README.zh-CN.md`, update the Chinese overview, and
    record exact coverage and remaining product gaps here
- implemented:
  - rewrote the English README around requirements, launch, first import,
    source behavior, main views, configuration, local-data boundaries,
    troubleshooting, and current product limits
  - added root-level `README.zh-CN.md` with equivalent user-facing guidance and
    cross-links between English, Chinese, architecture, roadmap, and focused
    documents
  - aligned the Chinese overview with the Chinese README and made the explicit
    current-versus-future boundary visible at each user entry point
  - recorded T48 and T49 as planned follow-on product work instead of claiming
    source-health or Task/Outcome behavior before implementation
- verification:
  - compared all documented launch scripts, ports, scan sources, environment
    variables, database path, and current limitations with `package.json`,
    `apps/server/package.json`, `apps/server/src/config.ts`, `apps/server/src/db.ts`,
    and the verified T45–T46 runtime behavior
  - reviewed both README structures for first-run, empty-state recovery,
    privacy, and explicit current-product boundaries; no code behavior changed
  - `git diff --check` and stale-claim scans across English and Chinese entry
    points — passed
- completion:
  - changed files: `README.md`, `README.zh-CN.md`, `docs/zh/OVERVIEW.md`, and
    `docs/roadmap.md`
  - remaining documentation gap: source-health UI, a non-watch start command,
    Task/Outcome capture, cohort/experiment evaluation, and a distributable
    local app remain planned implementation work under T48–T49 rather than
    documentation claims

### T48 product-ready local operation and first-run onboarding

- status: planned
- purpose:
  - add source health, first-run recovery, stable local launch, and safe
    operational defaults after the documentation baseline is complete
- planned scope:
  - non-watch local start mode, local backup/recovery guidance, and safe
    local-only network defaults
  - retain API compatibility for explicit directory scans or document a safe
    migration path
- decomposition:
  - source-status, initial loading, first-run onboarding, and active import
    progress are implemented and verified independently under T62
  - safe forced rebuild and destructive reset semantics are implemented and
    verified independently under T63
- dependencies and risks:
  - source-path metadata is locally sensitive and must never include transcript
    content; unavailable sources must not prevent API health or existing data
    access

### T49 Task/Outcome, cohort, and experiment foundations

- status: planned
- purpose:
  - implement the missing Task, Configuration Snapshot, Outcome, Task-Session,
    cohort, and experiment model described in the proposal so process metrics
    can be evaluated against explicit results
- dependencies and risks:
  - requires additive schema migrations, explicit missing-versus-failed outcome
    semantics, privacy boundaries for goals/acceptance criteria, APIs, UI, and
    cross-source verification; it must not turn unverified runtime correlation
    into a causal claim

### T50 scale, project intelligence, responsive UX, and local safety

- status: planned
- purpose:
  - keep the profiler usable with long histories and large Sessions while
    making project-level evidence and small-screen workflows practical
- planned scope:
  - project-level cross-Session file/tool trends and explicit parent/child
    Session relationships without inventing missing evidence
  - append-only transcript parsing, scan progress/retry, and virtualized or
    downsampled rendering for large histories
  - responsive dashboard-shell navigation that replaces the fixed desktop
    sidebar at narrow widths; Session discovery and project filtering inside the
    sidebar are implemented independently under T64
  - reviewed local network/API defaults, documented backup/export workflow,
    and authentication/directory-access controls before any remote exposure
- dependencies and risks:
  - requires performance fixtures, measured UI budgets, source-revision
    compatibility, and a separate threat model before changing API exposure

### T51 Agent identity clarity and theme-toggle stability

- status: completed
- purpose:
  - make mixed-agent Session histories scannable at a glance and remove the
    visible jitter around the light/dark theme control
- scope:
  1. replace undersized standalone Agent logos in the Session list, filters,
     selected Session context, and summary views with a reusable, labelled
     Agent mark that combines brand color, a fixed visual container, and an
     appropriately sized icon
  2. use stable, equal-sized SVG icons for the theme control; make the document
     theme attribute the authority for toggle transitions and use a native
     accessible label instead of the global top-edge tooltip
  3. reserve scrollbar gutter space where supported so theme changes cannot
     shift content when browser scrollbar behavior differs
- dependencies and assumptions:
  - Agent colors remain analytical identifiers, not quality rankings
  - no source data, API contract, metric definition, or persisted preference
    changes are required
- risks:
  - visual size changes can crowd dense rows, so all marks must have fixed
    dimensions and the Session list must preserve text truncation behavior
- acceptance:
  - Codex, Claude Code, and MiMo rows and filters remain distinguishable in a
    dense Session sidebar without relying on a 12px standalone logo
  - theme-toggle icon geometry remains fixed across both themes, does not use
    the global `data-tip` overlay, and exposes an accessible action label
  - a local UI smoke test confirms the theme toggle keeps header, viewport, and
    scroll dimensions stable
- verification plan:
  - run web lint and production build
  - run a local browser smoke test with mixed-agent data and compare viewport,
    scrollbar, header, and toggle dimensions before/after a theme change
- documentation plan:
  - record changed files and verification results here; user-facing product
    documentation is unchanged because no workflow or data behavior changes
- implemented:
  - added a reusable fixed-size `AgentMark` that pairs each imported Agent's
    logo with its existing analytical color, a subtle container, and an
    accessible name; applied it to Session filters, Session rows, selected
    Session context, dashboard lists, detail headers, statistics, comparison,
    and process-profile summaries
  - changed the theme control from variable emoji glyphs and a global
    `data-tip` overlay to equal-size SVG glyphs, native accessible labels, and
    document-theme-derived transition state
  - added `scrollbar-gutter: stable` at the document level where browsers
    support it, preventing scrollbar allocation from moving the app shell
- verification:
  - `git diff --check` — passed
  - focused `biome check` for the new Agent mark, theme toggle, dashboard, and
    comparison view — passed
  - `pnpm --filter agent-profile-web build` — passed
  - local browser smoke test with mixed Codex, Claude Code, and MiMo history —
    filters rendered 18px labelled marks and Session rows rendered 20px
    labelled marks; the theme control had no `data-tip` and stayed 30×30
  - measured before/after theme change — Header height, viewport dimensions,
    client dimensions, and scroll dimensions were unchanged
  - repository-wide `pnpm lint` remains blocked by pre-existing T44 findings;
    this Task corrected its own accessible-label issue and added no new lint
    diagnostic in the focused check
- completion:
  - changed files: `apps/web/app/icons.tsx`, `apps/web/app/theme-toggle.tsx`,
    `apps/web/app/layout.tsx`, `apps/web/app/page.tsx`, dashboard, Session
    detail, statistics, comparison, and profile views, plus this roadmap
  - remaining limitation: the fixed desktop sidebar still overflows narrow
    mobile viewports; the responsive navigation redesign remains explicitly
    owned by T50

### T52 schema migration consistency guard

- status: completed
- purpose: prevent base-schema column additions from shipping without a matching
  migration. The `agent` column gap fixed by migration v4 left existing
  `trace.db` databases unable to start because `CREATE TABLE IF NOT EXISTS` does
  not retrofit columns; v4 also broke the existing migration-order assertion,
  which had no guard catching the omission
- scope:
  1. add a database test asserting a fresh `createDatabase(':memory:')` and a
     legacy baseline upgraded through all migrations reach the same column set
     for `sessions`, `spans`, `pricing`, and `model_context`
  2. expand `createLegacyDatabase` to represent the real pre-migration schema
     (current base schema minus every migration-added column) instead of an
     unrelated minimal table, so the consistency check is meaningful
  3. update the existing migration-order and idempotency assertions to include
     migration v4 and the `agent` column default
- affected:
  - `apps/server/src/__tests__/database.test.ts`
  - `docs/roadmap.md`
- acceptance:
  - fresh and migrated-legacy databases produce identical column sets for every
    base-schema table
  - adding a column to `createBaseSchema` without a matching migration, or
    adding a migration without updating `createBaseSchema`, fails the test
  - existing migration tests reflect v1–v4 and remain green
- verification:
  - `pnpm --filter trace-server test` — passed: 6 files / 21 tests; the new
    consistency guard is the 21st test
  - probe check — temporarily adding a column to `createBaseSchema` without a
    matching migration made the consistency test fail with a column-set diff,
    confirming the guard catches the regression class that migration v4 fixed
- risks:
  - the consistency test only guards column presence, not column types, defaults,
    or constraints; documented as a known limitation rather than expanded here
- completion:
  - changed files: `apps/server/src/__tests__/database.test.ts`, `docs/roadmap.md`
  - the consistency test compares a fresh database against a legacy baseline
    upgraded through every migration for all four base-schema tables; the
    legacy baseline was expanded to the real pre-migration column set so the
    comparison is meaningful
- audit (2026-07-27): confirmed completed; migration v4 is present in the
  current database, the fresh-versus-legacy consistency test passes, and the
  full Server suite passes 21/21 tests

### T53 claude transcript cwd and metadata extraction fix

- status: completed
- purpose: `parseTranscript` read `cwd`, `gitBranch`, and `claudeVersion` from
  `sorted[0]`, but entries without a `timestamp` (such as `mode` and
  `file-history-snapshot`) sort to the front and never carry these fields, so
  most Claude Code sessions lost their cwd. The UI then fell back to
  `decodeProject`, which decodes the encoded project directory by replacing
  every `-` with `/` and mis-decodes `agent-profile` to `agent/profile`,
  splitting one project into "agent-profile" and "profile"
- scope:
  1. take `cwd`, `gitBranch`, and `claudeVersion` from the first entry that
     actually carries each field, not from `sorted[0]`
  2. document the `decodeProject` lossy fallback as a known limitation; it is
     not the primary fix because Claude Code's project-directory encoding is
     lossy and cannot be reversed without the original cwd
- affected:
  - `packages/core/src/parsers/claude.ts`
  - `docs/roadmap.md`
- acceptance:
  - Claude Code sessions whose transcript contains a cwd now store it
  - the agent-profile project appears as a single project after re-import
  - existing core tests remain green
- verification:
  - `pnpm --filter @agent-profile/core test` — passed: 7 files / 77 tests
  - transcript probe — the 4 agent-profile transcripts that previously produced
    empty cwd now return cwd=/Users/guogenyuan/Desktop/GitHub/agent-profile,
    gitBranch, and claudeVersion=2.1.218
  - re-import — deleted 158 claude-code sessions with empty cwd; POST
    /api/scan rescanned ~/.claude/projects: 159 imported, 321 updated, 0 failed
  - agent-profile project — all 5 sessions now share
    cwd=/Users/guogenyuan/Desktop/GitHub/agent-profile, no longer split into
    "agent-profile" and "profile"
- completion:
  - changed files: `packages/core/src/parsers/claude.ts`, `docs/roadmap.md`
  - remaining: 7 claude-code sessions still have empty cwd because their
    transcripts contain only metadata rows (mode/permission-mode/last-prompt)
    with no user/assistant turns and no cwd field; these are invalid sessions
    that should be filtered at import, recorded under T56
- risks:
  - already-imported sessions keep their empty cwd until their transcript is
    re-imported; re-import requires a revision change or explicit rescan
- audit (2026-07-27): confirmed completed; the implementation selects the first
  entry carrying each metadata field, the full Core suite passes, and the
  current database has no Claude Code Session with an empty cwd

### T54 session detail right panel overflow and responsive layout

- status: planned
- purpose: the session detail right panel overflows the viewport on common
  screen sizes; the overall layout should fit the screen and overflow content
  should reflow upward instead of being clipped
- scope: to be diagnosed — identify the overflowing panel, cap it to viewport
  height with internal scroll or reflow, verify across breakpoints
- affected: to be determined (likely `apps/web/app/session/`)
- acceptance: right panel content is fully visible without horizontal overflow
  on standard laptop widths; long content scrolls within its region
- verification: to be recorded

### T55 Zed session analysis missing

- status: completed
- purpose: Zed sessions are imported (9 rows) but their analysis is not
  surfaced — suspected Zed parser gap; also all 9 rows have empty cwd
- scope: diagnose the Zed parser pipeline (`packages/core/src/parsers/zed.ts`,
  `apps/server/src/ingestion/zed-adapter.ts`) against the current local payload
  shape, confirm why normalized spans and cwd are absent, implement the smallest
  source-faithful mapping, and add parser/adapter/re-import verification without
  inventing token or project fields the source does not provide
- affected:
  - `packages/core/src/parsers/zed.ts`
  - `packages/core/src/__tests__/zed-parser.test.ts`
  - `apps/server/src/ingestion/zed-adapter.ts`
  - `apps/server/src/__tests__/ingestion.test.ts`
  - `ARCHITECTURE.md`
  - `docs/multi-agent.md`
  - `docs/roadmap.md`
- acceptance:
  - the current Zed JSON payload produces LLM-turn, answer, and paired tool-call
    Spans from captured evidence
  - `request_token_usage` supplies only observed input/output tokens; the parser
    does not estimate usage from text length
  - raw-string and JSON-array `folder_paths` both produce cwd when available
  - malformed/unsupported payloads return not-importable rather than synthetic
    summary evidence
  - parser/adapter tests, real-source probe, Core/Server tests, build, lint, and
    current-state documentation checks pass
- verification:
  - focused Zed parser fixtures — passed for tagged User/Agent messages,
    request-scoped input/output usage, answer text, tool-result pairing, raw
    folder paths, legacy JSON-array folder paths, and malformed payload rejection
  - Server ingestion fixture — passed with the real JSON payload shape rather
    than the obsolete Claude-compatible NDJSON assumption
  - real-source read-only probe — 9/9 Zed rows parsed, all 9 recovered cwd,
    producing 20 LLM-turn, 57 answer, and 114 tool-call Spans with 811,280
    observed input tokens and 7,924 observed output tokens; 0 rows were
    not-importable
  - `pnpm test` — passed: Core 18 files / 168 tests and Server 6 files / 21 tests
  - `pnpm build` — passed: Core/Server TypeScript and Next.js production build
  - focused Biome, full repository lint, and `git diff --check` — passed; full
    lint reported 19 existing warnings and 2 informational diagnostics, with no
    errors
- documentation plan:
  - replace the stale compressed-NDJSON description in `ARCHITECTURE.md` and
    `docs/multi-agent.md` with the implemented Zed JSON message/token/tool
    mapping and explicit coverage limits
- completion:
  - completed_at: 2026-07-27
  - changed files: `packages/core/src/parsers/zed.ts`,
    `packages/core/src/__tests__/zed-parser.test.ts`,
    `apps/server/src/__tests__/ingestion.test.ts`, `ARCHITECTURE.md`,
    `docs/multi-agent.md`, and `docs/roadmap.md`
  - result: current Zed records now produce source-faithful analysis and project
    grouping; unsupported records remain visibly not importable, and missing
    token classes/timing are not fabricated

### T56 Codex invalid session filtering

- status: completed
- purpose: some imported Codex and Claude Code sessions are invalid (empty or
  non-actionable — e.g. Claude Code transcripts with only
  mode/permission-mode/last-prompt rows and no LLM turns, or Codex sessions
  with no usable turns); need to define and enforce a validity filter at
  import time
- scope:
  1. treat a parsed source item with no normalized Span as not importable while
     retaining zero-token LLM turns when the source genuinely reports no usage
  2. return structured `skipReasons` that distinguishes an unchanged revision
     from a source item that produced no importable Session
  3. add focused Claude, Codex, and MiMo parser fixtures plus coordinator result
     tests without hiding the separate Zed parser failure owned by T55
- affected:
  - `packages/core/src/types.ts`
  - `packages/core/src/parsers/{claude,codex,mimo}.ts`
  - `packages/core/src/__tests__/parser-validity.test.ts`
  - `apps/server/src/ingestion/import-coordinator.ts`
  - `apps/server/src/__tests__/ingestion.test.ts`
  - `ARCHITECTURE.md`
  - `docs/multi-agent.md`
  - `docs/roadmap.md`
- acceptance: invalid source items are skipped at import with a counted
  `not_importable` reason, unchanged revisions are counted separately, and
  valid Sessions—including captured LLM turns with genuinely zero usage—remain
  unaffected
- implementation:
  - added `if (spans.length === 0) return null` before the return in the
    claude, codex, and mimo parsers; sessions with no LLM turns now yield null
    and are skipped by the import coordinator's existing `!loaded` branch
  - zed is intentionally left out because its span generation is broken (T55);
    filtering empty zed sessions now would hide that bug instead of fixing it
- verification:
  - `pnpm --filter @agent-profile/core test` — passed: 7 files / 77 tests
  - deletion — removed 51 invalid sessions (claude-code 27, codex 15, mimo 9)
    that had zero spans; only zed's 9 remain (T55 owns zed)
  - re-import — POST /api/scan on ~/.claude/projects and ~/.codex/sessions:
    claude 2 imported / 323 updated, codex 4 imported / 0 updated, 0 failed;
    the deleted invalid sessions were not re-imported because the parsers now
    return null on empty spans
  - remaining message_count=0: only zed 9 (intentionally untouched)
- implementation:
  - changed files: `packages/core/src/parsers/claude.ts`, `codex.ts`, `mimo.ts`,
    `docs/roadmap.md`
  - the filter is in each parser's return path
    (`if (spans.length === 0) return null`); the import coordinator's existing
    `!loaded` branch handles the skip and counts it as `skipped`, not `failed`
  - Zed was initially excluded from this Task because its separate span mapping
    was broken; T55 subsequently fixed that parser and applies the same
    not-importable outcome to unsupported Zed payloads
- audit before completion (2026-07-27): the original implementation was not
  complete against the recorded acceptance criteria;
  `importFromSource` increments the aggregate `skipped` count when a parser
  returns null but exposes no reason or source-item outcome, so invalid Sessions
  are not reported with the required counted reason. Focused fixtures for empty
  Claude/Codex/MiMo inputs and the scan-result reason contract are also still
  required. Current database evidence confirms only the partial effect: all
  remaining zero-span Sessions are the 9 known Zed rows owned by T55
- documentation plan:
  - update the current scan/import contracts in `ARCHITECTURE.md` and
    `docs/multi-agent.md` with the structured skip-reason semantics before
    closing the Task
- final verification:
  - parser validity fixtures — passed for metadata-only Claude and Codex inputs
    and a MiMo history with no assistant turn; all return null
  - coordinator result tests — passed for imported, updated, unchanged,
    not-importable, and thrown-failure outcomes; `skipReasons` distinguishes
    `unchanged_revision` from `not_importable`
  - `pnpm test` — passed: Core 15 files / 159 tests and Server 6 files / 21 tests
  - `pnpm build` — passed: Core/Server TypeScript and Next.js production build
  - focused Biome and `git diff --check` — passed; repository lint retains its
    existing warning/info baseline with no errors
- completion:
  - completed_at: 2026-07-27
  - changed files: `packages/core/src/types.ts`,
    `packages/core/src/parsers/{claude,codex,mimo}.ts`,
    `packages/core/src/__tests__/parser-validity.test.ts`,
    `apps/server/src/ingestion/import-coordinator.ts`,
    `apps/server/src/__tests__/ingestion.test.ts`, `ARCHITECTURE.md`,
    `docs/multi-agent.md`, and `docs/roadmap.md`
  - result: invalid source items remain non-fatal skipped imports but now expose
    a machine-readable reason distinct from unchanged revisions; valid captured
    turns are not rejected solely because token usage is zero

### T57 context window utilization clarity and data provenance

- status: completed
- purpose: the "窗口利用率" metric is shown without a definition, and the
  window limit comes from a built-in `model_context` seed rather than the
  transcript, but that provenance is not surfaced — users may mistake the
  limit for measured data; the "(窗口未配置)" fallback also lacks explanation
- scope:
  1. add an inline definition for window utilization
     (contextTokens ÷ model context window) where it appears
  2. label the window limit as a built-in estimate with its source
  3. reword "(窗口未配置)" to explain why and how to configure it
- affected:
  - `apps/web/app/session/[id]/page.tsx`
  - `docs/roadmap.md`
- acceptance:
  - window utilization has a visible definition in the UI
  - window limit is labeled as built-in estimate, not measured
  - "(窗口未配置)" explains the cause and points to configuration
- verification:
  - `biome check apps/web/app/session/[id]/page.tsx` — passed, no issues
  - `pnpm --filter agent-profile-web build` — passed; /session/[id] route built
- completion:
  - changed files: `apps/web/app/session/[id]/page.tsx`, `docs/roadmap.md`
  - the Card meta now labels the window limit as "窗口上限·内置估算"; the
    legend "利用率" has a data-tip defining it as peak context ÷ model window
    (built-in estimate, not transcript-measured); "(窗口未配置)" now reads
    "（该模型未内置窗口上限）" with a tip explaining the model is not in
    `model_context`
- audit (2026-07-27): confirmed completed; all three UI acceptance points are
  present in the current Session page, the focused lint check is clean, and the
  current Web production build includes `/session/[id]`

### T58 window context limits alignment with official sources

- status: completed
- started_at: 2026-07-27
- purpose: `db.ts` seeds `model_context` with built-in window sizes, but some
  may be outdated (e.g. `qwen-max` 32K while latest is 128K); the UI now labels
  these as "内置估算" (T57), so the values should match official vendor specs
- scope: audit each seeded model's `context_window` against official docs and
  update the seed; add a source comment per model; preserve user-edited rows
  through the existing `INSERT OR IGNORE` behavior
- affected: `apps/server/src/db.ts`, pricing/configuration tests,
  `ARCHITECTURE.md`, `docs/roadmap.md`
- acceptance: seeded window limits match official vendor specs as of the update;
  every non-obvious seed has an auditable source/version note; no existing
  user-edited model-context row is overwritten by startup seeding
- verification plan: focused seed/database test, source/version review,
  Server build, full test/lint, and `git diff --check`
- documentation plan: record final values, source dates, and the difference
  between built-in seed data and source-observed context in architecture docs
- implementation:
  - audited the 20 built-in rows against the vendor model catalog entry points
    referenced beside the seed; corrected `qwen-max` from 32,768 to 131,072
  - retained `INSERT OR IGNORE`, so startup only seeds missing rows and never
    overwrites a user-managed model context setting
- verification:
  - source/version review — completed against the vendor catalog entry points
    recorded with the seed, as of 2026-07-27
  - `pnpm --filter trace-server build` — passed
  - focused Biome and `git diff --check` — passed
- completion:
  - changed files: `apps/server/src/db.ts`, `ARCHITECTURE.md`,
    `docs/roadmap.md`
  - result: newly initialized databases seed `qwen-max` at 131,072 tokens;
    existing local values remain unmodified and therefore user-configurable

### T59 opencode session scan adapter

- status: planned
- purpose: opencode stores sessions in `~/.local/share/opencode/opencode.db`
  (SQLite), but no adapter or scan path exists — 0 opencode sessions imported
- scope: add an `OpenCodeSourceAdapter` reading `opencode.db`, register it in
  the startup scan alongside MiMo and Zed
- affected: `apps/server/src/ingestion/`, `apps/server/src/index.ts`,
  `apps/server/src/routes/scan.ts`
- acceptance: opencode sessions are discovered, parsed, and imported like other
  sources

### T60 codex token extraction fallback

- status: completed
- purpose: the codex parser reads `last_token_usage.input_tokens` /
  `output_tokens`, but some turns have those classified fields as 0 while
  `total_tokens > 0`; 47 of 61 codex sessions ended up zero-token because of
  this
- scope: when classified tokens are all zero but `total_tokens` exists, fall
  back to `total_tokens` as input so the turn is not recorded as zero-token;
  mark the Span metadata as an unclassified `total_tokens` fallback so callers
  can distinguish the approximation from source-classified input
- affected:
  - `packages/core/src/parsers/codex.ts`
  - `packages/core/src/__tests__/codex-parser.test.ts`
  - `ARCHITECTURE.md`
  - `docs/multi-agent.md`
  - `docs/roadmap.md`
- acceptance: codex turns with only `total_tokens` now record non-zero tokens;
  existing non-zero turns are unaffected; fallback turns carry explicit
  provenance and are not presented as source-classified usage
- verification:
  - focused Codex fixture — passed for a turn with zero classified fields and
    `total_tokens=1234`; the Span records 1234 fallback input tokens plus
    `tokenUsageSource=total_tokens_fallback` and
    `tokenUsageClassified=false`
  - classified-token regression fixture — passed; input=100, cache-read=40,
    output+reasoning=25 remain in their original classes and carry no fallback
    metadata
  - real-source parser probe — 80 rollout files produced 64 valid Sessions; 47
    Sessions/47 turns used the explicit fallback, 74 classified turns remained
    classified, and only one Session with a source token-count event still had
    zero usage outside this Task's fallback condition
  - `pnpm test` — passed: Core 14 files / 156 tests and Server 6 files / 21 tests
  - `pnpm build` — passed: Core/Server TypeScript and Next.js production build
  - focused Biome check and `git diff --check` — passed; repository lint retains
    its existing 21 warnings and 2 informational diagnostics with no errors
- documentation plan:
  - document the fallback's unclassified provenance and its cost/context
    interpretation limits in the current architecture and multi-source
    normalization contract before closing the Task
- completion:
  - completed_at: 2026-07-27
  - changed files: `packages/core/src/parsers/codex.ts`,
    `packages/core/src/__tests__/codex-parser.test.ts`, `ARCHITECTURE.md`,
    `docs/multi-agent.md`, and `docs/roadmap.md`
  - result: real Codex total-only token usage is retained instead of becoming a
    zero-token turn, while classified usage remains unchanged and fallback
    provenance stays machine-readable
  - operational note: existing persisted Sessions keep their previous token
    totals until their source revision changes or T63 provides a safe forced
    rebuild; deleting the generated database is not required or recommended

### T61 current-task completion audit and data-UX task decomposition

- status: completed
- purpose: verify that the most recently completed Tasks satisfy their recorded
  acceptance criteria and completion gate, correct stale lifecycle claims, and
  turn the identified loading/onboarding, rebuild/reset, and Session-navigation
  work into explicit independently executable Tasks
- scope:
  1. audit T52–T60 against the current diff, database evidence, tests, build,
     lint, and each Task's stated acceptance criteria
  2. correct any Task whose recorded status or completion evidence does not
     match the implementation
  3. remove contradictory current execution-order claims
  4. add separate planned Tasks for initial loading/onboarding, safe data
     rebuild/reset, and Session navigation without mixing their acceptance gates
- affected:
  - `docs/roadmap.md`
- acceptance:
  - every T52–T60 status matches the evidence available in the current working
    tree
  - incomplete acceptance criteria remain explicitly open rather than being
    reported as completed
  - the three UX workstreams have independent purpose, scope, risks,
    acceptance criteria, verification plans, and documentation plans
  - the execution-order summary agrees with the detailed Task bodies
- verification:
  - current implementation audit — T52 migration/test guard, T53 metadata
    extraction, and T57 window-provenance UI each satisfy their recorded
    acceptance criteria; T54, T55, T58, and T59 have no completion claim and
    correctly remain planned
  - T56 audit — parser-level empty-span filtering exists, but the coordinator
    returns only an undifferentiated `skipped` count and has no focused reason
    contract tests; status corrected from `completed` to `in_progress`
  - T60 audit — fallback code exists, but the branch lacks a focused fixture and
    47 current Codex Sessions remain zero-token; status remains `in_progress`
  - `pnpm test` — passed: Core 14 files / 154 tests and Server 6 files / 21 tests
  - `pnpm lint` — passed with the existing 21 warnings and 2 informational
    diagnostics, no errors
  - `pnpm build` — passed: Core and Server TypeScript plus the Next.js production
    build including `/session/[id]`
  - database evidence — migrations v1–v4 are applied; no current Claude Code
    Session has an empty cwd; the only zero-span rows are the 9 Zed Sessions
    already assigned to T55
  - Task-ID uniqueness/status scan and `git diff --check` — passed
- documentation plan:
  - update only `docs/roadmap.md`; no runtime behavior, API, schema, generated
    database, or user-facing current-state claim changes in this audit Task
- completion:
  - completed_at: 2026-07-27
  - changed files: `docs/roadmap.md`
  - result: recent completion claims now match their acceptance evidence, T56
    is explicitly reopened, T48/T50 overlapping umbrella scope is decomposed,
    and T62–T64 independently own loading/onboarding, rebuild/reset, and flat
    Session navigation

### T62 initial data loading, source status, and first-run onboarding

- status: completed
- started_at: 2026-07-27
- completed_at: 2026-07-27
- purpose: make application startup immediately understandable and useful by
  removing duplicate/N+1 loading work, exposing background-import state, and
  guiding a first-time user from source discovery through a successful import
- expected outcome:
  - returning users see existing Sessions immediately while synchronization runs
    unobtrusively in the background
  - first-time users see which supported sources are available, what is being
    imported, and how to recover from an unavailable or failed source
- scope:
  1. introduce one server-owned import-job/source-status model shared by startup
     and manual scans, with per-source idle/scanning/completed/failed state,
     discovered/imported/updated/skipped/failed counts, and last completion time
  2. expose bounded local status APIs without returning transcript content or
     unnecessarily revealing full source paths
  3. make the Home page own the initial Session/overview data instead of having
     Home and Dashboard issue duplicate requests
  4. replace Stats model extraction and recent-tool loading N+1 requests with
     set-based server aggregation; the browser must not request tools once per
     recent Session during initial Dashboard loading
  5. add reserved-size skeletons and a first-run state flow for source detection,
     import progress, per-source recovery, and completion summary
  6. keep existing data interactive during background synchronization, poll
     only while a job is active, and refresh affected data once on completion
- dependencies and assumptions:
  - reuse the current adapter/coordinator/repository ingestion boundary and do
    not move source-specific logic into the Web application
  - stage-level and per-source progress are sufficient initially; exact
    per-record percentage requires coordinator progress callbacks and must not
    be fabricated
  - T55 supplies normalized Zed analysis; source-status handling in this Task
    still needs to represent any future source-specific import failure
- risks:
  - concurrent startup and manual scans can race unless the job manager dedupes
    or serializes the same source
  - local source availability and paths are sensitive metadata; status responses
    must expose only what the UI needs
  - permanent polling would recreate the request churn removed earlier, so
    polling must stop in every terminal state and on unmount
- acceptance:
  - initial Home/Dashboard rendering performs no duplicate Session/Stats fetch
    and no per-Session tool requests
  - Stats and dashboard aggregates use bounded set-based database queries rather
    than one model/tool query per Session
  - an empty database shows a source-aware onboarding action, not a generic
    empty Session list that can remain stale while startup import finishes
  - returning users retain visible existing data and receive accessible,
    per-source progress and completion/error feedback
  - startup and manual scans share the same observable job state, cannot run the
    same source concurrently, and automatically refresh the UI once completed
  - loading, empty, partial failure, total failure, retry, and success states are
    covered by Server/Web tests and responsive browser verification
- implementation:
  - added one `ImportJobManager` for startup and Web-triggered synchronization;
    it tracks privacy-bounded per-source availability/state/results/timestamps,
    deduplicates a source already in flight, isolates failures, and omits paths,
    transcript content, and source Session IDs from public status
  - added `GET /api/imports/status` and asynchronous `POST /api/imports`; retained
    `POST /api/scan` for explicit-directory compatibility and joined known
    default-source scans to the same in-flight work
  - replaced the Stats per-Session model loop and the browser's 30 sequential
    tool requests with two set-based Span queries
  - made Home the single Sessions/Stats/import-status owner; Dashboard now
    receives data as props, polling is serialized and exists only while a job is
    active, and terminal transition refreshes data once
  - added reserved-size skeletons, source-aware first-run cards, accessible live
    status, retry/re-detection actions, and stale-while-sync behavior
  - added a narrow-screen Home layout that stacks the bounded Session browser
    above the Dashboard instead of leaving the content panel outside the
    viewport; desktop keeps the existing two-column layout
- verification completed:
  - import-job tests — passed for source deduplication, failure isolation,
    unavailable sources, retry, terminal state, and public Session-ID omission
  - import-route tests — passed for four-source bounded status, stored counts,
    local-path omission, and invalid-source rejection
  - set-based aggregation spy — passed: model and recent-tool data use exactly
    two queries for a 400-Session logical fixture
  - Web state/request tests — passed: 2 files / 3 tests cover loading, empty,
    unavailable, scanning, partial failure, retry labels, success summary, and
    exactly three initial requests with no `/tools` request
  - isolated T62 commit verification passed: Core 18 files / 170 tests and
    Server 9 files / 26 tests; the final tree after T65 passes Core 18 / 170 and
    Server 9 / 27
  - `pnpm build` — passed: Core/Server TypeScript and Next.js production build
  - `pnpm lint` — passed with the existing 19 warnings and 2 informational
    diagnostics, no errors; `git diff --check` passed
  - live browser verification passed against the running API/Web services:
    initial skeletons were visible, an active four-source synchronization
    disabled the scan action and exposed an accessible live status, and terminal
    completion refreshed the stored data and showed the aggregate result
  - responsive browser verification passed at 390×844 and 1280×720. The mobile
    viewport has no horizontal overflow (`scrollWidth=380`, `innerWidth=390`),
    exposes both the bounded Session list and Dashboard in document flow, and
    the desktop viewport retains the two-column layout with
    `scrollWidth=innerWidth=1280`; browser warning/error logs were empty
- remaining limitations:
  - T63 owns forced analysis rebuild and full reset; the T62 refresh action only
    reloads stored API data, while synchronization imports source revisions
  - T64 owns flat recent-Session navigation and project filtering; T62 keeps the
    current project tree but makes it usable without horizontal overflow on
    narrow screens
- changed files so far:
  - `apps/server/src/ingestion/import-job-manager.ts`,
    `apps/server/src/{config,index}.ts`, `apps/server/src/routes/{scan,stats}.ts`,
    and focused Server tests
  - `apps/web/app/config.ts`, `dashboard.tsx`, `home-data.ts`,
    `import-state.ts`, `page.tsx`, `layout.tsx`, and focused Web tests
  - `README.md`, `README.zh-CN.md`, `ARCHITECTURE.md`,
    `docs/multi-agent.md`, `docs/zh/OVERVIEW.md`, and `docs/roadmap.md`
- verification plan:
  - Server route/job-manager tests for state transitions, source isolation,
    deduplication, failure recovery, and privacy-safe responses
  - query-count or repository-spy tests proving set-based Stats/tool aggregation
  - Web tests for first-run, returning-user background sync, partial failure,
    retry, and polling teardown
  - measure initial request count and render behavior with empty, 400-Session,
    and active-scan fixtures; run `pnpm test`, `pnpm lint`, and `pnpm build`
- documentation plan:
  - update `README.md`, `README.zh-CN.md`, `ARCHITECTURE.md`,
    `docs/multi-agent.md`, and `docs/zh/OVERVIEW.md` with final source-status,
    startup, progress, privacy, and recovery behavior

### T63 safe analysis rebuild and local-data reset

- status: planned
- purpose: let users intentionally regenerate derived analysis after parser,
  pricing, or metric changes without deleting the database by hand, while
  keeping destructive reset behavior explicit and recoverable where possible
- expected outcome:
  - normal recovery uses a safe forced rebuild that preserves user-authored and
    configuration data; full local reset is a separate danger-zone operation
- scope:
  1. define four distinct operations in API and UI: refresh stored data,
     incremental synchronization, forced analysis rebuild, and full local reset
  2. add a coordinator/repository rebuild mode that bypasses matching source
     fingerprints and atomically replaces generated Session/Span analysis
  3. preserve Session tags/notes and retain pricing/model-context configuration
     during forced rebuild; explicitly document what full reset preserves or
     removes before implementing its transaction
  4. reuse T62 job state for per-source rebuild progress, failures, retry, and a
     final source-aware result summary
  5. add a Data Management surface with a recommended rebuild action and a
     spatially separated danger zone for destructive reset
  6. require an explicit confirmation describing affected row counts and offer
     export/backup guidance before irreversible deletion
- dependencies and assumptions:
  - depends on T62's import-job/source-status model
  - source histories remain the rebuild authority; unavailable sources must not
    cause already stored Sessions to disappear during a normal rebuild
  - a rebuild is not a schema downgrade and must not delete migration history
- risks:
  - delete-then-import can lose good data on partial source failure; normal
    rebuild must replace each successfully parsed Session atomically instead
  - Session annotations can be lost if rows are deleted instead of replaced
  - an unrestricted directory/reset API would expand the local security surface
- acceptance:
  - forced rebuild reprocesses unchanged source revisions and reports per-source
    imported/updated/skipped/failed outcomes
  - tags, notes, pricing, model-context configuration, schema migrations, and
    successfully stored Sessions from unavailable sources survive normal rebuild
  - rebuild failure leaves the previous normalized Session intact
  - destructive reset cannot be triggered by the ordinary sync/rebuild action,
    requires an explicit confirmation, and returns exactly what was deleted and
    retained
  - the UI disables conflicting actions while a job is active and provides a
    clear recovery path for partial and total failure
- verification plan:
  - repository/coordinator integration tests for forced revision bypass,
    atomic replacement, annotation/config preservation, and failure rollback
  - API validation and destructive-confirmation tests, including concurrent job
    rejection and unavailable-source behavior
  - Web interaction tests for rebuild, danger-zone reset, cancellation before
    confirmation, progress, completion, and retry
  - backup/recovery smoke check plus `pnpm test`, `pnpm lint`, and `pnpm build`
- documentation plan:
  - update `README.md`, `ARCHITECTURE.md`, `AGENTS.md`,
    `docs/multi-agent.md`, and `docs/zh/OVERVIEW.md` with final rebuild/reset,
    preservation, security, migration, and recovery semantics

### T64 flat Session navigation and project filtering

- status: planned
- purpose: remove the need to expand or collapse every project folder when
  finding a Session, while retaining project context and making large mixed-Agent
  histories faster to scan
- expected outcome:
  - recent Sessions are reachable directly from a flat chronological list;
    projects become a searchable filter and summary view rather than mandatory
    accordion navigation
- scope:
  1. replace the default all-projects-expanded tree with a flat recent Session
     list grouped by lightweight time boundaries and showing project as
     secondary row metadata
  2. add a searchable project selector with Session counts and an all-projects
     option; provide a project-summary mode that filters into the same flat list
  3. retain Agent, search, sort, anomaly, and unpriced discovery as composable
     filters, with clear active-filter and empty-result recovery states
  4. preserve project/Agent/query/sort/quick-view state in the URL and restore
     scroll/selection state when returning from a Session
  5. keep grouped-by-project display only as an optional view if user testing
     demonstrates value; it must not default to every group expanded
  6. virtualize or incrementally render the Session list when measured fixtures
     exceed the agreed DOM/render budget
- dependencies and assumptions:
  - depends on T62's single Home-page data owner so navigation does not create a
    second loading pipeline
  - T50 continues to own replacement of the overall fixed desktop sidebar on
    narrow mobile layouts; this Task owns discovery inside the current shell
- risks:
  - removing visible folders can hide project context unless every Session row
    carries a concise project label and the active project filter remains visible
  - URL state can become noisy; only stable shareable filters should be encoded
  - virtualization must preserve keyboard navigation, selection, and restored
    scroll position
- acceptance:
  - a user can open any recent Session without expanding a project folder
  - selecting or searching a project filters one flat Session list and provides
    a one-action path back to all projects
  - the default view never renders all project accordions expanded
  - search, project, Agent, quick view, and sort compose predictably and survive
    deep-link/reload/back navigation
  - keyboard focus, selected state, labels, touch targets, and empty-result
    recovery meet the existing accessibility conventions
  - desktop and narrow-width checks with at least 400 Sessions show no page-level
    horizontal overflow or unbounded DOM growth
- verification plan:
  - Web component tests for filter composition, URL restoration, selection,
    empty-result recovery, and keyboard behavior
  - browser verification with recent, project-filtered, anomaly, and unpriced
    flows at desktop and mobile widths
  - render/DOM measurement with a 400+ Session fixture; run focused lint plus
    `pnpm test` and `pnpm build`
- documentation plan:
  - update `README.md`, `ARCHITECTURE.md`, `docs/ui-guidelines.md`, and
    `docs/zh/OVERVIEW.md` with the final Session discovery and project-filtering
    behavior

### T65 Codex Desktop VS Code history rollout compatibility

- status: completed
- started_at: 2026-07-27
- completed_at: 2026-07-27
- purpose: prevent Codex Desktop external-history materializations from becoming
  misleading profiler Sessions when they lack trustworthy project and
  structural runtime evidence, while retaining normal Codex rollouts
- expected outcome:
  - Codex Desktop `external-import-turn-*` histories are reported as excluded
    source records rather than Codex Sessions, because their project, model,
    token classes, and structural tool evidence are not trustworthy
  - no false Codex folder appears under `im` and no projectless migrated history
    pollutes Agent/tool/session aggregates
- scope:
  1. classify the observed Codex Desktop external-history shape using structural
     evidence: `source=vscode`, `originator=Codex Desktop`, no `turn_context`,
     and `external-import-turn-*`; do not classify from prompt keywords
  2. return no ParsedSession for that shape, so raw prompts, text-wrapped tools,
     guessed cwd, fabricated model/token fields, and duplicate Agent counts do
     not enter profiler evidence
  3. retain normal current Codex response-message answer handling without
     double-counting mirrored `event_msg:agent_message` records
  4. version the Codex transcript revision fingerprint so already imported
     unchanged files are reprocessed once through the normal coordinator and
     atomic repository path after this parser interpretation change
  5. extend the source/coordinator/repository result contract so a recognized
     non-actionable source record can remove its prior generated Session/Spans
     only when it has no user tags or notes, and report the cleanup count
  6. expose cleanup counts in import status/summary UI and verify parser,
     coordinator, annotation safety, current-format regression, and all 47 real
     external-import source files
- dependencies and assumptions:
  - T63 remains the owner of a general user-facing forced rebuild; this Task may
    use a bounded local re-import/revision refresh for verification but must not
    add or imply a destructive reset workflow
  - `source=vscode` alone is not enough because normal Codex Desktop sessions
    use it too; exclusion requires the complete external-import record shape
  - user-confirmed ground truth is that the local `im` project has no Codex
    Sessions; the 13 rollouts share a migration timestamp and their embedded
    histories span unrelated work, so their common `cwd=im` is not project
    evidence
- risks:
  - current live rollouts can expose both response items and event messages;
    answer extraction must not double count equivalent evidence
  - external histories may contain useful human-readable conversation text, but
    without trustworthy runtime/project/tool structure they do not meet the
    profiler's evidence threshold; source history remains untouched on disk
  - removing a generated Session can destroy user annotations; cleanup must
    refuse annotated rows. The current 47 external-import Codex rows have zero
    tags and zero notes, so the bounded cleanup does not remove user-authored
    data
  - unchanged source fingerprints will not automatically replace already stored
    derived analysis before T63 provides a supported forced-rebuild mode;
    T65 therefore needs one source-specific parser revision bump, not a general
    rebuild or destructive reset API
- acceptance:
  - an observed external-import fixture is classified as non-actionable and does
    not produce a ParsedSession, prompt metadata, answer/tool Spans, or cwd
  - a normal current Codex rollout remains importable with its real cwd,
    reasoning, tokens, call IDs, Sidechain state, and answer evidence intact
  - the Codex fingerprint revision changes once, causing existing Codex files to
    be atomically updated on the next ordinary import while preserving Session
    annotations; unchanged files skip normally after that successful refresh
  - current Codex reasoning, token, sidechain, and custom-tool fixtures remain
    unchanged and no answer is duplicated when both supported answer record
    forms are present
  - all 47 local `external-import-turn-*` Codex rollouts are excluded; the 13
    stamped with `cwd=im` and the other projectless copies disappear from stored
    Session/project/Agent/tool aggregates after ordinary import
  - previously stored unannotated excluded Sessions and their Spans are removed
    atomically and reported; an annotated excluded Session is retained and the
    cleanup is reported as failed rather than silently deleting annotations
  - Core tests, the relevant full test/build checks, a restarted API/Web smoke
    test, and an `im` data check pass; actual files and results are recorded
- implementation:
  - added a structural external-history classifier shared by the Codex parser
    and transcript adapter; classified records produce an explicit excluded
    source outcome and no ParsedSession
  - added `removed` and `excluded_non_actionable` import results, with Web
    completion copy that distinguishes skipped records from cleaned stored rows
  - added repository cleanup that atomically removes Spans then Session only
    when tags and notes are empty; annotated rows remain and count as failures
  - bumped only the Codex transcript fingerprint to `codex-v2`, causing one
    ordinary re-evaluation while Claude transcript fingerprints remain stable
  - retained stable same-timestamp ordering and current Codex assistant-message
    answer extraction; modern context snapshots remain one turn with real cwd
- verification completed:
  - Core suite passed: 18 files / 170 tests; external imports return null while
    current Codex Desktop context/message behavior retains cwd and one turn
  - Server suite passed: 9 files / 27 tests; fingerprint refresh removes an
    unannotated prior Session, reports cleanup, and refuses an annotated row
  - focused Web state suite passed: 1 file / 2 tests, including the visible
    skipped/cleaned completion summary; focused Biome passed
  - full `pnpm test` and `pnpm build` passed; full lint completed with zero
    errors, 19 pre-existing warnings, and 2 pre-existing informational findings;
    `git diff --check` passed
  - real source audit found exactly 47 `external-import-turn-1` rollout files;
    hot-reload startup import removed all 47 unannotated generated Sessions
  - database post-check: Codex decreased from 67 to 20, projectless Codex from
    47 to 0, `im` Codex from 13 to 0, and all 20 retained Codex Sessions have an
    LLM turn
  - a later ordinary synchronization imported 8 newly created valid Codex
    Sessions; the final recheck is Codex 28, `im` Codex 0, projectless Codex 0,
    and 28/28 retained Codex Sessions with an LLM turn
  - API and Web development processes remained listening on ports 3000 and
    3001 after hot reload; direct localhost HTTP inspection remained unavailable
    under the current environment policy and is already tracked by T62's UI
    runtime verification rather than this parser/data-correctness repair
- changed files so far:
  - `packages/core/src/{index,types}.ts`,
    `packages/core/src/parsers/codex.ts`, and focused parser tests
  - `apps/server/src/ingestion/{types,transcript-adapter,import-coordinator,
    import-job-manager,session-repository}.ts` and focused ingestion/job tests
  - `apps/web/app/{config,import-state}.ts` and focused state tests
  - `ARCHITECTURE.md`, `README.md`, `README.zh-CN.md`,
    `docs/zh/OVERVIEW.md`, and `docs/roadmap.md`
- remaining limitations:
  - annotated historical copies are intentionally retained rather than deleted;
    their cleanup is reported as failed so the user can resolve the annotation
    explicitly
  - T63 still owns the reusable forced rebuild and full local-reset workflows;
    T65 only performs the one-time Codex parser fingerprint refresh needed for
    this evidence correction
- verification plan:
  - focused parser/import tests for structural classification, normal Codex
    regression, one-time fingerprint refresh, atomic cleanup, annotation refusal,
    result privacy, and Web summary text
  - audit all local external-import files and stored Codex project/turn counts
  - run full tests, lint, production build, diff checks, and service health checks
- documentation plan:
  - update `ARCHITECTURE.md`, `README.md`, `README.zh-CN.md`,
    `docs/zh/OVERVIEW.md`, and this roadmap with the implemented compatibility,
    evidence limits, verification results, and any deferred rebuild requirement

### T66 source-session anomaly and overlap audit

- status: completed
- started_at: 2026-07-27
- completed_at: 2026-07-27
- purpose: diagnose the user-reported Zed folder/project mismatch, Claude Code
  projectless rows, MiMo Code/OpenCode overlap question, unrecognized models,
  and any currently invalid normalized Sessions before changing parsing or
  presentation behavior
- scope:
  1. inspect local profiler rows and their source records read-only, grouped by
     source, cwd, model, span count, and evidence revision
  2. compare MiMo Code and OpenCode storage schemas/paths and determine whether
     they represent the same source or separate runtimes; do not add an
     OpenCode importer in this diagnostic Task
  3. trace every anomalous row to a parser/adaptor/UI boundary and distinguish
     missing source evidence from a parser defect, stale persisted result, or
     unsupported source shape
  4. record reproducible counts, root causes, and which follow-up Task owns
     every confirmed issue; update Task scope before any repair broadens it
- affected:
  - `docs/roadmap.md`
  - read-only local source databases and generated profiler database only
- dependencies and assumptions:
  - source transcripts/databases remain authoritative and must not be altered
  - a normal synchronization may be used only after a confirmed parser revision
    change in a later Task; this audit itself does not mutate stored evidence
- risks:
  - local source applications can change their schemas; conclusions must state
    which observed schema/version they cover
  - project/model fields absent from the source must remain visibly unknown,
    not inferred from a nearby folder or provider label
- acceptance:
  - each reported data anomaly has a concrete classification and evidence
  - MiMo Code/OpenCode duplication is answered from their actual storage and
    identity contracts
  - follow-up repairs are independently scoped with acceptance and verification
    plans; no speculative parser change is included in this Task
- verification plan:
  - read-only SQLite/source-schema probes and grouped profiler queries
  - focused parser/adapter/source-contract review and `git diff --check`
- documentation plan:
  - record the diagnostic evidence, ownership, and deferred limitations here;
    update current-state architecture documents only in the Task that changes
    implemented behavior
- audit results:
  - profiler database inspection found 9 Zed Sessions, all with empty `cwd`,
    zero message count, and one legacy summary Span; the current Zed source
    database has the same 9 thread IDs and all 9 contain non-empty
    `folder_paths` across `base-admin-api`, `im`, and `oryx`
  - the current Zed parser already maps raw/JSON-array `folder_paths` and
    structured messages, but the adapter fingerprint remains
    `zed:<updated_at>:<data_type>:<size>`; it did not change when that parser
    interpretation replaced the legacy summary mapping, so ordinary import
    skipped every persisted Zed row as unchanged. T67 owns a versioned,
    source-safe re-import and regression coverage
  - Claude Code has no null/empty persisted cwd in the current database. Two
    source transcripts intentionally capture `cwd="/"`; the Home folder label
    uses `project.split('/').pop() || project`, so this valid root cwd appears
    as an unhelpful blank-like project label. T67 owns a display policy for
    non-project cwd values; it must not fabricate another path or silently
    discard otherwise valid source evidence
  - MiMo Code and OpenCode are not duplicate imports: they are distinct local
    databases (`~/.local/share/mimocode/mimocode.db` and
    `~/.local/share/opencode/opencode.db`) with different session schemas. The
    profiler currently imports 164 MiMo Sessions and zero OpenCode Sessions;
    OpenCode's two local records are not in any aggregate. T59 remains the
    future OpenCode adapter owner and must define cross-source de-duplication
    only if a common source identity is observed
  - model statistics group raw Span `model` strings. The current evidence has
    aliases/provider-qualified variants such as `glm-5.2`, `glm-5-2`,
    `glm-5-2-origin`, `DeepSeek-V4-Flash`, and
    `deepseek-ai/DeepSeek-V4-Pro`, plus Codex `litellm` provider-only metadata.
    These are neither canonicalized nor clearly separated from unknown model
    identity, which explains the observed model-recognition and grouping issue;
    T68 owns the normalization contract and statistics tests
  - 15 observed model labels currently lack pricing, including the major
    `glm-x-preview`, `astron-code-latest`, and provider/alias forms. This is
    visible as unknown cost and must remain unknown unless T68 establishes a
    source-faithful canonical identity and an applicable price
  - the current daily chart provides only native SVG `<title>` text on tiny
    points, profile cards have no shared body-height/layout contract, and a
    Session navigation replaces the entire detail surface with `Empty` while
    `/analysis` is pending. T69 and T70 own these independent UI repairs
- completion:
  - changed files: `docs/roadmap.md`
  - result: every reported anomaly now has a verified owner. No source file,
    source database, generated profiler Session, or parser behavior changed in
    this diagnostic Task

### T67 source metadata completeness and invalid-session handling

- status: completed
- started_at: 2026-07-27
- completed_at: 2026-07-27
- purpose: correct confirmed source-faithful project/cwd and model metadata
  defects, and make unsupported/projectless records recoverable without showing
  misleading folders
- scope:
  1. version the Zed adapter fingerprint for the already implemented structured
     parser semantics, so unchanged legacy rows are atomically replaced on the
     next ordinary import and source-backed `folder_paths` persist as cwd
  2. add a regression that proves a prior Zed revision is updated rather than
     skipped, with no manually deleted profiler data
  3. render valid non-project cwd values such as `/` with a stable human label
     and retained original path tooltip, rather than deriving an empty folder
     name from a path basename
- assumptions and risks:
  - Zed source rows are authoritative; the revision bump must be source-specific
    and must not force Claude, Codex, or MiMo re-imports
  - root cwd is valid captured evidence but not a project name; this Task only
    changes its display label and does not suppress the Session
- acceptance:
  - a current Zed ordinary scan replaces all nine persisted legacy rows and
    exposes their source `folder_paths`, structured LLM turns, answers, and
    paired tools
  - a second unchanged scan skips the refreshed Zed rows normally
  - a Claude Session with cwd `/` renders an explicit location label while its
    path remains discoverable; normal project labels are unchanged
  - no parser guesses a missing cwd or model identity
- verification plan: focused adapter/coordinator and Home data tests, safe
  local re-import evidence, core/server/web checks proportionate to the change,
  and runtime smoke inspection
- documentation plan: update `ARCHITECTURE.md`, `docs/multi-agent.md`, and this
  Task with final source coverage and known limits; update UI documentation only
  if the final label changes a documented navigation behavior
- implementation:
  - added the Zed parser-contract fingerprint revision `zed-v2`; source update
    time, data type, and payload size remain part of the fingerprint
  - added an adapter/coordinator regression where a persisted legacy Zed
    revision is updated from an unchanged source row and the next scan skips it
  - extracted the Home project label formatter; captured `cwd="/"` now renders
    as `系统根目录` while the raw `/` remains the native path tooltip
- verification:
  - focused Server ingestion suite — passed: 9 files / 28 tests, including the
    legacy Zed revision replacement and repeat-scan skip regression
  - focused Web project-label suite — passed: 1 file / 2 tests for root and
    ordinary project paths
  - focused Biome — passed
  - real local Zed normal import — the existing 9 rows upgraded without a
    reset; the resulting rows are 3 each under `base-admin-api`, `im`, and
    `oryx`, with 20 LLM turns, 57 answers, 114 tools, 811,280 observed input
    tokens, and 7,924 observed output tokens; a subsequent scan skipped all 9
    as unchanged
  - `pnpm --filter trace-server build` and
    `pnpm --filter agent-profile-web build` — passed
- completion:
  - changed files: `apps/server/src/ingestion/zed-adapter.ts`,
    `apps/server/src/__tests__/ingestion.test.ts`, `apps/web/app/page.tsx`,
    `apps/web/app/project-label.{ts,test.ts}`, `ARCHITECTURE.md`,
    `docs/multi-agent.md`, and `docs/roadmap.md`
  - result: persisted Zed data now refreshes safely when parser semantics
    advance, current Zed Sessions retain their source project folders and
    structured evidence, and valid root-cwd Claude Sessions no longer look
    like pathless project folders

### T68 canonical model identity and statistics grouping

- status: completed
- started_at: 2026-07-27
- completed_at: 2026-07-27
- purpose: make model identification, pricing lookup, and statistics grouping
  use a stable source-faithful canonical identity without merging materially
  distinct models or treating provider-only evidence as a specific model
- scope:
  1. add a pure model-identity contract that distinguishes a canonical model,
     a safe known alias, a provider-only value, and an unknown/raw value
  2. aggregate Stats model groups by that contract while retaining source raw
     labels/alias coverage for inspection
  3. ensure pricing continues to use only the observed source model string;
     statistics normalization must not create a trusted cost for an unpriced
     alias or provider-only identity
  4. add model grouping regressions for case/provider-prefix aliases, distinct
     versions, provider-only evidence, and unknown values
- assumptions and risks:
  - only explicit equivalences supported by observed source/vendor naming are
    canonicalized; version/date/mode suffixes remain distinct unless proven
  - persisted raw Span model values remain source evidence; this Task does not
    rewrite historical Sessions or alter pricing rows
- acceptance: model tables and distributions have deterministic non-duplicated
  labels, provider-only/unknown identities remain visible, and pricing remains
  source/time faithful
- verification plan: core/server aggregation tests, representative source
  fixtures, API response inspection, build/lint, and documentation update
- documentation plan: update `ARCHITECTURE.md`, `docs/stats.md`, and this Task
- implementation:
  - added the pure `identifyModel` presentation contract with explicit aliases
    only; it groups case/provider-prefix DeepSeek aliases and observed GLM
    hyphen aliases, while version/mode values such as `glm-5-2-origin` remain
    raw unknown identities
  - changed the set-based dashboard/Stats model aggregation to group by that
    contract and return `kind` plus `rawModels` for inspectable alias coverage
  - updated the Stats model table to label provider-only and unnormalized groups
    without hiding their raw source values in the tooltip
  - pricing and persisted Span model strings remain unchanged
- verification:
  - model-identity tests — passed: explicit aliases group; provider-only,
    unknown, and absent identities remain distinct
  - Server aggregation tests — passed: 9 files / 29 tests; verifies alias
    grouping and provider/unknown separation while retaining the two-query path
  - `pnpm --filter trace-server build` and
    `pnpm --filter agent-profile-web build` — passed
- completion:
  - changed files: `packages/core/src/model-identity.ts`, its test and export,
    `apps/server/src/routes/stats.ts`, statistics aggregation tests,
    `apps/web/app/stats/page.tsx`, `ARCHITECTURE.md`, `docs/stats.md`, and
    `docs/roadmap.md`
  - result: Stats no longer displays safe aliases as separate models, provider
    names are not presented as concrete models, and unknown pricing remains
    visibly unknown

### T69 statistics trend inspection and profile-card layout consistency

- status: completed
- started_at: 2026-07-27
- completed_at: 2026-07-27
- purpose: expose exact daily-trend values through keyboard-accessible hover or
  focus interaction, and make Agent Profile cards scan consistently despite
  different content lengths
- scope: replace the native SVG-only trend title with an interactive tooltip or
  equivalent accessible data inspection; establish stable profile-card grid and
  card-body dimensions without concealing content
- acceptance: every daily point reveals its day, cost, tokens, Sessions, and
  cache metric on pointer and keyboard focus; profile cards align across desktop
  and narrow widths with no clipped text
- verification plan: focused Web tests, browser desktop/mobile inspection,
  focused lint and production build
- documentation plan: update relevant UI guidance/current behavior and this Task
- implementation:
  - daily cost points now respond to pointer hover and keyboard focus, enlarge
    the active point, and display the selected day, cost, tokens, session count,
    and cache-hit rate in a stable legend row below the chart
  - Agent Profile grids stretch each row and each profile card fills its grid
    cell, removing unequal bottom edges caused by variable content length
- verification:
  - focused Biome check — passed with no new errors; the existing Stats
    `modelColor` non-null assertion remains a warning
  - `pnpm --filter agent-profile-web build` — passed
- completion:
  - changed files: `apps/web/app/stats/page.tsx`,
    `apps/web/app/profiles/page.tsx`, and `docs/roadmap.md`
  - result: daily values are directly inspectable without moving the chart or
    relying on a native SVG title, and profile cards retain content while their
    grid rows align

### T70 session-navigation loading performance and transition feedback

- status: planned
- purpose: reduce avoidable Session-detail loading latency and replace the
  isolated spinner with a page-level transition that preserves orientation and
  explains progress/error recovery
- scope: measure API and client navigation path; remove confirmed sequential or
  duplicate work; add reserved-layout loading/skeleton/transition states while
  retaining accessible status and stale-data safety
- acceptance: navigation has an immediate visible state change, no misleading
  blank/unchanged screen during loading, and measured request/render work is no
  worse than the current path
- verification plan: Web interaction tests, API/request timing inspection,
  browser checks, focused lint, full build, and task-specific documentation
- documentation plan: update `ARCHITECTURE.md`, UI guidance, and this Task

### T71 model-context and analysis configuration audit

- status: planned
- purpose: audit user-adjustable analysis configuration, including built-in
  model context windows, and make each setting's scope/provenance clear before
  changing values
- scope: inventory current configuration surfaces and seeds; verify model-window
  values against authoritative vendor documentation where applicable; distinguish
  user configuration from source-observed runtime evidence
- acceptance: every exposed setting has a clear owner/effect; corrected context
  limits cite their source and unknown models remain unconfigured rather than
  guessed
- verification plan: configuration tests, seed/migration checks, focused UI
  check, and documentation update
- documentation plan: update `ARCHITECTURE.md`, README/configuration guidance,
  and this Task

## Execution Order

T5–T15, T36–T53, T55–T57, T60–T62, and T65 are complete. The next ordered work
is T63 (safe rebuild/reset), followed by T64 (flat Session navigation). T54,
T58, and T59 remain separate planned correctness, UI, and source-expansion work
after this data-experience sequence.

T65 is complete: the correctness repair discovered while auditing the local
`im` Sessions now excludes non-actionable external-history materializations and
has removed their unannotated stored copies. T62's loading/onboarding and
responsive runtime verification are also complete; T63 remains responsible for
the reusable forced-rebuild operation.

For the newly decomposed data experience, execute T63 next. T64 already has the
completed T62 single Home-page data owner it depends on and can proceed after
T63, or independently if priorities change. T48 and T50 remain broader product
umbrellas whose overlapping loading/rebuild/Session-discovery work is owned by
T62–T64.

## Task Lifecycle

The detailed workflow is maintained in `../AGENTS.md`. The canonical transition is:

`planned` → `in_progress` → `completed`

`blocked` and `cancelled` are terminal alternatives when completion is not possible or no longer desired.

User authorization can be given by the request that starts the work; a second confirmation is required only when scope, risk, or external effects materially exceed that authorization. A task may be marked `completed` only after its implementation, affected documentation, and verification evidence have all been recorded.
