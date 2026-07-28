# Agent Profile — Current Architecture

This document describes the implementation that exists today.
Agent Profile is a local-first runtime profiling, diagnosis, and
outcome-evaluation system for AI coding agents. Its canonical current-state
terminology is in `docs/profile-model.md`. Task/Outcome/Configuration
persistence, Task-Session links, cohort/experiment definitions, and
`task-profile/v1` are implemented foundations. Automated cohort statistics,
configuration-level Runtime Profiles, causal experiment evaluation, regression
decisions, and Runtime feedback APIs remain proposals in
`docs/agent-runtime-profile-design.md`. The prompt-review surface remains
ephemeral and does not automatically create or modify those persisted records.

It imports local Claude Code, Codex, Zed, MiMo, and OpenCode data, normalizes
their different formats into Sessions and Spans, computes comparable process
metrics, and exposes the results through a local API and web application.

## Profile model

The product has distinct evidence layers:

- **Span/Event evidence** and **Session analysis** describe observed runtime
  process; they do not prove delivery success.
- **Agent Process Profile** is the implemented `agent-profile/v1` report over
  Session distributions. Its scope is currently Agent plus available Session
  evidence; it is not grouped by Configuration Snapshot, Task type, or Outcome.
- **Task Profile** is the implemented `task-profile/v1` report for one explicit
  delivery unit, its linked Sessions/configurations, and its explicit Outcome
  coverage.
- **Cohort/Experiment definitions** persist comparison scope and guardrails,
  but do not calculate outcomes or causal winners.
- A cohort/configuration-level **Runtime Profile** is future work. It requires
  comparable Task samples, Outcome guardrails, coverage, and statistical rules.

All reports expose their scope and limitations. Process metrics may form a
diagnostic or iteration hypothesis; they are not a universal Agent ranking or a
code-quality verdict.

## System flow

```text
Claude Code JSONL ─┐
Codex rollout JSONL ┤
Zed SQLite + zstd ──┼─→ source adapters ─→ import coordinator
MiMo SQLite ────────┤                              │
OpenCode SQLite ────┘                              ▼
                                      normalized session/spans
                                                   │
                                                   ▼
                                      analyzer → session repository
                                                   │
                                                   ▼
                                                SQLite
                                                   │
                                                   ▼
                                      Fastify API → Next.js UI
```

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

The Web derives its import progress only from that public per-source state. If
an active job starts with zero stored Sessions, Home renders a dedicated
data-preparation page with available-source cards, a determinate
completed-source/available-source count, and an explicit source-level
limitation. Unavailable sources are excluded from the denominator. During
sync or forced rebuild when Sessions already exist, Home keeps the list and
analysis interactive and adds a sticky, non-modal progress panel showing the
operation, settled-source count, active source names, and failed source names.
It polls the existing job status and refreshes dashboard data once when the job
becomes terminal; it does not create a second import pipeline or imply
file-/record-level progress.

The same job manager also owns an explicit forced-rebuild operation. Rebuild
bypasses matching source fingerprints but keeps the normal lazy load, analysis,
and per-Session atomic replacement path. A parse/load failure therefore leaves
the prior normalized Session intact, annotations survive successful
replacement, and unavailable sources are not deleted. Full generated-data
reset is deliberately separate: it requires an exact confirmation phrase,
cannot run during an import job, deletes `spans` and `sessions` in one
transaction, and retains `pricing`, `model_context`, and `schema_migrations`.
Task, Outcome, Configuration Snapshot, cohort, experiment, and logical
Task-Session records are also retained so imported runtime evidence can be
restored later without losing delivery context.

Scan results also expose structured `skipReasons`: `unchanged_revision` means a
matching source fingerprint required no work, while `not_importable` means the
source item did not produce a normalized Session (for example, a metadata-only
history with no usable LLM turn). These remain skipped items rather than import
failures; malformed items that throw are counted separately as failures.

## Components

