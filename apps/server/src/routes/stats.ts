import {
  HOME_STATISTICS_SCHEMA_VERSION,
  type HomeSessionHighlight,
  type HomeStatisticsResponse,
} from '@agent-profile/contracts';
import { classifySessionProject, identifyModel, type ModelIdentityKind } from '@agent-profile/core';
import type { FastifyInstance } from 'fastify';
import type { DatabaseConnection } from '../database';
import { primarySessionPredicate } from '../primary-sessions';
import type { AppRuntime } from '../runtime';

type StatsRuntime = Pick<AppRuntime, 'database'>;

interface StatsOverview {
  totalSessions: number;
  totalTokens: number;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  avgCacheHitRate: number;
  avgPeakContext: number;
  sessionsWithCostUnknown: number;
}

interface AgentStats {
  agent: string;
  sessions: number;
  totalTokens: number;
  totalCost: number;
  avgCacheHitRate: number;
}

interface ProjectStats {
  cwd: string;
  sessions: number;
  totalTokens: number;
  totalCost: number;
}

interface ModelStats {
  model: string;
  kind: ModelIdentityKind;
  rawModels: string[];
  sessions: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
}

interface ToolFrequency {
  name: string;
  count: number;
  errors: number;
}

interface DistributionData {
  costBins: { bin: string; min: number; max: number | null; count: number }[];
  tokenBins: { bin: string; min: number; max: number | null; count: number }[];
  modelDistribution: {
    model: string;
    kind: ModelIdentityKind;
    rawModels: string[];
    count: number;
    tokens: number;
  }[];
  agentDistribution: { agent: string; count: number; tokens: number }[];
}

export interface StatsReport {
  overview: StatsOverview;
  byAgent: AgentStats[];
  byProject: ProjectStats[];
  byModel: ModelStats[];
  recentTools: ToolFrequency[];
  distribution: DistributionData;
  baseline?: {
    projects: ReturnType<typeof buildProjectStats>['baselineProjects'];
    anomalySessions: string[];
  };
  trends?: { day: string; tokens: number; cost: number; sessions: number; avgCacheHit: number }[];
}

type StatsQueryConnection = Pick<DatabaseConnection, 'prepare'>;

const HOME_PROJECT_EXPRESSION =
  "COALESCE(NULLIF(TRIM(s.project_key), ''), 'agent-profile:session-records:unknown')";

const SESSION_TOKEN_SQL =
  '(COALESCE(s.input_tokens, 0) + COALESCE(s.cache_creation_tokens, 0) + COALESCE(s.cache_read_tokens, 0) + COALESCE(s.output_tokens, 0))';

const HOME_SESSION_HIGHLIGHT_COLUMNS = `
  s.id,
  s.agent,
  ${HOME_PROJECT_EXPRESSION} AS project,
  s.start_time AS startTime,
  s.end_time AS endTime,
  COALESCE(s.input_tokens, 0) AS inputTokens,
  COALESCE(s.cache_creation_tokens, 0) AS cacheCreationTokens,
  COALESCE(s.cache_read_tokens, 0) AS cacheReadTokens,
  COALESCE(s.output_tokens, 0) AS outputTokens,
  COALESCE(s.total_cost, 0) AS totalCost,
  COALESCE(s.cost_unknown_count, 0) AS costUnknownCount`;

