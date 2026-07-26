import { COST_CALCULATOR_VERSION, COST_CURRENCY, calcCost } from './pricing';
import type {
  CostAttribution,
  CostByCategory,
  CostByPhase,
  EfficiencyMetrics,
  FileOperation,
  LatencyStats,
  ParsedSession,
  PerformanceMetrics,
  Pricing,
  SessionSummary,
  Span,
  ThinkingActionRatio,
  ToolSuccessRate,
} from './types';

export interface FileMeta {
  mtime: number;
  size: number;
  lines: number;
}

// 填 llm_turn 的 contextTokens + cost，聚合 session 级四类 token / cost / 上下文 / cache 命中率
export function analyzeSession(
  parsed: ParsedSession,
  pricingLookup: (model?: string, at?: number) => Pricing | undefined,
  fileMeta?: FileMeta,
  importedAt?: number,
): { summary: SessionSummary; spans: Span[] } {
  const calculatedAt = importedAt ?? Date.now();
  let inputTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;
  let outputTokens = 0;
  let totalCost = 0;
  let costUnknownCount = 0;
  let peakContext = 0;
  let sumContext = 0;
  let llmTurnCount = 0;

  for (const span of parsed.spans) {
    if (span.type === 'llm_turn') {
      span.contextTokens =
        (span.inputTokens || 0) + (span.cacheCreationTokens || 0) + (span.cacheReadTokens || 0);
      const pricing = pricingLookup(span.model, span.startTime);
      const { cost, unknown } = calcCost(span, pricing);
      span.cost = cost;
      span.costUnknown = unknown;
      span.costCurrency = COST_CURRENCY;
      span.pricingEffectiveFrom = pricing?.effectiveFrom ?? 0;
      span.costCalculatedAt = calculatedAt;
      span.costCalculatorVersion = COST_CALCULATOR_VERSION;
      if (unknown) costUnknownCount++;
      inputTokens += span.inputTokens || 0;
      cacheCreationTokens += span.cacheCreationTokens || 0;
      cacheReadTokens += span.cacheReadTokens || 0;
      outputTokens += span.outputTokens || 0;
      totalCost += cost || 0;
      peakContext = Math.max(peakContext, span.contextTokens || 0);
      sumContext += span.contextTokens || 0;
      llmTurnCount++;
    } else {
      span.contextTokens = 0;
    }
  }

  const totalInput = inputTokens + cacheCreationTokens + cacheReadTokens;
  const cacheHitRate = totalInput > 0 ? cacheReadTokens / totalInput : 0;

  const summary: SessionSummary = {
    id: parsed.sessionId,
    name: parsed.meta.name,
    filePath: parsed.meta.filePath,
    agent: parsed.meta.agent,
    startTime: parsed.meta.startTime,
    endTime: parsed.meta.endTime,
    cwd: parsed.meta.cwd,
    gitBranch: parsed.meta.gitBranch,
    claudeVersion: parsed.meta.claudeVersion,
    inputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    outputTokens,
    totalCost,
    costUnknownCount,
    costCurrency: COST_CURRENCY,
    costCalculatedAt: calculatedAt,
    costCalculatorVersion: COST_CALCULATOR_VERSION,
    peakContextTokens: peakContext,
    avgContextTokens: llmTurnCount > 0 ? Math.round(sumContext / llmTurnCount) : 0,
    cacheHitRate,
    fileMtime: fileMeta?.mtime,
    fileSize: fileMeta?.size,
    fileLines: fileMeta?.lines,
    messageCount: parsed.meta.messageCount,
    importedAt: calculatedAt,
  };

  return { summary, spans: parsed.spans };
}

const TOOL_CATEGORY: Record<string, string> = {
  Read: 'file',
  Write: 'file',
  Edit: 'file',
  Grep: 'file',
  Glob: 'file',
  Bash: 'command',
  WebFetch: 'network',
  WebSearch: 'network',
  AskUserQuestion: 'interactive',
  Workflow: 'orchestration',
  Task: 'orchestration',
  TaskCreate: 'orchestration',
  ToolSearch: 'meta',
  TodoWrite: 'meta',
};

