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
  spanIds?: string[];
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
  if (filters.spanIds && filters.spanIds.length > 0) {
    parameters.set('spanIds', filters.spanIds.join(','));
  }
  return `${api}/session/${encodeURIComponent(sessionId)}/evidence-page?${parameters.toString()}`;
}

export function parseEvidenceSpanIds(value: string | null): string[] {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(',')
        .map((spanId) => spanId.trim())
        .filter(Boolean),
    ),
  ]
    .filter((spanId) => spanId.length <= 200 && !/[,\s]/.test(spanId))
    .slice(0, 20);
}

export function mergeEvidenceEvents(
  current: SessionEvidenceEvent[],
  next: SessionEvidenceEvent[],
): SessionEvidenceEvent[] {
  const seen = new Set(current.map((event) => event.id));
  return [...current, ...next.filter((event) => !seen.has(event.id))];
}
