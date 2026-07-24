# Agent Profile — Architecture

Offline profile analysis for AI coding agent session transcripts. Scans local session files (Claude Code / Codex / Zed), reconstructs tokens / context / cost / duration / tool calls, and provides data for cost optimization, context health, and performance analysis.

Detailed designs in `docs/`:
- `docs/diagnosis.md` — heuristic + LLM diagnosis
- `docs/multi-agent.md` — Codex / Zed ingestion
- `docs/stats.md` — consumption statistics
- `docs/roadmap.md` — roadmap & task breakdown
- `docs/zh/OVERVIEW.md` — Chinese sync

## Data Flow

```
session files (.jsonl / SQLite)
  → Scanner (discover, dedupe, incremental)
  → Parser (NDJSON / zstd blob decode, tool_use↔tool_result pairing, parentUuid chain)
  → Analyzer (4 token types, context size, cache hit rate, cost)
  → SQLite (server/trace.db)
  → Web UI (Next.js)
```

## Tech Stack

pnpm workspace, TypeScript.

| Package | Responsibility |
|---|---|
| `packages/core` (`@agent-profile/core`) | scanner / parser / analyzer / pricing / diagnosis / types. Pure logic, shared by server and web (web reads src via transpilePackages). |
| `server` (`trace-server`) | Fastify + better-sqlite3. `db.ts` (schema + pricing/model_context lookup), `routes.ts` (scan + REST API). |
| `web` (`agent-profile-web`) | Next.js App Router. Session list (grouped by project) + detail (tool bar chart, context growth chart, token breakdown, diagnosis, paginated tables). |

## Data Model

Four tables (`server/src/db.ts`):

- **sessions**: id + file mtime/size/lines + 4 token aggregates + peak/avg context + cache_hit_rate + cwd + `agent` (planned: claude-code | codex | zed).
- **spans**: llm_turn | tool_call. 4 token types + `context_tokens` + `output_bytes` + metadata (thinking/prompt/response/tool input+output, truncated >10KB). parentId chain, isSidechain.
- **pricing**: model → 4 token unit prices (CNY / 1M tokens).
- **model_context**: model → context window size.

Schema changes require deleting `server/trace.db` (`CREATE TABLE IF NOT EXISTS` won't alter existing tables; old db missing new columns causes INSERT failure). `trace.db` is generated under `server/` (better-sqlite3 relative path, cwd = server/), not project root.

## Analysis Logic

- **context size**: `contextTokens = input + cache_creation + cache_read`
- **window utilization**: `contextTokens / model_context.context_window` (unknown if model unconfigured)
- **cache hit rate**: `cache_read / (input + cache_creation + cache_read)`
- **cost**: `(input×in + cc×cc_price + cr×cr_price + out×out_price) / 1e6`, per span; unknown model → cost=0, flagged `costUnknown`
- **cache savings**: `(input + cc + cr) × in_price − actual` (theoretical, vs no-cache baseline)
- **tool categorization**: by category (file / command / network / interactive / MCP / orchestration / meta) for coloring, not structure; aggregate by tool name, not by params

## API

| Method | Path | Description |
|---|---|---|
| POST | /api/scan | Scan + incremental import + analyze |
| GET | /api/sessions | Session list |
| GET | /api/session/:id | Session detail (with spans) |
| GET | /api/session/:id/turns | LLM turn details |
| GET | /api/session/:id/tools | Tool call details |
| GET | /api/session/:id/context | Context growth curve data |
| GET | /api/session/:id/diagnosis | Diagnosis findings (heuristic + LLM if enabled) |
| GET/PUT | /api/pricing · /api/model-context | Pricing / context window |
| GET | /api/stats | (planned) consumption statistics |

## Directory

```
agent-profile/
├── packages/core/src/{scanner,parser,analyzer,pricing,diagnosis,types}.ts
├── server/src/{index,db,routes}.ts
├── web/app/{page.tsx, session/[id]/page.tsx}
└── docs/                     # design docs (English) + zh/ (Chinese sync)
```

## Ports

server 3000, web 3001. Configurable via `PORT` (server) and `NEXT_PUBLIC_API` (web).

## Current Progress

- P0 data listing: done
- P1 quantified diagnosis (7 heuristic rules): done
- P2.18 read_scope_too_large heuristic: done
- P2.19 LLM semantic diagnosis: interface reserved, not implemented (`docs/diagnosis.md`)
- UI: light theme, paginated tables, project grouping: done
- Data sources: Claude Code only (Codex / Zed planned, `docs/multi-agent.md`)
- glm-5.2 pricing: missing (`docs/roadmap.md`)

See `docs/roadmap.md` for full task breakdown.
