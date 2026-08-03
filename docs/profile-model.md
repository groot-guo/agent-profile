# Agent Profile Model

> Status: current-state terminology and product model. For implemented storage,
> APIs, and calculations, see `../ARCHITECTURE.md`. For future delivery phases,
> see `profile-evolution-plan.md` and `agent-runtime-profile-design.md`.

## Product positioning

Agent Profile is a local-first runtime profiling, diagnosis, and
outcome-evaluation system for AI coding agents. It turns local runtime evidence
into scoped, coverage-aware profiles so people can understand how work was
performed and future Agent Runtime consumers can use bounded, verified evidence.

It is not a chat-history viewer, hosted monitoring service, code-quality scanner,
universal Agent ranking, or autonomous prompt/rule optimizer. Task is a delivery
and comparability boundary in this system, not its sole purpose.

## Evidence model

```text
local source histories
  -> normalized Spans and Sessions
  -> Session analysis and diagnosis
  -> Project Profile
  -> Agent Process Profile
  -> Task + Configuration Snapshot + Outcome
  -> Task Profile
  -> Cohort/Configuration Runtime Profile
  -> opt-in post-run feedback
```

Every layer must retain its evidence boundary. Missing source data is "not
captured"; it is not zero, success, failure, or proof that an Agent behaved
better.

## Profile taxonomy

| Term | Scope and purpose | Current state |
| --- | --- | --- |
| **Span / Event evidence** | One normalized LLM turn, tool call, thinking block, or answer block. This is the structural evidence layer. | Implemented as stored Spans and `session-evidence/v1`. It is not a complete original transcript. |
| **Session analysis** | One continuous observed Agent run. Explains resource use, context, tools, chain relationships, diagnosis, and process efficiency. | Implemented. It does not prove task success. |
| **Project Profile** | Coverage-aware process evidence for one project key across primary Sessions: resources, source coverage, tool reliability, and time trends. | Implemented as `project-profile/v1`. File evidence remains `not_captured`; it does not establish code quality or causality. |
| **Agent Process Profile** | Distributional runtime fingerprint for one observed Agent across current Sessions: resource, context, reliability, collaboration, coverage, and neutral peer-relative characteristics. | Implemented as `agent-profile/v1`. It is Session-scoped and does not yet group by Task, Configuration Snapshot, or Outcome. |
| **Task Profile** | One explicit delivery unit, its linked primary/continuation/subagent/verification Sessions, associated configuration snapshots, outcome fields, coverage, and aggregated process evidence. | Implemented as `task-profile/v1`. It is not a cross-Task configuration comparison. |
| **Cohort / Experiment definition** | A persisted declaration of what Tasks are comparable and which control/candidate configurations should be evaluated. | Implemented as guarded local records and editable in the Task workspace. |
| **Cohort/Configuration Runtime Profile** | A distributional comparison of comparable Tasks for a specific runtime/configuration, with Outcome guardrails and explicit scope. | Implemented as `cohort-runtime-profile/v1` at `GET /api/experiments/:id/profile`; minimum samples, metric coverage, and unsupported guardrails remain explicit. It does not produce a universal or causal winner. |
| **Verified Post-Run Feedback** | One completed, Outcome-verified candidate Task's bounded view of an Experiment decision and current cohort evidence. | Implemented as opt-in `post-run-feedback/v1` at `GET /api/tasks/:id/feedback?optIn=true`. It is read-only, suppresses stale/insufficient evidence, and contains no prompt, rule, transcript, or chain-of-thought content. |

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
- A configuration can be described only as a bounded observed candidate after
  the current comparable-cohort report has sufficient samples and explicit
  Outcome guardrails; it is not a universal or causal winner.
- Observed tool non-error is not verified success; unknown pricing and absent
  source fields remain visible as coverage limits.
- A Project Profile is a bounded observation of one project key, not a complete
  repository inventory; file-level evidence can remain `not_captured`.

## Current feedback loop

Today the product supports a local, primarily human-mediated loop:

1. Import local source histories and inspect Session evidence and diagnostics.
2. Use the Agent Process Profile to identify recurring process patterns.
3. Treat prompt-review and runtime differences as hypotheses, not prescriptions.
4. Create a Task for meaningful delivery work; optionally prefill its title and
   project from a locally observed Session, then review assistance candidates
   before linking Sessions or adding evidence.
5. Record explicit Outcome evidence and inspect the Task Profile. Accepted local
   assistance retains producer, capture time, source, and correlation basis.
6. For eligible completed candidate Tasks, explicitly inspect bounded post-run
   feedback and use it to decide what to investigate or test next.

The Task workspace records build, test, lint, Git commit, human rating, rework
reason, completion time, and bounded structured evidence. Local assistance can
suggest same-project/time-window Sessions and local Git references through
`task-assistance/v1`, but every candidate requires separate human confirmation;
Git suggestions remain references and do not populate a passing status. Accepted
evidence retains producer/time/provenance. `verified` Outcome
coverage means the five tracked coverage fields are present; it does not mean
that every recorded check passed.

The product does not automatically rewrite prompts, rules, model settings, or
tool policy. It can expose an explicit, bounded post-run finding linked to the
current `cohort-runtime-profile/v1`, but Runtime-consumable live hints and
automatic configuration mutation remain future layers.

Source-change observation refreshes imported evidence after local history files
or databases change. Its updating/recent state is a revision-recency signal, not
proof that an Agent is live or a Task is complete. Current CLI/API consumers can
read bounded reports, but an external Runtime SDK and in-run feedback contract
are not implemented.

## Deferred implementation boundaries

The following are deliberate future boundaries, not current product claims:

- extend the bounded cohort/configuration Runtime Profile with broader time,
  project, and statistical regression contracts beyond the current Experiment
  and Cohort definition scope;
- make post-run feedback available to an external Agent Runtime, then add
  bounded in-run hints without transmitting raw prompts or chain-of-thought;
- add optional code-quality evidence integrations such as CI, static analysis,
  review, and rework signals. Process metrics alone must not be relabelled as
  code-quality evidence.

Each boundary needs a separate roadmap Task with data contracts, privacy,
comparison rules, migration/API implications, and verification evidence before
it becomes a current-state capability.

`profile-evolution-plan.md` maps these boundaries to T111-T121. The plan is a
proposal, not an implementation claim.

## Documentation rules

- `README.md` and `README.zh-CN.md` explain today’s user workflows and link to
  this model.
- `ARCHITECTURE.md` specifies current report/API/storage contracts and their
  limitations.
- `docs/tasks-outcomes.md` specifies the Task/Outcome layer only.
- `docs/agent-runtime-profile-design.md` describes future Runtime Profile and
  feedback capabilities; it must label every unimplemented layer as proposal.
- `docs/profile-evolution-plan.md` decomposes proposed delivery work and its
  cross-cutting privacy, evidence, and comparison constraints.
- `docs/roadmap.md` is authoritative for when a proposed layer becomes an
  implementation Task and for its verification evidence.
