import {
  CLI_DIAGNOSIS_SCHEMA_VERSION,
  CLI_EVIDENCE_SCHEMA_VERSION,
  type CliDiagnosisReport,
  type CliEvidenceReport,
  type CliTaskFeedbackReport,
  type CliTaskOutcomeReport,
} from '@agent-profile/contracts';
import {
  type AgentProfileReport,
  buildSessionEvidenceReport,
  type SessionDetail,
  type SessionSummary,
  type TaskOutcomeEvidence,
  type TaskProfileReport,
} from '@agent-profile/core';
import { diagnoseDetail } from './routes/diagnosis';
import { buildProfileReport } from './routes/profiles';
import { parseSpanRow, SESSION_COLS, SPAN_COLS } from './routes/shared';
import { buildStatsReport, type StatsReport } from './routes/stats';
import type { AppRuntime } from './runtime';
import { TaskRepository } from './task-repository';

const MAX_CLI_SESSION_SPANS = 2_000;
const MAX_CLI_EVIDENCE_REFERENCES = 500;

export class LocalReportNotFoundError extends Error {
  constructor(resource: 'session' | 'task', id: string) {
    super(`${resource} not found: ${id}`);
  }
}

export function getStatsReport(
  runtime: Pick<AppRuntime, 'database'> & Partial<Pick<AppRuntime, 'projectRoot'>>,
): StatsReport {
  return buildStatsReport(runtime.database, runtime.projectRoot);
}

export function getAgentProfileReport(
  runtime: Pick<AppRuntime, 'database' | 'clock'> & Partial<Pick<AppRuntime, 'projectRoot'>>,
): AgentProfileReport {
  return buildProfileReport(runtime.database, runtime.clock(), runtime.projectRoot);
}

export function getTaskProfileReport(
  runtime: Pick<AppRuntime, 'database'>,
  taskId: string,
): TaskProfileReport {
  return new TaskRepository(runtime.database).buildProfile(taskId);
}

export async function getSessionDiagnosisReport(
  runtime: Pick<AppRuntime, 'database' | 'clock' | 'pricingResolver' | 'contextWindowResolver'>,
  sessionId: string,
): Promise<CliDiagnosisReport['diagnosis']> {
  const loaded = loadSessionDetail(runtime.database, sessionId, MAX_CLI_SESSION_SPANS);
  const diagnosis = await diagnoseDetail(loaded.detail, runtime);
  const semantic = diagnosis.semantic;
  const limitations = [
    'CLI diagnosis is deterministic by default and returns no semantic Provider call.',
    'Finding details, suggestions, paths, tool parameters, and source content are omitted; use Span IDs as evidence references.',
    ...(semantic?.limitations ?? []),
  ];
  if (loaded.truncated) {
    limitations.push(`Diagnosis input was capped at ${MAX_CLI_SESSION_SPANS} normalized Spans.`);
  }
  return {
    schemaVersion: CLI_DIAGNOSIS_SCHEMA_VERSION,
    generatedAt: runtime.clock(),
    session: {
      id: loaded.detail.id,
      agent: loaded.detail.agent,
      startTime: loaded.detail.startTime,
      endTime: loaded.detail.endTime ?? null,
    },
    findings: diagnosis.findings.map((finding) => ({
      type: finding.type,
      severity: finding.severity,
      wastedTokens: finding.wastedTokens,
      wastedCost: finding.wastedCost,
      costUnknown: finding.costUnknown,
      spanIds: finding.spanIds,
    })),
    totalWastedTokens: diagnosis.totalWastedTokens,
    totalWastedCost: diagnosis.totalWastedCost,
    costUnknownCount: diagnosis.costUnknownCount,
    semantic: semantic
      ? {
          requested: semantic.requested,
          consent: semantic.consent,
          status: semantic.status,
          provider: semantic.provider,
          audit: semantic.audit,
        }
      : {
          requested: false,
          consent: 'not_granted',
          status: 'not_requested',
          provider: null,
          audit: {
            recorded: false,
            retention: 'process_bounded_content_free',
            rawContentStored: false,
          },
        },
    limitations,
  };
}

export function getSessionEvidenceReport(
  runtime: Pick<AppRuntime, 'database' | 'clock'>,
  sessionId: string,
): CliEvidenceReport['evidence'] {
  const loaded = loadSessionDetail(runtime.database, sessionId, MAX_CLI_EVIDENCE_REFERENCES);
  const report = buildSessionEvidenceReport(loaded.detail, loaded.detail.spans, {
    contentMode: 'none',
    generatedAt: runtime.clock(),
  });
  const limitations = [
    'CLI evidence is a bounded reference report; content previews are not available through this command.',
    'Use the Web/API evidence-page route for cursor paging and optional explicitly requested redacted previews.',
    ...report.limitations,
  ];
  if (loaded.truncated) {
    limitations.push(
      `Evidence references are capped at ${MAX_CLI_EVIDENCE_REFERENCES} normalized Spans.`,
    );
  }
  return {
    schemaVersion: CLI_EVIDENCE_SCHEMA_VERSION,
    generatedAt: report.generatedAt,
    session: report.session,
    scope: { events: report.scope.events, returnedReferences: report.events.length },
    coverage: report.coverage,
    privacy: { ...report.privacy, contentMode: 'none', previewCharacters: 0 },
    references: report.events.map((event) => ({
      sequence: event.sequence,
      id: event.id,
      parentId: event.parentId,
      parentLink: event.parentLink,
      type: event.type,
      lane: event.lane,
      outcome: event.outcome,
      startTime: event.startTime,
      endTime: event.endTime,
      durationMs: event.durationMs,
    })),
    limitations,
  };
}

export function recordTaskOutcomeEvidence(
  runtime: Pick<AppRuntime, 'database'>,
  taskId: string,
  evidence: TaskOutcomeEvidence,
): CliTaskOutcomeReport['saved'] {
  const repository = new TaskRepository(runtime.database);
  const current = repository.getOutcome(taskId);
  repository.upsertOutcome(taskId, { evidence: [...(current?.evidence ?? []), evidence] });
  const profile = repository.buildProfile(taskId);
  return {
    evidenceCount: profile.outcome?.evidence.length ?? 0,
    kind: evidence.kind,
    status: evidence.status ?? null,
    coverage: {
      observedFields: profile.coverage.outcome.observedFields,
      totalFields: profile.coverage.outcome.totalFields,
      status: profile.coverage.outcome.status,
    },
  };
}

export function getTaskFeedbackReports(
  runtime: Pick<AppRuntime, 'database'>,
  taskId: string,
): CliTaskFeedbackReport['feedback'] {
  const reports = new TaskRepository(runtime.database).buildTaskFeedback(taskId);
  return reports as unknown as CliTaskFeedbackReport['feedback'];
}

function loadSessionDetail(
  database: AppRuntime['database'],
  sessionId: string,
  maxSpans: number,
): { detail: SessionDetail; truncated: boolean } {
  const session = database
    .prepare(`SELECT ${SESSION_COLS} FROM sessions WHERE id = ?`)
    .get(sessionId) as SessionSummary | undefined;
  if (!session) throw new LocalReportNotFoundError('session', sessionId);
  const rows = database
    .prepare(
      `SELECT ${SPAN_COLS} FROM spans WHERE session_id = ? ORDER BY start_time ASC, id ASC LIMIT ?`,
    )
    .all(sessionId, maxSpans + 1) as Record<string, unknown>[];
  const truncated = rows.length > maxSpans;
  const spans = rows.slice(0, maxSpans).map(parseSpanRow);
  return { detail: { ...session, spans }, truncated };
}
