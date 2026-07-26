# Agent Profile — 改进分析

> 2026-07-26 全量代码审查 + 架构分析。不修改代码，仅产出文档与 task 列表。
>
> **状态更新（2026-07-26）**：此文最初是 task 快照。下方台账为当前状态，已完成项不应重新排期。

## 一、工具当前能力总结

### 已具备的能力

| 维度 | 能力 | 成熟度 |
|------|------|--------|
| 数据采集 | Scanner 扫描 Claude Code / Codex / Zed / MiMo 四种 agent 的 transcript | 较完善 |
| 数据解析 | Parser 解析 NDJSON / zstd BLOB，配对 tool_use↔tool_result，重建 parentUuid 调用链 | 较完善 |
| Token 分析 | 四类 token 分开存储（input / cache_creation / cache_read / output），contextTokens = input+cc+cr | 完善 |
| Cost 计算 | 按 model + 4 token 类型 + 定价表计算，未知模型标 costUnknown 不估算 | 完善 |
| 诊断 | 7 条启发式规则：重复读取、大输出携带、cache 命中低、上下文堆积、thinking 过长、重复试错、读取范围过大 | 较完善 |
| 统计 | /stats 页：总览卡 + 按 agent/项目/模型分组 + cost/token 分布直方图 + 饼图 | 基础具备 |
| UI | Dashboard + session 详情（工具条形图、上下文曲线 SVG+hover、token 拆解、诊断面板、分页表） | 基础具备 |
| 多 agent | Claude Code / Codex / Zed / MiMo parser 均已实现，sessions 表有 agent 列 | 完善 |

### 关键架构决策（非问题）

- 4 token 不合并：cache_read 价格与语义不同 — 正确
- transcript 无 cost 字段，cost 由 analyzer 实时计算 — 正确
- thinking / answer 不单拆 token，含在 llm_turn output 中 — 合理
- 工具按名称聚合、按类别着色 — 合理
- 增量扫描：mtime/size 变化 → 删旧重插 — 可行但有改进空间（见增量优化 task）

---

## 二、可提升维度总览

以下按影响面从大到小排列：

### 🔴 维度 A：Agent 行为深度分析（影响面最大）

当前工具聚焦于「消耗了多少 token/cost」，但对「agent 怎么工作」的分析几乎空白。这是 agent profile 工具相对竞品（如 LangSmith、Weights & Biases）的核心差距。

### 🟠 维度 B：对比与基准

只能看单个 session 的数据，无法回答「这次比上次好还是差」的问题。

### 🟡 维度 C：Token 经济学深化

Cost 计算已经准确，但缺少「钱花在哪里最值得」的经济学视角。

### 🟢 维度 D：Session 有效性评估

当前诊断只找「浪费」，不评估「产出」。一个好的 session 可能 cost 很高但产出也高。

### 🔵 维度 E：数据完整性与运维

定价表覆盖不足、model_context 缺失、缺少数据导出/备份。

### 🟣 维度 F：UI/UX 增强

缺少搜索、排序、标签、导出、暗色模式等体验功能。

### ⚪ 维度 G：工程质量

代码重复（scan 与 autoScan 几乎相同）、缺少测试、大型 session 渲染性能。

---

## 三、详细分析

### 维度 A：Agent 行为深度分析

#### A.1 工具使用效率分析

**现状**：工具调用只按名称统计次数和错误率，缺少效率指标。

**可提升点**：
- **工具成功率**：`success_rate = 1 - error/total`，按工具名 + 按类别
- **重试模式识别**：同工具同参数连续 2+ 次调用 →「重试」标记（当前 repeated_failure 只看 isError）
- **工具耗时分布**：每个工具的平均/中位/P95 耗时
- **工具输入参数模式**：Read 的典型 offset/limit 范围、Write 的典型文件大小、Bash 的典型命令类型
- **工具序列模式**：高频工具调用序列（如 Read → Edit → Bash test），用于识别工作流模板

#### A.2 Thinking 质量分析

**现状**：long_thinking 检测只看字数是否超过 4000，报告「可精简」。

**可提升点**：
- **thinking/action 比**：thinking 字数 / 该轮 tool_call 次数，判断是否「想得多做得少」
- **thinking 产出率**：thinking 后的 tool_call 成功率 vs 空有 thinking 不行动的轮次
- **thinking 主题分布**：用关键词/规则聚类 thinking 内容（"读代码"、"修 bug"、"搜索"、"重构"），看 agent 的时间分配

