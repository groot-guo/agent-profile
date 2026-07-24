import Fastify from 'fastify';
import cors from '@fastify/cors';
import { registerRoutes } from './routes';
import { closeDb } from './db';

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

registerRoutes(app);

const PORT = Number(process.env.PORT) || 3000;

try {
  await app.listen({ port: PORT });
  console.log(`Trace Server running at http://localhost:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

process.on('SIGINT', () => { closeDb(); process.exit(0); });
process.on('SIGTERM', () => { closeDb(); process.exit(0); });