export function loadDashboardSpanAggregates(database: StatsQueryConnection) {
  const modelRows = database
    .prepare(
      `SELECT COALESCE(spans.model, 'unknown') as model,
        COUNT(DISTINCT spans.session_id) as count,
        SUM(spans.input_tokens + spans.cache_creation_tokens + spans.cache_read_tokens) as inputTokens,
        SUM(spans.output_tokens) as outputTokens,
        SUM(spans.cost) as cost
       FROM spans
       INNER JOIN sessions ON sessions.id = spans.session_id
       WHERE spans.type = 'llm_turn'
         AND ${primarySessionPredicate()}
       GROUP BY COALESCE(spans.model, 'unknown')`,
    )
    .all() as {
    model: string;
    count: number;
    inputTokens: number;
    outputTokens: number;
    cost: number;
  }[];
  const recentTools = database
    .prepare(
      `WITH recent_sessions AS (
        SELECT sessions.id
        FROM sessions
        WHERE ${primarySessionPredicate()}
        ORDER BY start_time DESC
        LIMIT 30
       )
       SELECT spans.name as name, COUNT(*) as count,
         SUM(CASE WHEN spans.is_error = 1 THEN 1 ELSE 0 END) as errors
       FROM spans
       INNER JOIN recent_sessions ON recent_sessions.id = spans.session_id
       WHERE spans.type = 'tool_call'
       GROUP BY spans.name
       ORDER BY count DESC, spans.name ASC
       LIMIT 15`,
    )
    .all() as ToolFrequency[];
  const modelMap = new Map<
    string,
    (typeof modelRows)[number] & { model: string; kind: ModelIdentityKind; rawModels: string[] }
  >();
  for (const row of modelRows) {
    const identity = identifyModel(row.model);
    const existing = modelMap.get(identity.key);
    if (existing) {
      existing.count += row.count;
      existing.inputTokens += row.inputTokens;
      existing.outputTokens += row.outputTokens;
      existing.cost += row.cost;
      if (!existing.rawModels.includes(row.model)) existing.rawModels.push(row.model);
    } else {
      modelMap.set(identity.key, {
        ...row,
        model: identity.label,
        kind: identity.kind,
        rawModels: [row.model],
      });
    }
  }
  return {
    modelMap,
    recentTools,
  };
}

export function buildModelViews(
  modelMap: ReturnType<typeof loadDashboardSpanAggregates>['modelMap'],
): {
  byModel: ModelStats[];
  modelDistribution: DistributionData['modelDistribution'];
} {
  const byModel: ModelStats[] = [...modelMap.values()]
    .map((entry) => ({
      model: entry.model,
      kind: entry.kind,
      rawModels: entry.rawModels,
      sessions: entry.count,
      totalInputTokens: entry.inputTokens,
      totalOutputTokens: entry.outputTokens,
      totalCost: entry.cost,
    }))
    .sort((left, right) => right.sessions - left.sessions);
  const modelDistribution = [...modelMap.values()]
    .map((entry) => ({
      model: entry.model,
      kind: entry.kind,
      rawModels: entry.rawModels,
      count: entry.count,
      tokens: entry.inputTokens + entry.outputTokens,
    }))
    .sort((left, right) => right.count - left.count);
  return { byModel, modelDistribution };
}

export function buildProjectStats(sessions: Record<string, unknown>[]) {
  const projectMap = new Map<
    string,
    {
      sessions: number;
      tokens: number;
      cost: number;
      costs: number[];
      cacheHits: number[];
    }
  >();

  for (const session of sessions) {
    const project = projectForStats(session);
    const entry = projectMap.get(project) ?? {
      sessions: 0,
      tokens: 0,
      cost: 0,
      costs: [],
      cacheHits: [],
    };
    const tokens = sessionTokens(session);
    const cost = (session.totalCost as number) || 0;
    entry.sessions++;
    entry.tokens += tokens;
    entry.cost += cost;
    entry.costs.push(cost);
    entry.cacheHits.push((session.cacheHitRate as number) || 0);
    projectMap.set(project, entry);
  }

  const byProject: ProjectStats[] = [...projectMap.entries()]
    .map(([cwd, entry]) => ({
      cwd,
      sessions: entry.sessions,
      totalTokens: entry.tokens,
      totalCost: entry.cost,
    }))
    .sort((a, b) => b.sessions - a.sessions || a.cwd.localeCompare(b.cwd));

  const baselineProjects: Record<
    string,
    {
      sessions: number;
      avgCost: number;
      medCost: number;
      p95Cost: number;
      avgTokens: number;
      avgCacheHit: number;
    }
  > = {};
  for (const [project, entry] of projectMap) {
    baselineProjects[project] = {
      sessions: entry.sessions,
      avgCost: entry.cost / entry.sessions,
      medCost: percentile(entry.costs, 0.5),
      p95Cost: percentile(entry.costs, 0.95),
      avgTokens: Math.round(entry.tokens / entry.sessions),
      avgCacheHit: entry.cacheHits.reduce((total, value) => total + value, 0) / entry.sessions,
    };
  }

  const anomalySessions: string[] = [];
  for (const session of sessions) {
    const baseline = baselineProjects[projectForStats(session)];
    const cost = (session.totalCost as number) || 0;
    if (baseline?.sessions >= 3 && baseline.medCost > 0.001 && cost > baseline.medCost * 3) {
      anomalySessions.push(session.id as string);
    }
  }

  return { byProject, baselineProjects, anomalySessions };
}

