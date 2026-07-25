import type { Pricing, SessionDetail, Span } from './types';

// ===== 诊断结果结构 =====

export type DiagnosisType =
  | 'repeated_read'
  | 'large_output'
  | 'low_cache'
  | 'context_bloat'
  | 'long_thinking'
  | 'repeated_failure'
  | 'read_scope_too_large'
  | 'thinking_detour'
  | 'ineffective_exploration'
  | 'tool_off_target';

export type Severity = 'high' | 'medium' | 'low';

export interface DiagnosisFinding {
  type: DiagnosisType;
  severity: Severity;
  title: string;
  detail: string;
  wastedTokens: number; // 估算可省 token 规模（findings 间可能有重叠，total 非去重）
  wastedCost: number; // 按 input_price 估算的 cost 上限，0 且 costUnknown=true 表示无定价
  costUnknown: boolean;
  suggestion: string;
  spanIds: string[]; // 关联 span，前端可跳转定位
}

export interface DiagnosisResult {
  findings: DiagnosisFinding[];
  totalWastedTokens: number;
  totalWastedCost: number;
  costUnknownCount: number;
}

export interface DiagnosisThresholds {
  repeatedReadMin: number; // 同文件 Read 多少次算重复
  largeOutputBytes: number; // tool 输出多少字节算大
  largeOutputMinAfterTurns: number; // 大输出至少被后续几轮携带才报
  lowCacheRate: number; // cache 命中率低于此算低
  lowCacheMinInput: number; // 总输入低于此不报（小会话命中率意义不大）
  contextBloatUtilization: number; // 窗口利用率超过此算堆积
  contextBloatMinPeak: number; // 峰值上下文超过此也算堆积（无窗口配置时）
  longThinkingChars: number; // thinking 字符数超过此算过长
  repeatedFailureMin: number; // 同工具连续失败几次算重复试错
  bytesPerToken: number; // 字节→token 估算系数
  readScopeBytes: number; // P2: Read 无 limit 且输出超此字节报"范围过大"
}

export const DEFAULT_THRESHOLDS: DiagnosisThresholds = {
  repeatedReadMin: 2,
  largeOutputBytes: 10_000,
  largeOutputMinAfterTurns: 1,
  lowCacheRate: 0.5,
  lowCacheMinInput: 10_000,
  contextBloatUtilization: 0.7,
  contextBloatMinPeak: 100_000,
  longThinkingChars: 4_000,
  repeatedFailureMin: 2,
  bytesPerToken: 4,
  readScopeBytes: 20_000,
};

export interface DiagnoseOptions {
  pricingLookup?: (model?: string) => Pricing | undefined;
  contextWindowLookup?: (model?: string) => number | undefined;
  thresholds?: Partial<DiagnosisThresholds>;
  llmDiagnoser?: LlmDiagnoser; // P2.19 语义诊断，注入则跑 LLM 分析
}

// P2.19 LLM 语义诊断接口（实现由调用方注入；第一版不提供实现，预留接入点）
export interface LlmDiagnoseContext {
  sessionId: string;
  taskTitle?: string;
  thinkingTexts: { spanId: string; text: string }[];
  toolCallSequence: { spanId: string; name: string; input: string; isError: boolean }[];
}

export interface LlmFinding {
  type: 'thinking_detour' | 'ineffective_exploration' | 'tool_off_target';
  severity: Severity;
  title: string;
  detail: string;
  suggestion: string;
  spanIds: string[];
}

export interface LlmDiagnoser {
  diagnose(ctx: LlmDiagnoseContext): Promise<LlmFinding[]>;
}

export async function diagnoseSession(
  detail: SessionDetail,
  options: DiagnoseOptions = {},
): Promise<DiagnosisResult> {
  const result = diagnoseSessionSync(detail, options);

  // P2.19 LLM 语义诊断（注入 llmDiagnoser 才跑；定性结果 wastedTokens=0，靠 severity 排序）
  if (options.llmDiagnoser) {
    const thinkings = detail.spans.filter((s) => s.type === 'thinking');
    const tools = detail.spans.filter((s) => s.type === 'tool_call');
    const ctx: LlmDiagnoseContext = {
      sessionId: detail.id,
      taskTitle: detail.name,
      thinkingTexts: thinkings
        .filter((th) => typeof th.metadata?.thinking === 'string')
        .map((th) => ({ spanId: th.id, text: th.metadata?.thinking as string })),
      toolCallSequence: tools.map((tool) => ({
        spanId: tool.id,
        name: tool.name,
        input: typeof tool.metadata?.input === 'string' ? tool.metadata.input : '',
        isError: tool.isError,
      })),
    };
    const llmFindings = await options.llmDiagnoser.diagnose(ctx);
    for (const lf of llmFindings) {
      result.findings.push({ ...lf, wastedTokens: 0, wastedCost: 0, costUnknown: false });
    }
    // 重新排序
    const sevRank: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
    result.findings.sort(
      (a, b) => sevRank[a.severity] - sevRank[b.severity] || b.wastedTokens - a.wastedTokens,
    );
  }

  return result;
}

