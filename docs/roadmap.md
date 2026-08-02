# Roadmap & Task Register

This file is the authoritative register for active and planned work. Terminal Task bodies and verification evidence are stored in the linked archive; use `pnpm check:roadmap` after changing either location.

The normal lifecycle is `planned` → `in_progress` → `completed`; `blocked` and `cancelled` are terminal alternatives. Repository-wide workflow rules remain in [../AGENTS.md](../AGENTS.md).

## Active and Planned Tasks

### T81 Cohort and Experiment definition workspace

- status: planned
- estimated size/risk: medium / medium; mostly existing persistence exposure, but
  the UI must not imply an automatically calculated winner
- purpose: expose the existing guarded local Cohort/Experiment records so users
  can define comparable Task scope and control/candidate configurations before
  any automatic result calculation exists
- dependencies: T80, T98, and T49 persistence contracts
- scope: create/view/update local Cohort and Experiment definitions, required
  comparison scope, primary metric, guardrails, evidence status, and constrained
  keep/rollback decisions; omit automatic distributions, winners, and causality
- acceptance: the workspace cannot label a configuration better without the
  existing ready-evidence guardrail; every definition states its Task scope and
  missing Outcome coverage; raw prompts/rule bodies remain unpersisted
- verification: repository/API guardrail tests, focused Web interaction tests,
  production build, and documentation consistency review
- documentation: update Profile model, Task/Outcome guide, architecture, READMEs,
  and this Task to keep persistence distinct from statistical evaluation

### T85 append-only JSONL import for Claude Code and Codex

- status: planned
- estimated size/risk: extra-large / high; source mutation patterns and parser
  equivalence make a safe fallback/checkpoint design mandatory
- purpose: reduce repeated parsing work for growing transcript sources without
  weakening the cross-source revision and atomic-replacement guarantees
- dependencies: T82, T87's stable relationship/replacement contract, and a
  source-specific design review for Claude Code and Codex JSONL append,
  truncation, rewrite, sidechain, and legacy-ID behavior
- scope: add safe per-source append checkpoints with full-parse fallback; measure
  unchanged, appended, rewritten, truncated, and malformed histories; do not
  apply JSONL assumptions to Zed, MiMo, or OpenCode SQLite adapters
- acceptance: appended histories produce the same normalized Session/Span result
  as a clean full parse; rewrites/truncations safely fall back; failed parsing
  retains last good generated data; annotations and revision fingerprints remain
  correct
- verification: parser/ingestion equivalence fixtures, recovery/retry tests,
  benchmark comparison against T82, type/build checks, and local sync inspection
- documentation: update source-adapter contracts, recovery behavior, scale
  boundaries, and roadmap verification evidence

### T86 project-level cross-Session evidence

- status: planned
- estimated size/risk: large / medium-high; project identity and heterogeneous
  source coverage require a new aggregation/report contract
- purpose: provide a coverage-aware Project Profile for observed file/tool,
  resource, reliability, and trend evidence without relabelling it as code
  quality or configuration causality
- dependencies: T73 source-faithful attribution, T83 data-access contract, and
  T87 source-native relationship coverage
- scope: define project identity/scope, cross-Session aggregation, time range,
  sample and source coverage, file/tool trend semantics, and a Project analysis
  surface; retain missing evidence as not captured
- acceptance: every project conclusion exposes Sessions, time range, source and
  metric coverage; no derived file/tool trend claims a complete repository or
  delivery-quality verdict; different source coverage remains visible
- verification: Core aggregation tests with coverage gaps, API/UI scope tests,
  production build, and representative local read-only inspection
- documentation: update Profile taxonomy, architecture, stats/multi-agent
  guidance, README/Chinese overview as appropriate, and roadmap

### T87 source-native parent and child Session evidence

- status: planned
- estimated size/risk: large / high; likely additive migration and per-source
  identity behavior must remain atomically replaceable
- purpose: preserve and present parent/child Session relationships only where a
  source supplies stable structural evidence, without manufacturing a universal
  Task graph
- dependencies: T73, T98, and source-adapter contract review; potential
  migration plan
- scope: inventory source-native relation IDs, add an additive relationship
  model only for proven links, retain existing Span sidechain evidence, and show
  unavailable/ambiguous relation coverage explicitly
- acceptance: no relationship is inferred from path, prompt, title, timing, or
  model heuristics; source updates replace links atomically; reset/reimport and
  user annotations preserve the documented semantics
- verification: parser/adapter/repository migration tests, source fixtures for
  linked/missing/ambiguous cases, reset/reimport checks, and UI coverage checks
- documentation: update schema, source adapter, evidence limitations, and
  roadmap documentation with actual supported sources

