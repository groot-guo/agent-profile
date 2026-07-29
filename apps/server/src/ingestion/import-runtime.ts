import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { type ScanResult, zedThreadsDbPath } from '@agent-profile/core';
import type { DatabaseConnection } from '../database';
import type { PricingResolver } from '../runtime';
import { importFromSource } from './import-coordinator';
import {
  ImportJobManager,
  type ImportJobStatus,
  type ImportSourceDefinition,
  type ImportSourceId,
} from './import-job-manager';
import { MiMoSourceAdapter } from './mimo-adapter';
import { OpenCodeSourceAdapter } from './opencode-adapter';
import { SessionRepository } from './session-repository';
import { TranscriptSourceAdapter } from './transcript-adapter';
import { ZedSourceAdapter } from './zed-adapter';

export interface ImportRuntimeOptions {
  database: DatabaseConnection;
  pricingResolver: PricingResolver;
  autoScanDir: string | null;
  defaultScanDir: string;
  sourceDefinitions?: ImportSourceDefinition[];
  onError?: (source: ImportSourceDefinition, error: unknown) => void;
}

export class ImportRuntime {
  readonly jobs: ImportJobManager;
  private readonly repository: SessionRepository;
  private readonly compatibilityScans = new Set<Promise<ScanResult>>();
  private readonly autoScanDir: string | null;
  private readonly defaultScanDir: string;
  private readonly claudeDirectory: string;
  private readonly codexDirectory = '~/.codex/sessions';
  private readonly mimoDatabasePath = `${homedir()}/.local/share/mimocode/mimocode.db`;
  private readonly openCodeDatabasePath = `${homedir()}/.local/share/opencode/opencode.db`;
  private readonly zedDatabasePath = zedThreadsDbPath();

  constructor(options: ImportRuntimeOptions) {
    this.repository = new SessionRepository(options.database, options.pricingResolver);
    this.autoScanDir = options.autoScanDir;
    this.defaultScanDir = options.defaultScanDir;
    this.claudeDirectory =
      options.autoScanDir && options.autoScanDir !== options.defaultScanDir
        ? options.autoScanDir
        : options.defaultScanDir;
    this.jobs = new ImportJobManager(
      options.sourceDefinitions ?? this.createDefaultSourceDefinitions(),
      options.onError,
    );
  }

  startStartupImports(): Promise<ImportJobStatus> {
    const sources: ImportSourceId[] = ['zed', 'mimo-code', 'opencode'];
    if (this.autoScanDir) {
      sources.push('claude-code');
      if (this.autoScanDir === this.defaultScanDir) sources.push('codex');
    }
    return this.jobs.start(sources);
  }

  runCompatibilityScan(directory: string, agent?: string): Promise<ScanResult> {
    const sourceId = this.knownTranscriptSource(directory, agent);
    if (sourceId) return this.jobs.runAndWait(sourceId);

    const scan = this.scanTranscriptDirectory(directory, agent);
    this.compatibilityScans.add(scan);
    void scan.then(
      () => this.compatibilityScans.delete(scan),
      () => this.compatibilityScans.delete(scan),
    );
    return scan;
  }

  resetGeneratedData(): { sessions: number; spans: number; annotatedSessions: number } {
    return this.repository.resetGeneratedData();
  }

  async waitForIdle(): Promise<void> {
    await this.jobs.waitForIdle();
    while (this.compatibilityScans.size > 0) {
      await Promise.allSettled(this.compatibilityScans);
    }
  }

  private createDefaultSourceDefinitions(): ImportSourceDefinition[] {
    return [
      {
        id: 'claude-code',
        label: 'Claude Code',
        isAvailable: () => pathAvailable(this.claudeDirectory),
        run: (operation) =>
          this.scanTranscriptDirectory(this.claudeDirectory, 'claude-code', {
            force: operation === 'rebuild',
          }),
      },
      {
        id: 'codex',
        label: 'Codex',
        isAvailable: () => pathAvailable(this.codexDirectory),
        run: (operation) =>
          this.scanTranscriptDirectory(this.codexDirectory, 'codex', {
            force: operation === 'rebuild',
          }),
      },
      {
        id: 'zed',
        label: 'Zed',
        isAvailable: () => pathAvailable(this.zedDatabasePath),
        run: (operation) =>
          importFromSource(
            new ZedSourceAdapter({ databasePath: this.zedDatabasePath }),
            this.repository,
            { force: operation === 'rebuild' },
          ),
      },
      {
        id: 'mimo-code',
        label: 'MiMo Code',
        isAvailable: () => pathAvailable(this.mimoDatabasePath),
        run: (operation) =>
          importFromSource(new MiMoSourceAdapter(this.mimoDatabasePath), this.repository, {
            force: operation === 'rebuild',
          }),
      },
      {
        id: 'opencode',
        label: 'OpenCode',
        isAvailable: () => pathAvailable(this.openCodeDatabasePath),
        run: (operation) =>
          importFromSource(new OpenCodeSourceAdapter(this.openCodeDatabasePath), this.repository, {
            force: operation === 'rebuild',
          }),
      },
    ];
  }

  private scanTranscriptDirectory(
    directory: string,
    agent?: string,
    options: { force?: boolean } = {},
  ): Promise<ScanResult> {
    return importFromSource(
      new TranscriptSourceAdapter(directory, agent),
      this.repository,
      options,
    );
  }

  private knownTranscriptSource(directory: string, agent?: string): ImportSourceId | undefined {
    if (directory === this.claudeDirectory && (!agent || agent === 'claude-code')) {
      return 'claude-code';
    }
    if (directory === this.codexDirectory && (!agent || agent === 'codex')) return 'codex';
    return undefined;
  }
}

function pathAvailable(path: string): boolean {
  const expanded = path === '~' || path.startsWith('~/') ? homedir() + path.slice(1) : path;
  try {
    statSync(resolve(expanded));
    return true;
  } catch {
    return false;
  }
}
