import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { CliDependencies, CliRuntime } from './runner';
import { parseCliArguments, resolveDatabasePath, runCli } from './runner';

function createDependencies(): {
  dependencies: CliDependencies;
  output: { stdout: string[]; stderr: string[] };
  runtimeOptions: Array<{ databasePath: string; autoScanDir: null; defaultScanDir: string }>;
  closeCalls: () => number;
} {
  const output = { stdout: [] as string[], stderr: [] as string[] };
  const runtimeOptions: Array<{
    databasePath: string;
    autoScanDir: null;
    defaultScanDir: string;
  }> = [];
  let closed = 0;
  const runtime: CliRuntime = {
    imports: {
      jobs: {
        refreshAvailability: async () => ({
          active: false,
          sources: [
            { id: 'codex', label: 'Codex', available: true, state: 'idle' },
            { id: 'zed', label: 'Zed', available: false, state: 'idle' },
          ],
        }),
      },
    },
    close: async () => {
      closed++;
    },
  };

  return {
    dependencies: {
      cwd: '/workspace',
      defaultDatabasePath: '/default/trace.db',
      defaultScanDir: '~/.claude/projects',
      env: {},
      fileExists: () => false,
      version: '0.0.1',
      createRuntime: (options) => {
        runtimeOptions.push(options);
        return runtime;
      },
      writeStdout: (text) => output.stdout.push(text),
      writeStderr: (text) => output.stderr.push(text),
    },
    output,
    runtimeOptions,
    closeCalls: () => closed,
  };
}

describe('CLI runner', () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('uses explicit database and data directory paths before environment and defaults', () => {
    expect(
      resolveDatabasePath(
        { command: 'doctor', json: false, databasePath: 'custom.db', dataDir: undefined },
        { TRACE_DB_PATH: 'environment.db' },
        '/workspace',
        '/default/trace.db',
      ),
    ).toBe('/workspace/custom.db');
    expect(
      resolveDatabasePath(
        { command: 'doctor', json: false, databasePath: undefined, dataDir: 'state' },
        { TRACE_DB_PATH: 'environment.db' },
        '/workspace',
        '/default/trace.db',
      ),
    ).toBe('/workspace/state/trace.db');
    expect(
      resolveDatabasePath(
        { command: 'doctor', json: false, databasePath: undefined, dataDir: undefined },
        { TRACE_DB_PATH: '  environment.db  ' },
        '/workspace',
        '/default/trace.db',
      ),
    ).toBe('/workspace/environment.db');
  });

  it('rejects conflicting database options before creating a Runtime', async () => {
    const { dependencies, runtimeOptions } = createDependencies();

    const exitCode = await runCli(
      ['doctor', '--database', 'one.db', '--data-dir', 'state'],
      dependencies,
    );

    expect(exitCode).toBe(2);
    expect(runtimeOptions).toEqual([]);
  });

  it('writes the doctor report as JSON and closes the Runtime', async () => {
    const { dependencies, output, runtimeOptions, closeCalls } = createDependencies();

    const exitCode = await runCli(['doctor', '--json', '--data-dir', 'state'], dependencies);

    expect(exitCode).toBe(0);
    expect(runtimeOptions).toEqual([
      {
        databasePath: '/workspace/state/trace.db',
        autoScanDir: null,
        defaultScanDir: '~/.claude/projects',
      },
    ]);
    expect(closeCalls()).toBe(1);
    expect(JSON.parse(output.stdout.join(''))).toMatchObject({
      schemaVersion: 'agent-profile-cli/v1',
      command: 'doctor',
      database: { path: '/workspace/state/trace.db', existedBeforeRuntime: false },
      imports: { active: false },
      sources: [
        { id: 'codex', available: true, state: 'idle' },
        { id: 'zed', available: false, state: 'idle' },
      ],
    });
  });

  it('writes a human-readable doctor report', async () => {
    const { dependencies, output } = createDependencies();

    const exitCode = await runCli(['doctor'], dependencies);

    expect(exitCode).toBe(0);
    expect(output.stdout.join('')).toContain('Agent Profile doctor');
    expect(output.stdout.join('')).toContain('Codex: available (idle)');
    expect(output.stdout.join('')).toContain('Imports: idle (not started by doctor)');
  });

  it('returns a runtime failure after closing a Runtime whose source check fails', async () => {
    const { dependencies, output } = createDependencies();
    let closeCalls = 0;
    dependencies.createRuntime = () => ({
      imports: {
        jobs: {
          refreshAvailability: async () => {
            throw new Error('availability failed');
          },
        },
      },
      close: async () => {
        closeCalls++;
      },
    });

    const exitCode = await runCli(['doctor'], dependencies);

    expect(exitCode).toBe(1);
    expect(closeCalls).toBe(1);
    expect(output.stderr.join('')).toContain('availability failed');
  });

  it('keeps help and version commands independent from Runtime construction', async () => {
    const { dependencies, output, runtimeOptions } = createDependencies();

    expect(await runCli(['--version', '--json'], dependencies)).toBe(0);
    expect(await runCli(['help'], dependencies)).toBe(0);
    expect(runtimeOptions).toEqual([]);
    expect(JSON.parse(output.stdout[0])).toMatchObject({
      schemaVersion: 'agent-profile-cli/v1',
      command: 'version',
      version: '0.0.1',
    });
  });

  it('reports the version from package metadata', async () => {
    const packageMetadata = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ) as { version: string };
    const { CLI_VERSION } = await import('./main');

    expect(CLI_VERSION).toBe(packageMetadata.version);
  });

  it('reports unknown commands as usage errors', async () => {
    const { dependencies, output, runtimeOptions } = createDependencies();

    const exitCode = await runCli(['sync'], dependencies);

    expect(exitCode).toBe(2);
    expect(runtimeOptions).toEqual([]);
    expect(output.stderr.join('')).toContain('Unknown command: sync');
  });

  it('parses only one command and rejects unexpected positional arguments', () => {
    expect(parseCliArguments(['doctor'])).toMatchObject({ command: 'doctor', json: false });
    expect(() => parseCliArguments(['doctor', 'extra'])).toThrow('Unexpected arguments: extra');
  });

  it('initializes and closes a temporary selected database through the executable command', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-profile-cli-'));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, 'trace.db');
    const { createDefaultCliDependencies } = await import('./main');
    const output = { stdout: [] as string[], stderr: [] as string[] };

    const exitCode = await runCli(['doctor', '--json', '--database', databasePath], {
      ...createDefaultCliDependencies(),
      writeStdout: (text) => output.stdout.push(text),
      writeStderr: (text) => output.stderr.push(text),
    });

    expect(exitCode).toBe(0);
    expect(existsSync(databasePath)).toBe(true);
    expect(JSON.parse(output.stdout.join(''))).toMatchObject({
      command: 'doctor',
      database: { path: databasePath, existedBeforeRuntime: false },
      imports: { active: false },
    });
    expect(JSON.parse(output.stdout.join('')).sources).toHaveLength(5);
  });

  it('runs the workspace binary with stable JSON output and exit status', () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-profile-cli-bin-'));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, 'trace.db');
    const binaryPath = fileURLToPath(new URL('../bin/agent-profile.mjs', import.meta.url));

    const result = spawnSync(
      process.execPath,
      [binaryPath, 'doctor', '--json', '--database', databasePath],
      { encoding: 'utf8', timeout: 10_000 },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      schemaVersion: 'agent-profile-cli/v1',
      command: 'doctor',
      database: { path: databasePath, existedBeforeRuntime: false },
    });
  });
});
