import type { SessionEvidenceEvent, Span } from '@agent-profile/core';

export type EvidenceMetricKind = 'llm' | 'tool' | 'block';

export function isCrossSessionEvidence(span: Pick<Span, 'metadata'>): boolean {
  const ownership = span.metadata?.ownershipStatus ?? span.metadata?.parentStatus;
  return (
    ownership === 'cross_session' ||
    ownership === 'source_user' ||
    ownership === 'corrupted_ownership' ||
    ownership === 'not_captured'
  );
}

export function evidenceMetricKind(event: Pick<SessionEvidenceEvent, 'type'>): EvidenceMetricKind {
  if (event.type === 'llm_turn') return 'llm';
  if (event.type === 'tool_call') return 'tool';
  return 'block';
}

export function shouldShowTokenMetrics(event: SessionEvidenceEvent): boolean {
  return evidenceMetricKind(event) === 'llm' && event.coverage.tokenUsage.status !== 'not_captured';
}
