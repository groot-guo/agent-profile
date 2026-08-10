# Agent Profile — Current Architecture

This document describes the implementation that exists today.
Agent Profile is a local-first runtime profiling, diagnosis, and
outcome-evaluation system for AI coding agents. Its canonical current-state
terminology is in `docs/profile-model.md`. Task/Outcome/Configuration
persistence, Task-Session links, cohort/experiment definitions,
`task-profile/v1`, `cohort-runtime-profile/v1`, and bounded
`post-run-feedback/v1` are implemented foundations. The local
`runtime-event/v1` protocol, metadata-only collector, and bounded opt-in
`runtime-hint/v1` policy are also implemented; broader automated cohort
statistics, causal experiment evaluation, automatic regression decisions, and
external Runtime SDK feedback remain proposals. Their dependency plan is
`docs/profile-evolution-plan.md`; the future Runtime design is in
`docs/agent-runtime-profile-design.md`. The prompt-review surface remains
ephemeral and does not automatically create or modify those persisted records.

It imports local Claude Code, Codex, Zed, MiMo, and OpenCode data, normalizes
their different formats into Sessions and Spans, computes comparable process
metrics, and exposes the results through a local API and web application.

## Profile model

The product has distinct evidence layers:

- **Span/Event evidence** and **Session analysis** describe observed runtime
  process; they do not prove delivery success.
- **Project Profile** is the implemented `project-profile/v1` report over a
  selected project key and its primary Session sample. It aggregates observed
  resources, source coverage, tool reliability, and time trends while keeping
  file evidence and missing fields explicit.
- **Agent Process Profile** is the implemented `agent-profile/v1` report over
  Session distributions. Its scope is currently Agent plus available Session
  evidence; it is not grouped by Configuration Snapshot, Task type, or Outcome.
- **Task Profile** is the implemented `task-profile/v1` report for one explicit
  delivery unit, its linked Sessions/configurations, and its explicit Outcome
  coverage.
- **Cohort/Experiment definitions** persist comparison scope and guardrails.
  The local Task workspace can create and edit those definitions. The bounded
  `cohort-runtime-profile/v1` report evaluates declared comparable strata and
  guardrails without calculating a universal or causal winner. It exposes
  included/excluded strata, `ready`/`insufficient_evidence`/`not_comparable`,
  robust distribution summaries, and bounded effect uncertainty.
- **Post-run feedback** is an opt-in, read-only `post-run-feedback/v1` report
  for one completed, Outcome-verified candidate Task. It links a bounded finding
  to the current cohort report, decision, guardrails, and limitations; it does
  not mutate configuration or transmit raw Task/transcript content.
- Broader time-window/statistical regression policies, external Runtime SDK
  feedback, and automatic Runtime control remain future work beyond the current
  bounded reports, local event collector, and opt-in hint policy.

All reports expose their scope and limitations. Process metrics may form a
diagnostic or iteration hypothesis; they are not a universal Agent ranking or a
code-quality verdict.

## System flow

The diagrams in this document use solid arrows for implemented runtime/data
flow. Proposed capabilities are named in prose with their roadmap Task; no
dashed or unlabeled arrow should be read as deployed behavior.

```text
Claude Code JSONL ─┐
Codex rollout JSONL ┤
Zed SQLite + zstd ──┼─→ source adapters ─→ Import Runtime/import coordinator
MiMo SQLite ────────┤                                      │
OpenCode SQLite ────┘                                      ▼
                                              analyzer → session repository
                                                               │
                                                               ▼
Production entry → App Runtime ─────────────────────────────→ SQLite
                       │
                       ├─→ CLI adapter
                       └─→ Fastify adapter → Next.js UI
```

`AppRuntime` is the current application composition boundary. Production creates
one selected SQLite connection, then constructs one Model Catalog service,
pricing and model-context resolvers backed by that service, one per-Runtime
import service/job manager, a clock, and one
idempotent close operation around that connection. `createApp(runtime, options)`
only adapts the supplied Runtime to Fastify; route registrars receive explicit
Runtime capabilities and do not create a production database or import manager.
The process entry point starts background imports and owns HTTP/signal shutdown,
closing Fastify and the same Runtime. Tests can therefore create isolated
in-memory Runtimes without environment-before-import ordering. The
`@agent-profile/cli` package calls the same production Runtime directly for
`doctor`, refreshes source availability without starting imports or HTTP, and
always closes the Runtime before exit. Opening `doctor` still performs ordinary
database creation, additive migration, and default reference-data seeding.

## Architecture views

### Runtime composition and module direction

```text
user / local Agent
        │
        ▼
single agent-profile CLI entry
        ├── direct commands ──→ AppRuntime ──→ SQLite
        └── serve ────────────→ Fastify ─────→ AppRuntime ──→ SQLite
                                  │
                                  └── same-origin proxy ──→ Next.js Web

apps/web ───────────────→ @agent-profile/contracts
packages/cli ───────────→ @agent-profile/contracts + Server composition
apps/server ────────────→ @agent-profile/contracts + @agent-profile/core
@agent-profile/contracts     (framework-neutral public DTO ownership)
@agent-profile/core          (parsing and deterministic domain analysis)
```

These are package and composition boundaries inside one local application, not
independently deployed services. T130 tightened DTO ownership and dependency
checks: public mutation request/response shapes live in
`@agent-profile/contracts` with runtime JSON-schema validation on Server routes,
and the repository boundary checker rejects Web/CLI imports of Server
application code and non-type imports of contracts from Web. T131 may split
stable responsibilities inside existing top-level packages but does not
introduce new services or packages by default. T131 has been applied: CLI
formatting/argument parsing, Server task validation/row mappers/database
schema, and Web Session/home/stats/model-catalog/layout feature-local modules
were extracted from oversized files without changing behavior or boundaries.

### Ingestion and replacement sequence

```text
Scanner / database discovery
        → Source Adapter (lazy item + stable revision fingerprint)
        → Import Coordinator (skip/import/update/failure decision)
        → Session Repository (parse/analyze + atomic replacement)
        → SQLite Session/Span evidence
```

Unchanged revisions are skipped. A successful changed item replaces only its
generated Session/Spans atomically while preserving annotations; a failed or
unavailable source leaves last-good stored evidence intact.

### Evidence, Task, and feedback layers

```text
Span/Event → Session analysis → Agent Process Profile / Project Profile
                                      │
explicit Task ← Session links + Configuration Snapshots + Outcome evidence
      │
      ├──→ Task Profile
      └──→ Cohort + Experiment → bounded Cohort Runtime Profile
                                      │
                                      └──→ opt-in post-run feedback

runtime-event/v1 → bounded local hint policy → explicit adoption record
```

The arrows show evidence composition, not causal proof. Task membership and
Outcome evidence are explicit; missing fields stay unavailable. The cohort
report is descriptive, and feedback/hints are read-only advice that cannot
mutate Agent configuration.

### Security and multi-agent boundaries

```text
local histories ──→ loopback-only application ──→ local SQLite
                              │
                              └── explicit semantic opt-in only
                                   → bounded/redacted provider payload

current:  source-native parent/child evidence + explicit Task links
           + T119 typed Task graph with reconciled, non-double-counted attribution
```

Non-local application access is outside the selected product boundary. The
source-workspace Server and the CLI both reject non-loopback hosts, so no
supported startup path exposes the API beyond loopback. Provider egress is a
separate request-scoped consent boundary and does not make the application a
remote service. T119 must not infer multi-agent edges from titles, paths,
timestamps, or models.

Scanning is revision-based. Each source item provides a source kind, source
update time, and stable fingerprint. The coordinator skips matching revisions,
reports additions/updates/failures separately, and asks the repository to
atomically replace changed normalized sessions. Legacy rows without a
fingerprint refresh once on their next scan. One in-memory import-job manager
owns both startup and Web-triggered synchronization for configured
Claude/Codex directories and available Zed/MiMo/OpenCode databases. It
deduplicates each source, isolates failures, and exposes per-source state
without blocking server startup. The compatibility scan API still supports a
selected transcript directory; the Web uses the shared multi-source job instead.
After startup, a Server-owned source observer watches configured transcript
directories and the parent directories of supported SQLite databases. Events
are debounced and each source has a five-second cooldown. Claude/Codex events
re-import only the changed JSONL file; database and WAL events wake the ordinary
revision-based source import. Observation joins the same per-source job manager,
so it cannot race a manual synchronization or rebuild. A watcher that cannot be
created does not make an otherwise usable source destructive: manual sync remains
available and the existing last-good normalized Session stays intact.

