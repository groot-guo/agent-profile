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

The shared `sessions.agent` field distinguishes sources. Existing databases
receive compatible new session columns through additive migration; normal
upgrades do not require deleting the local database.

## Normalization

### Claude Code

- assistant messages become LLM-turn evidence with four usage-token classes;
- `tool_use.id` pairs with `tool_result.tool_use_id`;
- text/thinking blocks and transcript parent/sidechain information are retained
  to the extent supported by the normalized model.

### Codex

- `session_meta` supplies session identity and project metadata;
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
background and the Zed/MiMo database importers run when those databases exist.
`POST /api/scan` imports a selected transcript directory, which covers the
file-based adapters. File-based sources use file metadata for incremental
decisions; database-based sources use their available session/thread update
metadata. A changed source session is re-normalized and replaces its previous
generated rows so aggregates do not double count.

The startup background scan and the manual scan share the same persistence
model. A failure to access one optional local source must not make the health
endpoint or already imported data unavailable.

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
