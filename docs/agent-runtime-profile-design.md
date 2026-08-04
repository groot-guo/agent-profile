# Agent Runtime Profile 设计方案

> 状态：Proposal；Task/Outcome/Configuration、Cohort/Experiment 定义与单 Task 的
> `task-profile/v1` 已由 T49/T80 实现，T89 已实现有界的
> `cohort-runtime-profile/v1`，T90 已实现只读、显式 opt-in 的
> `post-run-feedback/v1`。T115 已实现内容受限的 Agent 可消费本地 CLI 接口；更广泛的
> 回归策略和 live Runtime feedback 仍未实现，依赖顺序见 `profile-evolution-plan.md`
> 与 T111-T121。
> 目标：将 Agent Profile 从离线会话观察工具，演进为 Agent Runtime 可消费的性能分析与迭代反馈系统。

## 文档地位

本文是未来目标设计，不描述当前已经实现的全部行为。当前产品定位和 Profile 术语以
`profile-model.md` 为准；当前实现以 `../ARCHITECTURE.md` 为准，用户入口以
`../README.md` 为准，未来依赖图以 `profile-evolution-plan.md` 为准，具体实施状态与
验收证据以 `roadmap.md` 为准。

实现本文中的任一 Phase 前，必须先在 `roadmap.md` 建立明确 Task，写出该阶段的
数据迁移、API/指标兼容、文档更新和验证计划并标记为 `in_progress`。实现结束后，
应先把当前架构及相关领域文档同步为真实状态，再记录验证结果并关闭 Task。Proposal
中的概念、接口和时间阶段在任务完成前均不得被表述为当前能力。

## 1. 目标定位

**Agent Profile 的未来 Runtime Profile 层是 Agent Runtime 的 pprof。**

当前产品已实现 Session 分析、Agent Process Profile、Task Profile、有界
`cohort-runtime-profile/v1` 与只读 post-run feedback；本文定义的是把这些事后证据
扩展为 Agent 可消费的本地工作流、明确的 Runtime 事件与受控运行中反馈的未来层。它不以
保存聊天记录为目标，也不把“改提示词”当作唯一能力。目标层为一次或一组可比较的任务生成
画像，帮助人和 Agent 回答：

1. 资源花在了哪里（token、成本、时间、上下文、工具、子 Agent）？
2. 过程是否存在异常或退化（失败重试、重复读取、上下文膨胀、无效输出）？
3. 任务结果是否达标（测试、构建、提交、人工验收）？
4. 与同类任务或其他 Agent 配置相比，差异在哪里？
5. 下一次最值得调整的运行策略是什么，以及证据是什么？

```mermaid
flowchart LR
  T["Task\n目标与验收"] --> S["Session\n一次 Agent 运行"]
  C["Configuration\n模型、规则、工具策略"] --> S
  S --> E["Events / Spans\n工具、子 Agent、上下文、耗时"]
  E --> P["Profile\n资源、行为、可靠性"]
  O["Outcome\n测试、构建、提交、评价"] --> P
  P --> H["Profile Hint\n下一次运行的建议"]
  H --> A["Explicit adoption record\n人或 Agent 明确确认"]
  A --> C
```

`Profile Hint` 不能直接写入 `Configuration`。只有人或 Agent 通过显式采纳记录确认后，
下一次运行才可以使用相应配置；系统不得从后续工具行为推断已经采纳。

### 非目标

- 默认保存完整用户 prompt、完整工具输出或 Chain of Thought。
- 成为实时告警、远程审计或团队监控平台。
- 以单一总分给 Agent 排名。
- 在证据不足时自动改写 Agent 规则或用户提示词。

## 2. 核心概念

