import type { ScanResult } from '@agent-profile/core';
import { describe, expect, it, vi } from 'vitest';
import { ImportJobManager, type ImportSourceDefinition } from '../ingestion/import-job-manager';

function result(imported = 1): ScanResult {
  return {
    scanned: imported,
    imported,
    updated: 0,
    skipped: 0,
    removed: 0,
    failed: 0,
    sessionIds: ['private-session-id'],
    skipReasons: { unchanged_revision: 0, not_importable: 0, excluded_non_actionable: 0 },
  };
}

describe('ImportJobManager', () => {
  it('deduplicates one source, isolates source failures, and omits session IDs', async () => {
    let release: (() => void) | undefined;
    const claudeRun = vi.fn(
      () =>
        new Promise<ScanResult>((resolve) => {
          release = () => resolve(result());
        }),
    );
    const definitions: ImportSourceDefinition[] = [
      { id: 'claude-code', label: 'Claude Code', isAvailable: () => true, run: claudeRun },
      {
        id: 'codex',
        label: 'Codex',
        isAvailable: () => true,
        run: async () => {
          throw new Error('/private/path must not escape');
        },
      },
      { id: 'zed', label: 'Zed', isAvailable: () => false, run: async () => result() },
    ];
    const manager = new ImportJobManager(definitions);

    const first = await manager.start(['claude-code', 'codex', 'zed']);
    const second = await manager.start(['claude-code']);
    const conflicting = await manager.start(['claude-code'], 'rebuild');
    expect(first.active).toBe(true);
    expect(second.active).toBe(true);
    expect(conflicting.operation).toBe('sync');
    expect(claudeRun).toHaveBeenCalledTimes(1);
    expect(first.sources.find((source) => source.id === 'zed')?.available).toBe(false);

    release?.();
    await manager.waitForIdle();
    const completed = manager.snapshot();
    expect(completed.active).toBe(false);
    expect(completed.sources.find((source) => source.id === 'claude-code')).toMatchObject({
      state: 'completed',
      result: { imported: 1 },
    });
    expect(JSON.stringify(completed)).not.toContain('private-session-id');
    expect(completed.sources.find((source) => source.id === 'codex')).toMatchObject({
      state: 'failed',
      error: 'source_scan_failed',
    });
    expect(JSON.stringify(completed)).not.toContain('/private/path');
  });

  it('can retry a failed source and refresh availability', async () => {
    let available = false;
    let shouldFail = true;
    const manager = new ImportJobManager([
      {
        id: 'mimo-code',
        label: 'MiMo Code',
        isAvailable: () => available,
        run: async () => {
          if (shouldFail) throw new Error('broken');
          return result(2);
        },
      },
    ]);

    expect((await manager.refreshAvailability()).sources[0].available).toBe(false);
    available = true;
    await manager.start();
    await manager.waitForIdle();
    expect(manager.snapshot().sources[0].state).toBe('failed');

    shouldFail = false;
    await manager.start();
    await manager.waitForIdle();
    expect(manager.snapshot().sources[0]).toMatchObject({
      available: true,
      state: 'completed',
      result: { imported: 2 },
      error: null,
    });
  });

  it('passes the selected operation to every source and exposes it in status', async () => {
    const run = vi.fn(async () => result());
    const manager = new ImportJobManager([
      { id: 'claude-code', label: 'Claude Code', isAvailable: () => true, run },
    ]);

    const started = await manager.start(undefined, 'rebuild');
    expect(started.operation).toBe('rebuild');
    await manager.waitForIdle();
    expect(run).toHaveBeenCalledWith('rebuild');
    expect(manager.snapshot()).toMatchObject({ active: false, operation: 'rebuild' });
  });
});
