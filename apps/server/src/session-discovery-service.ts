import {
  type CliSessionDiscoveryPage,
  type CliSessionSummary,
  SESSION_ACTIVITY_RECENT_WINDOW_MS,
  SESSION_ACTIVITY_UPDATING_WINDOW_MS,
  SESSION_DISCOVERY_SCHEMA_VERSION,
  type SessionActivityBasis,
  type SessionActivityState,
  type SessionDiscoveryItem,
  type SessionDiscoveryPage,
  type SessionDiscoveryQuickView,
  type SessionDiscoverySort,
  type SessionDiscoveryTimeRange,
} from '@agent-profile/contracts';
import type { SessionSummary } from '@agent-profile/core';
import type { DatabaseConnection } from './database';
import { primarySessionPredicate } from './primary-sessions';
import { SESSION_COLS } from './routes/shared';

export const DEFAULT_SESSION_DISCOVERY_LIMIT = 20;
export const MAX_SESSION_DISCOVERY_LIMIT = 100;
export const DEFAULT_WEB_SESSION_DISCOVERY_LIMIT = 120;
export const MAX_WEB_SESSION_DISCOVERY_LIMIT = 200;

export interface SessionDiscoveryOptions {
  limit?: number;
  cursor?: string;
}

export interface WebSessionDiscoveryOptions {
  limit?: number;
  cursor?: string;
  agent?: string;
  project?: string;
  query?: string;
  timeRange?: SessionDiscoveryTimeRange;
  sort?: SessionDiscoverySort;
  quickView?: SessionDiscoveryQuickView;
  selectedId?: string;
  now?: number;
  availableSourceKinds?: ReadonlySet<string>;
}

export type SessionDiscoveryErrorCode =
  | 'invalid_cursor'
  | 'cursor_query_mismatch'
  | 'invalid_limit'
  | 'invalid_query'
  | 'invalid_quick_view'
  | 'invalid_sort'
  | 'invalid_time_range';

export class SessionDiscoveryError extends Error {
  constructor(readonly code: SessionDiscoveryErrorCode) {
    super(DISCOVERY_ERROR_MESSAGES[code]);
  }
}

interface SessionCursor {
  startTime: number;
  id: string;
}

interface WebSessionCursor {
  version: 1;
  queryKey: string;
  sortValue: number;
  id: string;
  startedAfter: number | null;
}

interface NormalizedWebDiscoveryOptions {
  limit: number;
  agent: string | null;
  project: string | null;
  query: string;
  timeRange: SessionDiscoveryTimeRange;
  sort: SessionDiscoverySort;
  quickView: SessionDiscoveryQuickView;
  selectedId: string | null;
  startedAfter: number | null;
  now: number;
  availableSourceKinds?: ReadonlySet<string>;
}

interface DiscoveryRow
  extends Omit<
    SessionDiscoveryItem,
    | 'isAnomaly'
    | 'activityState'
    | 'activityBasis'
    | 'lastActivityAt'
    | 'activityObservedAt'
    | 'provisional'
  > {
  isAnomaly: number;
  sortValue: number;
  sourceKind: string | null;
  sourceUpdatedAt: number | null;
}

const DISCOVERY_ERROR_MESSAGES: Record<SessionDiscoveryErrorCode, string> = {
  invalid_cursor: 'invalid session cursor',
  cursor_query_mismatch: 'session cursor does not match query',
  invalid_limit: 'invalid session limit',
  invalid_query: 'invalid session query',
  invalid_quick_view: 'invalid session quick view',
  invalid_sort: 'invalid session sort',
  invalid_time_range: 'invalid session time range',
};

