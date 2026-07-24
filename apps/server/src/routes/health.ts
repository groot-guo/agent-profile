import type { FastifyInstance } from 'fastify';

const startTime = Date.now();

export function registerHealthRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => {
    return {
      ok: true,
      uptime: Math.round((Date.now() - startTime) / 1000),
    };
  });
}
