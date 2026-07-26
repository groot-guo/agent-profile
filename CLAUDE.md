# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

Agent Profile — local-first runtime profile analysis of AI coding agent sessions. Imports local Claude Code, Codex, Zed, and MiMo data, reconstructs tokens / context / cost / duration / tool calls, and provides process-efficiency, reliability, and performance evidence. Current architecture: `ARCHITECTURE.md`. Future runtime-profile proposal: `docs/agent-runtime-profile-design.md`.

Before changing this repository, follow the task and documentation lifecycle in
`AGENTS.md`: start an explicit task in `docs/roadmap.md`, implement and verify,
update affected documents, then close the task.

## Commands

```bash
pnpm install                                                          # install
pnpm dev                                                              # server(3000) + web(3001)
pnpm --filter trace-server dev                                        # server only (auto-scans ~/.claude/projects on start)
pnpm --filter agent-profile-web dev                                   # web only
pnpm build                                                            # build
```

Debug UI: `http://localhost:3001`.
Health check: `curl http://localhost:3000/api/health`.
Skip auto-scan: `AUTO_SCAN_DIR="" pnpm --filter trace-server dev`.

## Architecture

pnpm workspace monorepo, TypeScript. Data flow:

```
transcript file
  → Scanner (async scan/dedup/incremental, fs/promises)
  → Parser (NDJSON parse, tool_use↔tool_result pairing, parentUuid chain)
  → Analyzer (4 token types, context size, cache hit rate, cost)
  → SQLite (apps/server/trace.db, absolute path via import.meta.url)
  → Web UI (Next.js)
```

- `packages/core` (`@agent-profile/core`): scanner / parser / analyzer / pricing / diagnosis / types. Pure logic (zero runtime deps), shared by server and web (web reads src via transpilePackages).
- `server` (`trace-server`): Fastify + better-sqlite3. `config.ts` (port, autoScanDir), `db.ts` (schema + pricing/model_context lookup), `routes/` (scan | sessions | diagnosis | pricing | stats | health, registered via `routes/index.ts`). Starts a background source scan by default (set `AUTO_SCAN_DIR=""` to skip the configured transcript-directory scan).
- `web` (`agent-profile-web`): Next.js App Router. `config.ts` (API base URL), `theme.ts` (shared colors, constants, formatters). Detail page = tool call bar chart + context growth chart + token breakdown + per-turn/per-tool tables + diagnosis.

## Non-obvious Conventions (read before changing code)

- **4 token types not merged**: input / cache_creation / cache_read / output stored separately. cache_read has different price and semantics from input; merging distorts cost and context. `contextTokens = input + cache_creation + cache_read`.
- **transcript has no cost field** (`message.cost` always null): cost is computed by analyzer from `model + 4 token types + pricing table`. Unknown model → cost=0, flagged `costUnknown`, never estimated. `analyzeSession` accepts optional `importedAt` param to avoid `Date.now()` side effects in core.
- **thinking / answer are internal blocks of llm_turn**: tokens included in the turn's output, not separately splittable. Analysis collapses reasoning layer, focuses on tool calls — **bar chart for call counts, not flame graph** (agent tools are sequential sequences, not call stacks).
- **Incremental update**: transcript is append-only (new lines appended as session continues). `sessions` table stores `file_mtime / file_size / file_lines`; scan detects — unchanged: skip, changed: **delete old + re-insert** that session.
- **Scanner async**: primary API uses `fs/promises` (async). Sync versions (`findTranscriptFilesSync`, `readTranscriptSync`) available for compat but not used in server.
- **tool call pairing**: `tool_use.id` ↔ next user row's `tool_result.tool_use_id`, paired by id to produce `tool_call` span; `endTime` = tool_result row timestamp.
- **call chain**: span `parentId` = transcript `parentUuid`; `isSidechain` marks sub-agents.
- **categorization**: tools grouped by category (file / command / network / interactive / MCP / orchestration / meta) for coloring, **not structure**. Aggregate by tool name, **not by params**; no model split (model is just a label).
- **diagnosis**: `diagnoseSessionSync` provides the 7 deterministic rules. `diagnoseSession` accepts the server's optional `LlmDiagnoser`; the diagnosis route uses it when `LLM_API_KEY` is configured and otherwise returns heuristic results.

## Data Model

Four tables (`apps/server/src/db.ts`): `sessions` (sessionId + source metadata + agent/model/project + 4 token aggregates + context/cache/cost/duration + tags/notes), `spans` (llm_turn / tool_call, 4 token types + `context_tokens` + `output_bytes` + timing/parent/tool metadata, large content truncated), `pricing` (model → 4 token unit prices), `model_context` (model → context window size).

Schema changes require a task-specific migration/backfill plan. Compatible
columns are added through migrations after table creation; deleting
`apps/server/trace.db` is a recovery option for generated local state, not the
normal upgrade path. The database path is resolved by the server rather than
depending on the shell working directory.

## Ports

server 3000, web 3001. Configurable: `PORT` (server, see `apps/server/src/config.ts`), `AUTO_SCAN_DIR` (auto-scan target, empty to skip), `NEXT_PUBLIC_API` (web).

## Current Progress

Claude Code, Codex, Zed, and MiMo ingestion, quantified diagnosis, optional LLM
semantic diagnosis, statistics, filtering/comparison, annotations, export,
pricing recomputation, and detail analysis are implemented. The application is
still session-centric; Task/Outcome/Configuration-aware runtime feedback remains
a proposal. See `docs/roadmap.md` for authoritative task status.
