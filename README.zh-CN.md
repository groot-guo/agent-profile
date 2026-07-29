# Agent Profile

[English README](README.md) · [Profile 模型](docs/profile-model.md) · [当前架构](ARCHITECTURE.md) · [任务路线图](docs/roadmap.md)

Agent Profile 是面向 AI 编码 Agent 的本地优先运行画像、诊断与效果验证系统。它导入
本机的 Claude Code、Codex、Zed、MiMo 和 OpenCode 会话数据，帮助你理解 Token、
上下文、成本、耗时、工具调用和子 Agent 的消耗去向，并能将这些过程证据关联到显式
Task Outcome，而不会把更低的资源消耗误作更好的交付结果。

它分析的是**已观察到的运行过程**与本地交付证据，不是聊天记录阅读器、云端监控平台、
代码质量扫描器，也不会给 Agent 给出绝对能力排名。Profile 的术语与当前/未来边界见
[Profile 模型](docs/profile-model.md)。

## 适合解决什么问题

- 哪些本地编码 Agent 会话花费最多，或让上下文增长最快？
- 某个工具是否反复失败、输出异常大，或引发上下文突增？
- 不同 Agent、模型或项目的资源与工具使用方式有什么差异？
- 一段任务提示词是否清楚写明目标、范围、验收条件和验证方式？
- 配置调整是只降低了过程成本，还是在可比交付工作中仍保住了 build/test/lint 结果？

## 使用前准备

- 安装 Node.js（建议使用仍受支持的 LTS 版本）
- 安装 pnpm
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

Web 开发产物写入 `apps/web/.next-dev`，生产构建产物写入 `apps/web/.next`，因此运行
`pnpm build` 不会破坏正在运行的开发服务。

源码 workspace 现在也提供首个 `agent-profile` CLI 入口：

```bash
./packages/cli/bin/agent-profile.mjs help
./packages/cli/bin/agent-profile.mjs version --json
./packages/cli/bin/agent-profile.mjs doctor --data-dir ./local-data
```

`doctor` 会创建并关闭与 Server 相同的应用 Runtime，检查选中的 SQLite 数据库和五种
本地来源的可用性；默认输出便于阅读的文本，使用 `--json` 时输出
`agent-profile-cli/v1`。它不会启动 HTTP，也不会导入来源数据。打开 Runtime 可能会创建
所选数据库，并执行常规增量 migration 和默认定价/模型窗口数据初始化。

`doctor` 的数据库路径优先级依次为 `--database`、`--data-dir/trace.db`、
`TRACE_DB_PATH` 和现有的 `apps/server/trace.db` 默认值。成功 exit code 为 `0`，命令用法
错误为 `2`，Runtime 失败为 `1`。同步、Session 查询、报告、`serve` 和正式发行制品不在
这个初始 CLI 基础范围内。

## 第一次导入数据

Server 启动后会创建一个可观察的后台导入任务。没有已存 Session 时，页面会切换为专门的
本地数据准备页，逐一展示可用来源和来源级进度，避免普通空列表看起来像页面卡死；已有
数据时，同步或强制重建只在侧栏显示一行紧凑、可展开的非模态状态，Session 列表和分析
仍可使用；默认只显示真实的来源完成数，需要时再展开逐来源详情。完成后页面会自动刷新
本地数据。

