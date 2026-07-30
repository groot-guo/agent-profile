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
discovery query uses the first index. T84 still owns the remaining Session-Span
ordering and complete detail/evidence loading boundary.

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
| Evidence median / response | 2,000 ms / 4,000,000 bytes |

These intentionally generous guards cover slower developer/CI machines while
still detecting order-of-magnitude latency changes, accidental response
expansion, payload loading during unchanged synchronization, or a major memory
high-water regression. They must not be presented as user-facing SLOs.

T83–T85 may update a budget only with a recorded before/after benchmark,
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
- T83's bounded Session discovery/statistics workloads are now part of the
  benchmark. T84 owns bounded detail and evidence retrieval; T85 owns
  source-safe append-only JSONL import.
