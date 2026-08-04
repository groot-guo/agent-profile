import {
  RUNTIME_EVENT_BATCH_SCHEMA_VERSION,
  RUNTIME_EVENT_PAGE_SCHEMA_VERSION,
  type RuntimeEvent,
  type RuntimeEventAppendReport,
  type RuntimeEventBatch,
  type RuntimeEventKind,
  type RuntimeEventPage,
  type RuntimeEventPayload,
  type RuntimeEventReference,
  type RuntimeEventStatus,
} from '@agent-profile/contracts';
import type { DatabaseConnection } from './database';

export const MAX_RUNTIME_EVENT_BATCH = 100;
export const MAX_RUNTIME_EVENT_PAGE = 100;

export interface RuntimeEventSignal {
  eventId: string;
  sequence: number;
  capturedAt: number;
  kind: RuntimeEventKind;
  status?: RuntimeEventStatus;
  isError?: boolean;
  configurationSnapshotId?: string;
}

export interface RuntimeEventSignalPage {
  taskId: string | null;
  runId: string;
  total: number;
  rejectedEvents: number;
  coverageKnown: boolean;
  events: RuntimeEventSignal[];
}

const EVENT_KINDS: RuntimeEventKind[] = [
  'task_started',
  'task_finished',
  'run_started',
  'run_finished',
  'turn_started',
  'turn_finished',
  'tool_call',
  'tool_result',
  'subagent_started',
  'subagent_finished',
  'verification_started',
  'verification_finished',
];
const EVENT_STATUSES: RuntimeEventStatus[] = [
  'not_captured',
  'observed',
  'passed',
  'failed',
  'skipped',
  'not_run',
];
const PAYLOAD_KEYS = new Set([
  'agent',
  'model',
  'toolName',
  'toolCallId',
  'subagentId',
  'verificationKind',
  'configurationSnapshotId',
  'status',
  'durationMs',
  'isError',
]);

export type RuntimeEventCollectorErrorCode =
  | 'invalid_batch'
  | 'invalid_event'
  | 'invalid_limit'
  | 'storage_failed';

export class RuntimeEventCollectorError extends Error {
  constructor(
    readonly code: RuntimeEventCollectorErrorCode,
    readonly statusCode = code === 'storage_failed' ? 500 : 400,
  ) {
    super(code);
  }
}