// 同步版本：仅跑 7 条启发式规则，不含 LLM 诊断
export function diagnoseSessionSync(
  detail: SessionDetail,
  options: DiagnoseOptions = {},
): DiagnosisResult {
  const t: DiagnosisThresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds };
  const pricingLookup = options.pricingLookup ?? (() => undefined);
  const ctxWindowLookup = options.contextWindowLookup ?? (() => undefined);

  const turns = detail.spans
    .filter((s): s is Span => s.type === 'llm_turn')
    .sort((a, b) => a.startTime - b.startTime);
  const tools = detail.spans
    .filter((s): s is Span => s.type === 'tool_call')
    .sort((a, b) => a.startTime - b.startTime);
  const thinkings = detail.spans.filter((s) => s.type === 'thinking');

  const mainModel = turns.find((turn) => turn.model)?.model;
  const mainPricing = pricingLookup(mainModel);

  // token→cost：按关联模型 input_price 估算（cache 实际更便宜，故为上限）
  const costOfTokens = (tokens: number, model?: string): { cost: number; unknown: boolean } => {
    const p = pricingLookup(model) ?? mainPricing;
    if (!p) return { cost: 0, unknown: true };
    return { cost: (tokens * p.inputPrice) / 1e6, unknown: false };
  };

  const findings: DiagnosisFinding[] = [
    ...detectRepeatedRead(tools, t, costOfTokens),
    ...detectLargeOutput(turns, tools, t, costOfTokens),
    ...detectLowCache(detail, turns, t, costOfTokens),
    ...detectContextBloat(detail, turns, t, ctxWindowLookup, costOfTokens),
    ...detectLongThinking(thinkings, t, costOfTokens),
    ...detectRepeatedFailure(tools, turns, t, costOfTokens),
    ...detectReadScope(tools, t, costOfTokens),
  ];

  // 排序：severity 优先（high>medium>low），同 severity 内 wastedTokens 降序
  const sevRank: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  findings.sort(
    (a, b) => sevRank[a.severity] - sevRank[b.severity] || b.wastedTokens - a.wastedTokens,
  );

  return {
    findings,
    totalWastedTokens: findings.reduce((s, f) => s + f.wastedTokens, 0),
    totalWastedCost: findings.reduce((s, f) => s + f.wastedCost, 0),
    costUnknownCount: findings.filter((f) => f.costUnknown).length,
  };
}

// ===== 1. 重复读取 =====
// Claude Code Read 的 input 是 { file_path, offset?, limit? }，parser 存为 JSON 字符串
const READ_TOOLS = new Set(['Read', 'read_file']);

function extractFilePath(tool: Span): string | undefined {
  const input = tool.metadata?.input;
  if (typeof input !== 'string') return undefined;
  try {
    const obj = JSON.parse(input) as { file_path?: unknown };
    if (typeof obj.file_path === 'string') return obj.file_path;
  } catch {
    /* input 可能被截断成非法 JSON，跳过 */
  }
  return undefined;
}

// Read 的 offset/limit（判断是否整文件读）
function extractReadLimit(tool: Span): { limit?: number } | undefined {
  const input = tool.metadata?.input;
  if (typeof input !== 'string') return undefined;
  try {
    const obj = JSON.parse(input) as { limit?: unknown };
    return typeof obj.limit === 'number' ? { limit: obj.limit } : {};
  } catch {
    return undefined;
  }
}

