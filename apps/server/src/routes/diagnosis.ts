import {
  type DiagnosisResult,
  diagnoseSession,
  diagnoseSessionSync,
  type SessionDetail,
  type SessionSummary,
} from '@agent-profile/core';
import type { FastifyInstance } from 'fastify';
import { createLlmDiagnoser } from '../llm-diagnoser';
import type { AppRuntime } from '../runtime';
import { parseSpanRow, SESSION_COLS, SPAN_COLS } from './shared';

const llmDiagnoser = createLlmDiagnoser();

type DiagnosisRuntime = Pick<AppRuntime, 'pricingResolver' | 'contextWindowResolver'>;
type DiagnosisRouteRuntime = Pick<
  AppRuntime,
  'database' | 'pricingResolver' | 'contextWindowResolver'
>;

export async function diagnoseDetail(
  detail: SessionDetail,
  runtime: DiagnosisRuntime,
): Promise<DiagnosisResult> {
  const options = {
    // Diagnosis estimates are planning-time input-price upper bounds; the
    // analyzer/import path separately persists span-time cost provenance.
    pricingLookup: runtime.pricingResolver,
    contextWindowLookup: runtime.contextWindowResolver,
  };
  if (llmDiagnoser) return diagnoseSession(detail, { ...options, llmDiagnoser });
  return diagnoseSessionSync(detail, options);
}

export function registerDiagnosisRoutes(
  app: FastifyInstance,
  runtime: DiagnosisRouteRuntime,
): void {
  const { database } = runtime;
  app.get<{ Params: { id: string } }>('/api/session/:id/diagnosis', async (req, reply) => {
    const session = database
      .prepare(`SELECT ${SESSION_COLS} FROM sessions WHERE id = ?`)
      .get(req.params.id) as SessionSummary | undefined;
    if (!session) return reply.status(404).send({ error: 'session not found' });
    const rows = database
      .prepare(`SELECT ${SPAN_COLS} FROM spans WHERE session_id = ? ORDER BY start_time ASC`)
      .all(req.params.id) as Record<string, unknown>[];
    const detail = { ...session, spans: rows.map(parseSpanRow) } as SessionDetail;

    return diagnoseDetail(detail, runtime);
  });
}
