import {
  type EvidenceContentField,
  type EvidenceContentMode,
  type EvidenceCoverage,
  type EvidenceLaneFilter,
  type EvidenceOutcomeFilter,
  type EvidenceTypeFilter,
  MAX_EVIDENCE_PREVIEW_CHARACTERS,
  type ParentLinkStatus,
  redactEvidencePreview,
  SESSION_EVIDENCE_PAGE_SCHEMA_VERSION,
  type SessionEvidenceEvent,
  type SessionEvidencePage,
  type SessionSummary,
  type SpanType,
} from '@agent-profile/core';
import type { DatabaseConnection } from './database';

export const DEFAULT_SESSION_EVIDENCE_LIMIT = 80;
export const MAX_SESSION_EVIDENCE_LIMIT = 200;

export interface SessionEvidencePageOptions {
  content?: string;
  type?: string;
  lane?: string;
  outcome?: string;
  limit?: number;
  cursor?: string;
  generatedAt?: number;
}

export type SessionEvidencePageErrorCode =
  | 'invalid_cursor'
  | 'cursor_query_mismatch'
  | 'invalid_limit'
  | 'invalid_content'
  | 'invalid_type'
  | 'invalid_lane'
  | 'invalid_outcome';

export class SessionEvidencePageError extends Error {
  constructor(readonly code: SessionEvidencePageErrorCode) {
    super(ERROR_MESSAGES[code]);
  }
}

interface NormalizedOptions {
  content: EvidenceContentMode;
  type: EvidenceTypeFilter;
  lane: EvidenceLaneFilter;
  outcome: EvidenceOutcomeFilter;
  limit: number;
}

interface EvidenceCursor {
  version: 1;
  queryKey: string;
  startTime: number;
  id: string;
}

interface EvidenceAggregateRow {
  totalEvents: number;
  matchedEvents: number;
  llmTurns: number;
  toolCalls: number;
  thinkingEvents: number;
  answerEvents: number;
  mainEvents: number;
  sidechainEvents: number;
  observedErrors: number;
  noErrorObserved: number;
  notApplicable: number;
  timingObserved: number;
  parentCandidates: number;
  parentObserved: number;
  toolInputsObserved: number;
  toolOutputsObserved: number;
  modelObserved: number;
  contentObserved: number;
}

interface EvidenceRow {
  sequence: number;
  id: string;
  parentId: string | null;
  parentLink: ParentLinkStatus;
  type: SpanType;
  name: string;
  startTime: number;
  endTime: number | null;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  contextTokens: number;
  outputBytes: number;
  model: string | null;
  cost: number;
  costUnknown: number;
  costCurrency: string | null;
  isError: number;
  isSidechain: number;
  inputAvailable: number;
  outputAvailable: number;
  thinkingAvailable: number;
  textAvailable: number;
  inputTruncated: number;
  outputTruncated: number;
  thinkingTruncated: number;
  textTruncated: number;
  inputContent: unknown;
  outputContent: unknown;
  thinkingContent: unknown;
  textContent: unknown;
}

interface SqlFilter {
  clause: string;
  parameters: Array<number | string>;
}

const ERROR_MESSAGES: Record<SessionEvidencePageErrorCode, string> = {
  invalid_cursor: 'invalid evidence cursor',
  cursor_query_mismatch: 'evidence cursor does not match query',
  invalid_limit: 'invalid evidence limit',
  invalid_content: 'invalid evidence content mode',
  invalid_type: 'invalid evidence type',
  invalid_lane: 'invalid evidence lane',
  invalid_outcome: 'invalid evidence outcome',
};

const CONTENT_FIELDS = ['input', 'output', 'thinking', 'text'] as const;

type ContentFieldName = (typeof CONTENT_FIELDS)[number];