| 来源 | 默认本机位置 | 导入时机 |
| --- | --- | --- |
| Claude Code | `~/.claude/projects` | 启动时与“同步数据” |
| Codex | `~/.codex/sessions` | 启动时与“同步数据” |
| Zed | 本机 Zed `threads.db` | 数据库存在时启动扫描与“同步数据” |
| MiMo | 本机 `mimocode.db` | 数据库存在时启动扫描与“同步数据” |
| OpenCode | `~/.local/share/opencode/opencode.db` | 数据库存在时启动扫描与“同步数据” |

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
1/7/30/90 天、折叠的 Agent/结果视图、标题/项目/路径文本搜索和排序组合使用，打开 Session
或浏览器返回时筛选状态由 URL 保留。来源提供的标题优先；没有标题时，界面只用 Agent、
项目和开始时间组成展示
标题，不再主显不透明 ID，也不会为此读取、预览或持久化 prompt、answer 或 reasoning
内容。项目标签优先使用来源捕获的 `cwd`；没有这项项目证据的 Codex Session 统一显示为
“Codex 会话记录”。Codex Desktop 为无项目会话生成的非空
`~/Documents/Codex/YYYY-MM-DD/<session>` 工作目录也归入同一分类；该工作目录和
`~/.codex/sessions/YYYY/MM/DD/` 来源目录都只是运行/日期分区，不会被推断成项目。该
展示与统计规则保留原始路径，不需要重新导入。大结果集按批次渲染，不会一次创建全部行。

**任务**页面在 Session 过程分析之上补充本地交付证据。一个 Task 可关联多个 Session、
绑定只保存版本/Hash 的 Configuration Snapshot，并在页面记录 build/test/lint/Git Outcome。
本地模型/API 还支持人工评分、返工原因、完成时间和有界结构化证据。缺失 Outcome 会明确
保持“未采集”，不会变成失败。`task-profile/v1` 只聚合当前可用的关联 Session，并展示
覆盖度与限制。Cohort 和 Experiment API 可保存比较定义与证据状态，但目前不会自动计算
因果赢家。

## 如何理解 Profile

- **Session 分析**解释一次已观察到的运行；它是过程证据，不是交付成功证明。
- **Agent Process Profile**（`agent-profile/v1`）展示一个 Agent 当前 Session 集合上的
  资源、上下文、可靠性、协作、覆盖度和中性同类相对特征。
- **Task Profile**（`task-profile/v1`）展示一个交付单元的关联 Session/配置、Outcome
  覆盖度与聚合过程证据。
- 按 cohort/configuration 聚合的 Runtime Profile、自动实验结论、回归决策和运行时反馈
  仍是后续能力，不能当作当前产品承诺。

OpenCode 适配器以只读方式打开本机 SQLite。当前来源把 Token 总量保存在 Session
聚合字段中，而不是逐消息记录；Agent Profile 因此保留一个明确标记的聚合 LLM 回合，
不会虚构逐消息分配。cache write 映射为 cache creation，cache read 单独保留，reasoning
Token 计入 output 使用量。成本仍按模型和四类 Token 重新计算，不把来源数据库中的聚合
cost 当作可移植的计费证据。

## 页面怎么用

- **会话**：在扁平最近列表中按项目和 Agent 筛选数据；进入会话后可分别查看概览、上下文与成本、工具与
  链路、规范化运行证据。
- **任务**：把多个 Session 和配置版本关联到显式交付 Outcome，并查看带覆盖度的 Task Profile。
- **画像**：在样本量和字段覆盖度限制下，查看 Agent Process Profile。“高于/低于”只
  表示观察到的行为差异，不代表谁更好。
- **迭代**：本地检查任务提示词的目标、范围、验收、约束、上下文和验证结构。结合运行
  画像得到的建议是待验证假设，不会自动改写提示词。
- **统计**：查看 Token、成本、上下文，以及项目、Agent、模型的汇总和分布。

会话证据页展示的是所有**已存储并归一化的 Span**，不等同于完整原始 transcript。默认
不显示内容；主动加载后也只会展示经过脱敏和长度限制的预览。

Codex Desktop 物化的外部 Agent 历史如果只有 `external-import-turn-*`、缺少正常运行
上下文，且工具过程只是文本包装，会被标记为不可分析并排除。这类记录的项目和工具证据
不可信，因此不会制造莫名项目文件夹，也不会抬高 Codex/工具统计。导入时会清理以前
生成且没有标签、备注的副本；已有用户标注的记录会保留并报告失败，不会静默删除。

