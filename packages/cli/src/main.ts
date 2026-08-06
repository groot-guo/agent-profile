import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cwd } from 'node:process';
import { DEFAULT_SCAN_DIR } from 'trace-server/constants';
import { startHttpServer } from 'trace-server/http-server';
import { getImportStatus, runImport } from 'trace-server/imports';
import {
  getAgentProfileReport,
  getSessionDiagnosisReport,
  getSessionEvidenceReport,
  getStatsReport,
  getTaskFeedbackReports,
  getTaskProfileReport,
  recordTaskOutcomeEvidence,
} from 'trace-server/reports';
import { createProductionRuntime, defaultDatabasePath } from 'trace-server/runtime';
import { discoverSessions } from 'trace-server/sessions';
import { openBrowser } from './open-browser';
import type { CliDependencies } from './runner';
import { installShutdownHandlers, startLocalApplication } from './serve';
import { resolveWebServerEntry, startNextWebServer } from './web-server';

const requirePackageMetadata = createRequire(import.meta.url);
const packageMetadata = requirePackageMetadata('../package.json') as { version: string };

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
    startServe: async (options) => {
      const webServerEntry = resolveWebServerEntry({
        moduleUrl: import.meta.url,
        explicitPath: process.env.AGENT_PROFILE_WEB_SERVER,
      });
      const application = await startLocalApplication(options, {
        startWebServer: ({ port }) => startNextWebServer({ entryPath: webServerEntry, port }),
        createRuntime: createProductionRuntime,
        startHttpServer: ({ runtime, host, port, webUpstream }) =>
          startHttpServer({
            runtime: runtime as ReturnType<typeof createProductionRuntime>,
            host,
            port,
            webUpstream,
            logger: false,
          }),
        openBrowser: async (url) => {
          try {
            await openBrowser(url);
          } catch (error) {
            const message = error instanceof Error ? error.message : 'browser command failed';
            process.stderr.write(`Unable to open browser automatically: ${message}\n`);
          }
        },
      });
      installShutdownHandlers(application, {
        once: (signal, listener) => process.once(signal, listener),
        off: (signal, listener) => process.off(signal, listener),
        writeStderr: (text) => process.stderr.write(text),
        setExitCode: (exitCode) => {
          process.exitCode = exitCode;
        },
      });
      return application.report;
    },
    getTaskProfileReport: (runtime, taskId) => {
      const appRuntime = runtime as Parameters<typeof getImportStatus>[0];
      return getTaskProfileReport(appRuntime, taskId);
    },
    getSessionDiagnosisReport: (runtime, sessionId) => {
      const appRuntime = runtime as Parameters<typeof getImportStatus>[0];
      return getSessionDiagnosisReport(appRuntime, sessionId);
    },
    getSessionEvidenceReport: (runtime, sessionId) => {
      const appRuntime = runtime as Parameters<typeof getImportStatus>[0];
      return getSessionEvidenceReport(appRuntime, sessionId);
    },
    recordTaskOutcomeEvidence: (runtime, taskId, evidence) => {
      const appRuntime = runtime as Parameters<typeof getImportStatus>[0];
      return recordTaskOutcomeEvidence(appRuntime, taskId, evidence);
    },
    getTaskFeedbackReports: (runtime, taskId) => {
      const appRuntime = runtime as Parameters<typeof getImportStatus>[0];
      return getTaskFeedbackReports(appRuntime, taskId);
    },
    writeStdout: (text) => process.stdout.write(text),
    writeStderr: (text) => process.stderr.write(text),
  };
}