const WEB_SORTS: Record<SessionDiscoverySort, { expression: string; direction: 'ASC' | 'DESC' }> = {
  time: { expression: 's.start_time', direction: 'DESC' },
  cost: { expression: 'COALESCE(s.total_cost, 0)', direction: 'DESC' },
  tokens: {
    expression:
      '(COALESCE(s.input_tokens, 0) + COALESCE(s.cache_creation_tokens, 0) + COALESCE(s.cache_read_tokens, 0) + COALESCE(s.output_tokens, 0))',
    direction: 'DESC',
  },
  cache: { expression: 'COALESCE(s.cache_hit_rate, 0)', direction: 'ASC' },
  duration: {
    expression: '(COALESCE(s.end_time, 0) - s.start_time)',
    direction: 'DESC',
  },
};

const PROJECT_EXPRESSION =
  "COALESCE(NULLIF(TRIM(s.project_key), ''), 'agent-profile:session-records:unknown')";

const WEB_SESSION_COLUMNS = `
  s.id,
  s.agent,
  ${PROJECT_EXPRESSION} AS project,
  s.start_time AS startTime,
  s.end_time AS endTime,
  COALESCE(s.input_tokens, 0) AS inputTokens,
  COALESCE(s.cache_creation_tokens, 0) AS cacheCreationTokens,
  COALESCE(s.cache_read_tokens, 0) AS cacheReadTokens,
  COALESCE(s.output_tokens, 0) AS outputTokens,
  COALESCE(s.total_cost, 0) AS totalCost,
  COALESCE(s.cost_unknown_count, 0) AS costUnknownCount,
  s.cost_currency AS costCurrency,
  COALESCE(s.peak_context_tokens, 0) AS peakContextTokens,
  COALESCE(s.avg_context_tokens, 0) AS avgContextTokens,
  COALESCE(s.cache_hit_rate, 0) AS cacheHitRate,
  COALESCE(s.message_count, 0) AS messageCount,
  s.imported_at AS importedAt,
  s.source_kind AS sourceKind,
  s.source_updated_at AS sourceUpdatedAt,
  CASE WHEN anomaly_sessions.id IS NULL THEN 0 ELSE 1 END AS isAnomaly`;

const ANOMALY_CTE = `WITH primary_costs AS (
  SELECT
    s.id,
    ${PROJECT_EXPRESSION} AS project,
    COALESCE(s.total_cost, 0) AS total_cost,
    ROW_NUMBER() OVER (
      PARTITION BY ${PROJECT_EXPRESSION}
      ORDER BY COALESCE(s.total_cost, 0), s.id
    ) AS cost_position,
    COUNT(*) OVER (PARTITION BY ${PROJECT_EXPRESSION}) AS project_sessions
  FROM sessions s
  WHERE ${primarySessionPredicate('s')}
), project_medians AS (
  SELECT
    project,
    project_sessions,
    MAX(
      CASE
        WHEN cost_position = CAST(project_sessions * 0.5 AS INTEGER) + 1 THEN total_cost
        ELSE NULL
      END
    ) AS median_cost
  FROM primary_costs
  GROUP BY project, project_sessions
), anomaly_sessions AS (
  SELECT primary_costs.id
  FROM primary_costs
  INNER JOIN project_medians ON project_medians.project = primary_costs.project
  WHERE project_medians.project_sessions >= 3
    AND project_medians.median_cost > 0.001
    AND primary_costs.total_cost > project_medians.median_cost * 3
)`;

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

