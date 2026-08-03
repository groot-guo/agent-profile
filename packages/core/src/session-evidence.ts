import type { SessionSummary, Span, SpanType } from './types';

export const SESSION_EVIDENCE_SCHEMA_VERSION = 'session-evidence/v1' as const;
export const SESSION_EVIDENCE_PAGE_SCHEMA_VERSION = 'session-evidence-page/v1' as const;
export const MAX_EVIDENCE_PREVIEW_CHARACTERS = 500;

export type EvidenceContentMode = 'none' | 'preview';
export type EvidenceLane = 'main' | 'sidechain';
export type EvidenceOutcome = 'observed_error' | 'no_error_observed' | 'not_applicable';
export type ParentLinkStatus = 'root' | 'linked' | 'missing_parent';
export type EvidenceFieldStatus = 'available' | 'not_captured';
export type CoverageStatus = 'complete' | 'partial' | 'not_captured' | 'not_applicable';

export interface EvidenceCoverage {
  observed: number;
  total: number;
  coverage: number | null;
  status: CoverageStatus;
}

export interface EvidenceContentField {
  name: 'input' | 'output' | 'thinking' | 'text';
  status: EvidenceFieldStatus;
  preview?: string;
  sourceTruncated: boolean;
}

export interface SessionEvidenceEvent {
  sequence: number;
  id: string;
  parentId: string | null;
  parentLink: ParentLinkStatus;
  type: SpanType;
  name: string;
  lane: EvidenceLane;
  outcome: EvidenceOutcome;
  startTime: number;
  endTime: number | null;
  durationMs: number | null;
  model: string | null;
  metrics: {
    inputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
    contextTokens: number;
    outputBytes: number;
    cost: number | null;
    costCurrency: string | null;
  };
  content: {
    status: EvidenceFieldStatus;
    fields: EvidenceContentField[];
  };
}

export interface SessionEvidenceReport {
  schemaVersion: typeof SESSION_EVIDENCE_SCHEMA_VERSION;
  generatedAt: number;
  session: {
    id: string;
    name: string | null;
    agent: string;
    startTime: number;
    endTime: number | null;
  };
  scope: {
    events: number;
    byType: Record<SpanType, number>;
    byLane: Record<EvidenceLane, number>;
    byOutcome: Record<EvidenceOutcome, number>;
  };
  coverage: {
    timing: EvidenceCoverage;
    parentLinks: EvidenceCoverage;
    toolInputs: EvidenceCoverage;
    toolOutputs: EvidenceCoverage;
    modelIdentity: EvidenceCoverage;
    content: EvidenceCoverage;
  };
  privacy: {
    contentMode: EvidenceContentMode;
    previewCharacters: number;
    secretRedaction: true;
    rawContentIncluded: false;
  };
  events: SessionEvidenceEvent[];
  limitations: string[];
}

export type EvidenceTypeFilter = 'all' | SpanType;
export type EvidenceLaneFilter = 'all' | EvidenceLane;
export type EvidenceOutcomeFilter = 'all' | EvidenceOutcome;

export interface SessionEvidencePage {
  schemaVersion: typeof SESSION_EVIDENCE_PAGE_SCHEMA_VERSION;
  generatedAt: number;
  session: {
    id: string;
    name: string | null;
    agent: string;
    startTime: number;
    endTime: number | null;
  };
  query: {
    content: EvidenceContentMode;
    type: EvidenceTypeFilter;
    lane: EvidenceLaneFilter;
    outcome: EvidenceOutcomeFilter;
  };
  counts: {
    matched: number;
    total: number;
  };
  page: {
    limit: number;
    returned: number;
    hasMore: boolean;
    nextCursor: string | null;
    startSequence: number | null;
    endSequence: number | null;
  };
  scope: SessionEvidenceReport['scope'];
  coverage: SessionEvidenceReport['coverage'];
  privacy: SessionEvidenceReport['privacy'];
  events: SessionEvidenceEvent[];
  limitations: string[];
}

