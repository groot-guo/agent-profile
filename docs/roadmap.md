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
  - source-status API and UI for configured Claude Code, Codex, Zed, and MiMo
    availability and imported-session counts
  - first-run/empty-state recovery and scan progress feedback
  - non-watch local start mode, local backup/recovery guidance, and safe
    local-only network defaults
  - retain API compatibility for explicit directory scans or document a safe
    migration path
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
  - responsive dashboard navigation that replaces the fixed desktop sidebar at
    narrow widths and preserves accessible Session selection
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

## Execution Order

T5–T15 and T36–T43 plus T45–T47 and T51 are complete. T48–T50 record the next product
capabilities. T44 remains a separate planned lint-debt Task and must not be
folded into feature work.

## Task Lifecycle

The detailed workflow is maintained in `../AGENTS.md`. The canonical transition is:

`planned` → `in_progress` → `completed`

`blocked` and `cancelled` are terminal alternatives when completion is not possible or no longer desired.

User authorization can be given by the request that starts the work; a second confirmation is required only when scope, risk, or external effects materially exceed that authorization. A task may be marked `completed` only after its implementation, affected documentation, and verification evidence have all been recorded.
