# Agent Profile

[English README](README.md) · [Profile 模型](docs/profile-model.md) · [当前架构](ARCHITECTURE.md) · [演进方案](docs/profile-evolution-plan.md) · [任务路线图](docs/roadmap.md)

Agent Profile 是面向 AI 编码 Agent 的本地优先运行画像、诊断与效果验证系统。它导入
本机的 Claude Code、Codex、Zed、MiMo 和 OpenCode 会话数据，帮助你理解 Token、
上下文、成本、耗时、工具调用和子 Agent 的消耗去向，并能将这些过程证据关联到显式
Task Outcome，而不会把更低的资源消耗误作更好的交付结果。

它分析的是**已观察到的运行过程**与本地交付证据，不是聊天记录阅读器、云端监控平台、
代码质量扫描器，也不会给 Agent 给出绝对能力排名。Profile 的术语与当前/未来边界见
[Profile 模型](docs/profile-model.md)。来源监听只会在本地历史记录变化并导入后刷新证据，
不等于对正在执行的 Agent 做 live tracing，也不会自动调整 Agent 配置。

## 适合解决什么问题

- 哪些本地编码 Agent 会话花费最多，或让上下文增长最快？
- 某个工具是否反复失败、输出异常大，或引发上下文突增？
- 不同 Agent、模型或项目的资源与工具使用方式有什么差异？
- 一段任务提示词是否清楚写明目标、范围、验收条件和验证方式？
- 配置调整是只降低了过程成本，还是在可比交付工作中仍保住了 build/test/lint 结果？

## 使用前准备

- 安装 Node.js 22 或更高版本（建议使用仍受支持的 LTS 版本）
- 安装 pnpm
- 如需导入 Zed transcript，确保 `zstd` 位于 `PATH`
- 本机至少存在一种支持的 Agent 数据源；没有某个来源不会阻止应用启动

## 快速开始

```bash
pnpm install
pnpm dev
```

