# Agent Profile — Current Architecture

This document describes the implementation that exists today. Future
Task/Outcome/Configuration entities and runtime feedback APIs are proposals in
`docs/agent-runtime-profile-design.md`, not current behavior. The implemented
prompt-review surface is an ephemeral deterministic aid; it does not create
those entities or an experiment/outcome loop.

Agent Profile is a local-first profiler for AI coding-agent sessions. It imports
local Claude Code, Codex, Zed, and MiMo data, normalizes their different formats
into sessions and spans, computes comparable process metrics, and exposes the
results through a local API and web application.

## System flow

```text
Claude Code JSONL ─┐
Codex rollout JSONL ├─→ source adapters ─→ import coordinator
Zed SQLite + zstd ──┤                              │
MiMo SQLite ────────┘                              ▼
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
fingerprint refresh once on their next scan. The server starts background
imports for configured Claude/Codex directories and available Zed/MiMo
databases so startup is not blocked by a large local history. The scan API
supports manual import of a selected transcript directory. The Web manual-scan
action calls it once for Claude Code and once for Codex, then reports combined
source-aware totals.

## Components

| Component | Current responsibility |
| --- | --- |
| `packages/core` (`@agent-profile/core`) | Source parsing helpers, normalized types, deterministic analysis and diagnosis, versioned Agent profile, prompt-review, and Session-evidence reports, tool categorization, pricing calculations |
| `apps/server/src/ingestion/*-adapter.ts` | Source-specific discovery, revision fingerprinting, lazy loading, and parser invocation |
| `apps/server/src/ingestion/import-coordinator.ts` | Shared skip/import/update/failure decisions across every source |
| `apps/server/src/ingestion/session-repository.ts` | Normalized analysis and atomic session/span persistence |
| `apps/server/src/routes/scan.ts` | Thin manual/startup scan entry points; contains no import persistence SQL |
| `apps/server/src/database.ts` | SQLite creation, ordered migrations, and time-aware pricing lookup |
| `apps/server/src/db.ts` | Default local database instance, pricing/model-context seed data, and current lookup wrappers |
| `apps/server/src/routes/` | Health, sessions, aggregate analysis, diagnosis, statistics, pricing, context-window, scan, export, and comparison APIs |
| `apps/web` | Project/session navigation, dashboards, detail analysis, Agent profiles, ephemeral prompt review, comparisons, statistics, annotations, and configuration UI |

The API is split by domain under `apps/server/src/routes/`; it is not a single
monolithic routes file.

## Current data sources

| Agent | Local source | Import model |
| --- | --- | --- |
| Claude Code | project transcript JSONL | file mtime/size fingerprint; message/tool blocks and parent chains |
| Codex | dated rollout JSONL | file mtime/size fingerprint; rollout `session_meta.id` thread identity (legacy `session_id` fallback), project metadata, response items, events, and call IDs |
| Zed | threads SQLite database with compressed payloads | `updated_at` plus payload metadata fingerprint; changed payloads are decoded lazily |
| MiMo | `mimocode.db` SQLite database | `time_updated` plus message/part counts; changed session records are loaded lazily |

All adapters emit the same session/span shape so downstream metrics and UI do
not need agent-specific logic for basic analysis. Coverage can still vary by
source: a missing field means “not captured”, not zero or failure.

## Persistence model

`apps/server/src/database.ts` owns five current internal tables:

- `sessions` — source identity and revision metadata (`source_kind`,
  `source_updated_at`, `source_fingerprint`); agent/model/project fields; four
  token totals; context, cache, cost, duration, annotation tags, and notes.
- `spans` — normalized `llm_turn` and `tool_call` evidence, token/context/cost
  fields, timing, parent/sidechain links, tool input/output metadata, and
  truncation-safe content.
- `pricing` — per-model CNY prices for the four token classes, with unit and
  effective time.
- `model_context` — per-model context-window limits.
- `schema_migrations` — ordered, idempotent schema changes and their application
  time.

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
- Span cost uses all four token classes and the model price effective at the
  span's `startTime`. The current contract is `CNY` per million tokens.
  `costCurrency`, `pricingEffectiveFrom`, `costCalculatedAt`, and
  `costCalculatorVersion` make the derived value reproducible. Unknown pricing
  is surfaced as unknown rather than silently estimated as a known bill.
- Cost attribution distributes an LLM turn's cost across tool categories used
  by that turn and shows tool-free turns separately. It is an analytical
  allocation, not a provider invoice.
- Read-to-edit conversion is bounded to 0–100%; tool success is weighted by
  calls; project ranking uses the same composite process-efficiency score shown
  in the detail view.
- Tool categorization groups observed calls for analysis; it does not define
  the runtime's structural call graph.

Efficiency, diagnosis, and scoring describe execution behavior. Without a
recorded Task and Outcome, they cannot establish whether the requested
deliverable was correct. This is the central boundary between the current
session profiler and the proposed runtime-profile design.

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
- versioned per-Agent process profiles with resource, context, reliability, and
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

### Agent Profile report contract

`agent-profile/v1` is a stable derived report over the current normalized
sessions and spans; it does not add a persistence table. Each Agent profile
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
as a human-readable runtime fingerprint rather than a leaderboard.

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
| `POST` | `/api/scan` | Scan/import a selected transcript directory |
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
