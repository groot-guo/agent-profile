# Multi-Agent Data Ingestion — Current State

Claude Code, Codex, Zed, MiMo, and OpenCode ingestion are implemented. Every
adapter emits the shared `ParsedSession`/`Span` model so analysis, diagnosis,
statistics, and the UI can operate without a separate metric implementation per
agent.

## Sources

| Agent | Local source | Format | Project source |
| --- | --- | --- | --- |
| Claude Code | `~/.claude/projects/*/*.jsonl` | JSONL | transcript `cwd` |
| Codex | `~/.codex/sessions/.../rollout-*.jsonl` and archived rollouts | JSONL | `session_meta.cwd` |
| Zed | `~/Library/Application Support/Zed/threads/threads.db` | SQLite + compressed thread payload | `folder_paths` |
| MiMo | `~/.local/share/mimocode/mimocode.db` | SQLite session/message/part rows | session directory |
| OpenCode | `~/.local/share/opencode/opencode.db` | SQLite session/message/part rows | session directory |

The shared `sessions.agent` field distinguishes sources. The internal
`source_kind`, `source_updated_at`, and `source_fingerprint` fields record the
specific revision that produced each normalized session. Existing databases
receive these columns through additive migration; normal upgrades do not
require deleting the local database.

`project-profile/v1` retains this heterogeneity in its per-source Session
coverage. It groups only current primary Sessions that share the canonical
project key; it does not merge source-native parent/child records, fill absent
file evidence, or turn an absent normalized tool call into a claim that a tool
was not used.

## Normalization

### Claude Code

- assistant messages become LLM-turn evidence with four usage-token classes;
- `tool_use.id` pairs with `tool_result.tool_use_id`;
- text/thinking blocks and transcript parent/sidechain information are retained
  to the extent supported by the normalized model.

### Codex

- `session_meta.id` is the stable rollout-thread Session identity, with
  `session_id` retained only as a legacy fallback;
- child rollouts keep their distinct thread IDs instead of replacing the
  parent Session, and their generated Spans are marked as sidechain evidence;
- the importer reads the rollout and the read-only Codex
  `~/.codex/state_*.sqlite` database. It uses the exact state-record title when
  available, and keeps a missing title absent rather than deriving one from
  reasoning text;
- source-native child-to-parent evidence can come from
  `session_meta.parent_thread_id`, `sub_agent_activity`, and
  `thread_spawn_edges`. The relationship stores only deterministic child agent
  nickname/role/path plus captured call start, callback time, and callback
  status (`observed` or `final_answer`). Missing fields remain missing, and
  import order does not discard metadata already supplied by the other side;
- the parent Session may be unavailable or absent locally, so detail must
  distinguish linked, parent-unavailable, and not-captured states;
- titles, `cwd`, source paths, timestamps, models, and other sources' event-level
  parent IDs must not be used to infer a persisted Session relationship;
- primary Session lists, statistics, project cohorts, Agent Process Profiles,
  and import-source counts exclude a Codex record only when every stored Span
  is sidechain evidence. The child record remains available by direct stored ID;
  child-only Sidechain resources are not merged into the parent. T119 now
  exposes the source-native relationship as a typed Task graph: `task-profile/v1`
  reports linked Session nodes, source-parent edges that touch a linked Session,
  per-Agent attribution, and relationship coverage, and its aggregate totals
  reconcile to the linked stored Sessions without summing a child Session twice
  through a parent edge;
- a non-empty `session_meta.cwd` supplies project evidence; if it is absent,
  navigation and statistics use the stable `Codex 会话记录` source category
  while preserving the missing coverage and raw file path;
- `~/.codex/sessions/YYYY/MM/DD/` and archived date-like locations are source
  storage partitions, not project evidence, and are never converted into a
  project name;
- Codex Desktop non-project conversations can still carry a generated non-empty
  `cwd` under `~/Documents/Codex/YYYY-MM-DD/<session>`; this managed workspace is
  runtime isolation rather than project evidence and uses the same
  `Codex 会话记录` category;
- response messages/reasoning become LLM evidence, and each LLM turn uses its
  own captured `turn_context.payload.model`; `session_meta.model_provider` is
  retained as provider context only and is not stored as a concrete Span model;
- custom tool calls pair with their outputs by call ID;
- token-count events provide available token aggregates. When Codex reports all
  classified fields as zero but a non-zero `total_tokens`, the parser retains
  that total in `inputTokens` and marks the Span with
  `tokenUsageSource=total_tokens_fallback` and
  `tokenUsageClassified=false`; downstream input/cache/output and cost analysis
  must treat that turn as an explicitly identified fallback approximation.

### Zed

- the source database is opened read-only;
- each zstd record decodes to one JSON object with tagged User/Agent messages;
- User request IDs create LLM turns and join to observed input/output totals in
  `request_token_usage`; Agent Text and ToolUse entries create answer and
  tool-call Spans, with tool results paired by tool-use ID;
- raw-string and legacy JSON-array `folder_paths` provide project grouping;
- cache-token classes, per-message timing, and sidechain evidence are not
  present in the current payload and remain uncaptured rather than estimated;
- malformed or unsupported records are `not_importable`; summaries never
  become synthetic answer or token evidence.

### MiMo

- session rows provide identity, title, directory, and time range;
- message and part rows are joined and mapped into normalized turns and tools;
- MiMo uses the stored session directory for project grouping;
- `external_import` is queried read-only by Session ID. A Session is excluded
  from `mimo-code` normalization only when `source = 'cc'` and the recorded
  absolute `source_path` is a descendant of the canonical
  `~/.claude/projects` directory. Other source names, paths outside that
  directory, absent metadata, model names, titles, and message content never
  trigger source reclassification;
