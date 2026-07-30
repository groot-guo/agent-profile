import {
  buildSessionEvidenceReport,
  type EvidenceContentMode,
  type SessionSummary,
} from '@agent-profile/core';
import type { FastifyInstance } from 'fastify';
import type { AppRuntime } from '../runtime';
import { loadSessionEvidencePage, SessionEvidencePageError } from '../session-evidence-service';
import { parseSpanRow, SESSION_COLS, SPAN_COLS } from './shared';

type SessionEvidenceRuntime = Pick<AppRuntime, 'database'>;

interface EvidenceQuery {
  content?: EvidenceContentMode;
}

interface EvidencePageQuery {
  content?: string;
  type?: string;
  lane?: string;
  outcome?: string;
  limit?: string;
  cursor?: string;
}

const evidenceQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    content: { type: 'string', enum: ['none', 'preview'] },
  },
} as const;

const evidencePageQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    content: { type: 'string' },
    type: { type: 'string' },
    lane: { type: 'string' },
    outcome: { type: 'string' },
    limit: { type: 'string' },
    cursor: { type: 'string' },
  },
} as const;

export function registerSessionEvidenceRoutes(
  app: FastifyInstance,
  runtime: SessionEvidenceRuntime,
): void {
  const { database } = runtime;
  app.get<{ Params: { id: string }; Querystring: EvidencePageQuery }>(
    '/api/session/:id/evidence-page',
    { schema: { querystring: evidencePageQuerySchema } },
    async (request, reply) => {
      const session = database
        .prepare(`SELECT ${SESSION_COLS} FROM sessions WHERE id = ?`)
        .get(request.params.id) as SessionSummary | undefined;
      if (!session) return reply.status(404).send({ error: 'session not found' });
      try {
        return loadSessionEvidencePage(database, session, {
          content: request.query.content,
          type: request.query.type,
          lane: request.query.lane,
          outcome: request.query.outcome,
          limit: parseOptionalInteger(request.query.limit),
          cursor: request.query.cursor,
        });
      } catch (error) {
        if (error instanceof SessionEvidencePageError) {
          return reply.status(400).send({ error: error.message });
        }
        throw error;
      }
    },
  );

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

function parseOptionalInteger(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) return Number.NaN;
  return Number.parseInt(value, 10);
}
