import { calcCost } from './pricing';
import type {
  CostAttribution,
  CostByCategory,
  CostByPhase,
  EfficiencyMetrics,
  FileOperation,
  ParsedSession,
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
  pricingLookup: (model?: string) => Pricing | undefined,
  fileMeta?: FileMeta,
  importedAt?: number,
): { summary: SessionSummary; spans: Span[] } {
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
      span.contextTokens = (span.inputTokens || 0) + (span.cacheCreationTokens || 0) + (span.cacheReadTokens || 0);
      const pricing = pricingLookup(span.model);
      const { cost, unknown } = calcCost(span, pricing);
      span.cost = cost;
      span.costUnknown = unknown;
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
    peakContextTokens: peakContext,
    avgContextTokens: llmTurnCount > 0 ? Math.round(sumContext / llmTurnCount) : 0,
    cacheHitRate,
    fileMtime: fileMeta?.mtime,
    fileSize: fileMeta?.size,
    fileLines: fileMeta?.lines,
    messageCount: parsed.meta.messageCount,
    importedAt: importedAt ?? Date.now(),
  };

  return { summary, spans: parsed.spans };
}

const TOOL_CATEGORY: Record<string, string> = {
  Read: 'file', Write: 'file', Edit: 'file', Grep: 'file', Glob: 'file',
  Bash: 'command',
  WebFetch: 'network', WebSearch: 'network',
  AskUserQuestion: 'interactive',
  Workflow: 'orchestration', Task: 'orchestration', TaskCreate: 'orchestration',
  ToolSearch: 'meta', TodoWrite: 'meta',
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
  } catch { /* truncated JSON */ }
  return undefined;
}

const FILE_TOOLS = new Set(['Read', 'Write', 'Edit']);

