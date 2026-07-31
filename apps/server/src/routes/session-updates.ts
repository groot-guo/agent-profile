import type { FastifyInstance } from 'fastify';
import type { AppRuntime } from '../runtime';

const MAX_WAIT_MS = 30_000;
const DEFAULT_WAIT_MS = 25_000;

interface SessionUpdateQuery {
  after?: string;
  wait?: string;
}

export function registerSessionUpdateRoutes(app: FastifyInstance, runtime: AppRuntime): void {
  app.get<{ Querystring: SessionUpdateQuery }>('/api/session-updates', async (request, reply) => {
    const after = nonNegativeInteger(request.query.after, 0);
    const wait = nonNegativeInteger(request.query.wait, DEFAULT_WAIT_MS);
    if (after === null || wait === null || wait > MAX_WAIT_MS) {
      return reply.status(400).send({ error: 'invalid session update cursor' });
    }

    const controller = new AbortController();
    const abort = () => controller.abort();
    reply.raw.once('close', abort);
    try {
      return await runtime.imports.updates.waitFor(after, wait, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) return reply;
      throw error;
    } finally {
      reply.raw.off('close', abort);
    }
  });
}

function nonNegativeInteger(value: string | undefined, fallback: number): number | null {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
