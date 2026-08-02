# Agent Profile Model

> Status: current-state terminology and product model. For implemented storage,
> APIs, and calculations, see `../ARCHITECTURE.md`. For future cohort,
> configuration, and Runtime-feedback work, see
> `agent-runtime-profile-design.md`.

## Product positioning

Agent Profile is a local-first runtime profiling, diagnosis, and
outcome-evaluation system for AI coding agents. It turns local runtime evidence
into scoped, coverage-aware profiles so people and Agent Runtimes can understand
how work was performed and verify whether a change preserved delivery results.

It is not a chat-history viewer, hosted monitoring service, code-quality scanner,
universal Agent ranking, or autonomous prompt/rule optimizer. Task is a delivery
and comparability boundary in this system, not its sole purpose.

## Evidence model

```text
local source histories
  -> normalized Spans and Sessions
  -> Session analysis and diagnosis
  -> Agent Process Profile
  -> Task + Configuration Snapshot + Outcome
  -> Task Profile
  -> future comparable cohort/configuration Runtime Profile
```

Every layer must retain its evidence boundary. Missing source data is "not
captured"; it is not zero, success, failure, or proof that an Agent behaved
better.

## Profile taxonomy

| Term | Scope and purpose | Current state |
| --- | --- | --- |
| **Span / Event evidence** | One normalized LLM turn, tool call, thinking block, or answer block. This is the structural evidence layer. | Implemented as stored Spans and `session-evidence/v1`. It is not a complete original transcript. |
| **Session analysis** | One continuous observed Agent run. Explains resource use, context, tools, chain relationships, diagnosis, and process efficiency. | Implemented. It does not prove task success. |
| **Agent Process Profile** | Distributional runtime fingerprint for one observed Agent across current Sessions: resource, context, reliability, collaboration, coverage, and neutral peer-relative characteristics. | Implemented as `agent-profile/v1`. It is Session-scoped and does not yet group by Task, Configuration Snapshot, or Outcome. |
| **Task Profile** | One explicit delivery unit, its linked primary/continuation/subagent/verification Sessions, associated configuration snapshots, outcome fields, coverage, and aggregated process evidence. | Implemented as `task-profile/v1`. It is not a cross-Task configuration comparison. |
| **Cohort / Experiment definition** | A persisted declaration of what Tasks are comparable and which control/candidate configurations should be evaluated. | Implemented as guarded local records and editable in the Task workspace. They do not yet calculate distributions, regressions, or causal winners. |
| **Cohort/Configuration Runtime Profile** | A distributional comparison of comparable Tasks for a specific runtime/configuration, with Outcome guardrails and explicit scope. | Future work. Do not present it as an existing report or API. |

The product name “Agent Profile” refers to the system as a whole. When naming a
specific implemented report, use the precise term above rather than implying
that `agent-profile/v1` already proves outcome quality or configuration effects.

## Scope, coverage, and interpretation

A useful Profile must state its scope: Agent/runtime identity, model and
configuration version when known, project or cohort, time range, Session/Task
sample count, source coverage, and metric provenance. Distributions, not a
single score, describe process behavior.

- Higher/lower token, cost, duration, cache, tool-error, or Sidechain values are
  observations, not a quality ranking.
- Process efficiency and diagnosis are hypotheses about execution behavior.
- A Task Outcome provides delivery evidence for one Task, but one Task does not
  establish a general configuration effect.
- A configuration can be described as preferable only after a future comparable
  cohort evaluation has sufficient samples and explicit Outcome guardrails.
- Observed tool non-error is not verified success; unknown pricing and absent
  source fields remain visible as coverage limits.

## Current feedback loop

Today the product supports a local, human- or Runtime-mediated loop:

1. Import local source histories and inspect Session evidence and diagnostics.
2. Use the Agent Process Profile to identify recurring process patterns.
3. Treat prompt-review and runtime differences as hypotheses, not prescriptions.
4. Create a Task for meaningful delivery work; link its Sessions and a
   version/hash-only Configuration Snapshot.
5. Record explicit Outcome evidence and inspect the Task Profile.
6. Use the results to decide what to investigate or test next.

The Task workspace records build, test, lint, and Git-commit fields. The local
model/API additionally supports human rating, rework reason, completion time,
and bounded structured evidence; a later UI Task must expose any additional
fields before the workspace alone can produce fully verified Outcome coverage.

The product does not automatically rewrite prompts, rules, model settings, or
tool policy. It also does not yet compute cohort-level configuration winners,
regressions, or Runtime-consumable live hints. Those are future layers that
require their own Tasks, statistical rules, privacy review, and validation.

## Deferred implementation boundaries

The following are deliberate future boundaries, not current product claims:

- aggregate comparable Tasks into a cohort/configuration Runtime Profile with
  explicit task-type, complexity, project, time, and coverage scope;
- calculate minimum-sample distributions, Outcome guardrails, regressions, and
  evidence-sufficient experiment decisions rather than merely persisting their
  definitions;
- make verified post-run findings and, later, bounded in-run hints consumable by
  an Agent Runtime without transmitting raw prompts or chain-of-thought;
- add optional code-quality evidence integrations such as CI, static analysis,
  review, and rework signals. Process metrics alone must not be relabelled as
  code-quality evidence.

Each boundary needs a separate roadmap Task with data contracts, privacy,
comparison rules, migration/API implications, and verification evidence before
it becomes a current-state capability.

## Documentation rules

- `README.md` and `README.zh-CN.md` explain today’s user workflows and link to
  this model.
- `ARCHITECTURE.md` specifies current report/API/storage contracts and their
  limitations.
- `docs/tasks-outcomes.md` specifies the Task/Outcome layer only.
- `docs/agent-runtime-profile-design.md` describes future Runtime Profile and
  feedback capabilities; it must label every unimplemented layer as proposal.
- `docs/roadmap.md` is authoritative for when a proposed layer becomes an
  implementation Task and for its verification evidence.
