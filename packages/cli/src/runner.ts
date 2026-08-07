import {
  CLI_SCHEMA_VERSION,
  type CliDiagnosisReport,
  type CliDoctorReport,
  type CliDoctorSource,
  type CliEvidenceReport,
  type CliHelpReport,
  type CliImportStatus,
  type CliOutcomeEvidenceSource,
  type CliOutcomeEvidenceStatus,
  type CliProfilesReport,
  type CliReport,
  type CliSessionDiscoveryPage,
  type CliSessionsReport,
  type CliSourcesReport,
  type CliStatsData,
  type CliStatsReport,
  type CliSyncReport,
  type CliTaskFeedbackReport,
  type CliTaskOutcomeReport,
  type CliTaskProfileReport,
  type CliVersionReport,
  type ImportJobStatusResponse,
  type ImportSourceId,
} from '@agent-profile/contracts';
import { ImportServiceError } from 'trace-server/imports';
import { SessionDiscoveryError } from 'trace-server/sessions';
import {
  CliUsageError,
  errorMessage,
  type ParsedCliArguments,
  parseCliArguments,
  resolveDatabasePath,
  USAGE,
} from './arguments';
import { formatReport } from './format';
import type { LocalApplicationOptions, LocalApplicationReport } from './serve';

export interface CliRuntime {
  imports: {
    jobs: {
      refreshAvailability: () => Promise<{
        active: boolean;
        sources: CliDoctorSource[];
      }>;
    };
  };
  close: () => Promise<void>;
}

export interface CliRuntimeOptions {
  databasePath: string;
  autoScanDir: null;
  defaultScanDir: string;
}

export interface CliDependencies {
  cwd: string;
  defaultDatabasePath: string;
  defaultScanDir: string;
  env: NodeJS.ProcessEnv;
  fileExists: (path: string) => boolean;
  version: string;
  createRuntime: (options: CliRuntimeOptions) => CliRuntime;
  getImportStatus: (runtime: CliRuntime) => Promise<ImportJobStatusResponse>;
  syncImports: (
    runtime: CliRuntime,
    sourceIds: string[] | undefined,
  ) => Promise<ImportJobStatusResponse>;
  discoverSessions: (
    runtime: CliRuntime,
    options: { limit?: number; cursor?: string },
  ) => CliSessionDiscoveryPage;
  getStatsReport: (runtime: CliRuntime) => CliStatsData;
  getAgentProfileReport: (runtime: CliRuntime) => CliProfilesReport['agentProfiles'];
  startServe: (options: LocalApplicationOptions) => Promise<LocalApplicationReport>;
  getTaskProfileReport: (
    runtime: CliRuntime,
    taskId: string,
  ) => CliTaskProfileReport['taskProfile'];
  getSessionDiagnosisReport: (
    runtime: CliRuntime,
    sessionId: string,
  ) => Promise<CliDiagnosisReport['diagnosis']>;
  getSessionEvidenceReport: (
    runtime: CliRuntime,
    sessionId: string,
  ) => CliEvidenceReport['evidence'];
  recordTaskOutcomeEvidence: (
    runtime: CliRuntime,
    taskId: string,
    evidence: CliOutcomeEvidenceInput,
  ) => CliTaskOutcomeReport['saved'];
  getTaskFeedbackReports: (
    runtime: CliRuntime,
    taskId: string,
  ) => CliTaskFeedbackReport['feedback'];
  writeStdout: (text: string) => void;
  writeStderr: (text: string) => void;
}

export interface CliOutcomeEvidenceInput {
  kind: string;
  status?: CliOutcomeEvidenceStatus;
  reference?: string;
  provenance?: {
    producer: string;
    capturedAt: number;
    source: CliOutcomeEvidenceSource;
    sourceId: string;
    basis: string;
  };
}

