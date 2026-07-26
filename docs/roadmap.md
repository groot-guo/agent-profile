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

## Execution Order

T5–T15, T36, and T37 are complete. Future work must be added as a new task before implementation begins.

## Task Lifecycle

The detailed workflow is maintained in `../AGENTS.md`. The canonical transition is:

`planned` → `in_progress` → `completed`

`blocked` and `cancelled` are terminal alternatives when completion is not possible or no longer desired.

User authorization can be given by the request that starts the work; a second confirmation is required only when scope, risk, or external effects materially exceed that authorization. A task may be marked `completed` only after its implementation, affected documentation, and verification evidence have all been recorded.
