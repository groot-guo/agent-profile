# Agent Profile

[中文说明](README.zh-CN.md) · [Profile model](docs/profile-model.md) · [Current architecture](ARCHITECTURE.md) · [Evolution plan](docs/profile-evolution-plan.md) · [Roadmap](docs/roadmap.md)

Agent Profile is a local-first runtime profiling, diagnosis, and
outcome-evaluation system for AI coding agents. It imports local Claude Code,
Codex, Zed, MiMo, and OpenCode Session data, then explains where time, tokens,
context, cost, tool calls, and sub-agent work went. It can connect that process
evidence to explicit Task Outcomes without treating lower resource use as proof
of better delivery.

It is an analysis tool for observed runtime process and local delivery evidence.
Source watching refreshes persisted local history after it changes; it is not a
live Agent execution trace or an automatic optimization/control loop. It is not
a chat-history viewer, a hosted monitoring service, a code-quality
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
./packages/cli/bin/agent-profile.mjs diagnosis <session-id> --json
./packages/cli/bin/agent-profile.mjs evidence <session-id> --json
./packages/cli/bin/agent-profile.mjs task-outcome <task-id> --confirm --evidence-kind review --evidence-status observed --json
./packages/cli/bin/agent-profile.mjs task-feedback <task-id> --opt-in --json
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
aggregate statistics, Project Profile, Agent Process Profile, and explicit Task
Profile reports.
Their JSON reports retain the existing metric coverage and limitations. Process
evidence does not establish delivery quality; the Agent Profile's relative
observations are not universal quality rankings, and a Task Profile only covers
its explicitly linked Sessions and locally recorded Outcome evidence.
The Web also includes a read-only `/projects` view over one project's observed
primary Sessions; it does not represent complete repository activity or delivery
quality.

`diagnosis <session-id>` and `evidence <session-id>` add content-free, bounded
Agent-readable reports. Diagnosis returns finding types, severity, cost/token
impact, and exact Span IDs; evidence returns stable event references and
coverage without prompt, answer, thinking, tool input, tool output, local paths,
or transcript identifiers. `task-outcome <task-id>` requires `--confirm
--evidence-kind ...` and appends only the explicitly supplied,
repository-validated evidence entry; it never infers a passing check.
`task-feedback <task-id>` requires `--opt-in` and returns bounded, read-only
`post-run-feedback/v1` reports. All four commands emit `agent-profile-cli/v1`
wrappers in JSON mode.

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
Snapshots, and record build/test/lint/Git status, a 1–5 human rating, rework
reason, completion time, and up to 50 structured evidence entries. Each entry
has a required kind plus optional verification status, local reference, and
bounded provenance when it came from local assistance;
invalid entries are rejected rather than converted into a result. Missing
fields remain visibly uncollected rather than failed. `task-profile/v1`
aggregates available linked Sessions with explicit coverage and limitations;
its five-field verified coverage is build, test, lint, Git commit, and human
rating. `verified` means every coverage field is present, not that every recorded
check passed. `GET /api/experiments/:id/profile` provides Outcome-guarded,
minimum-sample distributions and bounded guardrail results. For a completed,
Outcome-verified candidate Task, the workspace explicitly reads
`GET /api/tasks/:id/feedback?optIn=true` to show bounded `post-run-feedback/v1`
findings linked to Experiment evidence and limitations. It does not infer a
universal or causal winner, expose raw Task/transcript content, or change a
configuration from process metrics.

The Task workspace can explicitly prefill a new Task's title/project from a
locally observed Session and can request `GET /api/tasks/:id/assistance` for a
bounded `task-assistance/v1` candidate report. Candidates use a matching project
key and seven-day local time window. Each Session link and Git evidence candidate
must be accepted separately; accepted Session links retain producer/time/source
provenance, while Git candidates enter the Outcome draft and require an explicit
save. The workspace never loads the full Session array: its Session pickers use
the bounded `session-discovery/v2` search with a 50-row window and a keyset
cursor, so large histories stay interactive while the linked-Session list
remains complete. No candidate marks build, test, lint, or delivery success,
and raw prompt or transcript content is not used.

