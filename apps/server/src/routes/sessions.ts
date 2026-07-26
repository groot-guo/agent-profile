import { analyzeCostAttribution, analyzeEfficiency, calcEfficiencyScore, diagnoseSessionSync, type SessionDetail, type SessionSummary } from '@agent-profile/core';
import type { FastifyInstance } from 'fastify';
import { db, getModelContext, getPricing } from '../db';
import { parseSpanRow, SESSION_COLS, SPAN_COLS } from './shared';

export function registerSessionRoutes(app: FastifyInstance) {
  app.get('/api/sessions', async () => {
    return db
      .prepare(`SELECT ${SESSION_COLS} FROM sessions ORDER BY start_time DESC`)
      .all() as SessionSummary[];
  });

  app.get<{ Params: { id: string } }>('/api/session/:id', async (req, reply) => {
    const session = db
      .prepare(`SELECT ${SESSION_COLS} FROM sessions WHERE id = ?`)
      .get(req.params.id) as SessionSummary | undefined;
    if (!session) return reply.status(404).send({ error: 'session not found' });
    const spans = db
      .prepare(`SELECT ${SPAN_COLS} FROM spans WHERE session_id = ? ORDER BY start_time ASC`)
      .all(req.params.id) as Record<string, unknown>[];
    return { ...session, spans: spans.map(parseSpanRow) } as SessionDetail;
  });

  // 每轮 LLM 调用明细
  app.get<{ Params: { id: string } }>('/api/session/:id/turns', async (req) => {
    const rows = db
      .prepare(
        `SELECT ${SPAN_COLS} FROM spans WHERE session_id = ? AND type = 'llm_turn' ORDER BY start_time ASC`,
      )
      .all(req.params.id) as Record<string, unknown>[];
    return rows.map(parseSpanRow);
  });

  // 每次工具调用明细
  app.get<{ Params: { id: string } }>('/api/session/:id/tools', async (req) => {
    const rows = db
      .prepare(
        `SELECT ${SPAN_COLS} FROM spans WHERE session_id = ? AND type = 'tool_call' ORDER BY start_time ASC`,
      )
      .all(req.params.id) as Record<string, unknown>[];
    return rows.map(parseSpanRow);
  });

  // 上下文增长曲线
  app.get<{ Params: { id: string } }>('/api/session/:id/context', async (req) => {
    const rows = db
      .prepare(
        `SELECT start_time as startTime, context_tokens as contextTokens,
              input_tokens as inputTokens, cache_creation_tokens as cacheCreationTokens,
              cache_read_tokens as cacheReadTokens, model
       FROM spans WHERE session_id = ? AND type = 'llm_turn' ORDER BY start_time ASC`,
      )
      .all(req.params.id) as {
      startTime: number;
      contextTokens: number;
      inputTokens: number;
      cacheCreationTokens: number;
      cacheReadTokens: number;
      model?: string;
    }[];
    return rows.map((r) => ({ ...r, contextWindow: getModelContext(r.model) ?? null }));
  });

  // 效率指标
  app.get<{ Params: { id: string } }>('/api/session/:id/efficiency', async (req, reply) => {
    const session = db
      .prepare(`SELECT id FROM sessions WHERE id = ?`)
      .get(req.params.id) as { id: string } | undefined;
    if (!session) return reply.status(404).send({ error: 'session not found' });
    const rows = db
      .prepare(`SELECT ${SPAN_COLS} FROM spans WHERE session_id = ? ORDER BY start_time ASC`)
      .all(req.params.id) as Record<string, unknown>[];
    const spans = rows.map(parseSpanRow);
    return analyzeEfficiency(spans);
  });

  // 成本归因
  app.get<{ Params: { id: string } }>('/api/session/:id/cost-attribution', async (req, reply) => {
    const session = db
      .prepare(`SELECT ${SESSION_COLS} FROM sessions WHERE id = ?`)
      .get(req.params.id) as SessionSummary | undefined;
    if (!session) return reply.status(404).send({ error: 'session not found' });
    const rows = db
      .prepare(`SELECT ${SPAN_COLS} FROM spans WHERE session_id = ? ORDER BY start_time ASC`)
      .all(req.params.id) as Record<string, unknown>[];
    const spans = rows.map(parseSpanRow);
    const detail = { ...session, spans } as SessionDetail;
    const diag = diagnoseSessionSync(detail, { pricingLookup: getPricing, contextWindowLookup: getModelContext });
    return analyzeCostAttribution(spans, diag.totalWastedCost);
  });

  // 效率评分
  app.get<{ Params: { id: string } }>('/api/session/:id/score', async (req, reply) => {
    const session = db
      .prepare(`SELECT ${SESSION_COLS} FROM sessions WHERE id = ?`)
      .get(req.params.id) as SessionSummary | undefined;
    if (!session) return reply.status(404).send({ error: 'session not found' });
    const rows = db
      .prepare(`SELECT ${SPAN_COLS} FROM spans WHERE session_id = ? ORDER BY start_time ASC`)
      .all(req.params.id) as Record<string, unknown>[];
    const spans = rows.map(parseSpanRow);
    const eff = analyzeEfficiency(spans);
    const detail = { ...session, spans } as SessionDetail;
    const diag = diagnoseSessionSync(detail, { pricingLookup: getPricing, contextWindowLookup: getModelContext });
    const totalTokens = session.inputTokens + session.cacheCreationTokens + session.cacheReadTokens + session.outputTokens;
    const score = calcEfficiencyScore(eff, session.cacheHitRate, totalTokens, session.outputTokens, session.totalCost, diag.totalWastedCost);
    // Compute percentile among all sessions
    const allScores = db.prepare(`
      SELECT id, total_cost as totalCost, cache_hit_rate as cacheHitRate,
             input_tokens + cache_creation_tokens + cache_read_tokens + output_tokens as totalTokens,
             output_tokens as outputTokens
      FROM sessions
    `).all() as { id: string; totalCost: number; cacheHitRate: number; totalTokens: number; outputTokens: number }[];
    // Quick percentile: count how many sessions have lower cache hit rate as proxy
    const betterCount = allScores.filter((s) => s.cacheHitRate > session.cacheHitRate).length;
    score.percentile = allScores.length > 1 ? Math.round((1 - betterCount / allScores.length) * 100) : undefined;
    return score;
  });
}