The Web derives its import progress only from that public per-source state. If
an active job starts with zero stored Sessions, Home renders a dedicated
data-preparation page with available-source cards, a determinate
completed-source/available-source count, and an explicit source-level
limitation. Unavailable sources are excluded from the denominator. During
sync or forced rebuild when Sessions already exist, Home keeps the list and
analysis interactive and adds one compact, expandable status row beside the
sidebar data action. Its collapsed state shows the operation and settled/available
source count; expansion shows active, completed, unavailable, and failed source
detail without turning the result into file- or record-level progress.
It polls the existing job status and refreshes dashboard data once when the job
becomes terminal. Separately, one serialized content-free update cursor waits up
to 25 seconds and refreshes Home or the selected detail only after a successful
source revision change. Neither path creates a second import pipeline or implies
file-/record-level progress.

Home keeps `同步数据` as the single primary data action. `刷新显示` is subordinate
in a more-actions menu, while forced rebuild and generated-data reset live in a
modal with an explicit danger zone and the existing reset phrase. Session discovery
uses a dependency-free searchable project combobox: special Session-record
categories are grouped separately, filesystem projects show short name plus parent
path and recent/other grouping, and selection still stores the canonical project
key in the URL. Agent and quick-view filters are progressively disclosed; their
active values remain visible through the filter count and preserve URL semantics.

The same job manager also owns an explicit forced-rebuild operation. Rebuild
bypasses matching source fingerprints but keeps the normal lazy load, analysis,
and per-Session atomic replacement path. A parse/load failure therefore leaves
the prior normalized Session intact, annotations survive successful
replacement, and unavailable sources are not deleted. Full generated-data
reset is deliberately separate: it requires an exact confirmation phrase,
cannot run during an import job, deletes `spans` and `sessions` in one
transaction, and retains `pricing`, `pricing_history`, `pricing_aliases`,
`model_context`, `cost_recalculation_runs`, and `schema_migrations`.
Task, Outcome, Configuration Snapshot, cohort, experiment, and logical
Task-Session records, plus locally collected `runtime_events`, are also retained
so imported runtime evidence can be restored later without losing delivery
context.

Scan results also expose structured `skipReasons`: `unchanged_revision` means a
matching source fingerprint required no work, while `not_importable` means the
source item did not produce a normalized Session (for example, a metadata-only
history with no usable LLM turn), and `excluded_non_actionable` means exact
source metadata identified a history that must not become another normalized
Session. These remain skipped items rather than import failures; malformed
items that throw are counted separately as failures. Scan results separately
count `protectedAnnotatedSessions` when cleanup cannot remove an obsolete
generated copy because it has user tags or notes; the Web labels those records
as requiring manual action instead of presenting them as retryable parse errors.

## Components

| Component | Current responsibility |
| --- | --- |
| `packages/core` (`@agent-profile/core`) | Source parsing helpers, normalized types, deterministic analysis and diagnosis, versioned Agent profile, prompt-review, and Session-evidence reports, tool categorization, pricing calculations |
| `packages/contracts` (`@agent-profile/contracts`) | Framework-neutral public contracts for implemented cross-package vertical slices; import/data-management responses, Task/Cohort/Experiment/Configuration mutation DTOs with JSON-schema validation, `agent-profile-cli/v1` reports, and `runtime-event/v1` collector/page contracts |
| `packages/cli` (`@agent-profile/cli`) | Source-workspace `agent-profile` binary, argument/data-path resolution, human/JSON reports, Runtime doctor, and content-free local Agent workflow |
| `packages/core/src/scanners/transcript.ts` | Source-neutral async JSONL discovery and NDJSON reading shared by Claude Code and Codex, with compatibility sync helpers |
| `apps/server/src/runtime.ts` | Explicit application lifecycle for one database connection, pricing/context resolvers, import state, clock, and shutdown |
| `apps/server/src/app.ts` | Fastify composition adapter over an explicitly supplied Runtime and HTTP options |
| `apps/server/src/ingestion/import-runtime.ts` | Per-Runtime source definitions, import job manager, Session repository, compatibility scan, rebuild/reset, and idle coordination |
| `apps/server/src/ingestion/*-adapter.ts` | Source-specific discovery, revision fingerprinting, lazy loading, and parser invocation |
| `apps/server/src/ingestion/import-coordinator.ts` | Shared skip/import/update/failure decisions across every source |
| `apps/server/src/ingestion/import-job-manager.ts` | Deduplicated startup/manual sync and rebuild state, availability, progress, failure isolation, and bounded public status |
| `apps/server/src/ingestion/session-repository.ts` | Normalized analysis, atomic session/span replacement, and transactional generated-data reset |
| `apps/server/src/task-repository.ts` | Task/configuration/Outcome/cohort/experiment persistence boundary and Task Profile aggregation inputs |
| `apps/server/src/runtime-event-collector.ts` | Metadata-only local Runtime event validation, idempotent append, ordering/coverage, and bounded references |
| `apps/server/src/routes/scan.ts` | Thin HTTP import/data-management adapter over the Runtime import service; contains no import persistence SQL or production fallback |
| `apps/server/src/database.ts` | SQLite creation, ordered migrations, and time-aware pricing lookup |
| `apps/server/src/db.ts` | Pricing/model-context default seeding and database-scoped model-context lookup helpers; it does not own a process-global connection |
| `apps/server/src/routes/` | Health, sessions, Tasks/Outcomes/experiments, aggregate analysis, diagnosis, statistics, pricing, context-window, scan, export, and comparison APIs |
| `apps/web` | Project/session navigation, Task verification workspace, dashboards, detail analysis, Agent profiles, ephemeral prompt review, comparisons, statistics, annotations, and configuration UI |

The API is split by domain under `apps/server/src/routes/`; it is not a single
monolithic routes file.

The source workspace retains root `pnpm start`. The distributable launcher is
`agent-profile serve`: it starts a private loopback Next.js standalone process,
then a public loopback Fastify process that proxies non-API requests to Next and
serves `/api` directly. Browser and API traffic therefore share one origin.
Startup failure closes every already-created layer; SIGINT/SIGTERM close
Fastify, wait for Runtime imports, close SQLite, and stop Next. The CLI rejects
non-loopback hosts because this API has no authentication or directory
authorization.

The workspace CLI is available at `packages/cli/bin/agent-profile.mjs` after
dependency installation. Its production esbuild bundle removes `tsx` and
TypeScript source execution. `build:release` combines that bundle, Next
standalone/static/public assets, and the current platform's native
`better-sqlite3` tree in a versioned tar archive. A static export was rejected:
the implemented `/session/[id]` route is dynamic and must support arbitrary
stored Session IDs. Archives require Node.js 22+ and external `zstd`; only the
current host platform/architecture is emitted and darwin-arm64 is the first
smoke-tested target.
`doctor` resolves its database from `--database`, `--data-dir/trace.db`,
`TRACE_DB_PATH`, or the platform application-data default, in that order. It never starts
imports or HTTP, and returns exit status `2` for usage errors and `1` for Runtime
failures. `sources` refreshes the same bounded source status returned by the
compatibility API. `sync` uses the shared import service, waits for selected
sources to finish, and reports terminal results; neither starts HTTP. Session
discovery reads a safe primary-Session summary page (default 20, maximum 100),
ordered by `start_time` and ID with an opaque cursor. It omits Session names,
local paths, transcript identifiers, Span metadata, and content. The
compatibility `GET /api/sessions` route retains its existing full-array response
through the same query service. Content-free `diagnosis`/`evidence`, explicit
Outcome writing, and opt-in Task feedback are implemented as versioned local
CLI interfaces.

The product security boundary is loopback-only. The distributable CLI and the
source-workspace Server both enforce that boundary; the Server `HOST` override
accepts loopback aliases only. It is not an open choice between local and
remote deployment.

