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
- Outcome evidence is a bounded structured list of kind, optional verification
  status, and optional reference. Missing verification fields remain `null`.

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

The current Task workspace records build, test, lint, Git commit, human rating,
rework reason, local completion time, and bounded structured evidence. Each
evidence item has a required kind plus optional supported verification status
and bounded reference; a partially filled item is rejected rather than silently
removed. The displayed coverage is the canonical `task-profile/v1` response,
so `not_collected`, `partial`, and `verified` retain their server-defined
meaning. Neither a UI `partial` state nor an explicit failed check proves a
general delivery-quality verdict.

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

The current implementation does not yet calculate cohort distributions,
minimum-sample experiment statistics, regression detection, or Runtime feedback
hints. Those remain later work.
