import type { Pricing } from '@agent-profile/core';
import { calcCost } from '@agent-profile/core';
import type { FastifyInstance } from 'fastify';
import { db, getPricing } from '../db';

interface PricingBody {
  model: string;
  inputPrice: number;
  cacheCreationPrice: number;
  cacheReadPrice: number;
  outputPrice: number;
  effectiveFrom?: number;
}

interface ModelContextBody {
  model: string;
  contextWindow: number;
}

export function registerPricingRoutes(app: FastifyInstance) {
  app.get('/api/pricing', async () => {
    return db
      .prepare(
        `SELECT model, input_price as inputPrice, cache_creation_price as cacheCreationPrice,
      cache_read_price as cacheReadPrice, output_price as outputPrice, effective_from as effectiveFrom
      FROM pricing ORDER BY model`,
      )
      .all() as Pricing[];
  });

  app.put<{ Body: PricingBody }>('/api/pricing', async (req) => {
    const b = req.body;
    db.prepare(
      `INSERT INTO pricing (model, input_price, cache_creation_price, cache_read_price, output_price, effective_from)
      VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      b.model,
      b.inputPrice,
      b.cacheCreationPrice,
      b.cacheReadPrice,
      b.outputPrice,
      b.effectiveFrom ?? null,
    );
    return { ok: true };
  });

  app.get('/api/model-context', async () => {
    return db
      .prepare(`SELECT model, context_window as contextWindow FROM model_context ORDER BY model`)
      .all();
  });

  app.put<{ Body: ModelContextBody }>('/api/model-context', async (req) => {
    const b = req.body;
    db.prepare(
      `INSERT INTO model_context (model, context_window) VALUES (?, ?)
      ON CONFLICT(model) DO UPDATE SET context_window = excluded.context_window`,
    ).run(b.model, b.contextWindow);
    return { ok: true };
  });

  // 用当前 pricing 重算所有 session 的 cost（定价变更后使用）
  app.post('/api/recompute-cost', async () => {
    const spans = db.prepare(`SELECT id, session_id as sessionId, type, model, input_tokens as inputTokens, cache_creation_tokens as cacheCreationTokens, cache_read_tokens as cacheReadTokens, output_tokens as outputTokens FROM spans WHERE type = 'llm_turn'`).all() as {
      id: string; sessionId: string; type: string; model?: string;
      inputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; outputTokens: number;
    }[];

    let updatedSpans = 0;
    const sessionCosts = new Map<string, { cost: number; unknown: number }>();

    const updateSpan = db.prepare('UPDATE spans SET cost = ?, cost_unknown = ? WHERE id = ?');
    const updateSession = db.prepare('UPDATE sessions SET total_cost = ?, cost_unknown_count = ? WHERE id = ?');

    const run = db.transaction(() => {
      for (const s of spans) {
        const pricing = getPricing(s.model);
        const { cost, unknown } = calcCost({
          id: s.id, sessionId: s.sessionId, type: 'llm_turn', name: '',
          startTime: 0, inputTokens: s.inputTokens, cacheCreationTokens: s.cacheCreationTokens,
          cacheReadTokens: s.cacheReadTokens, outputTokens: s.outputTokens,
          contextTokens: 0, outputBytes: 0, cost: 0, costUnknown: false,
          isError: false, isSidechain: false,
        }, pricing);
        updateSpan.run(cost, unknown ? 1 : 0, s.id);
        const acc = sessionCosts.get(s.sessionId) || { cost: 0, unknown: 0 };
        acc.cost += cost;
        if (unknown) acc.unknown++;
        sessionCosts.set(s.sessionId, acc);
        updatedSpans++;
      }
      for (const [sid, acc] of sessionCosts) {
        updateSession.run(acc.cost, acc.unknown, sid);
      }
    });

    run();
    return { ok: true, updatedSpans, updatedSessions: sessionCosts.size };
  });
}
