import type { RuntimeHintAdoptionStatus } from '@agent-profile/core';
import type { FastifyInstance } from 'fastify';
import type { AppRuntime } from '../runtime';
import { RuntimeEventCollectorError } from '../runtime-event-collector';
import {
  getRuntimeHintReport,
  RuntimeHintServiceError,
  recordRuntimeHintAdoption,
} from '../runtime-hint-service';

type RuntimeHintRouteRuntime = Pick<AppRuntime, 'database' | 'clock'>;

interface RuntimeHintQuery {
  optIn?: string;
}

interface RuntimeHintAdoptionBody {
  schemaVersion: 'runtime-hint-adoption/v1';
  status: RuntimeHintAdoptionStatus;
  producer: string;
}

const runtimeHintQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: { optIn: { type: 'string', enum: ['true'] } },
} as const;

const runtimeHintAdoptionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'status', 'producer'],
  properties: {
    schemaVersion: { type: 'string', const: 'runtime-hint-adoption/v1' },
    status: { type: 'string', enum: ['adopted', 'ignored', 'not_recorded'] },
    producer: { type: 'string', minLength: 1, maxLength: 120 },
  },
} as const;

export function registerRuntimeHintRoutes(
  app: FastifyInstance,
  runtime: RuntimeHintRouteRuntime,
): void {
  app.get<{ Params: { runId: string }; Querystring: RuntimeHintQuery }>(
    '/api/runtime/runs/:runId/hint',
    { schema: { querystring: runtimeHintQuerySchema } },
    async (request, reply) => {
      if (request.query.optIn !== 'true') {
        return reply.code(400).send({ error: 'runtime_hint_opt_in_required' });
      }
      try {
        return reply
          .code(200)
          .send(
            getRuntimeHintReport(runtime.database, request.params.runId, runtime.clock(), true),
          );
      } catch (error) {
        return respondError(reply, error);
      }
    },
  );

  app.post<{ Params: { hintId: string }; Body: RuntimeHintAdoptionBody }>(
    '/api/runtime/hints/:hintId/adoption',
    { schema: { body: runtimeHintAdoptionSchema } },
    async (request, reply) => {
      try {
        return reply
          .code(201)
          .send(
            recordRuntimeHintAdoption(
              runtime.database,
              request.params.hintId,
              request.body,
              runtime.clock(),
            ),
          );
      } catch (error) {
        return respondError(reply, error);
      }
    },
  );
}

function respondError(
  reply: { code: (statusCode: number) => { send: (body: unknown) => unknown } },
  error: unknown,
) {
  if (error instanceof RuntimeEventCollectorError || error instanceof RuntimeHintServiceError) {
    return reply.code(error.statusCode).send({ error: error.code });
  }
  throw error;
}