function catOf(name: string): string {
  if (name.startsWith('mcp__')) return 'mcp';
  return TOOL_CATEGORY[name] || 'other';
}

function extractFilePath(toolInput: unknown): string | undefined {
  if (typeof toolInput !== 'string') return undefined;
  try {
    const obj = JSON.parse(toolInput) as { file_path?: unknown };
    if (typeof obj.file_path === 'string') return obj.file_path;
  } catch {
    /* truncated JSON */
  }
  return undefined;
}

const FILE_TOOLS = new Set(['Read', 'Write', 'Edit']);

export function analyzeEfficiency(spans: Span[]): EfficiencyMetrics {
  const tools = spans
    .filter((s) => s.type === 'tool_call')
    .sort((a, b) => a.startTime - b.startTime);
  const turns = spans
    .filter((s) => s.type === 'llm_turn')
    .sort((a, b) => a.startTime - b.startTime);
  const thinkings = spans.filter((s) => s.type === 'thinking');

  // 1. Tool success rates
  const toolStats = new Map<string, { total: number; errors: number }>();
  for (const t of tools) {
    const entry = toolStats.get(t.name) || { total: 0, errors: 0 };
    entry.total++;
    if (t.isError) entry.errors++;
    toolStats.set(t.name, entry);
  }
  const toolSuccessRates: ToolSuccessRate[] = [...toolStats.entries()]
    .map(([name, { total, errors }]) => ({
      name,
      category: catOf(name),
      total,
      errors,
      successRate: total > 0 ? (total - errors) / total : 0,
    }))
    .sort((a, b) => b.total - a.total);

  // 2. Thinking/action ratio per turn
  const thinkingActionRatios: ThinkingActionRatio[] = turns.map((turn, i) => {
    // Find thinking spans that are children of this turn
    const childThinkings = thinkings.filter((th) => th.parentId === turn.id);
    const thinkingChars = childThinkings.reduce(
      (sum, th) =>
        sum +
        (typeof th.metadata?.thinking === 'string' ? (th.metadata.thinking as string).length : 0),
      0,
    );
    // Find tool calls that are children of this turn
    const childTools = tools.filter((t) => t.parentId === turn.id);
    return {
      turnIndex: i + 1,
      turnId: turn.id,
      thinkingChars,
      toolCalls: childTools.length,
      ratio: childTools.length > 0 ? Math.round(thinkingChars / childTools.length) : 0,
    };
  });

  // 3. Context growth velocity
  const contextGrowthPerTurn = turns.map((turn, i) => {
    const ctx =
      turn.contextTokens || turn.inputTokens + turn.cacheCreationTokens + turn.cacheReadTokens;
    const prevCtx =
      i > 0
        ? turns[i - 1].contextTokens ||
          turns[i - 1].inputTokens + turns[i - 1].cacheCreationTokens + turns[i - 1].cacheReadTokens
        : 0;
    return { turnIndex: i + 1, turnId: turn.id, contextTokens: ctx, delta: ctx - prevCtx };
  });
  const contextGrowthVelocity =
    turns.length > 1
      ? Math.round(
          contextGrowthPerTurn.slice(1).reduce((s, t) => s + Math.max(0, t.delta), 0) /
            (turns.length - 1),
        )
      : 0;

  // 4. File operations
  const fileOps = new Map<string, FileOperation>();
  for (const t of tools) {
    if (!FILE_TOOLS.has(t.name)) continue;
    const path = extractFilePath(t.metadata?.input);
    if (!path) continue;
    const entry = fileOps.get(path) || { path, reads: 0, edits: 0, writes: 0 };
    if (t.name === 'Read') entry.reads++;
    else if (t.name === 'Edit') entry.edits++;
    else if (t.name === 'Write') entry.writes++;
    fileOps.set(path, entry);
  }
  const fileOperations = [...fileOps.values()].sort(
    (a, b) => b.reads + b.edits + b.writes - (a.reads + a.edits + a.writes),
  );
  const filesRead = fileOperations.filter((f) => f.reads > 0).length;
  const filesReadThenEdited = fileOperations.filter(
    (f) => f.reads > 0 && (f.edits > 0 || f.writes > 0),
  ).length;
  const readToEditRate = filesRead > 0 ? filesReadThenEdited / filesRead : 0;

  return {
    toolSuccessRates,
    thinkingActionRatios,
    contextGrowthVelocity,
    contextGrowthPerTurn,
    fileOperations,
    readToEditRate,
  };
}