export function loadSessionEvidencePage(
  database: DatabaseConnection,
  session: Pick<SessionSummary, 'id' | 'name' | 'agent' | 'startTime' | 'endTime'>,
  options: SessionEvidencePageOptions = {},
): SessionEvidencePage {
  const normalized = normalizeOptions(options);
  const queryKey = evidenceQueryKey(session.id, normalized);
  const cursor = options.cursor === undefined ? null : decodeCursor(options.cursor);
  if (cursor && cursor.queryKey !== queryKey) {
    throw new SessionEvidencePageError('cursor_query_mismatch');
  }

  const aggregate = loadAggregates(database, session.id, normalized);
  const rows = loadRows(database, session.id, normalized, cursor);
  const lastRow = rows.at(-1);
  const hasMore =
    rows.length === normalized.limit &&
    lastRow !== undefined &&
    hasRowsAfter(database, session.id, normalized, lastRow);
  const events = rows.map((row) => toEvidenceEvent(row, normalized.content));

  return {
    schemaVersion: SESSION_EVIDENCE_PAGE_SCHEMA_VERSION,
    generatedAt: options.generatedAt ?? Date.now(),
    session: {
      id: session.id,
      name: session.name ?? null,
      agent: session.agent,
      startTime: session.startTime,
      endTime: session.endTime ?? null,
    },
    query: {
      content: normalized.content,
      type: normalized.type,
      lane: normalized.lane,
      outcome: normalized.outcome,
    },
    counts: { matched: aggregate.matchedEvents, total: aggregate.totalEvents },
    page: {
      limit: normalized.limit,
      returned: events.length,
      hasMore,
      nextCursor:
        hasMore && lastRow
          ? encodeCursor({
              version: 1,
              queryKey,
              startTime: lastRow.startTime,
              id: lastRow.id,
            })
          : null,
      startSequence: events.at(0)?.sequence ?? null,
      endSequence: events.at(-1)?.sequence ?? null,
    },
    scope: {
      events: aggregate.totalEvents,
      byType: {
        llm_turn: aggregate.llmTurns,
        tool_call: aggregate.toolCalls,
        thinking: aggregate.thinkingEvents,
        answer: aggregate.answerEvents,
      },
      byLane: { main: aggregate.mainEvents, sidechain: aggregate.sidechainEvents },
      byOutcome: {
        observed_error: aggregate.observedErrors,
        no_error_observed: aggregate.noErrorObserved,
        not_applicable: aggregate.notApplicable,
      },
    },
    coverage: aggregateCoverage(aggregate),
    privacy: {
      contentMode: normalized.content,
      previewCharacters: normalized.content === 'preview' ? MAX_EVIDENCE_PREVIEW_CHARACTERS : 0,
      secretRedaction: true,
      rawContentIncluded: false,
    },
    events,
    limitations: [
      'This response is a cursor-addressed window over normalized stored Spans; follow nextCursor to reach every matched event.',
      'Scope and coverage describe the complete stored Session, while counts.matched describes the active filters.',
      'Current parsers do not create first-class user-message Spans across all sources.',
      'no_error_observed means no explicit error flag was captured; it does not prove the tool result was correct.',
      'Preview content can already be truncated by the source parser before this response applies its own bound.',
    ],
  };
}

function loadAggregates(
  database: DatabaseConnection,
  sessionId: string,
  options: NormalizedOptions,
): EvidenceAggregateRow {
  const filter = evidenceFilter(options, 's.');
  const available = contentAvailableExpression('s.');
  return database
    .prepare(
      `SELECT
        COUNT(*) AS totalEvents,
        COALESCE(SUM(CASE WHEN ${filter.clause} THEN 1 ELSE 0 END), 0) AS matchedEvents,
        COALESCE(SUM(CASE WHEN s.type = 'llm_turn' THEN 1 ELSE 0 END), 0) AS llmTurns,
        COALESCE(SUM(CASE WHEN s.type = 'tool_call' THEN 1 ELSE 0 END), 0) AS toolCalls,
        COALESCE(SUM(CASE WHEN s.type = 'thinking' THEN 1 ELSE 0 END), 0) AS thinkingEvents,
        COALESCE(SUM(CASE WHEN s.type = 'answer' THEN 1 ELSE 0 END), 0) AS answerEvents,
        COALESCE(SUM(CASE WHEN s.is_sidechain = 0 THEN 1 ELSE 0 END), 0) AS mainEvents,
        COALESCE(SUM(CASE WHEN s.is_sidechain = 1 THEN 1 ELSE 0 END), 0) AS sidechainEvents,
        COALESCE(SUM(CASE WHEN s.type = 'tool_call' AND s.is_error = 1 THEN 1 ELSE 0 END), 0) AS observedErrors,
        COALESCE(SUM(CASE WHEN s.type = 'tool_call' AND s.is_error = 0 THEN 1 ELSE 0 END), 0) AS noErrorObserved,
        COALESCE(SUM(CASE WHEN s.type <> 'tool_call' THEN 1 ELSE 0 END), 0) AS notApplicable,
        COALESCE(SUM(CASE WHEN s.end_time IS NOT NULL AND s.end_time >= s.start_time THEN 1 ELSE 0 END), 0) AS timingObserved,
        COALESCE(SUM(CASE WHEN s.parent_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS parentCandidates,
        COALESCE(SUM(CASE WHEN s.parent_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM spans parent WHERE parent.session_id = s.session_id AND parent.id = s.parent_id
        ) THEN 1 ELSE 0 END), 0) AS parentObserved,
        COALESCE(SUM(CASE WHEN s.type = 'tool_call' AND ${jsonAvailable('s.', 'input')} THEN 1 ELSE 0 END), 0) AS toolInputsObserved,
        COALESCE(SUM(CASE WHEN s.type = 'tool_call' AND ${jsonAvailable('s.', 'output')} THEN 1 ELSE 0 END), 0) AS toolOutputsObserved,
        COALESCE(SUM(CASE WHEN s.type = 'llm_turn' AND NULLIF(TRIM(s.model), '') IS NOT NULL THEN 1 ELSE 0 END), 0) AS modelObserved,
        COALESCE(SUM(CASE WHEN s.type <> 'llm_turn' AND ${available} THEN 1 ELSE 0 END), 0) AS contentObserved
       FROM spans s
       WHERE s.session_id = ?`,
    )
    .get(...filter.parameters, sessionId) as EvidenceAggregateRow;
}

