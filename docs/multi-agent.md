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
- token-count events provide available token aggregates.

### Zed

- the source database is opened read-only;
- compressed thread records are decoded and mapped to session/span evidence;
- thread folder paths provide project grouping.

### MiMo

- session rows provide identity, title, directory, and time range;
- message and part rows are joined and mapped into normalized turns and tools;
- MiMo uses the stored session directory for project grouping.

## Scanning behavior

At startup, configured Claude/Codex transcript directories are imported in the
background and the Zed/MiMo database adapters run when those databases exist.
`POST /api/scan` imports a selected transcript directory, which covers the
file-based adapter. The Web “重新扫描” action invokes this endpoint for both
`~/.claude/projects` and `~/.codex/sessions` and aggregates their results.
File-based sources fingerprint file mtime and size. Zed fingerprints
`updated_at` plus payload metadata; MiMo fingerprints
`time_updated` plus message/part counts. Matching database-source revisions are
skipped before payload decompression or row loading. A changed source session
is re-normalized and replaces its previous generated rows so aggregates do not
double count. A legacy row with no fingerprint refreshes once.

All adapters emit lazy source items to one import coordinator. The coordinator
reports scanned/imported/updated/skipped/failed counts and isolates an item
failure from unrelated items. One session repository performs analysis and
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
