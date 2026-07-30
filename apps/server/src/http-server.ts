import type { FastifyInstance } from 'fastify';
import { createApp } from './app';
import type { AppRuntime } from './runtime';

export interface StartHttpServerOptions {
  runtime: AppRuntime;
  host: string;
  port: number;
  webUpstream?: string;
  logger?: boolean;
}

export async function startHttpServer(options: StartHttpServerOptions): Promise<FastifyInstance> {
  const app = createApp(options.runtime, {
    logger: options.logger,
    webOrigins: [],
    webUpstream: options.webUpstream,
  });
  try {
    await app.listen({ host: options.host, port: options.port });
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}
