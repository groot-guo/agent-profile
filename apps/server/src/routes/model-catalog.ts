import type {
  ModelCatalogConfiguration,
  ModelCatalogRecalculationScope,
} from '@agent-profile/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppRuntime } from '../runtime';

interface ModelParams {
  key: string;
}

interface PricingBody {
  inputPrice: number;
  cacheCreationPrice: number;
  cacheReadPrice: number;
  outputPrice: number;
  currency?: 'CNY';
  unit?: 'per_million_tokens';
  effectiveFrom?: number;
  pricingScheme?: string;
  sourceReference?: string;
}

interface ContextBody {
  contextWindow: number;
  sourceReference?: string;
  auditedAt?: number;
}

interface AliasBody {
  pricingModel: string;
  pricingEquivalent: true;
  sourceReference?: string;
  auditedAt?: number;
}

interface ExecuteBody {
  scope?: ModelCatalogRecalculationScope;
  pricingRevision: string;
}

const pricingSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['inputPrice', 'cacheCreationPrice', 'cacheReadPrice', 'outputPrice'],
  properties: {
    inputPrice: { type: 'number', minimum: 0 },
    cacheCreationPrice: { type: 'number', minimum: 0 },
    cacheReadPrice: { type: 'number', minimum: 0 },
    outputPrice: { type: 'number', minimum: 0 },
    currency: { type: 'string', enum: ['CNY'] },
    unit: { type: 'string', enum: ['per_million_tokens'] },
    effectiveFrom: { type: 'integer', minimum: 0 },
    pricingScheme: { type: 'string', minLength: 1 },
    sourceReference: { type: 'string', maxLength: 2048 },
  },
} as const;

const scopeSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    models: { type: 'array', maxItems: 1000, items: { type: 'string', minLength: 1 } },
    startTime: { type: 'integer', minimum: 0 },
    endTime: { type: 'integer', minimum: 0 },
  },
} as const;

export function registerModelCatalogRoutes(app: FastifyInstance, runtime: AppRuntime): void {
  const { modelCatalog } = runtime;

  app.get('/api/model-catalog/models', async () => ({
    schemaVersion: 'model-catalog/v1',
    pricingRevision: modelCatalog.pricingRevision(),
    models: modelCatalog.listModels(),
  }));

  app.get<{ Params: ModelParams }>('/api/model-catalog/models/:key/pricing', async (request) => ({
    model: request.params.key,
    schedules: modelCatalog.listPricingHistory(request.params.key),
  }));

  app.post<{ Params: ModelParams; Body: PricingBody }>(
    '/api/model-catalog/models/:key/pricing',
    { schema: { body: pricingSchema } },
    async (request) =>
      modelCatalog.upsertPricing({ model: request.params.key, ...request.body }, 'manual'),
  );

  app.get<{ Params: ModelParams }>('/api/model-catalog/models/:key/context', async (request) => ({
    model: request.params.key,
    context: modelCatalog.listContexts(request.params.key)[0] ?? null,
  }));

  app.put<{ Params: ModelParams; Body: ContextBody }>(
    '/api/model-catalog/models/:key/context',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['contextWindow'],
          properties: {
            contextWindow: { type: 'integer', minimum: 1 },
            sourceReference: { type: 'string', maxLength: 2048 },
            auditedAt: { type: 'integer', minimum: 0 },
          },
        },
      },
    },
    async (request) =>
      modelCatalog.upsertContext({ model: request.params.key, ...request.body }, 'manual'),
  );

  app.put<{ Params: ModelParams; Body: AliasBody }>(
    '/api/model-catalog/models/:key/pricing-alias',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['pricingModel', 'pricingEquivalent'],
          properties: {
            pricingModel: { type: 'string', minLength: 1 },
            pricingEquivalent: { type: 'boolean', const: true },
            sourceReference: { type: 'string', maxLength: 2048 },
            auditedAt: { type: 'integer', minimum: 0 },
          },
        },
      },
    },
    async (request, reply) =>
      handleCatalogError(reply, () =>
        modelCatalog.upsertAlias({ rawModel: request.params.key, ...request.body }, 'manual'),
      ),
  );

  app.post<{ Body: ModelCatalogRecalculationScope }>(
    '/api/model-catalog/recalculation/preview',
    { schema: { body: scopeSchema } },
    async (request) => modelCatalog.previewRecalculation(request.body ?? {}),
  );

  app.post<{ Body: ExecuteBody }>(
    '/api/model-catalog/recalculation/execute',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['pricingRevision'],
          properties: {
            scope: scopeSchema,
            pricingRevision: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request, reply) =>
      handleCatalogError(reply, () =>
        modelCatalog.executeRecalculation(request.body.scope ?? {}, request.body.pricingRevision),
      ),
  );

  app.get('/api/model-catalog/configuration', async () => modelCatalog.exportConfiguration());

  app.post<{ Body: ModelCatalogConfiguration }>(
    '/api/model-catalog/configuration',
    async (request, reply) =>
      handleCatalogError(reply, () => ({
        ok: true,
        imported: modelCatalog.importConfiguration(request.body),
      })),
  );
}

function handleCatalogError<T>(reply: FastifyReply, operation: () => T): T | FastifyReply {
  try {
    return operation();
  } catch (error) {
    const code = error instanceof Error ? error.message : 'model_catalog_error';
    const status = code === 'pricing_revision_changed' ? 409 : 400;
    return reply.status(status).send({ error: code });
  }
}