#### A.3 上下文增长动态

**现状**：有 context growth chart（堆叠面积图），但只有 spike 标注，不分析增长模式。

**可提升点**：
- **上下文增长速度**：`tokens_growth_per_turn = ΔcontextTokens / Δturn`
- **上下文压缩信号**：当 contextTokens 突然下降 → 可能发生了上下文压缩/总结，标注这些点
- **有效上下文 vs 无效上下文**：估算上下文中有多少是「已使用但仍保留」的工具输出（如 Read 了一个大文件后只用了其中几行，剩下的是浪费）

#### A.4 文件操作热力分析

**现状**：repeated_read 检测同文件多次 Read。

**可提升点**：
- **文件热度图**：哪些文件被 Read/Edit/Write 次数最多（按路径聚合）
- **文件变更统计**：某 session 中哪些文件被实际修改（Write/Edit）了
- **Read-then-Edit 转化率**：Read 过的文件中多少比例被后续 Edit/Write？未被修改的 Read 是「冗余读取」
- **跨 session 文件热度**：同一项目的历史 session 中，哪些文件最常被操作

#### A.5 Sub-agent 使用分析

**现状**：SidechainSummary 卡展示子 agent 的轮数/工具/token/cost，展开可看列表。

**可提升点**：
- **子 agent 效率**：子 agent 的单位产出（token/task）vs 主 agent
- **子 agent 任务分布**：按任务名（name 字段）聚合，看哪些类型的任务被委托
- **串行 vs 并行**：检测多个子 agent 的时间范围是否重叠（并行）还是串行

---

### 维度 B：对比与基准

#### B.1 Session 对比

**现状**：只能看单个 session 的 detail 页。

**可提升点**：
- **双 session 对比**：选两个 session，并排对比 token/cost/tools/diagnosis
- **同项目对比**：同一 cwd 的最近 N 个 session，哪些指标改善/恶化

#### B.2 异常检测

**现状**：/stats 页有全量聚合，但不会告诉你「某个 session 不正常」。

**可提升点**：
- **项目基线**：为每个项目计算指标基线（avg/median/p95），标记偏差 > 2σ 的 session
- **异常类型**：cost 异常高、cache hit 异常低、thinking 异常长、工具调用异常多
- **趋势告警**：最近 N 个 session 相比历史基线有明显恶化时提示

#### B.3 时间序列趋势

**现状**：/stats 页只有当前快照。

**可提升点**：
- **日/周 trend**：按时间聚合 sessions，展示 daily/weekly token/cost/cache_hit 趋势线
- **项目趋势**：单个项目随时间推移的指标变化

---

### 维度 C：Token 经济学深化

#### C.1 成本归因分析

**现状**：cost 计算到每个 llm_turn，session 级别汇总 totalCost。

**可提升点**：
- **按操作类型归因**：每个 tool_call 关联其 parent llm_turn 的 cost，回答「读代码花了多少钱 vs 执行命令花了多少钱」
- **按阶段归因**：将 session 按时间分阶段（探索期/实现期/验证期），计算每阶段 cost 占比
- **诊断浪费占比**：`wastedCost / totalCost` 作为浪费比例，按诊断类型下钻

#### C.2 成本预测

**现状**：只有历史 cost 计算。

**可提升点**：
- **基于上下文增长速度的 cost 预测**：如果当前 session 未结束，可拟合增长曲线预估最终 cost
- **项目级预算**：设定项目（cwd）的月度预算，到达一定比例时提醒

#### C.3 Cache 深度分析

**现状**：session 级别 cache_hit_rate，加一条 low_cache 诊断。

**可提升点**：
- **每轮 cache 命中率曲线**：叠加到 context chart 上
- **cache 断点检测**：找出 cache hit rate 断崖式下降的轮次，标注可能原因（如切换话题、长间隔）
- **cache 节省金额**：当前实际 cost vs 100% cache hit 的理论 cost（cache savings）

---

### 维度 D：Session 有效性评估

#### D.1 产出信号

**现状**：完全依赖 transcript 内容，不与外部系统（如 git）交互。

**可提升点**：
- **Git commit 关联**：检测 session 时间范围内是否有 git commit，作为「有产出」信号
- **文件变更统计**：从工具调用中提取被 Write/Edit 的文件和行数
- **任务完成度**：结合 ai-title（任务标题），判断 session 是否完成了目标（当前仅展示 ai-title）

