import { calcCost } from './pricing';
import type { ParsedSession, Pricing, SessionSummary, Span } from './types';

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
      span.contextTokens = span.inputTokens + span.cacheCreationTokens + span.cacheReadTokens;
      const pricing = pricingLookup(span.model);
      const { cost, unknown } = calcCost(span, pricing);
      span.cost = cost;
      span.costUnknown = unknown;
      if (unknown) costUnknownCount++;
      inputTokens += span.inputTokens;
      cacheCreationTokens += span.cacheCreationTokens;
      cacheReadTokens += span.cacheReadTokens;
      outputTokens += span.outputTokens;
      totalCost += cost;
      peakContext = Math.max(peakContext, span.contextTokens);
      sumContext += span.contextTokens;
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
