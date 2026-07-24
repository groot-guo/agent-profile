# Agent Profile — 中文总览

> 本文件同步英文设计文档（`ARCHITECTURE.md` + `docs/`）的核心内容，供中文阅读。详细设计以英文文档为准。

## 项目

Agent Profile — AI 编码 agent 会话 transcript 的离线 profile 分析工具。扫描本地会话文件（Claude Code / Codex / Zed），还原 token / 上下文 / cost / 耗时 / 工具调用，支撑成本优化、上下文健康、性能分析。

## 数据流

```
会话文件 (.jsonl / SQLite)
  → Scanner（扫描/去重/增量）
  → Parser（NDJSON / zstd 解码，tool_use↔tool_result 配对，parentUuid 调用链）
  → Analyzer（四类 token、上下文、cache 命中率、cost）
  → SQLite (server/trace.db)
  → Web UI (Next.js)
```

## 技术栈

pnpm workspace + TypeScript。
- `packages/core`：scanner / parser / analyzer / pricing / diagnosis / types。纯逻辑，server 与 web 共用。
- `server`：Fastify + better-sqlite3。建表 + REST API。
- `web`：Next.js。会话列表（按项目分组）+ 详情（条形图 / 上下文曲线 / token 拆解 / 诊断 / 分页表）。

## 数据模型

四张表（`server/src/db.ts`）：
- **sessions**：id + 文件 mtime/size/lines + 四类 token 聚合 + peak/avg context + cache_hit_rate + cwd + `agent`（规划：claude-code | codex | zed）。
- **spans**：llm_turn | tool_call。四类 token + context_tokens + output_bytes + metadata（>10KB 截断）。parentId 调用链，isSidechain。
- **pricing**：model → 四类 token 单价（人民币/百万 token）。
- **model_context**：model → context window。

改 schema 需删 `server/trace.db` 重建（`CREATE TABLE IF NOT EXISTS` 不改已存在表）。

## 关键约定

- 四类 token 不合并（input / cache_creation / cache_read / output）。cache_read 价格与语义都不同于 input。
- transcript 无 cost 字段，cost 全部由 analyzer 按 model + token + pricing 算；未定价 → costUnknown，不估算。
- thinking / answer 是 llm_turn 内部 block，token 含在轮 output 不单拆。
- 增量更新：transcript 追加写入，scan 检测 mtime/size，变了删旧重插。
- tool 配对：tool_use.id ↔ tool_result.tool_use_id。
- 分类：工具按类别归组（文件/命令/网络/交互/MCP/编排/元）用于着色，不是结构层。

## 诊断（详见 `docs/diagnosis.md`）

两层：
- 启发式规则（已实现，7 项）：重复读取 / 大输出携带 / cache 命中低 / 上下文堆积 / 过长 thinking / 重复试错 / 读取范围过大。wastedTokens 按公式估算（bytes/4 等），wastedCost 按模型 input_price 估上限。
- LLM 语义分析（P2.19，接口预留未实现）：thinking 偏离 / 工具偏离 / 无效探索。预筛 + 批量 prompt + 30s 超时降级。分析成本单独记录。

## 多 agent 接入（详见 `docs/multi-agent.md`，批1）

| agent | 位置 | 格式 | project |
|---|---|---|---|
| Claude Code | `~/.claude/projects/*/*.jsonl` | JSONL | cwd |
| Codex | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | JSONL | session_meta.cwd |
| Zed | `~/Library/Application Support/Zed/threads/threads.db` | SQLite + zstd BLOB | folder_paths |

各 agent parser 输出统一 ParsedSession/Span，下游不变。sessions 表加 agent 列。

## 消耗统计（详见 `docs/stats.md`，批3）

独立页 `/stats` + API `/api/stats`：
- 总览卡（总 token / cost / session / agent / 项目数）
- 按 agent / 项目 / 模型分组
- session cost 分布直方图（对数分桶：=0 / <¥0.01 / 0.01–0.1 / 0.1–1 / 1–10 / >10）
- 模型调用分布（饼图 + 堆叠条形）

对数分桶因 cost 分布长尾，等宽会让高端空桶。

## 路线图（详见 `docs/roadmap.md`）

- 批1 多 agent 接入（schema → Codex → Zed → scanner）
- 批2 UI 优化 + 筛选（agent 过滤 + 子 agent 调用链合并 + 去无效请求）
- 批3 消耗统计
- 批4 LLM 语义分析实现
- 批5 遗留（glm-5.2 定价 + totalCost 重算）

## 当前进度

- ✓ P0 数据列举 / P1 诊断（7 项）/ P2.18 read_scope / UI 明亮+分页+分项目 / pricing seed / typecheck 修复
- ◐ P2.19 LLM 接口预留
- ✗ 仅 Claude Code 数据源 / glm-5.2 定价缺 / totalCost 不随 pricing 重算

## 端口

server 3000，web 3001。可配 `PORT`（server）、`NEXT_PUBLIC_API`（web）。