| 概念 | 定义 | 当前状态 |
|---|---|---|
| Event / Span | 一次 LLM 回合、工具调用、思考、子 Agent 或结果事件 | 已有 |
| Session | 一次连续的 Agent 执行 | 已有 |
| Task | 用户关心的交付单元；可由一个或多个 session 完成 | 已实现本地持久化与 Session 关联 |
| Configuration | 本次运行采用的模型、规则、工具策略和提示模板版本 | 已实现版本/Hash 快照；规则/prompt 原文不复制 |
| Outcome | 可验证的任务结果与人工反馈 | 已实现显式可空字段与结构化证据 |
| Agent Process Profile | 基于当前 Session 分布的 Agent 运行过程画像 | 已实现为 `agent-profile/v1`；不含 Task/Configuration/Outcome 聚合 |
| Task Profile | 一个 Task 的关联 Session、Configuration 和 Outcome 覆盖度画像 | 已实现为 `task-profile/v1` |
| Cohort/Configuration Runtime Profile | 基于可比较 Task、配置和 Outcome 的运行画像 | 已实现 `cohort-runtime-profile/v1`；最低样本、覆盖与 guardrail 限制必须显式展示 |
| Cohort | 可公平比较的任务集合，如同项目的“功能实现”任务 | 已实现定义与生命周期模型；有界统计比较由 `cohort-runtime-profile/v1` 提供 |
| Experiment | 对同类任务比较不同配置版本的受控试验 | 已实现受护栏记录模型与有界 `cohort-runtime-profile/v1` 评估 |

**Session 是原始过程，Profile 是可行动的解释。** 原始调用记录只能作为证据层，不能替代结果评价或建议。

## 3. 画像维度

Profile 不输出“谁更强”的绝对结论，而是输出适用边界。每项都必须带样本量、比较范围和数据覆盖度。

| 维度 | 指标示例 | 可得到的结论 |
|---|---|---|
| 资源效率 | token、成本、耗时、cache 命中 | 是否以合理代价完成同类任务 |
| 上下文纪律 | 峰值、增长速度、压缩/摘要、重复大输出 | 是否容易陷入上下文膨胀 |
| 执行可靠性 | 工具失败率、重试、失败恢复 | 命令与环境操作是否稳定 |
| 验证质量 | build/test/lint、验证覆盖、返工 | 是否真正收敛到可交付结果 |
| 协作与委派 | 子 Agent 数、委派成本、回收质量 | 委派是否带来净收益 |

示例结论：

> 在已声明为可比、样本与 Outcome 覆盖足够的任务中，配置 A 观察到较高的测试通过率和
> 更稳定的上下文，但成本较高；配置 B 在小修复样本中观察到更快、更低成本，同时复杂任务
> 样本中的工具失败率更高。该报告必须同时展示样本、排除项和限制，不能据此推出因果结论
> 或通用配置赢家。

## 4. 数据模型

### 4.1 新增实体

```text
tasks
  id, project_id, title, type, goal, acceptance_criteria, status

config_snapshots
  id, agent, model, agent_rules_version, tool_policy_version,
  prompt_template_version, source_hash, created_at

task_sessions
  task_id, session_id, config_snapshot_id, role, started_at, finished_at

task_outcomes
  task_id, build_status, test_status, lint_status, git_commit,
  human_rating, rework_reason, completed_at, evidence_json

experiments
  id, cohort_definition, control_config_id, candidate_config_id,
  primary_metric, guardrails_json, status
```

设计约束：

- `goal`、`acceptance_criteria` 支持“仅结构化字段”模式；原文保存必须显式启用。
- Configuration 使用版本号和 hash，而非复制完整规则文本。
- Outcome 必须区分“未采集”和“失败”，不能将缺失数据误认为失败。
- 一个 Task 可关联多个 Session，支持“中断后续跑”“主/子 Agent 分工”。

### 4.2 目标化 Profile Report

下例是未来 Runtime 与 UI 共用的目标输出，不是当前 `task-profile/v1` 或
`cohort-runtime-profile/v1` 的逐字段合同，也不代表 `hints` 已实现。已实现报告的字段
以 `ARCHITECTURE.md` 为准。