在浏览器打开 [http://localhost:3001](http://localhost:3001)。Fastify API 默认使用
`3000` 端口，Web 页面默认使用 `3001` 端口。

`pnpm dev` 会同时启动 API 和 Web；修改 Server 源码后 API 会自动重启。只有需要单独
排查某一进程时，才分别运行各 package 的 `dev` 命令。

日常本地使用如果不需要文件监听，可运行：

```bash
pnpm start
```

根命令会先构建整个 workspace，再同时启动 API 与生产 Web Server。两者默认只绑定
`127.0.0.1`。

构建当前平台与架构的首个 Node 发行包：

```bash
pnpm build:release
tar -xzf dist/releases/agent-profile-0.0.1-<platform>-<arch>.tar.gz
./agent-profile-0.0.1-<platform>-<arch>/bin/agent-profile.mjs serve --open
```

归档包含 CLI、Next.js standalone Web Server 和匹配平台/架构的原生
`better-sqlite3`，目标机器仍需 Node.js 22+ 与 `zstd`。当前只是本地发行构建自动化，
尚不是已发布 package、签名安装器或跨平台通用归档。

Web 开发产物写入 `apps/web/.next-dev`，生产构建产物写入 `apps/web/.next`，因此运行
`pnpm build` 不会破坏正在运行的开发服务。

源码 workspace 现在也提供首个 `agent-profile` CLI 入口：

```bash
./packages/cli/bin/agent-profile.mjs help
./packages/cli/bin/agent-profile.mjs version --json
./packages/cli/bin/agent-profile.mjs doctor --data-dir ./local-data
./packages/cli/bin/agent-profile.mjs doctor --project . --json
./packages/cli/bin/agent-profile.mjs serve --project . --open
./packages/cli/bin/agent-profile.mjs sources --json
./packages/cli/bin/agent-profile.mjs sync --source codex --source zed
./packages/cli/bin/agent-profile.mjs sessions --limit 20 --json
./packages/cli/bin/agent-profile.mjs stats --json
./packages/cli/bin/agent-profile.mjs profiles --json
./packages/cli/bin/agent-profile.mjs task-profile <task-id> --json
./packages/cli/bin/agent-profile.mjs diagnosis <session-id> --json
./packages/cli/bin/agent-profile.mjs evidence <session-id> --json
./packages/cli/bin/agent-profile.mjs task-outcome <task-id> --confirm --evidence-kind review --evidence-status observed --json
./packages/cli/bin/agent-profile.mjs task-feedback <task-id> --opt-in --json
./packages/cli/bin/agent-profile.mjs serve --open
```

`doctor` 会创建并关闭与 Server 相同的应用 Runtime，检查选中的 SQLite 数据库和五种
本地来源的可用性；默认输出便于阅读的文本，使用 `--json` 时输出
`agent-profile-cli/v1`。它不会启动 HTTP，也不会导入来源数据。打开 Runtime 可能会创建
所选数据库，并执行常规增量 migration 和默认定价/模型窗口数据初始化。

CLI Runtime 命令的数据库路径优先级依次为 `--database`、`--data-dir/trace.db`、显式项目的
`<project>/.agent-profile/trace.db`、`TRACE_DB_PATH` 和平台应用数据目录默认值。`--project`
必须指向已存在的目录；它会规范化项目根目录，限定导入与数据管理操作，并把缺失的 `cwd`
证据标记为“未分配”，不会猜测归属。成功 exit code 为 `0`，命令用法错误为 `2`，Runtime
失败为 `1`。

`serve` 启动私有 Next.js 进程，并通过同一个回环 Fastify origin 暴露 Web UI 与 `/api`。
公开端口默认 `3000`，私有 Web 端口默认 `3001`；只有传入 `--open` 才打开浏览器。
`--host` 只接受回环地址，`--port` 与 `--web-port` 不能相同。

`sources` 会刷新本地来源可用性并输出已存主链 Session 计数，但不会返回本地路径或
transcript 标识。`sync` 使用与 API 相同的 Runtime 导入服务，等待所选来源进入终态后输出
逐来源结果。不传 `--source` 时选择全部支持的来源，重复该选项可选择多个来源。它不会启动
HTTP，但会把派生的本地 Session/Span 数据导入所选数据库；`diagnosis` 与 `evidence` CLI
查询提供无内容、有界的 finding/event references，完整详情和按需预览仍以 Web/API 为主。

`sessions` 返回当前主链 Session 的有界摘要页：默认 20 条、最多 100 条，按开始时间和 ID
排序。把上一份 JSON 报告中的不透明 `nextCursor` 通过 `--cursor` 传回即可继续翻页。报告不含
本地路径、transcript 标识、Span metadata 或内容；详细 Session 分析、cursor 分页证据时间线和
按需脱敏预览仍以 Web/API 为主。

`stats`、`profiles` 与 `task-profile <id>` 分别输出已经实现的汇总统计、Project Profile、Agent Process
Profile 和显式 Task Profile。JSON 会保留原报告的指标覆盖度与 limitations。过程证据不能证明
交付质量；`/api/experiments/:id/profile` 在 Outcome 和指标覆盖达到最低门槛时输出有界的
cohort/configuration 分布与 guardrail 结果。Cohort 可声明 `comparability.dimensions`（`project_id`、
`task_type`、`complexity`）；缺少 control/candidate 对照或 Outcome 覆盖不足的 strata 会被排除并显式
报告。报告区分 `ready`、`insufficient_evidence`、`not_comparable`，并提供中位数/IQR、样本标准差和
有界的 95% 正态近似 effect 区间；这些只是描述性观察，不推断通用或因果赢家。Agent Profile 的相对观察
不是通用质量排名，Task Profile 只覆盖其显式关联的 Session 与本地记录的 Outcome 证据。
已完成且 Outcome 已验证的 candidate Task 可通过显式
`GET /api/tasks/:id/feedback?optIn=true` 读取 `post-run-feedback/v1`；它只引用
Experiment 的有界证据与 limitations，证据不足或过期时会抑制，不会自动修改配置。

`diagnosis <session-id>` 和 `evidence <session-id>` 提供无内容、有限长度的 Agent 可消费报告：诊断只返回
finding 类型、严重级别、token/cost 影响和精确 Span ID；证据只返回稳定事件引用和覆盖度，不返回
prompt、answer、thinking、tool input/output、本地路径或 transcript 标识。`task-outcome <task-id>`
必须带 `--confirm --evidence-kind ...`，只追加显式提供且经过 Task repository 校验的证据，不推断任何
检查通过；`task-feedback <task-id>` 必须带 `--opt-in`，读取已有的只读、有界 `post-run-feedback/v1`。
四个命令在 `--json` 下都输出 `agent-profile-cli/v1` wrapper。
Web 还提供只读的 `/projects` 项目页面，查看一个项目已观察到的主链 Session；它不代表完整仓库
活动，也不判定交付质量。

## 第一次导入数据

Server 启动后会创建一个可观察的后台导入任务。没有已存 Session 时，页面会切换为专门的
本地数据准备页，逐一展示可用来源和来源级进度，避免普通空列表看起来像页面卡死；已有
数据时，同步或强制重建只在侧栏显示一行紧凑、可展开的非模态状态，Session 列表和分析
仍可使用；默认只显示真实的来源完成数，需要时再展开逐来源详情。完成后页面会自动刷新
本地数据。

| 来源 | 默认本机位置 | 导入时机 |
| --- | --- | --- |
| Claude Code | `~/.claude/projects` | 启动、“同步数据”与观测到 JSONL 变化时 |
| Codex | `~/.codex/sessions` | 启动、“同步数据”与观测到 JSONL 变化时 |
| Zed | 本机 Zed `threads.db` | 数据库存在时启动、“同步数据”与观测到 DB/WAL 变化时 |
| MiMo | 本机 `mimocode.db` | 数据库存在时启动、“同步数据”与观测到 DB/WAL 变化时 |
| OpenCode | `~/.local/share/opencode/opencode.db` | 数据库存在时启动、“同步数据”与观测到 DB/WAL 变化时 |

如果列表为空，可使用首次导入面板或点击首页的**同步数据**。它与启动导入共享同一个
按来源去重的任务，检查五种来源并显示新增、更新、跳过和失败数量。状态接口和页面不会
返回原始对话、完整本地路径或来源 Session ID。
进度刻意只到来源级：Server 没有提供文件或记录级百分比，因此单个大型来源处理时，进度
计数可能暂时不变；本机未发现的来源不会计入进度分母。

首页只把**同步数据**作为主数据操作；更多菜单提供**刷新显示**，并用独立的
**数据管理**弹窗承载强制重建和清空本地生成数据，不再占用 Session 列表高度。
强制重建会重新处理所有当前可用来源，即使来源指纹没有变化，同时保留 Session 标签、
备注、定价、模型窗口、migration，以及当前不可用来源的已有 Session。清空操作位于独立
危险区，必须输入页面给出的完整确认短语。

会话默认按时间边界展示为一个扁平的最近列表，不需要先展开项目文件夹；每行仍显示项目
标签。可搜索、分组的项目选择器将会话记录分类、最近使用项目和其他文件系统项目分开，
分别显示短项目名、父路径与数量，同时继续用规范项目 key 保存筛选。它可与不限时间/最近
1/7/30/90 天、折叠的 Agent/结果视图、项目/Agent/Session ID 搜索，以及按时间、成本、
Token、缓存、耗时排序组合使用。版本化 `session-discovery/v2` 在 SQLite 中执行筛选和排序，
返回匹配数/总数、Agent/项目 facets，并用与查询绑定的 keyset cursor 翻页。首页每次加载
120 条匹配 Session，接口上限为 200 条；打开 Session 或浏览器返回时筛选与选中状态由 URL
保留。

配置的本地来源发生变化后，Server 会去抖事件并复用同一套 revision 判断与原子替换导入；
content-free 的更新 cursor 只在存储证据实际变化后刷新首页和当前详情。30 秒内变化的行显示
“正在更新”，五分钟内变化的行显示“最近活跃”，并在时间排序下优先分组。这只是来源 revision
的新鲜度推断，不证明 Agent 进程仍在运行，也不把暂时安静的 Session 宣称为已完成。来源监听
不可用时，仍可使用“同步数据”恢复。

有界首页响应不会返回来源 Session 标题、本地路径、transcript 标识、标签/备注，以及
prompt、reasoning、answer 或工具内容。因此列表只用 Agent、项目和开始时间生成展示标题，
不读取内容，也不暴露不透明来源标题；Session 页面使用有界 `session-analysis/v1` 摘要和
cursor 分页的 `session-evidence-page/v1`，兼容全量详情接口与 `/api/sessions` 继续保留。
项目标签优先使用来源捕获的 `cwd`；没有这项项目证据的 Codex Session 统一显示为
“Codex 会话记录”。Codex Desktop 为无项目会话生成的非空
`~/Documents/Codex/YYYY-MM-DD/<session>` 工作目录也归入同一分类；该工作目录和
`~/.codex/sessions/YYYY/MM/DD/` 来源目录都只是运行/日期分区，不会被推断成项目。该
展示与统计规则保留原始路径，不需要重新导入。首页总览、最近工具、成本/Token Top 列表
来自有界 `home-statistics/v1`；完整 `/api/stats` 仍保留，并改为 SQLite set-based 聚合。

**任务**页面在 Session 过程分析之上补充本地交付证据。一个 Task 可关联多个 Session、
绑定只保存版本/Hash 的 Configuration Snapshot，并记录 build/test/lint/Git 状态、1–5 分
人工评分、返工原因、完成时间，以及最多 50 条结构化证据。每条证据要求 kind，并可带验证
状态、本地引用，以及本地辅助产生时的有界 provenance；非法证据会被拒绝，不会被静默转成结果。缺失 Outcome 会明确保持“未采集”，
不会变成失败。`task-profile/v1` 只聚合当前可用的关联 Session，并展示覆盖度与限制；其中
verified 覆盖严格由 build、test、lint、Git commit 和人工评分五项组成。Cohort 和
Experiment API 可保存比较定义与证据状态，但不会自动计算因果赢家。符合条件的 completed
candidate Task 可在任务页面显式读取只读 `post-run-feedback/v1`，其内容只含有界 cohort
证据与限制，不含提示词、规则、transcript 或思维链。

`verified` 只表示五项覆盖字段都已记录，不表示 build/test/lint 都通过；`failed`、
`skipped` 和 `not_run` 仍是有效、应保留的 Outcome 证据。

任务页可从本地观测 Session 显式预填新 Task 的标题和项目，也可通过
`GET /api/tasks/:id/assistance` 读取有界的 `task-assistance/v1` 候选报告。候选只使用相同
project key 与七天本地时间窗口；每个 Session 关联和 Git 证据都要单独确认。确认的 Session
关联会保留 producer/时间/来源 provenance，Git 候选只进入 Outcome 草稿，仍需显式保存；任何
候选都不会把 build/test/lint 或交付标记为成功，也不读取 prompt 或 transcript 原文。

已批准的只读 `outcome-evidence/v1` 本地 Git adapter 只能在显式选择来源后调用：
`GET /api/tasks/:id/outcome-evidence?source=local_git`。报告保留 producer、采集时间、来源引用、
采集限制和 limitation；`not_captured`、`observed` 与 `passed`、`failed`、`skipped`、`not_run`
明确区分，观测到 Git metadata 不等于验证通过。该 adapter 只执行固定的 Git metadata 查询，
不执行任意命令或 build/test/lint，不上传内容，也不自动写入 Outcome；远程 CI/review connector
尚未启用。

本地 loopback Runtime collector 通过 `POST /api/runtime/events` 接收 `runtime-event/v1` metadata，
并通过 `GET /api/runtime/runs/:runId/events` 返回有界、按 sequence 排序的引用。事件只包含
Task/Run identity、sequence、parent reference、生命周期 kind、时间和白名单 metadata；精确重复
幂等处理，sequence 冲突拒绝且不覆盖已有事件，乱序到达会保留并标记 ordering coverage。它只是
本地观测来源，不是 live hint、自动配置控制，也不替代 transcript 导入。
事件生产方只有在明确确认该批次覆盖完整时才设置 `coverageComplete: true`；缺失或为 false 时，
Runtime hint 的覆盖度保持 unknown 并抑制提示。

显式调用 `GET /api/runtime/runs/:runId/hint?optIn=true` 后，只有在 Runtime 事件新鲜且完整、历史
cohort evidence 达到 ready、并观察到重复工具失败信号时，才会返回有界的 `runtime-hint/v1` 假设。
提示短时有效、按 Run 限流且不含原始内容，只保留事件和 Experiment 引用。通过
`POST /api/runtime/hints/:hintId/adoption` 才能显式记录 `adopted`、`ignored` 或 `not_recorded`；
后续工具行为不会反推采纳，也不会修改 Agent 配置。

## 如何理解 Profile

- **Session 分析**解释一次已观察到的运行；它是过程证据，不是交付成功证明。
- **Agent Process Profile**（`agent-profile/v1`）展示一个 Agent 当前 Session 集合上的
  资源、上下文、可靠性、协作、覆盖度和中性同类相对特征。
- **Project Profile**（`project-profile/v1`）展示一个项目 key 下 primary Session 的
  资源汇总、来源/指标覆盖、工具可靠性和日趋势；它是有界过程证据，文件覆盖可能保持“未采集”。
- **Task Profile**（`task-profile/v1`）展示一个交付单元的关联 Session/配置、Outcome
  覆盖度与聚合过程证据。
- **Verified Post-Run Feedback**（`post-run-feedback/v1`）在显式 opt-in 后展示完成且
  Outcome 已验证的 candidate Task 的有界 Experiment 发现；证据不足或过期时会抑制。
- T117 的本地运行中 hint 已实现，但外部 Runtime SDK、自动实验结论、回归决策和配置修改仍是后续能力。

OpenCode 适配器以只读方式打开本机 SQLite。当前来源把 Token 总量保存在 Session
聚合字段中，而不是逐消息记录；Agent Profile 因此保留一个明确标记的聚合 LLM 回合，
不会虚构逐消息分配。cache write 映射为 cache creation，cache read 单独保留，reasoning
Token 计入 output 使用量。成本仍按模型和四类 Token 重新计算，不把来源数据库中的聚合
cost 当作可移植的计费证据。

## 页面怎么用

- **会话**：在扁平最近列表中按项目和 Agent 筛选数据；进入会话后可分别查看概览、上下文与成本、工具与
  链路、规范化运行证据。
- **项目**：查看一个项目已观察到的主链 Session、来源和指标覆盖度，以及按 UTC 日期汇总的工具/资源轨迹。
- **任务**：把多个 Session 和配置版本关联到显式交付 Outcome，查看带覆盖度的 Task Profile，
  并读取符合条件的任务后反馈。
- **画像**：在样本量和字段覆盖度限制下，查看 Agent Process Profile。“高于/低于”只
  表示观察到的行为差异，不代表谁更好。
- **迭代**：本地检查任务提示词的目标、范围、验收、约束、上下文和验证结构。结合运行
  画像得到的建议是待验证假设，不会自动改写提示词。
- **统计**：查看 Token、成本、上下文，以及项目、Agent、模型的汇总和分布；选择项目后还可查看
  有界的 Project Profile。

会话证据页通过与查询绑定的 `(开始时间, ID)` cursor 可到达所有**已存储并归一化的 Span**，
但不等同于完整原始 transcript。默认每页 80 条，类型、主链/Sidechain 和结果筛选在服务端
执行，同时返回完整 Session 的覆盖度及匹配数/总数。默认不显示内容；主动加载时只读取当前
页字段，并展示经过密钥遮蔽、每字段最多 500 字符的预览。详情概览保留完整聚合语义，但上下文、
工具和 Sidechain 明细分别采用采样或有界窗口，不再把完整 Span 数组保存在浏览器中。
诊断 finding 如果带有已存储的 Span 引用，可通过精确、有界的 `spanIds` 定位打开证据页；
URL 会保留定位状态，默认仍是 `content=none`。目标缺失或被当前筛选排除时会明确提示；
没有 Span 引用的 finding 不会从相邻事件推断证据。

Codex Desktop 物化的外部 Agent 历史如果只有 `external-import-turn-*`、缺少正常运行
上下文，且工具过程只是文本包装，会被标记为不可分析并排除。这类记录的项目和工具证据
不可信，因此不会制造莫名项目文件夹，也不会抬高 Codex/工具统计。导入时会清理以前
生成且没有标签、备注的副本；已有用户标注的记录会保留并报告失败，不会静默删除。

## 配置

| 变量 | 作用 |
| --- | --- |
| `PORT` | API 端口，默认 `3000` |
| `HOST` | API 绑定地址；仅接受回环地址，默认 `127.0.0.1` |
| `WEB_ORIGIN` | API CORS 允许的浏览器来源，多个值用逗号分隔；默认仅允许本机 `3001` Web 来源 |
| `NEXT_PUBLIC_API` | 可选 Web API 覆盖；打包及默认 Web 请求使用同源 `/api` |
| `AUTO_SCAN_DIR` | 未设置：扫描默认 Claude Code 与 Codex 目录；空字符串：关闭 transcript 自动扫描；路径：只扫描该一个 transcript 目录。 |
| `TRACE_DB_PATH` | CLI 未指定路径选项时覆盖 Server/CLI SQLite 路径 |
| `LLM_API_KEY` | 开启可选语义诊断；确定性分析不需要 Key |
| `LLM_PROVIDER`、`LLM_MODEL`、`LLM_BASE_URL` | 可选语义诊断服务配置 |

设置 `LLM_API_KEY` 后，只有显式发起带 `semantic=opt_in` 的诊断请求才会使用配置的
provider。通过 `LLM_BASE_URL` 配置的 provider 可以是本地或外部服务，但 Agent Profile 不会
判断或验证 endpoint 的本地性；未覆盖时默认使用外部的 DeepSeek-compatible endpoint。
Web 会先展示 disclosure：只发送有界且经过常见密钥脱敏的 Session 标题、thinking 和工具输入
片段；HTTP 响应只返回 provider、数量、脱敏次数和状态，不返回 payload 内容。进程内有界 audit
只保留 Session ID、时间、状态和 payload 计数，不保存原始来源或 provider 响应内容。未配置 Key
或不主动 opt-in 时，仍只运行本地确定性诊断。

Web 顶栏的 **Provider** 会打开 `/settings/provider`：这里会显示非敏感配置状态，并提供
Provider、Base URL、模型和 API key 的配置表单。Session 诊断卡片在未配置时也会直接链接到
该页面。保存后回到 Session，明确点击“允许并运行语义诊断”；仅保存配置不会发送 payload。
API key 只在提交时发送给本机 Server，保存后会从表单清除，状态接口不会返回 key。

模型、上下文和诊断配置分别属于不同范围：

- `/api/model-context` 只编辑精确 raw model 的上下文窗口参考值，用于窗口利用率和上下文
  堆积分析。未知 model ID 不会继承 provider 或 alias 的值；默认值及供应商文档入口记录在
  `apps/server/src/model-catalog/defaults.ts` 中。
- `/api/pricing` 保存四类 Token 单价和可选的 `effectiveFrom`。导入和重算会按每个 LLM
  Span 的发生时间选择已生效价格；缺少定价仍保持 unknown。`POST /api/recompute-cost`
  是显式的历史成本重算操作。
- `/api/model-catalog/*` 提供 `model-catalog/v1` observed raw-model inventory、价格
  历史/来源、精确上下文配置、版本化本地 JSON 导入导出，以及只读 preview + 固定 revision
  execute 的范围化重算。`/settings/models` 是对应 Web 工作区：优先显示未定价/不支持模型，
  配置保存后不会自动重算，必须先预览并明确确认；导出内容不含 Session 或 prompt。
- 确定性诊断阈值是 Core 内置策略常量，不是可由用户编辑的 Runtime 配置；诊断里的
  `wastedCost` 是以当前分析时点 input 价格计算的 planning 上限估算，不是历史账单证据。
- Task Configuration Snapshot 只记录 Task 明确提供的 Agent/model/version 标识和 source
  hash，不会静默快照定价、上下文限制、prompt 或 rules。

例如，不在启动时扫描 transcript：

```bash
AUTO_SCAN_DIR="" pnpm dev
```

## 本地数据与隐私

- Agent Profile 读取本地来源记录，并把派生的 Session/Span 数据写入 SQLite；默认不会上传
  transcript 数据。
- 默认数据库在 macOS 为 `~/Library/Application Support/agent-profile/trace.db`，Windows
  为 `%LOCALAPPDATA%\agent-profile\trace.db`，Linux 为
  `${XDG_DATA_HOME:-~/.local/share}/agent-profile/trace.db`；应用文件与可变数据彼此分离。
- `agent-profile --project <path>` 是显式项目作用域。除非同时传入 `--database` 或
  `--data-dir`，可变数据库位于 `<project>/.agent-profile/trace.db`，该目录默认已加入 Git
  ignore。只有来源捕获的 `cwd` 位于规范化项目根目录内，Session 才会被纳入；根目录外的
  Session 计为“排除”，缺失 `cwd` 的 Session 计为“未分配”。全局模式保留所有已导入
  Session，但仍显示未分配覆盖度。
- 项目作用域的 rebuild 不会删除其他项目的行；项目作用域 reset 只删除当前项目内的
  Session、Span 和来源关系。Task、Outcome、配置快照、cohort、experiment 及其逻辑关联仍
  会保留。数据管理界面和导入状态会明确显示全局/当前项目，并展示纳入、排除、未分配覆盖度。
- T103 之前源码 workspace 的 `apps/server/trace.db` 不会自动搬迁。可继续通过
  `--database apps/server/trace.db` 或 `TRACE_DB_PATH` 使用；也可在所有 Agent Profile
  进程停止后复制到新默认位置。
- parser 或指标变化后的常规恢复方式是“强制重建”。全局模式的危险区清空会删除全部生成的
  Session/Span（包括标签和备注），项目模式只删除当前项目的生成行；两者都保留定价、模型窗口、migration、Task、Outcome、
  Configuration Snapshot、cohort、experiment 和逻辑 Session 关联，随后可从当前可用来源
  重新同步运行证据。
- 提示词审查是临时计算：提示词文本不会写入数据库，也不会由该功能发送给语义模型服务。
- 语义诊断与提示词审查不同：显式 opt-in 后会向配置的 provider 发送上文所述有界、经过
  常见密钥脱敏的来源派生内容。脱敏不是对所有秘密的保证，endpoint 本地性不验证；只保留
  有界且不含内容的本地 audit metadata。
- 不同来源的数据覆盖度不同。字段缺失表示“未采集”，不表示零、成功或失败。

文件级备份时，先停止 `agent-profile serve`、`pnpm dev` 或 `pnpm start`，再复制选中的
数据库：

```bash
cp "/selected/data/path/trace.db" "/selected/backup/path/trace.db.backup-YYYYMMDD"
```

恢复时保持 Server 停止；如有需要先保留当前数据库，再把选中的备份复制覆盖
当前数据库路径，然后重新启动。若数据库本身健康，只需刷新 parser 或指标派生
结果，应优先使用页面的**强制重建**。

兼容接口 `POST /api/scan` 继续支持脚本按一个显式 transcript 目录导入，例如发送
`{"dir":"/absolute/history/path","agent":"codex"}`。正常页面使用多来源导入任务。

## 常见问题

### 为什么没有会话？

1. 确认至少有一种支持的 Agent 来源存在于默认位置。
2. 查看各来源的启动状态，点击**同步数据**重试任何可用来源。
3. 如果 transcript 在自定义目录，可用
   `AUTO_SCAN_DIR=/absolute/path pnpm dev` 启动。
4. 查看扫描结果和错误提示。某个来源不可用不会删除此前已经导入的数据。

### 3000 或 3001 端口被占用

停止旧的 Agent Profile 开发进程，再运行 `pnpm dev`。根目录命令默认会同时占用两个端口。

### Next.js 提示缺少 chunk 或 module

先停止所有本项目的 dev/build 进程，再只删除生成的 Web 构建目录并重启：

```bash
rm -rf apps/web/.next apps/web/.next-dev
pnpm dev
```

## 当前产品边界

- CLI 支持 `help`、`version`、`doctor`、`sources`、`sync`、有界 `sessions`、
  `stats`、`profiles`、`task-profile <id>`、`diagnosis <session-id>`、
  `evidence <session-id>`、显式 `task-outcome <task-id>`、opt-in
  `task-feedback <task-id>` 和回环 `serve`。`build:release` 可生成当前平台的未签名 Node
  归档；尚无已发布 package、签名安装器、跨平台 CI matrix 或桌面应用。
- Task、Configuration Snapshot、Outcome、cohort、experiment 已有本地基础模型；有界 cohort
  Profile、显式 opt-in 的任务后反馈和 T117 本地运行中 hint 已实现。更广泛的回归检测、因果实验
  结论和外部 Runtime feedback/SDK 仍未实现。
- 跨文件的 Codex 父/子线程仍是独立 Session；当来源捕获 `parent_thread_id` 时，Session
  详情会展示该来源原生链接（包括父线程不可用的情形）。通用 Task 图和合并资源归因仍是
  后续能力。
- 历史很大时仍需发现文件；Claude Code/Codex 的安全 JSONL 尾部追加可复用进程内结构化
  checkpoint，重写、坏行、不完整回合和强制 rebuild 会回退到完整解析与替换。超大 Session
  虚拟化仍是后续工作。
- 产品边界已经确定为仅本地回环访问。`agent-profile serve` 会拒绝非回环 host；源码工作区
  Server 与 `HOST` 覆盖同样只接受回环地址。任何非本地访问都需要另建产品与威胁模型决策
  Task。

## 开发检查

```bash
pnpm test
pnpm build
pnpm lint
pnpm benchmark:scale:ci
```

`pnpm build` 当前通过。全仓 lint 基线由 [T44](docs/roadmap.md) 单独跟踪；lint 失败不应
被解释为运行指标不正确。

## 延伸阅读

- [英文 README](README.md)：对应的英文使用说明
- [当前架构](ARCHITECTURE.md)：已实现的数据流、API、存储与指标定义
- [中文总览](docs/zh/OVERVIEW.md)：中文当前实现说明
- [多 Agent 导入](docs/multi-agent.md)：各来源的归一化方式与覆盖度差异
- [Task 与 Outcome 基础](docs/tasks-outcomes.md)：持久化、隐私、重置、Task Profile 与实验护栏
- [性能基准](docs/performance.md)：可复现的无内容规模 fixture、桌面回归预算与测量限制
- [演进方案](docs/profile-evolution-plan.md)：后续证据、Agent、Runtime、比较与运行能力的
  proposal-only 依赖图
- [路线图](docs/roadmap.md)：Task 状态与验证证据
- [Runtime 设计](docs/agent-runtime-profile-design.md)：已实现阶段和剩余未来方案