The approved read-only `outcome-evidence/v1` local Git adapter is available only
after an explicit source selection through
`GET /api/tasks/:id/outcome-evidence?source=local_git`. It reports bounded
metadata with visible producer, capture time, source reference, limits, and
limitations. `not_captured` and `observed` are distinct from verification
statuses; observed Git metadata is not a passing result. The adapter uses fixed
Git metadata queries only, does not execute arbitrary, build, test, or lint
commands, does not upload or write Outcome data, and does not enable remote CI
evidence.

The local loopback Runtime collector accepts `runtime-event/v1` metadata through
`POST /api/runtime/events` and returns bounded sequence-ordered references from
`GET /api/runtime/runs/:runId/events`. Events carry task/run identity, sequence,
parent references, lifecycle kind, timing, and allowlisted metadata only.
Exact duplicates are idempotent; sequence conflicts are rejected without
replacing existing events; out-of-order arrivals remain visible as partial
ordering coverage. This collector is an observed local source, not live hints,
automatic configuration control, or a replacement for transcript imports.
An event producer must explicitly set `coverageComplete: true` on every batch
that it attests as complete; missing or false attestation keeps Runtime hint
coverage unknown and suppresses hints.

An explicit `GET /api/runtime/runs/:runId/hint?optIn=true` can return a bounded
`runtime-hint/v1` hypothesis when the run has fresh complete event coverage,
ready descriptive cohort evidence, and a repeated tool-failure signal. The
hint is short-lived, rate-limited, content-free, and stores only event and
experiment references. `POST /api/runtime/hints/:hintId/adoption` records an
explicit `adopted`, `ignored`, or `not_recorded` status; later tool behavior
never infers adoption, and no Agent configuration is changed.

## How to read a Profile

- **Session analysis** explains one observed run. It is process evidence, not
  delivery proof.
- **Agent Process Profile** (`agent-profile/v1`) describes distributions across
  an Agent’s current Sessions: resources, context, reliability, collaboration,
  coverage, and neutral peer-relative characteristics.
- **Project Profile** (`project-profile/v1`) describes one project key across
  primary Sessions: resource totals, source/metric coverage, tool reliability,
  and time trends. It is bounded process evidence; file coverage may remain
  `not_captured`.
- **Task Profile** (`task-profile/v1`) describes one delivery unit, its linked
  Sessions/configurations, explicit Outcome coverage, and aggregated process
  evidence.
- **Verified Post-Run Feedback** (`post-run-feedback/v1`) is an opt-in,
  read-only finding for an eligible completed candidate Task. It links only to
  current cohort evidence, guardrails, and limitations; insufficient or stale
  evidence is suppressed rather than recommended.
- `cohort-runtime-profile/v1` provides a bounded cohort/configuration comparison
  when Outcome and metric coverage meet minimum thresholds. A Cohort may declare
  `comparability.dimensions` using `project_id`, `task_type`, and `complexity`;
  strata without a control/candidate counterpart or sufficient Outcome coverage
  are excluded and reported. The report exposes `ready`, `insufficient_evidence`,
  or `not_comparable`, plus median/IQR, sample deviation, and a bounded 95%
  normal-approximation effect interval. These are descriptive observations, not
  causal or universal winners; external Runtime SDK feedback and automatic
  configuration mutation remain future work.

## What the main views do

- **会话** — browse a flat recent Session list by project and Agent; open a session for
  diagnosis, context/cost, tools/chain, or normalized evidence.
- **项目** — inspect one project's observed primary Sessions, source and metric
  coverage, UTC-day tool/resource trace, and stated evidence limits.
- **任务** — connect Sessions and configuration versions to explicit delivery
  Outcomes, inspect a coverage-aware Task Profile, and read eligible post-run
  findings with their Experiment evidence.
