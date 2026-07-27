# Agent Profile — 中文总览

> 本文描述当前已经实现的能力，并与 [中文 README](../../README.zh-CN.md)、
> `README.md`、`ARCHITECTURE.md` 保持一致。
> 面向 Agent Runtime 的 Task、Outcome、Configuration 与反馈闭环仍是
> `docs/agent-runtime-profile-design.md` 中的未来方案。

## 定位

Agent Profile 是面向 AI 编码 Agent Runtime 的本地离线 profiler。它不是聊天记录
产品，而是把本地运行记录转换为可比较的资源、过程效率、可靠性和异常证据。

当前运行证据以 Session 为分析中心，已经可以回答 token、成本、时间、上下文、工具和
子 Agent 消耗在哪里，以及过程中发生了哪些重复、失败和退化。系统也可在不保存原文的
前提下检查提示词结构，并把缺口与可选 Agent 画像组合成迭代假设。由于还没有统一的
Task 与 Outcome 数据，它目前不能仅凭过程指标判断最终交付是否正确，也不能直接
宣称某个 Agent 全面优于另一个 Agent 或某次提示词改动一定有效。

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
启动导入与首页“重新扫描”共享同一个按来源去重的任务状态；同一来源不会并发重复扫描，
单个来源失败也不会阻断其他来源。状态接口只返回来源名称、可用性、已存数量、阶段、
汇总计数和时间，不返回原始内容、完整本地路径或来源 Session ID。
同一个任务管理器支持显式“强制重建”：它绕过相同来源指纹，但仍按 Session 解析并在
事务中原子替换，因此失败时旧分析保留，成功时标签和备注保留，当前不可用来源也不会被
清除。独立危险区重置需要完整确认短语，只删除 `sessions` 与 `spans`，保留定价、模型
窗口和 migration。
Codex 使用 rollout 的 `session_meta.id` 作为线程级 Session 身份；旧格式缺少 `id`
时才回退到 `session_id`。子线程保留自己的 ID，其 Span 标记为 Sidechain，不再覆盖父
Session。
Codex Desktop 物化的外部 Agent 历史可通过 `external-import-turn-*`、缺少普通
`turn_context`、共享迁移时间以及文本形式的 `external_agent_tool_*` 记录识别。因为其
原始项目、模型、Token 分类和结构化工具证据不可信，导入器将其报告为
`excluded_non_actionable`，不生成 Session。Codex 解析版本指纹会让旧文件重新经过一次
判断；仓储只清理没有标签或备注的旧派生 Session，有用户标注时保留并报告失败。

## 当前能力

- 分别保留 input、cache creation、cache read、output 四类 token。
- 首次使用时展示四个数据源的发现、导入、失败与重试状态；已有数据在后台同步期间仍可
  浏览，同步完成后只刷新一次。
- 按项目和 Agent 浏览、搜索、排序和筛选 Session，并支持标签、备注和多会话对比。
- Session 详情固定展示身份、Token 指纹和主要 KPI，再拆分为“概览”“上下文与成本”
  “工具与链路”“运行证据”四个视图，避免把所有分析卡片一次性纵向堆叠。
- 查看 LLM 回合、工具调用与参数、上下文增长、耗时、子 Agent、Git commit 和成本归因。
- 通过 `session-evidence/v1` 查看全部已归一化 Span 的统一时间线、父级/Sidechain
  关系、保守结果状态和字段覆盖度，并按类型、链路、错误筛选。
- 使用确定性启发式规则诊断重复读取、大输出、低缓存命中、上下文膨胀、长 thinking、
  重复失败和读取范围过大。
- 在配置 Anthropic-native 或 OpenAI-compatible API 后执行可选的 LLM 语义诊断；
  没有配置时，启发式分析与整个服务仍可正常使用。
- 展示过程效率、综合过程分、项目内相对位置、趋势、分布，以及按 Agent/项目/模型的
  消耗统计。