### T88 conditional non-local access safety

- status: planned
- estimated size/risk: large / high and conditional; actual size depends on the
  deployment and identity model selected by a future product decision
- purpose: define and implement authentication, directory authorization,
  backup/export, and threat-model controls only if the product is intentionally
  exposed beyond the local trusted-machine use case
- dependency: an explicit user/product decision to support non-loopback access
- scope: threat model first; then narrow authentication/authorization, safe
  origin/export controls, operational recovery guidance, and security tests as
  required by the chosen deployment model
- acceptance: no default loopback workflow regresses; no remote exposure is
  documented or enabled without an agreed threat model and tested controls
- verification: security design review, negative authorization tests, deployment
  smoke checks, and updated operational documentation
- documentation: update configuration, privacy, architecture, README, and
  roadmap only after a concrete deployment decision

### T89 comparable cohort/configuration Runtime Profile evaluation

- status: planned
- estimated size/risk: extra-large / high; statistical, Outcome, privacy, storage,
  API, and interpretation contracts must agree before implementation
- purpose: calculate distributional, Outcome-guarded comparisons for comparable
  Tasks rather than treating a persisted Experiment definition as an outcome
- dependencies: T80, T81, representative Outcome data, and an approved minimum
  sample/coverage/statistical decision design
- scope: define comparable-task constraints, coverage thresholds, distribution
  statistics, regressions, evidence-sufficient/insufficient decisions, and
  neutral report/API semantics; no universal Agent ranking
- acceptance: missing Outcome remains missing; one Task cannot establish a
  configuration effect; every decision shows sample, scope, coverage, guardrail,
  and limitations
- verification: synthetic statistical fixtures, Core/API tests, privacy review,
  and documentation/model consistency review
- documentation: promote only actually implemented cohort evaluation behavior
  from proposal to current-state documents and record remaining limits

### T90 bounded verified post-run feedback

- status: planned
- estimated size/risk: medium-large / high; recommendations become Runtime-facing
  product behavior and therefore need strict evidence and staleness contracts
- purpose: make verified cohort findings consumable after a Task completes,
  without automatic prompt/rule rewrites or in-run Agent control
- dependencies: T89 and an explicit consumer/privacy contract
- scope: versioned, coverage-aware post-run finding records and presentation;
  opt-in, bounded evidence references; stale/insufficient-evidence suppression
- acceptance: each recommendation links to its cohort evidence and limitations;
  no raw prompt/chain-of-thought transfer, automatic configuration mutation, or
  causal claim beyond T89's decision contract
- verification: Core/API/UI contract tests, privacy/redaction review, and
  representative post-run user-flow check
- documentation: update Profile model, Runtime proposal, architecture, README,
  and roadmap to distinguish post-run feedback from future live Runtime hints

## Terminal Task Index

