# Agent Profile — 中文总览

> 本文描述当前已经实现的能力，并与 [中文 README](../../README.zh-CN.md)、
> `README.md`、`ARCHITECTURE.md` 和 [Profile 模型](../profile-model.md) 保持一致。
> Task、Outcome、Configuration Snapshot、Cohort、Experiment 与 Task Profile
> 已实现本地基础；自动实验评估和 Runtime feedback 仍是未来方案。

## 定位

Agent Profile 是面向 AI 编码 Agent 的本地优先运行画像、诊断与效果验证系统。它不是
聊天记录产品、云端监控平台、代码质量扫描器或 Agent 排行榜，而是把本地运行记录转换为
带范围、覆盖度与限制说明的资源、过程效率、可靠性和交付证据。

当前运行证据以 Session 为分析中心，已经可以回答 token、成本、时间、上下文、工具和
子 Agent 消耗在哪里，以及过程中发生了哪些重复、失败和退化。系统也可在不保存原文的
前提下检查提示词结构，并把缺口与可选 Agent 画像组合成迭代假设。Task 页面可关联多个
Session、记录版本/Hash 配置快照和显式 Outcome，生成带覆盖度的 `task-profile/v1`。
但系统仍不能仅凭过程指标判断最终交付是否正确，也不能直接宣称某个 Agent 全面优于
另一个 Agent 或某次配置改动一定有效。

## Profile 分层

- **Span/Event 证据**与 **Session 分析**：描述一次已观察到的运行过程，不保证是完整
  原始 transcript，也不证明交付成功。
- **Agent Process Profile**（`agent-profile/v1`）：按 Agent 聚合当前 Session 的资源、
  上下文、可靠性、协作、覆盖度和中性相对特征；它尚未按 Task、配置或 Outcome 分组。
- **Task Profile**（`task-profile/v1`）：描述一个交付单元的关联 Session、配置快照、
  显式 Outcome 覆盖度与聚合过程证据。
- **Cohort/Experiment**：当前只持久化比较定义、guardrail 和证据状态；自动分布比较、
  回归检测、配置赢家和 Runtime feedback 是未来能力。

Task 是把过程证据连接到交付结果的边界，不是产品唯一目的。所有 Profile 都必须说明
适用范围、样本量、字段覆盖度和限制；“高于/低于”描述观察到的行为，不是质量排名。

## 当前数据源与数据流

当前已接入 Claude Code、Codex、Zed、MiMo 和 OpenCode：

```text
Claude Code JSONL ─┐
Codex rollout JSONL ┤
Zed SQLite + zstd ──┼→ 来源适配器 → Import Runtime/导入协调器
MiMo SQLite ────────┤                              ↓
OpenCode SQLite ────┘                      分析 + 会话仓储
                                                   ↓
生产入口 → App Runtime ─────────────────────────→ SQLite
                  ├→ CLI 适配器
                  └→ Fastify 适配器 → Next.js UI
```

当前 `AppRuntime` 是应用组合边界：生产启动只创建一个选定的 SQLite 连接，并围绕它创建
定价/模型窗口解析器、每 Runtime 独立的导入服务与任务管理器、时钟和幂等关闭操作。
Fastify 只适配显式传入的 Runtime；路由不再创建生产数据库或导入单例。当前
`@agent-profile/cli` package 的 `doctor` 会直接创建并关闭同一个 Runtime，只刷新来源
可用性，不启动导入或 HTTP。源码 workspace 已提供 `agent-profile` binary，但尚未发布
正式发行包；日常 Web 入口仍是 `pnpm dev`/`pnpm start`。

