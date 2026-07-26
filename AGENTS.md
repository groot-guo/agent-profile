# Repository Working Agreement

This file applies to the entire repository. It defines the minimum task and
documentation lifecycle for every intentional change.

## 1. Every change belongs to an explicit task

Before editing code, schemas, APIs, UI behavior, configuration, scripts, or
user-visible documentation:

1. Create or update a task in `docs/roadmap.md`.
2. Give the task a unique ID and mark it `in_progress`.
3. Record, at a level proportional to the change:
   - purpose and expected outcome;
   - scope and exact files or components expected to change;
   - dependencies, assumptions, risks, and known blockers;
   - acceptance criteria;
   - verification commands or checks;
   - the documents that must be updated after implementation.
4. State the active task before making implementation changes.

A user request may both authorize and start a task. Do not require a redundant
confirmation unless the implementation would materially expand the requested
scope, risk, external effects, or destructive impact.

Small typo or formatting fixes may use a compact task entry, but they still
belong to an explicit task. Do not hide unrelated work inside another task.

## 2. Keep the task accurate while working

- The normal transition is `planned` → `in_progress` → `completed`.
- Use `blocked` when required input or an external dependency prevents
  progress, and `cancelled` when the task is intentionally abandoned.
- Update the task before broadening its scope or changing its acceptance
  criteria.
- Record material design decisions and deviations from the original plan.
- If a change affects public behavior, data interpretation, storage, APIs,
  configuration, or operations, update the corresponding document in the same
  task.

## 3. Documentation responsibilities

| Document | Source-of-truth responsibility |
| --- | --- |
| `README.md` | Current user-facing positioning, implemented capabilities, setup, and document entry points |
| `ARCHITECTURE.md` | Current implemented architecture, data flow, storage, APIs, limitations, and operational behavior |
| `docs/roadmap.md` | Task definitions, lifecycle status, acceptance criteria, and completion evidence |
| `docs/agent-runtime-profile-design.md` | Proposed target model and future Agent Runtime Profile design; it must not present unimplemented behavior as current |
| `docs/diagnosis.md`, `docs/multi-agent.md`, `docs/stats.md` | Focused domain designs and implementation notes that must agree with the current architecture |
| `docs/zh/OVERVIEW.md` | Chinese current-state overview aligned with README and architecture |

When code and documentation disagree, inspect the implementation and tests,
then correct the current-state documents. Future design belongs in a clearly
labelled proposal, not in current-state claims.

## 4. Required documentation update after implementation

Before closing a task:

1. Update the affected documents with the behavior that was actually
   implemented, not only the original intention.
2. Record any API, schema, migration, metric-definition, configuration,
   compatibility, or operational impact.
3. Record known gaps and deferred follow-up work as separate tasks when they
   are actionable.
4. Add the verification commands/checks and their results to the task.
5. Review the diff for stale or contradictory claims.

Code completion without the corresponding documentation update is not task
completion.

## 5. Task completion gate

A task may be marked `completed` only when:

- its acceptance criteria are satisfied;
- relevant tests, builds, type checks, smoke tests, or document checks have
  been run in proportion to risk;
- affected documentation describes the final state;
- actual changed files and verification results are recorded;
- remaining limitations are explicit.

The completion report must identify the task ID, what changed, what was
verified, and anything intentionally left open. If these conditions are not
met, keep the task `in_progress` or mark it `blocked`; do not report it as
finished.