```json
{
  "task": { "id": "task-123", "type": "feature_implementation", "status": "completed" },
  "configuration": { "agent": "codex", "model": "gpt-5", "rulesVersion": "v3" },
  "outcome": { "tests": "passed", "build": "passed", "humanRating": "helpful" },
  "profile": {
    "cost": 1.28,
    "totalTokens": 182000,
    "toolErrorRate": 0.04,
    "cacheHitRate": 0.71,
    "peakContextTokens": 82000,
    "verificationCoverage": 0.9
  },
  "comparison": { "cohort": "project-x/feature_implementation", "sampleSize": 18 },
  "findings": [{ "type": "repeated_read", "confidence": "high", "evidence": ["span-12"] }],
  "hints": [{ "priority": "high", "action": "truncate_command_output", "reason": "large output increased context" }],
  "coverage": { "toolInputs": "partial", "toolOutputs": "summary_only", "outcome": "verified" }
}
```

## 5. Agent Runtime 接入

分成事后反馈与运行时反馈两个阶段，前者不要求修改 Agent Runtime。

### 5.1 事后反馈（Phase 1）

当前 UI/API 已允许记录显式 Task、Configuration 与 Outcome，并聚合已有
Session/Span。T115 已在此基础上提供面向本地 Agent 的统一、内容受限 CLI 读写合同；它
仍不是远程控制平面或 live Runtime feedback。

当前已实现的相关本地 API：

```text
POST /api/tasks
GET/POST /api/tasks/:id/sessions
PUT /api/tasks/:id/outcome
GET  /api/tasks/:id/profile
GET  /api/tasks/:id/feedback?optIn=true
GET  /api/experiments/:id/profile
```

对应的 `agent-profile-cli/v1` 工作流为：

```text
diagnosis <session-id> --json
evidence <session-id> --json
task-outcome <task-id> --confirm --evidence-kind <kind> [--evidence-status <status>]
task-feedback <task-id> --opt-in --json
```

诊断与证据命令默认只返回 finding/event references、Span ID 和 coverage；Outcome 命令必须显式
确认，并复用 Task repository 校验；feedback 命令必须 opt-in。它们不返回 prompt、thinking、
answer 或工具输入/输出内容，也不改变 Agent 配置。T116 已提供本地
`runtime-event/v1` HTTP collector；T117 已在其上提供有界、显式 opt-in 的运行中 hint
策略和 adoption 记录。

### 5.2 运行时反馈（Phase 3，bounded local implementation）

T116 已定义并实现 Runtime 可选接入的本地 `runtime-event/v1` HTTP collector；它只接收
Task/Run 生命周期 metadata，处理 identity、sequence、duplicate、partial coverage 和
failure isolation，不接收原始思维链，也不替代 transcript import。T117 在此基础上实现
`runtime-hint/v1`：只有 fresh complete event coverage、ready descriptive historical
evidence 和重复工具失败信号同时满足时才返回短期 hint；不满足时返回 suppression reason。

```text
profile.start(task, configuration)
profile.event(tool_call | tool_result | subagent | verification)
profile.hint()
profile.finish(outcome)
```

`profile.hint()` 只能返回受控建议，例如预算、上下文风险、工具失败模式和同类任务的已验证策略；不得直接生成未验证的规则替换。

当前 HTTP surface 是 `GET /api/runtime/runs/:runId/hint?optIn=true`，并通过
`POST /api/runtime/hints/:hintId/adoption` 显式记录 `adopted`、`ignored` 或
`not_recorded`。Hint 按 Run 限流、短期过期，只保存 event/Experiment 引用；后续工具行为
不会推断 adoption，也不会修改 Agent 配置。外部 Runtime SDK 仍未实现。

示例：

```text
当前上下文处于同类任务 P90；建议先总结已确认结论，再进入下一阶段。
当前 Bash 输出连续两次超阈值；建议缩小命令范围或仅保留失败片段。
```

## 6. 会话与工具调用的展示策略

完整会话记录有必要，但只应是证据层，采用渐进披露。

当前已经实现其中的规范化证据层：`session-evidence/v1` 把一个 Session
内已存储的全部 Span 按稳定时间顺序组织为时间线，显式展示父级关联、主链/Sidechain、
保守的工具结果状态和字段覆盖度。默认响应不含工具输入/输出、thinking 或 answer
文本；用户主动开启后只返回经过密钥遮蔽、每字段最多 500 字符的预览，并标记源解析器
是否已提前截断。Session 详情页支持类型、链路和结果筛选以及逐项展开。