| Component | Current responsibility |
| --- | --- |
| `packages/core` (`@agent-profile/core`) | Source parsing helpers, normalized types, deterministic analysis and diagnosis, versioned Agent profile, prompt-review, and Session-evidence reports, tool categorization, pricing calculations |
| `packages/core/src/scanners/transcript.ts` | Source-neutral async JSONL discovery and NDJSON reading shared by Claude Code and Codex, with compatibility sync helpers |
| `apps/server/src/ingestion/*-adapter.ts` | Source-specific discovery, revision fingerprinting, lazy loading, and parser invocation |
| `apps/server/src/ingestion/import-coordinator.ts` | Shared skip/import/update/failure decisions across every source |
| `apps/server/src/ingestion/import-job-manager.ts` | Deduplicated startup/manual sync and rebuild state, availability, progress, failure isolation, and bounded public status |
| `apps/server/src/ingestion/session-repository.ts` | Normalized analysis, atomic session/span replacement, and transactional generated-data reset |
| `apps/server/src/task-repository.ts` | Task/configuration/Outcome/cohort/experiment persistence boundary and Task Profile aggregation inputs |
| `apps/server/src/routes/scan.ts` | Thin manual/startup scan entry points; contains no import persistence SQL |
| `apps/server/src/database.ts` | SQLite creation, ordered migrations, and time-aware pricing lookup |
| `apps/server/src/db.ts` | Default local database instance, pricing/model-context seed data, and current lookup wrappers |
| `apps/server/src/routes/` | Health, sessions, Tasks/Outcomes/experiments, aggregate analysis, diagnosis, statistics, pricing, context-window, scan, export, and comparison APIs |
| `apps/web` | Project/session navigation, Task verification workspace, dashboards, detail analysis, Agent profiles, ephemeral prompt review, comparisons, statistics, annotations, and configuration UI |

The API is split by domain under `apps/server/src/routes/`; it is not a single
monolithic routes file.

The supported non-watch local launcher is root `pnpm start`: its `prestart`
builds the workspace, then the Server and production Next.js process run
together. API and Web listeners default to `127.0.0.1`; API CORS accepts only
the local `localhost:3001` and `127.0.0.1:3001` Web origins. `HOST` and
comma-separated `WEB_ORIGIN` are explicit overrides. Because the API has no
authentication or directory authorization, a non-loopback `HOST` is an
operator opt-in for trusted networks and emits a startup warning.

The Home page owns the initial Sessions, Stats, and import-status requests and
passes data into the Dashboard. Dashboard model totals and recent-tool
frequency use two set-based Span queries; the browser does not fetch tools once
per recent Session. Existing data remains interactive during a job. The browser
polls only while `active=true`, stops in terminal states or on unmount, and
refreshes Sessions/Stats once after completion.

Session discovery uses one flat recent list grouped by today/yesterday/recent
time boundaries. Project is row metadata and an exact counted selector rather
than a required accordion hierarchy; the free-text field still supports partial
title/project/path discovery. An all/1/7/30/90-day rolling range composes with
project, Agent, text, quick-view, and sort filters. These filters and the
selected Session use bounded URL parameters; opening a Session pushes one
history entry and browser back restores the filters and saved list scroll.
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
Source-provided Session names remain authoritative. When one is absent, the Web
layer derives a display-only Agent/project/local-start-time label from
non-content metadata; it does not store a replacement title or inspect prompt,
answer, or reasoning content. Only 120 matching rows render initially, with
explicit incremental batches for larger result sets.

### Current scale boundaries

The 120-row Web render limit bounds DOM creation only. The current Home request
still returns all Session summaries, and the browser performs its filtering,
sorting, project counting, and time grouping over that complete response.
`/api/stats` likewise reads all Session summaries and calculates several
distributions in-process. Session detail analysis and evidence reports load the
complete stored Span set for the selected Session; the analysis endpoint also
loads all stored Spans for the selected Session's project when calculating the
current project-relative score. These are correct current behaviors, not
large-history performance guarantees.

The source import coordinator discovers all source items but skips an unchanged
item before loading/parsing it. When a source revision changes, the complete
normalized Session is parsed and atomically replaces its stored Spans. This
preserves revision and annotation guarantees, but transcript append-only parsing
is not implemented. T82–T85 in `docs/roadmap.md` own performance fixtures,
bounded read/render contracts, and source-safe incremental-import work; they
must not change metric, privacy, or atomic-replacement semantics merely to
improve throughput.

## Current data sources

| Agent | Local source | Import model |
| --- | --- | --- |
| Claude Code | project transcript JSONL | file mtime/size fingerprint; message/tool blocks and parent chains |
| Codex | dated rollout JSONL | file mtime/size fingerprint; rollout `session_meta.id` thread identity (legacy `session_id` fallback), captured `session_meta.cwd` project evidence when present, response items, events, and call IDs |
| Zed | threads SQLite database with zstd-compressed JSON payloads | parser-contract version plus `updated_at` and payload metadata fingerprint; changed payloads are decoded lazily, tagged User/Agent messages become LLM-turn/answer/tool-call Spans, `request_token_usage` supplies observed input/output tokens, and `folder_paths` supplies cwd |
| MiMo | `mimocode.db` SQLite database | `time_updated` plus message/part counts; changed session records are loaded lazily |
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

