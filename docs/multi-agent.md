# Multi-Agent Data Ingestion

Support multiple coding agents' session transcripts. Unified data model: each agent parser outputs `ParsedSession`/`Span` (existing), downstream analyzer/diagnosis/stats unchanged.

## Sources

| agent       | location                                                                         | format             | project source     | key fields                                                                                               |
| ----------- | -------------------------------------------------------------------------------- | ------------------ | ------------------ | -------------------------------------------------------------------------------------------------------- |
| Claude Code | `~/.claude/projects/*/*.jsonl`                                                   | JSONL              | cwd (first row)    | usage (4 tokens), content (thinking/text/tool_use), tool_result, parentUuid                              |
| Codex       | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` (+ `~/.codex/archived_sessions/`) | JSONL              | `session_meta.cwd` | session_meta, response_item (message/reasoning/custom_tool_call+output), event_msg (token_count)         |
| Zed         | `~/Library/Application Support/Zed/threads/threads.db`                           | SQLite + zstd BLOB | `folder_paths`     | threads (id, summary, data BLOB zstd, folder_paths, updated_at); decompress data then parse (format TBD) |

## Schema Change

`sessions` table add `agent` column (`claude-code` | `codex` | `zed`). Requires deleting `apps/server/trace.db` (schema rebuild, `CREATE TABLE IF NOT EXISTS` won't alter existing).

## Parser Mapping (per agent → unified Span)

### Claude Code (existing)

- assistant row → llm_turn span (4 tokens from usage)
- content.thinking → thinking span
- content.tool_use ↔ next user row tool_result → tool_call span (pair by id)
- content.text → answer span

### Codex (planned)

- `session_meta` → session meta (cwd, cli_version, session_id)
- `response_item|reasoning` → thinking span
- `response_item|custom_tool_call` ↔ `response_item|custom_tool_call_output` → tool_call span (pair by call id)
- `response_item|message` → answer span
- `event_msg|token_count` → 4 token types for nearest turn
- `event_msg|user_message` / `agent_message` → user/assistant text

### Zed (planned, format TBD)

- read `threads.db` (SQLite, better-sqlite3, readonly)
- per thread: decompress `data` BLOB (zstd) → parse (format to verify before writing parser: JSON or MessagePack?)
- map to spans (messages, tool calls, tokens — depends on decompressed schema)
- project = `folder_paths`

## Scanner Multi-Source

- scan three locations, dispatch parser by agent
- incremental: Claude Code / Codex use file mtime/size; Zed uses threads.db `updated_at` or row count
- `POST /api/scan` add `agent` param (`all` | `claude` | `codex` | `zed`)

## Dependencies

- Zed: zstd decompression (node `@lib/zstd` or system `zstd` CLI); SQLite read (better-sqlite3 already available)
- Codex / Claude Code: no new dependency (NDJSON)

## Project Unification

project = cwd (Claude Code first row / Codex `session_meta.cwd`) / `folder_paths` (Zed) → `SessionSummary.cwd` (existing field). Session list groups by cwd.

## Implementation Order

1. schema add `agent` column (delete db rebuild)
2. Codex parser (JSONL, direct)
3. Zed parser (zstd + format verification, most complex)
4. scanner multi-source + scan API