const CAT_LABEL: Record<string, string> = {
  file: '文件操作',
  command: '命令执行',
  network: '网络',
  interactive: '用户交互',
  mcp: 'MCP',
  orchestration: '编排',
  meta: '元工具',
  unattributed: '无工具调用',
  other: '其他',
};

const PHASE_NAMES = ['探索期', '实现期', '验证期'];

export interface EfficiencyScore {
  score: number; // 0-100
  tokenEfficiency: number; // output / total, normalized
  cacheUtilization: number; // cache_hit_rate
  toolSuccess: number; // overall tool success rate
  wasteAvoidance: number; // 1 - wastedCost/totalCost
  percentile?: number; // rank among all sessions (set by caller)
  cohortSize?: number;
}

export function calcEfficiencyScore(
  efficiency: EfficiencyMetrics,
  cacheHitRate: number,
  totalTokens: number,
  outputTokens: number,
  totalCost: number,
  wastedCost?: number,
): EfficiencyScore {
  const tokenEfficiency = totalTokens > 0 ? Math.min(1, (outputTokens / totalTokens) * 3) : 0;
  const cacheUtilization = cacheHitRate;
  const totalToolCalls = efficiency.toolSuccessRates.reduce((sum, tool) => sum + tool.total, 0);
  const totalToolErrors = efficiency.toolSuccessRates.reduce((sum, tool) => sum + tool.errors, 0);
  const toolSuccess = totalToolCalls > 0 ? (totalToolCalls - totalToolErrors) / totalToolCalls : 1;
  const wasteAvoidance =
    totalCost > 0 && wastedCost != null ? 1 - Math.min(1, wastedCost / totalCost) : 1;

  const score = Math.round(
    (tokenEfficiency * 0.2 + cacheUtilization * 0.3 + toolSuccess * 0.2 + wasteAvoidance * 0.3) *
      100,
  );
  return {
    score: Math.max(0, Math.min(100, score)),
    tokenEfficiency,
    cacheUtilization,
    toolSuccess,
    wasteAvoidance,
  };
}

export function analyzeCostAttribution(spans: Span[], wastedCost?: number): CostAttribution {
  const turns = spans
    .filter((s) => s.type === 'llm_turn')
    .sort((a, b) => a.startTime - b.startTime);
  const tools = spans.filter((s) => s.type === 'tool_call');

  const totalCost = turns.reduce((s, t) => s + (t.cost || 0), 0);

  // 1. Cost by tool category
  const catCost = new Map<string, { cost: number; turnIds: Set<string>; toolCount: number }>();
  const toolsByTurn = new Map<string, Span[]>();
  for (const tool of tools) {
    if (!tool.parentId) continue;
    const children = toolsByTurn.get(tool.parentId) || [];
    children.push(tool);
    toolsByTurn.set(tool.parentId, children);
  }
  const addCategoryCost = (category: string, turn: Span, cost: number, toolCount: number) => {
    const entry = catCost.get(category) || { cost: 0, turnIds: new Set<string>(), toolCount: 0 };
    entry.cost += cost;
    entry.turnIds.add(turn.id);
    entry.toolCount += toolCount;
    catCost.set(category, entry);
  };
  for (const turn of turns) {
    const childTools = toolsByTurn.get(turn.id) || [];
    if (childTools.length === 0) {
      addCategoryCost('unattributed', turn, turn.cost || 0, 0);
      continue;
    }
    const toolsByCategory = new Map<string, number>();
    for (const tool of childTools) {
      const category = catOf(tool.name);
      toolsByCategory.set(category, (toolsByCategory.get(category) || 0) + 1);
    }
    for (const [category, toolCount] of toolsByCategory) {
      // A turn's LLM cost is distributed by its tool-call mix, so category
      // totals always reconcile exactly with the session total.
      addCategoryCost(
        category,
        turn,
        ((turn.cost || 0) * toolCount) / childTools.length,
        toolCount,
      );
    }
  }

  const costByCategory: CostByCategory[] = [...catCost.entries()]
    .map(([category, e]) => ({
      category: CAT_LABEL[category] || category,
      cost: e.cost,
      turnCount: e.turnIds.size,
      toolCount: e.toolCount,
      percentage: totalCost > 0 ? e.cost / totalCost : 0,
    }))
    .sort((a, b) => b.cost - a.cost);

  // 2. Cost by phase (split turns into 3 equal time-based phases)
  const phaseSize = Math.max(1, Math.ceil(turns.length / 3));
  const costByPhase: CostByPhase[] = [];
  for (let p = 0; p < 3; p++) {
    const phaseTurns = turns.slice(p * phaseSize, (p + 1) * phaseSize);
    if (phaseTurns.length === 0) continue;
    const phaseCost = phaseTurns.reduce((s, t) => s + (t.cost || 0), 0);
    const phaseInput = phaseTurns.reduce(
      (s, t) => s + t.inputTokens + t.cacheCreationTokens + t.cacheReadTokens,
      0,
    );
    const phaseOutput = phaseTurns.reduce((s, t) => s + t.outputTokens, 0);
    costByPhase.push({
      phase: PHASE_NAMES[p],
      turnCount: phaseTurns.length,
      cost: phaseCost,
      inputTokens: phaseInput,
      outputTokens: phaseOutput,
      percentage: totalCost > 0 ? phaseCost / totalCost : 0,
    });
  }

  // 3. Wasted cost ratio
  const wastedCostRatio =
    totalCost > 0 && wastedCost != null ? Math.min(1, wastedCost / totalCost) : 0;

  return { totalCost, costByCategory, costByPhase, wastedCostRatio };
}

