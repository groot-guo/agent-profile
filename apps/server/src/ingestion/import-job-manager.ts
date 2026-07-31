import type { ScanResult } from '@agent-profile/core';

export type ImportSourceId = 'claude-code' | 'codex' | 'zed' | 'mimo-code' | 'opencode';
export type ImportSourceState = 'idle' | 'scanning' | 'completed' | 'failed';
export type ImportOperation = 'sync' | 'rebuild';

export interface ImportSourceDefinition {
  id: ImportSourceId;
  label: string;
  isAvailable: () => boolean | Promise<boolean>;
  run: (operation: ImportOperation) => Promise<ScanResult>;
}

type PublicScanResult = Omit<ScanResult, 'sessionIds'>;

export interface ImportSourceStatus {
  id: ImportSourceId;
  label: string;
  available: boolean;
  state: ImportSourceState;
  result: PublicScanResult | null;
  startedAt: number | null;
  completedAt: number | null;
  error: 'source_scan_failed' | null;
}

export interface ImportJobStatus {
  jobId: string | null;
  active: boolean;
  operation: ImportOperation | null;
  sources: ImportSourceStatus[];
}

const EMPTY_RESULT: ScanResult = {
  scanned: 0,
  imported: 0,
  updated: 0,
  skipped: 0,
  removed: 0,
  failed: 0,
  protectedAnnotatedSessions: 0,
  sessionIds: [],
  skipReasons: { unchanged_revision: 0, not_importable: 0, excluded_non_actionable: 0 },
};

export class ImportJobManager {
  private readonly definitions = new Map<ImportSourceId, ImportSourceDefinition>();
  private readonly statuses = new Map<ImportSourceId, ImportSourceStatus>();
  private readonly inFlight = new Map<ImportSourceId, Promise<ScanResult>>();
  private jobId: string | null = null;
  private operation: ImportOperation | null = null;
  private sequence = 0;

  constructor(
    definitions: ImportSourceDefinition[],
    private readonly onError: (source: ImportSourceDefinition, error: unknown) => void = () => {},
    private readonly onResult: (
      source: ImportSourceDefinition,
      result: ScanResult,
    ) => void = () => {},
  ) {
    for (const definition of definitions) {
      this.definitions.set(definition.id, definition);
      this.statuses.set(definition.id, {
        id: definition.id,
        label: definition.label,
        available: false,
        state: 'idle',
        result: null,
        startedAt: null,
        completedAt: null,
        error: null,
      });
    }
  }

  sourceIds(): ImportSourceId[] {
    return [...this.definitions.keys()];
  }

  async refreshAvailability(): Promise<ImportJobStatus> {
    await Promise.all(
      [...this.definitions.values()].map(async (definition) => {
        const status = this.statuses.get(definition.id);
        if (!status) return;
        try {
          status.available = await definition.isAvailable();
        } catch {
          status.available = false;
        }
      }),
    );
    return this.snapshot();
  }

  async start(
    sourceIds: ImportSourceId[] = this.sourceIds(),
    operation: ImportOperation = 'sync',
  ): Promise<ImportJobStatus> {
    if (this.inFlight.size > 0 && this.operation !== operation) return this.snapshot();
    this.operation = operation;
    let started = false;
    for (const sourceId of [...new Set(sourceIds)]) {
      const definition = this.definitions.get(sourceId);
      const status = this.statuses.get(sourceId);
      if (!definition || !status) continue;

      try {
        status.available = await definition.isAvailable();
      } catch {
        status.available = false;
      }
      if (!status.available || this.inFlight.has(sourceId)) continue;

      started = true;
      const promise = this.launch(definition, status, operation);
      void promise.catch(() => undefined);
    }

    if (started) {
      this.jobId = `${Date.now()}-${++this.sequence}`;
    }
    return this.snapshot();
  }

  async runAndWait(sourceId: ImportSourceId): Promise<ScanResult> {
    const existing = this.inFlight.get(sourceId);
    if (existing) return existing;

    const definition = this.definitions.get(sourceId);
    const status = this.statuses.get(sourceId);
    if (!definition || !status) throw new Error(`Unknown import source: ${sourceId}`);
    status.available = await definition.isAvailable();
    if (!status.available) return structuredClone(EMPTY_RESULT);
    this.jobId = `${Date.now()}-${++this.sequence}`;
    this.operation = 'sync';
    return this.launch(definition, status, 'sync');
  }

  async runObserved(sourceId: ImportSourceId, run: () => Promise<ScanResult>): Promise<ScanResult> {
    const definition = this.definitions.get(sourceId);
    const status = this.statuses.get(sourceId);
    if (!definition || !status) throw new Error(`Unknown import source: ${sourceId}`);
    while (true) {
      if (this.inFlight.size > 0) {
        await Promise.allSettled([...this.inFlight.values()]);
        continue;
      }
      status.available = await definition.isAvailable();
      if (!status.available) return structuredClone(EMPTY_RESULT);
      if (this.inFlight.size > 0) continue;
      this.jobId = `${Date.now()}-${++this.sequence}`;
      this.operation = 'sync';
      return this.launch(definition, status, 'sync', run);
    }
  }

  async waitForIdle(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight.values()]);
    }
  }

  snapshot(): ImportJobStatus {
    return {
      jobId: this.jobId,
      active: this.inFlight.size > 0,
      operation: this.operation,
      sources: [...this.statuses.values()].map((status) => ({
        ...status,
        result: status.result
          ? { ...status.result, skipReasons: { ...status.result.skipReasons } }
          : null,
      })),
    };
  }

  private launch(
    definition: ImportSourceDefinition,
    status: ImportSourceStatus,
    operation: ImportOperation,
    run: () => Promise<ScanResult> = () => definition.run(operation),
  ): Promise<ScanResult> {
    const existing = this.inFlight.get(definition.id);
    if (existing) return existing;

    status.state = 'scanning';
    status.startedAt = Date.now();
    status.error = null;

    const promise = Promise.resolve()
      .then(run)
      .then((result) => {
        status.state = 'completed';
        const { sessionIds: _sessionIds, ...publicResult } = result;
        status.result = publicResult;
        status.completedAt = Date.now();
        this.onResult(definition, result);
        return result;
      })
      .catch((error: unknown) => {
        status.state = 'failed';
        status.result = null;
        status.completedAt = Date.now();
        status.error = 'source_scan_failed';
        this.onError(definition, error);
        throw error;
      })
      .finally(() => {
        this.inFlight.delete(definition.id);
      });

    this.inFlight.set(definition.id, promise);
    return promise;
  }
}
