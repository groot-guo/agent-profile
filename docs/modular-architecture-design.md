# Modular Architecture Design

> Status: Proposal. This document defines a target module boundary and an
> incremental migration strategy. It does not describe current implemented
> behavior. Current behavior remains documented in `../ARCHITECTURE.md`.

## Purpose

Agent Profile should let a contributor change one product domain by reading:

1. the repository architecture and invariants;
2. that module's public contract and README;
3. that module's implementation and focused tests.

A contributor should not need to trace unrelated routes, database tables, Web
pages, or source adapters before making a bounded change. This design improves
local reasoning and verification without changing the local-first deployment
model, introducing microservices, or replacing Fastify, Next.js, Core, or
SQLite.

## Current pressure

The existing high-level dependency direction is sound:

```text
source adapters -> import coordinator -> Session repository -> SQLite
packages/core -> deterministic analysis and versioned reports
Fastify routes -> API -> Next.js UI
```

The pressure is inside the Server and Web application layers:

- several routes own SQL, application orchestration, aggregation, response
  construction, and external process calls together;
- mutable configuration routes use the default global database directly;
- Web pages define local response shapes and combine remote-data loading,
  navigation state, view-model calculation, and large presentation trees;
- one repository currently owns Task, Configuration, Outcome, Cohort,
  Experiment, and Task Profile queries;
- public behavior is documented, but individual domains do not yet have one
  enforced ownership and independent-test contract.

These are incremental modularity problems, not reasons for a whole-system
rewrite.

## Target dependency direction

```text
Web feature
  -> versioned contract
  -> Server module route
  -> application service
       -> Core pure calculation
       -> module repository
            -> SQLite
```

Allowed dependencies:

- `packages/core` may depend only on platform-neutral libraries and its own
  types. It must not import Server or Web code.
- `packages/contracts` contains versioned API schemas and serializable types. It
  must not depend on Fastify, React, SQLite, filesystem state, or a running
  service.
- a Server route depends on its contract and application service, not SQL.
- a Server service depends on explicit ports, repositories, and Core functions.
- a repository owns SQL for its domain and depends on the database connection.
- a Web feature depends on contracts and its own API client/view models. It does
  not import Server code or reproduce Server calculations.
- one module must not import another module's repository or query its tables.
  Cross-module needs use a small exported service/port.

Forbidden shortcuts:

- importing the default global `db` inside new module services or routes;
- sharing tables by convention without a declared owner;
- casting an unvalidated request body directly into repository parameters;
- importing one Web feature's internal component or state into another feature;
- adding a second implementation of a metric, model identity, Session scope, or
  coverage rule outside its owner.

## Proposed physical structure

```text
packages/
  core/
  contracts/
    src/
      common.ts
      model-catalog.ts
      sessions.ts
      tasks.ts
      comparisons.ts

apps/server/src/
  app.ts
  platform/
    database/
      connection.ts
      migrations/
  modules/
    ingestion/
    model-catalog/
    sessions/
    analytics/
    tasks/
    comparisons/

apps/web/
  app/
  features/
    model-catalog/
    sessions/
    analytics/
    tasks/
    comparisons/
```

This is a target layout, not a requirement to move every existing file in one
Task. A module moves only when a product Task already needs that boundary.

## Module contract

Every migrated module owns:

- `README.md` — responsibility, non-responsibility, public operations,
  dependencies, owned tables/endpoints, invariants, and test commands;
- `contract.ts` or a contract package export — versioned request/response
  schemas and serializable types;
- `repository.ts` — owned persistence and row mapping;
- `service.ts` — use-case orchestration and domain-policy application;
- `routes.ts` — validated transport adaptation only;
- focused unit, repository integration, route contract, and compatibility
  tests proportional to the module.

Every public report or multi-record response must state:

- schema version;
- scope and filters;
- coverage/unknown semantics where applicable;
- stable pagination/cursor semantics where applicable;
- limitations that affect interpretation.

## Initial module ownership

