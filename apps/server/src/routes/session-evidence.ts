import {
  buildSessionEvidenceReport,
  type EvidenceContentMode,
  type SessionSummary,
} from '@agent-profile/core';
import type { FastifyInstance } from 'fastify';
import type { AppRuntime } from '../runtime';
import { parseSpanRow, SESSION_COLS, SPAN_COLS } from './shared';

type SessionEvidenceRuntime = Pick<AppRuntime, 'database'>;

interface EvidenceQuery {
  content?: EvidenceContentMode;
}

const evidenceQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    content: { type: 'string', enum: ['none', 'preview'] },
  },
} as const;

export function registerSessionEvidenceRoutes(
  app: FastifyInstance,
  runtime: SessionEvidenceRuntime,
): void {
  const { database } = runtime;
  app.get<{ Params: { id: string }; Querystring: EvidenceQuery }>(
    '/api/session/:id/evidence',
    { schema: { querystring: evidenceQuerySchema } },
    async (request, reply) => {
      const session = database
        .prepare(`SELECT ${SESSION_COLS} FROM sessions WHERE id = ?`)
        .get(request.params.id) as SessionSummary | undefined;
      if (!session) return reply.status(404).send({ error: 'session not found' });

      const rows = database
        .prepare(`SELECT ${SPAN_COLS} FROM spans WHERE session_id = ? ORDER BY start_time ASC`)
        .all(request.params.id) as Record<string, unknown>[];
      return buildSessionEvidenceReport(session, rows.map(parseSpanRow), {
        contentMode: request.query.content ?? 'none',
      });
    },
  );
}