#### D.2 效率评分

**现状**：诊断只给 wastedTokens，不给定性评分。

**可提升点**：
- **Session 效率分**：综合 token 效率、cache 利用率、工具成功率、诊断浪费比例的加权评分
- **同类排名**：在所有 session 中、或在同项目 session 中的百分位排名
- **效率分随时间变化**：看个人使用 agent 的技能是否在提升

---

### 维度 E：数据完整性与运维

#### E.1 定价表补全

**现状**：仅 7 条 deepseek + mimo 定价，缺大量常用模型。

**需要补充的模型**（按使用频率预估）：
- GLM 系列（glm-5.2 等）
- Claude 系列（claude-fable-5, claude-opus-4-8, claude-sonnet-5, claude-haiku-4-5 等）
- Gemini 系列
- GPT 系列
- 国产模型：qwen, moonshot, minimax, doubao 等

#### E.2 Model Context Window 补全

**现状**：model_context 表几乎为空（只有 seed）。

需要为 pricing 中有价格的模型都补充 context_window。

#### E.3 数据管理

**现状**：数据只有 SQLite 存储，无导出、备份、清空功能。

**可提升点**：
- **数据导出**：导出 session 为 JSON/CSV
- **数据清理**：按时间/agent 清理旧 sessions 及其 spans
- **数据完整性检查**：检测 orphan spans（spans.sessionId 不在 sessions 表中）或缺失数据

---

### 维度 F：UI/UX 增强

#### F.1 列表增强

**现状**：session 列表只按项目分组，无搜索/排序/过滤。

**可提升点**：
- **搜索**：按 session name/cwd/model 搜索
- **排序**：按 cost/tokens/时间/agent 排序（当前按 startTime DESC 固定）
- **高级过滤**：日期范围、cost 范围、token 范围、model、agent 类型
- **列表列**：列表目前只展示 name + cost，可加列 tokens/cache hit/duration

#### F.2 暗色模式

**现状**：硬编码明亮主题（`C` 对象在 theme.ts）。

**可提升点**：CSS 变量 + prefers-color-scheme 自动跟随系统，或手动 toggle。

#### F.3 导出 & 分享

**现状**：只能在浏览器看。

**可提升点**：
- **Session 报告导出**：Markdown/HTML 格式的 session 分析报告
- **图表导出**：SVG 图表可下载为 PNG
- **分享链接**：单次 session 的独立 URL（无状态）

#### F.4 Session 标注

**现状**：session 的 name 来自 ai-title（可能为空），无法自定义。

**可提升点**：
- **自定义标签/备注**：用户对 session 添加标签（如 "好"、"问题会话"、"重构"）和备注
- **收藏/星标**：标记值得回顾的 session

---

### 维度 G：工程质量

#### G.1 代码重复

**现状**：`scan.ts` 中 `autoScan` 和 `POST /api/scan` 处理函数有大量重复的 SQL prepare/insert 代码（~80 行重复）。

**应改为**：提取公共的 upsert 逻辑。

#### G.2 测试覆盖

**现状**：packages/core 纯逻辑无测试文件。

**需要测试的重点**：
- `calcCost`（边界：全零 token、未知模型、各 token 组合）
- 7 条诊断规则的检测逻辑（已有纯函数，易于测试）
- `diagnoseSessionSync`（输入构造好的 SessionDetail，验证输出 findings）
- parser 的 tool_use↔tool_result 配对逻辑

#### G.3 大型 session 性能

**现状**：session detail 页一次性加载全部 spans（可能 1000+ 行），context chart 一次性渲染所有点。

**可提升点**：
- spans 分页/虚拟滚动（当前 turns/tools 表已有分页 30/page，但 chart 无优化）
- context chart：points > 200 时降采样
- /api/session/:id 响应体积：spans 数组可能很大，可考虑压缩或分页

#### G.4 增量扫描优化

**现状**：增量检测到变化后「删旧重插整个 session」，对于 append-only 的 transcript file，可以只解析新增行并插入新 spans，而非全部重来。

---

## 四、Task 列表

以下 task 按优先级排列，标注预估工作量和依赖关系。原始建议已在后续迭代中大部分落地，先以此台账判断是否仍需安排。