export function buildHomeStatistics(database: DatabaseConnection): HomeStatisticsResponse {
  const overview = database
    .prepare(
      `SELECT
        COUNT(*) AS totalSessions,
        COALESCE(SUM(
          COALESCE(s.input_tokens, 0) + COALESCE(s.cache_creation_tokens, 0) +
          COALESCE(s.cache_read_tokens, 0) + COALESCE(s.output_tokens, 0)
        ), 0) AS totalTokens,
        COALESCE(SUM(s.total_cost), 0) AS totalCost,
        COALESCE(SUM(s.input_tokens), 0) AS totalInputTokens,
        COALESCE(SUM(s.output_tokens), 0) AS totalOutputTokens,
        COALESCE(AVG(COALESCE(s.cache_hit_rate, 0)), 0) AS avgCacheHitRate,
        CAST(ROUND(COALESCE(AVG(COALESCE(s.peak_context_tokens, 0)), 0)) AS INTEGER)
          AS avgPeakContext,
        COALESCE(SUM(CASE WHEN s.cost_unknown_count > 0 THEN 1 ELSE 0 END), 0)
          AS sessionsWithCostUnknown
       FROM sessions s
       WHERE ${primarySessionPredicate('s')}`,
    )
    .get() as HomeStatisticsResponse['overview'];
  const recentTools = database
    .prepare(
      `WITH recent_sessions AS (
        SELECT s.id
        FROM sessions s
        WHERE ${primarySessionPredicate('s')}
        ORDER BY s.start_time DESC, s.id DESC
        LIMIT 30
       )
       SELECT spans.name, COUNT(*) AS count,
         SUM(CASE WHEN spans.is_error = 1 THEN 1 ELSE 0 END) AS errors
       FROM spans
       INNER JOIN recent_sessions ON recent_sessions.id = spans.session_id
       WHERE spans.type = 'tool_call'
       GROUP BY spans.name
       ORDER BY count DESC, spans.name ASC
       LIMIT 15`,
    )
    .all() as HomeStatisticsResponse['recentTools'];

  return {
    schemaVersion: HOME_STATISTICS_SCHEMA_VERSION,
    overview,
    recentTools,
    topByCost: loadHomeHighlights(database, 'COALESCE(s.total_cost, 0)'),
    topByTokens: loadHomeHighlights(
      database,
      '(COALESCE(s.input_tokens, 0) + COALESCE(s.cache_creation_tokens, 0) + COALESCE(s.cache_read_tokens, 0) + COALESCE(s.output_tokens, 0))',
    ),
  };
}

function loadHomeHighlights(
  database: DatabaseConnection,
  orderExpression: string,
): HomeSessionHighlight[] {
  return database
    .prepare(
      `SELECT ${HOME_SESSION_HIGHLIGHT_COLUMNS}
       FROM sessions s
       WHERE ${primarySessionPredicate('s')}
       ORDER BY ${orderExpression} DESC, s.id DESC
       LIMIT 10`,
    )
    .all() as HomeSessionHighlight[];
}

function projectForStats(session: Record<string, unknown>): string {
  return classifySessionProject({
    agent: typeof session.agent === 'string' ? session.agent : undefined,
    cwd: typeof session.cwd === 'string' ? session.cwd : undefined,
    filePath: typeof session.filePath === 'string' ? session.filePath : undefined,
  });
}

