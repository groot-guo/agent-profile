import { describe, expect, it } from 'vitest';
import {
  cacheAbsenceLabel,
  contextAbsenceLabel,
  costAbsenceDisplay,
  costAbsenceLabel,
} from './session-absence';

describe('session absence states', () => {
  it('renders known cost only when the Session cost status is complete', () => {
    expect(costAbsenceDisplay({ costStatus: 'complete', totalCost: 1.2345, costUnknownCount: 0 }))
      .toEqual({
        label: '¥1.2345',
        warn: false,
        tip: '四类 token 均已定价且成本可信',
      });
    expect(costAbsenceLabel({ costStatus: 'complete', totalCost: 2 })).toEqual({
      kind: 'known',
      value: '¥2.0000',
    });
  });

  it('never presents unknown or excluded cost as a trusted zero', () => {
    expect(costAbsenceDisplay({ costStatus: 'unknown', totalCost: 0, costUnknownCount: 1 }))
      .toMatchObject({ label: '未定价', warn: true });
    expect(costAbsenceDisplay({ costStatus: 'excluded', totalCost: 0, costUnknownCount: 0 }))
      .toMatchObject({ label: '已排除', warn: true });
    expect(costAbsenceDisplay({ costStatus: 'not_captured', totalCost: 0, costUnknownCount: 0 }))
      .toMatchObject({ label: '不可用', warn: true });
    expect(costAbsenceLabel({ costStatus: 'unknown', totalCost: 0 })).toEqual({
      kind: 'unknown_pricing',
      label: '未定价',
    });
  });

  it('marks partial cost as a known subtotal with incomplete-coverage status', () => {
    expect(costAbsenceDisplay({ costStatus: 'partial', totalCost: 0.5, costUnknownCount: 1 }))
      .toMatchObject({ label: '¥0.5000（部分）', warn: true });
  });

  it('marks context and cache metrics unavailable when there is no LLM turn or token base', () => {
    expect(contextAbsenceLabel({ messageCount: 0, peakContextTokens: 0 }, 0)).toMatchObject({
      value: '不可用',
      unavailable: true,
    });
    expect(contextAbsenceLabel({ messageCount: 3, peakContextTokens: 5000 }, 3)).toEqual({
      value: '5,000 tokens',
      unavailable: false,
      tip: '会话中上下文窗口的最大占用',
    });
    expect(cacheAbsenceLabel({ cacheHitRate: 0 }, 0)).toMatchObject({
      value: '不可用',
      unavailable: true,
    });
    expect(cacheAbsenceLabel({ cacheHitRate: 0.5 }, 1000)).toEqual({
      value: '50.0%',
      unavailable: false,
      tip: 'cache_read ÷ (input + cache_creation + cache_read)',
    });
  });
});
