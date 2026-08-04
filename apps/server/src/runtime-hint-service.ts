import {
  buildRuntimeHint,
  RUNTIME_HINT_MIN_INTERVAL_MS,
  type RuntimeHintAdoptionRecord,
  type RuntimeHintAdoptionStatus,
  type RuntimeHintEvidence,
  type RuntimeHintReport,
} from '@agent-profile/core';
import type { DatabaseConnection } from './database';
import { getRuntimeEventSignals, type RuntimeEventSignal } from './runtime-event-collector';
import { TaskRepository } from './task-repository';

export class RuntimeHintServiceError extends Error {
  constructor(
    readonly code: 'hint_not_found' | 'invalid_adoption' | 'storage_failed',
    readonly statusCode = code === 'hint_not_found' ? 404 : code === 'storage_failed' ? 500 : 400,
  ) {
    super(code);
  }
}

export function getRuntimeHintReport(
  database: DatabaseConnection,
  runId: string,
  now: number,
  optIn: boolean,
): RuntimeHintReport {
  const signals = getRuntimeEventSignals(database, runId);
  const configurationSnapshotId = latestConfigurationSnapshotId(signals.events);
  const historicalEvidence = new TaskRepository(database).findRuntimeHintHistoricalEvidence(
    signals.taskId,
    configurationSnapshotId,
  );
  const latestHint = database
    .prepare(
      `SELECT generated_at as generatedAt, expires_at as expiresAt
         FROM runtime_hints WHERE run_id = ? ORDER BY generated_at DESC LIMIT 1`,
    )
    .get(signals.runId) as { generatedAt: number; expiresAt: number } | undefined;
  const lastIssuedAt =
    latestHint && latestHint.expiresAt > now
      ? Math.max(latestHint.generatedAt, latestHint.expiresAt - RUNTIME_HINT_MIN_INTERVAL_MS)
      : (latestHint?.generatedAt ?? null);
  const report = buildRuntimeHint({
    now,
    taskId: signals.taskId,
    runId: signals.runId,
    events: signals.events,
    totalEvents: signals.total,
    rejectedEvents: signals.rejectedEvents,
    coverageKnown: signals.coverageKnown,
    historicalEvidence,
    lastIssuedAt,
    optIn,
  });
  if (report.status === 'available' && report.hint && report.taskId) {
    persistRuntimeHint(database, report);
  }
  return report;
}

export function recordRuntimeHintAdoption(
  database: DatabaseConnection,
  hintId: string,
  input: { status: RuntimeHintAdoptionStatus; producer: string },
  recordedAt: number,
): RuntimeHintAdoptionRecord {
  const normalizedHintId = boundedText(hintId, 256);
  const producer = boundedProducer(input.producer);
  if (!normalizedHintId || !producer || !isAdoptionStatus(input.status)) {
    throw new RuntimeHintServiceError('invalid_adoption');
  }
  const hint = database
    .prepare(
      `SELECT task_id as taskId, run_id as runId, evidence_json as evidenceJson
         FROM runtime_hints WHERE hint_id = ?`,
    )
    .get(normalizedHintId) as { taskId: string; runId: string; evidenceJson: string } | undefined;
  if (!hint) throw new RuntimeHintServiceError('hint_not_found');
  const evidence = parseEvidence(hint.evidenceJson);
  try {
    database
      .prepare(
        `INSERT INTO runtime_hint_adoptions (
           hint_id, task_id, run_id, status, producer, recorded_at, evidence_json, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(hint_id) DO UPDATE SET
           task_id = excluded.task_id,
           run_id = excluded.run_id,
           status = excluded.status,
           producer = excluded.producer,
           recorded_at = excluded.recorded_at,
           evidence_json = excluded.evidence_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        normalizedHintId,
        hint.taskId,
        hint.runId,
        input.status,
        producer,
        recordedAt,
        JSON.stringify(evidence),
        recordedAt,
      );
  } catch {
    throw new RuntimeHintServiceError('storage_failed');
  }
  return {
    schemaVersion: 'runtime-hint-adoption/v1',
    hintId: normalizedHintId,
    taskId: hint.taskId,
    runId: hint.runId,
    status: input.status,
    producer,
    recordedAt,
    evidence,
    limitations: [
      'Adoption is recorded only from this explicit request; subsequent tool behavior never infers adoption.',
      'The record stores bounded event and historical comparison references, not source content.',
    ],
  };
}

function persistRuntimeHint(database: DatabaseConnection, report: RuntimeHintReport): void {
  if (!report.hint || !report.taskId) return;
  try {
    database
      .prepare(
        `INSERT INTO runtime_hints (
           hint_id, task_id, run_id, generated_at, expires_at, category,
           payload_json, evidence_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(hint_id) DO UPDATE SET
           task_id = excluded.task_id,
           run_id = excluded.run_id,
           generated_at = excluded.generated_at,
           expires_at = excluded.expires_at,
           category = excluded.category,
           payload_json = excluded.payload_json,
           evidence_json = excluded.evidence_json`,
      )
      .run(
        report.hint.id,
        report.taskId,
        report.runId,
        report.hint.generatedAt,
        report.hint.expiresAt,
        report.hint.category,
        JSON.stringify(report.hint),
        JSON.stringify(report.hint.evidence),
        report.hint.generatedAt,
      );
  } catch {
    throw new RuntimeHintServiceError('storage_failed');
  }
}

function latestConfigurationSnapshotId(events: RuntimeEventSignal[]): string | null {
  return (
    [...events].reverse().find((event) => event.configurationSnapshotId)?.configurationSnapshotId ??
    null
  );
}

function parseEvidence(value: string): RuntimeHintEvidence {
  try {
    const evidence = JSON.parse(value) as RuntimeHintEvidence;
    if (
      !evidence ||
      !Array.isArray(evidence.eventIds) ||
      !Array.isArray(evidence.sequences) ||
      !evidence.historical
    ) {
      throw new Error('invalid evidence');
    }
    return evidence;
  } catch {
    throw new RuntimeHintServiceError('storage_failed');
  }
}

function isAdoptionStatus(value: unknown): value is RuntimeHintAdoptionStatus {
  return value === 'adopted' || value === 'ignored' || value === 'not_recorded';
}

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length > 0 && text.length <= max ? text : null;
}

function boundedProducer(value: unknown): string | null {
  const producer = boundedText(value, 120);
  return producer && /^[A-Za-z0-9._/-]+$/.test(producer) ? producer : null;
}
