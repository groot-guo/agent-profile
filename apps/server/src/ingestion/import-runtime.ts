import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { type ScanResult, zedThreadsDbPath } from '@agent-profile/core';
import type { DatabaseConnection } from '../database';
import { normalizeProjectRoot } from '../project-scope';
import type { PricingResolver } from '../runtime';
import { SessionUpdateTracker } from '../session-update-tracker';
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
import {
  type ObservedSourceChange,
  SourceChangeObserver,
  type SourceWatchDefinition,
} from './source-change-observer';
import { TranscriptSourceAdapter } from './transcript-adapter';
import { ZedSourceAdapter } from './zed-adapter';

export interface ImportRuntimeOptions {
  database: DatabaseConnection;
  pricingResolver: PricingResolver;
  projectRoot?: string | null;
  autoScanDir: string | null;
  defaultScanDir: string;
  sourceDefinitions?: ImportSourceDefinition[];
  onError?: (source: ImportSourceDefinition, error: unknown) => void;
  clock?: () => number;
}

export class ImportRuntime {
  readonly jobs: ImportJobManager;
  readonly updates: SessionUpdateTracker;
  private readonly repository: SessionRepository;
  private readonly observer: SourceChangeObserver | null;
  private readonly compatibilityScans = new Set<Promise<ScanResult>>();
  private readonly autoScanDir: string | null;
  private readonly defaultScanDir: string;
  private readonly claudeDirectory: string;
  private readonly codexDirectory = '~/.codex/sessions';
  private readonly mimoDatabasePath = `${homedir()}/.local/share/mimocode/mimocode.db`;
  private readonly openCodeDatabasePath = `${homedir()}/.local/share/opencode/opencode.db`;
  private readonly zedDatabasePath = zedThreadsDbPath();
  private readonly clock: () => number;
  readonly projectRoot: string | null;

  constructor(options: ImportRuntimeOptions) {
    this.clock = options.clock ?? (() => Date.now());
    this.projectRoot = normalizeProjectRoot(options.projectRoot);
    this.updates = new SessionUpdateTracker({ clock: this.clock });
    this.repository = new SessionRepository(options.database, options.pricingResolver);
    this.autoScanDir = options.autoScanDir;
    this.defaultScanDir = options.defaultScanDir;
    this.claudeDirectory =
      options.autoScanDir && options.autoScanDir !== options.defaultScanDir
        ? options.autoScanDir
        : options.defaultScanDir;
    const definitions = options.sourceDefinitions ?? this.createDefaultSourceDefinitions();
    this.jobs = new ImportJobManager(definitions, options.onError, (_source, result) => {
      if (result.imported > 0 || result.updated > 0 || result.removed > 0) {
        this.updates.publish(result.sessionIds, result.removed > 0);
      }
    });
    this.observer = options.sourceDefinitions
      ? null
      : new SourceChangeObserver({
          sources: this.sourceWatchDefinitions(),
          onChange: (change) => this.importObservedChange(change),
          onError: (sourceId, error) => {
            const code = sourceObservationErrorCode(error);
            console.warn(`${sourceId} source observation failed: ${code}`);
          },
          clock: this.clock,
        });
  }

  startStartupImports(): Promise<ImportJobStatus> {
    this.observer?.start();
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
    return this.repository.resetGeneratedData(this.projectRoot);
  }

  async waitForIdle(): Promise<void> {
    await this.jobs.waitForIdle();
    while (this.compatibilityScans.size > 0) {
      await Promise.allSettled(this.compatibilityScans);
    }
  }

