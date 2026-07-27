import cors from '@fastify/cors';
import Fastify from 'fastify';
import { config } from './config';
import { closeDb } from './db';
import { registerRoutes } from './routes/index';
import { startStartupImports } from './routes/scan';

const app = Fastify({ logger: true });

await app.register(cors, { origin: config.webOrigins });

registerRoutes(app);

try {
  await app.listen({ port: config.port, host: config.host });
  console.log(`Trace Server running at http://${config.host}:${config.port}`);
  if (!['127.0.0.1', 'localhost', '::1'].includes(config.host)) {
    app.log.warn(
      'The API is listening beyond loopback without authentication; use only on a trusted network.',
    );
  }

  // All startup imports use the same observable, deduplicated job state as the UI.
  await startStartupImports();
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