The default database is outside application files:
`~/Library/Application Support/agent-profile/trace.db` on macOS,
`%LOCALAPPDATA%\agent-profile\trace.db` on Windows, and
`${XDG_DATA_HOME:-~/.local/share}/agent-profile/trace.db` on Linux.
Explicit database/data-directory options and `TRACE_DB_PATH` take precedence.
Pre-T103 `apps/server/trace.db` files are not copied implicitly; users may keep
selecting that path or copy it while all processes are stopped.

`stats`, `profiles`, and `task-profile <id>` are read-only Runtime adapters over
the current aggregate statistics, Agent Process Profile, and TaskRepository
Profile builders. They return the existing report data with its coverage and
limitations; they do not add metric formulas, Outcome conclusions, or automatic
configuration-quality decisions.

The Home page owns the initial `session-discovery/v2`, `home-statistics/v1`, and
import-status requests and passes data into the Dashboard. The statistics
response contains overview totals, recent-tool frequency, and at most ten
privacy-safe cost/token highlights per list; the browser does not fetch the full
`/api/stats` report or tools once per recent Session. Existing data remains
interactive during a job. The browser polls only while `active=true`, stops in
terminal states or on unmount, and refreshes discovery/statistics once after
completion.

`session-discovery/v2` adds source-observed activity evidence without treating
`end_time` as a completion signal. A revision updated within 30 seconds is
`updating`; one updated within five minutes is `recent`; older observed revisions
are `settled`; unavailable or unobserved sources are `unknown`. These states are
provisional recency classifications after a source history changed and was
imported, not a Runtime event stream or process-liveness guarantee. In the default
chronological view, updating/recent Sessions are grouped first and labelled in the
row. Other sorts preserve their Server order. The Web advances the classification
locally as time passes between source changes.

Session discovery uses one flat recent list grouped by today/yesterday/recent
time boundaries. Project is row metadata and an exact counted selector rather
than a required accordion hierarchy. The versioned `/api/session-discovery`
contract applies exact project/Agent, all/1/7/30/90-day range, project/Agent/ID
text, anomaly/unpriced quick-view, and time/cost/token/cache/duration sort
semantics in SQLite. It returns matched/total counts, complete primary-Session
Agent/project facets, an optional selected-Session preview, and an opaque keyset
cursor bound to the normalized query. The default page is 120 rows and the
maximum is 200. These filters and the selected Session use bounded URL
parameters; opening a Session pushes one history entry and browser back restores
the filters and saved list scroll.
Agent and Project facets (T139) are intersection counts, not global popularity:
the Agent facet is computed with every active filter except the Agent dimension,
and the Project facet with every active filter except the Project dimension,
so picking `agent-profile` and Codex shows the actual intersection everywhere.
Both facets keep time, text, quick-view, source-availability, and primary-Session
predicates; a selected dimension never hides a zero-result state.
One shared Core classifier supplies the project key used by both Web navigation
and Server statistics. A non-empty captured `cwd` is authoritative; the
constrained Claude `~/.claude/projects/<encoded>/` layout remains an explicit
compatibility fallback. Other Sessions without captured project evidence use a
stable source-record category, displayed for Codex as `Codex 会话记录`. Codex's
`~/.codex/sessions/YYYY/MM/DD/` layout is only a source-time partition and is
never inferred as a project. Likewise, Codex Desktop's generated non-project
workspace `~/Documents/Codex/YYYY-MM-DD/<session>` is classified as Session
records even though it supplies a non-empty `cwd`; that runtime-isolation folder
is not project evidence. This classification does not alter stored `cwd` or
`filePath` and needs no migration or re-import.
The discovery contract omits source Session names, `cwd`, file/transcript paths,
tags/notes, and prompt/reasoning/answer/tool content. The Home list derives a
display-only Agent/project/local-start-time label from non-content metadata; it
does not store a replacement title or inspect content. Detailed Session routes
and the compatibility `/api/sessions` array retain their existing contracts.
Only 120 matching rows load initially, with explicit cursor-backed incremental
batches for larger result sets.

### Current scale boundaries

Home no longer transfers the full Session-summary array. Its discovery page is
bounded by a query-bound keyset cursor, and filtering, sorting, counts, and
facets execute in SQLite. `home-statistics/v1` is a separate bounded Dashboard
contract, while `/api/stats` retains its public result shape and computes
overview, Agent/project baselines, anomaly IDs, distributions, and trends with
set-based queries instead of loading all Session rows into JavaScript. The
legacy `/api/sessions` full-array route remains available for compatibility and
is still measured as a regression baseline.

The Task workspace follows the same bounded-data contract. Its Session
pickers (new-Task prefill and Session attachment) query `session-discovery/v2`
with a 50-row window, project/Agent/ID text search, and a keyset cursor instead
of loading the compatibility full Session array. Linked Sessions are read from
the Task detail route, and picker results exclude already-linked IDs. The
Task workspace therefore never requests `GET /api/sessions`; the full-array
route remains a compatibility/regression surface only.

The Stats workspace exposes `project-profile/v1` for one selected `project_key`
and optional millisecond time range. The Server keeps at most 1,000 newest
matching primary Sessions and 10,000 normalized tool events; the report marks
sampled scopes and lists the resulting limitations. File-level evidence is
explicitly `not_captured` because the normalized Session contract does not
prove complete repository file coverage.

The Session page now starts from `session-analysis/v1`, which retains complete
diagnosis, score, and aggregate semantics without returning the complete Span
array. Context is sampled to at most 240 points while retaining the first, last,
and peak observations; the main-chain tool timeline contains the most recent 50
events, and the Sidechain turn window contains at most 20 events. Project-relative
scoring still evaluates every comparable Session, but it loads and releases one
Session's Spans at a time instead of retaining the complete project cohort in a
single map. Related Git lookup uses asynchronous `git log`, so it no longer blocks
the Node event loop.

The evidence view uses `session-evidence-page/v1`, a query-bound `(start_time,
id)` keyset cursor with a default of 80 and maximum of 200 events. Filtering and
full-Session coverage/count aggregation execute in SQLite. No-content pages do
not load metadata text into Node; preview pages read only the selected window's
relevant fields. The compatibility `/api/session/:id/analysis`,
`/api/session/:id/evidence`, export, report, and other focused routes retain
their complete-Span behavior and remain explicit full-detail/export surfaces.
The Session detail diagnosis view links findings with stored Span IDs to an
exact `spanIds` focus query on the bounded evidence route. The target IDs are
part of the query-bound page state, are capped and validated server-side, and
do not change the default `content=none` behavior. A missing or filter-excluded
target is reported as unavailable; no nearby Span is substituted.

The source import coordinator discovers all source items but skips an unchanged
item before loading/parsing it. When a source revision changes, Claude Code and
Codex JSONL adapters may use a process-local checkpoint when the previous file
prefix is unchanged, the file ends at a complete line, timestamps remain
monotonic, and the suffix is an independent turn. The suffix is parsed and
atomically appended to the existing Session; the previous final turn's end time
and Session aggregates are refreshed in the same transaction. Checkpoints retain
only structural state and digests, never raw transcript content. Rewrites,
truncations, malformed suffixes, cross-boundary tool results, incomplete Codex
turns, cache misses, forced rebuilds, and append conflicts use the existing full
parse and atomic replacement path. This preserves revision, annotation, privacy,
and metric semantics while reducing repeated JSONL parsing for safe append cases.

The reproducible T82–T84 benchmark in `docs/performance.md` fixes a content-free
desktop workload at 500 Sessions, 75,000 Spans, one 3,000-Span detail Session,
and a 24,600-Span project cohort. It measures the current full-list, stats,
bounded discovery/Home statistics, compatibility analysis/evidence, bounded
analysis summary/evidence page,
unchanged-revision, query-plan, response-size, and process high-water paths
through the normal implementation. Its budgets are generous regression guards
rather than product SLOs. T85 owns source-safe incremental-import work; it must
not change metric, privacy, coverage, or atomic-replacement semantics merely to
improve throughput.

## Current data sources

