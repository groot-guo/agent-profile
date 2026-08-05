# Roadmap & Task Register

This file is the authoritative register for active and planned work. Terminal Task bodies and verification evidence are stored in the linked archive; use `pnpm check:roadmap` after changing either location.

The normal lifecycle is `planned` → `in_progress` → `completed`; `blocked` and `cancelled` are terminal alternatives. Repository-wide workflow rules remain in [../AGENTS.md](../AGENTS.md).

## Active and Planned Tasks

### T128 architecture documentation reconciliation

- status: planned
- estimated size/risk: medium / low
- purpose: reconcile current-state documentation and provide one prioritized set
  of architecture views that clearly separates implemented behavior from
  proposed work
- scope: remove duplicated/stale claims in README, ARCHITECTURE, profile-model,
  Chinese overview, and roadmap; add system, module, ingestion, evidence,
  Task/Outcome/Experiment, feedback, deployment-security, and multi-agent views
- documentation work packages:
  1. `README.md` and `docs/zh/OVERVIEW.md`: align product positioning,
     implemented CLI commands, local startup, supported sources, safety
     boundary, limitations, and document navigation in both languages.
  2. `ARCHITECTURE.md`: become the single current-state technical map; remove
     duplicate contracts and stale future-work claims; document composition,
     storage, HTTP/runtime boundaries, ingestion, Profile layers, operations,
     and known limitations without copying proposal-only designs.
  3. `docs/profile-model.md`: deduplicate and normalize Session Evidence, Agent
     Process Profile, Project Profile, Task Profile, Cohort Runtime Profile,
     Outcome, coverage, and causal-claim terminology.
  4. `docs/diagnosis.md`, `docs/multi-agent.md`, and `docs/stats.md`: reconcile
     focused behavior with the canonical architecture and Profile vocabulary;
     keep source-observed relationships distinct from inferred relationships.
  5. `docs/performance.md`: connect T121 browser/Task-workflow budgets to the
     existing content-free scale fixture and state what is not measured.
  6. Model Catalog/configuration documentation: record current CNY pricing,
     provenance, recalculation, and unknown-price behavior; link T120 decisions
     without presenting multi-currency or network updates as implemented.
  7. `docs/profile-evolution-plan.md` and
     `docs/agent-runtime-profile-design.md`: retain proposal status, update
     dependency links, and explicitly separate the target Runtime Profile from
     implemented bounded reports and feedback.
  8. `docs/roadmap.md` and terminal archives: keep only active/planned work in
     the register, preserve immutable completion evidence, and ensure execution
     order contains no already-completed next steps.
- architecture view checklist:
  1. system context: local user, one Agent Profile application, source histories,
     and optional explicitly consented semantic provider;
  2. runtime composition: single `agent-profile` CLI entry orchestrating local
     API, Web UI, application Runtime, and SQLite;
  3. monorepo dependency direction: Web/CLI/Server, Contracts, Core, and
     infrastructure ownership without implying independent services;
  4. ingestion sequence: Scanner -> Source Adapter -> Import Coordinator ->
     Session Repository, including revision and atomic replacement rules;
  5. evidence/Profile layers: Span -> Session Evidence -> Agent Process Profile
     -> Project/Task Profile -> bounded Cohort Runtime Profile;
  6. Task data model: Task, explicit Session links, configuration snapshots,
     Outcome evidence, Cohort, and Experiment;
  7. feedback flow: runtime events, bounded hints, suppression/adoption records,
     opt-in/read-only boundaries, and unimplemented automation markers;
  8. deployment/security boundary: loopback default, local files/database,
     optional provider egress, and the unresolved T88 non-local decision;
  9. multi-agent evidence: current source-native parent/child evidence versus
     proposed T119 Task graph and resource attribution.
- consistency rules: every view must carry a current/proposed legend; use one
  canonical term per Profile layer; link detailed contracts instead of
  duplicating them; distinguish product CLI commands from `pnpm` development
  commands and repository `.mjs` maintenance checks
- architecture direction: describe Agent Profile as one local-first modular
  desktop/server application in a monorepo: CLI is the unified user entry and
  process orchestrator; Web and API are internal application components; Core,
  Contracts, and SQLite provide shared logic, protocol ownership, and storage
