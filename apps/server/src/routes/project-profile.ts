import {
  buildProjectProfile,
  type ProjectProfileReport,
  type ProjectProfileSessionSample,
  type ProjectProfileToolSample,
} from '@agent-profile/core';
import type { FastifyInstance } from 'fastify';
import type { DatabaseConnection } from '../database';
import { primarySessionPredicate } from '../primary-sessions';
import type { AppRuntime } from '../runtime';

type ProjectProfileRuntime = Pick<AppRuntime, 'database' | 'clock'>;

interface ProjectProfileQuery {
  project: string;
  from?: string;
  to?: string;
}

interface ProjectSessionRow extends ProjectProfileSessionSample {
  sourceKind: string | null;
}

const PROJECT_PROFILE_SESSION_LIMIT = 1_000;
const PROJECT_PROFILE_TOOL_LIMIT = 10_000;
const PROJECT_PROFILE_QUERY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['project'],
  properties: {
    project: { type: 'string', minLength: 1, maxLength: 500 },
    from: { type: 'string', pattern: '^\\d+$' },
    to: { type: 'string', pattern: '^\\d+$' },
  },
} as const;

export function registerProjectProfileRoutes(
  app: FastifyInstance,
  runtime: ProjectProfileRuntime,
): void {
  app.get<{ Querystring: ProjectProfileQuery }>(
    '/api/projects/profile',
    { schema: { querystring: PROJECT_PROFILE_QUERY_SCHEMA } },
    async (request, reply) => {
      const range = parseRange(request.query.from, request.query.to);
      if (!range.ok) return reply.code(400).send({ error: range.error });
      return buildProjectProfileReport(
        runtime.database,
        request.query.project,
        range.value,
        runtime.clock(),
      );
    },
  );
}

export function buildProjectProfileReport(
  database: DatabaseConnection,
  project: string,
  range: { from: number | null; to: number | null } = { from: null, to: null },
  generatedAt = Date.now(),
): ProjectProfileReport {
  const where = [`${PROJECT_EXPRESSION} = ?`, primarySessionPredicate('s')];
  const values: Array<string | number> = [project];
  if (range.from != null) {
    where.push('s.start_time >= ?');
    values.push(range.from);
  }
  if (range.to != null) {
    where.push('s.start_time < ?');
    values.push(range.to);
  }
  const sessions = database
    .prepare(
      `SELECT
        s.id as id,
        1 as available,
        s.agent as agent,
        s.source_kind as sourceKind,
        s.start_time as startTime,
        s.end_time as endTime,
        s.input_tokens as inputTokens,
        s.cache_creation_tokens as cacheCreationTokens,
        s.cache_read_tokens as cacheReadTokens,
        s.output_tokens as outputTokens,
        s.total_cost as totalCost,
        s.cost_unknown_count as costUnknownCount,
        s.cache_hit_rate as cacheHitRate,
        s.peak_context_tokens as peakContextTokens
       FROM sessions s
       WHERE ${where.join(' AND ')}
       ORDER BY s.start_time DESC, s.id DESC
       LIMIT ?`,
    )
    .all(...values, PROJECT_PROFILE_SESSION_LIMIT + 1) as ProjectSessionRow[];
  const sampled = sessions.length > PROJECT_PROFILE_SESSION_LIMIT;
  const selectedSessions = sampled ? sessions.slice(0, PROJECT_PROFILE_SESSION_LIMIT) : sessions;
  const sessionIds = selectedSessions.map((session) => session.id);
  const toolRows = loadToolRows(database, sessionIds);
  return buildProjectProfile({
    project: { key: project, label: project },
    sessions: selectedSessions,
    tools: toolRows.rows,
    sampled,
    toolSampled: toolRows.sampled,
    range,
    generatedAt,
  });
}

const PROJECT_EXPRESSION =
  "COALESCE(NULLIF(TRIM(s.project_key), ''), 'agent-profile:session-records:unknown')";

function loadToolRows(
  database: DatabaseConnection,
  sessionIds: string[],
): { rows: ProjectProfileToolSample[]; sampled: boolean } {
  if (sessionIds.length === 0) return { rows: [], sampled: false };
  const placeholders = sessionIds.map(() => '?').join(', ');
  const rows = database
    .prepare(
      `SELECT session_id as sessionId, name, start_time as startTime, is_error as isError
       FROM spans
       WHERE type = 'tool_call' AND session_id IN (${placeholders})
       ORDER BY start_time DESC, id DESC
       LIMIT ?`,
    )
    .all(...sessionIds, PROJECT_PROFILE_TOOL_LIMIT + 1) as Array<{
    sessionId: string;
    name: string;
    startTime: number | null;
    isError: number;
  }>;
  return {
    rows: rows.slice(0, PROJECT_PROFILE_TOOL_LIMIT).map((row) => ({
      sessionId: row.sessionId,
      name: row.name || 'unknown',
      startTime: row.startTime,
      isError: row.isError === 1,
    })),
    sampled: rows.length > PROJECT_PROFILE_TOOL_LIMIT,
  };
}

function parseRange(
  from: string | undefined,
  to: string | undefined,
): { ok: true; value: { from: number | null; to: number | null } } | { ok: false; error: string } {
  const parsedFrom = from === undefined ? null : Number(from);
  const parsedTo = to === undefined ? null : Number(to);
  if (
    (parsedFrom != null && !Number.isSafeInteger(parsedFrom)) ||
    (parsedTo != null && !Number.isSafeInteger(parsedTo))
  ) {
    return { ok: false, error: 'invalid_project_profile_range' };
  }
  if (parsedFrom != null && parsedTo != null && parsedFrom >= parsedTo) {
    return { ok: false, error: 'invalid_project_profile_range' };
  }
  return { ok: true, value: { from: parsedFrom, to: parsedTo } };
}
