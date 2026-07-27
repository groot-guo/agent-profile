# UI 设计规范

Agent Profile Web 端统一视觉与交互约束。改 UI 前必读;新增页面/组件必须遵守。

实现位置:色值 = `apps/web/app/layout.tsx` 的 CSS 变量(明暗双主题);尺寸/字号/圆角/阴影 = `apps/web/app/theme.ts`;共享组件 = `apps/web/app/ui.tsx`。

## 1. 设计基调

「暖纸上的日志仪表盘」:暖色纸面底 + 柔和投影分层,不用硬边框堆叠;数据用等宽字体(呼应 transcript 日志本质),UI 文字用系统黑体。整体取向:安静、低对比、可读性优先。

## 2. 色彩

只允许引用 `theme.ts` 的 `C.*`(CSS 变量),禁止手写 hex(类别/Agent 色板除外,见下)。

| Token | 用途 |
|---|---|
| `bg` / `card` | 页面底 / 卡片底,靠阴影分层而非边框 |
| `text` / `sub` / `mute` | 三级文字:正文 / 次要 / 弱化(时间、计数) |
| `link` | 主行动色(按钮、选中态、链接) |
| `input` / `cc` / `cr` / `out` | 4 类 token 固定色,全局唯一含义 |
| `high` / `medium` / `low` | 严重度,仅用于诊断/异常/错误 |

- 类别色(`CAT_COLOR`)与 Agent 色(`AGENT_COLORS`)是 hex,用法固定为「`${color}1A` 底 + 同色文字」的 chip,或条形图填充;不用于大面积背景。
- 严重度仅三档,文案固定「高 / 中 / 低」(`SEV_LABEL`)。

## 3. 字体与字号

- 字体栈:`--font-ui`(UI/文字)、`--font-mono`(一切数字:token、成本、耗时、百分比、时间)。
- 数字必须加 `.tnum` 类(等宽 + tabular-nums,保证列对齐)。
- 字号只用 `FS` token:`cap 11`(辅助/徽章)/ `sm 12`(正文小)/ `base 13`(正文)/ `title 14`(卡片标题)/ `page 18`(页标题)/ `kpi 20`(KPI 数字)。**不允许出现 10px 及以下字号**。

## 4. 圆角 / 间距 / 阴影

- 圆角 `R`:`sm 6`(小元素)/ `md 10`(按钮、行、输入框)/ `lg 14`(卡片)/ `pill 999`(chip、进度条)。
- 间距 `SP`:4 / 8 / 12 / 16 / 24 / 32,禁止魔术数字。
- 阴影 `SHADOW.card`(静态卡片)/ `SHADOW.lift`(hover 浮起,配合 `.ap-btn`)。

## 5. 换行与截断(硬约束)

信息换行问题统一按以下规则处理,不允许自由发挥:

1. **名称类**(session 名、commit message、工具名、模型名):单行截断 `.clamp1` + `title` 属性兜底全文;两行的场景用 `.clamp2`。
2. **路径类**(cwd、文件路径):显示末两段,`title` 给完整路径;容器内必须 `minWidth: 0` 才能生效截断。
3. **正文类**(诊断 detail/suggestion、提示文案):自然换行 `wordBreak: 'break-word'`,不截断。
4. **数字**:不换行(`whiteSpace: nowrap` via `.tnum`/chip)。
5. 表格单元格:`nowrap` + `maxWidth` + `title`,数值列右对齐等宽。

## 6. 状态与提示(信息明确性)

- 不用裸符号表达状态:`⚠`/`—`/`❌` 禁止单独出现,必须用带文字的 `Chip`(如「异常」「未定价」「错误」)。
- 专业术语必须给解释:KPI、指标、徽章用 `data-tip`(内容区)或 `title`(sidebar 等 `overflow: hidden` 容器内,此时用 `tipMode="native"`)。
- 操作反馈用 `Notice`(ok/err/info),可关闭;不用裸文本行。
- 空态用 `Empty`:说明现状 + 给出下一步(hint),不写情绪化文案。
- 未定价成本:一律显示「未定价」chip + 原因提示,不估算、不显示 `—`。