export function discoverSessionPage(
  database: DatabaseConnection,
  options: WebSessionDiscoveryOptions = {},
): SessionDiscoveryPage {
  const cursor = options.cursor === undefined ? null : decodeWebCursor(options.cursor);
  const normalized = normalizeWebOptions(options, cursor);
  const queryKey = webQueryKey(normalized);
  if (cursor && cursor.queryKey !== queryKey) {
    throw new SessionDiscoveryError('cursor_query_mismatch');
  }

  const sort = WEB_SORTS[normalized.sort];
  const filters = webFilters(normalized);
  const cursorClause = cursor
    ? `AND (${sort.expression} ${sort.direction === 'DESC' ? '<' : '>'} ?
      OR (${sort.expression} = ? AND s.id ${sort.direction === 'DESC' ? '<' : '>'} ?))`
    : '';
  const rows = database
    .prepare(
      `${ANOMALY_CTE}
       SELECT ${WEB_SESSION_COLUMNS}, ${sort.expression} AS sortValue
       FROM sessions s
       LEFT JOIN anomaly_sessions ON anomaly_sessions.id = s.id
       WHERE ${filters.clause}
         ${cursorClause}
       ORDER BY ${sort.expression} ${sort.direction}, s.id ${sort.direction}
       LIMIT ?`,
    )
    .all(
      ...filters.parameters,
      ...(cursor ? [cursor.sortValue, cursor.sortValue, cursor.id] : []),
      normalized.limit + 1,
    ) as DiscoveryRow[];
  const hasMore = rows.length > normalized.limit;
  const pageRows = rows.slice(0, normalized.limit);
  const sessions = pageRows.map((row) =>
    toDiscoveryItem(row, normalized.now, normalized.availableSourceKinds),
  );
  const lastRow = pageRows.at(-1);
  const matched = (
    database
      .prepare(
        `${ANOMALY_CTE}
         SELECT COUNT(*) AS count
         FROM sessions s
         LEFT JOIN anomaly_sessions ON anomaly_sessions.id = s.id
         WHERE ${filters.clause}`,
      )
      .get(...filters.parameters) as { count: number }
  ).count;
  const total = (
    database
      .prepare(`SELECT COUNT(*) AS count FROM sessions s WHERE ${primarySessionPredicate('s')}`)
      .get() as { count: number }
  ).count;

  return {
    schemaVersion: SESSION_DISCOVERY_SCHEMA_VERSION,
    query: {
      agent: normalized.agent,
      project: normalized.project,
      query: normalized.query,
      timeRange: normalized.timeRange,
      sort: normalized.sort,
      quickView: normalized.quickView,
    },
    counts: { matched, total },
    page: {
      limit: normalized.limit,
      hasMore,
      nextCursor:
        hasMore && lastRow
          ? encodeWebCursor({
              version: 1,
              queryKey,
              sortValue: lastRow.sortValue,
              id: lastRow.id,
              startedAfter: normalized.startedAfter,
            })
          : null,
    },
    facets: loadDiscoveryFacets(database, normalized),
    sessions,
    selectedSession: normalized.selectedId
      ? loadSelectedDiscoverySession(
          database,
          normalized.selectedId,
          normalized.now,
          normalized.availableSourceKinds,
        )
      : null,
  };
}

function normalizeWebOptions(
  options: WebSessionDiscoveryOptions,
  cursor: WebSessionCursor | null,
): NormalizedWebDiscoveryOptions {
  const limit = options.limit ?? DEFAULT_WEB_SESSION_DISCOVERY_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_WEB_SESSION_DISCOVERY_LIMIT) {
    throw new SessionDiscoveryError('invalid_limit');
  }
  const sort = options.sort ?? 'time';
  if (!isWebSort(sort)) throw new SessionDiscoveryError('invalid_sort');
  const quickView = options.quickView ?? 'all';
  if (!isWebQuickView(quickView)) throw new SessionDiscoveryError('invalid_quick_view');
  const timeRange = options.timeRange ?? 'all';
  if (!isWebTimeRange(timeRange)) throw new SessionDiscoveryError('invalid_time_range');
  const query = normalizedText(options.query, 200, 'invalid_query') ?? '';
  const agent = normalizedText(options.agent, 200, 'invalid_query');
  const project = normalizedText(options.project, 2_048, 'invalid_query');
  const selectedId = normalizedText(options.selectedId, 512, 'invalid_query');
  const now = options.now ?? Date.now();
  const startedAfter = cursor?.startedAfter ?? timeRangeCutoff(timeRange, now);
  return {
    limit,
    agent,
    project,
    query,
    timeRange,
    sort,
    quickView,
    selectedId,
    startedAfter,
    now,
    availableSourceKinds: options.availableSourceKinds,
  };
}

