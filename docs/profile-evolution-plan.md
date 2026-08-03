# Profile Evolution Plan

> Status: proposal and delivery plan. This document does not describe current
> behavior. Current implementation remains defined by `../ARCHITECTURE.md` and
> `profile-model.md`; active/planned Task status is in `roadmap.md`.

## Purpose

Agent Profile already provides local, coverage-aware evidence for observed
Agent process and explicit Task Outcomes. The next product question is not
whether to add another cost chart. It is whether the product can help a person
or an Agent take one verifiable next action without weakening its local-first,
privacy, and evidence-boundary guarantees.

This plan turns that question into separately releasable Tasks. It deliberately
does not promise a live control plane, remote monitoring service, universal
Agent ranking, or automatic prompt/configuration mutation.

## Assessment Baseline

### Strengths already available

- The source-adapter, revision, and atomic-replacement path produces auditable
  normalized Session/Span evidence without double-counting unchanged history.
- Token classes, cache semantics, time-aware pricing, unknown-cost coverage, and
  parent/Sidechain evidence are kept separate instead of being collapsed into a
  misleading score or invoice.
- Session analysis and 11 deterministic diagnosis rules can identify concrete
  process patterns: repeated exploration, oversized context/output, cache loss,
  tool failure loops, redundant reads, compression, and model changes. Findings
  carry Span IDs and bounded estimates.
- Session, Project, Agent Process, Task, bounded Cohort/Experiment, and opt-in
  post-run reports form a coherent evidence taxonomy. Minimum samples and metric
  coverage are visible, and relative labels remain descriptive.
- The local Runtime is shared by Server, Web, and CLI, so a future Agent-facing
  workflow can reuse the same repository and metric contracts without creating a
  second persistence path.

### Capability verdict

| Question | Current answer | Boundary |
| --- | --- | --- |
| Can a person locate runtime problems and performance hotspots? | Yes, usually for observed Sessions. | It identifies evidence-backed patterns, not arbitrary code-root causes. |
| Can a person or offline Agent form a next-step hypothesis? | Yes, through findings, Profiles, prompt review, and explicit Task/Outcome records. | The hypothesis remains human-mediated and must be verified by a Task Outcome. |
| Can an Agent consume findings and write a bounded result? | Yes, through the versioned local CLI/API reports, explicit Outcome write, and opt-in post-run report. | It remains local/content-free and does not mutate Agent configuration. |
| Can the tool solve or prevent a problem during execution? | No. | T116 now collects local lifecycle metadata, but there is no live hint channel or automatic configuration mutation; T117 owns that policy. |
| Can it prove one Agent/configuration is better? | No. | Current cohort output is descriptive and bounded; task difficulty, coverage, uncertainty, and attribution remain limits; T118/T119 extend them. |

### Material gaps mapped to Tasks

The highest-impact gap is the missing last mile from a finding to a safe action:
semantic diagnosis now has request-scoped consent, common-secret redaction, and
bounded content-free audit metadata (T111), while findings with stored Span IDs
now have direct bounded evidence navigation (T112). Outcome evidence needs
confirmation and a producer contract (T113/T114), and the Agent now has
content-free local reports and an explicit write path (T115). T116 adds the
local Runtime event protocol/collector; bounded in-run advice remains T117.
Comparison rigor (T118),
typed multi-Agent attribution (T119), pricing governance (T120), and large-history
ergonomics (T121) are parallel or later tracks. Non-local use remains conditional
T88 work.

## Current Boundary

Today, the primary path is:

```text
local histories -> normalized Sessions/Spans -> diagnosis and Profiles
  -> explicit Task/Outcome -> bounded cohort comparison -> opt-in post-run feedback
```

Source observation can refresh evidence shortly after a local history changes.
It is not Agent liveness, a complete event stream, or a guarantee that a Task
has completed. A Task Outcome is explicit local evidence; its coverage state
does not turn missing data into failure or prove delivery quality on its own.

The current `cohort-runtime-profile/v1` is a bounded descriptive comparison:
it has minimum samples, metric coverage, and limited guardrails. It does not
establish a causal configuration winner. `post-run-feedback/v1` is read-only,
opt-in, and suppressed when its current evidence is insufficient or stale.

## Product Direction

The intended progression is:

```text
evidence discovery
  -> human/Agent inspection
  -> explicit, bounded action proposal
  -> user-confirmed execution and Outcome capture
  -> comparable follow-up evidence
```

Each arrow needs its own contract. The system must not jump directly from a
high token count or a heuristic finding to an automatic rule change.

### Non-goals

- Persisting raw prompts, raw chain-of-thought, or complete tool output by
  default.
- Transmitting source content to a provider without an explicit disclosure and
  bounded/redacted payload.
- Calling a source observation state proof that an Agent is currently running.
- Treating a complete Outcome coverage record as proof that all checks passed.
- Selecting a universal Agent/configuration winner from observed process metrics.
- Enabling non-local access before the conditional T88 threat model and
  authorization work are complete.

## Delivery Sequence