export function analyzeEfficiency(spans: Span[]): EfficiencyMetrics {
  const tools = spans.filter((s) => s.type === 'tool_call').sort((a, b) => a.startTime - b.startTime);
  const turns = spans.filter((s) => s.type === 'llm_turn').sort((a, b) => a.startTime - b.startTime);
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
  const thinkingMap = new Map<string, string>();
  for (const th of thinkings) {
    if (th.metadata?.thinking && typeof th.metadata.thinking === 'string') {
      thinkingMap.set(th.id, th.metadata.thinking);
    }
  }
  const thinkingActionRatios: ThinkingActionRatio[] = turns.map((turn, i) => {
    // Find thinking spans that are children of this turn
    const childThinkings = thinkings.filter((th) => th.parentId === turn.id);
    const thinkingChars = childThinkings.reduce(
      (sum, th) => sum + (typeof th.metadata?.thinking === 'string' ? (th.metadata.thinking as string).length : 0),
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
    const ctx = turn.contextTokens || (turn.inputTokens + turn.cacheCreationTokens + turn.cacheReadTokens);
    const prevCtx = i > 0
      ? (turns[i - 1].contextTokens || (turns[i - 1].inputTokens + turns[i - 1].cacheCreationTokens + turns[i - 1].cacheReadTokens))
      : 0;
    return { turnIndex: i + 1, turnId: turn.id, contextTokens: ctx, delta: ctx - prevCtx };
  });
  const contextGrowthVelocity = turns.length > 1
    ? Math.round(
        contextGrowthPerTurn.slice(1).reduce((s, t) => s + Math.max(0, t.delta), 0) / (turns.length - 1),
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
  const fileOperations = [...fileOps.values()].sort((a, b) => (b.reads + b.edits + b.writes) - (a.reads + a.edits + a.writes));
  const filesRead = fileOperations.filter((f) => f.reads > 0).length;
  const filesEdited = fileOperations.filter((f) => f.edits > 0 || f.writes > 0).length;
  const readToEditRate = filesRead > 0 ? filesEdited / filesRead : 0;

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
  file: '文件操作', command: '命令执行', network: '网络',
  interactive: '用户交互', mcp: 'MCP', orchestration: '编排', meta: '元工具', other: '其他',
};

const PHASE_NAMES = ['探索期', '实现期', '验证期'];

export interface EfficiencyScore {
  score: number; // 0-100
  tokenEfficiency: number; // output / total, normalized
  cacheUtilization: number; // cache_hit_rate
  toolSuccess: number; // overall tool success rate
  wasteAvoidance: number; // 1 - wastedCost/totalCost
  percentile?: number; // rank among all sessions (set by caller)
}

export function calcEfficiencyScore(
  efficiency: EfficiencyMetrics,
  cacheHitRate: number,
  totalTokens: number,
  outputTokens: number,
  totalCost: number,
  wastedCost?: number,
): EfficiencyScore {
  const tokenEfficiency = totalTokens > 0 ? Math.min(1, outputTokens / totalTokens * 3) : 0;
  const cacheUtilization = cacheHitRate;
  const toolSuccess = efficiency.toolSuccessRates.length > 0
    ? efficiency.toolSuccessRates.reduce((s, t) => s + t.successRate, 0) / efficiency.toolSuccessRates.length
    : 1;
  const wasteAvoidance = totalCost > 0 && wastedCost != null
    ? 1 - Math.min(1, wastedCost / totalCost)
    : 1;

  const score = Math.round(
    (tokenEfficiency * 0.2 + cacheUtilization * 0.3 + toolSuccess * 0.2 + wasteAvoidance * 0.3) * 100,
  );
  return {
    score: Math.max(0, Math.min(100, score)),
    tokenEfficiency,
    cacheUtilization,
    toolSuccess,
    wasteAvoidance,
  };
}

export function analyzeCostAttribution(
  spans: Span[],
  wastedCost?: number,
): CostAttribution {
  const turns = spans.filter((s) => s.type === 'llm_turn').sort((a, b) => a.startTime - b.startTime);
  const tools = spans.filter((s) => s.type === 'tool_call');

  const totalCost = turns.reduce((s, t) => s + (t.cost || 0), 0);

  // 1. Cost by tool category
  const catCost = new Map<string, { cost: number; turnCount: number; toolCount: number }>();
  for (const tool of tools) {
    const cat = catOf(tool.name);
    const parentTurn = turns.find((t) => t.id === tool.parentId);
    const turnCost = parentTurn?.cost || 0;
    const entry = catCost.get(cat) || { cost: 0, turnCount: 0, toolCount: 0 };
    entry.cost += turnCost;
    entry.toolCount++;
    if (parentTurn && !catCost.has(cat)) entry.turnCount++;
    catCost.set(cat, entry);
  }
  // Count unique parent turns per category
  for (const tool of tools) {
    const cat = catOf(tool.name);
    const entry = catCost.get(cat);
    if (entry && tool.parentId) {
      const parentTurn = turns.find((t) => t.id === tool.parentId);
      if (parentTurn) {
        // dedup turn counting
      }
    }
  }
  // Rebuild with deduped turn counts
  const catTurns = new Map<string, Set<string>>();
  for (const tool of tools) {
    if (!tool.parentId) continue;
    const cat = catOf(tool.name);
    const set = catTurns.get(cat) || new Set();
    set.add(tool.parentId);
    catTurns.set(cat, set);
  }
  for (const [cat, turnSet] of catTurns) {
    const entry = catCost.get(cat);
    if (entry) entry.turnCount = turnSet.size;
  }

  const costByCategory: CostByCategory[] = [...catCost.entries()]
    .map(([category, e]) => ({
      category: CAT_LABEL[category] || category,
      cost: e.cost,
      turnCount: e.turnCount,
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
    const phaseInput = phaseTurns.reduce((s, t) => s + t.inputTokens + t.cacheCreationTokens + t.cacheReadTokens, 0);
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
  const wastedCostRatio = totalCost > 0 && wastedCost != null ? Math.min(1, wastedCost / totalCost) : 0;

  return { totalCost, costByCategory, costByPhase, wastedCostRatio };
}