function sessionTokens(session: Record<string, unknown>): number {
  return (
    ((session.inputTokens as number) || 0) +
    ((session.cacheCreationTokens as number) || 0) +
    ((session.cacheReadTokens as number) || 0) +
    ((session.outputTokens as number) || 0)
  );
}

function percentile(values: number[], quantile: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * quantile)] || 0;
}

export function buildStatsReport(database: DatabaseConnection): StatsReport {
  const overview = loadStatsOverview(database);
  if (overview.totalSessions === 0) {
    return {
      overview,
      byAgent: [],
      byProject: [],
      byModel: [],
      recentTools: [],
      distribution: { costBins: [], tokenBins: [], modelDistribution: [], agentDistribution: [] },
    };
  }

  const byAgent = loadAgentStats(database);
  const { byProject, baselineProjects, anomalySessions } = loadProjectStatistics(database);
  const { modelMap, recentTools } = loadDashboardSpanAggregates(database);
  const { byModel, modelDistribution } = buildModelViews(modelMap);
  const { costBins, tokenBins } = loadDistributionBins(database);
  const trends = loadTrends(database);

  return {
    overview,
    byAgent,
    byProject,
    byModel,
    recentTools,
    distribution: {
      costBins,
      tokenBins,
      modelDistribution,
      agentDistribution: byAgent.map((entry) => ({
        agent: entry.agent,
        count: entry.sessions,
        tokens: entry.totalTokens,
      })),
    },
    baseline: { projects: baselineProjects, anomalySessions },
    trends,
  };
}

function loadStatsOverview(database: DatabaseConnection): StatsOverview {
  return database
    .prepare(
      `SELECT
        COUNT(*) AS totalSessions,
        COALESCE(SUM(${SESSION_TOKEN_SQL}), 0) AS totalTokens,
        COALESCE(SUM(s.total_cost), 0) AS totalCost,
        COALESCE(SUM(s.input_tokens), 0) AS totalInputTokens,
        COALESCE(SUM(s.output_tokens), 0) AS totalOutputTokens,
        COALESCE(AVG(COALESCE(s.cache_hit_rate, 0)), 0) AS avgCacheHitRate,
        CAST(ROUND(COALESCE(AVG(COALESCE(s.peak_context_tokens, 0)), 0)) AS INTEGER)
          AS avgPeakContext,
        COALESCE(SUM(CASE WHEN COALESCE(s.cost_unknown_count, 0) > 0 THEN 1 ELSE 0 END), 0)
          AS sessionsWithCostUnknown
       FROM sessions s
       WHERE ${primarySessionPredicate('s')}`,
    )
    .get() as StatsOverview;
}

function loadAgentStats(database: DatabaseConnection): AgentStats[] {
  return database
    .prepare(
      `SELECT
        COALESCE(NULLIF(s.agent, ''), 'unknown') AS agent,
        COUNT(*) AS sessions,
        COALESCE(SUM(${SESSION_TOKEN_SQL}), 0) AS totalTokens,
        COALESCE(SUM(s.total_cost), 0) AS totalCost,
        COALESCE(AVG(COALESCE(s.cache_hit_rate, 0)), 0) AS avgCacheHitRate
       FROM sessions s
       WHERE ${primarySessionPredicate('s')}
       GROUP BY COALESCE(NULLIF(s.agent, ''), 'unknown')
       ORDER BY sessions DESC, agent ASC`,
    )
    .all() as AgentStats[];
}