export function appendRuntimeEventBatch(
  database: DatabaseConnection,
  input: RuntimeEventBatch,
  receivedAt = Date.now(),
): RuntimeEventAppendReport {
  const events = normalizeBatch(input);
  const taskId = events[0].taskId;
  const runId = events[0].runId;
  const existingTask = database
    .prepare(
      'SELECT task_id as taskId FROM runtime_events WHERE run_id = ? ORDER BY sequence ASC LIMIT 1',
    )
    .get(runId) as { taskId: string } | undefined;
  const existingCoverage = database
    .prepare('SELECT coverage_known as coverageKnown FROM runtime_event_coverage WHERE run_id = ?')
    .get(runId) as { coverageKnown: number } | undefined;
  const coverageKnown =
    input.coverageComplete === true &&
    (existingTask ? existingCoverage?.coverageKnown === 1 : true);
  if (existingTask && existingTask.taskId !== taskId) {
    throw new RuntimeEventCollectorError('invalid_batch');
  }
  const rejected: RuntimeEventAppendReport['rejected'] = [];
  const fresh: RuntimeEvent[] = [];
  let duplicates = 0;
  const batchIds = new Map<string, string>();
  const batchSequences = new Set<number>();

  for (const event of events) {
    const eventJson = eventFingerprint(event);
    const previousJson = batchIds.get(event.eventId);
    if (previousJson !== undefined) {
      if (previousJson === eventJson) duplicates++;
      else rejected.push({ eventId: event.eventId, reason: 'event_id_conflict' });
      continue;
    }
    batchIds.set(event.eventId, eventJson);
    if (batchSequences.has(event.sequence)) {
      rejected.push({ eventId: event.eventId, reason: 'sequence_conflict' });
      continue;
    }
    batchSequences.add(event.sequence);

    const existing = database
      .prepare(
        `SELECT task_id as taskId, sequence, captured_at as capturedAt, kind,
                parent_event_id as parentEventId, payload_json as payloadJson
           FROM runtime_events WHERE run_id = ? AND event_id = ?`,
      )
      .get(runId, event.eventId) as StoredRuntimeEvent | undefined;
    if (existing) {
      if (sameStoredEvent(existing, event)) duplicates++;
      else rejected.push({ eventId: event.eventId, reason: 'event_id_conflict' });
      continue;
    }
    const sequenceOwner = database
      .prepare('SELECT event_id as eventId FROM runtime_events WHERE run_id = ? AND sequence = ?')
      .get(runId, event.sequence) as { eventId: string } | undefined;
    if (sequenceOwner) {
      rejected.push({ eventId: event.eventId, reason: 'sequence_conflict' });
      continue;
    }
    fresh.push(event);
  }

  const maxSequenceRow = database
    .prepare('SELECT MAX(sequence) as maxSequence FROM runtime_events WHERE run_id = ?')
    .get(runId) as { maxSequence: number | null };
  let maxSequence = maxSequenceRow.maxSequence ?? -1;
  let outOfOrderAccepted = 0;
  const observed = fresh.length + duplicates;
  const effectiveCoverageKnown =
    coverageKnown ||
    (fresh.length === 0 && rejected.length === 0 && existingCoverage?.coverageKnown === 1);
  try {
    database.transaction(() => {
      const insert = database.prepare(
        `INSERT INTO runtime_events (
           event_id, task_id, run_id, sequence, captured_at, kind,
           parent_event_id, payload_json, received_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const event of fresh) {
        if (event.sequence < maxSequence) outOfOrderAccepted++;
        maxSequence = Math.max(maxSequence, event.sequence);
        insert.run(
          event.eventId,
          event.taskId,
          event.runId,
          event.sequence,
          event.capturedAt,
          event.kind,
          event.parentEventId ?? null,
          JSON.stringify(event.payload ?? {}),
          receivedAt,
        );
      }
      database
        .prepare(
          `INSERT INTO runtime_event_coverage (
             run_id, task_id, submitted_events, observed_events, rejected_events,
             coverage_known, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(run_id) DO UPDATE SET
             task_id = excluded.task_id,
             submitted_events = runtime_event_coverage.submitted_events + excluded.submitted_events,
             observed_events = runtime_event_coverage.observed_events + excluded.observed_events,
             rejected_events = runtime_event_coverage.rejected_events + excluded.rejected_events,
             coverage_known = MIN(runtime_event_coverage.coverage_known, excluded.coverage_known),
             updated_at = excluded.updated_at`,
        )
        .run(
          runId,
          taskId,
          events.length,
          observed,
          rejected.length,
          effectiveCoverageKnown ? 1 : 0,
          receivedAt,
        );
    })();
  } catch {
    throw new RuntimeEventCollectorError('storage_failed');
  }

  return {
    schemaVersion: RUNTIME_EVENT_BATCH_SCHEMA_VERSION,
    taskId,
    runId,
    accepted: fresh.length,
    duplicates,
    rejected,
    coverage: {
      observed,
      total: events.length,
      status:
        effectiveCoverageKnown && rejected.length === 0
          ? 'complete'
          : observed > 0
            ? 'partial'
            : 'not_captured',
    },
    ordering: { strategy: 'sequence_ascending', outOfOrderAccepted },
    limitations: [
      'The collector stores only bounded lifecycle metadata; prompt, answer, thinking, tool input, and tool output content are rejected by the contract.',
      'Events are local and may arrive partially or out of order; references are returned in sequence order.',
      ...(rejected.length > 0 ? ['One or more events were rejected and were not stored.'] : []),
    ],
  };
}

export function getRuntimeEventPage(
  database: DatabaseConnection,
  runId: string,
  requestedLimit?: number,
): RuntimeEventPage {
  const normalizedRunId = boundedText(runId, 128);
  if (!normalizedRunId) throw new RuntimeEventCollectorError('invalid_event');
  const limit = normalizeLimit(requestedLimit);
  const totalRow = database
    .prepare('SELECT COUNT(*) as count FROM runtime_events WHERE run_id = ?')
    .get(normalizedRunId) as { count: number };
  const rows = database
    .prepare(
      `SELECT event_id as eventId, sequence, captured_at as capturedAt, kind,
              parent_event_id as parentEventId, payload_json as payloadJson
         FROM runtime_events WHERE run_id = ? ORDER BY sequence ASC, event_id ASC LIMIT ?`,
    )
    .all(normalizedRunId, limit + 1) as StoredRuntimeEvent[];
  const hasMore = rows.length > limit;
  const events = rows.slice(0, limit).map(toReference);
  const total = totalRow.count;
  return {
    schemaVersion: RUNTIME_EVENT_PAGE_SCHEMA_VERSION,
    taskId: findTaskId(database, normalizedRunId),
    runId: normalizedRunId,
    limit,
    total,
    hasMore,
    events,
    coverage: {
      observed: events.length,
      total,
      status: total === 0 ? 'not_captured' : hasMore ? 'partial' : 'complete',
    },
    limitations: [
      'The page contains lifecycle references and payload field names only; payload values and raw process content are omitted.',
      ...(hasMore
        ? [
            'Use the limit and future cursor support to inspect larger runs; this page is intentionally bounded.',
          ]
        : []),
    ],
  };
}

export function getRuntimeEventSignals(
  database: DatabaseConnection,
  runId: string,
): RuntimeEventSignalPage {
  const normalizedRunId = boundedText(runId, 128);
  if (!normalizedRunId) throw new RuntimeEventCollectorError('invalid_event');
  const totalRow = database
    .prepare('SELECT COUNT(*) as count FROM runtime_events WHERE run_id = ?')
    .get(normalizedRunId) as { count: number };
  const coverage = database
    .prepare(
      `SELECT rejected_events as rejectedEvents, coverage_known as coverageKnown
         FROM runtime_event_coverage WHERE run_id = ?`,
    )
    .get(normalizedRunId) as { rejectedEvents: number; coverageKnown: number } | undefined;
  const rows = database
    .prepare(
      `SELECT event_id as eventId, sequence, captured_at as capturedAt, kind,
              payload_json as payloadJson
         FROM runtime_events WHERE run_id = ? ORDER BY sequence DESC, event_id DESC LIMIT ?`,
    )
    .all(normalizedRunId, MAX_RUNTIME_EVENT_PAGE) as StoredRuntimeEvent[];
  return {
    taskId: findTaskId(database, normalizedRunId),
    runId: normalizedRunId,
    total: totalRow.count + (coverage?.rejectedEvents ?? 0),
    rejectedEvents: coverage?.rejectedEvents ?? 0,
    coverageKnown: coverage?.coverageKnown === 1,
    events: rows.reverse().map(toSignal),
  };
}

function normalizeBatch(input: RuntimeEventBatch): RuntimeEvent[] {
  if (
    !input ||
    typeof input !== 'object' ||
    input.schemaVersion !== RUNTIME_EVENT_BATCH_SCHEMA_VERSION ||
    !Array.isArray(input.events) ||
    input.events.length === 0 ||
    input.events.length > MAX_RUNTIME_EVENT_BATCH
  ) {
    throw new RuntimeEventCollectorError('invalid_batch');
  }
  const events = input.events.map(normalizeEvent);
  const first = events[0];
  if (events.some((event) => event.taskId !== first.taskId || event.runId !== first.runId)) {
    throw new RuntimeEventCollectorError('invalid_batch');
  }
  return events;
}

function normalizeEvent(value: unknown): RuntimeEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RuntimeEventCollectorError('invalid_event');
  }
  const event = value as Record<string, unknown>;
  if (event.schemaVersion !== 'runtime-event/v1')
    throw new RuntimeEventCollectorError('invalid_event');
  const eventId = boundedText(event.eventId, 128);
  const taskId = boundedText(event.taskId, 128);
  const runId = boundedText(event.runId, 128);
  const kind = event.kind;
  if (!eventId || !taskId || !runId || !EVENT_KINDS.includes(kind as RuntimeEventKind)) {
    throw new RuntimeEventCollectorError('invalid_event');
  }
  if (!safeNonNegativeInteger(event.sequence) || !safeNonNegativeInteger(event.capturedAt)) {
    throw new RuntimeEventCollectorError('invalid_event');
  }
  const parentEventId = optionalBoundedText(event.parentEventId, 128);
  if (event.parentEventId !== undefined && !parentEventId) {
    throw new RuntimeEventCollectorError('invalid_event');
  }
  const payload = normalizePayload(event.payload);
  return {
    schemaVersion: 'runtime-event/v1',
    eventId,
    taskId,
    runId,
    sequence: event.sequence as number,
    capturedAt: event.capturedAt as number,
    kind: kind as RuntimeEventKind,
    ...(parentEventId ? { parentEventId } : {}),
    ...(payload ? { payload } : {}),
  };
}

function normalizePayload(value: unknown): RuntimeEventPayload | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RuntimeEventCollectorError('invalid_event');
  }
  const payload = value as Record<string, unknown>;
  if (Object.keys(payload).some((key) => !PAYLOAD_KEYS.has(key))) {
    throw new RuntimeEventCollectorError('invalid_event');
  }
  const normalized: RuntimeEventPayload = {};
  for (const key of [
    'agent',
    'model',
    'toolName',
    'toolCallId',
    'subagentId',
    'verificationKind',
    'configurationSnapshotId',
  ]) {
    const text = optionalBoundedText(payload[key], 200);
    if (payload[key] !== undefined && !text) throw new RuntimeEventCollectorError('invalid_event');
    if (text) Object.assign(normalized, { [key]: text });
  }
  if (payload.status !== undefined) {
    if (!EVENT_STATUSES.includes(payload.status as RuntimeEventStatus)) {
      throw new RuntimeEventCollectorError('invalid_event');
    }
    normalized.status = payload.status as RuntimeEventStatus;
  }
  if (payload.durationMs !== undefined) {
    if (
      typeof payload.durationMs !== 'number' ||
      !Number.isFinite(payload.durationMs) ||
      payload.durationMs < 0
    ) {
      throw new RuntimeEventCollectorError('invalid_event');
    }
    normalized.durationMs = payload.durationMs;
  }
  if (payload.isError !== undefined) {
    if (typeof payload.isError !== 'boolean') throw new RuntimeEventCollectorError('invalid_event');
    normalized.isError = payload.isError;
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

interface StoredRuntimeEvent {
  eventId: string;
  taskId?: string;
  sequence: number;
  capturedAt: number;
  kind: RuntimeEventKind;
  parentEventId: string | null;
  payloadJson: string;
}

function sameStoredEvent(stored: StoredRuntimeEvent, event: RuntimeEvent): boolean {
  return (
    stored.taskId === event.taskId &&
    stored.sequence === event.sequence &&
    stored.capturedAt === event.capturedAt &&
    stored.kind === event.kind &&
    stored.parentEventId === (event.parentEventId ?? null) &&
    stored.payloadJson === JSON.stringify(event.payload ?? {})
  );
}

function eventFingerprint(event: RuntimeEvent): string {
  return JSON.stringify({
    taskId: event.taskId,
    runId: event.runId,
    sequence: event.sequence,
    capturedAt: event.capturedAt,
    kind: event.kind,
    parentEventId: event.parentEventId ?? null,
    payload: event.payload ?? {},
  });
}

function toReference(row: StoredRuntimeEvent): RuntimeEventReference {
  let payloadFields: string[] = [];
  try {
    const payload = JSON.parse(row.payloadJson) as Record<string, unknown>;
    payloadFields = Object.keys(payload).sort();
  } catch {
    payloadFields = [];
  }
  return {
    eventId: row.eventId,
    sequence: row.sequence,
    capturedAt: row.capturedAt,
    kind: row.kind,
    parentEventId: row.parentEventId,
    payloadFields,
  };
}

function toSignal(row: StoredRuntimeEvent): RuntimeEventSignal {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(row.payloadJson) as Record<string, unknown>;
  } catch {
    payload = {};
  }
  return {
    eventId: row.eventId,
    sequence: row.sequence,
    capturedAt: row.capturedAt,
    kind: row.kind,
    ...(typeof payload.status === 'string' ? { status: payload.status as RuntimeEventStatus } : {}),
    ...(typeof payload.isError === 'boolean' ? { isError: payload.isError } : {}),
    ...(typeof payload.configurationSnapshotId === 'string'
      ? { configurationSnapshotId: payload.configurationSnapshotId }
      : {}),
  };
}

function findTaskId(database: DatabaseConnection, runId: string): string | null {
  const row = database
    .prepare(
      'SELECT task_id as taskId FROM runtime_events WHERE run_id = ? ORDER BY sequence ASC LIMIT 1',
    )
    .get(runId) as { taskId: string } | undefined;
  return row?.taskId ?? null;
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return MAX_RUNTIME_EVENT_PAGE;
  if (!safeNonNegativeInteger(value) || value === 0 || value > MAX_RUNTIME_EVENT_PAGE) {
    throw new RuntimeEventCollectorError('invalid_limit');
  }
  return value;
}

function safeNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length > 0 && text.length <= max ? text : null;
}

function optionalBoundedText(value: unknown, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  return boundedText(value, max) ?? undefined;
}