export function buildSessionEvidenceReport(
  session: Pick<SessionSummary, 'id' | 'name' | 'agent' | 'startTime' | 'endTime'>,
  spans: Span[],
  options: { contentMode?: EvidenceContentMode; generatedAt?: number } = {},
): SessionEvidenceReport {
  const contentMode = options.contentMode ?? 'none';
  const ordered = spans
    .map((span, sourceIndex) => ({ span, sourceIndex }))
    .sort(
      (left, right) =>
        left.span.startTime - right.span.startTime || left.sourceIndex - right.sourceIndex,
    );
  const spanIds = new Set(spans.map((span) => span.id));
  const events = ordered.map(({ span }, index) =>
    toEvidenceEvent(span, index + 1, spanIds, contentMode),
  );
  const toolEvents = events.filter((event) => event.type === 'tool_call');
  const turnEvents = events.filter((event) => event.type === 'llm_turn');
  const contentEvents = events.filter((event) => event.type !== 'llm_turn');
  const linkedCandidates = events.filter((event) => event.parentId !== null);

  return {
    schemaVersion: SESSION_EVIDENCE_SCHEMA_VERSION,
    generatedAt: options.generatedAt ?? Date.now(),
    session: {
      id: session.id,
      name: session.name ?? null,
      agent: session.agent,
      startTime: session.startTime,
      endTime: session.endTime ?? null,
    },
    scope: {
      events: events.length,
      byType: countBy(
        events,
        ['llm_turn', 'tool_call', 'thinking', 'answer'],
        (event) => event.type,
      ),
      byLane: countBy(events, ['main', 'sidechain'], (event) => event.lane),
      byOutcome: countBy(
        events,
        ['observed_error', 'no_error_observed', 'not_applicable'],
        (event) => event.outcome,
      ),
    },
    coverage: {
      timing: coverage(events.filter((event) => event.endTime !== null).length, events.length),
      parentLinks: coverage(
        linkedCandidates.filter((event) => event.parentLink === 'linked').length,
        linkedCandidates.length,
      ),
      toolInputs: coverage(
        toolEvents.filter((event) => contentFieldAvailable(event, 'input')).length,
        toolEvents.length,
      ),
      toolOutputs: coverage(
        toolEvents.filter((event) => contentFieldAvailable(event, 'output')).length,
        toolEvents.length,
      ),
      modelIdentity: coverage(
        turnEvents.filter((event) => event.model !== null).length,
        turnEvents.length,
      ),
      content: coverage(
        contentEvents.filter((event) => event.content.status === 'available').length,
        contentEvents.length,
      ),
    },
    privacy: {
      contentMode,
      previewCharacters: contentMode === 'preview' ? MAX_EVIDENCE_PREVIEW_CHARACTERS : 0,
      secretRedaction: true,
      rawContentIncluded: false,
    },
    events,
    limitations: [
      'The timeline contains every normalized stored Span, not every source transcript message or runtime event.',
      'Current parsers do not create first-class user-message Spans across all sources.',
      'no_error_observed means no explicit error flag was captured; it does not prove the tool result was correct.',
      'Preview content can already be truncated by the source parser before this report applies its own bound.',
    ],
  };
}

function toEvidenceEvent(
  span: Span,
  sequence: number,
  spanIds: Set<string>,
  contentMode: EvidenceContentMode,
): SessionEvidenceEvent {
  const parentId = span.parentId ?? null;
  const endTime = validEndTime(span) && typeof span.endTime === 'number' ? span.endTime : null;
  const fields = contentFields(span, contentMode);
  return {
    sequence,
    id: span.id,
    parentId,
    parentLink: parentId === null ? 'root' : spanIds.has(parentId) ? 'linked' : 'missing_parent',
    type: span.type,
    name: span.name,
    lane: span.isSidechain ? 'sidechain' : 'main',
    outcome:
      span.type !== 'tool_call'
        ? 'not_applicable'
        : span.isError
          ? 'observed_error'
          : 'no_error_observed',
    startTime: span.startTime,
    endTime,
    durationMs: endTime === null ? null : endTime - span.startTime,
    model: span.model ?? null,
    metrics: {
      inputTokens: span.inputTokens,
      cacheCreationTokens: span.cacheCreationTokens,
      cacheReadTokens: span.cacheReadTokens,
      outputTokens: span.outputTokens,
      contextTokens: span.contextTokens,
      outputBytes: span.outputBytes,
      cost: span.costUnknown ? null : span.cost,
      costCurrency: span.costUnknown ? null : (span.costCurrency ?? null),
    },
    content: {
      status: fields.some((field) => field.status === 'available') ? 'available' : 'not_captured',
      fields,
    },
  };
}