// ===== P2.18 Read 范围过大（启发式） =====
// 整文件读（无 limit）且输出大 → 建议用 offset/limit 收窄
function detectReadScope(
  tools: Span[],
  t: DiagnosisThresholds,
  costOfTokens: CostFn,
): DiagnosisFinding[] {
  const findings: DiagnosisFinding[] = [];
  for (const tool of tools) {
    if (!READ_TOOLS.has(tool.name)) continue;
    if (tool.outputBytes < t.readScopeBytes) continue;
    const lim = extractReadLimit(tool);
    if (lim?.limit != null) continue; // 有 limit 不算整文件读（limit=0 也是显式设置）
    const path = extractFilePath(tool);
    const estTok = estTokens(tool.outputBytes, t);
    const wastedTokens = Math.round(estTok * 0.5); // 假设只需读一半
    const { cost, unknown } = costOfTokens(wastedTokens, tool.model);
    findings.push({
      type: 'read_scope_too_large',
      severity: sevByTokens(wastedTokens, 5_000, 1_000),
      title: `${tool.name} 整文件读取 ${fmtBytes(tool.outputBytes)}`,
      detail: `${path ? shortPath(path) : '?'} 整文件读取 ${fmtBytes(tool.outputBytes)}（约 ${fmtTok(estTok)} token），未用 limit 收窄，预计只需一半`,
      wastedTokens,
      wastedCost: cost,
      costUnknown: unknown,
      suggestion: '用 offset/limit 只读需要的片段，或先 Grep 定位再 Read 关键区域',
      spanIds: [tool.id],
    });
  }
  return findings;
}

function detectRepeatedRead(
  tools: Span[],
  t: DiagnosisThresholds,
  costOfTokens: CostFn,
): DiagnosisFinding[] {
  const byPath = new Map<string, Span[]>();
  for (const r of tools) {
    if (!READ_TOOLS.has(r.name)) continue;
    const p = extractFilePath(r);
    if (!p) continue;
    const arr = byPath.get(p);
    if (arr) arr.push(r);
    else byPath.set(p, [r]);
  }

  const findings: DiagnosisFinding[] = [];
  for (const [path, rs] of byPath) {
    if (rs.length < t.repeatedReadMin) continue;
    const wastedTokens = rs.slice(1).reduce((s, r) => s + estTokens(r.outputBytes, t), 0);
    if (wastedTokens === 0) continue;
    const { cost, unknown } = costOfTokens(wastedTokens, rs[0].model);
    findings.push({
      type: 'repeated_read',
      severity: sevByTokens(wastedTokens, 10_000, 2_000),
      title: `${rs[0].name} 重复读取 ${rs.length} 次：${shortPath(path)}`,
      detail: `${shortPath(path)} 被读取 ${rs.length} 次，后 ${rs.length - 1} 次输出约 ${fmtTok(wastedTokens)} token 可复用首次结果避免`,
      wastedTokens,
      wastedCost: cost,
      costUnknown: unknown,
      suggestion: '保留首次读取结果在上下文中复用；若只需变更部分，用 offset/limit 只读相关区域',
      spanIds: rs.map((r) => r.id),
    });
  }
  return findings;
}

// ===== 2. 大输出持续携带 =====
function detectLargeOutput(
  turns: Span[],
  tools: Span[],
  t: DiagnosisThresholds,
  costOfTokens: CostFn,
): DiagnosisFinding[] {
  const findings: DiagnosisFinding[] = [];
  for (const tool of tools) {
    if (tool.outputBytes < t.largeOutputBytes) continue;
    const afterTurns = turns.filter((turn) => turn.startTime > tool.startTime);
    if (afterTurns.length < t.largeOutputMinAfterTurns) continue;
    const estTok = estTokens(tool.outputBytes, t);
    // ×后续轮数是理论上限：实际可能因上下文压缩低于此值，但占用的上下文空间是真实的
    const wastedTokens = estTok * afterTurns.length;
    const { cost, unknown } = costOfTokens(wastedTokens, tool.model);
    findings.push({
      type: 'large_output',
      severity: sevByTokens(wastedTokens, 500_000, 50_000),
      title: `${tool.name} 大输出被后续 ${afterTurns.length} 轮持续携带`,
      detail: `${tool.name} 输出 ${fmtBytes(tool.outputBytes)}（约 ${fmtTok(estTok)} token），在后续 ${afterTurns.length} 轮上下文中重复携带，累计理论上限约 ${fmtTok(wastedTokens)} token（实际可能因上下文压缩更低）`,
      wastedTokens,
      wastedCost: cost,
      costUnknown: unknown,
      suggestion: '大输出读取后及时清理或用 head/grep 收窄到关键片段，避免长输出长期占用上下文',
      spanIds: [tool.id],
    });
  }
  return findings;
}

