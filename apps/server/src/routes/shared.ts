import type { Span } from '@agent-profile/core';

export const SESSION_COLS = `id, name, file_path as filePath, agent, file_mtime as fileMtime, file_size as fileSize,
  file_lines as fileLines, start_time as startTime, end_time as endTime, cwd, git_branch as gitBranch,
  claude_version as claudeVersion, input_tokens as inputTokens, cache_creation_tokens as cacheCreationTokens,
  cache_read_tokens as cacheReadTokens, output_tokens as outputTokens, total_cost as totalCost,
  cost_unknown_count as costUnknownCount, cost_currency as costCurrency,
  cost_calculated_at as costCalculatedAt, cost_calculator_version as costCalculatorVersion,
  peak_context_tokens as peakContextTokens,
  avg_context_tokens as avgContextTokens, cache_hit_rate as cacheHitRate,
  message_count as messageCount, imported_at as importedAt, tags, notes`;

export const SPAN_COLS = `id, session_id as sessionId, parent_id as parentId, type, name,
  start_time as startTime, end_time as endTime, input_tokens as inputTokens,
  cache_creation_tokens as cacheCreationTokens, cache_read_tokens as cacheReadTokens,
  output_tokens as outputTokens, context_tokens as contextTokens, output_bytes as outputBytes,
  model, cost, cost_unknown as costUnknown, cost_currency as costCurrency,
  pricing_effective_from as pricingEffectiveFrom, cost_calculated_at as costCalculatedAt,
  cost_calculator_version as costCalculatorVersion, stop_reason as stopReason,
  is_error as isError, is_sidechain as isSidechain, metadata`;

export function parseSpanRow(s: Record<string, unknown>): Span {
  s.costUnknown = !!s.costUnknown;
  s.isError = !!s.isError;
  s.isSidechain = !!s.isSidechain;
  if (s.metadata && typeof s.metadata === 'string') {
    try {
      s.metadata = JSON.parse(s.metadata as string);
    } catch {
      /* keep */
    }
  }
  return s as unknown as Span;
}
