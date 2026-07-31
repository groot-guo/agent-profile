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

- Node.js 22 or newer (an active LTS release is recommended)
- pnpm
- `zstd` on `PATH` for Zed transcript imports
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

To build the initial Node-based release for the current platform and
architecture:

```bash
pnpm build:release
tar -xzf dist/releases/agent-profile-0.0.1-<platform>-<arch>.tar.gz
./agent-profile-0.0.1-<platform>-<arch>/bin/agent-profile.mjs serve --open
```

The archive contains the CLI, Next.js standalone Web server, and the matching
native `better-sqlite3` package. It still requires Node.js 22+ and `zstd` on the
target machine and is only portable to the platform/architecture it names.
The current release build is local automation rather than a published package
or signed installer.

The Web development server writes `apps/web/.next-dev`; production builds write
`apps/web/.next`. You can safely run `pnpm build` while development is running.

The source workspace also provides the first `agent-profile` CLI entry point:

```bash
./packages/cli/bin/agent-profile.mjs help
./packages/cli/bin/agent-profile.mjs version --json
./packages/cli/bin/agent-profile.mjs doctor --data-dir ./local-data
./packages/cli/bin/agent-profile.mjs sources --json
./packages/cli/bin/agent-profile.mjs sync --source codex --source zed
./packages/cli/bin/agent-profile.mjs sessions --limit 20 --json
./packages/cli/bin/agent-profile.mjs stats --json
./packages/cli/bin/agent-profile.mjs profiles --json
./packages/cli/bin/agent-profile.mjs task-profile <task-id> --json
./packages/cli/bin/agent-profile.mjs serve --open
```

`doctor` opens and closes the same application Runtime as the Server, verifies
the selected SQLite database and the availability of all five local sources,
and writes human-readable output by default or `agent-profile-cli/v1` with
`--json`. It does not start HTTP or import source data. Opening the Runtime can
create the selected database and applies ordinary additive migrations and
default Model Catalog pricing/model-context seeding.

For CLI Runtime commands, the database path is selected from `--database`, then
`--data-dir/trace.db`, then `TRACE_DB_PATH`, then the platform application-data
default. Exit status is `0` for success, `2` for command usage errors, and `1`
for Runtime failures.

`serve` starts a private Next.js process and exposes both the Web UI and `/api`
through one loopback Fastify origin. It defaults to public port `3000`, private
Web port `3001`, and does not open a browser unless `--open` is supplied.
`--host` accepts loopback addresses only; `--port` and `--web-port` must differ.

`sources` refreshes local source availability and reports the stored primary
Session count without returning local paths or transcript identifiers. `sync`
uses the same Runtime import service as the API, waits for the selected sources
to finish, and reports the terminal per-source result. Omit `--source` to
select every supported source; repeat it to select multiple sources. It does
not start HTTP, but it does import derived local Session/Span data into the
selected database.

`sessions` returns a bounded page of current primary Session summaries: 20 by
default and at most 100 records, ordered by start time and ID. Pass the prior
JSON report's opaque `nextCursor` through `--cursor` to continue. Its report
omits Session names, local paths, transcript identifiers, Span metadata, and
content. Detailed Session analysis, cursor-paged evidence timelines, and opt-in
redacted previews remain in the Web/API.

`stats`, `profiles`, and `task-profile <id>` expose the already implemented
aggregate statistics, Agent Process Profile, and explicit Task Profile reports.
Their JSON reports retain the existing metric coverage and limitations. Process
evidence does not establish delivery quality; the Agent Profile's relative
observations are not universal quality rankings, and a Task Profile only covers
its explicitly linked Sessions and locally recorded Outcome evidence.

## First import

On startup, the Server begins one observable background import job. With no
stored Sessions, the Web switches to a dedicated data-preparation page: it
shows each available source and a source-level progress count instead of
leaving a generic empty dashboard that can look frozen. With stored Sessions,
sync or forced rebuild stays non-modal in one compact sidebar status row, so the
existing list and analysis remain usable. The row shows truthful source-level
completion and expands on demand for per-source detail; completion automatically
refreshes the displayed local data.