function loadRows(
  database: DatabaseConnection,
  sessionId: string,
  options: NormalizedOptions,
  cursor: EvidenceCursor | null,
): EvidenceRow[] {
  const filter = evidenceFilter(options, '');
  const cursorClause = cursor ? 'AND (startTime > ? OR (startTime = ? AND id > ?))' : '';
  const cursorParameters = cursor ? [cursor.startTime, cursor.startTime, cursor.id] : [];
  return database
    .prepare(
      `WITH ordered AS (
        SELECT
          ROW_NUMBER() OVER (ORDER BY s.start_time ASC, s.id ASC) AS sequence,
          s.id,
          s.parent_id AS parentId,
          CASE
            WHEN s.parent_id IS NULL THEN 'root'
            WHEN EXISTS (
              SELECT 1 FROM spans parent
              WHERE parent.session_id = s.session_id AND parent.id = s.parent_id
            ) THEN 'linked'
            ELSE 'missing_parent'
          END AS parentLink,
          s.type,
          s.name,
          s.start_time AS startTime,
          s.end_time AS endTime,
          COALESCE(s.input_tokens, 0) AS inputTokens,
          COALESCE(s.cache_creation_tokens, 0) AS cacheCreationTokens,
          COALESCE(s.cache_read_tokens, 0) AS cacheReadTokens,
          COALESCE(s.output_tokens, 0) AS outputTokens,
          COALESCE(s.context_tokens, 0) AS contextTokens,
          COALESCE(s.output_bytes, 0) AS outputBytes,
          s.model,
          COALESCE(s.cost, 0) AS cost,
          COALESCE(s.cost_unknown, 0) AS costUnknown,
          s.cost_currency AS costCurrency,
          COALESCE(s.is_error, 0) AS isError,
          COALESCE(s.is_sidechain, 0) AS isSidechain,
          ${contentColumns(options.content)}
        FROM spans s
        WHERE s.session_id = ?
      )
      SELECT *
      FROM ordered
      WHERE ${filter.clause}
        ${cursorClause}
      ORDER BY startTime ASC, id ASC
      LIMIT ?`,
    )
    .all(sessionId, ...filter.parameters, ...cursorParameters, options.limit) as EvidenceRow[];
}

function hasRowsAfter(
  database: DatabaseConnection,
  sessionId: string,
  options: NormalizedOptions,
  row: Pick<EvidenceRow, 'startTime' | 'id'>,
): boolean {
  const filter = evidenceFilter(options, 's.');
  return Boolean(
    database
      .prepare(
        `SELECT 1
         FROM spans s
         WHERE s.session_id = ?
           AND ${filter.clause}
           AND (s.start_time > ? OR (s.start_time = ? AND s.id > ?))
         LIMIT 1`,
      )
      .get(sessionId, ...filter.parameters, row.startTime, row.startTime, row.id),
  );
}

function contentColumns(content: EvidenceContentMode): string {
  return CONTENT_FIELDS.flatMap((field) => [
    `CASE WHEN ${jsonAvailable('s.', field)} THEN 1 ELSE 0 END AS ${field}Available`,
    `CASE WHEN ${jsonTruncated('s.', field)} THEN 1 ELSE 0 END AS ${field}Truncated`,
    content === 'preview'
      ? `CASE WHEN json_valid(s.metadata) THEN json_extract(s.metadata, '$.${field}') ELSE NULL END AS ${field}Content`
      : `NULL AS ${field}Content`,
  ]).join(',\n          ');
}

