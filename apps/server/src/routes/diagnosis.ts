import { diagnoseSessionSync, type SessionDetail, type SessionSummary } from '@agent-profile/core';
import type { FastifyInstance } from 'fastify';
import { db, getModelContext, getPricing } from '../db';
import { parseSpanRow, SESSION_COLS, SPAN_COLS } from './shared';

export function registerDiagnosisRoutes(app: FastifyInstance) {
  // P1 诊断建议清单（同步，无 LLM）
  app.get<{ Params: { id: string } }>('/api/session/:id/diagnosis', async (req, reply) => {
    const session = db
      .prepare(`SELECT ${SESSION_COLS} FROM sessions WHERE id = ?`)
      .get(req.params.id) as SessionSummary | undefined;
    if (!session) return reply.status(404).send({ error: 'session not found' });
    const rows = db
      .prepare(`SELECT ${SPAN_COLS} FROM spans WHERE session_id = ? ORDER BY start_time ASC`)
      .all(req.params.id) as Record<string, unknown>[];
    const detail = { ...session, spans: rows.map(parseSpanRow) } as SessionDetail;
    return diagnoseSessionSync(detail, {
      pricingLookup: getPricing,
      contextWindowLookup: getModelContext,
    });
  });
}
