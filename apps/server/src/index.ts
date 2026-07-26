import cors from '@fastify/cors';
import Fastify from 'fastify';
import { config } from './config';
import { closeDb } from './db';
import { registerRoutes } from './routes/index';
import { autoScan, scanMiMoSessions, scanZedThreads } from './routes/scan';

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

registerRoutes(app);

try {
  await app.listen({ port: config.port });
  console.log(`Trace Server running at http://localhost:${config.port}`);

  // 启动自动扫描（多源）
  if (config.autoScanDir) {
    const dirs =
      config.autoScanDir === '~/.claude/projects' ? config.autoScanDirs : [config.autoScanDir];
    for (const dir of dirs) {
      console.log(`Auto-scanning ${dir}...`);
      autoScan(dir)
        .then((r) => {
          if (r.scanned > 0) {
            console.log(
              `Auto-scan ${dir}: ${r.scanned} files, ${r.imported} imported, ${r.updated} updated, ${r.failed} failed`,
            );
          }
        })
        .catch((err) => {
          console.warn(`Auto-scan ${dir} failed: ${err instanceof Error ? err.message : err}`);
        });
    }
  }

  // 扫描 Zed threads
  scanZedThreads()
    .then((r) => {
      if (r.scanned > 0) {
        console.log(
          `Zed scan done: ${r.scanned} threads, ${r.imported} imported, ${r.updated} updated, ${r.failed} failed`,
        );
      }
    })
    .catch((err) => {
      console.warn(`Zed scan failed: ${err instanceof Error ? err.message : err}`);
    });

  // 扫描 MiMo Code
  scanMiMoSessions()
    .then((r) => {
      if (r.scanned > 0) {
        console.log(
          `MiMo scan done: ${r.scanned} sessions, ${r.imported} imported, ${r.updated} updated, ${r.failed} failed`,
        );
      }
    })
    .catch((err) => {
      console.warn(`MiMo scan failed: ${err instanceof Error ? err.message : err}`);
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
