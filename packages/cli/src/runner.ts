import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  CLI_SCHEMA_VERSION,
  type CliCommand,
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
import { formatReport } from './format';
import type { LocalApplicationOptions, LocalApplicationReport } from './serve';

const DATABASE_FILE_NAME = 'trace.db';
const DEFAULT_SERVE_HOST = '127.0.0.1';
const DEFAULT_SERVE_PORT = 3000;
const DEFAULT_WEB_PORT = 3001;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const USAGE = `Usage: agent-profile <command> [options]

Commands:
  help                 Show this help
  version              Show the CLI version
  doctor               Check the local Runtime, database, and source availability
  sources              Show local source availability and stored Session counts
  sync                 Synchronize available local sources and report terminal results
  serve                Start the local API and Web application
  sessions             List bounded primary Session summaries
  stats                Show the existing aggregate statistics report
  profiles             Show the existing Agent Process Profile report
  task-profile <id>    Show the existing Task Profile report
  diagnosis <id>       Show content-free diagnosis findings and Span references
  evidence <id>        Show bounded content-free evidence references
  task-outcome <id>    Record explicitly confirmed Outcome evidence
  task-feedback <id>  Show bounded post-run feedback with explicit opt-in

Options:
  --json               Write a versioned JSON report
  --database <path>    Select an explicit SQLite database path
  --data-dir <path>    Select a directory containing trace.db
  --source <id>        Limit sync to a source; may be repeated
  --host <address>     Select a loopback listen address for serve
  --port <number>      Select the public serve port (default 3000)
  --web-port <number>  Select the private Web process port (default 3001)
  --open                Open the local UI after serve is ready
  --limit <count>      Limit Session discovery to 1-100 records
  --cursor <value>     Continue Session discovery from a prior report
  --confirm            Confirm the explicit task-outcome write
  --evidence-kind <k>  Evidence kind for task-outcome
  --evidence-status <s> Evidence status for task-outcome
  --evidence-reference <r> Bounded evidence reference for task-outcome
  --evidence-source <s> Provenance source for task-outcome
  --evidence-source-id <id> Provenance source ID for task-outcome
  --opt-in              Explicitly request task-feedback
  --help               Show this help
  --version            Show the CLI version`;

export interface ParsedCliArguments {
  command: CliCommand;
  json: boolean;
  databasePath: string | undefined;
  dataDir: string | undefined;
  sourceIds: string[] | undefined;
  limit: number | undefined;
  cursor: string | undefined;
  taskId: string | undefined;
  confirmOutcome: boolean;
  evidenceKind: string | undefined;
  evidenceStatus: CliOutcomeEvidenceStatus | undefined;
  evidenceReference: string | undefined;
  evidenceSource: CliOutcomeEvidenceSource | undefined;
  evidenceSourceId: string | undefined;
  feedbackOptIn: boolean;
  host: string | undefined;
  port: number | undefined;
  webPort: number | undefined;
  openBrowser: boolean;
}

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

class CliUsageError extends Error {}

