# Cost & Consumption Statistics

Aggregate view across all sessions on this machine. Independent page `/stats` + API `/api/stats`, separate from session detail.

## Overview Cards

- total sessions / agents / projects count
- total tokens (4 types) + total cost (CNY)
- total duration
- cache hit rate (weighted)

## Group Aggregations

| dimension | metrics | display |
|---|---|---|
| by agent | session count, tokens, cost, cache hit | table + bar |
| by project (cwd) | session count, tokens, cost, top N | table, sorted by cost desc |
| by model | token in/cc/cr/out, cost, call count | table + pie/bar |

## Session Cost Distribution (histogram)

Cost distribution is long-tailed (most sessions cheap, few expensive). Use **log-scale bins** (not equal-width) to avoid empty high-end bins.

Default cost bins (CNY):

| bin | label |
|---|---|
| = 0 | free (cost=0 or unknown pricing) |
| (0, 0.01] | <¥0.01 |
| (0.01, 0.1] | ¥0.01–0.1 |
| (0.1, 1] | ¥0.1–1 |
| (1, 10] | ¥1–10 |
| (10, ∞) | >¥10 |

Each bin: session count, rendered as bar chart.

Token distribution (optional toggle), same log-bin strategy:

| bin (tokens) | label |
|---|---|
| <10k | tiny |
| 10k–100k | small |
| 100k–1M | medium |
| >1M | large |

**Bin strategy**:
- default: log bins (cost and token distributions are long-tailed; equal-width leaves high bins empty)
- optional: equal-depth (quantile) bins for zoomed/drill-down views
- bin edges configurable in `/api/stats` query params; defaults above

## Model Call Distribution

- pie chart: cost share by model (which model consumes most cost)
- stacked bar: per model token breakdown (input / cache_creation / cache_read / output)
- table: model → session count, total tokens, total cost, avg cost/session

## API

```
GET /api/stats
  → {
      overview: { sessions, agents, projects, tokens{input,cc,cr,out}, cost, duration, cacheHitRate },
      byAgent: [{ agent, sessions, tokens, cost, cacheHitRate }],
      byProject: [{ cwd, sessions, tokens, cost }],   // top N by cost
      byModel: [{ model, sessions, tokens, cost }],
      costDistribution: [{ bin, label, count }],
      tokenDistribution: [{ bin, label, count }]
    }
```

Single aggregation over `sessions` table (already has 4 token aggregates + cost + cwd + agent).

## UI (`/stats` page)

- overview cards (top)
- by agent / by project / by model tables (grouped, collapsible)
- cost distribution histogram (log bins)
- model call distribution: pie + stacked bar

Reuse design tokens from session detail (light theme, `C` palette). Charts via inline SVG (consistent with context growth chart). No new chart dependency.
