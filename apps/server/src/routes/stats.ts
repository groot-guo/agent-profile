import { classifySessionProject, identifyModel, type ModelIdentityKind } from '@agent-profile/core';
import type { FastifyInstance } from 'fastify';
import type { DatabaseConnection } from '../database';
import { primarySessionPredicate } from '../primary-sessions';
import type { AppRuntime } from '../runtime';
import { SESSION_COLS } from './shared';

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

type StatsQueryConnection = Pick<DatabaseConnection, 'prepare'>;

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

function buildLogBins(
  values: number[],
  config: { label: string; thresholds: [number, number | null] }[],
): { bin: string; min: number; max: number | null; count: number }[] {
  const bins = config.map((c) => ({
    bin: c.label,
    min: c.thresholds[0],
    max: c.thresholds[1] ?? null,
    count: 0,
  }));
  for (const v of values) {
    for (let i = 0; i < config.length; i++) {
      const c = config[i];
      if (v >= c.thresholds[0] && (c.thresholds[1] == null || v < c.thresholds[1])) {
        bins[i].count++;
        break;
      }
    }
  }
  return bins;
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

export function registerStatsRoutes(app: FastifyInstance, runtime: StatsRuntime) {
  const { database } = runtime;
  const db = database;
  app.get('/api/stats', async () => {
    const sessions = db
      .prepare(
        `SELECT ${SESSION_COLS}
         FROM sessions
         WHERE ${primarySessionPredicate()}
         ORDER BY start_time DESC`,
      )
      .all() as Record<string, unknown>[];

    if (sessions.length === 0) {
      return {
        overview: {
          totalSessions: 0,
          totalTokens: 0,
          totalCost: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          avgCacheHitRate: 0,
          avgPeakContext: 0,
          sessionsWithCostUnknown: 0,
        },
        byAgent: [] as AgentStats[],
        byProject: [] as ProjectStats[],
        byModel: [] as ModelStats[],
        recentTools: [] as ToolFrequency[],
        distribution: { costBins: [], tokenBins: [], modelDistribution: [], agentDistribution: [] },
      };
    }

    // Overview
    let totalTokens = 0,
      totalCost = 0,
      totalInput = 0,
      totalOutput = 0,
      sumCacheHit = 0,
      sumPeak = 0,
      unknownCost = 0;
    for (const s of sessions) {
      const input = (s.inputTokens as number) || 0;
      const cc = (s.cacheCreationTokens as number) || 0;
      const cr = (s.cacheReadTokens as number) || 0;
      const out = (s.outputTokens as number) || 0;
      totalInput += input;
      totalOutput += out;
      totalTokens += input + cc + cr + out;
      totalCost += (s.totalCost as number) || 0;
      sumCacheHit += (s.cacheHitRate as number) || 0;
      sumPeak += (s.peakContextTokens as number) || 0;
      if ((s.costUnknownCount as number) > 0) unknownCost++;
    }
    const overview: StatsOverview = {
      totalSessions: sessions.length,
      totalTokens,
      totalCost,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      avgCacheHitRate: sumCacheHit / sessions.length,
      avgPeakContext: Math.round(sumPeak / sessions.length),
      sessionsWithCostUnknown: unknownCost,
    };

    // By agent
    const agentMap = new Map<
      string,
      { sessions: number; tokens: number; cost: number; cacheHit: number }
    >();
    for (const s of sessions) {
      const a = (s.agent as string) || 'unknown';
      const entry = agentMap.get(a) || { sessions: 0, tokens: 0, cost: 0, cacheHit: 0 };
      entry.sessions++;
      entry.tokens +=
        ((s.inputTokens as number) || 0) +
        ((s.cacheCreationTokens as number) || 0) +
        ((s.cacheReadTokens as number) || 0) +
        ((s.outputTokens as number) || 0);
      entry.cost += (s.totalCost as number) || 0;
      entry.cacheHit += (s.cacheHitRate as number) || 0;
      agentMap.set(a, entry);
    }
    const byAgent: AgentStats[] = [...agentMap.entries()]
      .map(([agent, e]) => ({
        agent,
        sessions: e.sessions,
        totalTokens: e.tokens,
        totalCost: e.cost,
        avgCacheHitRate: e.cacheHit / e.sessions,
      }))
      .sort((a, b) => b.sessions - a.sessions);

    const { byProject, baselineProjects, anomalySessions } = buildProjectStats(sessions);

    // By model (from spans)
    const { modelMap, recentTools } = loadDashboardSpanAggregates(database);
    const { byModel, modelDistribution } = buildModelViews(modelMap);

    // Distributions
    const sessionTokens = sessions.map(
      (s) =>
        ((s.inputTokens as number) || 0) +
        ((s.cacheCreationTokens as number) || 0) +
        ((s.cacheReadTokens as number) || 0) +
        ((s.outputTokens as number) || 0),
    );
    const sessionCosts = sessions.map((s) => (s.totalCost as number) || 0);

    const costBins = buildLogBins(sessionCosts, [
      { label: '¥0', thresholds: [0, 0.001] },
      { label: '¥0-0.01', thresholds: [0.001, 0.01] },
      { label: '¥0.01-0.1', thresholds: [0.01, 0.1] },
      { label: '¥0.1-1', thresholds: [0.1, 1] },
      { label: '¥1-5', thresholds: [1, 5] },
      { label: '¥5+', thresholds: [5, null] },
    ]);

    const tokenBins = buildLogBins(sessionTokens, [
      { label: '<1k', thresholds: [0, 1_000] },
      { label: '1k-10k', thresholds: [1_000, 10_000] },
      { label: '10k-100k', thresholds: [10_000, 100_000] },
      { label: '100k-500k', thresholds: [100_000, 500_000] },
      { label: '500k-1M', thresholds: [500_000, 1_000_000] },
      { label: '1M+', thresholds: [1_000_000, null] },
    ]);

    const agentDist = [...agentMap.entries()].map(([agent, e]) => ({
      agent,
      count: e.sessions,
      tokens: e.tokens,
    }));

    const distribution: DistributionData = {
      costBins,
      tokenBins,
      modelDistribution,
      agentDistribution: agentDist,
    };

    // Time series trends: daily aggregation
    const dailyMap = new Map<
      string,
      { tokens: number; cost: number; sessions: number; cacheHit: number }
    >();
    for (const s of sessions) {
      const day = new Date(s.startTime as number).toISOString().slice(0, 10);
      const entry = dailyMap.get(day) || { tokens: 0, cost: 0, sessions: 0, cacheHit: 0 };
      entry.tokens +=
        ((s.inputTokens as number) || 0) +
        ((s.cacheCreationTokens as number) || 0) +
        ((s.cacheReadTokens as number) || 0) +
        ((s.outputTokens as number) || 0);
      entry.cost += (s.totalCost as number) || 0;
      entry.sessions++;
      entry.cacheHit += (s.cacheHitRate as number) || 0;
      dailyMap.set(day, entry);
    }
    const trends = [...dailyMap.entries()]
      .map(([day, e]) => ({
        day,
        tokens: e.tokens,
        cost: e.cost,
        sessions: e.sessions,
        avgCacheHit: e.sessions > 0 ? e.cacheHit / e.sessions : 0,
      }))
      .sort((a, b) => a.day.localeCompare(b.day));

    return {
      overview,
      byAgent,
      byProject,
      byModel,
      recentTools,
      distribution,
      baseline: { projects: baselineProjects, anomalySessions },
      trends,
    };
  });
}
