# Representative Scale Benchmark

This document defines the reproducible, content-free desktop performance
baseline introduced by T82. It is a regression methodology for the current
local-first implementation, not a cross-machine service-level objective.

## Commands

```bash
pnpm benchmark:scale
pnpm benchmark:scale:ci
```

Both commands create a temporary SQLite database, run the benchmark, print one
`scale-benchmark/v1` JSON report, and delete the temporary database. The `:ci`
variant exits non-zero when a desktop regression budget is exceeded.

The runner uses the normal database schema, route registration, statistics,
diagnosis, evidence-report, and import-coordinator code. Fastify injection
measures query, analysis, and serialization work without opening a network
listener. The fixture and benchmark never read local transcript content and do
not modify the normal `trace.db`.

## Representative fixture

| Dimension | Value |
| --- | ---: |
| Sessions | 500 |
| Stored Spans | 75,000 |
| Largest Session | 3,000 Spans |
| Selected project cohort | 25 Sessions / 24,600 Spans |
| Synthetic database size on the T82 run | 21,196,800 bytes |

The five supported Agent labels rotate through the Sessions. Span types,
parents, timings, tokens, cache classes, costs, tool names, error flags, and
sidechain flags are deterministic. Span metadata is `NULL`: the fixture
contains no prompt, answer, reasoning, tool input, or tool-output text.

The selected large Session belongs to the 25-Session project cohort, so the
analysis benchmark covers both its 3,000-Span response and the current
project-relative score path that reads 24,600 project Spans.

## Measured T82 baseline

Two consecutive warm-process runs on 2026-07-28 used Node v24.18.0 on Darwin
arm64. Values below are ranges across those runs; they describe this machine,
not all supported desktops.

| Workload | Median time | Response size |
| --- | ---: | ---: |
| 500 unchanged source revisions | 0.9–1.9 ms | no payload loading; 0 `load()` calls |
| `GET /api/sessions` | 2.6–5.9 ms | 324,418 bytes |
| `GET /api/stats` | 8.4–16.5 ms | 9,735 bytes |
| `GET /api/session/:id/analysis` | 218.3–222.0 ms | 1,882,040 bytes |
| `GET /api/session/:id/evidence?content=none` | 12.3–12.4 ms | 1,627,750 bytes |

Whole-process maximum RSS was 393,805,824–413,253,632 bytes. That high-water
value includes fixture creation, module loading, SQLite, route execution,
project-cohort analysis, and serialization in one process; it is not an
endpoint-only retained-memory measurement.

The captured query plans establish the pre-T83/T84 baseline:

```text
Session list:
  SCAN sessions
  USE TEMP B-TREE FOR ORDER BY

Session Spans:
  SEARCH spans USING INDEX idx_spans_session (session_id=?)
  USE TEMP B-TREE FOR ORDER BY
```

The plans confirm the current missing `sessions(start_time)` and
`spans(session_id, start_time)` ordering indexes. The benchmark records these
plans but does not require the temporary B-trees to remain; a measured future
index improvement may legitimately change them.

## Measured T83 bounded-discovery result

The final T83 run on 2026-07-30 used the same Node v24.18.0 / Darwin arm64
workload and passed every budget. It added measurements for the Web discovery
and Home statistics contracts while retaining the legacy endpoints as
compatibility baselines.

| Workload | Median time | Response size |
| --- | ---: | ---: |
| 500 unchanged source revisions | 1.1 ms | no payload loading; 0 `load()` calls |
| compatibility `GET /api/sessions` | 2.5 ms | 324,418 bytes |
| `GET /api/session-discovery?limit=120` | 2.2 ms | 51,929 bytes |
| compatibility `GET /api/stats` | 10.7 ms | 8,488 bytes |
| `GET /api/home-statistics` | 2.0 ms | 5,711 bytes |
| `GET /api/session/:id/analysis` | 215.4 ms | 1,882,040 bytes |
| `GET /api/session/:id/evidence?content=none` | 11.8 ms | 1,627,750 bytes |

The synthetic database was 21,295,104 bytes and whole-process maximum RSS was
411,680,768 bytes. As in the T82 baseline, the RSS value is a process
high-water mark rather than endpoint-retained memory. The T83-start comparison
run was 324,418 bytes / 2.8 ms for `/api/sessions`, 9,719 bytes / 11.9 ms for
`/api/stats`, and 426,819,584 bytes maximum RSS. The new discovery window is
about 84% smaller than the compatibility full-array response on this fixture;
that reduction comes from paging a deliberately smaller privacy-safe analytical
contract, not from changing metric definitions.

The final query plans are:

```text
Compatibility Session list:
  SCAN sessions USING COVERING INDEX idx_sessions_discovery_time

Bounded Session discovery:
  SCAN s USING INDEX idx_sessions_discovery_time
  CORRELATED SCALAR SUBQUERY 1
  SEARCH primary_span USING INDEX idx_spans_session (session_id=?)

Session Spans:
  SEARCH spans USING INDEX idx_spans_session (session_id=?)
  USE TEMP B-TREE FOR ORDER BY
```