各来源提供的字段覆盖度可能不同。“未采集”不能被解释为数值为零或执行失败。
每个来源都会提供来源类型、更新时间和稳定指纹。导入协调器统一判断跳过、新增、更新
和失败；会话仓储在同一事务中替换 Session/Span，并保留用户标签与备注。Zed、MiMo 与
OpenCode 的来源版本变化后会重新导入，不再因为 Session 已存在而永久跳过。
启动导入与首页“同步数据”共享同一个按来源去重的任务状态；同一来源不会并发重复扫描，
单个来源失败也不会阻断其他来源。状态接口只返回来源名称、可用性、已存数量、阶段、
汇总计数和时间，不返回原始内容、完整本地路径或来源 Session ID。
首页只从这份公开来源状态派生导入进度：没有已存 Session 时显示专门的数据准备页和可用
来源卡片；已有 Session 时保留列表和分析可用，只在侧栏数据操作附近显示一行可展开的
非模态进度。默认态显示操作与完成/可用来源数，展开后才显示逐来源状态；进度分母排除本机
未发现的来源，计数只代表来源完成数，不假装为文件或记录级百分比；任务结束后，页面使用
既有轮询刷新一次数据。
同一个任务管理器支持显式“强制重建”：它绕过相同来源指纹，但仍按 Session 解析并在
事务中原子替换，因此失败时旧分析保留，成功时标签和备注保留，当前不可用来源也不会被
清除。独立危险区重置需要完整确认短语，只删除 `sessions` 与 `spans`，保留定价、模型
窗口、migration，以及 Task、Outcome、Configuration Snapshot、Cohort、Experiment 和
逻辑 Session 关联。
Codex 使用 rollout 的 `session_meta.id` 作为线程级 Session 身份；旧格式缺少 `id`
时才回退到 `session_id`。子线程保留自己的 ID，其 Span 标记为 Sidechain，不再覆盖父
Session。
Codex Desktop 物化的外部 Agent 历史可通过 `external-import-turn-*`、缺少普通
`turn_context`、共享迁移时间以及文本形式的 `external_agent_tool_*` 记录识别。因为其
原始项目、模型、Token 分类和结构化工具证据不可信，导入器将其报告为
`excluded_non_actionable`，不生成 Session。Codex 解析版本指纹会让旧文件重新经过一次
判断；仓储只清理没有标签或备注的旧派生 Session，有用户标注时保留并报告失败。
OpenCode 数据库以只读方式打开。当前 Session 行保存 input、output、reasoning、cache read
和 cache write 聚合；导入器把 cache write 映射为 cache creation、单独保留 cache read，
并把 reasoning Token 计入 output。由于来源没有逐消息 Token，系统只创建一个标记为
`tokenUsageSource=session_aggregate` 的聚合 LLM Span，不虚构逐消息分配；成本仍按模型与
四类 Token 重新计算。

## 当前能力

- 通过源码 workspace 的 `agent-profile help/version/doctor` 检查 CLI 版本、所选 SQLite
  数据库和五种本地来源可用性，支持便于阅读的文本与 `agent-profile-cli/v1` JSON；
  `doctor` 不导入数据或启动 HTTP，但会执行正常数据库创建、migration 与默认数据初始化。
- 分别保留 input、cache creation、cache read、output 四类 token。
- 首次使用时以独立数据准备页展示可用来源、导入和失败状态；已有数据在后台同步期间仍可
  浏览，并通过侧栏紧凑、可展开的来源级状态显示当前操作和完成数，同步完成后只刷新一次。
- 在按时间边界组织的扁平最近列表中浏览 Session；可搜索的分组项目选择器区分会话记录、
  最近使用和其他项目，并展示短名称、父路径与数量。它可和不限时间/最近 1/7/30/90 天、
  渐进展开的 Agent/结果视图、标题/项目/路径搜索及排序组合。
  筛选与选中状态保存在 URL，浏览器返回可恢复列表；大结果集按 120 条一批增量渲染。
- 项目分类优先使用来源捕获的 `cwd`；没有该证据的 Codex Session 在列表和统计中统一显示
  为“Codex 会话记录”。Codex Desktop 为无项目会话生成的非空
  `~/Documents/Codex/YYYY-MM-DD/<session>` 工作目录也使用该分类；它和
  `~/.codex/sessions/YYYY/MM/DD/` 都是运行/日期分区，不会被当成项目，原始路径仍保留。
- 来源标题优先；无标题 Session 只在界面中用 Agent、项目和本地开始时间组成可辨识
  标题，不从 prompt、answer 或 reasoning 内容派生，也不把该回退写入数据库。
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
- 生成 `agent-profile/v1` Agent Process Profile，从资源、上下文、工具可靠性和
  sidechain 协作维度比较 Agent；每项均包含样本量、覆盖度和解释边界。
- 生成 `prompt-review/v1` 和 `iteration-hints/v1`：确定性检查目标、范围、验收、
  约束、上下文和验证结构，并可选择结合 Agent 画像提出待验证的调整假设。
