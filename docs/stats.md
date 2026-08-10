# Cost and Consumption Statistics — Current State

The implemented `/stats` page and `GET /api/stats` endpoint aggregate primary
Sessions in the local database. A Codex source record containing only sidechain
Spans remains stored and directly inspectable but is not counted as a peer
top-level Session. Monetary values use the current `CNY per million tokens`
contract. The statistics are descriptive process telemetry; source coverage,
missing pricing, and calculation provenance must be considered before comparing
agents.

The statistics page now has two layers. The aggregate sections describe volume
and trends; the Project Profile section describes one selected project key
across primary Sessions. `/profiles` describes each Agent's observed per-session
runtime signature and makes comparison eligibility and coverage explicit.

## Current overview

The overview contains:

- total sessions, tokens, and calculated cost;
- total input/output tokens;
- average cache-hit rate and peak context;
- number of sessions containing unknown model cost.

Each stored session cost also carries `costCurrency`, `costCalculatedAt`, and
`costCalculatorVersion`. Span rows additionally carry the price's
`pricingEffectiveFrom`, `pricingModel`, and `pricingRevision`. Pre-T39 values are
labelled `legacy`; importing again or calling `/api/recompute-cost` recalculates
them with calculator `v1`. The versioned Model Catalog API additionally supports
a read-only scoped preview followed by a fixed-revision transactional execute.
Unsupported pricing schemes remain unknown in both operations.

## Grouped statistics

Model groups use a presentation-only identity contract. Explicit case and
provider-prefix aliases such as `DeepSeek-V4-Flash` and
`deepseek-ai/DeepSeek-V4-Pro` are grouped with their canonical model and retain
their observed raw labels in the API response. Captured Codex turn models
`gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna` are concrete identities.
`codex-auto-review` is a runtime-mode label and is excluded from model
statistics and Model Catalog configuration while remaining in the stored Span
evidence. Provider-only values such as `openai` and `litellm` are labeled as
not providing a concrete model; unrecognized versions/modes remain separate.
This grouping never changes the persisted Span model or makes an unpriced raw
label eligible for a canonical model's price.

The Model Catalog inventory (T135) additionally classifies every observed raw
label into a billing-eligibility group that is visible in the settings page:

- `billable` — explicit concrete model identities that the catalog can
  configure;
- `review_required` — opaque rolling labels (`astron-code-latest`), managed
  provider routes (`big-pickle`), and unverified custom labels that need
  explicit audited evidence before pricing or context configuration;
- `excluded` — synthetic placeholders (`<synthetic>`) and runtime modes
  (`codex-auto-review`) that are never billable and stay out of price-edit
  candidates.

Raw labels remain inspectable in statistics and the catalog list; only an
explicit audited pricing alias or manual configuration can move a
review-required label into billable pricing. Automatic name-similarity aliases
are prohibited.

| Dimension | Current metrics |
| --- | --- |
| Agent | session count, tokens, cost, average cache-hit rate |
| Project | session count, tokens, cost |
| Model | LLM-turn count, input-side tokens, output tokens, cost |

Project grouping uses `cwd` and falls back to a project name derived from the
source path. Model values are aggregated from LLM-turn spans rather than only
the session summary.

## Distributions

The API returns fixed logarithmic-style buckets for:

- session cost: `¥0`, `¥0-0.01`, `¥0.01-0.1`, `¥0.1-1`, `¥1-5`, `¥5+`;
- session tokens: `<1k`, `1k-10k`, `10k-100k`, `100k-500k`,
  `500k-1M`, `1M+`;
- model and agent call/session distributions.

The web page renders cost/token distributions, grouped tables, and model
breakdowns. Bucket thresholds are currently fixed in the server; quantile
buckets and query-configurable edges are not current API behavior.

## Baselines, anomalies, and trends