export function parseCliArguments(argv: string[]): ParsedCliArguments {
  let values: {
    json?: boolean;
    help?: boolean;
    version?: boolean;
    database?: string;
    'data-dir'?: string;
    source?: string[];
    limit?: string;
    cursor?: string;
    host?: string;
    port?: string;
    'web-port'?: string;
    open?: boolean;
    confirm?: boolean;
    'evidence-kind'?: string;
    'evidence-status'?: string;
    'evidence-reference'?: string;
    'evidence-source'?: string;
    'evidence-source-id'?: string;
    'opt-in'?: boolean;
  };
  let positionals: string[];

  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        json: { type: 'boolean' },
        help: { type: 'boolean' },
        version: { type: 'boolean' },
        database: { type: 'string' },
        'data-dir': { type: 'string' },
        source: { type: 'string', multiple: true },
        limit: { type: 'string' },
        cursor: { type: 'string' },
        host: { type: 'string' },
        port: { type: 'string' },
        'web-port': { type: 'string' },
        open: { type: 'boolean' },
        confirm: { type: 'boolean' },
        'evidence-kind': { type: 'string' },
        'evidence-status': { type: 'string' },
        'evidence-reference': { type: 'string' },
        'evidence-source': { type: 'string' },
        'evidence-source-id': { type: 'string' },
        'opt-in': { type: 'boolean' },
      },
    }));
  } catch (error) {
    throw new CliUsageError(errorMessage(error));
  }

  if (values.help && values.version) {
    throw new CliUsageError('Use either --help or --version, not both');
  }
  if (
    (values.help || values.version) &&
    (positionals.length > 1 || (positionals[0] !== undefined && !isCliCommand(positionals[0])))
  ) {
    throw new CliUsageError(`Unexpected arguments: ${positionals.join(', ')}`);
  }
  if (values.database && values['data-dir']) {
    throw new CliUsageError('Use either --database or --data-dir, not both');
  }
  if (values.database !== undefined && !values.database.trim()) {
    throw new CliUsageError('--database must not be empty');
  }
  if (values['data-dir'] !== undefined && !values['data-dir'].trim()) {
    throw new CliUsageError('--data-dir must not be empty');
  }
  if (values.source?.some((sourceId) => !sourceId.trim())) {
    throw new CliUsageError('--source must not be empty');
  }
  if (values.cursor !== undefined && !values.cursor.trim()) {
    throw new CliUsageError('--cursor must not be empty');
  }
  const limit = parseLimit(values.limit);
  const port = parsePort(values.port, '--port');
  const webPort = parsePort(values['web-port'], '--web-port');
  const evidenceStatus = parseEvidenceStatus(values['evidence-status']);
  const evidenceSource = parseEvidenceSource(values['evidence-source']);

  const requestedCommand = values.help
    ? 'help'
    : values.version
      ? 'version'
      : (positionals[0] ?? 'help');
  if (!isCliCommand(requestedCommand)) {
    throw new CliUsageError(`Unknown command: ${requestedCommand}`);
  }
  let taskId: string | undefined;
  if (
    requestedCommand === 'task-profile' ||
    requestedCommand === 'diagnosis' ||
    requestedCommand === 'evidence' ||
    requestedCommand === 'task-outcome' ||
    requestedCommand === 'task-feedback'
  ) {
    if (positionals.length !== 2 || !positionals[1]?.trim()) {
      throw new CliUsageError(`${requestedCommand} requires an ID`);
    }
    taskId = positionals[1];
  } else if (positionals.length > 1) {
    throw new CliUsageError(`Unexpected arguments: ${positionals.slice(1).join(', ')}`);
  }
  if (!usesRuntime(requestedCommand) && (values.database || values['data-dir'])) {
    throw new CliUsageError('--database and --data-dir are only supported by Runtime commands');
  }
  if (requestedCommand !== 'sync' && values.source) {
    throw new CliUsageError('--source is only supported by sync');
  }
  if (
    requestedCommand !== 'task-outcome' &&
    (values.confirm ||
      values['evidence-kind'] ||
      values['evidence-status'] ||
      values['evidence-reference'] ||
      values['evidence-source'] ||
      values['evidence-source-id'])
  ) {
    throw new CliUsageError('--confirm and --evidence-* are only supported by task-outcome');
  }
  if (requestedCommand !== 'task-feedback' && values['opt-in']) {
    throw new CliUsageError('--opt-in is only supported by task-feedback');
  }
  if (requestedCommand === 'task-outcome') {
    if (values.confirm !== true) throw new CliUsageError('task-outcome requires --confirm');
    if (!values['evidence-kind']?.trim()) {
      throw new CliUsageError('task-outcome requires --evidence-kind');
    }
    if (evidenceSource !== undefined && !values['evidence-source-id']?.trim()) {
      throw new CliUsageError('--evidence-source-id is required with --evidence-source');
    }
    if (values['evidence-source-id'] !== undefined && evidenceSource === undefined) {
      throw new CliUsageError('--evidence-source is required with --evidence-source-id');
    }
  }
  if (requestedCommand === 'task-feedback' && values['opt-in'] !== true) {
    throw new CliUsageError('task-feedback requires --opt-in');
  }
  if (
    requestedCommand !== 'sessions' &&
    (values.limit !== undefined || values.cursor !== undefined)
  ) {
    throw new CliUsageError('--limit and --cursor are only supported by sessions');
  }
  if (
    requestedCommand !== 'serve' &&
    (values.host !== undefined ||
      values.port !== undefined ||
      values['web-port'] !== undefined ||
      values.open !== undefined)
  ) {
    throw new CliUsageError('--host, --port, --web-port, and --open are only supported by serve');
  }
  const host = values.host?.trim() || DEFAULT_SERVE_HOST;
  const servePort = port ?? DEFAULT_SERVE_PORT;
  const serveWebPort = webPort ?? DEFAULT_WEB_PORT;
  if (requestedCommand === 'serve' && !LOOPBACK_HOSTS.has(host)) {
    throw new CliUsageError('--host must be a loopback address');
  }
  if (requestedCommand === 'serve' && servePort === serveWebPort) {
    throw new CliUsageError('--port and --web-port must be different');
  }

  return {
    command: requestedCommand,
    json: values.json === true,
    databasePath: values.database,
    dataDir: values['data-dir'],
    sourceIds: values.source,
    limit,
    cursor: values.cursor,
    taskId,
    confirmOutcome: values.confirm === true,
    evidenceKind: values['evidence-kind']?.trim() || undefined,
    evidenceStatus,
    evidenceReference: values['evidence-reference']?.trim() || undefined,
    evidenceSource,
    evidenceSourceId: values['evidence-source-id']?.trim() || undefined,
    feedbackOptIn: values['opt-in'] === true,
    host: requestedCommand === 'serve' ? host : undefined,
    port: requestedCommand === 'serve' ? servePort : undefined,
    webPort: requestedCommand === 'serve' ? serveWebPort : undefined,
    openBrowser: values.open === true,
  };
}

