import type { RuntimeEventBatch } from '@agent-profile/contracts';
import type { FastifyInstance } from 'fastify';
import type { AppRuntime } from '../runtime';
import {
  appendRuntimeEventBatch,
  getRuntimeEventPage,
  RuntimeEventCollectorError,
} from '../runtime-event-collector';

type RuntimeEventRouteRuntime = Pick<AppRuntime, 'database' | 'clock'>;

interface RuntimeEventQuery {
  limit?: string;
}

const runtimeEventBatchSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'events'],
  properties: {
    schemaVersion: { type: 'string', const: 'runtime-event-batch/v1' },
    events: { type: 'array', minItems: 1, maxItems: 100 },
    coverageComplete: { type: 'boolean' },
  },
} as const;

const runtimeEventQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: { limit: { type: 'string', pattern: '^[1-9][0-9]*$' } },
} as const;

export function registerRuntimeEventRoutes(
  app: FastifyInstance,
  runtime: RuntimeEventRouteRuntime,
): void {
  app.post<{ Body: RuntimeEventBatch }>(
    '/api/runtime/events',
    { schema: { body: runtimeEventBatchSchema } },
    async (request, reply) => {
      try {
        return reply
          .code(202)
          .send(appendRuntimeEventBatch(runtime.database, request.body, runtime.clock()));
      } catch (error) {
        if (error instanceof RuntimeEventCollectorError) {
          return reply.code(error.statusCode).send({ error: error.code });
        }
        throw error;
      }
    },
  );

  app.get<{ Params: { runId: string }; Querystring: RuntimeEventQuery }>(
    '/api/runtime/runs/:runId/events',
    { schema: { querystring: runtimeEventQuerySchema } },
    async (request, reply) => {
      try {
        const limit = request.query.limit === undefined ? undefined : Number(request.query.limit);
        return reply
          .code(200)
          .send(getRuntimeEventPage(runtime.database, request.params.runId, limit));
      } catch (error) {
        if (error instanceof RuntimeEventCollectorError) {
          return reply.code(error.statusCode).send({ error: error.code });
        }
        throw error;
      }
    },
  );
}