const p95 = (arr: number[]): number => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.max(0, Math.floor(s.length * 0.95))] || 0;
};
const median = (arr: number[]): number => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.max(0, Math.floor(s.length * 0.5))] || 0;
};

function latencyStats(durations: number[]): LatencyStats {
  if (durations.length === 0) return { avg: 0, median: 0, p95: 0, max: 0 };
  return {
    avg: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
    median: median(durations),
    p95: p95(durations),
    max: Math.max(...durations),
  };
}

export function analyzePerformance(spans: Span[]): PerformanceMetrics {
  const turns = spans
    .filter((s) => s.type === 'llm_turn')
    .sort((a, b) => a.startTime - b.startTime);
  const tools = spans.filter((s) => s.type === 'tool_call');

  // Turn latency
  const turnDurations = turns
    .map((t) => (t.endTime ? t.endTime - t.startTime : 0))
    .filter((d) => d > 0);
  const turnLatency = latencyStats(turnDurations);

  // Tool latency
  const toolDurations = tools
    .map((t) => (t.endTime ? t.endTime - t.startTime : 0))
    .filter((d) => d > 0);
  const toolLatency = latencyStats(toolDurations);

  // Tool latency by name
  const byName = new Map<string, number[]>();
  for (const t of tools) {
    const dur = t.endTime ? t.endTime - t.startTime : 0;
    if (dur <= 0) continue;
    const arr = byName.get(t.name) || [];
    arr.push(dur);
    byName.set(t.name, arr);
  }
  const toolLatencyByName = [...byName.entries()]
    .map(([name, durations]) => ({
      name,
      count: durations.length,
      avg: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
      median: median(durations),
      p95: p95(durations),
      max: Math.max(...durations),
    }))
    .sort((a, b) => b.avg - a.avg);

  // Slow turns (> 2x P95 or > 60s)
  const slowThreshold = Math.max(turnLatency.p95 * 1.5, 60_000);
  const slowTurns = turns
    .map((turn, i) => ({
      turnIndex: i + 1,
      turnId: turn.id,
      duration: turn.endTime ? turn.endTime - turn.startTime : 0,
      isSlow: (turn.endTime ? turn.endTime - turn.startTime : 0) > slowThreshold,
    }))
    .filter((t) => t.isSlow);

  // Throughput (tokens/min)
  const totalTokens = turns.reduce(
    (s, t) => s + t.inputTokens + t.cacheCreationTokens + t.cacheReadTokens + t.outputTokens,
    0,
  );
  const firstTurn = turns[0];
  const lastTurn = turns[turns.length - 1];
  const sessionDuration =
    firstTurn && lastTurn ? (lastTurn.endTime || lastTurn.startTime) - firstTurn.startTime : 0;
  const throughput = sessionDuration > 0 ? Math.round(totalTokens / (sessionDuration / 60000)) : 0;

  return { turnLatency, toolLatency, toolLatencyByName, slowTurns, throughput, sessionDuration };
}

