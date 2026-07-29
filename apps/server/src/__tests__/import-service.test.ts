import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../database';
import type { ImportSourceDefinition } from '../ingestion/import-job-manager';
import {
  getImportStatus,
  type ImportServiceError,
  runImport,
  startImport,
} from '../ingestion/import-service';
import { type AppRuntime, createRuntime } from '../runtime';

const sourceDefinitions: ImportSourceDefinition[] = [
  {
    id: 'codex',
    label: 'Codex',
    isAvailable: () => true,
    run: async () => ({
      scanned: 1,
      imported: 1,
      updated: 0,
      skipped: 0,
      removed: 0,
      failed: 0,
      protectedAnnotatedSessions: 0,
      sessionIds: ['codex-session'],
      skipReasons: { unchanged_revision: 0, not_importable: 0, excluded_non_actionable: 0 },
    }),
  },
];

describe('import service', () => {
  let runtime: AppRuntime;

  beforeEach(() => {
    runtime = createRuntime({
      database: createDatabase(':memory:'),
      autoScanDir: null,
      defaultScanDir: '~/.claude/projects',
      sourceDefinitions,
    });
  });

  afterEach(async () => {
    await runtime.close();
  });

  it('returns refreshed source status with primary stored-session counts', async () => {
    runtime.database
      .prepare(
        `INSERT INTO sessions (id, file_path, agent, source_kind, start_time, imported_at)
         VALUES ('stored-codex', 'fixture://codex', 'codex', 'codex', 1, 1)`,
      )
      .run();
    runtime.database
      .prepare(
        `INSERT INTO spans (id, session_id, type, name, start_time)
         VALUES ('stored-codex-span', 'stored-codex', 'llm_turn', 'fixture', 1)`,
      )
      .run();

    const status = await getImportStatus(runtime);

    expect(status).toMatchObject({ active: false, operation: null });
    expect(status.sources).toEqual([
      expect.objectContaining({
        id: 'codex',
        available: true,
        state: 'idle',
        storedSessions: 1,
      }),
    ]);
    expect(JSON.stringify(status)).not.toContain('fixture://');
  });

  it('runs selected sources through the shared import job manager and returns terminal status', async () => {
    const status = await runImport(runtime, ['codex']);

    expect(status).toMatchObject({ active: false, operation: 'sync' });
    expect(status.sources).toEqual([
      expect.objectContaining({
        id: 'codex',
        state: 'completed',
        result: expect.objectContaining({ imported: 1 }),
      }),
    ]);
  });

  it('rejects unsupported source IDs before starting an import', async () => {
    await expect(startImport(runtime, ['unknown-source'])).rejects.toMatchObject({
      code: 'invalid_source',
    } satisfies Partial<ImportServiceError>);
    expect(runtime.imports.jobs.snapshot()).toMatchObject({ active: false, operation: null });
  });
});
