# Agent Profile

Offline profile analysis for AI coding agent session transcripts (Claude Code / Codex / Zed). Reconstructs tokens / context / cost / duration / tool calls; provides data for cost optimization, context health, and performance analysis.

## Quick Start

```bash
pnpm install        # install
pnpm dev            # server(3000) + web(3001)
```

Open `http://localhost:3001`, enter your Claude Code projects dir (default `~/.claude/projects`), click **Scan**.

## Data Flow

```
session files → Scanner → Parser → Analyzer → SQLite → Web UI
```

## Features

- **4 token types** (input / cache_creation / cache_read / output) — never merged, for accurate cost & context
- **Heuristic diagnosis** (7 rules): repeated read, large output carry, low cache hit, context bloat, long thinking, repeated failure, read scope
- **Multi-agent** (planned): Claude Code (done) / Codex / Zed
- **Consumption statistics** (planned): overview + cost distribution + model breakdown
- **LLM semantic diagnosis** (planned): thinking/tool deviation

## Documentation

- `ARCHITECTURE.md` — core architecture
- `docs/diagnosis.md` — diagnosis design (heuristic + LLM)
- `docs/multi-agent.md` — multi-agent ingestion
- `docs/stats.md` — consumption statistics
- `docs/roadmap.md` — roadmap & task breakdown
- `docs/zh/OVERVIEW.md` — 中文总览

## Tech Stack

pnpm workspace + TypeScript: `packages/core` (parsing logic) + `apps/server` (Fastify + SQLite) + `apps/web` (Next.js).

## Status

P0 data listing + P1 diagnosis done. See `docs/roadmap.md` for full progress and task breakdown.