| Agent | Local source | Import model |
| --- | --- | --- |
| Claude Code | project transcript JSONL | file mtime/size fingerprint; message/tool blocks and parent chains |
| Codex | dated rollout JSONL | parser-contract revision plus file mtime/size fingerprint; rollout `session_meta.id` thread identity (legacy `session_id` fallback), captured `session_meta.cwd` project evidence when present, per-turn `turn_context.payload.model`, response items, events, and call IDs |
| Zed | threads SQLite database with zstd-compressed JSON payloads | parser-contract version plus `updated_at` and payload metadata fingerprint; changed payloads are decoded lazily, tagged User/Agent messages become LLM-turn/answer/tool-call Spans, `request_token_usage` supplies observed input/output tokens, and `folder_paths` supplies cwd |
| MiMo | `mimocode.db` SQLite database | `mimo-v2` parser-contract revision plus `time_updated`, message/part counts, and a hashed `external_import` metadata fingerprint; exact `cc` imports whose absolute `source_path` is below `~/.claude/projects` are excluded before message/part loading, while native and ambiguous rows remain source-visible |
| OpenCode | `opencode.db` SQLite database | parser-contract version plus `time_updated` and message/part counts; changed Session rows and their message/part evidence are loaded lazily from a read-only connection |

All adapters emit the same session/span shape so downstream metrics and UI do
not need agent-specific logic for basic analysis. Coverage can still vary by
source: a missing field means “not captured”, not zero or failure.

The current Zed payload contains one JSON object rather than Claude-compatible
NDJSON. Tool calls are paired with Agent `tool_results` by tool-use ID. Zed does
not currently expose cache-token classes, per-message timestamps, sidechain
links, or a portable cost field in this payload, so the importer leaves that
evidence uncaptured instead of estimating it. Malformed or unsupported payloads
are reported as `not_importable`; thread summaries are not converted into
synthetic answer or token evidence.

The Zed fingerprint includes a parser-contract revision in addition to source
metadata. When Zed normalization changes, advancing that revision makes the
ordinary coordinator atomically replace existing derived rows once; it does not
require deleting the local analysis database or re-importing unrelated sources.

The current OpenCode schema stores input, output, reasoning, cache-read, and
cache-write totals on the Session row. The parser maps cache write to cache
creation and keeps cache read separate. Because those totals are not attached
to individual messages, it creates one `llm_turn` with
`tokenUsageSource=session_aggregate`; answer, reasoning, and tool parts remain
child evidence with their captured part timing and source message/parent IDs,
but no per-message token allocation is invented. Reasoning tokens are included
in normalized output usage. Portable cost is recomputed by the analyzer from
the captured model and four normalized token classes rather than trusting the
source Session's aggregate cost field.

Codex Desktop can materialize Claude or other external-Agent history as rollout
JSONL with `external-import-turn-*` IDs, no ordinary `turn_context`, a shared
migration timestamp, and tool activity embedded only as
`external_agent_tool_*` text. Those records do not provide trustworthy original
project, model, token-class, or structural tool evidence, so the adapter reports
them as `excluded_non_actionable` rather than creating profiler Sessions. A
Codex parser fingerprint revision makes existing files pass through this rule
once. The coordinator removes a previously generated excluded Session and its
Spans only when it has no tags or notes; annotated rows are retained and the
cleanup is reported as failed. Import results expose the number removed. Normal
Codex rollouts with runtime turn context remain unaffected.

Codex Desktop also persists guardian/child rollouts as distinct source records.
Their normalized Spans retain `is_sidechain = 1` and direct detail/evidence
lookup by stored ID remains available. Primary Session surfaces—Session
discovery, dashboard/statistics aggregates, project cohorts, Agent Process
Profiles, and per-source stored-Session counts—exclude a Codex record only when
it has no main-chain Span. This keeps one top-level Session count per visible
Codex Task without deleting child evidence or inferring relationships from
titles, paths, models, or timing. T87 persists only Codex's captured
`parent_thread_id` as an atomic source-native child-to-parent link. The Session
detail surface labels whether that parent is imported, unavailable, or not
captured; it does not infer links for other sources. Combined resource
attribution remains future work, so primary aggregates still omit resource
usage stored only in a child rollout.

Each modern Codex LLM turn takes its model from that turn's captured
`turn_context.payload.model`. `session_meta.model_provider` is provider evidence,
not a concrete model, and is never promoted into `Span.model`. Advancing the
Codex parser revision to `codex-v4` makes an ordinary sync atomically replace
stale provider-labelled rows once; no generated-data reset is required.

## Persistence model

`apps/server/src/database.ts` owns nineteen current internal tables:

- `sessions` — source identity and revision metadata (`source_kind`,
  `source_updated_at`, `source_fingerprint`); agent/model fields plus the
  migration-backed analytical `project_key`; four
  token totals; context, cache, cost, duration, annotation tags, and notes.
- `spans` — normalized `llm_turn`, `thinking`, `answer`, and `tool_call`
  evidence, token/context/cost fields, selected pricing model/revision, timing,
  parent/sidechain links, tool input/output metadata, and truncation-safe content.
- `session_relationships` — source-native child-to-parent Session IDs, source
  kind, and update time. It deliberately permits an unavailable parent ID so
  imported child evidence is not discarded.
- `pricing` — current per-model CNY schedules for the four token classes, with
  effective time, scheme, status, revision, and source provenance. Startup
  seeding preserves an existing epoch-zero applicability row; any bundled
  `NULL` residue from an interrupted older seed is retained as superseded and
  omitted from current pricing/configuration responses.
- `pricing_history` — immutable pricing revisions, including superseded rows.
- `pricing_aliases` — explicit audited raw-model-to-pricing-model equivalence;
  presentation aliases never populate this table.
- `model_context` — per-model context-window limits. Built-in rows are
  conservative vendor-specification seeds, audited against vendor catalog entry
  points on 2026-07-27 (T58); they are not transcript-observed values and user
  edits take precedence because startup uses `INSERT OR IGNORE`.
- `cost_recalculation_runs` — scope, fixed pricing revision, before/after
  unknown coverage, calculator version, and completed execution audit.
- `schema_migrations` — ordered, idempotent schema changes and their application
  time.
- `tasks` — local delivery identity, project/type/status/complexity, and an
  explicit content mode. Goal/acceptance prose is allowed only in `local_text`.
- `config_snapshots` — Agent/model identifiers, version labels, and source hash;
  no rule or prompt body is copied by this model.
- `task_sessions` — multi-Session Task links, role, timing, optional
  Configuration Snapshot, and optional accepted-assistance provenance. Session
  IDs remain logical references across reset.
- `runtime_events` — bounded local Runtime lifecycle metadata keyed by run/event
  identity and sequence. It stores no prompt, answer, thinking, tool input, or
  tool output content; duplicate event IDs are idempotent and sequence conflicts
  are isolated as rejected input.
- `runtime_event_coverage` — per-Run submitted, observed, and rejected event
  counts used to preserve partial-coverage suppression across requests.
- `runtime_hints` — bounded opt-in hint payloads with expiry and event/history
  references. The stored payload is fixed-policy metadata and contains no raw
  process content.
- `runtime_hint_adoptions` — explicit `adopted`, `ignored`, or `not_recorded`
  decisions with producer/time and the stored hint evidence reference. Adoption
  is never inferred from later Runtime behavior.
- `task_outcomes` — nullable build/test/lint/Git/rating/rework/completion-time/
  bounded-evidence fields; null means not collected and explicit `failed` means
  failed. The Tasks workspace validates optional evidence before its existing
  repository boundary accepts it.
- `cohorts` — local comparison definitions and lifecycle state.
- `experiments` — control/candidate configurations, cohort, primary metric,
  guardrails, evidence state, and bounded decision state.

Migration v6 (`bounded_session_discovery`) backfills `sessions.project_key`
through the shared project classifier and adds time, Agent+time, and
project+time discovery indexes. New and replaced Sessions write the same key in
the existing atomic repository path; the migration does not rewrite source
`cwd` or file-path evidence.

Migration v7 (`bounded_session_evidence`) adds
`idx_spans_session_time_id` on `spans(session_id, start_time, id)`. Existing
rows need no data backfill: the index provides stable keyset order for bounded
evidence pages while the stored Session/Span model remains unchanged.

