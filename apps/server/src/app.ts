import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { registerRoutes } from './routes/index';
import type { AppRuntime } from './runtime';

export interface HttpAppOptions {
  webOrigins: string[];
  logger?: boolean;
}

export function createApp(runtime: AppRuntime, options: HttpAppOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? true });
  app.register(cors, { origin: options.webOrigins });
  registerRoutes(app, runtime);
  return app;
}
