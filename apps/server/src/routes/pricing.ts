import type { Pricing } from '@agent-profile/core';
import type { FastifyInstance } from 'fastify';
import { db } from '../db';

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
}