function webFilters(
  options: NormalizedWebDiscoveryOptions,
  exclude: 'agent' | 'project' | 'none' = 'none',
): {
  clause: string;
  parameters: Array<number | string>;
} {
  const clauses = [primarySessionPredicate('s')];
  const parameters: Array<number | string> = [];
  if (options.agent && exclude !== 'agent') {
    clauses.push('s.agent = ?');
    parameters.push(options.agent);
  }
  if (options.project && exclude !== 'project') {
    clauses.push(`${PROJECT_EXPRESSION} = ?`);
    parameters.push(options.project);
  }
  if (options.startedAfter !== null) {
    clauses.push('s.start_time >= ?');
    parameters.push(options.startedAfter);
  }
  if (options.query) {
    const pattern = `%${escapeLike(options.query.toLowerCase())}%`;
    clauses.push(`(
      LOWER(s.id) LIKE ? ESCAPE '\\'
      OR LOWER(s.agent) LIKE ? ESCAPE '\\'
      OR LOWER(${PROJECT_EXPRESSION}) LIKE ? ESCAPE '\\'
    )`);
    parameters.push(pattern, pattern, pattern);
  }
  if (options.quickView === 'anomaly') clauses.push('anomaly_sessions.id IS NOT NULL');
  if (options.quickView === 'unpriced') clauses.push('COALESCE(s.cost_unknown_count, 0) > 0');
  return { clause: clauses.join('\nAND '), parameters };
}

function loadDiscoveryFacets(
  database: DatabaseConnection,
  options: NormalizedWebDiscoveryOptions,
): SessionDiscoveryPage['facets'] {
  const agentFilters = webFilters(options, 'agent');
  const agents = database
    .prepare(
      `${ANOMALY_CTE}
       SELECT s.agent, COUNT(*) AS count
       FROM sessions s
       LEFT JOIN anomaly_sessions ON anomaly_sessions.id = s.id
       WHERE ${agentFilters.clause}
       GROUP BY s.agent
       ORDER BY count DESC, s.agent ASC`,
    )
    .all(...agentFilters.parameters) as SessionDiscoveryPage['facets']['agents'];
  const projectFilters = webFilters(options, 'project');
  const projects = database
    .prepare(
      `${ANOMALY_CTE}
       SELECT ${PROJECT_EXPRESSION} AS project, COUNT(*) AS count,
        MAX(s.start_time) AS lastUsedAt
       FROM sessions s
       LEFT JOIN anomaly_sessions ON anomaly_sessions.id = s.id
       WHERE ${projectFilters.clause}
       GROUP BY ${PROJECT_EXPRESSION}
       ORDER BY project ASC`,
    )
    .all(...projectFilters.parameters) as SessionDiscoveryPage['facets']['projects'];
  return { agents, projects };
}

function loadSelectedDiscoverySession(
  database: DatabaseConnection,
  selectedId: string,
  now: number,
  availableSourceKinds?: ReadonlySet<string>,
): SessionDiscoveryItem | null {
  const row = database
    .prepare(
      `${ANOMALY_CTE}
       SELECT ${WEB_SESSION_COLUMNS}, s.start_time AS sortValue
       FROM sessions s
       LEFT JOIN anomaly_sessions ON anomaly_sessions.id = s.id
       WHERE s.id = ?`,
    )
    .get(selectedId) as DiscoveryRow | undefined;
  return row ? toDiscoveryItem(row, now, availableSourceKinds) : null;
}