## Persistence model

`apps/server/src/database.ts` owns eleven current internal tables:

- `sessions` — source identity and revision metadata (`source_kind`,
  `source_updated_at`, `source_fingerprint`); agent/model/project fields; four
  token totals; context, cache, cost, duration, annotation tags, and notes.
- `spans` — normalized `llm_turn` and `tool_call` evidence, token/context/cost
  fields, timing, parent/sidechain links, tool input/output metadata, and
  truncation-safe content.
- `pricing` — per-model CNY prices for the four token classes, with unit and
  effective time.
- `model_context` — per-model context-window limits. Built-in rows are
  conservative vendor-specification seeds, audited on 2026-07-27; they are not
  transcript-observed values and user edits take precedence because startup uses
  `INSERT OR IGNORE`.
- `schema_migrations` — ordered, idempotent schema changes and their application
  time.
- `tasks` — local delivery identity, project/type/status/complexity, and an
  explicit content mode. Goal/acceptance prose is allowed only in `local_text`.
- `config_snapshots` — Agent/model identifiers, version labels, and source hash;
  no rule or prompt body is copied by this model.
- `task_sessions` — multi-Session Task links, role, timing, and optional
  Configuration Snapshot. Session IDs remain logical references across reset.
- `task_outcomes` — nullable build/test/lint/Git/rating/rework/evidence fields;
  null means not collected and explicit `failed` means failed.
- `cohorts` — local comparison definitions and lifecycle state.
- `experiments` — control/candidate configurations, cohort, primary metric,
  guardrails, evidence state, and bounded decision state.

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
- OpenCode currently exposes token classes only at Session granularity. Its one
  aggregate LLM Span is labelled `tokenUsageSource=session_aggregate`; this
  preserves observed totals without implying per-message token or context
  behavior that the source did not capture.
- Span cost uses all four token classes and the model price effective at the
  span's `startTime`. The current contract is `CNY` per million tokens.
  `costCurrency`, `pricingEffectiveFrom`, `costCalculatedAt`, and
  `costCalculatorVersion` make the derived value reproducible. Unknown pricing
  is surfaced as unknown rather than silently estimated as a known bill.
- Statistics may derive a presentation-only canonical model group for explicit
  aliases while retaining raw source labels. Provider-only and unknown model
  values remain distinct; this grouping never rewrites stored evidence or
  changes the raw-model pricing lookup.
- Cost attribution distributes an LLM turn's cost across tool categories used
  by that turn and shows tool-free turns separately. It is an analytical
  allocation, not a provider invoice.
- Read-to-edit conversion is bounded to 0–100%; tool success is weighted by
  calls; project ranking uses the same composite process-efficiency score shown
  in the detail view.
- Tool categorization groups observed calls for analysis; it does not define
  the runtime's structural call graph.

Efficiency, diagnosis, and scoring describe execution behavior. A recorded Task
and Outcome add delivery evidence for that Task, but neither one Task nor an
unscoped Agent Process Profile establishes a general configuration effect. This
is the boundary between implemented Session/Task evidence and the future
cohort/configuration Runtime Profile design.

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
  context/cost, tools/chain, and normalized-evidence views;
- Git commit evidence, JSON/CSV export, and generated session reports;
- editable pricing/model-context data and total-cost recomputation.

Mutable pricing and model-context requests have runtime JSON-schema validation.
New user pricing defaults to its write time; callers may supply an explicit
`effectiveFrom`. Recompute selects pricing independently for each historical
LLM span and records calculator version `v1`. Pre-T39 stored costs retain
`legacy` provenance until they are imported again or recomputed.

LLM diagnosis is optional. Without its API configuration, deterministic
analysis remains available and the service continues to function.

### Session evidence report contract

`session-evidence/v1` is derived on demand from one stored Session and all of
its normalized Spans. It adds no table or migration. Events are sorted by
`startTime` with source order as a stable tie-breaker, then numbered so every
stored `llm_turn`, `tool_call`, `thinking`, and `answer` Span appears exactly
once. Each event exposes:

- root/linked/missing-parent relationship and main/sidechain lane;
- start time, captured end time/duration, model identity, token/context,
  output-size, and known cost fields;
- `observed_error`, `no_error_observed`, or `not_applicable` outcome wording;
- expected content-field names and whether each was captured.