// ===== 3. cache 命中率低 =====
function detectLowCache(
  detail: SessionDetail,
  turns: Span[],
  t: DiagnosisThresholds,
  costOfTokens: CostFn,
): DiagnosisFinding[] {
  const totalInput = detail.inputTokens + detail.cacheCreationTokens + detail.cacheReadTokens;
  if (totalInput < t.lowCacheMinInput) return [];
  if (detail.cacheHitRate >= t.lowCacheRate) return [];

  const nonCached = detail.inputTokens + detail.cacheCreationTokens;
  const { cost, unknown } = costOfTokens(nonCached);
  return [
    {
      type: 'low_cache',
      severity: detail.cacheHitRate < 0.3 ? 'high' : 'medium',
      title: `cache 命中率低（${(detail.cacheHitRate * 100).toFixed(0)}%）`,
      detail: `总输入 ${fmtTok(totalInput)} 中仅 ${(detail.cacheHitRate * 100).toFixed(0)}% 命中 cache，未命中部分 ${fmtTok(nonCached)}（input+cache_creation）按 input 价计费，本可走更便宜的 cache_read`,
      wastedTokens: nonCached,
      wastedCost: cost,
      costUnknown: unknown,
      suggestion:
        '检查是否有频繁切换对话或长间隔导致 cache 失效；保持请求模式稳定以提升 cache 命中',
      spanIds: turns.map((turn) => turn.id),
    },
  ];
}

// ===== 4. 上下文堆积 =====
function detectContextBloat(
  detail: SessionDetail,
  turns: Span[],
  t: DiagnosisThresholds,
  ctxWindowLookup: (model?: string) => number | undefined,
  costOfTokens: CostFn,
): DiagnosisFinding[] {
  if (turns.length === 0) return [];
  const peak = detail.peakContextTokens;

  const windowModel = turns.find((turn) => turn.model && ctxWindowLookup(turn.model))?.model;
  const window = windowModel ? ctxWindowLookup(windowModel) : undefined;
  const utilization = window ? peak / window : undefined;

  const bloatByUtil = utilization != null && utilization > t.contextBloatUtilization;
  const bloatBySize = peak >= t.contextBloatMinPeak;
  if (!bloatByUtil && !bloatBySize) return [];

  // 粗估：峰值上下文中约 40% 为可压缩的历史累积（工具输出/thinking/早期对话）
  const wastedTokens = Math.round(peak * 0.4);
  const { cost, unknown } = costOfTokens(wastedTokens, windowModel);
  const utilTxt = utilization != null ? `，窗口利用率 ${(utilization * 100).toFixed(0)}%` : '';
  return [
    {
      type: 'context_bloat',
      severity:
        utilization != null
          ? utilization > 0.85
            ? 'high'
            : 'medium'
          : peak > 200_000
            ? 'high'
            : 'medium',
      title: `上下文堆积（峰值 ${fmtTok(peak)}${utilTxt}）`,
      detail: `峰值上下文达 ${fmtTok(peak)}${window ? ` / 窗口 ${fmtTok(window)}` : ''}${utilTxt}，其中约 ${fmtTok(wastedTokens)} token 为可压缩的历史累积`,
      wastedTokens,
      wastedCost: cost,
      costUnknown: unknown,
      suggestion: '对早期工具输出与已解决的中问步骤做摘要/清理；长会话考虑分段或主动压缩历史',
      spanIds: turns.slice(-3).map((turn) => turn.id),
    },
  ];
}

// ===== 5. 过长 thinking =====
// 长 session 可能有大量过长 thinking，逐条列出会淹没重点：取 top N 单独报，其余聚合成一条
const LONG_THINKING_TOP = 5;

