# Agent Profile Repository Instructions

This is the canonical instruction file for every coding Agent working in this
repository. `CLAUDE.md` is a compatibility symlink to this file; do not maintain
separate instructions behind the two entry points.

## Project context

Agent Profile is a local-first runtime profiling, diagnosis, and
outcome-evaluation system for AI coding agents. It imports Claude Code, Codex,
Zed, MiMo, and OpenCode Session data; normalizes runtime evidence; analyzes
resources, context, tools, collaboration, and reliability; and can attach that
process evidence to explicit local Task Outcomes.

Keep the boundaries clear:

- `README.md` is the user-facing current-state entry point.
- `ARCHITECTURE.md` is the detailed source of truth for current implementation.
- `docs/profile-model.md` defines the canonical product positioning and Profile
  terminology for current-state documentation and implementation discussions.
- `docs/roadmap.md` is the source of truth for Task status and verification.
- `docs/agent-runtime-profile-design.md` is a future proposal, not current
  behavior.

The current evidence model has distinct layers. Session analysis and
`session-evidence/v1` describe normalized observed process; `agent-profile/v1`
is an Agent Process Profile over Session distributions; `task-profile/v1`
combines one explicit Task’s linked Sessions, configuration snapshots, and
Outcome coverage. Cohort and experiment records persist comparison definitions,
but cohort/configuration outcome aggregation, automated regression decisions,
and Runtime feedback remain proposed until their roadmap Tasks are completed.

## Common commands

```bash
pnpm install
pnpm dev
pnpm build
pnpm lint
pnpm --filter trace-server dev
pnpm --filter agent-profile-web dev
pnpm --filter @agent-profile/core test
```

- Web UI: `http://localhost:3001`
- API health: `http://localhost:3000/api/health`
- `AUTO_SCAN_DIR=""` disables the configured transcript-directory startup
  scan.
- `PORT` changes the API port; `NEXT_PUBLIC_API` changes the web API origin.

Run verification in proportion to the change. Core behavior normally needs core
tests; server/type changes need TypeScript/build validation; web changes need
lint and a production build or focused UI verification.

## Durable implementation invariants

These rules protect metric correctness and must not change accidentally:

- Keep input, cache-creation, cache-read, and output tokens separate. Context
  tokens are input + cache creation + cache read; cache-read pricing and meaning
  differ from ordinary input.
- Source transcripts do not provide a trustworthy universal cost field. Compute
  cost from model, four token classes, and the pricing table. Unknown pricing
  must remain visibly unknown rather than becoming a trusted estimate. Select
  the price effective at the LLM span time and preserve currency, price
  effective time, calculation time, and calculator version.
- Thinking and answer text are blocks inside an LLM turn; their tokens are part
  of the turn output and are not independently recoverable.
- Every import source must implement the source-adapter contract and provide a
  stable revision fingerprint. Routes and adapters must not write session/span
  SQL; the import coordinator owns revision decisions and the session
  repository owns atomic replacement. When a source session changes, replace
  its generated session/spans so aggregates do not double count.
- The primary scanner path is asynchronous. Keep synchronous helpers only for
  compatibility or focused use; do not move blocking scans into request/startup
  paths without an explicit design Task.
- Forced rebuild may bypass revision equality, but it must retain the ordinary
  adapter/coordinator/repository path, preserve annotations and configuration,
  leave unavailable-source Sessions untouched, and replace each successfully
  parsed Session atomically. Destructive generated-data reset is a distinct,
  explicitly confirmed operation and must preserve pricing, model-context, and
  migration records unless a later Task deliberately changes that contract.
- Pair tool calls/results using source IDs where available
  (`tool_use.id` ↔ `tool_result.tool_use_id`, Codex call IDs, or equivalent).
- Preserve parent and sidechain evidence when the source provides it.
- Tool categories are analytical groupings, not a structural runtime call
  graph. Tool-name and tool-parameter analyses answer different questions.
- Deterministic diagnosis remains available without an LLM provider. Semantic
  diagnosis is optional, inferential, bounded, and must fail back to heuristic
  results.
- Schema changes require a migration/backfill plan and an ordered
  `schema_migrations` entry. Additive migration is the normal upgrade strategy;
  deleting generated `trace.db` is a recovery option, not the default
  migration.
- Missing source fields mean “not captured”, not zero, success, or failure.
  Cross-agent comparisons must expose coverage differences.
- Agent Profile comparisons use per-Agent distributions, minimum samples, and
  explicit metric coverage. Relative labels describe higher/lower/similar
  observed behavior only; never turn token, cost, duration, cache, tool-error,
  or sidechain differences into a universal quality ranking.
- Efficiency and score metrics describe the observed process. Without a
  verifiable Task Outcome they do not prove delivery quality or universal Agent
  superiority.
