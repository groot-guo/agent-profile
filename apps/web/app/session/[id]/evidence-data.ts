import type {
  EvidenceContentMode,
  EvidenceLaneFilter,
  EvidenceOutcomeFilter,
  EvidenceTypeFilter,
  SessionEvidenceEvent,
} from '@agent-profile/core';

export interface EvidencePageFilters {
  content: EvidenceContentMode;
  type: EvidenceTypeFilter;
  lane: EvidenceLaneFilter;
  outcome: EvidenceOutcomeFilter;
}

export function evidencePageUrl(
  api: string,
  sessionId: string,
  filters: EvidencePageFilters,
  cursor?: string,
): string {
  const parameters = new URLSearchParams({
    content: filters.content,
    type: filters.type,
    lane: filters.lane,
    outcome: filters.outcome,
  });
  if (cursor) parameters.set('cursor', cursor);
  return `${api}/session/${encodeURIComponent(sessionId)}/evidence-page?${parameters.toString()}`;
}

export function mergeEvidenceEvents(
  current: SessionEvidenceEvent[],
  next: SessionEvidenceEvent[],
): SessionEvidenceEvent[] {
  const seen = new Set(current.map((event) => event.id));
  return [...current, ...next.filter((event) => !seen.has(event.id))];
}