function evidenceFilter(options: NormalizedOptions, prefix: string): SqlFilter {
  const clauses = ['1 = 1'];
  const parameters: Array<number | string> = [];
  const sidechainColumn = prefix ? `${prefix}is_sidechain` : 'isSidechain';
  const errorColumn = prefix ? `${prefix}is_error` : 'isError';
  if (options.type !== 'all') {
    clauses.push(`${prefix}type = ?`);
    parameters.push(options.type);
  }
  if (options.lane !== 'all') {
    clauses.push(`${sidechainColumn} = ?`);
    parameters.push(options.lane === 'sidechain' ? 1 : 0);
  }
  if (options.outcome === 'observed_error') {
    clauses.push(`${prefix}type = 'tool_call' AND ${errorColumn} = 1`);
  } else if (options.outcome === 'no_error_observed') {
    clauses.push(`${prefix}type = 'tool_call' AND ${errorColumn} = 0`);
  } else if (options.outcome === 'not_applicable') {
    clauses.push(`${prefix}type <> 'tool_call'`);
  }
  return { clause: clauses.map((clause) => `(${clause})`).join(' AND '), parameters };
}

function normalizeOptions(options: SessionEvidencePageOptions): NormalizedOptions {
  const content = options.content ?? 'none';
  const type = options.type ?? 'all';
  const lane = options.lane ?? 'all';
  const outcome = options.outcome ?? 'all';
  if (!isContentMode(content)) throw new SessionEvidencePageError('invalid_content');
  if (!isTypeFilter(type)) throw new SessionEvidencePageError('invalid_type');
  if (!isLaneFilter(lane)) throw new SessionEvidencePageError('invalid_lane');
  if (!isOutcomeFilter(outcome)) throw new SessionEvidencePageError('invalid_outcome');
  return { content, type, lane, outcome, limit: validatedLimit(options.limit) };
}

function toEvidenceEvent(row: EvidenceRow, content: EvidenceContentMode): SessionEvidenceEvent {
  const endTime = row.endTime !== null && row.endTime >= row.startTime ? row.endTime : null;
  const fields = contentFields(row, content);
  return {
    sequence: row.sequence,
    id: row.id,
    parentId: row.parentId,
    parentLink: row.parentLink,
    type: row.type,
    name: row.name,
    lane: row.isSidechain === 1 ? 'sidechain' : 'main',
    outcome:
      row.type !== 'tool_call'
        ? 'not_applicable'
        : row.isError === 1
          ? 'observed_error'
          : 'no_error_observed',
    startTime: row.startTime,
    endTime,
    durationMs: endTime === null ? null : endTime - row.startTime,
    model: row.model,
    metrics: {
      inputTokens: row.inputTokens,
      cacheCreationTokens: row.cacheCreationTokens,
      cacheReadTokens: row.cacheReadTokens,
      outputTokens: row.outputTokens,
      contextTokens: row.contextTokens,
      outputBytes: row.outputBytes,
      cost: row.costUnknown === 1 ? null : row.cost,
      costCurrency: row.costUnknown === 1 ? null : row.costCurrency,
    },
    content: {
      status: fields.some((field) => field.status === 'available') ? 'available' : 'not_captured',
      fields,
    },
  };
}

function contentFields(row: EvidenceRow, content: EvidenceContentMode): EvidenceContentField[] {
  return fieldNames(row.type).map((name) => {
    const available = contentAvailable(row, name);
    const value = available ? storedText(contentValue(row, name)) : null;
    return {
      name,
      status: available ? 'available' : 'not_captured',
      ...(content === 'preview' && value !== null ? { preview: redactEvidencePreview(value) } : {}),
      sourceTruncated: contentTruncated(row, name),
    };
  });
}

function contentAvailable(row: EvidenceRow, name: ContentFieldName): boolean {
  if (name === 'input') return row.inputAvailable === 1;
  if (name === 'output') return row.outputAvailable === 1;
  if (name === 'thinking') return row.thinkingAvailable === 1;
  return row.textAvailable === 1;
}

function contentTruncated(row: EvidenceRow, name: ContentFieldName): boolean {
  if (name === 'input') return row.inputTruncated === 1;
  if (name === 'output') return row.outputTruncated === 1;
  if (name === 'thinking') return row.thinkingTruncated === 1;
  return row.textTruncated === 1;
}