| Source | Default local location | When it is imported |
| --- | --- | --- |
| Claude Code | `~/.claude/projects` | startup, “同步数据”, and observed JSONL changes |
| Codex | `~/.codex/sessions` | startup, “同步数据”, and observed JSONL changes |
| Zed | local Zed `threads.db` | startup, “同步数据”, and observed DB/WAL changes when present |
| MiMo | local `mimocode.db` | startup, “同步数据”, and observed DB/WAL changes when present |
| OpenCode | `~/.local/share/opencode/opencode.db` | startup, “同步数据”, and observed DB/WAL changes when present |

If the list is empty, use the source-aware first-run panel or click
**同步数据**. The same deduplicated job used at startup checks all five sources
and reports imported, updated, skipped, and failed counts. The status API and UI
do not expose transcript text, full local paths, or source Session identifiers.
Progress is deliberately source-level: the Server does not report a misleading
file- or record-level percentage, so one large active source can leave the
progress count unchanged for a while. Unavailable local sources are excluded
from the progress denominator.

The Home sidebar keeps **同步数据** as its single primary data action. A compact
more-actions menu contains **刷新显示** and opens **数据管理** as a modal, so
forced rebuild and generated-data reset never consume Session-list height.
Forced rebuild reprocesses unchanged available sources
while preserving Session tags/notes, pricing, model-context configuration,
migrations, and Sessions whose source is currently unavailable. Reset is a
separate danger-zone action that requires the displayed confirmation phrase.

Sessions appear in one recent-first list with lightweight time boundaries; no
project folder needs to be expanded before opening a Session. Each row retains
its project label. A searchable grouped project picker separates Session-record
categories from recently used and other filesystem projects, displaying short
name, parent path, and count without losing the canonical project key. It composes
with all/1/7/30/90-day range selection, progressively disclosed Agent and quick
views, project/Agent/Session-ID search, and time/cost/token/cache/duration sorting.
The versioned `session-discovery/v2` API applies those filters and sorts in
SQLite, returns matched/total counts plus Agent/project facets, and uses a
query-bound keyset cursor. Home loads 120 matching Sessions at a time; the API
accepts at most 200. Filter and selected-Session state remains in the URL when a
Session is opened or the browser goes back.

When a configured local source changes, the Server debounces the event and
reuses the same revision/atomic-replacement import path. A content-free update
cursor refreshes Home and the selected detail only after stored evidence changes.
Rows updated within 30 seconds show **正在更新**; those updated within five
minutes show **最近活跃** and are grouped first in chronological view. These are
source-revision recency signals, not proof that an Agent process is running or
that a quiet Session is complete. If source watching is unavailable, manual
**同步数据** remains the recovery path.

The bounded Home response deliberately omits source Session names, local paths,
transcript identifiers, annotations, and prompt/reasoning/answer/tool content.
Rows therefore use a display-only Agent/project/start-time title instead of
inspecting content or exposing an opaque source title. The Session page uses the
bounded `session-analysis/v1` summary and cursor-paged `session-evidence-page/v1`
contracts; compatibility full-detail routes and `/api/sessions` remain available.
Project labels prefer captured `cwd`. Codex Sessions without that evidence are
grouped as **Codex 会话记录**. Codex Desktop Sessions whose non-empty `cwd` is a
generated `~/Documents/Codex/YYYY-MM-DD/<session>` workspace use the same group;
that workspace and the dated `~/.codex/sessions/YYYY/MM/DD/` source storage are
runtime/time partitions, not project names. The raw paths remain available as
evidence, and this display/statistics rule does not require re-importing Sessions.
Home overview totals, recent tools, and top-cost/top-token highlights come from
the bounded `home-statistics/v1` response rather than transferring the full
statistics report. The full `/api/stats` report remains available and now uses
set-based SQLite aggregation for Session-level totals and distributions.

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

The Session evidence view can reach every *stored normalized Span* through a
query-bound `(start time, ID)` cursor, but it is not every line of the original
transcript. It loads 80 events by default, supports server-side type/lane/outcome
filters, and reports full-Session coverage plus matched/total counts. Content
previews are off by default; when requested, only the current page's fields are
loaded, redacted, and bounded to 500 characters each. The overview uses complete
aggregates with sampled/windowed context, tool, and sidechain displays rather
than retaining the complete Span array in the browser.

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
| `NEXT_PUBLIC_API` | Optional Web API override; packaged and default Web requests use same-origin `/api` |
| `AUTO_SCAN_DIR` | Unset: scan default Claude Code and Codex directories. Empty: disable transcript auto-scan. A path: scan that one transcript directory. |
| `TRACE_DB_PATH` | Override the Server/CLI SQLite path when no CLI path option is supplied |
| `LLM_API_KEY` | Enables optional semantic diagnosis; no key is required for deterministic analysis |
| `LLM_PROVIDER`, `LLM_MODEL`, `LLM_BASE_URL` | Optional semantic-diagnosis provider settings |

