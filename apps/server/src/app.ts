import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { registerRoutes } from './routes/index';
import type { AppRuntime } from './runtime';

export interface HttpAppOptions {
  webOrigins: string[];
  logger?: boolean;
  webUpstream?: string;
}

export function createApp(runtime: AppRuntime, options: HttpAppOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? true });
  app.register(cors, { origin: options.webOrigins });
  registerRoutes(app, runtime);
  if (options.webUpstream) registerWebProxy(app, options.webUpstream);
  return app;
}

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function registerWebProxy(app: FastifyInstance, upstream: string): void {
  app.setNotFoundHandler(async (request, reply) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return reply.code(404).send({ error: 'not_found' });
    }

    try {
      const target = new URL(request.raw.url || '/', upstream);
      const response = await fetch(target, {
        method: request.method,
        headers: forwardedHeaders(request.headers),
        redirect: 'manual',
      });
      reply.code(response.status);
      response.headers.forEach((value, name) => {
        if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) reply.header(name, value);
      });
      if (request.method === 'HEAD') return reply.send();
      return reply.send(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      app.log.warn({ err: error }, 'Web upstream request failed');
      return reply.code(502).send({ error: 'web_upstream_unavailable' });
    }
  });
}

function forwardedHeaders(headers: Record<string, string | string[] | undefined>): Headers {
  const forwarded = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue;
    forwarded.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  forwarded.set('x-forwarded-proto', 'http');
  return forwarded;
}
