# Agent Profile

[中文说明](README.zh-CN.md) · [Profile model](docs/profile-model.md) · [Current architecture](ARCHITECTURE.md) · [Roadmap](docs/roadmap.md)

Agent Profile is a local-first runtime profiling, diagnosis, and
outcome-evaluation system for AI coding agents. It imports local Claude Code,
Codex, Zed, MiMo, and OpenCode Session data, then explains where time, tokens,
context, cost, tool calls, and sub-agent work went. It can connect that process
evidence to explicit Task Outcomes without treating lower resource use as proof
of better delivery.

It is an analysis tool for observed runtime process and local delivery evidence.
It is not a chat-history viewer, a hosted monitoring service, a code-quality
scanner, or a universal ranking of agents. See
[the Profile model](docs/profile-model.md) for the terminology and current/future
boundary.

## Who it is for

Use Agent Profile when you want to answer questions such as:

- Which local coding-agent sessions cost the most or grew the largest context?
- Did a tool fail repeatedly, produce unusually large output, or cause a
  context spike?
- How do the observed resource and tool-use patterns differ across agents or
  projects?
- Does a task prompt clearly state its goal, scope, acceptance criteria, and
  verification plan?
- Did a configuration change preserve build/test/lint evidence for comparable
  delivery work, or only reduce observed process cost?

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

For normal local use without file watching, run:

```bash
pnpm start
```

The root command builds the workspace first, then starts the API and production
Web server together. Both services bind to `127.0.0.1` by default.

The Web development server writes `apps/web/.next-dev`; production builds write
`apps/web/.next`. You can safely run `pnpm build` while development is running.

## First import

On startup, the Server begins one observable background import job. With no
stored Sessions, the Web switches to a dedicated data-preparation page: it
shows each available source and a source-level progress count instead of
leaving a generic empty dashboard that can look frozen. With stored Sessions,
sync or forced rebuild stays non-modal in a persistent progress panel, so the
existing list and analysis remain usable. Completion automatically refreshes
the displayed local data.

| Source | Default local location | When it is imported |
| --- | --- | --- |
| Claude Code | `~/.claude/projects` | startup and “重新扫描” |
| Codex | `~/.codex/sessions` | startup and “重新扫描” |
| Zed | local Zed `threads.db` | startup and “重新扫描” when present |
| MiMo | local `mimocode.db` | startup and “重新扫描” when present |
| OpenCode | `~/.local/share/opencode/opencode.db` | startup and “重新扫描” when present |

If the list is empty, use the source-aware first-run panel or click
**重新扫描**. The same deduplicated job used at startup checks all five sources
and reports imported, updated, skipped, and failed counts. The status API and UI
do not expose transcript text, full local paths, or source Session identifiers.
Progress is deliberately source-level: the Server does not report a misleading
file- or record-level percentage, so one large active source can leave the
progress count unchanged for a while. Unavailable local sources are excluded
from the progress denominator.

The Home-page **数据管理** panel separates four operations: refreshing stored
API data, incremental synchronization, a forced analysis rebuild, and a local
generated-data reset. Forced rebuild reprocesses unchanged available sources
while preserving Session tags/notes, pricing, model-context configuration,
migrations, and Sessions whose source is currently unavailable. Reset is a
separate danger-zone action that requires the displayed confirmation phrase.

Sessions appear in one recent-first list with lightweight time boundaries; no
project folder needs to be expanded before opening a Session. Each row retains
its project label. An exact project selector with counts, all/1/7/30/90-day
range selection, Agent chips, free-text title/project/path search,
anomaly/unpriced quick views, and sorting compose together and remain in the URL
when a Session is opened or the browser goes back. Source-provided Session
titles remain authoritative; an untitled Session gets a display-only
Agent/project/start-time label instead of an opaque ID. That fallback is not
persisted and does not inspect or preview prompt, answer, or reasoning content.
Project labels prefer captured `cwd`. Codex Sessions without that evidence are
grouped as **Codex 会话记录**. Codex Desktop Sessions whose non-empty `cwd` is a
generated `~/Documents/Codex/YYYY-MM-DD/<session>` workspace use the same group;
that workspace and the dated `~/.codex/sessions/YYYY/MM/DD/` source storage are
runtime/time partitions, not project names. The raw paths remain available as
evidence, and this display/statistics rule does not require re-importing Sessions.
Large result sets render in bounded batches instead of creating every row at
once.