Model, context, and diagnosis configuration has separate scopes:

- `/api/model-context` edits the exact raw model's context-window reference used
  for utilization and context-bloat analysis. Unknown model IDs stay unconfigured
  and do not inherit a provider or alias value. Seed references and vendor entry
  points are recorded in `apps/server/src/model-catalog/defaults.ts`.
- `/api/pricing` stores four token-class prices and an optional `effectiveFrom`.
  Imported and recomputed Session costs use the price effective at each LLM Span's
  start time; missing pricing remains unknown. `POST /api/recompute-cost` is the
  compatibility full historical recalculation operation.
- `/api/model-catalog/*` exposes `model-catalog/v1`: observed raw-model inventory,
  pricing history/provenance, exact context configuration, explicit audited
  `pricingEquivalent` aliases, content-free configuration import/export, and
  scoped preview/execute recalculation. Preview does not mutate data; execute
  requires the preview's pricing revision and records its result transactionally.
  Unsupported pricing schemes remain unknown.
- Deterministic diagnosis thresholds are Core-owned policy constants, not a
  user-editable Runtime setting. Their `wastedCost` values are current analysis-time
  input-price upper-bound estimates for planning, not historical billing evidence.
- A Task Configuration Snapshot records only the explicit Agent/model/version
  identifiers and source hash supplied by the Task; it does not silently capture
  pricing, context limits, prompts, or rules.

Example: start without transcript auto-scan.

```bash
AUTO_SCAN_DIR="" pnpm dev
```

## Local data and privacy

- Agent Profile reads local source histories and writes derived Session/Span
  data to SQLite. It does not upload transcript data by default.
- The default database is `~/Library/Application Support/agent-profile/trace.db`
  on macOS, `%LOCALAPPDATA%\agent-profile\trace.db` on Windows, and
  `${XDG_DATA_HOME:-~/.local/share}/agent-profile/trace.db` on Linux. Application
  files and mutable data are separate.
- A pre-T103 source-workspace database at `apps/server/trace.db` is not moved
  automatically. Continue using it with `--database apps/server/trace.db` or
  `TRACE_DB_PATH`, or copy it to the new default while every Agent Profile
  process is stopped.
- A forced rebuild is the normal recovery path after parser or metric changes.
  The danger-zone reset deletes every generated Session/Span, including tags
  and notes, but retains Model Catalog pricing/history/aliases/context,
  recalculation audit, migration,
  Tasks, Outcomes, Configuration Snapshots, cohorts, experiments, and their
  logical Session links so runtime evidence can be synchronized again.
- Prompt review is ephemeral: prompt text is not written to the database and is
  not sent to a semantic provider by that feature.
- Source data varies. A missing field means “not captured”, not zero, success,
  or failure.

For a file-level backup, stop `agent-profile serve`, `pnpm dev`, or `pnpm start`,
then copy the selected database:

```bash
cp "/selected/data/path/trace.db" "/selected/backup/path/trace.db.backup-YYYYMMDD"
```

To restore, keep the Server stopped, preserve the current database if needed,
then copy the selected backup over the selected database path and start the app.
Use **强制重建** instead when the database is healthy and only derived parser
or metric results need refreshing.

The compatibility `POST /api/scan` endpoint remains available for scripts that
import one explicit transcript directory. Send JSON such as
`{"dir":"/absolute/history/path","agent":"codex"}`; the normal UI uses the
multi-source import job instead.

## Troubleshooting

### No sessions appear

1. Confirm that a supported source exists at one of the default locations.
2. Follow the per-source startup status; use **同步数据** to retry any available
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

- The CLI supports `help`, `version`, `doctor`, `sources`, `sync`, bounded
  `sessions`, `stats`, `profiles`, `task-profile <id>`, and loopback `serve`.
  `build:release` produces an unsigned current-platform Node archive; there is
  no published package, signed installer, cross-platform CI matrix, or desktop
  application yet. Detailed Session/evidence CLI commands remain future work.
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