export async function runCli(argv: string[], dependencies: CliDependencies): Promise<number> {
  try {
    const options = parseCliArguments(argv);
    if (options.command === 'help') {
      writeReport(helpReport(), options.json, dependencies);
      return 0;
    }
    if (options.command === 'version') {
      writeReport(versionReport(dependencies.version), options.json, dependencies);
      return 0;
    }

    const databasePath = resolveDatabasePath(
      options,
      dependencies.env,
      dependencies.cwd,
      dependencies.defaultDatabasePath,
    );
    if (
      options.command === 'serve' &&
      options.host &&
      options.port !== undefined &&
      options.webPort !== undefined
    ) {
      const report = await dependencies.startServe({
        databasePath,
        defaultScanDir: dependencies.defaultScanDir,
        host: options.host,
        port: options.port,
        webPort: options.webPort,
        openBrowser: options.openBrowser,
      });
      writeReport(
        {
          schemaVersion: CLI_SCHEMA_VERSION,
          command: 'serve',
          ...report,
          limitations: [
            'Serve listens on loopback only; non-local access remains outside the current security model.',
            'The Web process is private and all browser/API traffic uses the reported public origin.',
          ],
        },
        options.json,
        dependencies,
      );
      return 0;
    }
    if (options.command === 'sources') {
      const report = await sources(databasePath, dependencies);
      writeReport(report, options.json, dependencies);
      return 0;
    }
    if (options.command === 'sync') {
      const report = await sync(databasePath, options.sourceIds, dependencies);
      writeReport(report, options.json, dependencies);
      return hasFailedRequestedSource(report) ? 1 : 0;
    }
    if (options.command === 'sessions') {
      const report = await sessions(databasePath, options.limit, options.cursor, dependencies);
      writeReport(report, options.json, dependencies);
      return 0;
    }
    if (options.command === 'stats') {
      const report = await stats(databasePath, dependencies);
      writeReport(report, options.json, dependencies);
      return 0;
    }
    if (options.command === 'profiles') {
      const report = await profiles(databasePath, dependencies);
      writeReport(report, options.json, dependencies);
      return 0;
    }
    if (options.command === 'task-profile' && options.taskId) {
      const report = await taskProfile(databasePath, options.taskId, dependencies);
      writeReport(report, options.json, dependencies);
      return 0;
    }
    if (options.command === 'diagnosis' && options.taskId) {
      const report = await diagnosis(databasePath, options.taskId, dependencies);
      writeReport(report, options.json, dependencies);
      return 0;
    }
    if (options.command === 'evidence' && options.taskId) {
      const report = await evidence(databasePath, options.taskId, dependencies);
      writeReport(report, options.json, dependencies);
      return 0;
    }
    if (options.command === 'task-outcome' && options.taskId && options.evidenceKind) {
      const report = await taskOutcome(options, databasePath, options.taskId, dependencies);
      writeReport(report, options.json, dependencies);
      return 0;
    }
    if (options.command === 'task-feedback' && options.taskId) {
      const report = await taskFeedback(databasePath, options.taskId, dependencies);
      writeReport(report, options.json, dependencies);
      return 0;
    }

    const report = await doctor(databasePath, dependencies);
    writeReport(report, options.json, dependencies);
    return 0;
  } catch (error) {
    dependencies.writeStderr(`${errorMessage(error)}\n`);
    return isUsageError(error) ? 2 : 1;
  }
}

async function sources(
  databasePath: string,
  dependencies: CliDependencies,
): Promise<CliSourcesReport> {
  const runtime = dependencies.createRuntime(runtimeOptions(databasePath, dependencies));
  try {
    return sourcesReport(await dependencies.getImportStatus(runtime));
  } finally {
    await runtime.close();
  }
}

async function sync(
  databasePath: string,
  sourceIds: string[] | undefined,
  dependencies: CliDependencies,
): Promise<CliSyncReport> {
  const runtime = dependencies.createRuntime(runtimeOptions(databasePath, dependencies));
  try {
    const status = await dependencies.syncImports(runtime, sourceIds);
    return {
      ...sourcesReport(status),
      command: 'sync',
      requestedSources: (sourceIds ??
        status.sources.map((source) => source.id)) as ImportSourceId[],
      limitations: [
        'Sync waits for selected sources to reach a terminal state before reporting.',
        'Unavailable sources are reported without reading or importing transcript content.',
      ],
    };
  } finally {
    await runtime.close();
  }
}

function hasFailedRequestedSource(report: CliSyncReport): boolean {
  return report.sources.some(
    (source) => report.requestedSources.includes(source.id) && source.state === 'failed',
  );
}