function contentFields(span: Span, mode: EvidenceContentMode): EvidenceContentField[] {
  const names: EvidenceContentField['name'][] =
    span.type === 'tool_call'
      ? ['input', 'output']
      : span.type === 'thinking'
        ? ['thinking']
        : span.type === 'answer'
          ? ['text']
          : [];
  return names.map((name) => {
    const value = storedText(span.metadata?.[name]);
    const available = value !== null;
    return {
      name,
      status: available ? 'available' : 'not_captured',
      ...(available && mode === 'preview' ? { preview: redactEvidencePreview(value) } : {}),
      sourceTruncated: available && /\[truncated \d+ chars\]/i.test(value),
    };
  });
}

function storedText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export interface RedactedText {
  text: string;
  redactions: number;
}

export function redactSensitiveText(value: string, maxCharacters: number): RedactedText {
  let redactions = 0;
  let redacted = value
    .replace(
      /\b(api[_-]?key|access[_-]?token|token|password|passwd|secret)\s*[:=：]\s*["']?[^,\s"']+/gi,
      (_match, key: string) => {
        redactions += 1;
        return `${key}=[REDACTED]`;
      },
    )
    .replace(
      /([?&](?:api[_-]?key|access[_-]?token|token|password|secret)=)[^&#\s]+/gi,
      (_match, key: string) => {
        redactions += 1;
        return `${key}[REDACTED]`;
      },
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*\b/gi, () => {
      redactions += 1;
      return 'Bearer [REDACTED]';
    })
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, () => {
      redactions += 1;
      return '[REDACTED_PRIVATE_KEY]';
    })
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/g, () => {
      redactions += 1;
      return '[REDACTED_TOKEN]';
    })
    .replace(/\bgh[pousr]_[A-Za-z0-9]{12,}\b/g, () => {
      redactions += 1;
      return '[REDACTED_TOKEN]';
    })
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, () => {
      redactions += 1;
      return '[REDACTED_TOKEN]';
    })
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{12,}\b/g, () => {
      redactions += 1;
      return '[REDACTED_TOKEN]';
    });
  const limit = Math.max(0, Math.floor(maxCharacters));
  if (redacted.length > limit) redacted = `${redacted.slice(0, limit)}…`;
  return { text: redacted, redactions };
}

export function redactEvidencePreview(value: string): string {
  return redactSensitiveText(value, MAX_EVIDENCE_PREVIEW_CHARACTERS).text;
}

function validEndTime(span: Span): boolean {
  return (
    typeof span.endTime === 'number' &&
    Number.isFinite(span.endTime) &&
    span.endTime >= span.startTime
  );
}

function coverage(observed: number, total: number): EvidenceCoverage {
  if (total === 0) return { observed: 0, total: 0, coverage: null, status: 'not_applicable' };
  const ratio = observed / total;
  return {
    observed,
    total,
    coverage: ratio,
    status: observed === 0 ? 'not_captured' : observed === total ? 'complete' : 'partial',
  };
}

function contentFieldAvailable(
  event: SessionEvidenceEvent,
  name: EvidenceContentField['name'],
): boolean {
  return event.content.fields.some((field) => field.name === name && field.status === 'available');
}

function countBy<Item, Key extends string>(
  items: Item[],
  keys: readonly Key[],
  select: (item: Item) => Key,
): Record<Key, number> {
  const result = Object.fromEntries(keys.map((key) => [key, 0])) as Record<Key, number>;
  for (const item of items) result[select(item)]++;
  return result;
}