For each project the API calculates session count, average/median/P95 cost,
average tokens, and average cache hit. A session is flagged as a cost anomaly
only when its project has at least three sessions and its cost exceeds three
times the project median (with a non-trivial median).

Daily trends aggregate tokens, cost, session count, and average cache hit.
These are correlations over observed sessions; they do not establish that a
configuration caused the change.

## Project Profile v1

`GET /api/projects/profile?project=...&from=...&to=...` and the Project Profile
section in `/stats`, together with the read-only `/projects` page, expose
`project-profile/v1` for one normalized project key.
The optional `from`/`to` values are millisecond timestamps, with `to` exclusive.

The report includes linked and available primary Session counts, requested range,
Agent/source coverage, sampling state, token totals, trusted cost coverage,
cache/context/duration coverage, normalized tool-call/error rates, tool
frequencies, and UTC day trends. File evidence is currently `not_captured`; no
complete repository inventory is inferred.

The Server bounds the response to 1,000 newest matching Sessions and 10,000
tool events. A sampled response says so in `scope.sampled` and `limitations`.
Unknown pricing, missing source kinds, unavailable Sessions, and missing tool
evidence remain visible as coverage limits. The report is process telemetry,
not a delivery-quality verdict or a causal comparison.

Price recomputation does not mean “apply today's price to all history”. Each LLM
span selects the latest price whose effective time is not later than the span
start time, then session totals are rebuilt from those span values.

## Agent Profile v1

`GET /api/profiles/agents` and `GET /api/profiles/agents/:agent` expose the
versioned `agent-profile/v1` report over the same primary Session scope. Retained
Codex child-only rollout usage is not merged into its parent. Codex
`parent_thread_id` is available as source-native Session evidence, but combined
resource attribution remains future work. The current dimensions are:

| Dimension | Current metrics |
| --- | --- |
| Resource usage | per-session token, CNY cost, duration, and cache-hit distributions |
| Context discipline | per-session peak and average context distributions |
| Execution reliability | tool-error rate and share of sessions containing tool errors |
| Collaboration | sidechain-turn/tool shares and share of sessions using sidechains |
| Coverage | known cost, duration, model identity, tool evidence, and Outcome availability |

Each distribution reports observed and total sample counts, coverage, mean,
median, nearest-rank P90, minimum, and maximum. Rates report a numerator and
denominator; a zero denominator produces `null`, not a fabricated zero rate.

Relative characteristics require:

- at least three sessions for the target Agent;
- at least one peer Agent with at least three sessions;
- at least 50% coverage for the compared metric.

The target metric is compared with the median of eligible peer-Agent metric
values. Differences within ±10% are `similar`; larger differences are `higher`
or `lower`. No direction is defined as preferable. Current cohorts do not
control for task type or complexity, and Outcome is `not_collected`, so this is
an observational process comparison rather than a quality or causality claim.
Not every source separately records whether tool-error status was available;
the current tool-error rate therefore counts explicit observed errors only.

## Response shape

```text
GET /api/stats
  → {
      overview,
      byAgent[],
      byProject[],
      byModel[],
      distribution: {
        costBins[],
        tokenBins[],
        modelDistribution[],
        agentDistribution[]
      },
      baseline: {
        projects,
        anomalySessions[]
      },
      trends[]
    }

GET /api/profiles/agents
  → {
      schemaVersion: "agent-profile/v1",
      generatedAt,
      scope,
      comparison,
      profiles[],
      limitations[]
    }

GET /api/projects/profile?project=...
  → {
      schemaVersion: "project-profile/v1",
      generatedAt,
      project,
      scope,
      metrics,
      tools[],
      trends[],
      coverage,
      limitations[]
    }
```

When there are no sessions, grouped/distribution collections are empty. The
current empty response does not include populated baseline/trend structures, so
consumers must treat those fields as optional until data exists.

Any metric, bucket, baseline, anomaly, trend, or response-shape change requires
an explicit task in `roadmap.md`, server verification, UI verification, and an
update to this document.
