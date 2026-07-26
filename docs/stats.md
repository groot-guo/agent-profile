# Cost and Consumption Statistics — Current State

The implemented `/stats` page and `GET /api/stats` endpoint aggregate the local
session database. The statistics are descriptive process telemetry; source
coverage and missing pricing must be considered before comparing agents.

## Current overview

The overview contains:

- total sessions, tokens, and calculated cost;
- total input/output tokens;
- average cache-hit rate and peak context;
- number of sessions containing unknown model cost.

## Grouped statistics

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
```

When there are no sessions, grouped/distribution collections are empty. The
current empty response does not include populated baseline/trend structures, so
consumers must treat those fields as optional until data exists.

Any metric, bucket, baseline, anomaly, trend, or response-shape change requires
an explicit task in `roadmap.md`, server verification, UI verification, and an
update to this document.
