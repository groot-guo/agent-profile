import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  CliAgentProfilesData,
  CliDiagnosisReport,
  CliEvidenceReport,
  CliStatsData,
  CliTaskOutcomeReport,
  CliTaskProfileData,
  ImportJobStatusResponse,
} from '@agent-profile/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  const importStatus = {
    jobId: null,
    active: false,
    operation: null,
    sources: [
      {
        id: 'codex' as const,
        label: 'Codex',
        available: true,
        state: 'idle' as const,
        result: null,
        startedAt: null,
        completedAt: null,
        error: null,
        storedSessions: 3,
      },
    ],
  };
  const sessionDiscovery = {
    limit: 1,
    hasMore: false,
    nextCursor: null,
    sessions: [
      {
        id: 'session-1',
        agent: 'codex',
        startTime: 1,
        endTime: 2,
        gitBranch: null,
        inputTokens: 1,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 1,
        totalCost: 0,
        costUnknownCount: 0,
        costCurrency: 'CNY',
        peakContextTokens: 1,
        avgContextTokens: 1,
        cacheHitRate: 0,
        messageCount: 1,
        importedAt: 2,
      },
    ],
  };
  const statistics: CliStatsData = {
    overview: {
      totalSessions: 1,
      totalTokens: 15,
      totalCost: 0.25,
      totalInputTokens: 10,
      totalOutputTokens: 5,
      avgCacheHitRate: 0.5,
      avgPeakContext: 10,
      sessionsWithCostUnknown: 0,
    },
    byAgent: [],
    byProject: [],
    byModel: [],
    recentTools: [],
    distribution: {
      costBins: [],
      tokenBins: [],
      modelDistribution: [],
      agentDistribution: [],
    },
  };
  const agentProfiles: CliAgentProfilesData = {
    schemaVersion: 'agent-profile/v1',
    generatedAt: 1,
    scope: { agents: ['codex'], sessions: 1 },
    comparison: { status: 'insufficient_data' },
    profiles: [],
    limitations: [],
  };
  const taskProfile: CliTaskProfileData = {
    schemaVersion: 'task-profile/v1',
    generatedAt: 1,
    task: { id: 'task-1', title: 'Fixture Task', type: 'feature', status: 'in_progress' },
    profile: { linkedSessions: 0, availableSessions: 0 },
    coverage: { outcome: { status: 'not_collected' } },
    limitations: [],
  };
  const diagnosis: CliDiagnosisReport['diagnosis'] = {
    schemaVersion: 'cli-diagnosis/v1',
    generatedAt: 1,
    session: { id: 'session-1', agent: 'codex', startTime: 1, endTime: 2 },
    findings: [
      {
        type: 'repeated_failure',
        severity: 'medium',
        wastedTokens: 10,
        wastedCost: 0,
        costUnknown: true,
        spanIds: ['span-1'],
      },
    ],
    totalWastedTokens: 10,
    totalWastedCost: 0,
    costUnknownCount: 1,
    semantic: {
      requested: false,
      consent: 'not_granted',
      status: 'not_requested',
      provider: null,
      audit: {
        recorded: false,
        retention: 'process_bounded_content_free',
        rawContentStored: false,
      },
    },
    limitations: [],
  };
  const evidence: CliEvidenceReport['evidence'] = {
    schemaVersion: 'cli-evidence/v1',
    generatedAt: 1,
    session: { id: 'session-1', agent: 'codex', startTime: 1, endTime: 2 },
    scope: { events: 1, returnedReferences: 1 },
    coverage: {
      timing: { observed: 1, total: 1, coverage: 1, status: 'complete' },
      parentLinks: { observed: 0, total: 0, coverage: null, status: 'not_applicable' },
      toolInputs: { observed: 0, total: 0, coverage: null, status: 'not_applicable' },
      toolOutputs: { observed: 0, total: 0, coverage: null, status: 'not_applicable' },
      modelIdentity: { observed: 0, total: 0, coverage: null, status: 'not_applicable' },
      content: { observed: 0, total: 0, coverage: null, status: 'not_captured' },
    },
    privacy: {
      contentMode: 'none',
      previewCharacters: 0,
      secretRedaction: true,
      rawContentIncluded: false,
    },
    references: [
      {
        sequence: 1,
        id: 'span-1',
        parentId: null,
        parentLink: 'root',
        type: 'llm_turn',
        lane: 'main',
        outcome: 'not_applicable',
        startTime: 1,
        endTime: 2,
        durationMs: 1,
      },
    ],
    limitations: [],
  };
  const outcome: CliTaskOutcomeReport['saved'] = {
    evidenceCount: 1,
    kind: 'review',
    status: 'observed',
    coverage: { observedFields: 0, totalFields: 5, status: 'not_collected' },
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
      getImportStatus: vi.fn(async () => importStatus),
      syncImports: vi.fn(async () => importStatus),
      discoverSessions: vi.fn(() => sessionDiscovery),
      getStatsReport: vi.fn(() => statistics),
      getAgentProfileReport: vi.fn(() => agentProfiles),
      getTaskProfileReport: vi.fn(() => taskProfile),
      getSessionDiagnosisReport: vi.fn(async () => diagnosis),
      getSessionEvidenceReport: vi.fn(() => evidence),
      recordTaskOutcomeEvidence: vi.fn(() => outcome),
      getTaskFeedbackReports: vi.fn(() => []),
      startServe: vi.fn(async (options) => ({
        url: `http://${options.host}:${options.port}`,
        apiUrl: `http://${options.host}:${options.port}/api`,
        databasePath: options.databasePath,
        host: options.host,
        port: options.port,
      })),
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

  it('parses loopback serve options and rejects unsafe or conflicting ports', () => {
    expect(parseCliArguments(['serve', '--help'])).toMatchObject({
      command: 'help',
    });
    expect(
      parseCliArguments([
        'serve',
        '--host',
        'localhost',
        '--port',
        '4100',
        '--web-port',
        '4101',
        '--open',
      ]),
    ).toMatchObject({
      command: 'serve',
      host: 'localhost',
      port: 4100,
      webPort: 4101,
      openBrowser: true,
    });
    expect(() => parseCliArguments(['serve', '--host', '0.0.0.0'])).toThrow(
      '--host must be a loopback address',
    );
    expect(() => parseCliArguments(['serve', '--port', '4100', '--web-port', '4100'])).toThrow(
      '--port and --web-port must be different',
    );
    expect(() => parseCliArguments(['doctor', '--port', '4100'])).toThrow(
      '--host, --port, --web-port, and --open are only supported by serve',
    );
  });

  it('starts serve with the selected database and writes readiness output', async () => {
    const { dependencies, output, runtimeOptions } = createDependencies();

    const exitCode = await runCli(
      ['serve', '--data-dir', 'state', '--port', '4100', '--web-port', '4101', '--json'],
      dependencies,
    );

    expect(exitCode).toBe(0);
    expect(runtimeOptions).toEqual([]);
    expect(dependencies.startServe).toHaveBeenCalledWith({
      databasePath: '/workspace/state/trace.db',
      defaultScanDir: '~/.claude/projects',
      host: '127.0.0.1',
      port: 4100,
      webPort: 4101,
      openBrowser: false,
    });
    expect(JSON.parse(output.stdout.join(''))).toMatchObject({
      schemaVersion: 'agent-profile-cli/v1',
      command: 'serve',
      url: 'http://127.0.0.1:4100',
      apiUrl: 'http://127.0.0.1:4100/api',
      databasePath: '/workspace/state/trace.db',
    });
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

  it('writes refreshed source status without starting an import', async () => {
    const { dependencies, output, runtimeOptions, closeCalls } = createDependencies();

    const exitCode = await runCli(['sources', '--json'], dependencies);

    expect(exitCode).toBe(0);
    expect(runtimeOptions).toEqual([
      {
        databasePath: '/default/trace.db',
        autoScanDir: null,
        defaultScanDir: '~/.claude/projects',
      },
    ]);
    expect(closeCalls()).toBe(1);
    expect(JSON.parse(output.stdout.join(''))).toMatchObject({
      command: 'sources',
      imports: { active: false },
      sources: [{ id: 'codex', storedSessions: 3 }],
    });
  });

  it('writes a bounded Session discovery report and closes the Runtime', async () => {
    const { dependencies, output, closeCalls } = createDependencies();

    const exitCode = await runCli(
      ['sessions', '--limit', '1', '--cursor', 'next-page', '--json'],
      dependencies,
    );

    expect(exitCode).toBe(0);
    expect(dependencies.discoverSessions).toHaveBeenCalledWith(expect.anything(), {
      limit: 1,
      cursor: 'next-page',
    });
    expect(closeCalls()).toBe(1);
    expect(JSON.parse(output.stdout.join(''))).toMatchObject({
      schemaVersion: 'agent-profile-cli/v1',
      command: 'sessions',
      limit: 1,
    });
  });

  it('writes existing statistics, Agent Process Profile, and Task Profile reports', async () => {
    const stats = createDependencies();
    const profiles = createDependencies();
    const taskProfile = createDependencies();

    expect(await runCli(['stats', '--json'], stats.dependencies)).toBe(0);
    expect(await runCli(['profiles', '--json'], profiles.dependencies)).toBe(0);
    expect(await runCli(['task-profile', 'task-1', '--json'], taskProfile.dependencies)).toBe(0);

    expect(stats.dependencies.getStatsReport).toHaveBeenCalledWith(expect.anything());
    expect(profiles.dependencies.getAgentProfileReport).toHaveBeenCalledWith(expect.anything());
    expect(taskProfile.dependencies.getTaskProfileReport).toHaveBeenCalledWith(
      expect.anything(),
      'task-1',
    );
    expect(JSON.parse(stats.output.stdout.join(''))).toMatchObject({
      command: 'stats',
      statistics: { overview: { totalSessions: 1 } },
    });
    expect(JSON.parse(profiles.output.stdout.join(''))).toMatchObject({
      command: 'profiles',
      agentProfiles: { schemaVersion: 'agent-profile/v1' },
    });
    expect(JSON.parse(taskProfile.output.stdout.join(''))).toMatchObject({
      command: 'task-profile',
      taskId: 'task-1',
      taskProfile: { schemaVersion: 'task-profile/v1' },
    });
  });

  it('runs content-free diagnosis/evidence and explicit Outcome/feedback workflows', async () => {
    const diagnosis = createDependencies();
    const evidence = createDependencies();
    const outcome = createDependencies();
    const feedback = createDependencies();

    expect(await runCli(['diagnosis', 'session-1', '--json'], diagnosis.dependencies)).toBe(0);
    expect(await runCli(['evidence', 'session-1', '--json'], evidence.dependencies)).toBe(0);
    expect(
      await runCli(
        [
          'task-outcome',
          'task-1',
          '--confirm',
          '--evidence-kind',
          'review',
          '--evidence-status',
          'observed',
          '--evidence-source',
          'local_session',
          '--evidence-source-id',
          'session-1',
          '--json',
        ],
        outcome.dependencies,
      ),
    ).toBe(0);
    expect(
      await runCli(['task-feedback', 'task-1', '--opt-in', '--json'], feedback.dependencies),
    ).toBe(0);

    expect(JSON.parse(diagnosis.output.stdout.join(''))).toMatchObject({
      command: 'diagnosis',
      diagnosis: { schemaVersion: 'cli-diagnosis/v1', findings: [{ spanIds: ['span-1'] }] },
    });
    expect(JSON.parse(evidence.output.stdout.join(''))).toMatchObject({
      command: 'evidence',
      evidence: { schemaVersion: 'cli-evidence/v1', references: [{ id: 'span-1' }] },
    });
    expect(outcome.dependencies.recordTaskOutcomeEvidence).toHaveBeenCalledWith(
      expect.anything(),
      'task-1',
      expect.objectContaining({
        kind: 'review',
        status: 'observed',
        provenance: expect.objectContaining({ source: 'local_session', sourceId: 'session-1' }),
      }),
    );
    expect(JSON.parse(feedback.output.stdout.join(''))).toMatchObject({
      command: 'task-feedback',
      feedback: [],
    });
  });

  it('synchronizes selected sources through the shared Runtime service', async () => {
    const { dependencies, output, closeCalls } = createDependencies();

    const exitCode = await runCli(
      ['sync', '--source', 'codex', '--source', 'zed', '--json'],
      dependencies,
    );

    expect(exitCode).toBe(0);
    expect(dependencies.syncImports).toHaveBeenCalledWith(expect.anything(), ['codex', 'zed']);
    expect(closeCalls()).toBe(1);
    expect(JSON.parse(output.stdout.join(''))).toMatchObject({
      command: 'sync',
      requestedSources: ['codex', 'zed'],
      imports: { active: false },
    });
  });

  it('reports a selected source failure and exits unsuccessfully', async () => {
    const { dependencies, output, closeCalls } = createDependencies();
    const failedStatus: ImportJobStatusResponse = {
      jobId: 'sync-1',
      active: false,
      operation: null,
      sources: [
        {
          id: 'codex',
          label: 'Codex',
          available: true,
          state: 'failed',
          result: null,
          startedAt: 1,
          completedAt: 2,
          error: 'source_scan_failed',
          storedSessions: 3,
        },
      ],
    };
    vi.mocked(dependencies.syncImports).mockResolvedValue(failedStatus);

    const exitCode = await runCli(['sync', '--source', 'codex', '--json'], dependencies);

    expect(exitCode).toBe(1);
    expect(closeCalls()).toBe(1);
    expect(JSON.parse(output.stdout.join(''))).toMatchObject({
      command: 'sync',
      requestedSources: ['codex'],
      sources: [{ id: 'codex', state: 'failed', error: 'source_scan_failed' }],
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

    const exitCode = await runCli(['reports'], dependencies);

    expect(exitCode).toBe(2);
    expect(runtimeOptions).toEqual([]);
    expect(output.stderr.join('')).toContain('Unknown command: reports');
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

  it('runs the workspace sources command without importing local data', () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-profile-cli-sources-'));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, 'trace.db');
    const binaryPath = fileURLToPath(new URL('../bin/agent-profile.mjs', import.meta.url));

    const result = spawnSync(
      process.execPath,
      [binaryPath, 'sources', '--json', '--database', databasePath],
      { encoding: 'utf8', timeout: 10_000 },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      schemaVersion: 'agent-profile-cli/v1',
      command: 'sources',
      imports: { active: false },
    });
    expect(JSON.parse(result.stdout).sources).toHaveLength(5);
    expect(result.stdout).not.toContain('/Users/');
  });

  it('runs the workspace sessions command with the bounded default page', () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-profile-cli-sessions-'));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, 'trace.db');
    const binaryPath = fileURLToPath(new URL('../bin/agent-profile.mjs', import.meta.url));

    const result = spawnSync(
      process.execPath,
      [binaryPath, 'sessions', '--json', '--database', databasePath],
      { encoding: 'utf8', timeout: 10_000 },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      schemaVersion: 'agent-profile-cli/v1',
      command: 'sessions',
      limit: 20,
      hasMore: false,
      sessions: [],
    });
  });

  it('runs the workspace statistics and profiles commands on an empty database', () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-profile-cli-reports-'));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, 'trace.db');
    const binaryPath = fileURLToPath(new URL('../bin/agent-profile.mjs', import.meta.url));

    const stats = spawnSync(
      process.execPath,
      [binaryPath, 'stats', '--json', '--database', databasePath],
      { encoding: 'utf8', timeout: 10_000 },
    );
    const profiles = spawnSync(
      process.execPath,
      [binaryPath, 'profiles', '--json', '--database', databasePath],
      { encoding: 'utf8', timeout: 10_000 },
    );

    expect(stats.status).toBe(0);
    expect(profiles.status).toBe(0);
    expect(JSON.parse(stats.stdout)).toMatchObject({
      command: 'stats',
      statistics: { overview: { totalSessions: 0 } },
    });
    expect(JSON.parse(profiles.stdout)).toMatchObject({
      command: 'profiles',
      agentProfiles: { schemaVersion: 'agent-profile/v1', scope: { sessions: 0 } },
    });
  });
});