The **任务** workspace adds local delivery evidence above Session analysis. A
Task can link multiple Sessions, attach version/hash-only Configuration
Snapshots, and record build/test/lint/Git Outcome fields. The local model/API
also supports human rating, rework reason, completion time, and bounded
structured evidence; missing fields remain visibly uncollected rather than
failed. `task-profile/v1` aggregates available linked Sessions with explicit
coverage and limitations. Cohort and experiment APIs persist comparison
definitions and evidence state, but do not yet calculate a causal winner from
process metrics.

## How to read a Profile

- **Session analysis** explains one observed run. It is process evidence, not
  delivery proof.
- **Agent Process Profile** (`agent-profile/v1`) describes distributions across
  an Agent’s current Sessions: resources, context, reliability, collaboration,
  coverage, and neutral peer-relative characteristics.
- **Task Profile** (`task-profile/v1`) describes one delivery unit, its linked
  Sessions/configurations, explicit Outcome coverage, and aggregated process
  evidence.
- A cohort/configuration-level Runtime Profile, automated experiment result,
  regression decision, and live Runtime feedback are future work. They are not
  current product claims.

## What the main views do

- **会话** — browse a flat recent Session list by project and Agent; open a session for
  diagnosis, context/cost, tools/chain, or normalized evidence.
- **任务** — connect Sessions and configuration versions to explicit delivery
  Outcomes and inspect a coverage-aware Task Profile.
- **画像** — inspect Agent Process Profiles with sample-size and coverage limits.
  “Higher” or “lower” describes observed behavior, not quality.
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

OpenCode is read from its SQLite database in read-only mode. Its current schema
stores token totals at Session granularity rather than per message, so
Agent Profile keeps one explicitly labelled aggregate LLM turn instead of
inventing a per-message allocation. Cache writes map to cache creation, cache
reads remain separate, and reported reasoning tokens are included in output
usage. Cost is recalculated from the captured model and token classes; the
source database's aggregate cost is not treated as portable billing evidence.

## Configuration

| Variable | Purpose |
| --- | --- |
| `PORT` | API port; default `3000` |
| `HOST` | API bind host; default `127.0.0.1` |
| `WEB_ORIGIN` | Comma-separated browser origins allowed by API CORS; defaults to the local Web origins on port `3001` |
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
  and notes, but retains pricing, model-context configuration, migration,
  Tasks, Outcomes, Configuration Snapshots, cohorts, experiments, and their
  logical Session links so runtime evidence can be synchronized again.
- Prompt review is ephemeral: prompt text is not written to the database and is
  not sent to a semantic provider by that feature.
- Source data varies. A missing field means “not captured”, not zero, success,
  or failure.

For a file-level backup, stop `pnpm dev` or `pnpm start`, then copy the database
(or the path selected by `TRACE_DB_PATH`):

```bash
cp apps/server/trace.db apps/server/trace.db.backup-YYYYMMDD
```

To restore, keep the Server stopped, preserve the current database if needed,
then copy the selected backup over `apps/server/trace.db` and start the app.
Use **强制重建** instead when the database is healthy and only derived parser
or metric results need refreshing.

The compatibility `POST /api/scan` endpoint remains available for scripts that
import one explicit transcript directory. Send JSON such as
`{"dir":"/absolute/history/path","agent":"codex"}`; the normal UI uses the
multi-source import job instead.

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

- There is no packaged desktop application yet. `pnpm start` is the supported
  non-watch local launcher.
- Task, Configuration Snapshot, Outcome, cohort, and experiment records are
  local foundations. Automated cohort statistics, regression detection,
  causal experiment conclusions, and Runtime feedback/SDK integration are not
  implemented.
- Cross-file parent/child Codex threads remain separate Sessions. Their
  sidechain evidence is preserved, but a full persisted task graph is future
  work.
- Very large session histories still use file discovery and full changed-session
  replacement; append-only parsing and large-session virtualisation are planned
  improvements.
- The application is designed for local use. Do not expose its API to an
  untrusted network without adding authentication and directory-access controls.
  Setting `HOST=0.0.0.0` is an explicit opt-in that exposes the unauthenticated
  API beyond loopback; pair it with a narrow `WEB_ORIGIN` only on a trusted
  network.

## Development checks

```bash
pnpm test
pnpm build
pnpm lint
pnpm benchmark:scale:ci
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
- [Task and Outcome foundations](docs/tasks-outcomes.md) — persistence, privacy,
  reset behavior, Task Profile, and experiment guardrails
- [Performance benchmark](docs/performance.md) — reproducible content-free
  scale fixture, desktop regression budgets, and measurement limits
- [Roadmap](docs/roadmap.md) — Task status and verification evidence
- [Runtime design](docs/agent-runtime-profile-design.md) — implemented phase
  status and remaining proposal
