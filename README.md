# Agent Profile

Agent Profile is a local-first profiler for AI coding-agent runtimes. It imports
local session data from Claude Code, Codex, Zed, and MiMo, reconstructs token,
context, cost, duration, tool, and sub-agent activity, then turns that evidence
into process-efficiency and reliability analysis.

The current product is session-centric. The proposed evolution toward
Task/Outcome/Configuration-aware runtime feedback is documented separately in
`docs/agent-runtime-profile-design.md`.

## Quick start

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3001`. The Fastify API listens on port `3000`; the web
application listens on port `3001`.

The server performs background imports on startup for the configured
Claude/Codex transcript directories and the available Zed/MiMo databases. A
manual scan can import a selected transcript directory. Source availability
depends on which agent data exists on the machine.

## Current capabilities

- Import Claude Code JSONL, Codex rollout JSONL, Zed thread data, and MiMo
  SQLite sessions into a shared session/span model.
- Preserve input, cache-creation, cache-read, and output tokens separately for
  context and pricing analysis.
- Explore sessions by project and agent, search and sort them, annotate them,
  compare selected sessions, and inspect trends and distributions.
- Inspect LLM turns, tool calls, tool parameters, context growth, performance,
  sub-agent activity, Git commits, and cost attribution.
- Run deterministic heuristic diagnosis and optional Anthropic-native or
  OpenAI-compatible LLM semantic diagnosis.
- Calculate session efficiency, process score, cost, cache behavior, and
  model/context statistics; update pricing and recompute stored costs.
- Compare versioned Agent process profiles across resource use, context,
  tool reliability, and sidechain behavior with sample and coverage limits.
- Export session data and reports for later review.

The Agent profile view is a runtime fingerprint, not a leaderboard. These
metrics describe the observed execution process. They do not by themselves
prove outcome quality or that one agent is universally better.

## Data flow

```text
local agent data
  → source adapter (revision + parser)
  → normalized sessions and spans
  → shared import coordinator
  → analysis + transactional session repository
  → SQLite
  → Fastify API (session evidence + agent-profile/v1)
  → Next.js session / profile views
```

## Repository

This is a pnpm TypeScript workspace:

- `packages/core` — parsers, analysis logic, diagnosis, pricing, and shared
  types.
- `apps/server` — source adapters/import coordination, Fastify API, and SQLite
  persistence.
- `apps/web` — Next.js App Router UI.

## Documentation

- `AGENTS.md` — canonical repository instructions, implementation invariants,
  and mandatory Task/documentation lifecycle.
- `CLAUDE.md` — compatibility symlink to `AGENTS.md`, so Claude Code consumes
  the same repository instructions without a second maintained copy.
- `ARCHITECTURE.md` — current implemented architecture and limitations.
- `docs/roadmap.md` — task definitions, status, acceptance, and verification
  evidence.
- `docs/agent-runtime-profile-design.md` — proposed Agent Runtime Profile target
  design; not a claim of current implementation.
- `docs/diagnosis.md` — diagnosis design.
- `docs/multi-agent.md` — source-ingestion design and notes.
- `docs/stats.md` — statistics design and metric notes.
- `docs/zh/OVERVIEW.md` — Chinese current-state overview.

Before changing code or behavior, create and start an explicit task in
`docs/roadmap.md`. After implementation, synchronize the affected documentation
and record verification before closing the task.
