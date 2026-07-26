# Agent Profile — Current Architecture

This document describes the implementation that exists today. Future
Task/Outcome/Configuration entities and runtime feedback APIs are proposals in
`docs/agent-runtime-profile-design.md`, not current behavior.

Agent Profile is a local-first profiler for AI coding-agent sessions. It imports
local Claude Code, Codex, Zed, and MiMo data, normalizes their different formats
into sessions and spans, computes comparable process metrics, and exposes the
results through a local API and web application.

## System flow

```text
Claude Code JSONL ─┐
Codex rollout JSONL ├─→ source adapters ─→ normalized session/spans
Zed SQLite + zstd ──┤                         │
MiMo SQLite ────────┘                         ▼
                                      analyzer/diagnosis
                                               │
                                               ▼
                                      SQLite persistence
                                               │
                                               ▼
                                      Fastify API → Next.js UI
```

Scanning is incremental where source metadata permits it. The server starts
background imports for configured Claude/Codex directories and available
Zed/MiMo databases so startup is not blocked by a large local history. The scan
API supports manual import of a selected transcript directory.

## Components

| Component | Current responsibility |
| --- | --- |
| `packages/core` (`@agent-profile/core`) | Source parsing helpers, normalized types, deterministic analysis and diagnosis, tool categorization, pricing calculations |
| `apps/server/src/routes/scan.ts` | Source discovery/import for Claude Code, Codex, Zed, and MiMo; normalization and persistence |
| `apps/server/src/database.ts` | SQLite creation, ordered migrations, and time-aware pricing lookup |
| `apps/server/src/db.ts` | Default local database instance, pricing/model-context seed data, and current lookup wrappers |
| `apps/server/src/routes/` | Health, sessions, aggregate analysis, diagnosis, statistics, pricing, context-window, scan, export, and comparison APIs |
| `apps/web` | Project/session navigation, dashboards, detail analysis, comparisons, statistics, annotations, and configuration UI |

The API is split by domain under `apps/server/src/routes/`; it is not a single
monolithic routes file.

## Current data sources

| Agent | Local source | Import model |
| --- | --- | --- |
| Claude Code | project transcript JSONL | message/tool blocks and parent chains |
| Codex | dated rollout JSONL | session metadata, response items, events, and call IDs |
| Zed | threads SQLite database with compressed payloads | thread records decoded into normalized spans |
| MiMo | `mimocode.db` SQLite database | session, message, and part records |

All adapters emit the same session/span shape so downstream metrics and UI do
not need agent-specific logic for basic analysis. Coverage can still vary by
source: a missing field means “not captured”, not zero or failure.

## Persistence model

`apps/server/src/database.ts` owns five current internal tables:

- `sessions` — source identity and incremental metadata; agent/model/project
  fields; four token totals; context, cache, cost, duration, annotation tags,
  and notes.
- `spans` — normalized `llm_turn` and `tool_call` evidence, token/context/cost
  fields, timing, parent/sidechain links, tool input/output metadata, and
  truncation-safe content.
- `pricing` — per-model CNY prices for the four token classes, with unit and
  effective time.
- `model_context` — per-model context-window limits.
- `schema_migrations` — ordered, idempotent schema changes and their application
  time.

The database applies ordered additive migrations. Existing annotation columns
and T39 cost-provenance columns are detected safely and each migration version
is recorded once. Schema changes must include an explicit migration/backfill
plan and integration test in their Task; deleting `trace.db` is not the normal
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
- Git commit evidence, JSON/CSV export, and generated session reports;
- editable pricing/model-context data and total-cost recomputation.

Mutable pricing and model-context requests have runtime JSON-schema validation.
New user pricing defaults to its write time; callers may supply an explicit
`effectiveFrom`. Recompute selects pricing independently for each historical
LLM span and records calculator version `v1`. Pre-T39 stored costs retain
`legacy` provenance until they are imported again or recomputed.

LLM diagnosis is optional. Without its API configuration, deterministic
analysis remains available and the service continues to function.

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
| `GET` | `/api/sessions/compare` | Selected-session comparison |
| `GET` | `/api/stats` | Aggregate statistics and distributions |
| `GET/PUT` | `/api/pricing` | Model pricing |
| `GET/PUT` | `/api/model-context` | Model context-window configuration |
| `POST` | `/api/recompute-cost` | Recalculate stored costs by span-time pricing and refresh provenance |

## Operation and configuration

- API: port `3000` by default, configurable through `PORT`.
- Web: port `3001` by default; API origin is configurable through
  `NEXT_PUBLIC_API`.
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
