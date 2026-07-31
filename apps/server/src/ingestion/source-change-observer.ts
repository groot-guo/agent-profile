import { watch as watchFileSystem } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { ImportSourceId } from './import-job-manager';

export interface SourceWatchDefinition {
  id: ImportSourceId;
  path: string;
  recursive: boolean;
  accepts: (filename: string) => boolean;
  includeChangedPath?: boolean;
}

export interface ObservedSourceChange {
  sourceId: ImportSourceId;
  changedPath?: string;
}

interface WatchHandle {
  close: () => void;
}

type WatchListener = (eventType: string, filename: string | null) => void;

export type WatchFactory = (
  path: string,
  options: { recursive: boolean },
  listener: WatchListener,
) => WatchHandle;

interface SourceChangeObserverOptions {
  sources: SourceWatchDefinition[];
  onChange: (change: ObservedSourceChange) => Promise<void>;
  onError?: (sourceId: ImportSourceId, error: unknown) => void;
  watch?: WatchFactory;
  clock?: () => number;
  debounceMs?: number;
  cooldownMs?: number;
}

export class SourceChangeObserver {
  private readonly watchers: WatchHandle[] = [];
  private readonly timers = new Map<ImportSourceId, ReturnType<typeof setTimeout>>();
  private readonly pending = new Map<ImportSourceId, ObservedSourceChange>();
  private readonly running = new Set<ImportSourceId>();
  private readonly runs = new Set<Promise<void>>();
  private readonly lastCompletedAt = new Map<ImportSourceId, number>();
  private readonly watch: WatchFactory;
  private readonly clock: () => number;
  private readonly debounceMs: number;
  private readonly cooldownMs: number;
  private isStarted = false;
  private isClosed = false;

  constructor(private readonly options: SourceChangeObserverOptions) {
    this.watch = options.watch ?? defaultWatch;
    this.clock = options.clock ?? (() => Date.now());
    this.debounceMs = Math.max(0, options.debounceMs ?? 750);
    this.cooldownMs = Math.max(this.debounceMs, options.cooldownMs ?? 5_000);
  }

  start(): void {
    if (this.isStarted || this.isClosed) return;
    this.isStarted = true;
    for (const source of this.options.sources) {
      try {
        this.watchers.push(
          this.watch(source.path, { recursive: source.recursive }, (_eventType, filename) => {
            if (!filename || !source.accepts(filename)) return;
            this.schedule(source, filename);
          }),
        );
      } catch (error) {
        this.reportError(source.id, error);
      }
    }
  }

  async close(): Promise<void> {
    if (this.isClosed) return;
    this.isClosed = true;
    for (const watcher of this.watchers) watcher.close();
    this.watchers.length = 0;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.pending.clear();
    await Promise.allSettled([...this.runs]);
  }

  private schedule(source: SourceWatchDefinition, filename: string): void {
    if (this.isClosed) return;
    if (filename) {
      const changedPath = resolve(source.path, filename);
      const pathFromSource = relative(source.path, changedPath);
      if (
        pathFromSource === '..' ||
        pathFromSource.startsWith(`..${sep}`) ||
        isAbsolute(pathFromSource)
      ) {
        return;
      }
      this.pending.set(source.id, {
        sourceId: source.id,
        changedPath: source.includeChangedPath ? changedPath : undefined,
      });
    }
    if (this.timers.has(source.id) || this.running.has(source.id)) return;

    const lastCompletedAt = this.lastCompletedAt.get(source.id);
    const delay =
      lastCompletedAt === undefined
        ? this.debounceMs
        : Math.max(this.debounceMs, this.cooldownMs - (this.clock() - lastCompletedAt));
    this.timers.set(
      source.id,
      setTimeout(() => {
        this.timers.delete(source.id);
        this.run(source);
      }, delay),
    );
  }

  private run(source: SourceWatchDefinition): void {
    const change = this.pending.get(source.id);
    if (!change || this.isClosed) return;
    this.pending.delete(source.id);
    this.running.add(source.id);
    const run = Promise.resolve()
      .then(() => this.options.onChange(change))
      .catch((error: unknown) => this.reportError(source.id, error))
      .finally(() => {
        this.running.delete(source.id);
        this.runs.delete(run);
        this.lastCompletedAt.set(source.id, this.clock());
        if (this.pending.has(source.id) && !this.isClosed) this.schedule(source, '');
      });
    this.runs.add(run);
  }

  private reportError(sourceId: ImportSourceId, error: unknown): void {
    if (this.options.onError) this.options.onError(sourceId, error);
  }
}

const defaultWatch: WatchFactory = (path, options, listener) =>
  watchFileSystem(path, options, (eventType, filename) =>
    listener(eventType, filename === null ? null : filename.toString()),
  );