function contentValue(row: EvidenceRow, name: ContentFieldName): unknown {
  if (name === 'input') return row.inputContent;
  if (name === 'output') return row.outputContent;
  if (name === 'thinking') return row.thinkingContent;
  return row.textContent;
}

function aggregateCoverage(row: EvidenceAggregateRow): SessionEvidencePage['coverage'] {
  return {
    timing: coverage(row.timingObserved, row.totalEvents),
    parentLinks: coverage(row.parentObserved, row.parentCandidates),
    toolInputs: coverage(row.toolInputsObserved, row.toolCalls),
    toolOutputs: coverage(row.toolOutputsObserved, row.toolCalls),
    modelIdentity: coverage(row.modelObserved, row.llmTurns),
    content: coverage(row.contentObserved, row.totalEvents - row.llmTurns),
  };
}

function coverage(observed: number, total: number): EvidenceCoverage {
  if (total === 0) return { observed: 0, total: 0, coverage: null, status: 'not_applicable' };
  return {
    observed,
    total,
    coverage: observed / total,
    status: observed === 0 ? 'not_captured' : observed === total ? 'complete' : 'partial',
  };
}

function fieldNames(type: SpanType): EvidenceContentField['name'][] {
  if (type === 'tool_call') return ['input', 'output'];
  if (type === 'thinking') return ['thinking'];
  if (type === 'answer') return ['text'];
  return [];
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

function contentAvailableExpression(prefix: string): string {
  return `(CASE
    WHEN ${prefix}type = 'tool_call' THEN (${jsonAvailable(prefix, 'input')} OR ${jsonAvailable(prefix, 'output')})
    WHEN ${prefix}type = 'thinking' THEN ${jsonAvailable(prefix, 'thinking')}
    WHEN ${prefix}type = 'answer' THEN ${jsonAvailable(prefix, 'text')}
    ELSE 0
  END)`;
}

function jsonAvailable(prefix: string, field: ContentFieldName): string {
  return `(CASE WHEN json_valid(${prefix}metadata) THEN
    json_type(${prefix}metadata, '$.${field}') IS NOT NULL
    AND json_type(${prefix}metadata, '$.${field}') <> 'null'
    ELSE 0 END)`;
}

function jsonTruncated(prefix: string, field: ContentFieldName): string {
  const value = `LOWER(CAST(json_extract(${prefix}metadata, '$.${field}') AS TEXT))`;
  return `(CASE WHEN ${jsonAvailable(prefix, field)} THEN
    INSTR(${value}, '[truncated ') > 0 AND INSTR(${value}, ' chars]') > 0
    ELSE 0 END)`;
}

function evidenceQueryKey(sessionId: string, options: NormalizedOptions): string {
  return JSON.stringify({
    sessionId,
    content: options.content,
    type: options.type,
    lane: options.lane,
    outcome: options.outcome,
  });
}

function encodeCursor(cursor: EvidenceCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(value: string): EvidenceCursor {
  if (!value || value.length > 2_048) throw new SessionEvidencePageError('invalid_cursor');
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    const candidate = decoded as Partial<EvidenceCursor>;
    if (
      !decoded ||
      typeof decoded !== 'object' ||
      candidate.version !== 1 ||
      typeof candidate.queryKey !== 'string' ||
      typeof candidate.startTime !== 'number' ||
      !Number.isSafeInteger(candidate.startTime) ||
      typeof candidate.id !== 'string' ||
      !candidate.id
    ) {
      throw new SessionEvidencePageError('invalid_cursor');
    }
    return candidate as EvidenceCursor;
  } catch (error) {
    if (error instanceof SessionEvidencePageError) throw error;
    throw new SessionEvidencePageError('invalid_cursor');
  }
}

function validatedLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_SESSION_EVIDENCE_LIMIT;
  if (!Number.isInteger(value) || value < 1 || value > MAX_SESSION_EVIDENCE_LIMIT) {
    throw new SessionEvidencePageError('invalid_limit');
  }
  return value;
}

function isContentMode(value: string): value is EvidenceContentMode {
  return value === 'none' || value === 'preview';
}

function isTypeFilter(value: string): value is EvidenceTypeFilter {
  return ['all', 'llm_turn', 'tool_call', 'thinking', 'answer'].includes(value);
}

function isLaneFilter(value: string): value is EvidenceLaneFilter {
  return value === 'all' || value === 'main' || value === 'sidechain';
}

function isOutcomeFilter(value: string): value is EvidenceOutcomeFilter {
  return ['all', 'observed_error', 'no_error_observed', 'not_applicable'].includes(value);
}
