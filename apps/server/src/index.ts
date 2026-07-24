import cors from '@fastify/cors';
import Fastify from 'fastify';
import { closeDb } from './db';
import { registerRoutes } from './routes';

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

process.on('SIGINT', () => {
  closeDb();
  process.exit(0);
});
process.on('SIGTERM', () => {
  closeDb();
  process.exit(0);
});