- constraints: this Task does not introduce microservices, service discovery,
  message queues, independently owned databases, or new top-level packages;
  repository maintenance scripts such as `check-roadmap.mjs` must be clearly
  separated from the product CLI and runtime architecture
- decisions: proposed capabilities are labelled and do not become current-state
  claims; diagrams emphasize product cohesion as well as dependency boundaries
- acceptance: diagrams agree with implementation and terminology; completed
  CLI/runtime work is not described as future; execution order lists only open
  work; each document above has an explicit owner, current/proposed boundary,
  and cross-link; no diagram implies microservices or multiple product CLIs
- verification: documentation consistency review and `pnpm check:roadmap`
- documentation: README, ARCHITECTURE, docs/profile-model.md,
  docs/zh/OVERVIEW.md, and this register

### T130 HTTP contract and module-boundary governance

- status: planned
- estimated size/risk: medium / medium
- purpose: make shared DTO ownership and runtime request validation explicit
  across Web, Server, CLI, and Contracts
- scope: move duplicate public Web DTOs to `@agent-profile/contracts`, add
  bounded runtime validation to mutation routes, and extend the architecture
  boundary checker for prohibited cross-layer dependencies
- acceptance: public API shapes have one owner; malformed mutation payloads
  fail predictably; boundary checks cover the intended dependency direction
  within the single local application
- verification: focused tests, `pnpm check:boundaries`, lint, and build
- documentation: ARCHITECTURE and roadmap

### T131 domain cohesion and responsibility convergence

- status: planned
- estimated size/risk: large / medium
- purpose: improve cohesion where responsibilities are either duplicated across
  modules or concentrated in oversized orchestration files, without making the
  repository more fragmented
- scope: preserve the existing `apps/web`, `apps/server`, `packages/cli`,
  `packages/core`, and `packages/contracts` top-level boundaries; organize
  Server internals around existing capabilities, keep Web page data/state/view
  responsibilities together in feature-local modules, and split CLI commands
  behind the single `agent-profile` entry point
- dependencies: T128 establishes target module views; T130 defines DTO
  ownership before Web API modules are extracted; T121 may run in parallel only
  where file ownership does not overlap
- implementation rule: do not create a file solely to satisfy a line-count
  target; extract only a stable responsibility with a clear caller and owner;
  do not create additional shared packages for feature-local code
- acceptance: duplicated concepts have one owner; extracted units improve
  cohesion and have focused tests; CLI remains one command; priority files move
  toward the 800-line guideline; remaining exceptions are recorded with
  rationale and follow-up scope
- verification: focused Web/Server/CLI tests, production build, lint, and scale
  checks
- documentation: performance, architecture, README, UI guidance, and roadmap

### T132 continuous integration and smoke E2E baseline

- status: planned
- estimated size/risk: medium / medium
- purpose: continuously verify the repository's supported local workflow and
  catch integration regressions that unit tests and builds miss
- scope: GitHub Actions for lint/test/build/roadmap/boundaries plus a bounded
  Playwright smoke covering health and primary Web navigation
- acceptance: CI is deterministic, content-free, and documented; smoke tests
  run against disposable local data and fail with actionable diagnostics
- verification: workflow/schema review and local Playwright smoke where the
  environment supports browser installation
- documentation: README, architecture/operations guidance, and roadmap

### T88 conditional non-local access safety

- status: planned
- estimated size/risk: large / high and conditional; actual size depends on the
  deployment and identity model selected by a future product decision
- purpose: define and implement authentication, directory authorization,
  backup/export, and threat-model controls only if the product is intentionally
  exposed beyond the local trusted-machine use case
- dependency: an explicit user/product decision to support non-loopback access
- decision gate: choose one before implementation: (A) enforce loopback-only in
  every Server/CLI startup path, or (B) support non-loopback access only after
  an authenticated deployment threat model is approved; option A is the
  recommended near-term boundary
- scope: threat model first; then narrow authentication/authorization, safe
  origin/export controls, operational recovery guidance, and security tests as
  required by the chosen deployment model
