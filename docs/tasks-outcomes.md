# Task, Outcome, Cohort, and Experiment Foundations

Agent Profile stores local delivery context separately from imported runtime
evidence. In the [Profile model](profile-model.md), Task is the delivery and
comparability boundary between Session process evidence and explicit results; it
is not the product's sole unit of analysis. A Task can link multiple Sessions,
optional Configuration Snapshots, and one explicit Outcome. Cohorts and
experiments persist comparison scope and evidence state; they do not
automatically establish causality.

## Privacy boundary

- Task title, type, project, status, and complexity are ordinary local metadata.
- Goal and acceptance prose are omitted in the default `structured` content
  mode. Storing them requires the explicit `local_text` mode.
- Configuration Snapshots store Agent/model identifiers, version labels, and a
  source hash. They do not copy rule bodies, prompt templates, or raw prompts.
- Outcome evidence is a structured list of at most 50 entries. Each entry has a
  required kind of at most 80 characters, an optional verification status, and
  an optional reference of at most 500 characters. Missing verification fields
  remain `null`; malformed arrays, entries, statuses, and timestamps are
  rejected instead of being stored or silently converted into a result.

## Storage and reset behavior

Migration v5 adds `tasks`, `config_snapshots`, `task_sessions`,
`task_outcomes`, `cohorts`, and `experiments`. Task-Session links validate that
the Session exists when attached, but retain the source Session ID as a logical
reference. If generated Sessions/Spans are reset, Tasks, Outcomes,
Configurations, cohorts, experiments, and links remain. A later source sync can
make a retained link available again.

## Task Profile

`GET /api/tasks/:id/profile` returns `task-profile/v1`. It aggregates only
currently available linked Sessions and reports linked/available coverage,
token totals, known-cost coverage, duration, peak context, cache behavior, tool
errors, Configuration Snapshots, explicit Outcome fields, matching cohort
definitions, and limitations.

Outcome coverage has three states:

- `not_collected`: no verification/Git/rating field was recorded;
- `partial`: at least one but not all tracked fields was recorded;
- `verified`: build, test, lint, Git commit, and human rating are all present.

An explicit `failed` value is evidence. A missing field is not failure.

The Task workspace records all supported fields: build, test, and lint status;
Git commit; 1–5 human rating; rework reason; completion time; and structured
evidence. It shows the exact `observedFields/totalFields` coverage returned by
`task-profile/v1`. Rework reason, completion time, and structured evidence are
supplemental and do not increase the five-field coverage denominator. A
`partial` state is therefore a coverage statement, not a runtime failure or
proof that a Task was unsuccessful.

## Experiment guardrail

The Task workspace creates and edits local Cohort scopes (project, Task type,
and complexity) and Experiment definitions (control/candidate configuration,
primary metric, and guardrails). It presents them as definitions only: no UI
labels a configuration better or computes a distributional result.

Experiments record control/candidate Configuration IDs, cohort, primary metric,
guardrails, lifecycle, evidence status, and an optional decision. A `keep` or
`rollback` decision is rejected unless evidence status is `ready`. Even then,
the record is user/Runtime-supplied evidence state; Agent Profile does not infer
a causal winner from process metrics alone.

## Cohort Runtime Profile

`GET /api/experiments/:id/profile` returns `cohort-runtime-profile/v1`. It
matches Tasks against the persisted Cohort definition and requires exactly one
linked control or candidate Configuration Snapshot per Task. Only Tasks with
all five tracked Outcome fields contribute to guarded distributions. Each
group needs at least three Outcome-eligible Tasks and 50% metric coverage;
otherwise the report returns `insufficient_evidence`.

The report includes task-level distributions for duration, total tokens, known
cost, tool-error rate, peak context, and cache hit rate. Guardrails are
evaluated only when they use `{ metric, maxRelativeRegression }`; arbitrary
stored guardrail values remain `not_evaluable`. Relative differences are
descriptive observations and never become a universal Agent/configuration
winner or an automatic keep/rollback mutation. Runtime feedback hints remain
future work.
