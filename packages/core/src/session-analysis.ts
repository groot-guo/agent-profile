import type { Span } from './types';
import { isCrossSessionSpan } from './types';

export const SESSION_ANALYSIS_SCHEMA_VERSION = 'session-analysis/v1' as const;
export const MAX_ANALYSIS_CONTEXT_POINTS = 240;
export const MAX_ANALYSIS_TOOL_EVENTS = 50;
export const MAX_ANALYSIS_SIDECHAIN_TURNS = 20;

export interface SessionAnalysisContextPoint {
  startTime: number;
  contextTokens: number;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  model: string | null;
  contextWindow: number | null;
}

export interface SessionAnalysisToolEvent {
  id: string;
  name: string;
  startTime: number;
  endTime: number | null;
  outputBytes: number;
  isError: boolean;
}

export interface SessionAnalysisTurnEvent {
  id: string;
  name: string;
  startTime: number;
  inputTokens: number;
  outputTokens: number;
}

export interface SessionAnalysisSpanSummary {
  events: number;
  llmTurns: number;
  mainToolCalls: number;
  sidechainToolCalls: number;
  observedToolErrors: number;
  toolNames: Array<{ name: string; count: number }>;
  toolErrors: Array<{ name: string; total: number; errors: number }>;
  sidechain: {
    turns: number;
    tools: number;
    tokens: number;
    cost: number;
    costUnknownCount: number;
    taskNames: string[];
  };
}

export interface SessionAnalysisWindows {
  summary: SessionAnalysisSpanSummary;
  context: {
    total: number;
    isSampled: boolean;
    points: SessionAnalysisContextPoint[];
  };
  toolWindow: {
    total: number;
    isWindowed: boolean;
    events: SessionAnalysisToolEvent[];
  };
  sidechainTurnWindow: {
    total: number;
    isWindowed: boolean;
    events: SessionAnalysisTurnEvent[];
  };
}

export function buildSessionAnalysisWindows(
  spans: Span[],
  contextWindowLookup: (model?: string) => number | undefined,
): SessionAnalysisWindows {
  const ordered = spans
    .filter((span) => !isCrossSessionSpan(span))
    .sort((left, right) =>
      left.startTime === right.startTime
        ? left.id.localeCompare(right.id)
        : left.startTime - right.startTime,
    );
  const turns = ordered.filter((span) => span.type === 'llm_turn');
  const tools = ordered.filter((span) => span.type === 'tool_call');
  const mainTools = tools.filter((span) => !span.isSidechain);
  const sidechainTurns = turns.filter((span) => span.isSidechain);
  const sidechainTools = tools.filter((span) => span.isSidechain);
  const contextTurns = turns.filter(hasCapturedContextEvidence);
  const contextPoints = contextTurns.map((turn) => toContextPoint(turn, contextWindowLookup));
  const sampledContext = sampleContextPoints(contextPoints, MAX_ANALYSIS_CONTEXT_POINTS);
  const recentTools = mainTools.slice(-MAX_ANALYSIS_TOOL_EVENTS).map(toToolEvent);
  const sidechainTurnEvents = sidechainTurns
    .slice(0, MAX_ANALYSIS_SIDECHAIN_TURNS)
    .map(toTurnEvent);

  return {
    summary: buildSpanSummary(ordered.length, turns, mainTools, sidechainTurns, sidechainTools),
    context: {
      total: contextPoints.length,
      isSampled: contextPoints.length > sampledContext.length,
      points: sampledContext,
    },
    toolWindow: {
      total: mainTools.length,
      isWindowed: mainTools.length > recentTools.length,
      events: recentTools,
    },
    sidechainTurnWindow: {
      total: sidechainTurns.length,
      isWindowed: sidechainTurns.length > sidechainTurnEvents.length,
      events: sidechainTurnEvents,
    },
  };
}

export function hasCapturedContextEvidence(span: Span): boolean {
  if (span.type !== 'llm_turn') return false;
  const source = span.metadata?.tokenUsageSource;
  if (source === 'not_captured') return false;
  return (
    source !== undefined ||
    span.contextTokens > 0 ||
    span.inputTokens + span.cacheCreationTokens + span.cacheReadTokens + span.outputTokens > 0
  );
}

