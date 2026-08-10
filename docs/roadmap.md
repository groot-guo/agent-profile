# Roadmap & Task Register

This file is the authoritative register for active and planned work. Terminal Task bodies and verification evidence are stored in the linked archive; use `pnpm check:roadmap` after changing either location.

The normal lifecycle is `planned` → `in_progress` → `completed`; `blocked` and `cancelled` are terminal alternatives. Repository-wide workflow rules remain in [../AGENTS.md](../AGENTS.md).

## Active and Planned Tasks

### T135 model observation, identity review, and billing eligibility

- status: planned
- purpose: separate raw source model labels from verified billable identities
  so the Model Catalog does not present opaque, provider-only, runtime, or
  synthetic labels as ordinary configurable models.
- scope:
  1. introduce a source-preserving model-observation/review contract with raw
     label, source kind/field, observed Span and Session coverage, token
     coverage, identity classification, review provenance, and billing
     eligibility;
  2. classify `<synthetic>` as a non-billable synthetic placeholder,
     `big-pickle` as a provider-managed route pending tariff evidence, and
     `astron-code-latest` as an opaque rolling source label pending explicit
     verification; retain all raw values and evidence;
  3. reuse and extend the existing statistics identity rules in the Model
     Catalog rather than letting the settings page enumerate unqualified raw
     labels as price-edit candidates;
  4. prevent provider-only fallbacks from being represented as concrete model
     identities and prohibit automatic name-similarity aliases.
- dependencies: T134 for reliable source-field and coverage evidence.
- risks and assumptions: a canonical display identity, a pricing alias, a
  context-window equivalence, and a billing identity are separate claims. A
  rolling `*-latest` label cannot receive a timeless underlying-model alias.
- acceptance: the catalog visibly separates billable, review-required, and
  excluded source labels; only explicit, auditable evidence can enable pricing
  or context configuration; statistics retain raw-label inspectability.
- verification plan: core identity tests, Server inventory/API tests, migration
  tests for legacy labels, and focused Web tests for the three catalog groups.
- documentation plan: update ARCHITECTURE, `docs/stats.md`,
  `docs/profile-model.md`, and the Task archive.

### T136 evidence-safe pricing status and time-effective schedules

- status: planned
- purpose: ensure cost is only represented as known when source token coverage
  and a verified provider/route/model price schedule both apply at the Span
  time.
- scope:
  1. distinguish known cost, unknown pricing, unverified provider route,
     token usage not captured, unsupported scheme, and excluded synthetic data
     in persisted and API-visible cost status;
  2. preserve the four-token-class formula and CNY-only contract while making
     price applicability provider/route-aware where the source can establish
     it;
  3. require explicit, time-effective and source-referenced schedules for
     rolling or gateway labels; do not map `astron-code-latest` or
     `big-pickle` to an assumed underlying model;
  4. retire the active zero-price `<synthetic>` seed safely, with an additive
     migration/backfill that never treats missing data as free usage;
  5. expose known subtotal, unknown/excluded coverage, pricing model, effective
     time, calculation time, and calculator version without presenting a
     partial subtotal as a trusted total.
- dependencies: T134 and T135.
- risks and assumptions: a price of zero is valid only with an explicit,
  time-bounded provider tariff; subscription fees and unknown routing must not
  be invented from token records.
- acceptance: unknown or incomplete evidence cannot render as `¥0`, a zero
  cost, or a complete comparison input; all four token classes remain separate;
  historical pricing provenance remains inspectable.
- verification plan: core pricing matrix tests, Server lookup/migration tests,
  regression tests for synthetic/opaque/provider-route labels, and API
  assertions for partial-cost presentation.
- documentation plan: update ARCHITECTURE, `docs/stats.md`,
  `docs/diagnosis.md`, README configuration guidance, and the Task archive.

### T137 previewed historical cost recalculation and dependent-data refresh

- status: planned
- purpose: make approved price changes propagate safely from matching LLM Spans
  to Session, Project, Profile, and comparison reads without stale Web state or
  accidental broad recalculation.
- scope:
  1. keep Preview read-only and bind Execute to the reviewed pricing revision,
     precise billing identity, and optional time range;
  2. transactionally update matching Span cost provenance and recompute every
     affected Session from all of its LLM turns, preserving unknown/excluded
     coverage;
  3. record a bounded recalculation audit with before/after coverage and
     affected scope, without storing source content;
  4. publish an application data-version/session-update signal after execution
     so open discovery, statistics, Profile, and detail surfaces refetch;
  5. make full-dataset recalculation a separately confirmed action rather than
     an implicit side effect of saving a price revision.
