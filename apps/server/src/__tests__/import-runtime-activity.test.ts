import type { ScanResult } from '@agent-profile/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../database';
import type { AppRuntime } from '../runtime';
import { createRuntime } from '../runtime';

describe('Import Runtime activity updates', () => {
  let runtime: AppRuntime | undefined;

  afterEach(async () => {
    await runtime?.close();
    runtime = undefined;
  });

  it('publishes changed Session IDs after the shared import path succeeds', async () => {
    const scanResult: ScanResult = {
      scanned: 1,
      imported: 0,
      updated: 1,
      removed: 0,
      skipped: 0,
      failed: 0,
      protectedAnnotatedSessions: 0,
      sessionIds: ['session-a'],
      skipReasons: { unchanged_revision: 0, not_importable: 0, excluded_non_actionable: 0 },
    };
    runtime = createRuntime({
      database: createDatabase(':memory:'),
      autoScanDir: null,
      defaultScanDir: '~/.claude/projects',
      sourceDefinitions: [
        {
          id: 'codex',
          label: 'Codex',
          isAvailable: () => true,
          run: async () => scanResult,
        },
      ],
      clock: () => 1_000,
    });

    await runtime.imports.jobs.start(['codex']);
    await runtime.imports.waitForIdle();

    await expect(runtime.imports.updates.waitFor(0, 0)).resolves.toEqual({
      version: 1,
      observedAt: 1_000,
      reset: false,
      sessionIds: ['session-a'],
    });
  });
});
