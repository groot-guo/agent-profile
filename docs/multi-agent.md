# Multi-Agent Data Ingestion — Current State

Claude Code, Codex, Zed, and MiMo ingestion are implemented. Every adapter emits
the shared `ParsedSession`/`Span` model so analysis, diagnosis, statistics, and
the UI can operate without a separate metric implementation per agent.

## Sources

| Agent | Local source | Format | Project source |
| --- | --- | --- | --- |
| Claude Code | `~/.claude/projects/*/*.jsonl` | JSONL | transcript `cwd` |
| Codex | `~/.codex/sessions/.../rollout-*.jsonl` and archived rollouts | JSONL | `session_meta.cwd` |
| Zed | `~/Library/Application Support/Zed/threads/threads.db` | SQLite + compressed thread payload | `folder_paths` |
| MiMo | `~/.local/share/mimocode/mimocode.db` | SQLite session/message/part rows | session directory |

The shared `sessions.agent` field distinguishes sources. The internal
`source_kind`, `source_updated_at`, and `source_fingerprint` fields record the
specific revision that produced each normalized session. Existing databases
receive these columns through additive migration; normal upgrades do not
require deleting the local database.

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
- `session_meta.cwd` supplies project metadata;
- response messages/reasoning become LLM evidence;
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
- MiMo uses the stored session directory for project grouping.

## Scanning behavior

At startup, configured Claude/Codex transcript directories and available
Zed/MiMo databases enter one background import-job manager. The Web “重新扫描”
action starts the same four-source job. A source already scanning is joined
rather than started concurrently; failure in one source does not stop another.
`POST /api/scan` remains available for compatibility when importing an explicit
transcript directory.

`GET /api/imports/status` returns source label, availability, stored Session
count, idle/scanning/completed/failed state, bounded result counts, and
timestamps. It does not return transcript text, full local source paths, or
source Session IDs. `POST /api/imports` starts a job and returns immediately so
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
metadata; MiMo fingerprints
`time_updated` plus message/part counts. Matching database-source revisions are
skipped before payload decompression or row loading. A changed source session
is re-normalized and replaces its previous generated rows so aggregates do not
double count. Advancing the Zed parser-contract revision refreshes Zed-derived
rows through that same atomic path without touching unrelated sources. A legacy
row with no fingerprint refreshes once.

All adapters emit lazy source items to one import coordinator. The coordinator
reports scanned/imported/updated/skipped/failed counts and isolates an item
failure from unrelated items. Its `skipReasons` distinguish
`unchanged_revision` from `not_importable`, so an unchanged fingerprint is not
conflated with a source item that produced no normalized Session. Metadata-only
Claude/Codex histories and MiMo histories without an assistant turn are counted
as `not_importable`; captured LLM turns are not rejected merely because their
reported token usage is zero. One session repository performs analysis and
transactional session/span replacement for every source while preserving
user-authored tags and notes. Scan routes contain no persistence SQL. A failure
to access one optional local source must not make the health endpoint or
already imported data unavailable.

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
