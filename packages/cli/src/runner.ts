import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  CLI_SCHEMA_VERSION,
  type CliCommand,
  type CliDoctorReport,
  type CliDoctorSource,
  type CliHelpReport,
  type CliImportStatus,
  type CliProfilesReport,
  type CliReport,
  type CliSessionDiscoveryPage,
  type CliSessionsReport,
  type CliSourcesReport,
  type CliStatsData,
  type CliStatsReport,
  type CliSyncReport,
  type CliTaskProfileReport,
  type CliVersionReport,
  type ImportJobStatusResponse,
  type ImportSourceId,
} from '@agent-profile/contracts';
import { ImportServiceError } from 'trace-server/imports';
import { SessionDiscoveryError } from 'trace-server/sessions';

const DATABASE_FILE_NAME = 'trace.db';
const USAGE = `Usage: agent-profile <command> [options]

Commands:
  help                 Show this help
  version              Show the CLI version
  doctor               Check the local Runtime, database, and source availability
  sources              Show local source availability and stored Session counts
  sync                 Synchronize available local sources and report terminal results
  sessions             List bounded primary Session summaries
  stats                Show the existing aggregate statistics report
  profiles             Show the existing Agent Process Profile report
  task-profile <id>    Show the existing Task Profile report

Options:
  --json               Write a versioned JSON report
  --database <path>    Select an explicit SQLite database path
  --data-dir <path>    Select a directory containing trace.db
  --source <id>        Limit sync to a source; may be repeated
  --limit <count>      Limit Session discovery to 1-100 records
  --cursor <value>     Continue Session discovery from a prior report
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
  getTaskProfileReport: (
    runtime: CliRuntime,
    taskId: string,
  ) => CliTaskProfileReport['taskProfile'];
  writeStdout: (text: string) => void;
  writeStderr: (text: string) => void;
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
      },
    }));
  } catch (error) {
    throw new CliUsageError(errorMessage(error));
  }

  if (values.help && values.version) {
    throw new CliUsageError('Use either --help or --version, not both');
  }
  if ((values.help || values.version) && positionals.length > 0) {
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

  const requestedCommand = values.help
    ? 'help'
    : values.version
      ? 'version'
      : (positionals[0] ?? 'help');
  if (!isCliCommand(requestedCommand)) {
    throw new CliUsageError(`Unknown command: ${requestedCommand}`);
  }
  let taskId: string | undefined;
  if (requestedCommand === 'task-profile') {
    if (positionals.length !== 2 || !positionals[1]?.trim()) {
      throw new CliUsageError('task-profile requires a Task ID');
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
    requestedCommand !== 'sessions' &&
    (values.limit !== undefined || values.cursor !== undefined)
  ) {
    throw new CliUsageError('--limit and --cursor are only supported by sessions');
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
      'sessions',
      'stats',
      'profiles',
      'task-profile',
    ],
  };
}

function versionReport(version: string): CliVersionReport {
  return { schemaVersion: CLI_SCHEMA_VERSION, command: 'version', version };
}

function writeReport(report: CliReport, asJson: boolean, dependencies: CliDependencies): void {
  dependencies.writeStdout(asJson ? `${JSON.stringify(report)}\n` : formatReport(report));
}

function formatReport(report: CliReport): string {
  if (report.command === 'help') return `${report.usage}\n`;
  if (report.command === 'version') return `${report.version}\n`;
  if (report.command === 'sources' || report.command === 'sync') return formatSourcesReport(report);
  if (report.command === 'sessions') return formatSessionsReport(report);
  if (report.command === 'stats') return formatStatsReport(report);
  if (report.command === 'profiles') return formatProfilesReport(report);
  if (report.command === 'task-profile') return formatTaskProfileReport(report);

  const sourceLines = report.sources.map((source) => {
    const availability = source.available ? 'available' : 'unavailable';
    return `  ${source.label}: ${availability} (${source.state})`;
  });
  const databaseState = report.database.existedBeforeRuntime ? 'existing' : 'initialized';
  return [
    'Agent Profile doctor',
    `Database: ${report.database.path} (${databaseState})`,
    `Imports: ${report.imports.active ? 'active' : 'idle'} (not started by doctor)`,
    'Sources:',
    ...sourceLines,
    ...report.limitations.map((limitation) => `Note: ${limitation}`),
    '',
  ].join('\n');
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

function formatSessionsReport(report: CliSessionsReport): string {
  const rows = report.sessions.map((session) => {
    const cost = session.costUnknownCount > 0 ? 'unknown' : session.totalCost.toFixed(6);
    return `  ${session.id}  ${session.agent}  ${new Date(session.startTime).toISOString()}  cost ${cost}`;
  });
  return [
    'Agent Profile sessions',
    `Returned: ${report.sessions.length}; limit ${report.limit}; ${report.hasMore ? 'more available' : 'end reached'}`,
    'Sessions:',
    ...rows,
    ...(report.nextCursor ? [`Next cursor: ${report.nextCursor}`] : []),
    ...report.limitations.map((limitation) => `Note: ${limitation}`),
    '',
  ].join('\n');
}

function formatStatsReport(report: CliStatsReport): string {
  const { overview } = report.statistics;
  return [
    'Agent Profile stats',
    `Sessions: ${overview.totalSessions}`,
    `Tokens: ${overview.totalTokens}`,
    `Cost: ${overview.sessionsWithCostUnknown > 0 ? 'partial' : overview.totalCost.toFixed(6)}`,
    `Agents: ${report.statistics.byAgent.length}; projects: ${report.statistics.byProject.length}`,
    ...report.limitations.map((limitation) => `Note: ${limitation}`),
    '',
  ].join('\n');
}

function formatProfilesReport(report: CliProfilesReport): string {
  const profile = report.agentProfiles;
  return [
    'Agent Profile profiles',
    `Agents: ${profile.scope.agents.join(', ') || 'none'}`,
    `Sessions: ${profile.scope.sessions}`,
    `Comparison: ${profile.comparison.status}`,
    ...profile.limitations.map((limitation) => `Report limitation: ${limitation}`),
    ...report.limitations.map((limitation) => `Note: ${limitation}`),
    '',
  ].join('\n');
}

function formatTaskProfileReport(report: CliTaskProfileReport): string {
  const profile = report.taskProfile;
  return [
    'Agent Profile task-profile',
    `Task: ${profile.task.title} (${profile.task.id})`,
    `Sessions: ${profile.profile.availableSessions}/${profile.profile.linkedSessions} available`,
    `Outcome coverage: ${profile.coverage.outcome.status}`,
    ...profile.limitations.map((limitation) => `Report limitation: ${limitation}`),
    ...report.limitations.map((limitation) => `Note: ${limitation}`),
    '',
  ].join('\n');
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

function formatSourcesReport(report: CliSourcesReport | CliSyncReport): string {
  const sourceLines = report.sources.map((source) => {
    const result = source.result
      ? `; imported ${source.result.imported}, updated ${source.result.updated}, failed ${source.result.failed}`
      : '';
    return `  ${source.label}: ${source.available ? 'available' : 'unavailable'} (${source.state}); stored ${source.storedSessions}${result}`;
  });
  return [
    `Agent Profile ${report.command}`,
    `Imports: ${report.imports.active ? 'active' : 'idle'}${report.imports.operation ? ` (${report.imports.operation})` : ''}`,
    ...(report.command === 'sync'
      ? [`Requested sources: ${report.requestedSources.join(', ')}`]
      : []),
    'Sources:',
    ...sourceLines,
    ...report.limitations.map((limitation) => `Note: ${limitation}`),
    '',
  ].join('\n');
}

function isCliCommand(value: string): value is CliCommand {
  return (
    value === 'help' ||
    value === 'version' ||
    value === 'doctor' ||
    value === 'sources' ||
    value === 'sync' ||
    value === 'sessions' ||
    value === 'stats' ||
    value === 'profiles' ||
    value === 'task-profile'
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