Migration v6 adds `sessions(start_time DESC, id DESC)`,
`sessions(agent, start_time DESC, id DESC)`, and
`sessions(project_key, start_time DESC, id DESC)`. The representative default
discovery query uses the first index.

## Measured T84 bounded-detail result

The final T84 run on 2026-07-30 used the same Node v24.18.0 / Darwin arm64
fixture and passed every budget. Compatibility full-detail endpoints remain in
the benchmark, while the Web-facing analysis summary and first evidence page are
measured as separate bounded contracts.

| Workload | Median time | Response size |
| --- | ---: | ---: |
| compatibility `GET /api/session/:id/analysis` | 165.3 ms | 1,882,040 bytes |
| `GET /api/session/:id/analysis-summary` | 135.1 ms | 222,469 bytes |
| compatibility `GET /api/session/:id/evidence?content=none` | 12.5 ms | 1,627,750 bytes |
| `GET /api/session/:id/evidence-page` | 5.0 ms | 45,268 bytes |

The analysis summary still validates all 3,000 fixture events through its
complete aggregates, but returns no complete Span array: context is capped at
240 points and the main-chain tool window at 50 events. The evidence page still
reports the complete 3,000-event scope while returning the default 80-event
window. On this fixture the bounded responses are about 88% and 97% smaller than
their compatibility counterparts. The synthetic database was 26,787,840 bytes
and whole-process maximum RSS was 310,034,432 bytes; as with earlier runs, this
is a combined process high-water mark rather than endpoint-retained memory.

Migration v7 adds `spans(session_id, start_time, id)`. The current Session-Span
query plan is:

```text
Session Spans:
  SEARCH spans USING COVERING INDEX idx_spans_session_time_id (session_id=?)
```

The evidence page uses that order for its `(start_time, id)` keyset cursor. The
default no-content query derives content availability/truncation flags in SQLite
without selecting metadata text into Node; opt-in preview loads only the current
page's relevant fields.

## Measured T121 Task-workspace bounded search

The final T121 run on 2026-08-07 used the same Node v24.18.0 / Darwin arm64
fixture and passed every budget. The Task workspace no longer loads the
compatibility full-array Session list; its Session pickers use the bounded
`session-discovery/v2` contract with a 50-row window.

| Workload | Median time | Response size |
| --- | ---: | ---: |
| Task Session search (`/api/session-discovery?limit=50&q=fixture`) | 2.3 ms | 30,470 bytes |

The search window is capped at 50 rows with an explicit matched/total count and
keyset cursor, so a 500-Session history never transfers or renders more than
the current window. Response-size regression checks now cover this Task-workflow
path.

## Desktop regression budgets

| Guard | Budget |
| --- | ---: |
| Unchanged 500-item synchronization | 500 ms |
| Whole-process maximum RSS | 768 MiB |
| Session list median / response | 300 ms / 1,500,000 bytes |
| Session discovery median / response | 300 ms / 200,000 bytes |
| Stats median / response | 2,000 ms / 750,000 bytes |
| Home statistics median / response | 500 ms / 100,000 bytes |
| Analysis median / response | 4,000 ms / 5,000,000 bytes |
| Analysis summary median / response | 4,000 ms / 500,000 bytes |
| Evidence median / response | 2,000 ms / 4,000,000 bytes |
| Evidence page median / response | 500 ms / 250,000 bytes |
| Task Session search median / response | 300 ms / 200,000 bytes |

These intentionally generous guards cover slower developer/CI machines while
still detecting order-of-magnitude latency changes, accidental response
expansion, payload loading during unchanged synchronization, or a major memory
high-water regression. They must not be presented as user-facing SLOs.

Any Task may update a budget only with a recorded before/after benchmark,
unchanged metric/privacy semantics, and an explanation of fixture or workload
changes. A faster result does not authorize dropping coverage; a smaller
response must state whether evidence became windowed or paged.

## Known limits

- The benchmark does not include browser rendering, network transport,
  concurrent users, production-mode cold cache, or source-parser throughput.
- Structural synthetic evidence cannot reproduce every real parser metadata
  shape or operating-system filesystem behavior.
- Maximum RSS is a process high-water value. It cannot by itself distinguish
  temporary allocation, SQLite/native memory, and V8 retained heap.
- The timing guard is intentionally desktop-oriented and should be compared by
  workload and report schema, not used to rank machines or Agents.
- T83's bounded Session discovery/statistics, T84's bounded detail/evidence,
  and T121's bounded Task-workspace Session search workloads are now part of
  the benchmark. Compatibility full-array/full-detail routes remain regression
  baselines. The fixture still does not measure browser rendering, DOM/React
  memory, interaction latency, or Task linking over very large histories; the
  Web-facing Task picker search is covered by the bounded endpoint regression
  guard and the Playwright smoke assertion that the Task workspace never
  requests the full-array Session list.