async function sessions(
  databasePath: string,
  limit: number | undefined,
  cursor: string | undefined,
  dependencies: CliDependencies,
): Promise<CliSessionsReport> {
  const runtime = dependencies.createRuntime(runtimeOptions(databasePath, dependencies));
  try {
    return {
      schemaVersion: CLI_SCHEMA_VERSION,
      command: 'sessions',
      ...dependencies.discoverSessions(runtime, { limit, cursor }),
      limitations: [
        'Only primary Sessions are listed; Codex child records remain directly addressable through the Web/API.',
        'Session paths, transcript identifiers, Span metadata, and content are omitted.',
        'Use the Web/API for detailed Session analysis and evidence timelines.',
      ],
    };
  } finally {
    await runtime.close();
  }
}

async function stats(databasePath: string, dependencies: CliDependencies): Promise<CliStatsReport> {
  const runtime = dependencies.createRuntime(runtimeOptions(databasePath, dependencies));
  try {
    return {
      schemaVersion: CLI_SCHEMA_VERSION,
      command: 'stats',
      statistics: dependencies.getStatsReport(runtime),
      limitations: [
        'Statistics describe all current primary Sessions in the selected local database.',
        'Unknown model pricing remains visible through sessionsWithCostUnknown; totals do not invent missing cost.',
      ],
    };
  } finally {
    await runtime.close();
  }
}

async function profiles(
  databasePath: string,
  dependencies: CliDependencies,
): Promise<CliProfilesReport> {
  const runtime = dependencies.createRuntime(runtimeOptions(databasePath, dependencies));
  try {
    return {
      schemaVersion: CLI_SCHEMA_VERSION,
      command: 'profiles',
      agentProfiles: dependencies.getAgentProfileReport(runtime),
      limitations: [
        'Agent Process Profiles describe observed process distributions, not universal quality rankings.',
        'Coverage, minimum samples, comparison interpretation, and limitations are retained in agent-profile/v1.',
      ],
    };
  } finally {
    await runtime.close();
  }
}

async function taskProfile(
  databasePath: string,
  taskId: string,
  dependencies: CliDependencies,
): Promise<CliTaskProfileReport> {
  const runtime = dependencies.createRuntime(runtimeOptions(databasePath, dependencies));
  try {
    return {
      schemaVersion: CLI_SCHEMA_VERSION,
      command: 'task-profile',
      taskId,
      taskProfile: dependencies.getTaskProfileReport(runtime, taskId),
      limitations: [
        'Task Profile combines explicitly linked Sessions and locally recorded Outcome evidence only.',
        'Missing or partial Outcome coverage does not prove delivery success or failure.',
      ],
    };
  } finally {
    await runtime.close();
  }
}

async function diagnosis(
  databasePath: string,
  sessionId: string,
  dependencies: CliDependencies,
): Promise<CliDiagnosisReport> {
  const runtime = dependencies.createRuntime(runtimeOptions(databasePath, dependencies));
  try {
    return {
      schemaVersion: CLI_SCHEMA_VERSION,
      command: 'diagnosis',
      sessionId,
      diagnosis: await dependencies.getSessionDiagnosisReport(runtime, sessionId),
      limitations: [
        'This report is content-free by default; use Span IDs to request exact evidence through the Web/API.',
      ],
    };
  } finally {
    await runtime.close();
  }
}

async function evidence(
  databasePath: string,
  sessionId: string,
  dependencies: CliDependencies,
): Promise<CliEvidenceReport> {
  const runtime = dependencies.createRuntime(runtimeOptions(databasePath, dependencies));
  try {
    return {
      schemaVersion: CLI_SCHEMA_VERSION,
      command: 'evidence',
      sessionId,
      evidence: dependencies.getSessionEvidenceReport(runtime, sessionId),
      limitations: [
        'This report contains bounded references only; raw prompt, answer, thinking, tool input, and tool output content are omitted.',
      ],
    };
  } finally {
    await runtime.close();
  }
}