function loadProjectStatistics(database: DatabaseConnection): {
  byProject: ProjectStats[];
  baselineProjects: ReturnType<typeof buildProjectStats>['baselineProjects'];
  anomalySessions: string[];
} {
  const rows = database
    .prepare(
      `WITH primary_rows AS (
        SELECT
          s.id,
          ${HOME_PROJECT_EXPRESSION} AS project,
          ${SESSION_TOKEN_SQL} AS tokens,
          COALESCE(s.total_cost, 0) AS cost,
          COALESCE(s.cache_hit_rate, 0) AS cache_hit_rate
        FROM sessions s
        WHERE ${primarySessionPredicate('s')}
       ), ranked AS (
        SELECT
          primary_rows.*,
          ROW_NUMBER() OVER (PARTITION BY project ORDER BY cost, id) AS cost_position,
          COUNT(*) OVER (PARTITION BY project) AS project_sessions
        FROM primary_rows
       )
       SELECT
         project,
         MAX(project_sessions) AS sessions,
         SUM(tokens) AS totalTokens,
         SUM(cost) AS totalCost,
         AVG(cost) AS avgCost,
         MAX(CASE
           WHEN cost_position = CAST(project_sessions * 0.5 AS INTEGER) + 1 THEN cost
           ELSE NULL
         END) AS medCost,
         MAX(CASE
           WHEN cost_position = CAST(project_sessions * 0.95 AS INTEGER) + 1 THEN cost
           ELSE NULL
         END) AS p95Cost,
         CAST(ROUND(AVG(tokens)) AS INTEGER) AS avgTokens,
         AVG(cache_hit_rate) AS avgCacheHit
       FROM ranked
       GROUP BY project
       ORDER BY sessions DESC, project ASC`,
    )
    .all() as Array<{
    project: string;
    sessions: number;
    totalTokens: number;
    totalCost: number;
    avgCost: number;
    medCost: number;
    p95Cost: number;
    avgTokens: number;
    avgCacheHit: number;
  }>;
  const baselineProjects: ReturnType<typeof buildProjectStats>['baselineProjects'] = {};
  for (const row of rows) {
    baselineProjects[row.project] = {
      sessions: row.sessions,
      avgCost: row.avgCost,
      medCost: row.medCost,
      p95Cost: row.p95Cost,
      avgTokens: row.avgTokens,
      avgCacheHit: row.avgCacheHit,
    };
  }
  const anomalySessions = database
    .prepare(
      `WITH primary_rows AS (
        SELECT
          s.id,
          s.start_time,
          ${HOME_PROJECT_EXPRESSION} AS project,
          COALESCE(s.total_cost, 0) AS cost
        FROM sessions s
        WHERE ${primarySessionPredicate('s')}
       ), ranked AS (
        SELECT
          primary_rows.*,
          ROW_NUMBER() OVER (PARTITION BY project ORDER BY cost, id) AS cost_position,
          COUNT(*) OVER (PARTITION BY project) AS project_sessions
        FROM primary_rows
       ), baselines AS (
        SELECT
          project,
          MAX(project_sessions) AS sessions,
          MAX(CASE
            WHEN cost_position = CAST(project_sessions * 0.5 AS INTEGER) + 1 THEN cost
            ELSE NULL
          END) AS median_cost
        FROM ranked
        GROUP BY project
       )
       SELECT ranked.id
       FROM ranked
       INNER JOIN baselines ON baselines.project = ranked.project
       WHERE baselines.sessions >= 3
         AND baselines.median_cost > 0.001
         AND ranked.cost > baselines.median_cost * 3
       ORDER BY ranked.start_time DESC, ranked.id DESC`,
    )
    .all() as Array<{ id: string }>;
  return {
    byProject: rows.map((row) => ({
      cwd: row.project,
      sessions: row.sessions,
      totalTokens: row.totalTokens,
      totalCost: row.totalCost,
    })),
    baselineProjects,
    anomalySessions: anomalySessions.map((row) => row.id),
  };
}