Prompt-review requests and results are not part of this persistence model. The
server processes prompt text within one request and neither inserts it into
SQLite nor retains a review record.

The database applies ordered additive migrations. Existing annotation columns
and cost/source-provenance columns are detected safely and each migration
version is recorded once. Source migration version 3 leaves legacy
fingerprints empty so the next scan refreshes rather than incorrectly treating
old data as current. Session replacement uses an upsert that preserves
user-authored tags and notes, followed by span replacement in the same
transaction. Schema changes must include an explicit migration/backfill plan
and integration test in their Task; deleting `trace.db` is not the normal
upgrade strategy. The SQLite file is generated local state and can be rebuilt
from available source histories when recovery is necessary.

## Metric semantics

- `contextTokens = input + cacheCreation + cacheRead`
- `windowUtilization = contextTokens / configuredContextWindow`
- `cacheHitRate = cacheRead / (input + cacheCreation + cacheRead)`
- Some Codex token-count events expose a non-zero `total_tokens` while every
  classified token field is zero. Those turns retain the total in
  `inputTokens` so the observed usage is not discarded, but their Span metadata
  sets `tokenUsageSource=total_tokens_fallback` and
  `tokenUsageClassified=false`. The input/cache/output split and resulting
  input-priced cost for such a turn are fallback approximations, not
  source-classified usage.
- Every LLM Span records a source-faithful token-usage origin in Span
  metadata: `message_usage` (Claude/MiMo per-message usage),
  `token_count` (Codex classified token-count event), `session_aggregate`
  (OpenCode session totals), `request_token_usage` (Zed), or
  `not_captured` when the source did not capture usage. `not_captured` is
  never rendered or aggregated as a measured zero. A Codex rollout whose
  turn contains only a `turn_context` with a model identity is retained as a
  stub LLM Span (`stubTurn=true`, zero tokens, `tokenUsageSource=not_captured`)
  so the started-but-untracked turn remains explainable instead of vanishing.
  The evidence report exposes per-event token-usage coverage
  (`captured`/`not_captured`/`not_applicable`, source, classified flag,
  stub flag) and a Session-level `tokenUsage` coverage row alongside model
  identity and content coverage.
- OpenCode currently exposes token classes only at Session granularity. Its one
  aggregate LLM Span is labelled `tokenUsageSource=session_aggregate`; this
  preserves observed totals without implying per-message token or context
  behavior that the source did not capture.
- Span cost uses all four token classes and the model price effective at the
  span's `startTime`. The current contract is `CNY` per million tokens.
  `costCurrency`, `pricingEffectiveFrom`, `pricingModel`, `pricingRevision`,
  `costCalculatedAt`, and `costCalculatorVersion` expose the selected schedule
  and calculation provenance. Unknown or unsupported pricing is surfaced as
  unknown rather than silently estimated as a known bill.
- Cost is represented as known only when span-time token coverage and a
  verified schedule both apply (T136). Every LLM Span persists a `costStatus`
  with distinct states: `known`, `unknown_pricing` (no active schedule),
  `unverified_provider_route` (review-required labels such as `big-pickle`
  without an audited tariff), `token_usage_not_captured` (source captured no
  usage; never a measured zero), `unsupported_scheme`, `excluded_synthetic`
  (synthetic placeholders are never free), and `not_applicable` for non-LLM
  Spans. Session aggregates derive `complete` / `partial` / `unknown` /
  `excluded` / `not_captured` from their LLM turns. The active zero-price
  `<synthetic>` bundled seed is retired by migration 16; configuration import
  never treats missing data as free usage.
- The four token classes remain separate in every calculation and response;
  a partial subtotal is always accompanied by its incomplete-coverage status
  and is never presented as a trusted total.
- Statistics may derive a presentation-only canonical model group for explicit
  aliases while retaining raw source labels. Captured Codex model IDs
  `gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna` are concrete identities;
  `codex-auto-review` is a retained runtime-mode label, not a model. Runtime
  modes are excluded from model statistics and the Model Catalog and cannot be
  assigned pricing or context configuration. `openai` and `litellm` remain
  provider-only. Unknown model values remain distinct; this grouping never
  rewrites stored evidence or changes raw-model pricing lookup.
- The Model Catalog inventory classifies observed raw labels by billing
  eligibility (T135): `billable` for concrete model identities,
  `review_required` for opaque rolling labels (`astron-code-latest`),
  provider-managed routes (`big-pickle`), and unverified custom labels, and
  `excluded` for synthetic placeholders (`<synthetic>`) and runtime modes.
  Pricing and context configuration is rejected for excluded and
  review-required labels unless an explicit audited pricing alias points at a
  configurable model; automatic name-similarity aliases are prohibited.
  Configuration import skips excluded labels instead of failing on legacy
  synthetic rows.
- Cost attribution distributes an LLM turn's cost across tool categories used
  by that turn and shows tool-free turns separately. It is an analytical
  allocation, not a provider invoice.
- Read-to-edit conversion is bounded to 0–100%; tool success is weighted by
  calls; project ranking uses the same composite process-efficiency score shown
  in the detail view.
- Tool categorization groups observed calls for analysis; it does not define
  the runtime's structural call graph.

### Configuration ownership and time semantics

The current configuration surfaces have deliberately different owners and
scopes:

| Surface | Owner and storage | Effective scope | Unknown/provenance behavior |
| --- | --- | --- | --- |
| `model_context` | Model Catalog seed/service and compatibility `/api/model-context` route; one exact raw model row in SQLite | Context-window utilization and context-bloat diagnosis for Sessions using that raw model | No alias or provider fallback; an unlisted model resolves to `undefined`/`null`. Bundled source entry points live in `apps/server/src/model-catalog/defaults.ts`; these are reference values, not transcript evidence. |
| `pricing` | Model Catalog schedules, history, explicit pricing-equivalent aliases, and compatibility `/api/pricing` route | Stored Span/Session cost calculation and explicit scoped historical recomputation | Exact active raw-model schedule wins; only an explicit `pricingEquivalent=true` alias may select another pricing key. Selection uses the LLM Span `startTime`; missing and unsupported schemes remain unknown. |
| Diagnosis thresholds | `DEFAULT_THRESHOLDS` in `packages/core/src/diagnosis.ts` | Deterministic heuristic finding boundaries for one analysis request | They are code-owned policy, not a user-editable Runtime or Task setting. The diagnostic `wastedCost` is an estimate only: it uses the current analysis-time input price as an upper bound and does not rewrite stored cost. |
| Configuration Snapshot | Task repository `config_snapshots` row | Explicit Task-linked Agent/model/version evidence | It records the supplied identifiers and source hash; it does not silently snapshot pricing, context limits, prompts, or rules. |

This distinction keeps planning-time diagnosis estimates separate from the
historical, span-time cost provenance used for stored billing-like metrics. A
configuration edit therefore changes future analysis and any explicitly
requested recomputation, but does not retroactively change source-observed
model identity or imply a configuration effect on delivery quality.

Efficiency, diagnosis, and scoring describe execution behavior. A recorded Task
and Outcome add delivery evidence for that Task, but neither one Task nor an
unscoped Agent Process Profile establishes a general configuration effect. This
is the boundary between implemented Session/Task evidence, the bounded
descriptive `cohort-runtime-profile/v1`, and future broader or causal
configuration-evaluation work.

## Analysis surfaces

The current server/UI support:

- session listing, search, sorting, project/agent filtering, annotations;
- turn, tool, context, performance, tool-parameter, and sub-agent inspection;
- heuristic findings plus optional Anthropic-native or OpenAI-compatible
  semantic diagnosis;
- aggregate session analysis, efficiency, process score, cost attribution, and
  project-relative comparison;
- statistics by agent/project/model, distributions, trends, and multi-session
  comparison;
- versioned Agent Process Profiles with resource, context, reliability, and
  collaboration dimensions, metric coverage, and neutral peer-relative
  characteristics;
- deterministic prompt-structure review with optional Agent-profile evidence
  and guarded iteration hypotheses;
- versioned normalized Session evidence timelines with relationship, lane,
  outcome, content-availability, and coverage semantics;
