# Model Configuration Design

> Status: current implementation. T99 implemented the Model Catalog,
> pricing/context, alias, import/export, and recalculation contracts; T100
> implemented the `/settings/models` Web workspace. T120 was cancelled because
> no current consumer requires multi-currency or remote-price behavior. Any such
> expansion requires a new Task with a concrete consumer and migration design.

## Current foundation

The current implementation already provides:

- an exact raw-model pricing lookup;
- four separate token price classes: input, cache creation, cache read, and
  output;
- time-aware pricing rows selected at the LLM Span start time;
- CNY-per-million-token calculation;
- explicit unknown pricing instead of a trusted estimate;
- mutable pricing and model-context APIs with runtime request validation;
- an explicit full stored-cost recomputation endpoint;
- startup seeds that use `INSERT OR IGNORE`, preserving existing user rows.

The implemented product layer is a separately owned configuration module with
provenance, history, safe edits, impact preview, independent tests, and a Web
workspace. The current contract intentionally remains local, CNY-only, and
manually governed.

## Goals

- let users configure observed model prices and context specifications locally;
- preserve historical price applicability and calculation provenance;
- make bundled defaults distinguishable from user-controlled records;
- make unsupported or incomplete pricing visibly unknown;
- let users preview and explicitly execute recalculation;
- keep raw source model identity and stored source evidence unchanged;
- expose one versioned contract to Server and Web consumers.

## Non-goals

- automatically scrape or trust remote vendor pricing;
- infer a concrete model or price from a provider-only label;
- convert statistical display aliases into pricing aliases;
- automatically mutate historical costs when configuration changes;
- support every provider's tiered, batch, regional, or promotional pricing in
  the current contract;
- merge diagnosis thresholds, Agent Configuration Snapshots, and model reference
  data into one generic settings table.

## Configuration taxonomy

| Configuration | Meaning | History requirement |
| --- | --- | --- |
| Model identity | Raw observed identifier, optional canonical display identity, provider | Preserve raw identity; aliases must be explicit |
| Pricing schedule | Four token prices, currency/unit, applicability time and source | Time-aware and revision-aware |
| Context specification | Configured model context-window limit and source | Preserve provenance and user override |
| Analysis policy | Diagnosis thresholds and score settings | Separate versioned policy; not Model Catalog data |
| Configuration Snapshot | Agent/model/rules/tool/prompt version used for one Task | Existing Task evidence; not mutable model reference data |

## Identity and pricing resolution

The pricing resolver receives:

```text
raw model identifier
LLM Span start time
```

Resolution order:

1. an active exact raw-model pricing schedule applicable at the Span time;
2. an explicitly configured alias marked `pricingEquivalent=true`, followed by
   an applicable target-model schedule;
3. unknown pricing.

The resolver must never:

- use a provider-only value such as `openai` as a concrete model;
- apply a price because two names look similar;
- reuse a presentation/statistics alias unless pricing equivalence was
  explicitly configured;
- replace the raw model stored on the Span.

When an explicit pricing alias is used, cost provenance retains the selected
pricing key/revision so a user can see that the raw model and pricing record
were different identifiers.

## Pricing schedule

The stable contract contains:

```text
id
modelKey
inputPrice
cacheCreationPrice
cacheReadPrice
outputPrice
currency
unit
effectiveFrom
sourceKind
sourceReference
revision
status
createdAt
supersededAt
```

Initial supported values remain:

```text
currency = CNY
unit = per_million_tokens
scheme = flat_four_token_classes
```

Time is stored as an epoch millisecond and interpreted as UTC. The applicable
record is the latest active schedule whose `effectiveFrom` is no later than the
Span start time.

Existing historical schedules should not be physically deleted through the
normal UI. A correction either supersedes a record or creates a new revision.
An implementation may retain the current composite lookup during migration,
but it must expose a stable pricing revision before claiming complete
reproducibility after edits.

## Currency and source provenance

The current implementation calculates stored costs in CNY per million tokens.
It does not fetch provider prices, convert currencies, or claim reproducibility
for an unrecorded exchange rate. Multi-currency and remote price collection are
not planned current work; either would require a new explicit Task.

A user may enter a CNY price directly. If later work supports prices copied from
a different currency, the stored record must retain:

- original currency and original values;
- conversion rate;
- conversion-rate source;
- conversion effective time;
- calculated CNY values.

Without those fields, the UI must require CNY input and must not claim that an
unrecorded conversion is reproducible.

`sourceKind` distinguishes:

- `bundled` — repository-shipped reference data;
- `manual` — a local user entry;
- `imported` — an explicitly imported local configuration file.

Bundled data must carry an audit date and source reference. Startup or upgrade
may add new bundled records but must not overwrite a user record with the same
applicability key.

## Unsupported pricing schemes

Some providers may use long-context tiers, batch discounts, regional pricing,
cache-duration variants, or other conditions not represented by four flat
rates.

The current implementation declares its supported scheme. If an observed
model requires an unsupported condition:

- the record is not silently flattened into a trusted price;
- affected cost remains unknown or explicitly partial;
- the API/UI states the unsupported condition;
- later schema work may add a versioned conditional pricing scheme.

Unknown and partial pricing must remain distinct from zero cost.