- 在“任务”工作区关联多个 Session 与版本/Hash 配置快照，记录显式 Outcome，并生成
  带 Session/Outcome/成本覆盖度和限制的 `task-profile/v1`。
- 维护模型定价与上下文窗口，并在定价变化后重新计算历史成本。
- 导出 Session 数据和分析报告。

## 数据模型

当前 SQLite 由 `apps/server/src/database.ts` 管理十一张内部表：

- `sessions`：来源类型、更新时间与版本指纹、Agent/模型/项目、四类 token 聚合、
  上下文、缓存、成本、耗时、标签和备注。
- `spans`：`llm_turn` 与 `tool_call` 的 token、上下文、成本、耗时、父子链、
  sidechain 和工具输入输出证据。
- `pricing`：模型四类 token 的人民币/百万 token 单价、单位与生效时间。
- `model_context`：模型上下文窗口。
- `schema_migrations`：按版本记录已执行的增量 schema 迁移。
- `tasks`：本地任务身份、项目、类型、状态、复杂度与内容保存模式。
- `config_snapshots`：Agent/模型、规则/工具/模板版本与来源 Hash，不复制规则或 prompt 原文。
- `task_sessions`：一个 Task 到多个 Session、角色和可选配置快照的逻辑关联。
- `task_outcomes`：可空的 build/test/lint/Git/人工结果与结构化证据；空值表示未采集。
- `cohorts`：比较范围定义与生命周期。
- `experiments`：控制/候选配置、主要指标、guardrail、证据状态与受约束决策。

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
- 能持久化 Task、Configuration Snapshot、Outcome、Cohort 和 Experiment，并生成
  `task-profile/v1`；缺失 Outcome 与失败严格区分。
- 能从源码 workspace 运行 `agent-profile help/version/doctor`；同步、查询、报告、
  `serve` 和正式发行制品尚未实现。
- 自动 cohort 统计、回归检测、因果实验结论和 Runtime feedback 尚未实现。

未来方案：

- 为 cohort/experiment 增加最低样本统计、guardrail 与回归检测；
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

- `packages/cli/bin/agent-profile.mjs doctor` 按 `--database`、
  `--data-dir/trace.db`、`TRACE_DB_PATH`、现有 Runtime 默认值的顺序选择数据库；
  `--json` 输出版本化报告。命令用法错误 exit code 为 `2`，Runtime 失败为 `1`。
- 根目录 `pnpm dev` 会并行启动 server 与 web，server 源码变化后会自动重启，不再需要
  分别打开两个终端。
- 根目录 `pnpm start` 会先构建 workspace，再以非 watch 模式并行启动生产 Web 与 API，
  作为日常本地运行入口。
- server 默认 `3000`，可通过 `PORT` 修改。
- web 默认 `3001`，可通过 `NEXT_PUBLIC_API` 修改 API 地址。
- Server 与 Web 默认只绑定 `127.0.0.1`；API CORS 默认只接受本机 `3001` 来源。
  `HOST` 和逗号分隔的 `WEB_ORIGIN` 可显式覆盖。由于 API 没有认证与目录授权，非回环
  `HOST` 只适合可信网络，启动时会输出警告。
- Web 开发产物写入 `apps/web/.next-dev`，生产构建仍写入 `apps/web/.next`，因此
  运行中的 `pnpm dev` 不会再被 `pnpm build` 替换 chunk。
- 首页“同步数据”与启动导入共享任务管理器，检查 Claude Code、Codex、Zed、MiMo 和 OpenCode，
  并按来源展示新增、更新、跳过与失败数量。
- 首页更多菜单提供“刷新显示”，独立“数据管理”弹窗提供强制重建和需要确认的本地生成
  数据清空；重建是 parser/指标变化后
  的推荐恢复方式，清空前应停止 Server 并备份 `apps/server/trace.db` 或
  `TRACE_DB_PATH` 指定文件。
- 文件级恢复必须在 Server 停止时把备份复制回数据库路径；健康数据库的派生分析刷新应
  使用强制重建。兼容的 `POST /api/scan` 仍接受 `dir` 与可选 `agent`，供脚本按显式目录
  导入；页面继续使用多来源任务。
- LLM 诊断使用 `LLM_API_KEY`，以及可选的 `LLM_PROVIDER`、`LLM_MODEL` 和
  `LLM_BASE_URL`。
