import { createApp } from './app';
import { config } from './config';
import { createProductionRuntime } from './runtime';

const runtime = createProductionRuntime({
  autoScanDir: config.autoScanDir,
  defaultScanDir: config.defaultScanDir,
  onImportError: (source, error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${source.id} import failed: ${message}\n`);
  },
});
const app = createApp(runtime, { webOrigins: config.webOrigins });
let isShuttingDown = false;

async function shutdown(exitCode: number): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  await app.close();
  await runtime.close();
  process.exit(exitCode);
}

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`Trace Server running at http://${config.host}:${config.port}`);
  await runtime.imports.startStartupImports();
} catch (error) {
  app.log.error(error);
  await shutdown(1);
}

process.once('SIGINT', () => {
  void shutdown(0);
});
process.once('SIGTERM', () => {
  void shutdown(0);
});
