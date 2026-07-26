import type { Pricing, PricingCurrency, PricingUnit } from '@agent-profile/core';
import { COST_CALCULATOR_VERSION, COST_CURRENCY, COST_UNIT, calcCost } from '@agent-profile/core';
import type { FastifyInstance } from 'fastify';
import { db, getPricing } from '../db';

interface PricingBody {
  model: string;
  inputPrice: number;
  cacheCreationPrice: number;
  cacheReadPrice: number;
  outputPrice: number;
  currency?: PricingCurrency;
  unit?: PricingUnit;
  effectiveFrom?: number;
}

interface ModelContextBody {
  model: string;
  contextWindow: number;
}

const pricingBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['model', 'inputPrice', 'cacheCreationPrice', 'cacheReadPrice', 'outputPrice'],
  properties: {
    model: { type: 'string', minLength: 1 },
    inputPrice: { type: 'number', minimum: 0 },
    cacheCreationPrice: { type: 'number', minimum: 0 },
    cacheReadPrice: { type: 'number', minimum: 0 },
    outputPrice: { type: 'number', minimum: 0 },
    currency: { type: 'string', enum: [COST_CURRENCY] },
    unit: { type: 'string', enum: [COST_UNIT] },
    effectiveFrom: { type: 'integer', minimum: 0 },
  },
} as const;

const modelContextBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['model', 'contextWindow'],
  properties: {
    model: { type: 'string', minLength: 1 },
    contextWindow: { type: 'integer', minimum: 1 },
  },
} as const;

export function registerPricingRoutes(app: FastifyInstance) {
  app.get('/api/pricing', async () => {
    return db
      .prepare(
        `SELECT model, input_price as inputPrice, cache_creation_price as cacheCreationPrice,
      cache_read_price as cacheReadPrice, output_price as outputPrice, currency, unit,
      COALESCE(effective_from, 0) as effectiveFrom
      FROM pricing ORDER BY model`,
      )
      .all() as Pricing[];
  });

  app.put<{ Body: PricingBody }>(
    '/api/pricing',
    { schema: { body: pricingBodySchema } },
    async (req) => {
      const b = req.body;
      const effectiveFrom = b.effectiveFrom ?? Date.now();
      db.prepare(
        `INSERT INTO pricing (model, input_price, cache_creation_price, cache_read_price,
        output_price, currency, unit, effective_from)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(model, effective_from) DO UPDATE SET
        input_price = excluded.input_price,
        cache_creation_price = excluded.cache_creation_price,
        cache_read_price = excluded.cache_read_price,
        output_price = excluded.output_price,
        currency = excluded.currency,
        unit = excluded.unit`,
      ).run(
        b.model,
        b.inputPrice,
        b.cacheCreationPrice,
        b.cacheReadPrice,
        b.outputPrice,
        b.currency ?? COST_CURRENCY,
        b.unit ?? COST_UNIT,
        effectiveFrom,
      );
      return {
        ok: true,
        currency: b.currency ?? COST_CURRENCY,
        unit: b.unit ?? COST_UNIT,
        effectiveFrom,
      };
    },
  );

  app.get('/api/model-context', async () => {
    return db
      .prepare(`SELECT model, context_window as contextWindow FROM model_context ORDER BY model`)
      .all();
  });

  app.put<{ Body: ModelContextBody }>(
    '/api/model-context',
    { schema: { body: modelContextBodySchema } },
    async (req) => {
      const b = req.body;
      db.prepare(
        `INSERT INTO model_context (model, context_window) VALUES (?, ?)
      ON CONFLICT(model) DO UPDATE SET context_window = excluded.context_window`,
      ).run(b.model, b.contextWindow);
      return { ok: true };
    },
  );

  // 按每个 LLM span 的发生时间重新选择生效 pricing，并重建 session cost。
  app.post('/api/recompute-cost', async () => {
    const spans = db
      .prepare(`SELECT id, session_id as sessionId, type, model,
      start_time as startTime, input_tokens as inputTokens,
      cache_creation_tokens as cacheCreationTokens, cache_read_tokens as cacheReadTokens,
      output_tokens as outputTokens FROM spans WHERE type = 'llm_turn'`)
      .all() as {
      id: string;
      sessionId: string;
      type: string;
      model?: string;
      startTime: number;
      inputTokens: number;
      cacheCreationTokens: number;
      cacheReadTokens: number;
      outputTokens: number;
    }[];

    let updatedSpans = 0;
    const sessionCosts = new Map<string, { cost: number; unknown: number }>();
    const calculatedAt = Date.now();

    const updateSpan = db.prepare(`UPDATE spans SET cost = ?, cost_unknown = ?,
      cost_currency = ?, pricing_effective_from = ?, cost_calculated_at = ?,
      cost_calculator_version = ? WHERE id = ?`);
    const updateSession = db.prepare(`UPDATE sessions SET total_cost = ?, cost_unknown_count = ?,
      cost_currency = ?, cost_calculated_at = ?, cost_calculator_version = ? WHERE id = ?`);
    const resetSessions = db.prepare(`UPDATE sessions SET total_cost = 0, cost_unknown_count = 0,
      cost_currency = ?, cost_calculated_at = ?, cost_calculator_version = ?`);

    const run = db.transaction(() => {
      resetSessions.run(COST_CURRENCY, calculatedAt, COST_CALCULATOR_VERSION);
      for (const s of spans) {
        const pricing = getPricing(s.model, s.startTime);
        const { cost, unknown } = calcCost(
          {
            id: s.id,
            sessionId: s.sessionId,
            type: 'llm_turn',
            name: '',
            startTime: s.startTime,
            inputTokens: s.inputTokens,
            cacheCreationTokens: s.cacheCreationTokens,
            cacheReadTokens: s.cacheReadTokens,
            outputTokens: s.outputTokens,
            contextTokens: 0,
            outputBytes: 0,
            cost: 0,
            costUnknown: false,
            isError: false,
            isSidechain: false,
          },
          pricing,
        );
        updateSpan.run(
          cost,
          unknown ? 1 : 0,
          COST_CURRENCY,
          pricing?.effectiveFrom ?? 0,
          calculatedAt,
          COST_CALCULATOR_VERSION,
          s.id,
        );
        const acc = sessionCosts.get(s.sessionId) || { cost: 0, unknown: 0 };
        acc.cost += cost;
        if (unknown) acc.unknown++;
        sessionCosts.set(s.sessionId, acc);
        updatedSpans++;
      }
      for (const [sid, acc] of sessionCosts) {
        updateSession.run(
          acc.cost,
          acc.unknown,
          COST_CURRENCY,
          calculatedAt,
          COST_CALCULATOR_VERSION,
          sid,
        );
      }
    });

    run();
    return { ok: true, updatedSpans, updatedSessions: sessionCosts.size };
  });
}