- dependencies: T136.
- risks and assumptions: recalculation never changes tokens, context evidence,
  source model strings, or Session relationships. Scoped runs must not reset
  unrelated Sessions, and a failed run must leave all aggregates unchanged.
- acceptance: Preview and Execute report the same deterministic scope; visible
  aggregates refresh after a successful run; a Session with mixed known and
  unknown turns retains both its known subtotal and incomplete-coverage status.
- verification plan: Server transaction/rollback tests, mixed-model Session
  tests, update-event tests, focused Web refresh tests, and a scale regression
  check for bounded result payloads.
- documentation plan: update ARCHITECTURE, `docs/performance.md`,
  `docs/stats.md`, and the Task archive.

### T138 server-only semantic Provider configuration and safe LLM analysis

- status: planned
- purpose: make optional semantic/whole-analysis capabilities honestly
  configurable and safely unavailable when no Provider is configured.
- scope:
  1. define a server-only local secret-storage contract for Provider keys;
     never persist plaintext keys in browser state, localStorage, trace.db,
     logs, exports, or source files;
  2. add a non-secret configuration/status API and local UI that exposes
     Provider, endpoint host/locality disclosure, model, configuration source,
     test status, and restart/reload requirements without revealing the key;
  3. require an explicit Provider and endpoint choice rather than silently
     falling back to a remote default; retain request-scoped consent and the
     bounded/redacted payload contract;
  4. make current and future LLM-assisted analysis entry points show
     `not_configured`, `configured`, `consent_required`, `running`, `completed`,
     or `failed` before any payload is sent;
  5. suppress semantic conclusions when the structural evidence required for
     the claim is not captured, and report evidence insufficiency instead.
- dependencies: T134 for coverage states; the secret-storage mechanism needs
  an explicit local-operation decision before implementation.
- risks and assumptions: LLM inference cannot repair missing telemetry or prove
  causality. No Provider call may occur merely because a key is present.
- acceptance: an unconfigured user receives a clear local setup path before
  clicking Run; no secret reaches the browser or repository; every Provider
  call remains explicitly consented, bounded, redacted, and auditable without
  raw payload retention.
- verification plan: configuration route/unit tests, secret non-disclosure
  checks, consent/payload tests, local UI states, and a no-key/no-network smoke
  test.
- documentation plan: update README, ARCHITECTURE, `docs/diagnosis.md`,
  `docs/profile-model.md`, and the Task archive.

### T139 cross-filtered Project and Agent discovery facets

- status: planned
- purpose: make Project and Agent/IDE filters communicate their real
  intersection instead of showing global counts that imply the wrong scope.
- scope:
  1. calculate Agent facets with all active filters except the Agent dimension,
     and Project facets with all active filters except the Project dimension;
  2. retain time, text, quick-view, source-availability, and primary-Session
     predicates in both facet calculations;
  3. align list, selected Session, URL state, count labels, empty states, and
     facet controls with the same query contract;
  4. keep filters bounded and indexed, with no client-side full-history
     reconstruction.
- dependencies: none; sequence after T134/T140 only if the same Web surfaces
  would otherwise conflict.
- risks and assumptions: a facet count is a scope statement, not a global
  popularity measure. A selected dimension must not hide a zero-result state.
- acceptance: choosing `agent-profile` and Codex shows the actual intersection
  everywhere; switching either filter updates the other facet's counts and
  available choices deterministically.
- verification plan: discovery-service query tests, Web navigation tests, API
  contract assertions, desktop/narrow-width manual checks, and scale query-plan
  validation.
- documentation plan: update ARCHITECTURE, relevant README/UI guidance, and
  the Task archive.

### T140 evidence-safe Session detail absence states

- status: planned
- purpose: replace misleading zero metrics and generic empty panels with clear,
  source-faithful availability states in Session detail.
- scope:
  1. distinguish no LLM turn, token usage not captured, model not captured,
     context-window specification unavailable, source parser truncation, and
     child Session parent availability;
  2. render unavailable values as unavailable, omit non-comparable efficiency
     or cost conclusions, and retain a bounded link to the relevant evidence or
     parent Session when source data supports it;
  3. prevent a parent/child relationship from being presented as merged context
     or aggregate cost;
  4. align overview, context, cost, diagnostics, export, and evidence panels
     on the same coverage reason.
- dependencies: T134; cost-specific states depend on T136.
- risks and assumptions: source evidence must remain content-free by default;
  an empty chart is not proof of zero usage, no cost, or a completed Session.
- acceptance: the reported `019fd61d` case is explainable from its stored
  source evidence; users can distinguish unavailable telemetry from a genuine
  zero; no panel contradicts another panel's coverage state.
- verification plan: focused detail/coverage tests, source-relationship tests,
  exported-report assertions, and desktop/narrow-width visual checks.