- a progressive Session-detail workspace with an always-visible identity,
  token fingerprint, and primary KPIs followed by separate overview,
  context/cost, tools/chain, and normalized-evidence views. Home retains the
  selected identity and a reserved detail layout until the active same-origin
  embedded detail reports bounded-analysis readiness or failure; stale or
  foreign messages cannot replace the active selection. Embedded parent/child
  relationship links send a same-origin navigation message containing the
  current and target Session IDs; Home accepts it only from the active iframe
  and current Session, then updates the outer selection/history. Standalone
  fallback links target the top browsing context so an accidental iframe load
  cannot create another nested Home page;
- Git commit evidence, JSON/CSV export, and generated session reports;
- versioned Model Catalog inventory/configuration APIs, editable pricing/context
  data, explicit pricing-equivalent aliases, and previewed cost recomputation;
- a `/settings/models` Web workspace that consumes only those public APIs,
  prioritizes observed unknown/unsupported identities, preserves price history,
  and gates scoped recalculation behind a fixed-revision preview and explicit
  confirmation.

Mutable pricing and model-context requests have runtime JSON-schema validation.
New user pricing defaults to its write time; callers may supply an explicit
`effectiveFrom`. `model-catalog/v1` adds observed-model inventory, price history,
provenance, versioned content-free configuration import/export, and a two-step
recalculation contract. Preview is read-only; execute rejects a stale pricing
revision, recalculates the normalized model/time scope transactionally, rebuilds
affected Session totals, and records the run. Recompute selects pricing
independently for each historical LLM Span and records calculator version `v1`.
After a successful execute, the runtime publishes a content-free
session-update signal (T137) listing the affected Session IDs so open
discovery, statistics, Profile, and detail surfaces refetch instead of showing
stale aggregates. Preview publishes no signal and mutates nothing; a failed run
leaves all aggregates unchanged.
Pre-T39 stored costs retain `legacy` provenance until they are imported again or
recomputed.

LLM diagnosis is optional. Without its API configuration, or without an explicit
request-scoped opt-in, deterministic analysis remains available and no Provider
call is made.

`GET /api/session/:id/diagnosis?semantic=opt_in` invokes the configured
Anthropic-native or OpenAI-compatible provider when the Session has captured
thinking or tool-call evidence. The Provider is configured server-only through
`GET /api/provider/status` (non-secret status) and
`PUT /api/provider/configuration`; the API key is stored in a `0600`
`provider.json` file in the application data directory and never reaches
browser state, localStorage, SQLite, logs, exports, or source files. The status
API discloses provider, model, endpoint host, loopback/external locality,
configuration source, test status, and restart requirements without revealing
the key; environment variables remain a legacy fallback when no file exists.
The request payload is bounded to one Session title, at most five thinking
excerpts (500 characters each), and at most twenty tool calls
(200-character tool names/inputs), then passes through the shared common-secret
redaction utility before construction of the Provider body. The response
exposes only semantic status, Provider name, payload counts, redaction count,
and limitations; it does not return the payload. Each explicit request records
a bounded process-local audit entry containing only Session ID, timestamps,
status, Provider, and payload counts. Raw source content and Provider response
content are not stored. Redaction is not a guarantee against every secret, so
sensitive workspaces still need an approved endpoint. When no LLM turn in the
Session has captured token/model telemetry (`tokenUsageSource=not_captured` or
stub turns), semantic conclusions are suppressed and the diagnosis reports
`insufficient_evidence` (T138) instead of calling the Provider.

### Session evidence report contract

`session-evidence/v1` remains the compatibility full-evidence report derived on
demand from one stored Session and all of its normalized Spans.
`session-evidence-page/v1` is the default Web contract: it uses stable
`(startTime, id)` order, a query-bound cursor, a default limit of 80, and a
maximum limit of 200. Server-side type, main/Sidechain lane, and outcome filters
return explicit loaded, matched, and total counts. Every matching event remains
reachable by following `nextCursor`; global sequence and root/linked/missing-parent
status are still computed against the complete stored Session even when a parent
is outside the current page. Each event exposes:

- root/linked/missing-parent relationship and main/sidechain lane;
- start time, captured end time/duration, model identity, token/context,
  output-size, and known cost fields;
- `observed_error`, `no_error_observed`, or `not_applicable` outcome wording;
- expected content-field names and whether each was captured.

`no_error_observed` is intentionally not called “success”: several source
formats cannot prove result correctness from a false/missing error flag.
Report-level coverage distinguishes complete, partial, not-captured, and
not-applicable evidence for timing, parent links, tool input/output, model
identity, and content-bearing events. Paged responses report this coverage for
the complete Session, not only the current window.

Both evidence endpoints default to `content=none`; therefore responses contain
no stored tool input/output, thinking, or answer text. The paged no-content query
derives availability and source-truncation flags in SQLite without selecting the
metadata text into Node. `content=preview` is an explicit local disclosure that
loads only the current page's relevant fields and returns at most 500 characters
per available field after common secret redaction. It also reports whether the
parser had already truncated the stored source. There is no full-raw-content mode
in either evidence API.

`session-analysis/v1` powers the first Session-detail render. It omits the
complete Span array and all metadata/content while retaining the existing
analysis, diagnosis, efficiency, attribution, performance, and score results.
Its context series contains at most 240 representative points, the main-chain
tool window contains the latest 50 events, and the Sidechain turn window contains
the first 20 events; each window includes its complete total and whether it was
sampled/windowed. The compatibility `/api/session/:id/analysis` response remains
available and continues to strip Span metadata.

The report is complete only for the normalized Span set. Parsers do not
currently create first-class user-message Spans for every source, so neither
the API nor the Session UI calls the result a complete original conversation.
The Session detail page keeps this evidence layer in a dedicated view. That view
is mounted on demand, performs filtering and paging on the Server, appends pages
through `nextCursor`, and resets the window when filters or content mode change.
It does not request evidence while the user remains in the overview, context/cost,
or tools/chain views.

### Agent Process Profile report contract

`agent-profile/v1` is the implemented Agent Process Profile: a stable derived
report over current primary normalized Sessions and their Spans. Source-native
Codex child-only rollout records remain stored but are not peer Session samples.
The report does not add a persistence table or aggregate Task Outcomes. Each Agent profile
contains:

- sample counts for sessions, LLM turns, and tool calls;
- per-session distributions (observed count, total count, coverage, mean,
  median, nearest-rank P90, minimum, and maximum) for token use, CNY cost,
  duration, cache hit, and context;
- tool-error, sidechain, and affected-session ratios with explicit numerators
  and denominators;
- known-cost, duration, model-identity, and tool-evidence coverage;
- peer-relative characteristics only when the Agent and at least one peer each
  have three sessions and the metric has at least 50% coverage.

Relative characteristics compare an Agent metric with the median of eligible
peer-Agent metrics. A delta within ±10% is `similar`; otherwise it is `higher`
or `lower`. These labels are descriptive and have no preferred direction.
Task type/complexity are not controlled and Outcome coverage is explicitly
`not_collected`, so this report cannot establish correctness or overall Agent
quality. Source adapters also do not yet distinguish an unavailable tool-error
status from an observed non-error in every format, so tool-error rates count
explicit observed errors only. The `/profiles` page presents the same contract
as a human-readable process fingerprint rather than a leaderboard. Task and
configuration scope are deliberately absent from this report today; use
`task-profile/v1` for one delivery unit and the bounded
`cohort-runtime-profile/v1` for an eligible Experiment. Neither makes an Agent
Process Profile a configuration-quality ranking or causal comparison.

### Project Profile report contract

`project-profile/v1` is the implemented read-only report for one canonical
`project_key` across current primary normalized Sessions. `GET
/api/projects/:project/profile?range=all|7d|30d|90d` selects the project and
optional start-time window; the Web Project page uses the same contract. The
report exposes the observed Session count and actual observed time range,
per-source Session counts, independent duration/cost/tool/file coverage,
resource totals, explicitly observed tool errors, top observed tool names, and
UTC-day points only for dates that contain an observed Session.