| Task | 当前状态 | 备注 |
|------|----------|------|
| T14, T15 | 已完成 | LLM 语义诊断、GLM 定价与重算接口均已交付。 |
| T16 | 已完成 | 行为效率面板与 API 已交付。 |
| T17 | 部分完成 | session 内文件热度和 Read→Edit 指标已完成；跨 session 的项目聚合尚未实现。 |
| T18–T31（除 T17） | 已完成 | 对比、基线、趋势、效率分、Git、定价、导出、测试、去重、标注、搜索排序、暗色模式和报告均已交付。 |
| T32–T35 | 已完成 | 新增诊断规则、性能分析、工具参数分析和测试覆盖已交付。 |
| T36 | 已完成 | 本次稳定性、数据正确性、导出/Git 加固和详情页性能优化。 |

仍值得新建 task 的内容：T17 跨 session 文件热度聚合、G.3 的超大 session 虚拟化/下采样，以及 G.4 的 append-only 增量解析。

### P1 — 核心分析能力提升（影响面最大的改进）

#### T16 Agent 行为效率分析

- **范围**：在 session detail 中增加「行为效率」面板
- **包含指标**：
  - 工具成功率（per tool name + per category）
  - Thinking/action 比（thinking 字数 / tool_call 次数，per turn）
  - 上下文增长速度（tokens/turn）
  - 文件 Read-then-Edit 转化率
- **依赖**：无
- **影响文件**：
  - `packages/core/src/analyzer.ts`（新增效率指标计算函数）
  - `packages/core/src/types.ts`（新增 EfficiencyMetrics 类型）
  - `apps/server/src/routes/sessions.ts`（新增 /api/session/:id/efficiency 路由）
  - `apps/web/app/session/[id]/page.tsx`（新增 EfficiencyPanel 组件）
  - `apps/web/app/theme.ts`（可能需要新颜色）
- **预估工作量**：中（2-3 天）
- **验收标准**：session detail 页新增效率面板，展示上述指标

#### T17 文件操作热力图

- **范围**：session detail 中展示文件操作热度
- **包含**：
  - 文件被 Read/Edit/Write 次数排序表
  - 按项目聚合的文件热度（跨 session）
  - Read-then-Edit 转化率标注
- **依赖**：T16（共享文件路径提取逻辑）
- **影响文件**：
  - `packages/core/src/analyzer.ts`（新增文件热度聚合函数）
  - `apps/web/app/session/[id]/page.tsx`（新增 FileHeatmap 组件）
- **预估工作量**：小（1-2 天）

#### T18 成本归因分析

- **范围**：按操作类型拆分 cost，回答「钱花在哪」
- **包含**：
  - 按 tool_call 关联的 parent turn cost 归因到工具类别
  - 诊断浪费占 totalCost 百分比 + 按类型下钻
  - 按阶段（探索/实现/验证）的时间分段 cost 占比
- **依赖**：无
- **影响文件**：
  - `packages/core/src/analyzer.ts`（新增 costAttribution 函数）
  - `apps/web/app/session/[id]/page.tsx`（新增 CostAttribution 面板）
- **预估工作量**：中（2-3 天）

### P2 — 对比与基准

#### T19 Session 对比功能

- **范围**：支持选择两个 session 进行并排对比
- **包含**：
  - 对比页面：token/cost/tools/diagnosis/cache 等维度并排展示
  - 差异高亮（增加/减少百分比）
- **依赖**：无
- **影响文件**：
  - `apps/web/app/compare/page.tsx`（新页面）
  - `apps/server/src/routes/sessions.ts`（/api/sessions 支持多 id 查询）
- **预估工作量**：中（2-3 天）

#### T20 项目基线 + 异常检测

- **范围**：为每个项目（cwd）计算指标基线，标记异常 session
- **包含**：
  - 项目基线：avg/median/p95 的 token/cost/cache_hit/duration
  - 异常标记：距基线 > 2σ 的 session 在列表中高亮
  - /api/stats 增加 baseline 字段
- **依赖**：无
- **影响文件**：
  - `apps/server/src/routes/stats.ts`（增加 baseline 计算）
  - `apps/web/app/page.tsx`（异常高亮）
  - `apps/web/app/stats/page.tsx`（展示基线）
- **预估工作量**：中（1-2 天）

#### T21 时间序列趋势