`no_error_observed` is intentionally not called “success”: several source
formats cannot prove result correctness from a false/missing error flag.
Report-level coverage distinguishes complete, partial, not-captured, and
not-applicable evidence for timing, parent links, tool input/output, model
identity, and content-bearing events.

`GET /api/session/:id/evidence` defaults to `content=none`; therefore the
response contains no stored tool input/output, thinking, or answer text.
`content=preview` is an explicit local disclosure that returns at most 500
characters per available field after common secret redaction. It also reports
whether the parser had already truncated the stored source. There is no
full-raw-content mode in this API. The aggregated Session-detail
`/api/session/:id/analysis` response also strips Span metadata; the UI must use
the evidence endpoint when a user explicitly requests previews.

The report is complete only for the normalized Span set. Parsers do not
currently create first-class user-message Spans for every source, so neither
the API nor the Session UI calls the result a complete original conversation.
The Session detail page keeps this evidence layer in a dedicated view. That
view is mounted on demand, provides filters and progressive disclosure, and
does not request the evidence report while the user remains in the overview,
context/cost, or tools/chain views.

### Agent Process Profile report contract

`agent-profile/v1` is the implemented Agent Process Profile: a stable derived
report over current normalized Sessions and Spans. It does not add a persistence
table or aggregate Task Outcomes. Each Agent profile
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
`task-profile/v1` for one delivery unit, and do not imply a cohort/configuration
Runtime Profile until that future report exists.

### Task Profile report contract

`task-profile/v1` is the implemented per-Task delivery profile. It aggregates
only currently available linked Sessions and exposes linked/available coverage,
Agent identities, token totals, known-cost coverage, duration, peak context,
cache behavior, tool-error evidence, attached Configuration Snapshots, explicit
Outcome fields, matching cohort definitions, and limitations.

Its Outcome coverage is `not_collected`, `partial`, or `verified`; a missing
field never becomes a failure. The report does not compute cross-Task cohort
distributions, configuration winners, regression decisions, or causal effects.

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
| `POST` | `/api/data-management/reset` | Confirm and transactionally delete generated Sessions/Spans while retaining pricing, model configuration, migrations, and Task/Outcome/experiment records |
| `GET` | `/api/sessions` | Session list |
| `PATCH` | `/api/session/:id` | Update session tags/notes |
| `GET` | `/api/session/:id` | Session with spans |
| `GET` | `/api/session/:id/analysis` | Aggregated detail analysis |
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
| `GET` | `/api/sessions/compare` | Selected-session comparison |
| `GET` | `/api/stats` | Aggregate statistics and distributions |
| `GET` | `/api/profiles/agents` | Versioned process profiles for all observed Agents |
| `GET` | `/api/profiles/agents/:agent` | One observed Agent profile with peer-relative context |
| `POST` | `/api/prompt-review` | Ephemeral deterministic prompt review and guarded iteration hints |
| `GET/POST` | `/api/tasks` | List or create local Tasks |
| `GET/PATCH` | `/api/tasks/:id` | Read Task detail or update metadata/lifecycle |
| `GET/POST` | `/api/tasks/:id/sessions` | List or attach Session/configuration links |
| `PUT` | `/api/tasks/:id/outcome` | Upsert explicit nullable Outcome fields |
| `GET` | `/api/tasks/:id/profile` | Export coverage-aware `task-profile/v1` |
| `GET/POST` | `/api/config-snapshots` | List or create version/hash-only Configuration Snapshots |
| `GET/POST` | `/api/cohorts` | List or create cohort definitions |
| `GET/POST` | `/api/experiments` | List or create guarded experiment records |
| `PATCH` | `/api/cohorts/:id`, `/api/experiments/:id` | Update comparison lifecycle/evidence state within database guardrails |
| `GET/PUT` | `/api/pricing` | Model pricing |
| `GET/PUT` | `/api/model-context` | Model context-window configuration |
| `POST` | `/api/recompute-cost` | Recalculate stored costs by span-time pricing and refresh provenance |

## Operation and configuration

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
- Root `pnpm test` runs Core and Server tests. Root `pnpm build` includes Core
  TypeScript, Server TypeScript, and the Web production build.

## Documentation boundary

- This file is the source of truth for current architecture.
- `README.md` is the concise user-facing current-state entry point.
- `docs/roadmap.md` is the source of truth for task status and completion
  evidence.
- `docs/agent-runtime-profile-design.md` is the future design proposal.
- Focused documents under `docs/` must be updated in the same task when their
  domain changes.

Repository changes follow the lifecycle in `AGENTS.md`: start a documented task
before implementation, synchronize affected documents afterward, validate, and
then close the task.
