# Module README Template

Complex migrated Runtime modules may use this template when ownership, persistence, or public operations need local documentation. Small helpers do not require a README. Copy it beside the module implementation and fill only the relevant sections; the dependency boundary check remains mandatory for enforced boundaries.

---

# Module: <name>

## Responsibility

One-paragraph description of what this module does and does not do.

## Public operations

List the exported route registrars, service functions, or contract types
that other modules or the Web may depend on. Include the schema version
for each public response.

## Owned resources

| Resource | Type | Notes |
| --- | --- | --- |
| `<table>` | SQLite table | migration version, reset contract |
| `/<endpoint>` | API route | request/response contract version |

## Allowed dependencies

- `@agent-profile/core` — pure calculations and types
- `@agent-profile/contracts` — versioned API schemas
- `<other module>` — only through its exported service/port

## Forbidden

- Mutating another module's owned tables; analytical cross-table reads require a declared read repository
- Importing a production database or import-job singleton inside commands, services, or routes
- Casting unvalidated request bodies into repository parameters
- Duplicating a metric, model identity, or coverage rule owned elsewhere

## Test commands

```bash
# Focused module tests with in-memory SQLite
pnpm --filter trace-server test -- <pattern>

# Full verification
pnpm build && pnpm test
```

## Invariants

List module-specific invariants that must not change accidentally.