- documentation plan: update ARCHITECTURE, `docs/diagnosis.md`,
  `docs/profile-model.md`, and the Task archive.

## Terminal Task Index

| Task | Title | Status |
| --- | --- | --- |
| [T134](roadmap-archive/2026-q3.md#t134) | source telemetry coverage and Session-relationship integrity | completed |
| [T133](roadmap-archive/2026-q3.md#t133) | evidence-safe remediation task decomposition | completed |
| [T119](roadmap-archive/2026-q3.md#t119) | multi-Agent Task graph and non-double-counted attribution | completed |
| [T121](roadmap-archive/2026-q3.md#t121) | large-history Task workflow and detail virtualization | completed |
| [T131](roadmap-archive/2026-q3.md#t131) | domain cohesion and responsibility convergence | completed |
| [T132](roadmap-archive/2026-q3.md#t132) | continuous integration and smoke E2E baseline | completed |
| [T130](roadmap-archive/2026-q3.md#t130) | HTTP contract and module-boundary governance | completed |
| [T88](roadmap-archive/2026-q3.md#t88) | enforce the loopback-only product boundary | completed |
| [T128](roadmap-archive/2026-q3.md#t128) | architecture documentation reconciliation | completed |
| [T120](roadmap-archive/2026-q3.md#t120) | Model Catalog governance and multi-currency design | cancelled |
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

### Current planned sequence

The evidence-correctness programme remains local-first and CNY-only. It does
not revive T120's cancelled multi-currency/remote-governance scope, infer model
identities, or create a new top-level service.

1. **P0 — establish source truth:** T134 establishes telemetry and relationship
   coverage. T135 then separates raw observations from reviewed billing
   eligibility.
2. **P0 — repair monetary correctness:** T136 adds explicit cost/token coverage
   status and time-effective schedules. T137 alone may apply reviewed historical
   recalculations and publish dependent-data refreshes.
3. **P0 — make optional LLM analysis operable:** T138 adds server-only Provider
   configuration and clear availability/consent states; it cannot use an LLM to
   invent missing source evidence.
4. **P1 — repair presentation after evidence contracts exist:** T140 makes
   Session absence states trustworthy. T139 is independent but follows the
   high-risk data work to avoid overlapping Home/Session UI churn.

No Task may convert `not_captured`, unknown pricing, provider-only, opaque,
synthetic, or runtime-mode evidence into a numerical zero, a concrete model,
or a complete comparison result. Raw source evidence remains retained and
inspectable throughout.

### Completed baseline context

The current system is one local-first modular application in a monorepo. The
CLI is the unified user entry and process orchestrator; Web, local API, Core,
Contracts, and SQLite are internal components rather than independently
deployed microservices. The adjustment programme is split into decision,
governance, maintainability, and product-evolution tracks so architecture
cleanup does not silently expand product scope or create more fragmentation.

1. **P0 — enforce the settled security boundary:** T88 applies the already
   selected loopback-only decision to the remaining source-workspace Server
   startup path; it is implementation work, not another product decision.
2. **P1 — harden module contracts:** T130 centralizes public DTO ownership,
   runtime request validation, and dependency-direction checks.
3. **P1 — address scale and cohesion separately:** T121 owns bounded
   discovery/detail virtualization; T131 owns responsibility convergence inside
   the existing top-level boundaries. Sequence overlapping Web files instead of
   combining both risks in one change.
4. **P2 — establish regression gates:** T132 adds CI; Playwright smoke coverage
   is included only if approved as a maintained project dependency.
5. **P2 — extend evidence semantics:** T119 completed the explicit multi-Agent
   Task graph/resource attribution in `task-profile/v1` without inferred
   relationships or double counting.

The loopback-only security choice is settled: non-local access is outside the
product boundary and T88 only closes the remaining source-workspace Server
escape hatch. T120 is cancelled because no current consumer requires
multi-currency or remote price governance; the existing CNY-only,
provenance-preserving Model Catalog contract remains current. T132 may be
prepared alongside T130 but should land after the intended checks are stable.
T119 was completed separately from T121/T131 because each changes a different
high-risk evidence or UI boundary. Mobile dashboard navigation remains out of
scope. No current Task proposes microservice extraction or a new top-level
package; such a change would require a separate evidence-backed architecture
decision.

## Task Lifecycle

The detailed workflow is maintained in `../AGENTS.md`. The canonical transition is:

`planned` → `in_progress` → `completed`

`blocked` and `cancelled` are terminal alternatives when completion is not possible or no longer desired.

User authorization can be given by the request that starts the work; a second confirmation is required only when scope, risk, or external effects materially exceed that authorization. A task may be marked `completed` only after its implementation, affected documentation, and verification evidence have all been recorded.
