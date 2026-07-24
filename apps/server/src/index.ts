import cors from '@fastify/cors';
import Fastify from 'fastify';
import { config } from './config';
import { closeDb } from './db';
import { registerRoutes } from './routes/index';
import { autoScan, scanZedThreads } from './routes/scan';

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

registerRoutes(app);

try {
  await app.listen({ port: config.port });
  console.log(`Trace Server running at http://localhost:${config.port}`);

  // 启动自动扫描
  if (config.autoScanDir) {
    console.log(`Auto-scanning ${config.autoScanDir}...`);
    autoScan(config.autoScanDir)
      .then((r) => {
        console.log(`Auto-scan done: ${r.scanned} files, ${r.imported} imported`);
      })
      .catch((err) => {
        console.warn(`Auto-scan failed: ${err instanceof Error ? err.message : err}`);
      });
  }

  // 扫描 Zed threads
  scanZedThreads()
    .then((r) => {
      if (r.scanned > 0) console.log(`Zed scan done: ${r.scanned} threads, ${r.imported} imported`);
    })
    .catch((err) => {
      console.warn(`Zed scan failed: ${err instanceof Error ? err.message : err}`);
    });
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