Cost totals include only Sessions with complete pricing; unknown pricing lowers
the displayed cost coverage rather than becoming a trusted zero or estimate.
Tool trend points count normalized observed tool calls and explicit errors; the
share of Sessions with tool evidence is separate. File-level cross-Session
evidence is currently `not_captured`, so the report emits no file trend. The
Project Profile does not claim a complete repository history, an unused or
unavailable tool, Task Outcome, code quality, or configuration causality.
While open, the Project page waits on the same content-free Session update
cursor as Home. A newer cursor version re-queries its project facets and report,
retaining the last report until the replacement arrives; it is not a WebSocket
or a claim of live Agent-process state.

### Task Profile report contract

`task-profile/v1` is the implemented per-Task delivery profile. It aggregates
only currently available linked Sessions and exposes linked/available coverage,
Agent identities, token totals, known-cost coverage, duration, peak context,
cache behavior, tool-error evidence, attached Configuration Snapshots, explicit
Outcome fields, matching cohort definitions, a typed Task graph, and
limitations.

The Task graph makes the Task the explicit multi-Agent delivery boundary. Its
nodes are the linked Sessions with their link role, Agent, and availability;
its edges come only from stored source-native `session_relationships` rows
(relation kind `source_parent`) that touch a linked Session. Each edge names
its source, whether the counterpart Session row is stored, and whether the
counterpart is also linked to the same Task. Per-Agent attribution counts
linked/available Sessions and sums tokens, cost, unknown-cost count, tool
calls, and tool errors once per stored Session. Relationship coverage reports
`captured` edges, `partial` edges whose counterpart is unavailable or unlinked,
and `absent` linked Sessions with no stored relationship. Aggregate totals
reconcile exactly to the linked stored Sessions; a child Session linked to the
Task is never summed a second time through a parent edge. Missing or
unavailable relationships remain coverage limitations and are never replaced
by an edge inferred from titles, paths, timestamps, or model similarity.

Its Outcome coverage is `not_collected`, `partial`, or `verified`; the tracked
five fields are build, test, lint, Git commit, and human rating. Rework reason,
completion time, and structured evidence remain visible supplemental evidence
but do not change that denominator. The Task workspace edits every Outcome
field and reports the same observed/total count as `task-profile/v1`. Structured
evidence is limited to 50 entries with required kind and optional verification
status/reference/provenance; malformed arrays, entries, or provenance are rejected with a model error
instead of being stored or converted into success/failure. A missing field
never becomes a failure. `task-profile/v1` remains a single-Task report;
cross-Task distributions are exposed separately by the bounded
`cohort-runtime-profile/v1` Experiment report, which does not infer universal
configuration winners or causal effects.

### Outcome-evidence adapter contract

`outcome-evidence/v1` is a read-only producer boundary. Each report exposes the
producer, capture time, source, bounded records, capture limits, and limitations;
record statuses distinguish `not_captured`, `observed`, `passed`, `failed`,
`skipped`, and `not_run`. `not_captured` is unavailable source coverage, while
`observed` is metadata without a verification claim. The approved local Git
producer is `agent-profile/local-git-outcome-adapter`, exposed through
`GET /api/tasks/:id/outcome-evidence?source=local_git`. It runs only fixed Git
metadata queries against a linked Session cwd or absolute Task project, returns
metadata-only local references, and never executes arbitrary commands,
build/test/lint checks, uploads content, or writes Outcome fields. The outcome
adapter does not upload evidence to any remote CI or review connector; the
repository's own content-free CI (see the operations section) runs lint, tests,
builds, roadmap/boundary checks, and the scale benchmark without processing
local transcript content.

### Post-run feedback contract

`GET /api/tasks/:id/feedback?optIn=true` returns zero or more
`post-run-feedback/v1` records for Experiments whose current comparable sample
contains the Task. It is a deliberate read-only consumer action: requests that
omit `optIn=true` are rejected, and the Task workspace makes that explicit when
loading feedback.

A finding is emitted only when the Task is completed and Outcome-verified, used
the candidate Configuration, the Experiment is completed with an explicit
`keep` or `rollback` decision, and the current cohort report still has `ready`
evidence. Otherwise the report is suppressed with a fixed reason, including
incomplete Outcome, control baseline, insufficient evidence, or stale persisted
decision. Each finding contains only Experiment/Cohort IDs, report version/time,
primary metric/guardrail summaries, and limitations. It never returns Task goal,
acceptance prose, prompt, rules, transcript, tool output, or chain-of-thought;
it never updates Experiment decisions or runtime configuration.

### Prompt review and iteration-hint contract

`POST /api/prompt-review` accepts a non-empty prompt up to 20,000 characters,
an optional observed Agent identifier, and an opt-in evidence flag. The server
does not persist or log the prompt body and does not call the optional semantic
diagnosis provider.

`prompt-review/v1` deterministically checks six structural dimensions: goal,
scope, acceptance, constraints, context, and verification. Each check returns
`present`, `partial`, or `missing`, a conservative confidence, an explanation,
and a clause the caller may consider. It is a keyword/heading heuristic, not a
semantic correctness judgment. Raw evidence is omitted by default. When
explicitly requested, each check returns at most two redacted excerpts, each
bounded to 140 characters.

`iteration-hints/v1` turns structural gaps into prioritized hypotheses. If the
caller selects an Agent with a current `agent-profile/v1` report, hints may
combine the structural gap with peer-relative runtime metrics. Every hint names
its source (`prompt_structure`, `runtime_profile`, or `combined`), states a
causal guardrail, and requires validation against a comparable Task Outcome.
No total prompt score is produced, and the server never claims that changing a
clause caused or will cause a runtime metric to improve. The `/prompt-review`
page exposes the same contract and privacy boundaries.

