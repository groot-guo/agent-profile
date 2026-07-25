# Roadmap & Task Breakdown

Each task: status / dependencies / steps / affected files / acceptance / risks. **Execution requires orchestration confirmation** (see bottom).

Task IDs (T5–T15) map to task system (#5–#15).

## Current Progress (done)

| module                                                        | status                        |
| ------------------------------------------------------------- | ----------------------------- |
| P0 data listing (scanner/parser/analyzer/server/web/demo)     | done                          |
| P1 quantified diagnosis (7 heuristic rules + API + web)       | done                          |
| P2.18 read_scope_too_large heuristic                          | done                          |
| P2.19 LLM interface reserved (designed, not implemented)      | interface done / impl pending |
| UI light theme + paginated tables + project grouping (by cwd) | done                          |
| pricing seed (DeepSeek) + typecheck fix                       | done                          |
| data source                                                   | Claude Code + Codex           |
| Architecture refactor (async scanner, DB abs path, routes split, config/theme extraction, auto-scan) | done |
| IDE-style UI (sidebar project tree + dashboard + embed detail) | done |
| @lobehub/icons (agent & model SVG icons)                      | done |

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
  5. delete `apps/server/trace.db`, re-scan
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
  1. scanner: scan three locations (claude/codex/zed), dispatch parser by agent
  2. incremental: claude/codex use file mtime/size; zed uses threads.db `updated_at` or row count
  3. routes.ts: POST /api/scan add `agent` param (`all` | `claude` | `codex` | `zed`), default all
- affected: packages/core/src/scanner.ts, apps/server/src/routes.ts
- acceptance: /api/scan scans all three sources; agent param filters source
- risk: scan latency with three sources; zed sqlite readonly concurrent access

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

- status: pending (blocked: model/key/sync decision) (blocked: model/key/sync decision)
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

- status: pending (blocked: user-provided glm-5.2 unit price) (blocked: user-provided glm-5.2 unit price)
- depends: none
- steps:
  1. add glm-5.2 to pricing seed (db.ts) once price provided
  2. totalCost recompute: `/api/recompute-cost` endpoint or re-scan trigger to recalc stored cost with current pricing
- affected: apps/server/src/db.ts, apps/server/src/routes.ts
- acceptance: glm-5.2 sessions show cost; pricing change updates totalCost
- risk: none

## Execution Order

Batch 1 first (agent column foundation). Within: T5 → T6 → T7 → T8. After batch 1, batch 2 (T9–T11) and batch 3 (T12–T13) can parallelize. Batch 4 (T14) blocked on model decision. Batch 5 (T15) blocked on glm price.

## Orchestration Confirmation Process

**Every task execution requires prior confirmation:**

1. Before starting a task, output an execution orchestration:
   - task ID + scope
   - files to change (exact paths)
   - step-by-step plan
   - dependencies / blockers
   - acceptance criteria
   - risks
2. Wait for user confirmation.
3. Execute + verify (run / typecheck / smoke test).
4. On completion: update this doc's task status + `TaskUpdate` to completed.
5. Report result (what done, what verified, what skipped).

**No confirmation → no execution.** Status transitions: `pending` → `confirmed` → `in_progress` → `completed`.

To start a task, tell me which (e.g. "start T5"); I will output the orchestration and wait for your confirmation before any code change.
