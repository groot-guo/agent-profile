# Roadmap & Task Register

This file is the authoritative register for active and planned work. Terminal Task bodies and verification evidence are stored in the linked archive; use `pnpm check:roadmap` after changing either location.

The normal lifecycle is `planned` → `in_progress` → `completed`; `blocked` and `cancelled` are terminal alternatives. Repository-wide workflow rules remain in [../AGENTS.md](../AGENTS.md).

## Active and Planned Tasks

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

### T117 bounded in-run feedback and policy guardrails

- status: planned
- estimated size/risk: large / high; it is the first feature that may influence
  an executing Agent
- purpose: issue opt-in, evidence-backed runtime hints for budget, context, and
  repeated-failure risk without automatically changing prompts, rules, tools,
  models, or user data
- scope: consume T116 events plus eligible historical evidence, define hint
  freshness/confidence/coverage/expiry, enforce rate and content limits, expose
  explicit suppression reasons, record no raw source content in the hint, and
  define an explicit `adopted`, `ignored`, or `not_recorded` hint-adoption record
  with producer/time/evidence reference. Adoption must never be inferred from
  subsequent tool behavior; any persisted record needs a migration plan.
- dependencies: T89/T90 bounded comparison and suppression baseline, T111,
  T114, T115, and T116; broad configuration automation is explicitly out of
  scope
- risks and assumptions: an in-run hint is a hypothesis, not a diagnosis of
  code correctness; stale or insufficient cohort evidence must suppress rather
  than recommend; the Agent remains responsible for its own action
- acceptance: hints are opt-in, bounded, attributable, and suppress on missing
  evidence; no endpoint mutates Agent configuration; a subsequent Task Outcome
  can link only to an explicitly recorded hint-adoption state for evaluation
- verification: policy unit tests, stale/insufficient-evidence integration
  tests, local Runtime simulation, privacy/security review, and Agent-consumer
  contract tests
- documentation: update profile model, runtime proposal, architecture, API,
  privacy, operational guidance, and roadmap

### T118 comparable-cohort and regression-evidence rigor

- status: planned
- estimated size/risk: large / high; it changes how comparison eligibility and
  evidence sufficiency are interpreted
- purpose: strengthen configuration comparisons beyond the current bounded
  mean-difference report while preserving the ban on universal rankings and
  causal claims without evidence
- scope: define declared comparability strata, minimum Outcome-quality and
  coverage rules, robust distribution/effect reporting with uncertainty, and
  explicit `ready`, `insufficient_evidence`, and `not_comparable` states;
  retain user-owned keep/rollback decisions rather than automatic mutation
- dependencies: T89 is the compatibility baseline; T113/T114 provide improved
  Task and Outcome provenance
- risks and assumptions: no semantic prompt text may be used by default to
  infer task equivalence; small or confounded samples must be suppressed, not
  amplified by statistical labels
- acceptance: reports identify the exact eligible strata and exclusions,
  distinguish coverage from favorable outcomes, expose uncertainty/limitations,
  and never emit a universal configuration winner
- verification: deterministic statistical fixtures, regression tests for
  threshold/compatibility behavior, report-schema tests, and documentation
  review with representative insufficient-data cases
- documentation: update profile model, task/outcome design, stats,
  architecture, runtime proposal, README, and roadmap

### T119 unified multi-agent Task graph and resource attribution

- status: planned
- estimated size/risk: large / high; it extends Session relationship semantics
  and changes resource aggregation scope
- purpose: show what primary, continuation, subagent, verification, and
  source-native child Sessions contributed to one Task without inferring
  unsupported relationships or double-counting resource use
- scope: define a typed Task graph over explicit Task links and source-native
  relationships, show relationship coverage/unavailable parents, add opt-in
  task-level resource attribution with source provenance, and leave unsupported
  inferred edges absent
- dependencies: T87 source-native Codex parent links and T113 Task-link
  confirmation; migration/backfill review is required for any persisted graph
- risks and assumptions: titles, paths, timestamps, or model names are not
  sufficient evidence for an inferred parent; a child record may be stored but
  excluded from primary Session aggregates
- acceptance: graph/report makes explicit versus source-native versus missing
  relationships distinguishable; aggregated Task totals reconcile without
  double counting; unavailable/deleted source Sessions stay visible as coverage
  limits
- verification: Core graph/attribution fixtures, repository migration tests,
  cross-source integration tests, UI graph accessibility check, and scale
  benchmark extension
- documentation: update multi-agent ingestion, profile model, task/outcome,
  architecture, stats, README, Chinese overview, and roadmap

### T120 Model Catalog governance and multi-currency design

- status: planned
- estimated size/risk: medium / high; currency and price-source changes affect
  historical cost interpretation
- purpose: define governed price-source updates and a migration-safe path from
  the current CNY/per-million-token contract to explicitly supported additional
  currencies or provider pricing schemes
- scope: document the supported price-source lifecycle, staleness/provenance
  rules, import-review workflow, currency conversion policy if adopted, and
  compatibility behavior for historical Sessions; do not silently scrape or
  trust remote pricing
- dependencies: T99/T100 Model Catalog contracts; any network fetch requires
  separate user approval and a source-trust decision
- risks and assumptions: display conversion must not overwrite source price or
  calculation provenance; unsupported schemes remain unknown rather than
  estimated; no automatic historical mutation