function buildSpanSummary(
  events: number,
  turns: Span[],
  mainTools: Span[],
  sidechainTurns: Span[],
  sidechainTools: Span[],
): SessionAnalysisSpanSummary {
  const toolStats = new Map<string, { total: number; errors: number }>();
  for (const tool of mainTools) {
    const current = toolStats.get(tool.name) ?? { total: 0, errors: 0 };
    toolStats.set(tool.name, {
      total: current.total + 1,
      errors: current.errors + (tool.isError ? 1 : 0),
    });
  }
  const sortedStats = [...toolStats.entries()].sort(
    ([leftName, left], [rightName, right]) =>
      right.total - left.total || leftName.localeCompare(rightName),
  );
  const sidechainTokens = sidechainTurns.reduce(
    (total, turn) =>
      total +
      turn.inputTokens +
      turn.cacheCreationTokens +
      turn.cacheReadTokens +
      turn.outputTokens,
    0,
  );
  return {
    events,
    llmTurns: turns.length,
    mainToolCalls: mainTools.length,
    sidechainToolCalls: sidechainTools.length,
    observedToolErrors: mainTools.filter((tool) => tool.isError).length,
    toolNames: sortedStats.map(([name, stat]) => ({ name, count: stat.total })),
    toolErrors: sortedStats
      .filter(([, stat]) => stat.errors > 0)
      .sort(([leftName, left], [rightName, right]) =>
        right.errors === left.errors
          ? leftName.localeCompare(rightName)
          : right.errors - left.errors,
      )
      .map(([name, stat]) => ({ name, total: stat.total, errors: stat.errors })),
    sidechain: {
      turns: sidechainTurns.length,
      tools: sidechainTools.length,
      tokens: sidechainTokens,
      cost: sidechainTurns.reduce((total, turn) => total + turn.cost, 0),
      costUnknownCount: sidechainTurns.filter((turn) => turn.costUnknown).length,
      taskNames: [...new Set(sidechainTurns.map((turn) => turn.name).filter(Boolean))].slice(0, 20),
    },
  };
}

function sampleContextPoints(
  points: SessionAnalysisContextPoint[],
  limit: number,
): SessionAnalysisContextPoint[] {
  if (points.length <= limit) return points;
  const selected = new Set<number>([0, points.length - 1, peakContextIndex(points)]);
  for (let slot = 0; selected.size < limit && slot < limit * 2; slot++) {
    selected.add(Math.round((slot * (points.length - 1)) / (limit - 1)));
  }
  for (let index = 0; selected.size < limit && index < points.length; index++) selected.add(index);
  return [...selected]
    .sort((left, right) => left - right)
    .slice(0, limit)
    .map((index) => points[index]);
}

function peakContextIndex(points: SessionAnalysisContextPoint[]): number {
  let peakIndex = 0;
  for (let index = 1; index < points.length; index++) {
    if (points[index].contextTokens > points[peakIndex].contextTokens) peakIndex = index;
  }
  return peakIndex;
}

function toContextPoint(
  turn: Span,
  contextWindowLookup: (model?: string) => number | undefined,
): SessionAnalysisContextPoint {
  return {
    startTime: turn.startTime,
    contextTokens: turn.contextTokens,
    inputTokens: turn.inputTokens,
    cacheCreationTokens: turn.cacheCreationTokens,
    cacheReadTokens: turn.cacheReadTokens,
    outputTokens: turn.outputTokens,
    model: turn.model ?? null,
    contextWindow: contextWindowLookup(turn.model) ?? null,
  };
}

function toToolEvent(tool: Span): SessionAnalysisToolEvent {
  return {
    id: tool.id,
    name: tool.name,
    startTime: tool.startTime,
    endTime:
      typeof tool.endTime === 'number' && tool.endTime >= tool.startTime ? tool.endTime : null,
    outputBytes: tool.outputBytes,
    isError: tool.isError,
  };
}

function toTurnEvent(turn: Span): SessionAnalysisTurnEvent {
  return {
    id: turn.id,
    name: turn.name,
    startTime: turn.startTime,
    inputTokens: turn.inputTokens,
    outputTokens: turn.outputTokens,
  };
}