export function resolveDatabasePath(
  options: ParsedCliArguments,
  env: NodeJS.ProcessEnv,
  cwd: string,
  defaultDatabasePath: string,
): string {
  if (options.databasePath) return resolve(cwd, options.databasePath);
  if (options.dataDir) return resolve(cwd, options.dataDir, DATABASE_FILE_NAME);
  if (env.TRACE_DB_PATH?.trim()) return resolve(cwd, env.TRACE_DB_PATH.trim());
  return defaultDatabasePath;
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

function parseEvidenceStatus(value: string | undefined): CliOutcomeEvidenceStatus | undefined {
  if (value === undefined) return undefined;
  const statuses: CliOutcomeEvidenceStatus[] = [
    'not_captured',
    'observed',
    'passed',
    'failed',
    'skipped',
    'not_run',
  ];
  if (!statuses.includes(value as CliOutcomeEvidenceStatus)) {
    throw new CliUsageError('--evidence-status must be a supported Outcome evidence status');
  }
  return value as CliOutcomeEvidenceStatus;
}

function parseEvidenceSource(value: string | undefined): CliOutcomeEvidenceSource | undefined {
  if (value === undefined) return undefined;
  if (value !== 'local_session' && value !== 'local_git') {
    throw new CliUsageError('--evidence-source must be local_session or local_git');
  }
  return value;
}

function parsePort(value: string | undefined, option: '--port' | '--web-port'): number | undefined {
  if (value === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new CliUsageError(`${option} must be an integer from 1 to 65535`);
  }
  const port = Number(value);
  if (port > 65_535) throw new CliUsageError(`${option} must be an integer from 1 to 65535`);
  return port;
}

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new CliUsageError('--limit must be an integer from 1 to 100');
  }
  const limit = Number(value);
  if (limit > 100) throw new CliUsageError('--limit must be an integer from 1 to 100');
  return limit;
}

function isCliCommand(value: string): value is CliCommand {
  return (
    value === 'help' ||
    value === 'version' ||
    value === 'doctor' ||
    value === 'sources' ||
    value === 'sync' ||
    value === 'serve' ||
    value === 'sessions' ||
    value === 'stats' ||
    value === 'profiles' ||
    value === 'task-profile' ||
    value === 'diagnosis' ||
    value === 'evidence' ||
    value === 'task-outcome' ||
    value === 'task-feedback'
  );
}

function usesRuntime(command: CliCommand): boolean {
  return command !== 'help' && command !== 'version';
}

function isUsageError(error: unknown): boolean {
  return (
    error instanceof CliUsageError ||
    (error instanceof ImportServiceError && error.code === 'invalid_source') ||
    error instanceof SessionDiscoveryError
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected CLI error';
}