- acceptance: no default loopback workflow regresses; no remote exposure is
  documented or enabled without an agreed threat model and tested controls
- verification: security design review, negative authorization tests, deployment
  smoke checks, and updated operational documentation
- documentation: update configuration, privacy, architecture, README, and
  roadmap only after a concrete deployment decision

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
- decision gate: choose one before implementation: (A) complete governance
  design and retain the current CNY-only runtime contract, or (B) include an
  additive multi-currency implementation and migration in the current scope;
  option A is recommended until a concrete consumer requires another currency
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
| [T126](roadmap-archive/2026-q3.md#t126) | persistent code-review workflow rules | completed |
| [T127](roadmap-archive/2026-q3.md#t127) | explicit push ownership and descriptive commit bodies | completed |
| [T123](roadmap-archive/2026-q3.md#t123) | embedded Session relationship navigation containment | completed |
| [T122](roadmap-archive/2026-q3.md#t122) | concise commit-message convention | completed |
| [T110](roadmap-archive/2026-q3.md#t110) | profile-evolution documentation and roadmap decomposition | completed |
| [T111](roadmap-archive/2026-q3.md#t111) | semantic-diagnosis consent, redaction, and audit boundary | completed |
| [T112](roadmap-archive/2026-q3.md#t112) | diagnosis-to-evidence navigation | completed |
| [T114](roadmap-archive/2026-q3.md#t114) | Outcome-evidence adapter contract | completed |
| [T115](roadmap-archive/2026-q3.md#t115) | Agent-consumable local reports and CLI workflow | completed |
| [T116](roadmap-archive/2026-q3.md#t116) | Runtime event protocol and local collector foundation | completed |
| [T117](roadmap-archive/2026-q3.md#t117) | bounded in-run feedback and policy guardrails | completed |
| [T118](roadmap-archive/2026-q3.md#t118) | comparable-cohort and regression-evidence rigor | completed |
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

The current system is one local-first modular application in a monorepo. The
CLI is the unified user entry and process orchestrator; Web, local API, Core,
Contracts, and SQLite are internal components rather than independently
deployed microservices. The adjustment programme is split into decision,
governance, maintainability, and product-evolution tracks so architecture
cleanup does not silently expand product scope or create more fragmentation.

1. **P0 — reconcile the source of truth:** T128 updates current-state wording
   and architecture views. It is documentation-only and precedes architectural
   implementation so later Tasks have an agreed boundary map.
2. **P0 — close the security decision:** T88 selects loopback-only operation
   (recommended) or an authenticated non-local deployment. No network behavior
   should change until that decision is recorded.
3. **P1 — harden module contracts:** T130 centralizes public DTO ownership,
   runtime request validation, and dependency-direction checks.
4. **P1 — address scale and cohesion separately:** T121 owns bounded
   discovery/detail virtualization; T131 owns responsibility convergence inside
   the existing top-level boundaries. Sequence overlapping Web files instead of
   combining both risks in one change.
5. **P2 — establish regression gates:** T132 adds CI; Playwright smoke coverage
   is included only if approved as a maintained project dependency.
6. **P2 — extend evidence semantics:** T119 follows the stabilized contracts
   and adds the explicit multi-Agent Task graph/resource attribution without
   inferred relationships or double counting.
7. **P3 — govern pricing evolution:** T120 records the price-source and currency
   policy first; multi-currency implementation remains conditional on that
   decision.

T128 and the design-only part of T120 may proceed in parallel. T132 may be
prepared alongside T130 but should land after the intended checks are stable.
T119 should not be combined with T121/T131 because each changes a different
high-risk evidence or UI boundary. Mobile dashboard navigation remains out of
scope. No current Task proposes microservice extraction or a new top-level
package; such a change would require a separate evidence-backed architecture
decision.

## Task Lifecycle

The detailed workflow is maintained in `../AGENTS.md`. The canonical transition is:

`planned` → `in_progress` → `completed`

`blocked` and `cancelled` are terminal alternatives when completion is not possible or no longer desired.

User authorization can be given by the request that starts the work; a second confirmation is required only when scope, risk, or external effects materially exceed that authorization. A task may be marked `completed` only after its implementation, affected documentation, and verification evidence have all been recorded.
