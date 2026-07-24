# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

Agent Profile — offline profile analysis of AI coding agent session transcripts. Scans local session files (Claude Code / Codex / Zed), reconstructs tokens / context / cost / duration / tool calls, and provides data for cost optimization, context health, and performance analysis. Full design: `ARCHITECTURE.md` + `docs/`.

## Commands

```bash
pnpm install                                                          # install
pnpm dev                                                              # server(3000) + web(3001)
pnpm --filter trace-server dev                                        # server only
pnpm --filter agent-profile-web dev                                   # web only
pnpm build                                                            # build
```

Debug UI: `http://localhost:3001`.

## Architecture

pnpm workspace monorepo, TypeScript. Data flow:

```
transcript file
  → Scanner (scan/dedup/incremental)
  → Parser (NDJSON parse, tool_use↔tool_result pairing, parentUuid chain)
  → Analyzer (4 token types, context size, cache hit rate, cost)
  → SQLite (apps/server/trace.db)
  → Web UI (Next.js)
```

- `packages/core` (`@agent-profile/core`): scanner / parser / analyzer / pricing / diagnosis / types. Pure parsing logic, shared by server and web (web reads src via transpilePackages).
- `server` (`trace-server`): Fastify + better-sqlite3. `db.ts` (schema + pricing/model_context lookup), `routes.ts` (scan incremental + REST API: sessions / session/:id / turns / tools / context / diagnosis / pricing / model-context).
- `web` (`agent-profile-web`): Next.js App Router. Detail page = tool call bar chart + context growth chart + token breakdown + per-turn/per-tool tables + diagnosis.

## Non-obvious Conventions (read before changing code)

- **4 token types not merged**: input / cache_creation / cache_read / output stored separately. cache_read has different price and semantics from input; merging distorts cost and context. `contextTokens = input + cache_creation + cache_read`.
- **transcript has no cost field** (`message.cost` always null): cost is computed by analyzer from `model + 4 token types + pricing table`. Unknown model → cost=0, flagged `costUnknown`, never estimated.
- **thinking / answer are internal blocks of llm_turn**: tokens included in the turn's output, not separately splittable. Analysis collapses reasoning layer, focuses on tool calls — **bar chart for call counts, not flame graph** (agent tools are sequential sequences, not call stacks).
- **Incremental update**: transcript is append-only (new lines appended as session continues). `sessions` table stores `file_mtime / file_size / file_lines`; scan detects — unchanged: skip, changed: **delete old + re-insert** that session.
- **tool call pairing**: `tool_use.id` ↔ next user row's `tool_result.tool_use_id`, paired by id to produce `tool_call` span; `endTime` = tool_result row timestamp.
- **call chain**: span `parentId` = transcript `parentUuid`; `isSidechain` marks sub-agents.
- **categorization**: tools grouped by category (file / command / network / interactive / MCP / orchestration / meta) for coloring, **not structure**. Aggregate by tool name, **not by params**; no model split (model is just a label).

## Data Model

Four tables (`apps/server/src/db.ts`): `sessions` (sessionId + file mtime/size/lines + 4 token aggregates + peak/avg context + cache_hit_rate + cwd), `spans` (llm_turn / tool_call, 4 token types + `context_tokens` + `output_bytes` + metadata, >10KB truncated), `pricing` (model → 4 token unit prices), `model_context` (model → context window size).

**Schema changes require deleting `apps/server/trace.db`** — `CREATE TABLE IF NOT EXISTS` won't alter existing tables; old db missing new columns causes INSERT failure. `trace.db` is generated under `apps/server/` (better-sqlite3 relative path, cwd = apps/server/), not project root.

## Ports

server 3000, web 3001. Configurable: `PORT` (server), `NEXT_PUBLIC_API` (web).

## Current Progress

P0 data listing done. P1 quantified diagnosis done. P2.18 heuristic done. P2.19 LLM interface reserved. Remaining batches (multi-agent / UI-filter / stats / LLM impl / leftover) — see `docs/roadmap.md`.