  async close(): Promise<void> {
    await this.observer?.close();
    await this.waitForIdle();
    this.updates.close();
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
            { force: operation === 'rebuild', projectRoot: this.projectRoot },
          ),
      },
      {
        id: 'mimo-code',
        label: 'MiMo Code',
        isAvailable: () => pathAvailable(this.mimoDatabasePath),
        run: (operation) =>
          importFromSource(new MiMoSourceAdapter(this.mimoDatabasePath), this.repository, {
            force: operation === 'rebuild',
            projectRoot: this.projectRoot,
          }),
      },
      {
        id: 'opencode',
        label: 'OpenCode',
        isAvailable: () => pathAvailable(this.openCodeDatabasePath),
        run: (operation) =>
          importFromSource(new OpenCodeSourceAdapter(this.openCodeDatabasePath), this.repository, {
            force: operation === 'rebuild',
            projectRoot: this.projectRoot,
          }),
      },
    ];
  }

  private scanTranscriptDirectory(
    directory: string,
    agent?: string,
    options: { force?: boolean } = {},
  ): Promise<ScanResult> {
    return importFromSource(new TranscriptSourceAdapter(directory, agent), this.repository, {
      ...options,
      projectRoot: this.projectRoot,
    });
  }

  private scanTranscriptFile(file: string, agent: 'claude-code' | 'codex'): Promise<ScanResult> {
    return importFromSource(
      new TranscriptSourceAdapter(dirname(file), agent, [file]),
      this.repository,
      { projectRoot: this.projectRoot },
    );
  }

  private async importObservedChange(change: ObservedSourceChange): Promise<void> {
    const wasAvailable = this.jobs
      .snapshot()
      .sources.find((source) => source.id === change.sourceId)?.available;
    const result = await this.jobs.runObserved(change.sourceId, () => {
      if (
        change.changedPath?.endsWith('.jsonl') &&
        basename(change.changedPath) !== 'journal.jsonl' &&
        (change.sourceId === 'claude-code' || change.sourceId === 'codex')
      ) {
        return this.scanTranscriptFile(change.changedPath, change.sourceId);
      }
      const definition = this.createDefaultSourceDefinitions().find(
        (candidate) => candidate.id === change.sourceId,
      );
      if (!definition) throw new Error(`Unknown observed source: ${change.sourceId}`);
      return definition.run('sync');
    });
    const isAvailable = this.jobs
      .snapshot()
      .sources.find((source) => source.id === change.sourceId)?.available;
    if (
      wasAvailable !== isAvailable &&
      result.imported === 0 &&
      result.updated === 0 &&
      result.removed === 0
    ) {
      this.updates.publish([], true);
    }
  }

  private sourceWatchDefinitions(): SourceWatchDefinition[] {
    const sources: SourceWatchDefinition[] = [
      databaseWatch('zed', this.zedDatabasePath),
      databaseWatch('mimo-code', this.mimoDatabasePath),
      databaseWatch('opencode', this.openCodeDatabasePath),
    ];
    if (this.autoScanDir) {
      sources.push(transcriptWatch('claude-code', this.claudeDirectory));
      if (this.autoScanDir === this.defaultScanDir) {
        sources.push(transcriptWatch('codex', this.codexDirectory));
      }
    }
    return sources;
  }

  private knownTranscriptSource(directory: string, agent?: string): ImportSourceId | undefined {
    if (directory === this.claudeDirectory && (!agent || agent === 'claude-code')) {
      return 'claude-code';
    }
    if (directory === this.codexDirectory && (!agent || agent === 'codex')) return 'codex';
    return undefined;
  }
}

function transcriptWatch(
  id: Extract<ImportSourceId, 'claude-code' | 'codex'>,
  path: string,
): SourceWatchDefinition {
  return {
    id,
    path: expandedPath(path),
    recursive: true,
    accepts: (filename) => filename.endsWith('.jsonl') && basename(filename) !== 'journal.jsonl',
    includeChangedPath: true,
  };
}

function databaseWatch(
  id: Extract<ImportSourceId, 'zed' | 'mimo-code' | 'opencode'>,
  path: string,
): SourceWatchDefinition {
  const expanded = expandedPath(path);
  const databaseName = basename(expanded);
  return {
    id,
    path: dirname(expanded),
    recursive: false,
    accepts: (filename) => {
      const changedName = basename(filename);
      return changedName === databaseName || changedName.startsWith(`${databaseName}-`);
    },
  };
}

function expandedPath(path: string): string {
  const expanded = path === '~' || path.startsWith('~/') ? homedir() + path.slice(1) : path;
  return resolve(expanded);
}

function sourceObservationErrorCode(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code;
  }
  return error instanceof Error ? error.name : 'unknown_error';
}

function pathAvailable(path: string): boolean {
  try {
    statSync(expandedPath(path));
    return true;
  } catch {
    return false;
  }
}