async function taskOutcome(
  options: ParsedCliArguments,
  databasePath: string,
  taskId: string,
  dependencies: CliDependencies,
): Promise<CliTaskOutcomeReport> {
  const runtime = dependencies.createRuntime(runtimeOptions(databasePath, dependencies));
  try {
    const evidence: CliOutcomeEvidenceInput = {
      kind: options.evidenceKind as string,
      status: options.evidenceStatus,
      reference: options.evidenceReference,
      ...(options.evidenceSource && options.evidenceSourceId
        ? {
            provenance: {
              producer: 'agent-profile/cli',
              capturedAt: Date.now(),
              source: options.evidenceSource,
              sourceId: options.evidenceSourceId,
              basis: 'explicit_cli_confirmation',
            },
          }
        : {}),
    };
    return {
      schemaVersion: CLI_SCHEMA_VERSION,
      command: 'task-outcome',
      taskId,
      saved: dependencies.recordTaskOutcomeEvidence(runtime, taskId, evidence),
      limitations: [
        'Only the explicitly confirmed evidence entry was appended; no build, test, lint, or delivery status was inferred.',
        'A saved evidence entry remains a local record and does not establish Task correctness.',
      ],
    };
  } finally {
    await runtime.close();
  }
}

async function taskFeedback(
  databasePath: string,
  taskId: string,
  dependencies: CliDependencies,
): Promise<CliTaskFeedbackReport> {
  const runtime = dependencies.createRuntime(runtimeOptions(databasePath, dependencies));
  try {
    return {
      schemaVersion: CLI_SCHEMA_VERSION,
      command: 'task-feedback',
      taskId,
      feedback: dependencies.getTaskFeedbackReports(runtime, taskId),
      limitations: [
        'Feedback is returned only after explicit --opt-in and remains bounded, read-only, and evidence-scoped.',
        'Suppressed feedback is an evidence-coverage state, not a quality failure.',
      ],
    };
  } finally {
    await runtime.close();
  }
}

async function doctor(
  databasePath: string,
  dependencies: CliDependencies,
): Promise<CliDoctorReport> {
  const existedBeforeRuntime = dependencies.fileExists(databasePath);
  const runtime = dependencies.createRuntime(runtimeOptions(databasePath, dependencies));
  try {
    const imports = await runtime.imports.jobs.refreshAvailability();
    return {
      schemaVersion: CLI_SCHEMA_VERSION,
      command: 'doctor',
      database: { path: databasePath, existedBeforeRuntime },
      imports: { active: imports.active },
      sources: imports.sources.map((source) => ({
        id: source.id,
        label: source.label,
        available: source.available,
        state: source.state,
      })),
      limitations: [
        'Doctor does not start HTTP or import source data.',
        'Opening the Runtime applies ordinary migrations and default reference data seeding.',
      ],
    };
  } finally {
    await runtime.close();
  }
}

function runtimeOptions(databasePath: string, dependencies: CliDependencies): CliRuntimeOptions {
  return {
    databasePath,
    autoScanDir: null,
    defaultScanDir: dependencies.defaultScanDir,
  };
}

function helpReport(): CliHelpReport {
  return {
    schemaVersion: CLI_SCHEMA_VERSION,
    command: 'help',
    usage: USAGE,
    commands: [
      'help',
      'version',
      'doctor',
      'sources',
      'sync',
      'serve',
      'sessions',
      'stats',
      'profiles',
      'task-profile',
      'diagnosis',
      'evidence',
      'task-outcome',
      'task-feedback',
    ],
  };
}

function versionReport(version: string): CliVersionReport {
  return { schemaVersion: CLI_SCHEMA_VERSION, command: 'version', version };
}

function writeReport(report: CliReport, asJson: boolean, dependencies: CliDependencies): void {
  dependencies.writeStdout(asJson ? `${JSON.stringify(report)}\n` : formatReport(report));
}

function sourcesReport(status: ImportJobStatusResponse): CliSourcesReport {
  return {
    schemaVersion: CLI_SCHEMA_VERSION,
    command: 'sources',
    imports: importStatus(status),
    sources: status.sources,
    limitations: [
      'Source availability is checked locally; source paths and transcript identifiers are omitted.',
    ],
  };
}

function importStatus(status: ImportJobStatusResponse): CliImportStatus {
  return { jobId: status.jobId, active: status.active, operation: status.operation };
}

function isUsageError(error: unknown): boolean {
  return (
    error instanceof CliUsageError ||
    (error instanceof ImportServiceError && error.code === 'invalid_source') ||
    error instanceof SessionDiscoveryError
  );
}