- **范围**：/stats 页增加 daily/weekly 趋势图
- **包含**：
  - 按天/周聚合的 token/cost/cache_hit 趋势折线图
  - 按项目过滤
- **依赖**：T12（/api/stats 已有）
- **影响文件**：
  - `apps/server/src/routes/stats.ts`（增加 trend 端点）
  - `apps/web/app/stats/page.tsx`（增加 TrendChart 组件）
- **预估工作量**：小（1-2 天）

### P3 — Session 有效性评估

#### T22 Session 效率评分

- **范围**：为每个 session 计算综合效率分
- **包含**：
  - 效率分公式：加权（token 效率 + cache 利用率 + 工具成功率 + 诊断浪费比例）
  - 在 session 列表和 detail 页展示
  - 同类/同项目百分位排名
- **依赖**：T16（效率指标数据）
- **影响文件**：
  - `packages/core/src/analyzer.ts`（efficiencyScore 函数）
  - `apps/server/src/routes/sessions.ts`（session 响应包含评分）
  - `apps/web/app/page.tsx`（列表展示评分）
  - `apps/web/app/session/[id]/page.tsx`（detail 展示评分）
- **预估工作量**：小（1 天）

#### T23 Git 提交关联

- **范围**：检测 session 时间范围内是否有 git commit
- **包含**：
  - 扫描 session cwd 的 git log，匹配时间范围
  - session detail 展示关联的 commit（hash + message）
  - 可选：统计 commit 涉及的文件行数作为产出度量
- **依赖**：无（使用 git CLI）
- **影响文件**：
  - `apps/server/src/routes/sessions.ts`（/api/session/:id/commits）
  - `apps/web/app/session/[id]/page.tsx`（展示关联 commit）
- **预估工作量**：小（1 天）
- **风险**：依赖本地 git 仓库存在；session cwd 可能已变更

### P4 — 数据完整性与工程

#### T24 定价表补全

- **范围**：为常用模型补充 pricing + model_context
- **包含**：
  - Claude 系列（fable-5, opus-4-8, sonnet-5, haiku-4-5 等）
  - GLM 系列
  - Gemini 系列
  - GPT 系列
  - 国产模型（qwen, moonshot, doubao 等）
  - 每个模型同时补充 context_window
- **依赖**：需要用户提供或确认各模型的官方定价
- **影响文件**：`apps/server/src/db.ts`（seed SQL）
- **预估工作量**：小（半天，主要时间花在收集定价信息）
- **风险**：定价信息可能不完整或有误；需要后续持续维护

#### T25 数据导出功能

- **范围**：支持导出 session 数据
- **包含**：
  - /api/session/:id/export?format=json|csv
  - CSV 包含 sessions 聚合 + spans 明细
  - 前端增加导出按钮
- **依赖**：无
- **影响文件**：
  - `apps/server/src/routes/sessions.ts`（export 端点）
  - `apps/web/app/session/[id]/page.tsx`（导出按钮）
- **预估工作量**：小（半天）

#### T26 测试覆盖补全

- **范围**：为核心逻辑补充测试
- **包含**：
  - `calcCost` 单元测试
  - 7 条诊断规则独立测试
  - `diagnoseSessionSync` 集成测试
  - parser tool_use↔tool_result 配对测试
  - analyzer session 聚合测试
- **依赖**：无
- **影响文件**：
  - `packages/core/src/__tests__/pricing.test.ts`
  - `packages/core/src/__tests__/diagnosis.test.ts`
  - `packages/core/src/__tests__/analyzer.test.ts`
  - `packages/core/src/__tests__/parsers/`
- **预估工作量**：中（2-3 天）

#### T27 代码去重：scan.ts

- **范围**：合并 scan.ts 中 `POST /api/scan` handler 和 `autoScan` 的重复 SQL 逻辑
- **包含**：提取公共 `upsertFile(parsed, meta)` 函数
- **依赖**：无
- **影响文件**：`apps/server/src/routes/scan.ts`
- **预估工作量**：小（半天）

#### T28 Session 标注功能

- **范围**：用户可对 session 添加标签和备注
- **包含**：
  - sessions 表增加 tags/notes 列（JSON text / TEXT）
  - /api/session/:id PATCH 更新标签和备注
  - 前端 UI：标签输入 + 备注文本区
  - session 列表可过滤标签
