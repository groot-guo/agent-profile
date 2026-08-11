import { realpathSync, statSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { parseArgs } from 'node:util';
import type {
  CliCommand,
  CliOutcomeEvidenceSource,
  CliOutcomeEvidenceStatus,
} from '@agent-profile/contracts';
import { projectDatabasePathFor } from 'trace-server/data-path';

const DATABASE_FILE_NAME = 'trace.db';
const DEFAULT_SERVE_HOST = '127.0.0.1';
const DEFAULT_SERVE_PORT = 3000;
const DEFAULT_WEB_PORT = 3001;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export const USAGE = `Usage: agent-profile <command> [options]

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
  --project <path>     Select a project root and its local data scope
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
  projectPath: string | undefined;
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

export class CliUsageError extends Error {}

export function parseCliArguments(argv: string[]): ParsedCliArguments {
  let values: {
    json?: boolean;
    help?: boolean;
    version?: boolean;
    database?: string;
    'data-dir'?: string;
    project?: string;
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
        project: { type: 'string' },
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
  if (values.project !== undefined && !values.project.trim()) {
    throw new CliUsageError('--project must not be empty');
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
  if (!usesRuntime(requestedCommand) && (values.database || values['data-dir'] || values.project)) {
    throw new CliUsageError(
      '--database, --data-dir, and --project are only supported by Runtime commands',
    );
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
    projectPath: values.project?.trim() || undefined,
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
  projectRoot?: string | null,
): string {
  if (options.databasePath) return resolvePath(cwd, options.databasePath);
  if (options.dataDir) return resolvePath(cwd, options.dataDir, DATABASE_FILE_NAME);
  if (projectRoot) return projectDatabasePathFor(projectRoot);
  if (env.TRACE_DB_PATH?.trim()) return resolvePath(cwd, env.TRACE_DB_PATH.trim());
  return defaultDatabasePath;
}

export function resolveProjectRoot(projectPath: string | undefined, cwd: string): string | null {
  if (!projectPath) return null;
  const candidate = resolvePath(cwd, projectPath);
  try {
    if (!statSync(candidate).isDirectory()) {
      throw new CliUsageError('--project must point to a directory');
    }
    return realpathSync(candidate);
  } catch (error) {
    if (error instanceof CliUsageError) throw error;
    throw new CliUsageError(`--project directory is not available: ${candidate}`);
  }
}

export function isCliCommand(value: string): value is CliCommand {
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

export function usesRuntime(command: CliCommand): boolean {
  return command !== 'help' && command !== 'version';
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected CLI error';
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
