import type { PricingCurrency, PricingUnit } from '@agent-profile/core';
import { COST_CURRENCY, COST_UNIT } from '@agent-profile/core';
import type { FastifyInstance } from 'fastify';
import type { AppRuntime } from '../runtime';

type PricingRuntime = Pick<AppRuntime, 'modelCatalog' | 'clock'>;
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

export function registerPricingRoutes(app: FastifyInstance, runtime: PricingRuntime): void {
  const { modelCatalog, clock } = runtime;
  app.get('/api/pricing', async () => {
    return modelCatalog.listPricing();
  });

  app.put<{ Body: PricingBody }>(
    '/api/pricing',
    { schema: { body: pricingBodySchema } },
    async (req) => {
      const b = req.body;
      const effectiveFrom = b.effectiveFrom ?? clock();
      modelCatalog.upsertPricing(
        {
          ...b,
          currency: b.currency ?? COST_CURRENCY,
          unit: b.unit ?? COST_UNIT,
          effectiveFrom,
        },
        'manual',
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
    return modelCatalog.listContexts();
  });

  app.put<{ Body: ModelContextBody }>(
    '/api/model-context',
    { schema: { body: modelContextBodySchema } },
    async (req) => {
      const b = req.body;
      return { ok: true, context: modelCatalog.upsertContext(b, 'manual') };
    },
  );

  // 按每个 LLM span 的发生时间重新选择生效 pricing，并重建 session cost。
  app.post('/api/recompute-cost', async () => {
    const result = modelCatalog.executeRecalculation({}, modelCatalog.pricingRevision());
    return {
      ok: true,
      updatedSpans: result.updatedSpans,
      updatedSessions: result.updatedSessions,
      pricingRevision: result.pricingRevision,
      runId: result.runId,
      calculatedAt: result.executedAt,
    };
  });
}
