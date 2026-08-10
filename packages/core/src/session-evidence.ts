import type { SessionSummary, Span, SpanType, TokenUsageSource } from './types';

export const SESSION_EVIDENCE_SCHEMA_VERSION = 'session-evidence/v1' as const;
export const SESSION_EVIDENCE_PAGE_SCHEMA_VERSION = 'session-evidence-page/v1' as const;
export const MAX_EVIDENCE_PREVIEW_CHARACTERS = 500;

export type EvidenceContentMode = 'none' | 'preview';
export type EvidenceLane = 'main' | 'sidechain';
export type EvidenceOutcome = 'observed_error' | 'no_error_observed' | 'not_applicable';
export type ParentLinkStatus =
  | 'root'
  | 'linked'
  | 'missing_parent'
  | 'cross_session'
  | 'source_user'
  | 'corrupted_ownership'
  | 'not_captured';
export type EvidenceFieldStatus = 'available' | 'not_captured';
export type CoverageStatus = 'complete' | 'partial' | 'not_captured' | 'not_applicable';
export type TokenCoverageStatus = 'captured' | 'not_captured' | 'not_applicable';

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
  coverage: {
    tokenUsage: {
      status: TokenCoverageStatus;
      source: TokenUsageSource | 'not_captured' | null;
      classified: boolean;
      stubTurn: boolean;
    };
    modelCaptured: boolean;
  };
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
    tokenUsage: EvidenceCoverage;
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
    spanIds?: string[];
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
    toEvidenceEvent(session.id, span, index + 1, spanIds, contentMode),
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
      tokenUsage: coverage(
        turnEvents.filter((event) => event.coverage.tokenUsage.status === 'captured').length,
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
  sessionId: string,
  span: Span,
  sequence: number,
  spanIds: Set<string>,
  contentMode: EvidenceContentMode,
): SessionEvidenceEvent {
  const parentId = span.parentId ?? null;
  const endTime = validEndTime(span) && typeof span.endTime === 'number' ? span.endTime : null;
  const fields = contentFields(span, contentMode);
  const tokenUsageSource = tokenUsageOrigin(span);
  const isLlmTurn = span.type === 'llm_turn';
  return {
    sequence,
    id: span.id,
    parentId,
    parentLink: resolveParentLink(sessionId, span, spanIds),
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
    model: isLlmTurn ? (span.model ?? null) : null,
    coverage: {
      tokenUsage: {
        status: !isLlmTurn
          ? 'not_applicable'
          : tokenUsageSource === null || tokenUsageSource === 'not_captured'
            ? 'not_captured'
            : 'captured',
        source: tokenUsageSource,
        classified:
          isLlmTurn && tokenUsageSource !== null && tokenUsageSource !== 'not_captured'
            ? tokenUsageSource === 'total_tokens_fallback'
              ? false
              : ((span.metadata?.tokenUsageClassified as boolean) ?? true)
            : false,
        stubTurn:
          isLlmTurn &&
          (tokenUsageSource === null || tokenUsageSource === 'not_captured') &&
          span.metadata?.stubTurn === true,
      },
      modelCaptured:
        isLlmTurn && span.model !== undefined && span.model !== null && span.model.trim() !== '',
    },
    metrics: {
      inputTokens: span.inputTokens,
      cacheCreationTokens: span.cacheCreationTokens,
      cacheReadTokens: span.cacheReadTokens,
      outputTokens: span.outputTokens,
      contextTokens: span.contextTokens,
      outputBytes: span.outputBytes,
      cost: !isLlmTurn || span.costUnknown ? null : span.cost,
      costCurrency: !isLlmTurn || span.costUnknown ? null : (span.costCurrency ?? null),
    },
    content: {
      status: fields.some((field) => field.status === 'available') ? 'available' : 'not_captured',
      fields,
    },
  };
}

function resolveParentLink(sessionId: string, span: Span, spanIds: Set<string>): ParentLinkStatus {
  const ownership = span.metadata?.ownershipStatus ?? span.metadata?.parentStatus;
  if (isParentLinkStatus(ownership) && ownership !== 'root' && ownership !== 'linked') {
    return ownership;
  }
  const sourceSessionId = [
    span.metadata?.sourceSessionId,
    span.metadata?.parentSessionId,
    span.metadata?.sourceParentSessionId,
  ].find((value): value is string => typeof value === 'string');
  if (typeof sourceSessionId === 'string' && sourceSessionId !== span.sessionId) {
    return 'cross_session';
  }
  if (span.metadata?.parentSource === 'user') return 'source_user';
  if (span.sessionId !== sessionId) return 'corrupted_ownership';
  const parentId = span.parentId ?? null;
  if (parentId === null) return 'root';
  return spanIds.has(parentId) ? 'linked' : 'missing_parent';
}

function isParentLinkStatus(value: unknown): value is ParentLinkStatus {
  return (
    value === 'root' ||
    value === 'linked' ||
    value === 'missing_parent' ||
    value === 'cross_session' ||
    value === 'source_user' ||
    value === 'corrupted_ownership' ||
    value === 'not_captured'
  );
}

function tokenUsageOrigin(span: Span): TokenUsageSource | 'not_captured' | null {
  if (span.type !== 'llm_turn') return null;
  const source = span.metadata?.tokenUsageSource;
  if (source === undefined || source === null) return 'not_captured';
  if (
    source === 'message_usage' ||
    source === 'token_count' ||
    source === 'total_tokens_fallback' ||
    source === 'session_aggregate' ||
    source === 'request_token_usage'
  ) {
    return source;
  }
  return 'not_captured';
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