- exclusion happens before message/part loading. A prior unannotated generated
  `mimo-code` copy is removed atomically, but a same-ID Session generated by a
  different source is retained. A MiMo copy with user tags or notes is also
  retained and counted as `protectedAnnotatedSessions` so the UI can request
  manual cleanup without discarding annotations.

### OpenCode

- the database is opened read-only and Session rows provide stable identity,
  title, directory, model, agent mode, timestamps, and aggregate token fields;
- message/part rows preserve answer, reasoning, and tool evidence, with tool
  call IDs retained as normalized tool-call identities and captured part timing
  plus source message/parent IDs kept as Span evidence;
- OpenCode stores token totals at Session rather than message granularity, so
  one aggregate LLM turn is marked `tokenUsageSource=session_aggregate` instead
  of fabricating per-message usage;
- cache writes map to cache creation, cache reads remain separate, and source
  reasoning totals are included in normalized output usage;
- the analyzer computes cost from model plus the four normalized token classes;
  a source aggregate cost is not imported as trusted billing evidence.

## Scanning behavior

At startup, configured Claude/Codex transcript directories and available
Zed/MiMo/OpenCode databases enter one background import-job manager. The Web
“重新扫描” action starts the same five-source job. A source already scanning is
joined rather than started concurrently; failure in one source does not stop another.
`POST /api/scan` remains available for compatibility when importing an explicit
transcript directory.

`GET /api/imports/status` returns source label, availability, stored Session
count, idle/scanning/completed/failed state, bounded result counts, and
timestamps. It does not return transcript text, full local source paths, or
source Session IDs. The stored Session count uses the same primary-Session
scope as navigation and statistics; retained Codex child-only records therefore
do not inflate it. `POST /api/imports` starts a job and returns immediately so
the UI can retain existing data, poll only while active, and refresh once on
completion.

`POST /api/imports/rebuild` uses the same bounded per-source job state but
forces unchanged available revisions through parsing and atomic replacement.
It preserves tags/notes and configuration, leaves data from unavailable sources
untouched, and keeps the previous normalized Session if a source item fails.
The separate confirmed reset route deletes only generated Sessions/Spans;
pricing, model-context rows, and migration history remain available for the
next synchronization.
File-based sources fingerprint file mtime and size. Zed fingerprints its
parser-contract revision (`zed-v2` currently), `updated_at`, and payload
metadata. MiMo fingerprints the `mimo-v2` parser-contract revision,
`time_updated`, message/part counts, and a bounded hash of sorted
`external_import` metadata; the raw external path is not copied into the
fingerprint. OpenCode adds its parser-contract revision to the same updated-time
and row-count fingerprint. Matching database-source revisions are skipped
before payload decompression or row loading. A changed source session is
re-normalized and replaces its previous generated rows so aggregates do not
double count.
Advancing a database parser-contract revision refreshes that source's derived
rows through the same atomic path without touching unrelated sources. A legacy
row with no fingerprint refreshes once.

Claude Code and Codex JSONL adapters also keep a bounded process-local
append checkpoint containing only a prefix digest, line/byte boundary, Session
identity, and final-turn structural IDs. A strictly appended, complete suffix
with monotonic timestamps and an independent turn is parsed incrementally and
appended transactionally; Claude tool results crossing the checkpoint, Codex
events that continue the previous turn, malformed or truncated lines, rewrites,
cache misses, and forced rebuilds fall back to full parsing. The checkpoint is
never persisted to SQLite and does not retain raw transcript or prompt content.
The resulting Session revision, annotations, cost calculation, and atomic
replacement/append guarantees remain authoritative.

All adapters emit lazy source items to one import coordinator. The coordinator
reports scanned/imported/updated/skipped/removed/failed counts and isolates an
item failure from unrelated items. Its `skipReasons` distinguish
`unchanged_revision`, `not_importable`, and `excluded_non_actionable`, so an
unchanged fingerprint is not conflated with a source item that produced no
normalized Session or one deliberately excluded by exact source metadata.
`protectedAnnotatedSessions` separately reports excluded generated copies that
must remain because they carry user tags or notes. Metadata-only Claude/Codex
histories and MiMo/OpenCode histories without an assistant turn are counted as
`not_importable`; captured LLM turns are not rejected merely because their
reported token usage is zero. One session repository performs analysis and
transactional session/span replacement for every source while preserving
user-authored tags and notes. Exclusion cleanup additionally requires the
stored `source_kind` to equal the excluding adapter kind, preventing a MiMo
duplicate from deleting the direct Claude Code Session with the same ID. Scan
routes contain no persistence SQL. A failure to access one optional local
source must not make the health endpoint or already imported data unavailable.

## Coverage and comparison limits

The normalized shape makes basic comparison possible, but it does not make all
sources equally observable. Token classes, thinking text, parent chains, tool
outputs, duration, and error fields may be absent or approximated in a source.
UI and analysis must treat absent coverage as unknown, not as zero, success, or
superior efficiency.

Adding or changing an adapter requires an explicit roadmap task that records:

- source format/version assumptions and fixtures;
- normalized field mapping and missing-data semantics;
- incremental identity and replacement behavior;
- privacy/truncation rules;
- parser, import, and cross-source metric verification;
- updates to this document and `ARCHITECTURE.md`.