## 配置

| 变量 | 作用 |
| --- | --- |
| `PORT` | API 端口，默认 `3000` |
| `HOST` | API 绑定地址，默认 `127.0.0.1` |
| `WEB_ORIGIN` | API CORS 允许的浏览器来源，多个值用逗号分隔；默认仅允许本机 `3001` Web 来源 |
| `NEXT_PUBLIC_API` | Web 请求的 API 地址，默认 `http://localhost:3000/api` |
| `AUTO_SCAN_DIR` | 未设置：扫描默认 Claude Code 与 Codex 目录；空字符串：关闭 transcript 自动扫描；路径：只扫描该一个 transcript 目录。 |
| `TRACE_DB_PATH` | 覆盖 Server SQLite 路径；CLI 未指定路径选项时也供 `doctor` 使用；默认 `apps/server/trace.db` |
| `LLM_API_KEY` | 开启可选语义诊断；确定性分析不需要 Key |
| `LLM_PROVIDER`、`LLM_MODEL`、`LLM_BASE_URL` | 可选语义诊断服务配置 |

例如，不在启动时扫描 transcript：

```bash
AUTO_SCAN_DIR="" pnpm dev
```

## 本地数据与隐私

- Agent Profile 读取本地来源记录，并把派生的 Session/Span 数据写入 SQLite；默认不会上传
  transcript 数据。
- 默认数据库位于 `apps/server/trace.db`。如需文件级备份，请先停止 Server 再复制。
- parser 或指标变化后的常规恢复方式是“强制重建”。危险区清空会删除全部生成的
  Session/Span（包括标签和备注），但保留定价、模型窗口、migration、Task、Outcome、
  Configuration Snapshot、cohort、experiment 和逻辑 Session 关联，随后可从当前可用来源
  重新同步运行证据。
- 提示词审查是临时计算：提示词文本不会写入数据库，也不会由该功能发送给语义模型服务。
- 不同来源的数据覆盖度不同。字段缺失表示“未采集”，不表示零、成功或失败。

文件级备份时，先停止 `pnpm dev` 或 `pnpm start`，再复制数据库（如果配置了
`TRACE_DB_PATH`，则复制对应文件）：

```bash
cp apps/server/trace.db apps/server/trace.db.backup-YYYYMMDD
```

恢复时保持 Server 停止；如有需要先保留当前数据库，再把选中的备份复制覆盖
`apps/server/trace.db`，然后重新启动。若数据库本身健康，只需刷新 parser 或指标派生
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

- workspace 已包含首个 `agent-profile` CLI package 和源码 binary，支持 `help`、
  `version` 与 `doctor`，但尚未发布正式发行包或桌面应用。CLI 同步、查询、报告与
  `serve` 仍是后续能力；`pnpm start` 仍是受支持的非 watch Web 启动入口。
- Task、Configuration Snapshot、Outcome、cohort、experiment 已有本地基础模型。
  自动 cohort 统计、回归检测、因果实验结论和 Runtime feedback/SDK 仍未实现。
- 跨文件的 Codex 父/子线程目前仍是独立 Session；Sidechain 证据会被保留，但完整持久化
  任务树仍是后续能力。
- 历史很大时，仍需发现文件并整体替换发生变化的 Session；append-only 解析和超大 Session
  虚拟化尚未完成。
- 产品设计为本地使用。不要把 API 暴露到不可信网络；如要这样做，需要先补认证和目录访问
  控制。设置 `HOST=0.0.0.0` 会显式把无认证 API 暴露到回环地址之外；只能在可信网络中
  使用，并通过 `WEB_ORIGIN` 严格限制浏览器来源。

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
- [路线图](docs/roadmap.md)：Task 状态与验证证据
- [Runtime 设计](docs/agent-runtime-profile-design.md)：已实现阶段和剩余未来方案