- **依赖**：需要 schema 变更（delete trace.db 重建）
- **影响文件**：
  - `apps/server/src/db.ts`（schema 加列）
  - `apps/server/src/routes/sessions.ts`（PATCH 端点）
  - `apps/web/app/page.tsx`（标签过滤）
  - `apps/web/app/session/[id]/page.tsx`（标签编辑）
- **预估工作量**：中（1-2 天）

### P5 — UI/UX 增强

#### T29 Session 列表搜索 & 排序

- **范围**：session 列表支持搜索和多种排序方式
- **包含**：
  - 搜索框：按 name/cwd/model 模糊搜索（客户端过滤）
  - 排序下拉：按 cost/tokens/time/duration/cache_hit 升降序
- **依赖**：无
- **影响文件**：
  - `apps/web/app/page.tsx`（搜索框 + 排序控件）
- **预估工作量**：小（半天）

#### T30 暗色模式

- **范围**：支持暗色模式（跟随系统或手动切换）
- **包含**：
  - CSS 变量替代硬编码颜色
  - prefers-color-scheme 自动检测
  - 手动 toggle 按钮
- **依赖**：无
- **影响文件**：
  - `apps/web/app/theme.ts`（变更为 CSS 变量定义）
  - `apps/web/app/layout.tsx`（CSS 变量注入）
  - `apps/web/app/page.tsx`、detail、stats、dashboard（颜色引用改用 CSS 变量）
- **预估工作量**：中（1-2 天）

#### T31 Session 报告导出

- **范围**：一键生成 Markdown 格式的 session 分析报告
- **包含**：
  - 报告内容：概览指标 + 工具统计 + token 拆解 + 诊断建议 + 上下文曲线描述
  - 后端生成 Markdown 文本，前端触发下载
- **依赖**：无
- **影响文件**：
  - `apps/server/src/routes/sessions.ts`（/api/session/:id/report 端点）
  - `apps/web/app/session/[id]/page.tsx`（导出按钮）
- **预估工作量**：小（半天）

### P6 — LLM 语义诊断（P2.19 剩余）

#### T14 LlmDiagnoser 实现（已有，状态 pending）

- **已在 roadmap 中**，blocked by model/key 决策
- **建议优先完成**，因为是对诊断质量的质变提升

---

## 五、优先级建议

### 第一梯队（立即开工，影响面大 + 依赖少）

| Task | 说明 | 理由 |
|------|------|------|
| T16 行为效率分析 | 新增 4 项效率指标 | 核心分析能力缺失，填补「agent 怎么工作」的空白 |
| T18 成本归因 | 钱花在哪的下钻 | 成本分析从「多少钱」提升到「花在哪值不值」 |
| T26 测试覆盖 | 核心逻辑测试 | 保障后续修改安全性 |

### 第二梯队（依赖第一梯队或可并行）

| Task | 说明 |
|------|------|
| T17 文件热力图 | 依赖 T16 的文件路径提取 |
| T22 效率评分 | 依赖 T16 的效率指标 |
| T20 项目基线 + 异常检测 | 独立，但需要一定量数据才有意义 |
| T27 代码去重 | 独立，快速 win |

### 第三梯队（锦上添花）

| Task | 说明 |
|------|------|
| T19 Session 对比 | 需要先有足够多的 session 数据 |
| T21 时间序列趋势 | 同上 |
| T23 Git 关联 | 实验性功能，可能 cwd 变更导致找不到仓库 |
| T24 定价补全 | 持续维护任务 |
| T28 Session 标注 | schema 变更需重建 db |
| T29 搜索排序 | 快速 UI 改进 |
| T30 暗色模式 | UI 增强 |
| T31 报告导出 | 低频需求 |
| T14 LLM 诊断 | blocked by model/key 决策 |

---

## 六、不做的事（明确边界）

以下事项不在改进范围内：

1. **实时监控/告警**：本工具是离线分析，非在线服务。不做进程守护、不做 webhook 通知
2. **Prompt 内容分析**：不解析/存储/分析用户 prompt 的语义内容（隐私 + 复杂度）
3. **跨机器聚合**：单机工具，不做远程上传/聚合
4. **CI/CD 集成**：不接入 GitHub Actions 等 CI 流程
5. **竞品数据导入**：只支持自有 parser，不做 LangSmith/Weave 等的数据导入
6. **训练数据生成**：不从 transcript 中提取 SFT/RLHF 训练数据
