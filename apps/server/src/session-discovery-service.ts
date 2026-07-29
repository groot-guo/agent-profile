import type { CliSessionDiscoveryPage, CliSessionSummary } from '@agent-profile/contracts';
import type { SessionSummary } from '@agent-profile/core';
import type { DatabaseConnection } from './database';
import { primarySessionPredicate } from './primary-sessions';
import { SESSION_COLS } from './routes/shared';

export const DEFAULT_SESSION_DISCOVERY_LIMIT = 20;
export const MAX_SESSION_DISCOVERY_LIMIT = 100;

export interface SessionDiscoveryOptions {
  limit?: number;
  cursor?: string;
}

export type SessionDiscoveryErrorCode = 'invalid_cursor' | 'invalid_limit';

export class SessionDiscoveryError extends Error {
  constructor(readonly code: SessionDiscoveryErrorCode) {
    super(code === 'invalid_cursor' ? 'invalid session cursor' : 'invalid session limit');
  }
}

interface SessionCursor {
  startTime: number;
  id: string;
}

const CLI_SESSION_COLUMNS = `
  id,
  agent,
  start_time AS startTime,
  end_time AS endTime,
  git_branch AS gitBranch,
  input_tokens AS inputTokens,
  cache_creation_tokens AS cacheCreationTokens,
  cache_read_tokens AS cacheReadTokens,
  output_tokens AS outputTokens,
  total_cost AS totalCost,
  cost_unknown_count AS costUnknownCount,
  cost_currency AS costCurrency,
  peak_context_tokens AS peakContextTokens,
  avg_context_tokens AS avgContextTokens,
  cache_hit_rate AS cacheHitRate,
  message_count AS messageCount,
  imported_at AS importedAt`;

export function listPrimarySessionSummaries(database: DatabaseConnection): SessionSummary[] {
  return database
    .prepare(
      `SELECT ${SESSION_COLS}
       FROM sessions
       WHERE ${primarySessionPredicate()}
       ORDER BY start_time DESC`,
    )
    .all() as SessionSummary[];
}

export function discoverSessions(
  database: DatabaseConnection,
  options: SessionDiscoveryOptions = {},
): CliSessionDiscoveryPage {
  const limit = validatedLimit(options.limit);
  const cursor = options.cursor === undefined ? null : decodeCursor(options.cursor);
  const cursorClause = cursor ? 'AND (start_time < ? OR (start_time = ? AND id < ?))' : '';
  const parameters: Array<number | string> = cursor
    ? [cursor.startTime, cursor.startTime, cursor.id, limit + 1]
    : [limit + 1];
  const rows = database
    .prepare(
      `SELECT ${CLI_SESSION_COLUMNS}
       FROM sessions
       WHERE ${primarySessionPredicate()}
         ${cursorClause}
       ORDER BY start_time DESC, id DESC
       LIMIT ?`,
    )
    .all(...parameters) as CliSessionSummary[];
  const hasMore = rows.length > limit;
  const sessions = rows.slice(0, limit);
  const lastSession = sessions.at(-1);

  return {
    limit,
    hasMore,
    nextCursor: hasMore && lastSession ? encodeCursor(lastSession) : null,
    sessions,
  };
}

function validatedLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_SESSION_DISCOVERY_LIMIT;
  if (!Number.isInteger(value) || value < 1 || value > MAX_SESSION_DISCOVERY_LIMIT) {
    throw new SessionDiscoveryError('invalid_limit');
  }
  return value;
}

function encodeCursor(session: Pick<CliSessionSummary, 'startTime' | 'id'>): string {
  return Buffer.from(JSON.stringify({ startTime: session.startTime, id: session.id })).toString(
    'base64url',
  );
}

function decodeCursor(value: string): SessionCursor {
  if (!value || value.length > 512) throw new SessionDiscoveryError('invalid_cursor');
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    const candidate = decoded as { startTime?: unknown; id?: unknown };
    const startTime = candidate.startTime;
    const id = candidate.id;
    if (
      !decoded ||
      typeof decoded !== 'object' ||
      typeof startTime !== 'number' ||
      !Number.isSafeInteger(startTime) ||
      typeof id !== 'string' ||
      !id
    ) {
      throw new SessionDiscoveryError('invalid_cursor');
    }
    return { startTime, id };
  } catch (error) {
    if (error instanceof SessionDiscoveryError) throw error;
    throw new SessionDiscoveryError('invalid_cursor');
  }
}