// ===== 工具参数分析 =====

const BASH_CMD_MAP: [RegExp, string][] = [
  [/^(ls|ll|dir)\b/, 'list'],
  [/^find\b/, 'find'],
  [/^grep\b/, 'grep'],
  [/^cd\b/, 'cd'],
  [/^(git|gh)\b/, 'git'],
  [/^(npm|pnpm|yarn|npx)\b/, 'npm'],
  [/^(cat|head|tail)\b/, 'cat'],
  [/^(echo|printf)\b/, 'echo'],
  [/^(mkdir|touch|rm|mv|cp|chmod)\b/, 'fs'],
  [/^(python|python3|node|ts-node|tsx|go|rustc|cargo)\b/, 'run'],
  [/^(curl|wget)\b/, 'curl'],
  [/^(test|vitest|jest|mocha|pytest|cargo test|go test)\b/, 'test'],
  [/^(ps|kill|top|htop)\b/, 'process'],
  [/^(docker|kubectl)\b/, 'container'],
  [/^(sed|awk|jq|cut|sort|uniq|wc)\b/, 'text'],
];

function classifyBash(cmd: string): string {
  const trimmed = cmd.trim();
  for (const [re, cat] of BASH_CMD_MAP) {
    if (re.test(trimmed)) return cat;
  }
  return 'other';
}

export interface ToolParamAnalysis {
  bashCategories: { category: string; count: number }[];
  readParamStats: { withLimit: number; withoutLimit: number; avgLimit?: number };
  frequentPairs: { pair: string; count: number }[];
}

export function analyzeToolParams(spans: Span[]): ToolParamAnalysis {
  const tools = spans
    .filter((s) => s.type === 'tool_call')
    .sort((a, b) => a.startTime - b.startTime);

  // Bash command classification
  const bashCats = new Map<string, number>();
  for (const t of tools) {
    if (t.name !== 'Bash') continue;
    const input = t.metadata?.input;
    if (typeof input !== 'string') continue;
    try {
      const obj = JSON.parse(input) as Record<string, unknown>;
      const cmd =
        typeof obj.command === 'string'
          ? obj.command
          : typeof obj.description === 'string'
            ? obj.description
            : '';
      if (cmd) {
        const cat = classifyBash(cmd);
        bashCats.set(cat, (bashCats.get(cat) || 0) + 1);
      }
    } catch {
      /* skip */
    }
  }
  const bashCategories = [...bashCats.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  // Read parameter stats
  let withLimit = 0,
    withoutLimit = 0,
    totalLimit = 0,
    limitCount = 0;
  for (const t of tools) {
    if (t.name !== 'Read' && t.name !== 'read_file') continue;
    const input = t.metadata?.input;
    if (typeof input !== 'string') continue;
    try {
      const obj = JSON.parse(input) as { limit?: number; offset?: number };
      if (obj.limit != null && obj.limit > 0) {
        withLimit++;
        totalLimit += obj.limit;
        limitCount++;
      } else withoutLimit++;
    } catch {
      /* skip */
    }
  }
  const readParamStats = {
    withLimit,
    withoutLimit,
    avgLimit: limitCount > 0 ? Math.round(totalLimit / limitCount) : undefined,
  };

  // Frequent tool pairs (consecutive tools)
  const pairCount = new Map<string, number>();
  for (let i = 1; i < tools.length; i++) {
    const pair = `${tools[i - 1].name} → ${tools[i].name}`;
    pairCount.set(pair, (pairCount.get(pair) || 0) + 1);
  }
  const frequentPairs = [...pairCount.entries()]
    .map(([pair, count]) => ({ pair, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return { bashCategories, readParamStats, frequentPairs };
}