## 7. 共享组件(新增 UI 先查这里)

`ui.tsx`:`Card`(标题+右侧 meta)、`Chip`、`SoftButton`(default/primary/ghost)、`Notice`、`BarRow`(比例条)、`StatCard`(KPI)、`Empty`、`SectionTitle`、`TokenStrip`(签名元素)。

- **TokenStrip 指纹条**:4 类 token 构成比例条,是全局签名元素;session 行、详情页头部、Token 拆解卡三处共用,禁止改配色或形状(圆角 pill + 固定 4 色顺序 input/cc/cr/out)。
- 行 hover 统一 `.ap-row`;按钮 hover 浮起统一 `.ap-btn`;不要自写 `:hover` 内联变体。
- 页面骨架:`maxWidth 1100~1200` 居中 + `padding SP.xl`。

## 8. 交互与动效

- 动效只做「轻反馈」:hover 浮起 150ms、淡入 250ms、chevron 旋转;禁止页面级动画、loading 动画花活。
- 必须尊重 `prefers-reduced-motion`(全局已处理,新增动画走 CSS 类,不自建 keyframes)。
- 焦点可见:不覆盖 `:focus-visible` 的全局 outline。
- header 在 `?embed=1`(iframe 嵌入)时不渲染。

### Session 发现

- Home 左侧使用一体化「Session 检索台」而不是无层级的表单堆叠。固定信息顺序是：
  当前匹配数与总数 → 主搜索 → 项目/时间/排序字段 → 结果视图 → Agent 范围 →
  本地数据操作 → 按时间分组的结果列表。筛选是主任务，扫描、刷新和数据管理必须作为
  次级工具条，不得与筛选控件混成同一层级。
- 每个原生选择框必须有可见的字段标签；搜索是唯一主输入。快捷视图使用等宽分段控件，
  Agent 使用带来源图标与数量的紧凑选择器，活动筛选显示项数并提供「清除全部筛选」。
  列表底部同时显示已渲染/匹配数量与项目数，避免用户把 120 条增量渲染误认为完整结果。
- 检索台在桌面保持固定侧栏，在 `760px` 以下随 Home 骨架堆叠为全宽区域。字段可扩展但
  不得产生横向滚动；窄屏仍需同时保留项目、时间、排序、快捷视图、Agent 与数据操作，
  不能用仅 hover 可见的控制替代。Session 列表保留独立纵向滚动和至少一行可见结果。
- 默认使用按轻量时间边界分组的扁平最近列表；项目是每行次级信息和带数量的精确选择
  条件，不能要求用户先展开所有项目目录。标题/项目/路径的模糊发现由统一搜索框承担，
  不让项目选择框同时承担精确选择与隐式模糊匹配两种行为。
- Agent、项目、不限时间/最近 1/7/30/90 天、文本、异常/未定价快捷视图和排序必须可
  组合，并把稳定状态保存在 URL；打开 Session 后浏览器返回应恢复筛选、选择与列表滚动
  位置。
- 来源标题优先。无标题 Session 使用「Agent · 项目 · 本地开始时间」作为仅展示回退，
  不主显 Session ID，也不得从 prompt、answer 或 reasoning 内容生成或持久化标题。
- Session 行必须使用原生 `button` 语义和可见焦点。超过 120 条匹配结果时按批次加载，
  不允许默认创建无边界 DOM。

## 9. 文案

- 界面语言:中文为主,技术术语保留英文(token、cache、input/output)。
- 按钮写动作结果(「重新扫描」不是「Submit」);同一动作全流程同名。
- 提示文案说「是什么 + 怎么办」,不道歉、不含糊(如「包含未知模型,成本无法计算」)。