- **画像** — inspect Agent Process Profiles with sample-size and coverage limits.
  “Higher” or “lower” describes observed behavior, not quality.
- **迭代** — review a task prompt locally for goal, scope, acceptance,
  constraints, context, and verification structure. Optional runtime-profile
  hints are hypotheses to validate, not automatic prompt rewrites.
- **统计** — inspect aggregate token, cost, context, project, Agent, and model
  distributions, then select a project for its bounded Project Profile.

The Session evidence view can reach every *stored normalized Span* through a
query-bound `(start time, ID)` cursor, but it is not every line of the original
transcript. It loads 80 events by default, supports server-side type/lane/outcome
filters, and reports full-Session coverage plus matched/total counts. Content
previews are off by default; when requested, only the current page's fields are
loaded, redacted, and bounded to 500 characters each. The overview uses complete
aggregates with sampled/windowed context, tool, and sidechain displays rather
than retaining the complete Span array in the browser.

Diagnosis findings with stored Span references can open this evidence view with
an exact, bounded `spanIds` focus query. The URL preserves that focus for a
reload or handoff, keeps `content=none` by default, and reports when a target is
missing or excluded by the current filters; findings without a Span reference
remain explicitly unavailable rather than being inferred from nearby events.

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
| `HOST` | API bind host; loopback addresses only, default `127.0.0.1` |
| `WEB_ORIGIN` | Comma-separated browser origins allowed by API CORS; defaults to the local Web origins on port `3001` |
| `NEXT_PUBLIC_API` | Optional Web API override; packaged and default Web requests use same-origin `/api` |
| `AUTO_SCAN_DIR` | Unset: scan default Claude Code and Codex directories. Empty: disable transcript auto-scan. A path: scan that one transcript directory. |
| `TRACE_DB_PATH` | Override the Server/CLI SQLite path when no CLI path option is supplied |
| `LLM_API_KEY` | Legacy fallback: enables optional semantic diagnosis when no server-side provider file exists; no key is required for deterministic analysis |
| `LLM_PROVIDER`, `LLM_MODEL`, `LLM_BASE_URL` | Legacy fallback provider settings; the server-only configuration file takes precedence |

Semantic diagnosis uses configured-provider processing only after an explicit
request-scoped `semantic=opt_in` diagnosis request. The Provider is configured
server-side through `GET /api/provider/status` (non-secret status) and
`PUT /api/provider/configuration` (provider, base URL, model, and API key);
the key is stored in a server-only `provider.json` file (`0600`) and never
reaches browser state, localStorage, logs, exports, or source files. The status
API discloses the endpoint host and whether it is loopback or external, the
provider, model, configuration source, and test/restart requirements without
revealing the key. The endpoint may be local or external; Agent Profile does not
independently verify endpoint locality beyond the loopback/external disclosure.
The Web disclosure explains that only bounded, common-secret-
redacted Session title, thinking, and tool-input excerpts are sent; the response
reports the provider, payload counts, redaction count, and failure status without
returning payload content. A bounded process-local audit keeps Session ID,
timestamps, status, and payload counts only; raw source or provider response
content is not stored. Leave the key unset, or do not opt in, for deterministic
local diagnosis only. When no LLM turn in the Session has captured token/model
telemetry, semantic conclusions are suppressed and the diagnosis reports
`insufficient_evidence` instead of guessing.

Model, context, and diagnosis configuration has separate scopes:

- `/api/model-context` edits the exact raw model's context-window reference used
  for utilization and context-bloat analysis. Unknown model IDs stay unconfigured
  and do not inherit a provider or alias value. Seed references and vendor entry
  points are recorded in `apps/server/src/model-catalog/defaults.ts`.
- `/api/pricing` stores four token-class prices and an optional `effectiveFrom`
  provenance field. Imported and explicitly recomputed Session costs use the
  newest active price for the exact raw model, including historical LLM Spans
  that predate the configured `effectiveFrom`; missing pricing remains unknown.
  `POST /api/recompute-cost` is the compatibility full historical
  recalculation operation.
