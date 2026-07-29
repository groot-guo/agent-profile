import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cwd } from 'node:process';
import { DEFAULT_SCAN_DIR } from 'trace-server/config';
import { getImportStatus, runImport } from 'trace-server/imports';
import { getAgentProfileReport, getStatsReport, getTaskProfileReport } from 'trace-server/reports';
import { createProductionRuntime, defaultDatabasePath } from 'trace-server/runtime';
import { discoverSessions } from 'trace-server/sessions';
import type { CliDependencies } from './runner';

const require = createRequire(import.meta.url);
const packageMetadata = require('../package.json') as { version: string };

export const CLI_VERSION = packageMetadata.version;

export function createDefaultCliDependencies(): CliDependencies {
  return {
    cwd: cwd(),
    defaultDatabasePath,
    defaultScanDir: DEFAULT_SCAN_DIR,
    env: process.env,
    fileExists: existsSync,
    version: CLI_VERSION,
    createRuntime: createProductionRuntime,
    getImportStatus: (runtime) => getImportStatus(runtime as Parameters<typeof getImportStatus>[0]),
    syncImports: (runtime, sourceIds) =>
      runImport(runtime as Parameters<typeof runImport>[0], sourceIds),
    discoverSessions: (runtime, options) => {
      const appRuntime = runtime as Parameters<typeof getImportStatus>[0];
      return discoverSessions(appRuntime.database, options);
    },
    getStatsReport: (runtime) => {
      const appRuntime = runtime as Parameters<typeof getImportStatus>[0];
      return getStatsReport(appRuntime);
    },
    getAgentProfileReport: (runtime) => {
      const appRuntime = runtime as Parameters<typeof getImportStatus>[0];
      return getAgentProfileReport(appRuntime);
    },
    getTaskProfileReport: (runtime, taskId) => {
      const appRuntime = runtime as Parameters<typeof getImportStatus>[0];
      return getTaskProfileReport(appRuntime, taskId);
    },
    writeStdout: (text) => process.stdout.write(text),
    writeStderr: (text) => process.stderr.write(text),
  };
}