## Context specification

A context specification contains:

```text
modelKey
contextWindow
sourceKind
sourceReference
auditedAt
revision
userOverride
```

It is configured reference data, not source-observed runtime evidence. Missing
context specification remains unknown; the system must not guess a limit from a
model family or provider.

Pricing and context records may share the Model Catalog UI and identity key,
but they remain separate repository operations and coverage fields.

## Observed-model inventory

The workspace exposes raw model identifiers observed in stored LLM Spans,
including:

- priced and unpriced status;
- exact applicable price at a selected time;
- number of affected primary Sessions and LLM Spans;
- latest observed time;
- model-identity classification;
- context-specification coverage.

This inventory is a read model. It does not rewrite source evidence or
automatically create aliases.

## Cost recalculation

Changing a pricing schedule does not automatically mutate stored Span or
Session costs. Recalculation is an explicit two-step operation.

### Preview

Input scope:

```text
all models | selected raw models
optional start/end time
pricing configuration revision
```

Preview returns:

- matching LLM Spans and Sessions;
- currently known/unknown cost counts;
- projected known/unknown cost counts;
- affected currencies/calculator versions;
- unsupported or ambiguous pricing reasons;
- no stored mutation.

### Execute

Execution must use the same normalized scope and pricing configuration revision
returned by preview. It runs transactionally, recalculates each LLM Span using
its start time, and rebuilds affected Session totals from those Span results.

A recalculation run records:

```text
id
scope
pricingRevision
calculatorVersion
previewedAt
executedAt
updatedSpans
updatedSessions
unknownBefore
unknownAfter
status
```

The existing `/api/recompute-cost` endpoint remains a compatibility operation
and delegates to the same transactional service as versioned preview/execute.

## Diagnosis semantics

Stored Span and Session cost uses the price effective at each LLM Span time.
Estimated diagnosis waste must declare one of two policies:

- historical estimate — use the relevant evidence Span time; or
- current planning estimate — use the price effective now.

The policy and applicable price time must be explicit in the report. T71 owns
the audit and decision; implementation must not silently mix the two semantics.

## Implemented Server API

The versioned module contract exposes:

```text
GET  /api/model-catalog/models
GET  /api/model-catalog/models/:key/pricing
POST /api/model-catalog/models/:key/pricing
GET  /api/model-catalog/models/:key/context
PUT  /api/model-catalog/models/:key/context
PUT  /api/model-catalog/models/:key/pricing-alias
POST /api/model-catalog/recalculation/preview
POST /api/model-catalog/recalculation/execute
GET  /api/model-catalog/configuration
POST /api/model-catalog/configuration
```

Responses and configuration files carry `model-catalog/v1`. The existing
pricing, model-context, and recomputation endpoints are compatibility adapters
over the same service rather than separate SQL implementations.

## Web workspace

The implemented `/settings/models` workspace consumes only the public
`model-catalog/v1` contract and includes:

- observed unpriced models first;
- model identity, source coverage, and latest observation;
- current and historical pricing schedules;
- four-token-class price editor with applicability time and provenance;
- context specification editor;
- recalculation preview, explicit confirmation, progress/result, and recovery
  guidance;
- unsupported-pricing and unknown-data explanations.

The selected exact raw-model identity is deep-linked in the URL. Saving a price
or context record reports success but never starts recalculation implicitly.

Preview is read-only; execute remains disabled until explicit confirmation and
is rejected when the pricing revision changes. Versioned JSON export/import is
local and content-free. The workspace must not call an edit a historical provider
invoice. It manages the local calculator's reference data.

## Price governance boundary

The current CNY-only contract preserves source, effective time, calculation
time, and calculator version. Automatic scraping, silent conversion, and
unreviewed overwrite of local pricing records are out of scope. A future
expansion must begin with a concrete consumer and an additive migration design;
the cancelled T120 is not a standing placeholder for speculative work.

## Import, export, reset, and privacy

- Model Catalog configuration can be exported/imported as a versioned local JSON
  document without Session or prompt content.
- The entire imported payload is validated before mutation. Applicability-key
  conflicts create an imported pricing revision and retain the superseded
  history; they do not overwrite history in place.
- generated-data reset continues preserving pricing, context configuration,
  migration history, and recalculation audit records unless a future Task
  deliberately changes that contract;
- no remote pricing synchronization is enabled by default;
- source references must not contain credentials or copied prompt content.

## Migration and compatibility

- use ordered additive migrations and an upgrade test from the current schema;
- preserve current pricing and model-context rows;
- identify existing startup seeds as bundled reference data where possible;
- preserve exact raw-model lookup and current cost values through extraction;
- keep old endpoints functional until compatibility tests prove equivalent
  behavior;
- do not require source re-import or database deletion.

## Verification

Verification expectations for future changes:

- Core calculation and resolver tests for all four token classes, exact/alias/
  unknown lookup, effective times, unsupported schemes, and currency rules;
- repository migration/history/provenance tests;
- route schema and compatibility tests;
- preview/execute equivalence and transactional rollback tests;
- Web feature tests for unpriced models, editing, preview, confirmation, and
  error recovery;
- reset-preservation and configuration import/export tests;
- root tests, build, lint, and a local read-only/pricing smoke check.