function detectLongThinking(
  thinkings: Span[],
  t: DiagnosisThresholds,
  costOfTokens: CostFn,
): DiagnosisFinding[] {
  const longs: {
    span: Span;
    text: string;
    estTok: number;
    wastedTokens: number;
    cost: number;
    unknown: boolean;
  }[] = [];
  for (const th of thinkings) {
    const text = th.metadata?.thinking;
    if (typeof text !== 'string') continue;
    // parser 对超 10KB 的 thinking 做了截断，text.length 是下限
    if (text.length < t.longThinkingChars) continue;
    const estTok = Math.round(text.length / t.bytesPerToken);
    const wastedTokens = Math.round(estTok * 0.5); // 假设可精简一半
    const { cost, unknown } = costOfTokens(wastedTokens, th.model);
    longs.push({ span: th, text, estTok, wastedTokens, cost, unknown });
  }
  if (longs.length === 0) return [];
  longs.sort((a, b) => b.wastedTokens - a.wastedTokens);

  const findings: DiagnosisFinding[] = longs.slice(0, LONG_THINKING_TOP).map((l) => ({
    type: 'long_thinking',
    severity: l.estTok > 5_000 ? 'high' : 'medium',
    title: `thinking 过长（≥ ${fmtTok(l.estTok)} token）`,
    detail: `某轮 thinking 至少 ${l.text.length} 字符（约 ${fmtTok(l.estTok)} token），含于该轮 output，精简后预计可省 ${fmtTok(l.wastedTokens)}`,
    wastedTokens: l.wastedTokens,
    wastedCost: l.cost,
    costUnknown: l.unknown,
    suggestion: '检查推理是否绕远路，保留关键决策步骤、删除反复试探的内心独白',
    spanIds: [l.span.id],
  }));

  if (longs.length > LONG_THINKING_TOP) {
    const rest = longs.slice(LONG_THINKING_TOP);
    const restWasted = rest.reduce((s, l) => s + l.wastedTokens, 0);
    const { cost, unknown } = costOfTokens(restWasted, longs[0].span.model);
    findings.push({
      type: 'long_thinking',
      severity: 'medium',
      title: `另有 ${rest.length} 轮 thinking 过长（${fmtTok(rest[rest.length - 1].estTok)}~${fmtTok(rest[0].estTok)} token）`,
      detail: `共 ${rest.length} 轮 thinking 超过 ${t.longThinkingChars} 字符，累计可精简约 ${fmtTok(restWasted)} token`,
      wastedTokens: restWasted,
      wastedCost: cost,
      costUnknown: unknown,
      suggestion: '批量检查这些轮的推理，精简冗余思考',
      spanIds: rest.map((l) => l.span.id),
    });
  }
  return findings;
}

// ===== 6. 重复试错（同工具连续失败） =====
function detectRepeatedFailure(
  tools: Span[],
  turns: Span[],
  t: DiagnosisThresholds,
  costOfTokens: CostFn,
): DiagnosisFinding[] {
  const byName = new Map<string, Span[]>();
  for (const tool of tools) {
    const arr = byName.get(tool.name);
    if (arr) arr.push(tool);
    else byName.set(tool.name, [tool]);
  }

  const findings: DiagnosisFinding[] = [];
  for (const [name, ts] of byName) {
    let runStart = 0,
      runLen = 0,
      bestStart = 0,
      bestLen = 0;
    for (let i = 0; i < ts.length; i++) {
      if (ts[i].isError) {
        if (runLen === 0) runStart = i;
        runLen++;
        if (runLen > bestLen) {
          bestLen = runLen;
          bestStart = runStart;
        }
      } else {
        runLen = 0;
      }
    }
    if (bestLen < t.repeatedFailureMin) continue;

    const run = ts.slice(bestStart, bestStart + bestLen);
    const parentIds = new Set(run.map((r) => r.parentId));
    const parentTurns = turns.filter((turn) => parentIds.has(turn.id));
    const wastedTokens = parentTurns.reduce((s, turn) => s + turn.outputTokens, 0);
    const { cost, unknown } = costOfTokens(wastedTokens, run[0].model);
    findings.push({
      type: 'repeated_failure',
      severity: bestLen >= 4 ? 'high' : 'medium',
      title: `${name} 连续失败 ${bestLen} 次`,
      detail: `${name} 连续失败 ${bestLen} 次后才继续，关联 ${parentTurns.length} 轮推理，消耗约 ${fmtTok(wastedTokens)} output token`,
      wastedTokens,
      wastedCost: cost,
      costUnknown: unknown,
      suggestion: '失败后先读错误输出定位根因再重试，避免盲目改参数；连续失败时停下分析',
      spanIds: run.map((r) => r.id),
    });
  }
  return findings;
}

// ===== 辅助 =====
type CostFn = (tokens: number, model?: string) => { cost: number; unknown: boolean };

function estTokens(bytes: number, t: DiagnosisThresholds): number {
  return Math.round(bytes / t.bytesPerToken);
}

function sevByTokens(n: number, high: number, medium: number): Severity {
  if (n > high) return 'high';
  if (n > medium) return 'medium';
  return 'low';
}

function shortPath(p: string): string {
  const parts = p.split('/');
  return parts.length > 2 ? parts.slice(-2).join('/') : p;
}

function fmtBytes(b: number): string {
  if (b >= 1_000_000) return `${(b / 1_000_000).toFixed(2)}MB`;
  if (b >= 1_000) return `${(b / 1_000).toFixed(1)}KB`;
  return `${b}B`;
}

function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}