| Module | Owns | Does not own |
| --- | --- | --- |
| Ingestion | source availability, discovery, revision decisions, parsing orchestration, atomic replacement | Session browsing, model pricing policy, Task Outcomes |
| Model Catalog | raw/canonical model identity configuration, pricing schedules, context specifications, cost-recalculation application workflow | token extraction, Session filtering, diagnosis thresholds |
| Sessions | primary/all/child discovery scopes, Session annotations, bounded detail/evidence reads | source parsing, pricing edits, cross-Task experiment decisions |
| Analytics | Session/Agent/Project analytical read models and versioned reports | raw persistence mutation, configuration editing |
| Tasks | Task, Configuration Snapshot, Task-Session links, Outcome, Task Profile | cohort statistical conclusions |
| Comparisons | Cohort/Experiment definitions and future evidence-sufficient evaluation | source import, raw prompt persistence, automatic Runtime mutation |

`packages/core` remains the owner of pure formulas, normalized types,
deterministic diagnosis, and versioned report builders. A Server module owns how
stored data is loaded and supplied to those functions.

## Composition and dependency injection

The Server should expose an application factory:

```text
createApp({
  database,
  clock,
  sourceDefinitions,
  pricingResolver,
  modelContextResolver,
  gitEvidenceProvider
})
```

Production composition supplies the local SQLite database and filesystem-backed
providers. Tests supply in-memory SQLite, fixed clocks, and fake external
providers. Route registration must not require setting process environment
variables before dynamic imports merely to isolate a test.

The default `apps/server/src/index.ts` remains a thin production entry point:
construct dependencies, create the app, listen, start imports, and close
resources on shutdown.

## Persistence ownership and migrations

- SQLite remains one local database. Module ownership does not mean one database
  per module.
- every table and index has one owning module;
- cross-module foreign keys are allowed only when the lifecycle and reset
  contract is documented;
- migrations remain ordered, additive, idempotent, and covered by upgrade tests;
- a migration may create a new repository boundary without moving historical
  data when a compatibility adapter is sufficient;
- deleting `trace.db` is not an implementation migration.

Read-oriented indexes and projections belong to the module that defines the
query/report contract. They must not change metric meaning, coverage, or
source-evidence semantics.

## Web feature boundary

Each Web feature should separate:

```text
api.ts          typed remote operations
model.ts        view model and local state transitions
components/     presentation
*.test.ts       view-model and interaction tests
```

App Router pages compose features and URL state. They should not reimplement
metric formulas or retain a second unversioned copy of Server DTOs. Large
existing pages are split incrementally when their data contract changes; a
standalone visual rewrite is not required.

## Independent verification

A module is independently changeable only when a contributor can run:

1. Core or contract unit tests;
2. the module repository/service/route tests against in-memory SQLite;
3. affected Web feature tests with a fake API;
4. a compatibility test for existing public endpoints;
5. the root build and complete test command before Task completion.

The root `pnpm test` contract must include Web tests rather than relying on a
separate undocumented Vitest invocation. A lightweight dependency-boundary
check should reject forbidden cross-module imports.

## Incremental migration

1. Establish contracts, application construction, dependency rules, and test
   commands without changing product behavior.
2. Use Model Catalog as the first complete vertical module because its current
   API, tables, pure pricing function, and bounded UI scope are already known.
3. Apply the same pattern to bounded Session discovery and detail work in T83
   and T84 instead of first moving every existing Session route.
4. Split Task persistence when T80/T81 require the Outcome and comparison
   workspaces.
5. Do not migrate stable code only to make the directory tree visually uniform.

## Completion rule for implementation Tasks

A module Task is complete only when:

- ownership and allowed dependencies are documented;
- request and response schemas have runtime validation;
- repositories and external providers are injected;
- old endpoint behavior is either preserved or explicitly versioned;
- migration/backfill behavior is tested;
- focused module tests and root verification pass;
- current-state documentation is updated only for behavior that actually
  shipped.