- `/api/model-catalog/*` exposes `model-catalog/v1`: observed raw-model inventory,
  pricing history/provenance, exact context configuration, explicit audited
  `pricingEquivalent` aliases, content-free configuration import/export, and
  scoped preview/execute recalculation. Preview does not mutate data; execute
  requires the preview's pricing revision and records its result transactionally.
  Unsupported pricing schemes remain unknown.
  Every LLM Span carries an evidence-safe `costStatus`: `known`,
  `unknown_pricing`, `unverified_provider_route`, `token_usage_not_captured`,
  `unsupported_scheme`, `excluded_synthetic`, or `not_applicable`. Only
  `known` is a trusted bill; everything else must never render as `¥0`, a zero
  cost, or a complete comparison input. Synthetic placeholder labels are
  excluded from billing entirely, and the settings/stats surfaces show known,
  unknown, and excluded Session counts separately.
- `/settings/models` is the local Web workspace over that public contract. It
  prioritizes observed unpriced/unsupported identities, edits four-token prices
  and exact context limits with provenance, keeps history non-destructive, and
  requires preview plus explicit confirmation before scoped recalculation.
  Versioned configuration import/export stays local and excludes Session/prompt
  content.
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
  logical Session links, plus locally collected Runtime events/coverage and bounded
  Runtime hint/adoption records so runtime evidence can be synchronized again.
- Prompt review is ephemeral: prompt text is not written to the database and is
  not sent to a semantic provider by that feature.
- Semantic diagnosis is different from prompt review. An explicit semantic
  request can transmit the bounded, common-secret-redacted source-derived payload
  described in **Configuration** to its configured provider, which may be local or
  external. Redaction is a safety pass, not a guarantee against every secret;
  endpoint locality is not verified, and only content-free bounded audit metadata
  is retained.
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
  `sessions`, `stats`, `profiles`, `task-profile <id>`, `diagnosis <session-id>`,
  `evidence <session-id>`, explicit `task-outcome <task-id>`, opt-in
  `task-feedback <task-id>`, and loopback `serve`.
  `build:release` produces an unsigned current-platform Node archive; there is
  no published package, signed installer, cross-platform CI matrix, or desktop
  application yet.
- Task, Configuration Snapshot, Outcome, cohort, and experiment records are
  local foundations. The bounded cohort report, opt-in post-run findings, and
  bounded local Runtime hint policy are implemented; broader automated
  regression detection, causal experiment conclusions, and external Runtime
  feedback/SDK integration are not implemented.
- Cross-file parent/child Codex threads remain separate Sessions. When Codex
  captures `parent_thread_id`, the Session detail page shows the source-native
  link (including an unavailable parent); a universal task graph and combined
  resource attribution remain future work.
- Very large session histories still use file discovery. Safe Claude Code/Codex
  JSONL appends can reuse a process-local structural checkpoint; rewrites,
  malformed or incomplete suffixes, and forced rebuilds fall back to full
  changed-session replacement. Large-session virtualisation remains future work.
- The application is designed for local use. Do not expose its API to an
  untrusted network. Both `agent-profile serve` and the source-workspace Server
  reject non-loopback hosts; the Server `HOST` override accepts loopback
  aliases only. Non-local access would require a new, explicit product and
  threat-model decision.

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

Continuous integration runs lint, roadmap/boundary checks, all package tests,
the production build, and the scale benchmark on every push and pull request
(`.github/workflows/ci.yml`). A bounded Playwright smoke suite (`apps/web/
test:e2e`) starts the local CLI serve with disposable data and verifies the
health endpoint and primary Web navigation; it runs as a separate CI job after
installing Chromium.

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
- [Evolution plan](docs/profile-evolution-plan.md) — proposal-only dependency
  map for the next evidence, Agent, Runtime, comparison, and operations work
- [Roadmap](docs/roadmap.md) — Task status and verification evidence
- [Runtime design](docs/agent-runtime-profile-design.md) — implemented phase
  status and remaining proposal
