import type { FastifyInstance } from 'fastify';
import { db, getModelContext } from '../db';
import { SESSION_COLS } from './shared';

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
  sessions: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
}

interface DistributionData {
  costBins: { bin: string; min: number; max: number | null; count: number }[];
  tokenBins: { bin: string; min: number; max: number | null; count: number }[];
  modelDistribution: { model: string; count: number; tokens: number }[];
  agentDistribution: { agent: string; count: number; tokens: number }[];
}

function extractModel(sessions: { id: string }[]): Map<string, { count: number; tokens: number; cost: number }> {
  const models = new Map<string, { count: number; tokens: number; cost: number }>();
  for (const s of sessions) {
    const rows = db
      .prepare(`SELECT model, input_tokens + cache_creation_tokens + cache_read_tokens + output_tokens as tokens, cost FROM spans WHERE session_id = ? AND type = 'llm_turn'`)
      .all(s.id) as { model?: string; tokens: number; cost: number }[];
    for (const r of rows) {
      const m = r.model || 'unknown';
      const entry = models.get(m);
      if (entry) { entry.count++; entry.tokens += r.tokens; entry.cost += r.cost; }
      else models.set(m, { count: 1, tokens: r.tokens, cost: r.cost });
    }
  }
  return models;
}

function buildLogBins(values: number[], config: { label: string; thresholds: number[] }[]): { bin: string; min: number; max: number | null; count: number }[] {
  const bins = config.map((c) => ({ bin: c.label, min: c.thresholds[0], max: c.thresholds[1] ?? null, count: 0 }));
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

export function registerStatsRoutes(app: FastifyInstance) {
  app.get('/api/stats', async () => {
    const sessions = db
      .prepare(`SELECT ${SESSION_COLS} FROM sessions ORDER BY start_time DESC`)
      .all() as Record<string, unknown>[];

    if (sessions.length === 0) {
      return {
        overview: { totalSessions: 0, totalTokens: 0, totalCost: 0, totalInputTokens: 0, totalOutputTokens: 0, avgCacheHitRate: 0, avgPeakContext: 0, sessionsWithCostUnknown: 0 },
        byAgent: [] as AgentStats[],
        byProject: [] as ProjectStats[],
        byModel: [] as ModelStats[],
        distribution: { costBins: [], tokenBins: [], modelDistribution: [], agentDistribution: [] },
      };
    }

    // Overview
    let totalTokens = 0, totalCost = 0, totalInput = 0, totalOutput = 0, sumCacheHit = 0, sumPeak = 0, unknownCost = 0;
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
    const agentMap = new Map<string, { sessions: number; tokens: number; cost: number; cacheHit: number }>();
    for (const s of sessions) {
      const a = (s.agent as string) || 'unknown';
      const entry = agentMap.get(a) || { sessions: 0, tokens: 0, cost: 0, cacheHit: 0 };
      entry.sessions++;
      entry.tokens += ((s.inputTokens as number) || 0) + ((s.cacheCreationTokens as number) || 0) + ((s.cacheReadTokens as number) || 0) + ((s.outputTokens as number) || 0);
      entry.cost += (s.totalCost as number) || 0;
      entry.cacheHit += (s.cacheHitRate as number) || 0;
      agentMap.set(a, entry);
    }
    const byAgent: AgentStats[] = [...agentMap.entries()].map(([agent, e]) => ({
      agent, sessions: e.sessions, totalTokens: e.tokens, totalCost: e.cost, avgCacheHitRate: e.cacheHit / e.sessions,
    })).sort((a, b) => b.sessions - a.sessions);

    // By project (cwd)，fallback 从 filePath 提取项目名
    const projMap = new Map<string, { sessions: number; tokens: number; cost: number }>();
    for (const s of sessions) {
      const cwd = (s.cwd as string) || extractProjectFromPath(s.filePath as string) || 'unknown';
      const entry = projMap.get(cwd) || { sessions: 0, tokens: 0, cost: 0 };
      entry.sessions++;
      entry.tokens += ((s.inputTokens as number) || 0) + ((s.cacheCreationTokens as number) || 0) + ((s.cacheReadTokens as number) || 0) + ((s.outputTokens as number) || 0);
      entry.cost += (s.totalCost as number) || 0;
      projMap.set(cwd, entry);
    }
    const byProject: ProjectStats[] = [...projMap.entries()].map(([cwd, e]) => ({
      cwd, sessions: e.sessions, totalTokens: e.tokens, totalCost: e.cost,
    })).sort((a, b) => b.sessions - a.sessions);

    // By model (from spans)
    const modelMap = extractModel(sessions as { id: string }[]);
    const byModel: ModelStats[] = [...modelMap.entries()].map(([model, e]) => ({
      model, sessions: e.count, totalInputTokens: e.tokens, totalOutputTokens: 0, totalCost: e.cost,
    })).sort((a, b) => b.sessions - a.sessions);

    // Distributions
    const sessionTokens = sessions.map((s) =>
      ((s.inputTokens as number) || 0) + ((s.cacheCreationTokens as number) || 0) + ((s.cacheReadTokens as number) || 0) + ((s.outputTokens as number) || 0),
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

    const modelDist = [...modelMap.entries()].map(([model, e]) => ({
      model, count: e.count, tokens: e.tokens,
    })).sort((a, b) => b.count - a.count);

    const agentDist = [...agentMap.entries()].map(([agent, e]) => ({
      agent, count: e.sessions, tokens: e.tokens,
    }));

    const distribution: DistributionData = { costBins, tokenBins, modelDistribution: modelDist, agentDistribution: agentDist };

    return { overview, byAgent, byProject, byModel, distribution };
  });
}