这一实现不等于完整原始会话：当前来源适配器没有把所有用户消息和 Runtime
事件统一建模为一等 Span，API 也不提供完整原文模式。经授权的原始 transcript
取证、搜索和虚拟滚动仍属于后续能力。

| 层级 | 默认内容 | 目标用户 |
|---|---|---|
| Task 概览 | 结果、成本、异常、配置差异、建议 | 人和 Agent Runtime |
| Session 时间线 | 回合、工具、子 Agent、文件、验证节点 | 调试与复盘 |
| Event 明细 | 输入摘要、输出摘要、耗时、错误、关联文件/父节点 | 深度排障 |
| 原始记录 | 原始 transcript、完整输入/输出 | 经授权的取证 |

工具调用卡片至少应显示：工具名、目标、耗时、结果、输出大小、错误、父调用、关联文件和是否被诊断命中。

原始输出应默认折叠并支持：分页/虚拟滚动、截断、搜索、按错误/文件/工具过滤，以及敏感信息脱敏。对于解析不到原始内容的 span，明确显示“仅有摘要/大小”，而不是静默留空。

## 7. 人与 Agent 都能理解的透明度规范

每个结论均使用统一卡片：

```text
结论：重复读取导致约 12% 的上下文开销
证据：同一文件在 18 分钟内被 Read 4 次，期间无写入
影响：估算增加 3.2k token；这是启发式估算
建议：读取后缓存摘要；文件变更后才重新读取
置信度：高；数据覆盖：完整工具输入
```

必须显式呈现：

- 指标定义、计算公式与权重；效率分只能称为“过程效率”。
- 归因方法：工具类别按同一回合中的调用占比分摊，并非真实供应商账单。
- 对比范围、样本量和最低样本要求。
- 定价未知、原始内容缺失、无 Git 仓库、未记录 Outcome 等数据缺口。
- LLM 语义诊断是推断，必须附证据 span，且与确定性规则区分展示；当前实现
  只有在请求明确 `semantic=opt_in` 后才调用 provider，发送前使用有界常见密钥
  脱敏，并只保留不含来源内容的进程内 audit metadata。

## 8. 提示词与规则优化边界

Prompt 是 Configuration 的一个可实验变量，不是产品中心。

当前已经实现 Phase 0 的局部能力：`prompt-review/v1` 以确定性启发式检查目标、范围、
验收、限制、相关上下文和验证要求；`iteration-hints/v1` 可选择结合现有
`agent-profile/v1` 形成带证据来源、置信度和因果护栏的修改假设。输入只在请求内处理，
不写入数据库，也不调用语义模型；原文证据默认关闭，启用后仅返回经过遮蔽和长度限制
的片段。该能力没有总分，也不会自动改写提示词。

这仍不等于经过验证的提示词优化。正式推荐提示词或 Agent
规则的前提仍是同类 cohort 有足够样本，并同时满足质量 guardrail。例如推荐“要求运行
测试”之前，需证明测试通过率/返工率改善且成本没有超过上限。T49 已实现 Task、
Configuration Snapshot、Outcome、Cohort 和 Experiment 的持久化基础；T89 已实现
最低样本、Outcome 覆盖与有限 guardrail 的有界比较，但没有产生因果赢家或自动决策。
T118 现在提供可比性分层、排除项、`ready`/`insufficient_evidence`/`not_comparable` 状态和有界
不确定性表达；页面建议仍必须被视为下一次实验的描述性假设。

## 9. 分期交付

### Phase 0：解释当前 Profile（短期）

当前进度：已实现 `agent-profile/v1` 的 Agent 级过程画像、覆盖度、最低样本约束和
人类可读差异页；也已实现无持久化的提示词结构审查与受控迭代假设。诊断卡片与完整
事件时间线已经存在；finding 到精确有界 Evidence 的导航已由 T112 实现，超大历史的详情
虚拟化属于 T121。运行画像只基于 Session/Span，Outcome 明确标记为未采集，提示词
建议也尚不能通过 Outcome 闭环验证。

