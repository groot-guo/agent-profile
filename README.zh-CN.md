# Agent Profile

[English README](README.md) · [当前架构](ARCHITECTURE.md) · [任务路线图](docs/roadmap.md)

Agent Profile 是一个本地优先的 AI 编码 Agent Runtime 分析工具。它导入本机的
Claude Code、Codex、Zed 和 MiMo 会话数据，帮助你理解 Token、上下文、成本、耗时、
工具调用和子 Agent 的消耗去向。

它分析的是**已观察到的运行过程**，不是聊天记录阅读器、云端监控平台，也不会给 Agent
给出绝对能力排名。

## 适合解决什么问题

- 哪些本地编码 Agent 会话花费最多，或让上下文增长最快？
- 某个工具是否反复失败、输出异常大，或引发上下文突增？
- 不同 Agent、模型或项目的资源与工具使用方式有什么差异？
- 一段任务提示词是否清楚写明目标、范围、验收条件和验证方式？

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

Web 开发产物写入 `apps/web/.next-dev`，生产构建产物写入 `apps/web/.next`，因此运行
`pnpm build` 不会破坏正在运行的开发服务。

## 第一次导入数据

Server 启动后会创建一个可观察的后台导入任务。已有数据的用户可继续浏览 Session；首次
使用会看到各来源的可用性、导入进度、失败恢复和完成摘要，而不是停留在普通空列表。

| 来源 | 默认本机位置 | 导入时机 |
| --- | --- | --- |
| Claude Code | `~/.claude/projects` | 启动时与“重新扫描” |
| Codex | `~/.codex/sessions` | 启动时与“重新扫描” |
| Zed | 本机 Zed `threads.db` | 数据库存在时启动扫描与“重新扫描” |
| MiMo | 本机 `mimocode.db` | 数据库存在时启动扫描与“重新扫描” |

如果列表为空，可使用首次导入面板或点击首页的**重新扫描**。它与启动导入共享同一个
按来源去重的任务，检查四种来源并显示新增、更新、跳过和失败数量。状态接口和页面不会
返回原始对话、完整本地路径或来源 Session ID。

会话按项目路径分组。可以使用 Agent 筛选、搜索和排序来缩小范围。

## 页面怎么用

- **会话**：按项目和 Agent 浏览数据；进入会话后可分别查看概览、上下文与成本、工具与
  链路、规范化运行证据。
- **画像**：在样本量和字段覆盖度限制下，对比 Agent 的运行指纹。“高于/低于”只表示
  观察到的行为差异，不代表谁更好。
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
| `NEXT_PUBLIC_API` | Web 请求的 API 地址，默认 `http://localhost:3000/api` |
| `AUTO_SCAN_DIR` | 未设置：扫描默认 Claude Code 与 Codex 目录；空字符串：关闭 transcript 自动扫描；路径：只扫描该一个 transcript 目录。 |
| `TRACE_DB_PATH` | 覆盖本地 SQLite 路径；默认 `apps/server/trace.db` |
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
- 提示词审查是临时计算：提示词文本不会写入数据库，也不会由该功能发送给语义模型服务。
- 不同来源的数据覆盖度不同。字段缺失表示“未采集”，不表示零、成功或失败。

## 常见问题

### 为什么没有会话？

1. 确认至少有一种支持的 Agent 来源存在于默认位置。
2. 查看各来源的启动状态，点击**重新扫描**重试任何可用来源。
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

- 目前没有桌面安装包，也没有非 watch 的生产启动器；当前支持的入口是上面的本地开发者
  工作流。
- Task、Configuration Snapshot、Outcome、cohort、experiment 尚未实现。因此它能解释
  过程行为，但不能证明某次会话是否正确完成了任务。
- 跨文件的 Codex 父/子线程目前仍是独立 Session；Sidechain 证据会被保留，但完整持久化
  任务树仍是后续能力。
- 历史很大时，仍需发现文件并整体替换发生变化的 Session；append-only 解析和超大 Session
  虚拟化尚未完成。
- 产品设计为本地使用。不要把 API 暴露到不可信网络；如要这样做，需要先补认证和目录访问
  控制。

## 开发检查

```bash
pnpm test
pnpm build
pnpm lint
```

`pnpm build` 当前通过。全仓 lint 基线由 [T44](docs/roadmap.md) 单独跟踪；lint 失败不应
被解释为运行指标不正确。

## 延伸阅读

- [英文 README](README.md)：对应的英文使用说明
- [当前架构](ARCHITECTURE.md)：已实现的数据流、API、存储与指标定义
- [中文总览](docs/zh/OVERVIEW.md)：中文当前实现说明
- [多 Agent 导入](docs/multi-agent.md)：各来源的归一化方式与覆盖度差异
- [路线图](docs/roadmap.md)：Task 状态与验证证据
- [未来 Runtime 设计](docs/agent-runtime-profile-design.md)：未来方案，不是当前能力