function loadDistributionBins(database: DatabaseConnection): {
  costBins: DistributionData['costBins'];
  tokenBins: DistributionData['tokenBins'];
} {
  const row = database
    .prepare(
      `SELECT
        SUM(CASE WHEN COALESCE(s.total_cost, 0) >= 0 AND COALESCE(s.total_cost, 0) < 0.001 THEN 1 ELSE 0 END) AS cost0,
        SUM(CASE WHEN COALESCE(s.total_cost, 0) >= 0.001 AND COALESCE(s.total_cost, 0) < 0.01 THEN 1 ELSE 0 END) AS cost1,
        SUM(CASE WHEN COALESCE(s.total_cost, 0) >= 0.01 AND COALESCE(s.total_cost, 0) < 0.1 THEN 1 ELSE 0 END) AS cost2,
        SUM(CASE WHEN COALESCE(s.total_cost, 0) >= 0.1 AND COALESCE(s.total_cost, 0) < 1 THEN 1 ELSE 0 END) AS cost3,
        SUM(CASE WHEN COALESCE(s.total_cost, 0) >= 1 AND COALESCE(s.total_cost, 0) < 5 THEN 1 ELSE 0 END) AS cost4,
        SUM(CASE WHEN COALESCE(s.total_cost, 0) >= 5 THEN 1 ELSE 0 END) AS cost5,
        SUM(CASE WHEN ${SESSION_TOKEN_SQL} >= 0 AND ${SESSION_TOKEN_SQL} < 1000 THEN 1 ELSE 0 END) AS token0,
        SUM(CASE WHEN ${SESSION_TOKEN_SQL} >= 1000 AND ${SESSION_TOKEN_SQL} < 10000 THEN 1 ELSE 0 END) AS token1,
        SUM(CASE WHEN ${SESSION_TOKEN_SQL} >= 10000 AND ${SESSION_TOKEN_SQL} < 100000 THEN 1 ELSE 0 END) AS token2,
        SUM(CASE WHEN ${SESSION_TOKEN_SQL} >= 100000 AND ${SESSION_TOKEN_SQL} < 500000 THEN 1 ELSE 0 END) AS token3,
        SUM(CASE WHEN ${SESSION_TOKEN_SQL} >= 500000 AND ${SESSION_TOKEN_SQL} < 1000000 THEN 1 ELSE 0 END) AS token4,
        SUM(CASE WHEN ${SESSION_TOKEN_SQL} >= 1000000 THEN 1 ELSE 0 END) AS token5
       FROM sessions s
       WHERE ${primarySessionPredicate('s')}`,
    )
    .get() as Record<string, number>;
  return {
    costBins: [
      { bin: '¥0', min: 0, max: 0.001, count: row.cost0 },
      { bin: '¥0-0.01', min: 0.001, max: 0.01, count: row.cost1 },
      { bin: '¥0.01-0.1', min: 0.01, max: 0.1, count: row.cost2 },
      { bin: '¥0.1-1', min: 0.1, max: 1, count: row.cost3 },
      { bin: '¥1-5', min: 1, max: 5, count: row.cost4 },
      { bin: '¥5+', min: 5, max: null, count: row.cost5 },
    ],
    tokenBins: [
      { bin: '<1k', min: 0, max: 1_000, count: row.token0 },
      { bin: '1k-10k', min: 1_000, max: 10_000, count: row.token1 },
      { bin: '10k-100k', min: 10_000, max: 100_000, count: row.token2 },
      { bin: '100k-500k', min: 100_000, max: 500_000, count: row.token3 },
      { bin: '500k-1M', min: 500_000, max: 1_000_000, count: row.token4 },
      { bin: '1M+', min: 1_000_000, max: null, count: row.token5 },
    ],
  };
}

function loadTrends(database: DatabaseConnection): NonNullable<StatsReport['trends']> {
  return database
    .prepare(
      `SELECT
        strftime('%Y-%m-%d', s.start_time / 1000, 'unixepoch') AS day,
        SUM(${SESSION_TOKEN_SQL}) AS tokens,
        SUM(COALESCE(s.total_cost, 0)) AS cost,
        COUNT(*) AS sessions,
        AVG(COALESCE(s.cache_hit_rate, 0)) AS avgCacheHit
       FROM sessions s
       WHERE ${primarySessionPredicate('s')}
       GROUP BY strftime('%Y-%m-%d', s.start_time / 1000, 'unixepoch')
       ORDER BY day ASC`,
    )
    .all() as NonNullable<StatsReport['trends']>;
}
export function registerStatsRoutes(app: FastifyInstance, runtime: StatsRuntime): void {
  app.get('/api/stats', async () => buildStatsReport(runtime.database));
  app.get('/api/home-statistics', async () => buildHomeStatistics(runtime.database));
}