- acceptance: a reviewed design selects either an additive multi-currency
  contract or explicitly defers it; every proposed source/update path preserves
  provenance, reviewability, and deterministic recomputation semantics
- verification: design review, migration plan, and documentation consistency
  check; run pricing fixtures only for an explicitly selected and approved
  implementation path
- documentation: update model-configuration design, stats, architecture,
  README, Chinese overview, and roadmap

### T121 large-history Task workflow and detail virtualization

- status: planned
- estimated size/risk: medium / medium; it completes the bounded-data contract
  in surfaces that still rely on compatibility full-array responses
- purpose: keep Task linking and Session detail usable for large local history
  without loading every Session or rendering every event at once
- scope: replace Task workspace full Session loading with bounded discovery and
  search, virtualize or window large evidence/detail lists, preserve deep links
  and evidence coverage, and extend the representative scale benchmark with
  browser-facing and Task-workflow checks where reproducible
- dependencies: T83/T84 bounded contracts and T112 evidence navigation
- risks and assumptions: a smaller window must never be represented as complete
  evidence; compatibility endpoints remain explicit until a versioned removal
  plan exists
- acceptance: Task workspace uses bounded selection, detail lists have stable
  virtual/window behavior, selected evidence remains reachable, and performance
  budgets protect the revised paths without weakening coverage semantics
- verification: focused Web tests, production build, browser checks at desktop
  and mobile widths, scale benchmark extension, and response-size regression
  checks
- documentation: update performance, architecture, README, UI guidance, and
  roadmap

## Terminal Task Index

| Task | Title | Status |
| --- | --- | --- |
| [T123](roadmap-archive/2026-q3.md#t123) | embedded Session relationship navigation containment | completed |
| [T122](roadmap-archive/2026-q3.md#t122) | concise commit-message convention | completed |
| [T110](roadmap-archive/2026-q3.md#t110) | profile-evolution documentation and roadmap decomposition | completed |
| [T111](roadmap-archive/2026-q3.md#t111) | semantic-diagnosis consent, redaction, and audit boundary | completed |
| [T112](roadmap-archive/2026-q3.md#t112) | diagnosis-to-evidence navigation | completed |
| [T114](roadmap-archive/2026-q3.md#t114) | Outcome-evidence adapter contract | completed |
| [T115](roadmap-archive/2026-q3.md#t115) | Agent-consumable local reports and CLI workflow | completed |
| [T116](roadmap-archive/2026-q3.md#t116) | Runtime event protocol and local collector foundation | completed |
| [T113](roadmap-archive/2026-q3.md#t113) | Task discovery and local Outcome-assistance workflow | completed |
| [T109](roadmap-archive/2026-q3.md#t109) | unified Project Profile selector | completed |
| [T124](roadmap-archive/2026-q3.md#t124) | runtime-mode model-label classification | completed |
| [T125](roadmap-archive/2026-q3.md#t125) | rebase main and resolve upstream conflicts | completed |
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
| [T81](roadmap-archive/2026-q3.md#t81) | Cohort and Experiment definition workspace | completed |
| [T85](roadmap-archive/2026-q3.md#t85) | append-only JSONL import for Claude Code and Codex | completed |
| [T86](roadmap-archive/2026-q3.md#t86) | project-level cross-Session evidence | completed |
| [T89](roadmap-archive/2026-q3.md#t89) | comparable cohort/configuration Runtime Profile evaluation | completed |
| [T90](roadmap-archive/2026-q3.md#t90) | bounded verified post-run feedback | completed |
| [T87](roadmap-archive/2026-q3.md#t87) | source-native parent and child Session evidence | completed |
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

The completed T79/T82/T85/T87/T89/T90/T99/T100/T101-T105 work establishes the
current local evidence, bounded comparison, Model Catalog, and CLI foundations.
The next implementation order is intentionally trust- and evidence-first:

1. T111 and T112 establish the consent, redaction, audit, and
   finding-to-evidence boundaries.
2. T113 now provides local Task/Outcome candidates for explicit human review;
   T114 now provides one versioned Outcome-evidence producer contract and a
   read-only local Git adapter.
3. T115 now provides the content-free Agent-readable local report and explicit
   Outcome-write workflow on those contracts.
4. T116 now provides the local Runtime event protocol/collector; T117 may add
   bounded, opt-in in-run hints only after the event and Outcome contracts are
   stable.

T118 is a comparison-rigor track after T89 and the improved Task/Outcome
provenance; T119 is a multi-Agent graph/attribution track after T87 and explicit
Task links; T120 is an independent Model Catalog governance decision after
T99/T100; and T121 is an independent large-history UI/performance track after
T83/T84/T112. These tracks can be scheduled in parallel when their stated
contracts and review capacity are available. T88 remains independent and
conditional on an explicit decision to support non-local access. Mobile
dashboard navigation remains intentionally out of scope.

## Task Lifecycle

The detailed workflow is maintained in `../AGENTS.md`. The canonical transition is:

`planned` → `in_progress` → `completed`

`blocked` and `cancelled` are terminal alternatives when completion is not possible or no longer desired.

User authorization can be given by the request that starts the work; a second confirmation is required only when scope, risk, or external effects materially exceed that authorization. A task may be marked `completed` only after its implementation, affected documentation, and verification evidence have all been recorded.
