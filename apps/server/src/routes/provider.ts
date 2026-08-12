import type { FastifyInstance } from 'fastify';
import type { ProviderConfiguration } from '../provider-config';
import type { AppRuntime } from '../runtime';

interface ProviderBody {
  provider: 'anthropic' | 'openai';
  baseUrl: string;
  model: string;
  apiKey: string;
}

const providerBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['provider', 'baseUrl', 'model', 'apiKey'],
  properties: {
    provider: { type: 'string', enum: ['anthropic', 'openai'] },
    baseUrl: { type: 'string', minLength: 1, maxLength: 2048 },
    model: { type: 'string', minLength: 1, maxLength: 512 },
    apiKey: { type: 'string', minLength: 1, maxLength: 4096 },
  },
} as const;

export function registerProviderRoutes(app: FastifyInstance, runtime: AppRuntime): void {
  app.get('/api/provider/status', async () => runtime.provider.status());

  app.post('/api/provider/test', async (_request, reply) => {
    const test = await runtime.provider.test();
    if (test.reason === 'not_configured') {
      return reply.status(400).send({ ok: false, status: runtime.provider.status(), test });
    }
    return { ok: test.status === 'passed', status: runtime.provider.status(), test };
  });

  app.put<{ Body: ProviderBody }>(
    '/api/provider/configuration',
    { schema: { body: providerBodySchema } },
    async (request) => {
      const configuration: ProviderConfiguration = {
        provider: request.body.provider,
        baseUrl: request.body.baseUrl.trim(),
        model: request.body.model.trim(),
        apiKey: request.body.apiKey.trim(),
      };
      runtime.provider.configure(configuration);
      const test = await runtime.provider.test();
      return { ok: test.status === 'passed', status: runtime.provider.status(), test };
    },
  );
}