function toDiscoveryItem(
  row: DiscoveryRow,
  now: number,
  availableSourceKinds?: ReadonlySet<string>,
): SessionDiscoveryItem {
  const { sortValue: _sortValue, isAnomaly, sourceKind, sourceUpdatedAt, ...session } = row;
  const activity = sessionActivity(sourceKind, sourceUpdatedAt, now, availableSourceKinds);
  return {
    ...session,
    isAnomaly: isAnomaly === 1,
    ...activity,
    activityObservedAt: now,
  };
}

function sessionActivity(
  sourceKind: string | null,
  sourceUpdatedAt: number | null,
  now: number,
  availableSourceKinds?: ReadonlySet<string>,
): {
  activityState: SessionActivityState;
  activityBasis: SessionActivityBasis;
  lastActivityAt: number | null;
  provisional: boolean;
} {
  if (sourceUpdatedAt === null || sourceKind === null) {
    return {
      activityState: 'unknown',
      activityBasis: 'not_observed',
      lastActivityAt: sourceUpdatedAt,
      provisional: false,
    };
  }
  if (availableSourceKinds && !availableSourceKinds.has(sourceKind)) {
    return {
      activityState: 'unknown',
      activityBasis: 'source_unavailable',
      lastActivityAt: sourceUpdatedAt,
      provisional: false,
    };
  }

  const age = Math.max(0, now - sourceUpdatedAt);
  const activityState: SessionActivityState =
    age <= SESSION_ACTIVITY_UPDATING_WINDOW_MS
      ? 'updating'
      : age <= SESSION_ACTIVITY_RECENT_WINDOW_MS
        ? 'recent'
        : 'settled';
  return {
    activityState,
    activityBasis: 'revision_change',
    lastActivityAt: sourceUpdatedAt,
    provisional: activityState === 'updating' || activityState === 'recent',
  };
}

function webQueryKey(options: NormalizedWebDiscoveryOptions): string {
  return JSON.stringify({
    agent: options.agent,
    project: options.project,
    query: options.query.toLowerCase(),
    timeRange: options.timeRange,
    sort: options.sort,
    quickView: options.quickView,
  });
}

function encodeWebCursor(cursor: WebSessionCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeWebCursor(value: string): WebSessionCursor {
  if (!value || value.length > 2_048) throw new SessionDiscoveryError('invalid_cursor');
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    const candidate = decoded as Partial<WebSessionCursor>;
    if (
      !decoded ||
      typeof decoded !== 'object' ||
      candidate.version !== 1 ||
      typeof candidate.queryKey !== 'string' ||
      typeof candidate.sortValue !== 'number' ||
      !Number.isFinite(candidate.sortValue) ||
      typeof candidate.id !== 'string' ||
      !candidate.id ||
      (candidate.startedAfter !== null &&
        (typeof candidate.startedAfter !== 'number' ||
          !Number.isSafeInteger(candidate.startedAfter)))
    ) {
      throw new SessionDiscoveryError('invalid_cursor');
    }
    return candidate as WebSessionCursor;
  } catch (error) {
    if (error instanceof SessionDiscoveryError) throw error;
    throw new SessionDiscoveryError('invalid_cursor');
  }
}

function normalizedText(
  value: string | undefined,
  maxLength: number,
  code: SessionDiscoveryErrorCode,
): string | null {
  if (value === undefined) return null;
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new SessionDiscoveryError(code);
  return normalized || null;
}

function isWebSort(value: string): value is SessionDiscoverySort {
  return ['time', 'cost', 'tokens', 'cache', 'duration'].includes(value);
}

function isWebQuickView(value: string): value is SessionDiscoveryQuickView {
  return ['all', 'anomaly', 'unpriced'].includes(value);
}

function isWebTimeRange(value: string): value is SessionDiscoveryTimeRange {
  return ['all', '1d', '7d', '30d', '90d'].includes(value);
}

function timeRangeCutoff(range: SessionDiscoveryTimeRange, now: number): number | null {
  if (range === 'all') return null;
  return now - Number.parseInt(range, 10) * 86_400_000;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
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