## API surface

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Service health |
| `GET` | `/api/imports/status` | Privacy-bounded source availability, stored counts, and current/last import state |
| `POST` | `/api/imports` | Start or join a deduplicated multi-source background import |
| `POST` | `/api/imports/rebuild` | Force available sources through analysis and atomic replacement despite matching fingerprints |
| `POST` | `/api/scan` | Scan/import a selected transcript directory |
| `GET` | `/api/data-management/summary` | Return reset impact counts and the required confirmation phrase |
| `POST` | `/api/data-management/reset` | Confirm and transactionally delete generated Sessions/Spans while retaining pricing, model configuration, migrations, Task/Outcome/experiment, Runtime event/coverage, and Runtime hint records |
| `GET` | `/api/sessions` | Compatibility full-array Session list |
| `GET` | `/api/session-discovery` | Versioned bounded Session page with server-side filters, sort, counts, facets, selected preview, and keyset cursor |
| `GET` | `/api/session-updates` | Content-free long-poll cursor for bounded changed-Session IDs; waits at most 30 seconds |
| `PATCH` | `/api/session/:id` | Update session tags/notes |
| `GET` | `/api/session/:id` | Session with spans |
| `GET` | `/api/session/:id/analysis` | Aggregated detail analysis |
| `GET` | `/api/session/:id/analysis-summary` | Bounded `session-analysis/v1` detail response with complete aggregates and sampled/windowed displays |
| `GET` | `/api/session/:id/turns` | LLM turns |
| `GET` | `/api/session/:id/tools` | Tool calls |
| `GET` | `/api/session/:id/context` | Context-growth data |
| `GET` | `/api/session/:id/diagnosis` | Heuristic and optional semantic findings |
| `GET` | `/api/session/:id/efficiency` | Process-efficiency metrics |
| `GET` | `/api/session/:id/cost-attribution` | Analytical cost allocation |
| `GET` | `/api/session/:id/score` | Composite process score and rank |
| `GET` | `/api/session/:id/performance` | Duration and performance analysis |
| `GET` | `/api/session/:id/tool-params` | Tool-parameter analysis |
| `GET` | `/api/session/:id/commits` | Related Git commits when available |
| `GET` | `/api/session/:id/export` | Session export |
| `GET` | `/api/session/:id/report` | Session report |
| `GET` | `/api/session/:id/evidence` | Versioned normalized event timeline; optional bounded redacted previews |
| `GET` | `/api/session/:id/evidence-page` | Cursor-paged `session-evidence-page/v1` timeline with server-side filters, full-Session coverage, and optional bounded redacted previews |
| `GET` | `/api/sessions/compare` | Selected-session comparison |
| `GET` | `/api/home-statistics` | Bounded `home-statistics/v1` overview, recent tools, and cost/token highlights |
| `GET` | `/api/stats` | Compatibility aggregate statistics and distributions, computed with set-based Session aggregation |
| `GET` | `/api/projects/profile?project=...&from=...&to=...` | Bounded `project-profile/v1` cross-Session project evidence |
| `GET` | `/api/profiles/agents` | Versioned process profiles for all observed Agents |
| `GET` | `/api/profiles/agents/:agent` | One observed Agent profile with peer-relative context |
| `GET` | `/api/projects/:project/profile` | Read-only coverage-aware `project-profile/v1`; optional `range=all|7d|30d|90d` |
| `POST` | `/api/prompt-review` | Ephemeral deterministic prompt review and guarded iteration hints |
| `GET/POST` | `/api/tasks` | List or create local Tasks |
| `GET/PATCH` | `/api/tasks/:id` | Read Task detail or update metadata/lifecycle |
| `GET/POST` | `/api/tasks/:id/sessions` | List or attach Session/configuration links |
| `GET` | `/api/tasks/:id/assistance` | Bounded `task-assistance/v1` local Session/Git candidates; acceptance remains explicit |
| `GET` | `/api/tasks/:id/outcome-evidence?source=local_git` | Read-only bounded `outcome-evidence/v1` local Git metadata; no automatic Outcome write |
| `PUT` | `/api/tasks/:id/outcome` | Upsert explicit nullable Outcome fields |
| `GET` | `/api/tasks/:id/profile` | Export coverage-aware `task-profile/v1` |
| `GET` | `/api/tasks/:id/feedback?optIn=true` | Explicitly requested bounded `post-run-feedback/v1` records |
| `POST` | `/api/runtime/events` | Append local `runtime-event/v1` metadata batches with idempotency and coverage report |
| `GET` | `/api/runtime/runs/:runId/events` | Read bounded `runtime-event-page/v1` references in sequence order |
| `GET` | `/api/runtime/runs/:runId/hint?optIn=true` | Read an explicit opt-in, fresh, coverage- and history-gated `runtime-hint/v1` report |
| `POST` | `/api/runtime/hints/:hintId/adoption` | Record explicit `runtime-hint-adoption/v1` status and producer; never inferred from later events |
| `GET/POST` | `/api/config-snapshots` | List or create version/hash-only Configuration Snapshots |
| `GET/POST` | `/api/cohorts` | List or create cohort definitions |
| `GET/POST` | `/api/experiments` | List or create guarded experiment records |
| `GET` | `/api/experiments/:id/profile` | Outcome-guarded `cohort-runtime-profile/v1` distributions and bounded guardrail results |
| `PATCH` | `/api/cohorts/:id`, `/api/experiments/:id` | Update comparison lifecycle/evidence state within database guardrails |
| `GET/PUT` | `/api/pricing` | Model pricing |
| `GET/PUT` | `/api/model-context` | Model context-window configuration |
| `POST` | `/api/recompute-cost` | Recalculate stored costs by span-time pricing and refresh provenance |
| `GET` | `/api/model-catalog/models` | Versioned observed raw-model inventory with pricing/context coverage |
| `GET/POST` | `/api/model-catalog/models/:key/pricing` | Read price history or create a manual schedule revision |
| `GET/PUT` | `/api/model-catalog/models/:key/context` | Read or update exact model context specification |
| `PUT` | `/api/model-catalog/models/:key/pricing-alias` | Record explicit audited pricing equivalence |
| `POST` | `/api/model-catalog/recalculation/preview` | Preview model/time impact without mutation |
| `POST` | `/api/model-catalog/recalculation/execute` | Execute the same scope against a fixed pricing revision |
| `GET/POST` | `/api/model-catalog/configuration` | Export or atomically import `model-catalog/v1` local configuration |

## Operation and configuration

- `packages/cli/bin/agent-profile.mjs doctor` checks the selected local database
  and source availability through the application Runtime without starting the
  HTTP adapter or import work. `--json` emits `agent-profile-cli/v1`.
- `sources` and `sync` share the Server import service with the compatibility
  route. Status omits source paths/transcript IDs; sync retains existing
  availability checks, deduplication, revision replacement, and failure isolation.
- CLI `sessions` and the compatibility Session-list route share the Server
  discovery service. CLI uses its bounded, path/content-free cursor page; the
  compatibility route retains its existing unbounded response while the public
  bounded discovery contract is available separately.
- CLI report commands share the current Statistics/Profile/Task Profile builders
  with their HTTP surfaces. The command layer only wraps the existing results in
  `agent-profile-cli/v1` and preserves report-specific coverage and limitations.
- CLI `diagnosis <session-id>` and `evidence <session-id>` expose bounded,
  content-free finding/event references; `task-outcome <task-id> --confirm`
  appends only an explicitly supplied evidence entry through TaskRepository
  validation; `task-feedback <task-id> --opt-in` reads bounded post-run
  feedback. JSON uses `agent-profile-cli/v1`; no command exposes raw prompt,
  answer, thinking, tool input/output, or local path content by default.
- The loopback Runtime collector accepts only `runtime-event/v1` lifecycle
  metadata through `/api/runtime/events`. Migration v12 stores event identity,
  task/run scope, sequence, timing, parent reference, and allowlisted payload
  field values. The collector is idempotent for exact duplicates, accepts
  out-of-order arrivals while preserving sequence reads, isolates event ID and
  sequence conflicts, and keeps imported transcript evidence independent.
- The loopback Runtime hint policy accepts only an explicit `optIn=true` read.
  Migrations v13/v14 store fixed, bounded hint payloads, explicit adoption
  status, and per-Run rejected-event coverage. Each Runtime event batch must
  explicitly attest `coverageComplete: true` before a Run can pass the complete
  coverage gate. A hint also requires fresh complete event coverage, a ready
  descriptive historical comparison, and a repeated tool-failure signal;
  future-dated events, unknown/partial coverage, and finished Runs are
  suppressed. It is rate-limited per run, expires quickly, returns only
  event/experiment references, and cannot mutate prompts, tools, models, or
  configuration.
- `agent-profile serve` composes Next standalone, the shared Runtime, and
  Fastify behind one loopback origin. The release archive keeps mutable data
  outside its installation tree and closes all three layers on signals.
- The supported deployment boundary is local loopback. The source-workspace
  Server and `agent-profile serve` both reject non-loopback hosts; the Server
  `HOST` override accepts loopback aliases only. No supported deployment
  exposes the unauthenticated API on a trusted network.
- Root `pnpm dev` uses parallel workspace execution to start the API and Web
  processes together. The API development command runs in watch mode; the Web
  process uses Next.js development reloads.
- API: port `3000` by default, configurable through `PORT`.
- Web: port `3001` by default; API origin is configurable through
  `NEXT_PUBLIC_API`.
- Next.js development output is isolated in `apps/web/.next-dev`; production
  builds continue to use `apps/web/.next`, so a build does not invalidate
  chunks used by a running development server.
- Semantic diagnosis uses Anthropic-native or OpenAI-compatible endpoints when
  `LLM_API_KEY` and optional `LLM_PROVIDER`, `LLM_MODEL`, and `LLM_BASE_URL`
  are configured.
- Local source histories and the generated SQLite database remain on the
  machine; any future raw-record export or remote runtime integration must keep
  explicit privacy and redaction controls.
- Root `pnpm test` runs Core, Server, CLI, and Web tests. Root `pnpm build`
  includes Core, Contracts, CLI, and Server TypeScript plus the Web production
  build.

## Documentation boundary

- This file is the source of truth for current architecture.
- `README.md` is the concise user-facing current-state entry point.
- `docs/roadmap.md` is the source of truth for task status and completion
  evidence.
- `docs/profile-evolution-plan.md` maps proposal-only dependencies for the
  future evidence, Agent-interface, Runtime, comparison, and operations work.
- `docs/performance.md` defines the reproducible content-free scale fixture,
  benchmark method, desktop regression budgets, and known measurement limits.
- `docs/agent-runtime-profile-design.md` is the future design proposal.
- Focused documents under `docs/` must be updated in the same task when their
  domain changes.

Repository changes follow the lifecycle in `AGENTS.md`: start a documented task
before implementation, synchronize affected documents afterward, validate, and
then close the task.
