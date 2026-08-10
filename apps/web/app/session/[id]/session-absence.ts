import type { SessionSummary } from '@agent-profile/core';

export type CostAbsenceLabel =
  | { kind: 'known'; value: string }
  | { kind: 'unknown_pricing'; label: string }
  | { kind: 'token_not_captured'; label: string }
  | { kind: 'excluded'; label: string }
  | { kind: 'not_applicable'; label: string };

export type CostAbsenceDisplay = {
  label: string;
  warn: boolean;
  tip: string;
};

export function costAbsenceDisplay(
  session: Pick<SessionSummary, 'costStatus' | 'totalCost' | 'costUnknownCount'>,
): CostAbsenceDisplay {
  const status = session.costStatus;
  if (status === 'complete') {
    return {
      label: `¥${session.totalCost.toFixed(4)}`,
      warn: false,
      tip: '四类 token 均已定价且成本可信',
    };
  }
  if (status === 'partial') {
    return {
      label: `¥${session.totalCost.toFixed(4)}（部分）`,
      warn: true,
      tip: '部分 turn 缺失定价或 token 遥测；已知小计不作完整账单',
    };
  }
  if (status === 'excluded') {
    return {
      label: '已排除',
      warn: true,
      tip: '仅含合成占位等永不视为免费账单的数据',
    };
  }
  if (status === 'not_captured') {
    return {
      label: '不可用',
      warn: true,
      tip: '源未捕获任何 token 用量或 LLM 回合证据',
    };
  }
  return {
    label: '未定价',
    warn: true,
    tip:
      session.costUnknownCount > 0
        ? '包含未知模型或供应商路由待核验的 turn，成本无法计算'
        : '成本未知，不视为免费账单',
  };
}

export function contextAbsenceLabel(
  session: Pick<SessionSummary, 'messageCount' | 'peakContextTokens'>,
  llmTurnCount: number,
): { value: string; unavailable: boolean; tip: string } {
  if (llmTurnCount === 0) {
    return {
      value: '不可用',
      unavailable: true,
      tip: '该会话没有可观察的 LLM 回合，上下文用量未被捕获',
    };
  }
  return {
    value: `${session.peakContextTokens.toLocaleString()} tokens`,
    unavailable: false,
    tip: '会话中上下文窗口的最大占用',
  };
}

export function cacheAbsenceLabel(
  session: Pick<SessionSummary, 'cacheHitRate'>,
  totalInputTokens: number,
): { value: string; unavailable: boolean; tip: string } {
  if (totalInputTokens === 0) {
    return {
      value: '不可用',
      unavailable: true,
      tip: '没有可计算的输入 token 基数，cache 命中率未被捕获',
    };
  }
  return {
    value: `${(session.cacheHitRate * 100).toFixed(1)}%`,
    unavailable: false,
    tip: 'cache_read ÷ (input + cache_creation + cache_read)',
  };
}

export function costAbsenceLabel(
  session: Pick<SessionSummary, 'costStatus' | 'totalCost'>,
): CostAbsenceLabel {
  const status = session.costStatus;
  if (status === 'complete') return { kind: 'known', value: `¥${session.totalCost.toFixed(4)}` };
  if (status === 'partial') return { kind: 'known', value: `¥${session.totalCost.toFixed(4)}（部分）` };
  if (status === 'excluded') return { kind: 'excluded', label: '已排除' };
  if (status === 'not_captured') return { kind: 'token_not_captured', label: '不可用' };
  return { kind: 'unknown_pricing', label: '未定价' };
}
