# Agent Profile — 中文总览

> 本文描述当前已经实现的能力，并与 `README.md`、`ARCHITECTURE.md` 保持一致。
> 面向 Agent Runtime 的 Task、Outcome、Configuration 与反馈闭环仍是
> `docs/agent-runtime-profile-design.md` 中的未来方案。

## 定位

Agent Profile 是面向 AI 编码 Agent Runtime 的本地离线 profiler。它不是聊天记录
产品，而是把本地运行记录转换为可比较的资源、过程效率、可靠性和异常证据。

当前系统以 Session 为分析中心，已经可以回答 token、成本、时间、上下文、工具和
子 Agent 消耗在哪里，以及过程中发生了哪些重复、失败和退化。由于还没有统一的
Task 与 Outcome 数据，它目前不能仅凭过程指标判断最终交付是否正确，也不能直接
宣称某个 Agent 全面优于另一个 Agent。

## 当前数据源与数据流

当前已接入 Claude Code、Codex、Zed 和 MiMo：

```text
Claude Code JSONL ─┐
Codex rollout JSONL ├→ 来源适配器 → 导入协调器 → 统一 Session/Span
Zed SQLite + zstd ──┤                                   ↓
MiMo SQLite ────────┘                           分析 + 会话仓储
                                                        ↓
                                                     SQLite
                                                        ↓
                                               Fastify API → Next.js UI
```

各来源提供的字段覆盖度可能不同。“未采集”不能被解释为数值为零或执行失败。
每个来源都会提供来源类型、更新时间和稳定指纹。导入协调器统一判断跳过、新增、更新
和失败；会话仓储在同一事务中替换 Session/Span，并保留用户标签与备注。Zed 与 MiMo
的来源版本变化后会重新导入，不再因为 Session 已存在而永久跳过。

## 当前能力

- 分别保留 input、cache creation、cache read、output 四类 token。
- 按项目和 Agent 浏览、搜索、排序和筛选 Session，并支持标签、备注和多会话对比。
- 查看 LLM 回合、工具调用与参数、上下文增长、耗时、子 Agent、Git commit 和成本归因。
- 使用确定性启发式规则诊断重复读取、大输出、低缓存命中、上下文膨胀、长 thinking、
  重复失败和读取范围过大。
- 在配置 Anthropic-native 或 OpenAI-compatible API 后执行可选的 LLM 语义诊断；
  没有配置时，启发式分析与整个服务仍可正常使用。
- 展示过程效率、综合过程分、项目内相对位置、趋势、分布，以及按 Agent/项目/模型的
  消耗统计。
- 维护模型定价与上下文窗口，并在定价变化后重新计算历史成本。
- 导出 Session 数据和分析报告。

## 数据模型

当前 SQLite 由 `apps/server/src/database.ts` 管理五张内部表：

- `sessions`：来源类型、更新时间与版本指纹、Agent/模型/项目、四类 token 聚合、
  上下文、缓存、成本、耗时、标签和备注。
- `spans`：`llm_turn` 与 `tool_call` 的 token、上下文、成本、耗时、父子链、
  sidechain 和工具输入输出证据。
- `pricing`：模型四类 token 的人民币/百万 token 单价、单位与生效时间。
- `model_context`：模型上下文窗口。
- `schema_migrations`：按版本记录已执行的增量 schema 迁移。

兼容的新字段通过有序、幂等的 migration 补充；正常升级不应依赖删除 `trace.db`。
任何 schema 修改都必须在对应 Task 中写明 migration/backfill 与验证方案。
历史 Session 的来源指纹保持为空，并会在下一次扫描时安全刷新一次，而不是被错误地
当作最新数据。

## 指标边界

- `contextTokens = input + cacheCreation + cacheRead`
- `cacheHitRate = cacheRead / (input + cacheCreation + cacheRead)`
- 成本统一使用人民币，根据每个 LLM Span 的发生时间选择当时已生效的模型定价；同时
  保存定价生效时间、计算时间和计算器版本。未知定价必须显式展示为未知。
- 工具成本归因是按同一 LLM 回合内的工具类别进行分析分摊，不等于供应商账单。
- 效率分是“过程效率”，不能替代测试、构建或人工验收结果。
- LLM 语义诊断属于带证据的推断，应与确定性规则区分。

## 当前与未来

当前：

- 以 Session/Span 为核心；
- 能解释运行资源和过程异常；
- 能提供相对比较和人工复盘证据。

未来方案：

- 引入 Task、Configuration Snapshot、Outcome、Cohort 和 Experiment；
- 生成稳定的 Task Profile Report；
- 让 Agent Runtime 在任务结束后或运行中消费经过验证的建议；
- 把提示词和 Agent 规则作为可实验配置，而不是把“改提示词”作为唯一目标。

## 文档与 Task 流程

- `README.md`：面向用户的当前能力和启动入口。
- `ARCHITECTURE.md`：当前实现、API、数据和限制。
- `docs/roadmap.md`：Task 状态、验收条件与验证证据。
- `docs/agent-runtime-profile-design.md`：未来 Agent Runtime Profile 方案。
- `AGENTS.md`：仓库修改必须遵循的工作规范。

每次修改代码、schema、API、UI、配置或行为前，必须先在
`docs/roadmap.md` 建立明确 Task 并标记为 `in_progress`，写清针对性的文档计划、
验收条件和验证方式。实现完成后必须同步实际受影响的文档，记录验证结果，最后才能把
Task 标记为 `completed`。

## 端口与配置

- server 默认 `3000`，可通过 `PORT` 修改。
- web 默认 `3001`，可通过 `NEXT_PUBLIC_API` 修改 API 地址。
- LLM 诊断使用 `LLM_API_KEY`，以及可选的 `LLM_PROVIDER`、`LLM_MODEL` 和
  `LLM_BASE_URL`。
