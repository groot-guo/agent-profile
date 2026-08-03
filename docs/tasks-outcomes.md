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
  an optional reference of at most 500 characters. Local assistance may add a
  bounded provenance object with producer, capture time, source, source ID, and
  correlation basis; it never adds a verification result. Missing verification
  fields remain `null`; malformed arrays, entries, statuses, provenance, and timestamps are
  rejected instead of being stored or silently converted into a result.

## Storage and reset behavior

Migration v5 adds `tasks`, `config_snapshots`, `task_sessions`,
`task_outcomes`, `cohorts`, and `experiments`. Task-Session links validate that
the Session exists when attached, but retain the source Session ID as a logical
reference. If generated Sessions/Spans are reset, Tasks, Outcomes,
Configurations, cohorts, experiments, and links remain. A later source sync can
make a retained link available again.
Migration v11 adds optional producer, capture-time, and provenance JSON columns
to Task-Session links so accepted local suggestions remain auditable without
changing existing links.

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

`verified` is a coverage state only. One or more captured build, test, or lint
values may still be `failed`, `skipped`, or `not_run`; it does not mean every
check passed or prove that the Task delivered the intended result. An explicit
`failed` value is evidence. A missing field is not failure.

The Task workspace records all supported fields: build, test, and lint status;
Git commit; 1–5 human rating; rework reason; completion time; and structured
evidence. It shows the exact `observedFields/totalFields` coverage returned by
`task-profile/v1`. Rework reason, completion time, and structured evidence are
supplemental and do not increase the five-field coverage denominator. A
`partial` state is therefore a coverage statement, not a runtime failure or
proof that a Task was unsuccessful.

## Local Task assistance

`GET /api/tasks/:id/assistance` returns `task-assistance/v1`. It proposes at most
20 currently unlinked primary Sessions sharing the Task project key and a
seven-day window around the Task's local timestamps, plus at most 20 local Git
commits from up to three observed repository paths in the same window. The
response contains only bounded Session metadata and commit metadata, not prompt,
answer, thinking, tool content, or local paths. Every suggestion includes a
producer, capture time, source ID, and correlation basis.

The Web workspace lets a person ignore or accept each candidate independently.
Session acceptance writes only the explicit logical link and its provenance. Git
acceptance adds a provenance-bearing reference to the unsaved Outcome draft; the
user must review and save it. Suggestions are correlation aids, not membership
proof, verification results, or delivery-quality conclusions.

## Outcome-evidence adapter contract

`outcome-evidence/v1` is the versioned boundary for a producer that reports
structured delivery evidence without silently writing an Outcome. A report
identifies its producer, capture time, source, bounded records, capture limits,
and limitations. Record status is explicit: `not_captured` means the source did
not provide evidence; `observed` means bounded metadata was seen without a
pass/fail claim; `passed`, `failed`, `skipped`, and `not_run` remain available
when an authorized source explicitly records those verification results.

The first approved producer is the read-only local Git adapter at
`GET /api/tasks/:id/outcome-evidence?source=local_git`. It uses only fixed Git
metadata queries against a linked Session working directory or an absolute Task
project, returns metadata-only local references, and preserves producer/time/
source provenance. It never executes build, test, or lint commands, accepts no
arbitrary command, uploads no content, and does not overwrite human Outcome
fields. Missing Git access is returned as `not_captured` with a limitation;
`observed` Git metadata is not a passing verification result. Remote CI and
review connectors are not enabled by this contract.

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
future work; the separate post-run feedback contract below is the only current
Runtime-facing consumer.

## Verified Post-Run Feedback

`GET /api/tasks/:id/feedback?optIn=true` returns zero or more
`post-run-feedback/v1` records for the selected Task. The explicit opt-in is
required; a request without it is rejected. The Task workspace requests the
same read-only report when the user opens a Task.

The report emits a finding only for a completed, Outcome-verified Task in the
candidate side of an Experiment whose current `cohort-runtime-profile/v1` is
`ready` and whose persisted decision is explicitly `keep` or `rollback`.
Incomplete Outcome, control-baseline, absent decision, incomplete Experiment,
insufficient Profile evidence, and a decision whose current Profile is no longer
ready are returned as suppression reasons instead of recommendations.

Each finding links only to bounded cohort evidence: Experiment/Cohort IDs,
report version/time, primary metric, guardrail summaries, and limitations. It
does not persist a feedback record, expose Task goal/acceptance text, prompts,
rules, transcripts, tool output, or chain-of-thought, and cannot mutate an
Experiment decision or Configuration Snapshot. The finding is a bounded
post-run observation, not a causal guarantee or live Runtime instruction.

## Planned evidence evolution

- T113 implements bounded local Task/Session/Git candidates and explicit
  per-item confirmation. Correlation by time, project, or commit is not proof of
  Task membership or success.
- T114 implements `outcome-evidence/v1` and one approved read-only local Git
  producer. It preserves producer, timestamp, local reference, capture limits,
  and the distinction between coverage and result; arbitrary commands and
  remote connectors remain outside the boundary.
- T118 will strengthen comparability strata and uncertainty reporting around the
  current bounded cohort report. It must not turn descriptive process metrics
  into a causal or universal configuration winner.