| Phase | Tasks | Deliverable | Explicitly not delivered |
| --- | --- | --- | --- |
| Trust before action | T111, T112 | Consent/redaction/audit boundary and finding-to-evidence navigation | Remote access, automatic remediation |
| Lower-friction Outcome evidence | T113, T114 | Human-confirmed Task candidates and a versioned Outcome-evidence contract | Implicit Task links, remote CI access by default |
| Agent-readable local loop | T115 | Content-free CLI/API reports plus explicit Outcome write flow | In-run control or configuration mutation |
| Runtime observation | T116 | Local structured event protocol and collector | Live hints or replacement of transcript evidence |
| Runtime advice | T117 | Opt-in, bounded in-run hints with suppression and evaluation | Automatic model/prompt/tool changes |
| Better comparison | T118 | Explicit comparability strata and uncertainty-aware reports | Causal proof from small/confounded samples |
| Multi-Agent accountability | T119 | Typed Task graph and non-double-counted attribution | Inferred parentage from titles, paths, or timestamps |
| Operational completeness | T120, T121 | Governed model pricing direction and bounded large-history workflows | Blind price scraping or weakening evidence coverage |

T88 remains independent and conditional. It is a deployment/security decision,
not a prerequisite for the default loopback workflow.

## Contract Rules

### Evidence and navigation

Findings must continue to identify their observed Span evidence. Navigation may
open a bounded, content-free evidence view by default. A missing, filtered, or
reset Span must be reported as unavailable; it must not be reconstructed from
unrelated transcript content.

### Semantic diagnosis (T111 implemented contract)

The current configured-provider content boundary is documented in `diagnosis.md`:
the provider path requires request-level `semantic=opt_in`, applies bounded
common-secret redaction before payload construction, and keeps only bounded
content-free process-local audit metadata. Endpoint locality remains unverified
and redaction is not a guarantee against every secret.
Deterministic diagnosis remains useful without a provider; Provider failure
preserves the heuristic-only response. No audit entry stores the prompt,
thinking, tool input, tool output, Provider response, or credential. T112's
navigation does not add a transcript-content disclosure path; it only focuses
the existing bounded evidence query.

### Task and Outcome evidence

Task/session association is a human-confirmed delivery boundary. A suggested
link, nearby Git commit, command exit, or timestamp correlation is evidence to
review, not proof of membership or success.

Outcome reports must distinguish:

- `not_collected`: no value was captured;
- `partial`: some tracked fields were captured;
- `verified`: every tracked coverage field was captured;
- each captured verification status: `passed`, `failed`, `skipped`, or
  `not_run`.

`verified` is coverage, not an all-passed verdict. Any future adapter must carry
producer, timestamp, local reference, source limits, and provenance.

### Agent-facing interfaces

The first Agent interface is local and versioned. It defaults to content-free
reports and can write only data that passes the same Task repository validation
as the Web UI. An Agent can propose an action or record explicitly confirmed
evidence, but it cannot mutate its own configuration based solely on a Profile.

### Runtime events and hints

Runtime events are a new observed source with their own identity, order,
coverage, and provenance. They do not overwrite imported source evidence. A
hint must name its source, evidence scope, freshness, confidence, limitations,
and suppression reason. It is advice, never a code-quality verdict or an
automatic configuration mutation.

### Comparative evidence

Comparison must show the declared Task strata, inclusions/exclusions, Outcome
coverage, metric coverage, distribution, uncertainty, and limitations. Small,
confounded, or incomplete samples must remain `insufficient_evidence` or
`not_comparable`; they must not be upgraded to a recommendation by a score.

### Multi-Agent attribution

Only explicit Task links and source-native relationships can form graph edges.
Resource totals must reconcile to their stored Sessions and cannot merge the
same child evidence twice. A relationship that is absent or unavailable is a
coverage limitation, not an invitation to infer one from text, path, time, or
model similarity.

## Decision Points

The following decisions are needed before their dependent Tasks begin:

1. Which local verification producer is appropriate for the first T114 adapter?
   The default recommendation is a local, user-initiated producer rather than a
   hosted CI integration.
2. Is the first T116 adapter embedded in one coding Runtime, or is the protocol
   published before any Runtime-specific integration? The default recommendation
   is protocol first.
3. What minimum Outcome evidence supports a useful comparison without making
   T118 samples permanently scarce? The coverage/result distinction must remain.
4. Is multi-currency pricing a user need now, or should T120 document and defer
   it while hardening source provenance? No remote price collection is implied.
5. Does the product intend to support non-local use? If yes, T88 must complete
   before remote interfaces or exports are offered.

## Success Measures

The primary product measure is the share of completed Tasks that end with a
verifiable next action or explicitly documented insufficient evidence. Supporting
measures are:

- Outcome coverage and Outcome-producer provenance;
- the proportion of diagnosis findings that can reach bounded evidence;
- hint suppression rate for stale/insufficient evidence;
- comparable cohort coverage after explicit exclusions;
- Agent/API use of content-free reports rather than raw transcript disclosure.

Lower cost, fewer tokens, or higher cache use are not standalone success
measures. Any claimed improvement must retain relevant delivery guardrails.

## Documentation Responsibilities

- `README.md` and `README.zh-CN.md`: user-facing current boundary, semantic
  diagnosis disclosure, and links to this plan.
- `docs/profile-model.md`: canonical terminology and feedback-loop boundary.
- `ARCHITECTURE.md`: actual API/storage/runtime behavior only.
- `docs/diagnosis.md`: implemented diagnostic rules and semantic-provider data
  handling.
- `docs/tasks-outcomes.md`: Outcome coverage/result semantics and comparison
  constraints.
- `docs/multi-agent.md`: source coverage and relationship attribution limits.
- `docs/model-configuration-design.md`: implemented Model Catalog status and
  future price-governance boundary.
- `docs/agent-runtime-profile-design.md`: future Runtime design and phase/task
  dependencies.
- `docs/roadmap.md`: authoritative Task status, scope, verification, and order.