- Keep Profile terminology precise. A Session analysis is not an Agent Process
  Profile; an Agent Process Profile is not a Task Profile; and a future
  cohort/configuration Runtime Profile must not be claimed by existing reports.
  Every Profile conclusion must expose its scope, sample/coverage limits, and
  whether it concerns process evidence, delivery Outcome evidence, or both.
- Task is a delivery and comparability boundary, not the product’s only unit of
  value. It connects process evidence to explicit Outcomes but does not itself
  establish configuration causality or universal Agent quality.
- Raw prompts are not profiler records. Prompt review must remain ephemeral by
  default: do not persist or log request text, do not send it to a semantic
  provider, keep returned excerpts opt-in/redacted/bounded, and never present a
  keyword match or runtime correlation as a causal optimization result.
- Session evidence reports describe normalized stored Spans, not a guaranteed
  complete source transcript. Preserve stable event order, parent/sidechain
  evidence, and explicit coverage. Default responses must omit stored
  input/output/thinking/answer content; any preview must be explicitly
  requested, secret-redacted, bounded, and labeled when the parser already
  truncated its source.

For formulas, API behavior, storage details, and current source adapters, use
`ARCHITECTURE.md` and the focused documents under `docs/` instead of duplicating
them here.

## Every change belongs to an explicit Task

Before editing code, schemas, APIs, UI behavior, configuration, scripts, or
user-visible documentation:

1. Create or update a Task in `docs/roadmap.md`.
2. Give the Task a unique ID and mark it `in_progress`.
3. Record, at a level proportional to the change:
   - purpose and expected outcome;
   - scope and exact files or components expected to change;
   - dependencies, assumptions, risks, and known blockers;
   - acceptance criteria;
   - verification commands or checks;
   - the documents that must be updated after implementation.
4. State the active Task before making implementation changes.

A user request may both authorize and start a Task. Do not require a redundant
confirmation unless implementation would materially expand the requested scope,
risk, external effects, or destructive impact.

Small typo or formatting fixes may use a compact Task entry, but they still
belong to an explicit Task. Do not hide unrelated work inside another Task.

## Keep the Task accurate while working

- The normal transition is `planned` → `in_progress` → `completed`.
- Use `blocked` when required input or an external dependency prevents progress,
  and `cancelled` when the Task is intentionally abandoned.
- Update the Task before broadening its scope or changing acceptance criteria.
- Record material design decisions and deviations from the original plan.
- If a change affects public behavior, data interpretation, storage, APIs,
  configuration, or operations, update the corresponding document in the same
  Task.

## Documentation responsibilities

| Document | Source-of-truth responsibility |
| --- | --- |
| `AGENTS.md` | Canonical repository instructions, durable implementation invariants, and Task workflow |
| `CLAUDE.md` | Compatibility symlink to `AGENTS.md`; never an independent source |
| `README.md` | Current user-facing positioning, implemented capabilities, setup, and document entry points |
| `ARCHITECTURE.md` | Current implemented architecture, data flow, storage, APIs, limitations, and operational behavior |
| `docs/profile-model.md` | Canonical current-state product positioning, Profile taxonomy, evidence layers, and documentation terminology |
| `docs/roadmap.md` | Task definitions, lifecycle status, acceptance criteria, and completion evidence |
| `docs/agent-runtime-profile-design.md` | Proposed target model and future Agent Runtime Profile design; it must not present unimplemented behavior as current |
| `docs/diagnosis.md`, `docs/multi-agent.md`, `docs/stats.md` | Focused current designs and implementation notes that must agree with the architecture |
| `docs/zh/OVERVIEW.md` | Chinese current-state overview aligned with README and architecture |

When code and documentation disagree, inspect implementation and tests, then
correct the current-state documents. Future design belongs in a clearly labelled
proposal, not in current-state claims.

## Required documentation update after implementation

Before closing a Task:

1. Update affected documents with the behavior that was actually implemented,
   not only the original intention.
2. Record API, schema, migration, metric-definition, configuration,
   compatibility, and operational impacts where relevant.
3. Record known gaps and deferred actionable work as separate Tasks.
4. Add verification commands/checks and their results to the Task.
5. Review the diff for stale or contradictory claims.

Code completion without the corresponding documentation update is not Task
completion.

## Task completion gate

A Task may be marked `completed` only when:

- its acceptance criteria are satisfied;
- relevant tests, builds, type checks, smoke tests, or document checks have run
  in proportion to risk;
- affected documentation describes the final state;
- actual changed files and verification results are recorded;
- remaining limitations are explicit.

The completion report must identify the Task ID, what changed, what was
verified, and anything intentionally left open. If these conditions are not
met, keep the Task `in_progress` or mark it `blocked`; do not report it as
finished.
