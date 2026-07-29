import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  CLI_SCHEMA_VERSION,
  type CliCommand,
  type CliDoctorReport,
  type CliDoctorSource,
  type CliHelpReport,
  type CliReport,
  type CliVersionReport,
} from '@agent-profile/contracts';

const DATABASE_FILE_NAME = 'trace.db';
const USAGE = `Usage: agent-profile <command> [options]

Commands:
  help                 Show this help
  version              Show the CLI version
  doctor               Check the local Runtime, database, and source availability

Options:
  --json               Write a versioned JSON report
  --database <path>    Select an explicit SQLite database path
  --data-dir <path>    Select a directory containing trace.db
  --help               Show this help
  --version            Show the CLI version`;

export interface ParsedCliArguments {
  command: CliCommand;
  json: boolean;
  databasePath: string | undefined;
  dataDir: string | undefined;
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
      },
    }));
  } catch (error) {
    throw new CliUsageError(errorMessage(error));
  }

  if (values.help && values.version) {
    throw new CliUsageError('Use either --help or --version, not both');
  }
  if (positionals.length > 1) {
    throw new CliUsageError(`Unexpected arguments: ${positionals.slice(1).join(', ')}`);
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

  const requestedCommand = values.help
    ? 'help'
    : values.version
      ? 'version'
      : (positionals[0] ?? 'help');
  if (!isCliCommand(requestedCommand)) {
    throw new CliUsageError(`Unknown command: ${requestedCommand}`);
  }
  if (requestedCommand !== 'doctor' && (values.database || values['data-dir'])) {
    throw new CliUsageError('--database and --data-dir are only supported by doctor');
  }

  return {
    command: requestedCommand,
    json: values.json === true,
    databasePath: values.database,
    dataDir: values['data-dir'],
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
    const report = await doctor(databasePath, dependencies);
    writeReport(report, options.json, dependencies);
    return 0;
  } catch (error) {
    dependencies.writeStderr(`${errorMessage(error)}\n`);
    return error instanceof CliUsageError ? 2 : 1;
  }
}

async function doctor(
  databasePath: string,
  dependencies: CliDependencies,
): Promise<CliDoctorReport> {
  const existedBeforeRuntime = dependencies.fileExists(databasePath);
  const runtime = dependencies.createRuntime({
    databasePath,
    autoScanDir: null,
    defaultScanDir: dependencies.defaultScanDir,
  });
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

function helpReport(): CliHelpReport {
  return {
    schemaVersion: CLI_SCHEMA_VERSION,
    command: 'help',
    usage: USAGE,
    commands: ['help', 'version', 'doctor'],
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

function isCliCommand(value: string): value is CliCommand {
  return value === 'help' || value === 'version' || value === 'doctor';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected CLI error';
}
