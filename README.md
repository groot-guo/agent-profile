# Agent Profile

[中文说明](README.zh-CN.md) · [Current architecture](ARCHITECTURE.md) · [Roadmap](docs/roadmap.md)

Agent Profile is a local-first profiler for AI coding-agent runtimes. It imports
local Claude Code, Codex, Zed, and MiMo session data, then explains where time,
tokens, context, cost, tool calls, and sub-agent work went.

It is an analysis tool for observed runtime process. It is not a chat-history
viewer, a hosted monitoring service, or a universal ranking of agents.

## Who it is for

Use Agent Profile when you want to answer questions such as:

- Which local coding-agent sessions cost the most or grew the largest context?
- Did a tool fail repeatedly, produce unusually large output, or cause a
  context spike?
- How do the observed resource and tool-use patterns differ across agents or
  projects?
- Does a task prompt clearly state its goal, scope, acceptance criteria, and
  verification plan?

## Requirements

- Node.js (an active LTS release is recommended)
- pnpm
- At least one supported local agent data source; missing sources are optional
  and do not stop the application from starting

## Quick start

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3001](http://localhost:3001). The Fastify API runs on
port `3000`; the Web application runs on port `3001`.

`pnpm dev` starts both processes together and watches Server source changes.
Run package-level `dev` commands only when you deliberately need to debug one
process in isolation.

The Web development server writes `apps/web/.next-dev`; production builds write
`apps/web/.next`. You can safely run `pnpm build` while development is running.

## First import

On startup, the Server begins one observable background import job. Returning
users keep their existing Sessions visible while synchronization runs. A first
run shows source availability, per-source progress, recovery actions, and a
completion summary instead of a stale generic empty list.

| Source | Default local location | When it is imported |
| --- | --- | --- |
| Claude Code | `~/.claude/projects` | startup and “重新扫描” |
| Codex | `~/.codex/sessions` | startup and “重新扫描” |
| Zed | local Zed `threads.db` | startup and “重新扫描” when present |
| MiMo | local `mimocode.db` | startup and “重新扫描” when present |

If the list is empty, use the source-aware first-run panel or click
**重新扫描**. The same deduplicated job used at startup checks all four sources
and reports imported, updated, skipped, and failed counts. The status API and UI
do not expose transcript text, full local paths, or source Session identifiers.

The Home-page **数据管理** panel separates four operations: refreshing stored
API data, incremental synchronization, a forced analysis rebuild, and a local
generated-data reset. Forced rebuild reprocesses unchanged available sources
while preserving Session tags/notes, pricing, model-context configuration,
migrations, and Sessions whose source is currently unavailable. Reset is a
separate danger-zone action that requires the displayed confirmation phrase.

Sessions appear in one recent-first list with lightweight time boundaries; no
project folder needs to be expanded before opening a Session. Each row retains
its project label. Project path search, Agent chips, free-text search,
anomaly/unpriced quick views, and sorting compose together and remain in the
URL when a Session is opened or the browser goes back. Large result sets render
in bounded batches instead of creating every row at once.

## What the main views do

- **会话** — browse a flat recent Session list by project and Agent; open a session for
  diagnosis, context/cost, tools/chain, or normalized evidence.
- **画像** — compare observed Agent runtime fingerprints with sample-size and
  coverage limits. “Higher” or “lower” describes behavior, not quality.
- **迭代** — review a task prompt locally for goal, scope, acceptance,
  constraints, context, and verification structure. Optional runtime-profile
  hints are hypotheses to validate, not automatic prompt rewrites.
- **统计** — inspect aggregate token, cost, context, project, Agent, and model
  distributions.

The Session evidence view contains every *stored normalized Span*, not every
line of the original transcript. Content previews are off by default; when
requested, previews are redacted and bounded.

Codex Desktop external-history materializations are excluded when they contain
`external-import-turn-*` records without normal runtime context and only
text-wrapped tool history. Their project and tool evidence is not trustworthy,
so they do not create mystery project folders or inflate Codex/tool aggregates.
Previously generated unannotated copies are cleaned up during import; annotated
rows are retained instead of silently deleting user notes.

## Configuration

| Variable | Purpose |
| --- | --- |
| `PORT` | API port; default `3000` |
| `NEXT_PUBLIC_API` | Web API origin; default `http://localhost:3000/api` |
| `AUTO_SCAN_DIR` | Unset: scan default Claude Code and Codex directories. Empty: disable transcript auto-scan. A path: scan that one transcript directory. |
| `TRACE_DB_PATH` | Override the local SQLite database path; default `apps/server/trace.db` |
| `LLM_API_KEY` | Enables optional semantic diagnosis; no key is required for deterministic analysis |
| `LLM_PROVIDER`, `LLM_MODEL`, `LLM_BASE_URL` | Optional semantic-diagnosis provider settings |

Example: start without transcript auto-scan.

```bash
AUTO_SCAN_DIR="" pnpm dev
```

## Local data and privacy

- Agent Profile reads local source histories and writes derived Session/Span
  data to SQLite. It does not upload transcript data by default.
- The default database is `apps/server/trace.db`. Stop the Server before making
  a file-level backup of it.
- A forced rebuild is the normal recovery path after parser or metric changes.
  The danger-zone reset deletes every generated Session/Span, including tags
  and notes, but retains pricing, model-context configuration, and migration
  records so the database can be synchronized again from available sources.
- Prompt review is ephemeral: prompt text is not written to the database and is
  not sent to a semantic provider by that feature.
- Source data varies. A missing field means “not captured”, not zero, success,
  or failure.

## Troubleshooting

### No sessions appear

1. Confirm that a supported source exists at one of the default locations.
2. Follow the per-source startup status; use **重新扫描** to retry any available
   source.
3. For a custom transcript directory, start with
   `AUTO_SCAN_DIR=/absolute/path pnpm dev`.
4. Read the scan result and error notice; an unavailable source does not erase
   sessions that were already imported.

### Port 3000 or 3001 is already in use

Stop the older Agent Profile development process, then run `pnpm dev` again.
The root command is intended to own both ports.

### Next.js reports a missing chunk or module

Stop all local Agent Profile dev/build processes, then remove only the generated
Web outputs and restart:

```bash
rm -rf apps/web/.next apps/web/.next-dev
pnpm dev
```

## Current product boundaries

- There is no packaged desktop application or non-watch production launcher
  yet; today the supported entry point is the local developer workflow above.
- Task, Configuration Snapshot, Outcome, cohort, and experiment records are
  not implemented. The product can explain observed process behavior but cannot
  prove whether a session delivered a correct result.
- Cross-file parent/child Codex threads remain separate Sessions. Their
  sidechain evidence is preserved, but a full persisted task graph is future
  work.
- Very large session histories still use file discovery and full changed-session
  replacement; append-only parsing and large-session virtualisation are planned
  improvements.
- The application is designed for local use. Do not expose its API to an
  untrusted network without adding authentication and directory-access controls.

## Development checks

```bash
pnpm test
pnpm build
pnpm lint
```

`pnpm build` currently passes. The repository-wide lint baseline is tracked
separately in [T44](docs/roadmap.md); do not treat a lint failure as evidence
that a runtime metric is wrong.

## Further reading

- [Chinese README](README.zh-CN.md) — equivalent user-facing guide
- [Architecture](ARCHITECTURE.md) — implemented data flow, APIs, storage, and
  metric semantics
- [Chinese overview](docs/zh/OVERVIEW.md) — current implementation in Chinese
- [Multi-agent ingestion](docs/multi-agent.md) — source-specific normalization
  behavior and coverage limits
- [Roadmap](docs/roadmap.md) — Task status and verification evidence
- [Future runtime design](docs/agent-runtime-profile-design.md) — proposal, not
  current behavior