- 生成 `agent-profile/v1` 运行画像，从资源、上下文、工具可靠性和 sidechain 协作
  维度比较 Agent；每项均包含样本量、覆盖度和解释边界。
- 生成 `prompt-review/v1` 和 `iteration-hints/v1`：确定性检查目标、范围、验收、
  约束、上下文和验证结构，并可选择结合 Agent 画像提出待验证的调整假设。
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
- Agent 相对画像要求目标和至少一个同类 Agent 各有 3 个 Session，且指标覆盖度至少
  50%；与同类中位数相差 ±10% 以内记为“接近”，其余只描述“高于/低于”，不代表
  更好或更差。
- 提示词审查只使用本地确定性启发式，不调用语义模型、不写入数据库，也不返回总分。
  原文证据默认关闭；主动开启时，每项最多返回两段经过密钥遮蔽、长度受限的片段。
  结构命中与运行画像的相关性不是因果结论，最终必须由同类 Task Outcome 验证。
- Session 证据默认不返回工具输入/输出、thinking 或 answer 文本；主动加载预览时才会
  进行常见密钥遮蔽并限制为每字段 500 字符。时间线覆盖全部已存储 Span，但由于各来源
  尚未统一生成用户消息 Span，它不是完整原始对话。“未观察到错误”也不等于已验证成功。

## 当前与未来

当前：

- 以 Session/Span 为核心；
- 能解释运行资源和过程异常；
- 能以渐进披露方式检查规范化 Session/工具证据及其缺失项；
- 能提供带样本量和覆盖度的 Agent 运行画像、相对比较和人工复盘证据；
- 能提供无持久化的提示词结构审查和带护栏的下一步实验假设；
- 尚未采集 Task Outcome，因此画像不能判断最终交付是否正确。

未来方案：

- 引入 Task、Configuration Snapshot、Outcome、Cohort 和 Experiment；
- 生成稳定的 Task Profile Report；
- 让 Agent Runtime 在任务结束后或运行中消费经过验证的建议；
- 把提示词和 Agent 规则作为可实验配置，而不是把“改提示词”作为唯一目标。

## 文档与 Task 流程

- `README.md` 与 `README.zh-CN.md`：面向用户的中英文当前能力和启动入口。
- `ARCHITECTURE.md`：当前实现、API、数据和限制。
- `docs/roadmap.md`：Task 状态、验收条件与验证证据。
- `docs/agent-runtime-profile-design.md`：未来 Agent Runtime Profile 方案。
- `AGENTS.md`：仓库修改必须遵循的工作规范。

每次修改代码、schema、API、UI、配置或行为前，必须先在
`docs/roadmap.md` 建立明确 Task 并标记为 `in_progress`，写清针对性的文档计划、
验收条件和验证方式。实现完成后必须同步实际受影响的文档，记录验证结果，最后才能把
Task 标记为 `completed`。

## 端口与配置

- 根目录 `pnpm dev` 会并行启动 server 与 web，server 源码变化后会自动重启，不再需要
  分别打开两个终端。
- server 默认 `3000`，可通过 `PORT` 修改。
- web 默认 `3001`，可通过 `NEXT_PUBLIC_API` 修改 API 地址。
- Web 开发产物写入 `apps/web/.next-dev`，生产构建仍写入 `apps/web/.next`，因此
  运行中的 `pnpm dev` 不会再被 `pnpm build` 替换 chunk。
- 首页“重新扫描”与启动导入共享任务管理器，检查 Claude Code、Codex、Zed 和 MiMo，
  并按来源展示新增、更新、跳过与失败数量。
- 首页“数据管理”提供强制重建和独立确认的本地生成数据清空；重建是 parser/指标变化后
  的推荐恢复方式，清空前应停止 Server 并备份 `apps/server/trace.db` 或
  `TRACE_DB_PATH` 指定文件。
- LLM 诊断使用 `LLM_API_KEY`，以及可选的 `LLM_PROVIDER`、`LLM_MODEL` 和
  `LLM_BASE_URL`。
