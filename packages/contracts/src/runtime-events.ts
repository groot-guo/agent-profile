export const RUNTIME_EVENT_SCHEMA_VERSION = 'runtime-event/v1' as const;
export const RUNTIME_EVENT_BATCH_SCHEMA_VERSION = 'runtime-event-batch/v1' as const;
export const RUNTIME_EVENT_PAGE_SCHEMA_VERSION = 'runtime-event-page/v1' as const;

export type RuntimeEventKind =
  | 'task_started'
  | 'task_finished'
  | 'run_started'
  | 'run_finished'
  | 'turn_started'
  | 'turn_finished'
  | 'tool_call'
  | 'tool_result'
  | 'subagent_started'
  | 'subagent_finished'
  | 'verification_started'
  | 'verification_finished';

export type RuntimeEventStatus =
  | 'not_captured'
  | 'observed'
  | 'passed'
  | 'failed'
  | 'skipped'
  | 'not_run';

export interface RuntimeEventPayload {
  agent?: string;
  model?: string;
  toolName?: string;
  toolCallId?: string;
  subagentId?: string;
  verificationKind?: string;
  configurationSnapshotId?: string;
  status?: RuntimeEventStatus;
  durationMs?: number;
  isError?: boolean;
}

export interface RuntimeEvent {
  schemaVersion: typeof RUNTIME_EVENT_SCHEMA_VERSION;
  eventId: string;
  taskId: string;
  runId: string;
  sequence: number;
  capturedAt: number;
  kind: RuntimeEventKind;
  parentEventId?: string;
  payload?: RuntimeEventPayload;
}

export interface RuntimeEventBatch {
  schemaVersion: typeof RUNTIME_EVENT_BATCH_SCHEMA_VERSION;
  events: RuntimeEvent[];
}

export type RuntimeEventRejectionReason = 'event_id_conflict' | 'sequence_conflict';

export interface RuntimeEventRejection {
  eventId: string;
  reason: RuntimeEventRejectionReason;
}

export interface RuntimeEventCoverage {
  observed: number;
  total: number;
  status: 'complete' | 'partial' | 'not_captured';
}

export interface RuntimeEventAppendReport {
  schemaVersion: typeof RUNTIME_EVENT_BATCH_SCHEMA_VERSION;
  taskId: string;
  runId: string;
  accepted: number;
  duplicates: number;
  rejected: RuntimeEventRejection[];
  coverage: RuntimeEventCoverage;
  ordering: {
    strategy: 'sequence_ascending';
    outOfOrderAccepted: number;
  };
  limitations: string[];
}

export interface RuntimeEventReference {
  eventId: string;
  sequence: number;
  capturedAt: number;
  kind: RuntimeEventKind;
  parentEventId: string | null;
  payloadFields: string[];
}

export interface RuntimeEventPage {
  schemaVersion: typeof RUNTIME_EVENT_PAGE_SCHEMA_VERSION;
  taskId: string | null;
  runId: string;
  limit: number;
  total: number;
  hasMore: boolean;
  events: RuntimeEventReference[];
  coverage: RuntimeEventCoverage;
  limitations: string[];
}