- 为现有指标增加定义、公式、数据覆盖与限制说明。
- 将诊断改为“结论 + 证据 + 影响 + 建议 + 置信度”。
- 将原始工具调用改为按需展开的时间线。

验收：用户可在不阅读代码的情况下理解任一异常、效率分和成本归因的来源。

### Phase 1：Task 与 Outcome（核心）

当前进度：T49/T80 已实现实体、关联、完整 Outcome 录入、Task 工作区与
`task-profile/v1`。

- 引入 Task、Configuration Snapshot、Outcome、Task-Session 关联。
- 支持 test/build/lint/Git/human rating 的结果录入。
- 生成 Task Profile Report，并支持导出 JSON。

验收：可记录一个 Task 的交付 Outcome 与配置关联，且不会将“未采集结果”误判为失败。
同类 Task 的配置质量比较属于有界的 Phase 2 报告或后续 T118 工作，而不是当前
Phase 1 的结论。

### Phase 2：Cohort 与 Experiment

当前进度：T49 已实现 cohort/experiment 定义、证据状态和决策护栏；T89 已实现
`cohort-runtime-profile/v1` 的 Outcome-guarded 分布、最低样本与有限 guardrail 计算；
T90 已让完成且 Outcome-verified 的 candidate Task 显式读取有界 post-run finding。
当前报告只描述证据与限制，不产生自动 keep/rollback 或因果赢家。

- T118 已实现已声明的 cohort 可比性分层、结果/覆盖区分和有界不确定性；更严格的回归证据仍需后续任务。
- 任何控制组/候选配置比较必须展示样本、排除项、Outcome/指标覆盖与 guardrail 限制。
- 外部 Runtime 消费和自动配置控制仍未实现；T117 的本地 hint 只提供可抑制的观察假设。

验收目标：T118 可让一次规则或模型变更得到更严格的“证据不足或有界观察”报告；
keep/rollback 仍必须是显式、可审计的用户/Runtime 决定，而非自动结论。

### Phase 3：Runtime Feedback

- 已实现前置的 post-run feedback：本地 Task 工作区可在显式 opt-in 后读取
  `post-run-feedback/v1`；它只引用 Experiment/Cohort ID、报告版本、指标、guardrail
  与 limitations，并在证据不足或过期时抑制。
- T115 已提供本地、内容受限的 Agent 读取与显式 Outcome 写入工作流。
- T116 已提供本地 Runtime HTTP 事件适配器；T117 已提供 `hint` 接口、freshness/coverage、
  历史证据门槛、expiry、rate limit、suppression 和显式 adoption 状态。
- 外部 Agent Runtime 在下一次或执行中消费 Profile Report 仍是目标；当前仅有本地、显式
  opt-in、可抑制的 Runtime hint HTTP surface。

验收目标：Runtime 能在不上传原始思维链的情况下接收 opt-in、有界、可抑制的建议；
它不会自动改变配置，后续 Outcome 只能评估显式记录的采纳情况。

## 10. 成功指标与护栏

产品北极星指标：**有可验证下一步行动的已完成任务占比**。

辅助指标：

- 记录 Outcome 的 Task 占比。
- 同类任务中可比较配置的覆盖率。
- 推荐被采纳后的 guardrail 通过率。
- 用户查看原始记录后仍无法解释异常的比例。

护栏：不得以降低 token 或成本为唯一优化目标；测试/构建/人工结果缺失时，禁止宣称配置“更好”。

## 11. 待决策项

1. Task 由用户手动创建、由 Agent Runtime 创建，还是从 session 标题自动建议？建议支持自动建议、人工确认。
2. Outcome 的最小必填项是什么？建议为 `status + 至少一个验证证据或人工评价`。
3. 配置快照是否保存规则全文？建议默认仅存版本/hash，全文在本地显式授权后保存。
4. Phase 3 是否优先接入 Codex，还是先定义独立的 OpenTelemetry 风格事件协议？建议先定义独立协议，再为各 Agent 写适配器。