| Task | Title | Status |
| --- | --- | --- |
| [T5](roadmap-archive/2026-q3.md#t5) | db schema: add agent column | completed |
| [T6](roadmap-archive/2026-q3.md#t6) | Codex parser | completed |
| [T7](roadmap-archive/2026-q3.md#t7) | Zed parser | completed |
| [T8](roadmap-archive/2026-q3.md#t8) | scanner multi-source + scan API | completed |
| [T9.5](roadmap-archive/2026-q3.md#t9-5) | startup auto-scan | completed |
| [T9](roadmap-archive/2026-q3.md#t9) | UI style adjustment + remove redundant requests | completed |
| [T10](roadmap-archive/2026-q3.md#t10) | agent filter | completed |
| [T11](roadmap-archive/2026-q3.md#t11) | sub-agent call chain merge | completed |
| [T12](roadmap-archive/2026-q3.md#t12) | stats API + overview page | completed |
| [T13](roadmap-archive/2026-q3.md#t13) | distribution charts | completed |
| [T14](roadmap-archive/2026-q3.md#t14) | LlmDiagnoser implementation (P2.19a) | completed |
| [T15](roadmap-archive/2026-q3.md#t15) | glm-5.2 pricing + totalCost recompute | completed |
| [T36](roadmap-archive/2026-q3.md#t36) | stability hardening | completed |
| [T37](roadmap-archive/2026-q3.md#t37) | task-driven documentation consistency | completed |
| [T38](roadmap-archive/2026-q3.md#t38) | unify agent guidance entry points | completed |
| [T39](roadmap-archive/2026-q3.md#t39) | correctness contracts, migrations, and server verification | completed |
| [T40](roadmap-archive/2026-q3.md#t40) | source adapters and session repository boundary | completed |
| [T41](roadmap-archive/2026-q3.md#t41) | runtime-consumable Agent profiles and difference view | completed |
| [T42](roadmap-archive/2026-q3.md#t42) | prompt-structure review and evidence-backed iteration hints | completed |
| [T43](roadmap-archive/2026-q3.md#t43) | normalized session evidence timeline and transparency | completed |
| [T44](roadmap-archive/2026-q3.md#t44) | repository lint baseline cleanup | completed |
| [T45](roadmap-archive/2026-q3.md#t45) | unified development startup and Session detail information architecture | completed |
| [T46](roadmap-archive/2026-q3.md#t46) | Codex import completeness and reliable Web navigation | completed |
| [T47](roadmap-archive/2026-q3.md#t47) | product documentation and bilingual README | completed |
| [T48](roadmap-archive/2026-q3.md#t48) | product-ready local operation and first-run onboarding | completed |
| [T49](roadmap-archive/2026-q3.md#t49) | Task/Outcome, cohort, and experiment foundations | completed |
| [T50](roadmap-archive/2026-q3.md#t50) | scale, project intelligence, and local safety | cancelled |
| [T51](roadmap-archive/2026-q3.md#t51) | Agent identity clarity and theme-toggle stability | completed |
| [T52](roadmap-archive/2026-q3.md#t52) | schema migration consistency guard | completed |
| [T53](roadmap-archive/2026-q3.md#t53) | claude transcript cwd and metadata extraction fix | completed |
| [T54](roadmap-archive/2026-q3.md#t54) | session detail right panel overflow and responsive layout | completed |
| [T55](roadmap-archive/2026-q3.md#t55) | Zed session analysis missing | completed |
| [T56](roadmap-archive/2026-q3.md#t56) | Codex invalid session filtering | completed |
| [T57](roadmap-archive/2026-q3.md#t57) | context window utilization clarity and data provenance | completed |
| [T58](roadmap-archive/2026-q3.md#t58) | window context limits alignment with official sources | completed |
| [T59](roadmap-archive/2026-q3.md#t59) | OpenCode session scan adapter | completed |
| [T60](roadmap-archive/2026-q3.md#t60) | codex token extraction fallback | completed |
| [T61](roadmap-archive/2026-q3.md#t61) | current-task completion audit and data-UX task decomposition | completed |
| [T62](roadmap-archive/2026-q3.md#t62) | initial data loading, source status, and first-run onboarding | completed |
| [T63](roadmap-archive/2026-q3.md#t63) | safe analysis rebuild and local-data reset | completed |
| [T64](roadmap-archive/2026-q3.md#t64) | flat Session navigation and project filtering | completed |
| [T65](roadmap-archive/2026-q3.md#t65) | Codex Desktop VS Code history rollout compatibility | completed |
| [T66](roadmap-archive/2026-q3.md#t66) | source-session anomaly and overlap audit | completed |
| [T67](roadmap-archive/2026-q3.md#t67) | source metadata completeness and invalid-session handling | completed |
| [T68](roadmap-archive/2026-q3.md#t68) | canonical model identity and statistics grouping | completed |
| [T69](roadmap-archive/2026-q3.md#t69) | statistics trend inspection and profile-card layout consistency | completed |
| [T70](roadmap-archive/2026-q3.md#t70) | session-navigation loading performance and transition feedback | completed |
| [T72](roadmap-archive/2026-q3.md#t72) | Agent Profile card/grid overlap regression | completed |
| [T73](roadmap-archive/2026-q3.md#t73) | MiMo external Claude Code history exclusion | completed |
| [T74](roadmap-archive/2026-q3.md#t74) | Session title fallback and recent-history filter refinement | completed |
| [T75](roadmap-archive/2026-q3.md#t75) | Session filter console visual redesign | completed |
| [T76](roadmap-archive/2026-q3.md#t76) | reconcile diverged main while preserving in-progress T59 | completed |
| [T77](roadmap-archive/2026-q3.md#t77) | planned-scope and execution-order cleanup | completed |
| [T78](roadmap-archive/2026-q3.md#t78) | product positioning, Profile taxonomy, and documentation governance | completed |
| [T79](roadmap-archive/2026-q3.md#t79) | roadmap decomposition and local performance/memory assessment | completed |
| [T80](roadmap-archive/2026-q3.md#t80) | Task Outcome evidence workspace completion | completed |
| [T82](roadmap-archive/2026-q3.md#t82) | representative scale fixtures and performance budgets | completed |
| [T83](roadmap-archive/2026-q3.md#t83) | bounded Session discovery and statistics data contract | completed |
| [T84](roadmap-archive/2026-q3.md#t84) | bounded Session detail and evidence retrieval | completed |
| [T91](roadmap-archive/2026-q3.md#t91) | first-run and full-import progress experience | completed |
| [T92](roadmap-archive/2026-q3.md#t92) | Codex non-project Session classification | completed |
| [T93](roadmap-archive/2026-q3.md#t93) | Session sidebar hierarchy and compact data synchronization | completed |
| [T94](roadmap-archive/2026-q3.md#t94) | searchable grouped project picker and compact filter responsiveness | completed |
| [T95](roadmap-archive/2026-q3.md#t95) | Codex top-level Session accounting and turn model attribution | completed |
| [T96](roadmap-archive/2026-q3.md#t96) | Explicit Server Node type dependency | completed |
| [T97](roadmap-archive/2026-q3.md#t97) | modular architecture and model-configuration design baseline | completed |
| [T98](roadmap-archive/2026-q3.md#t98) | module contracts and reusable Runtime/HTTP composition | completed |
| [T99](roadmap-archive/2026-q3.md#t99) | Model Catalog and pricing-schedule Server module | completed |
| [T100](roadmap-archive/2026-q3.md#t100) | Model Catalog configuration workspace | completed |
| [T101](roadmap-archive/2026-q3.md#t101) | CLI foundation and local Runtime entry point | completed |
| [T102](roadmap-archive/2026-q3.md#t102) | CLI synchronization, Session queries, and reports | completed |
| [T103](roadmap-archive/2026-q3.md#t103) | CLI `serve` command and distributable local application | completed |
| [T104](roadmap-archive/2026-q3.md#t104) | collapse Session-detail navigation history | completed |
| [T105](roadmap-archive/2026-q3.md#t105) | active Session observation and live refresh | completed |
| [T107](roadmap-archive/2026-q3.md#t107) | clear repository lint baseline | completed |
| [T108](roadmap-archive/2026-q3.md#t108) | Model Catalog bundled-seed startup recovery | completed |
| [T106](roadmap-archive/2026-q3.md#t106) | bounded roadmap register and completed-task archive | completed |
| [T71](roadmap-archive/2026-q3.md#t71) | model-context and analysis configuration audit | completed |

## Execution Order

T79 completed the documentation/assessment baseline, T92 completed the bounded
Codex non-project classification fix, T73 restored MiMo source attribution, and
T82 established the representative performance baseline. T93/T94 then completed
the compact Home synchronization, data-management, project-picker, and responsive
sidebar interaction layer. T95 then established one current primary-Session
scope while retaining child records, and T97 documented the module and Model
Catalog target without changing runtime behavior. The remaining normal
CLI-first implementation order is:

The immediate sequence authorized on 2026-07-31 completed T105 using bounded
source observation and the existing atomic replacement path without waiting for
T85's parser optimization, followed by the documentation-only T106
roadmap-register/archive work and the T71 configuration audit. T99 then
completed the Model Catalog Server contract, and T100 completed its public Web
configuration surface. T70 subsequently completed the independent Session
detail transition repair. The next normal implementation candidate is T80; the
longer-term dependency order remains:

1. T101 CLI foundation, then coordinate T83 bounded discovery and T84 bounded
   detail/evidence retrieval with T102 CLI synchronization/query/report work so
   CLI and compatibility HTTP routes share the same services.
2. T103 `serve` and distribution after the terminal workflow is useful; retain
   the current Web until the production packaging comparison selects Next
   standalone or a static SPA.
3. T99 Model Catalog Runtime extraction/data contracts and T100's optional Web
   configuration workspace are complete.
4. T80 Task Outcome evidence work follows the completed Runtime/CLI foundation; T81
   Cohort/Experiment workflow remains deferred until Task/Outcome usage is
   established and must not drive the initial CLI architecture.
5. T87 source-native parent/child evidence before T86 project-level aggregation,
   so Project Profile accounting is designed against proven relationship
   coverage rather than the temporary primary-only boundary.
6. T85 append-only JSONL import after the normalized relationship/replacement
   contract is stable.
7. T89 comparable cohort evaluation, followed by T90 verified post-run feedback.

T88 is conditional on a product decision to support non-local access and is not
part of the default local-first sequence. Mobile dashboard navigation remains
intentionally out of scope.

## Task Lifecycle

The detailed workflow is maintained in `../AGENTS.md`. The canonical transition is:

`planned` → `in_progress` → `completed`

`blocked` and `cancelled` are terminal alternatives when completion is not possible or no longer desired.

User authorization can be given by the request that starts the work; a second confirmation is required only when scope, risk, or external effects materially exceed that authorization. A task may be marked `completed` only after its implementation, affected documentation, and verification evidence have all been recorded.
