import type { SessionEvidenceEvent } from '@agent-profile/core';
import { describe, expect, it } from 'vitest';
import {
  evidenceMetricKind,
  isCrossSessionEvidence,
  shouldShowTokenMetrics,
} from './evidence-display';

describe('evidence block metric display', () => {
  it('does not expose inherited LLM metrics on thinking or answer blocks', () => {
    const event = makeEvent('thinking', 'captured');
    expect(evidenceMetricKind(event)).toBe('block');
    expect(shouldShowTokenMetrics(event)).toBe(false);
    expect(shouldShowTokenMetrics(makeEvent('answer', 'captured'))).toBe(false);
  });

  it('shows token metrics only for an LLM turn with captured usage', () => {
    expect(shouldShowTokenMetrics(makeEvent('llm_turn', 'captured'))).toBe(true);
    expect(shouldShowTokenMetrics(makeEvent('llm_turn', 'not_captured'))).toBe(false);
    expect(evidenceMetricKind(makeEvent('tool_call', 'not_applicable'))).toBe('tool');
  });

  it('recognizes ownership metadata without importing server-only core modules', () => {
    expect(isCrossSessionEvidence({ metadata: { ownershipStatus: 'cross_session' } })).toBe(true);
    expect(isCrossSessionEvidence({ metadata: { ownershipStatus: 'captured' } })).toBe(false);
  });
});

function makeEvent(
  type: SessionEvidenceEvent['type'],
  tokenStatus: SessionEvidenceEvent['coverage']['tokenUsage']['status'],
): SessionEvidenceEvent {
  return {
    sequence: 1,
    id: 'event-1',
    parentId: null,
    parentLink: 'root',
    type,
    name: type,
    lane: 'main',
    outcome: 'not_applicable',
    startTime: 1,
    endTime: 2,
    durationMs: 1,
    model: 'inherited-model',
    coverage: {
      tokenUsage: {
        status: tokenStatus,
        source:
          tokenStatus === 'captured'
            ? 'token_count'
            : tokenStatus === 'not_captured'
              ? 'not_captured'
              : null,
        classified: tokenStatus === 'captured',
        stubTurn: false,
      },
      modelCaptured: true,
    },
    metrics: {
      inputTokens: 99,
      cacheCreationTokens: 10,
      cacheReadTokens: 8,
      outputTokens: 7,
      contextTokens: 117,
      outputBytes: 42,
      cost: 1,
      costCurrency: 'CNY',
    },
    content: { status: 'not_captured', fields: [] },
  };
}
