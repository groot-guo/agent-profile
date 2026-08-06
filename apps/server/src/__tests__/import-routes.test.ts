import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../database';
import { registerScanRoutes } from '../routes/scan';
import type { AppRuntime } from '../runtime';
import { createRuntime } from '../runtime';

describe('import status routes', () => {
  const app = Fastify();
  let runtime: AppRuntime;

  beforeAll(async () => {
    runtime = createRuntime({
      database: createDatabase(':memory:'),
      autoScanDir: null,
      defaultScanDir: '~/.claude/projects',
    });
    registerScanRoutes(app, runtime);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await runtime.close();
  });

  it('returns bounded source state without local paths or transcript identifiers', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/imports/status' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ active: false });
    expect(response.json().sources).toHaveLength(5);
    expect(response.json().sources.map((source: { id: string }) => source.id)).toContain(
      'opencode',
    );
    for (const source of response.json().sources) {
      expect(source).toMatchObject({
        id: expect.any(String),
        label: expect.any(String),
        available: expect.any(Boolean),
        state: expect.any(String),
        storedSessions: expect.any(Number),
      });
      expect(source).not.toHaveProperty('path');
    }
    expect(response.body).not.toContain('/Users/');
    expect(response.body).not.toContain('sessionIds');
  });

  it('rejects unknown source IDs before starting work', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/imports',
      payload: { sources: ['unknown-source'] },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects malformed scan and import payloads through runtime validation', async () => {
    const malformedImports = await app.inject({
      method: 'POST',
      url: '/api/imports',
      payload: { sources: [7] },
    });
    expect(malformedImports.statusCode).toBe(400);

    const malformedRebuild = await app.inject({
      method: 'POST',
      url: '/api/imports/rebuild',
      payload: { sources: [7] },
    });
    expect(malformedRebuild.statusCode).toBe(400);

    const missingDir = await app.inject({
      method: 'POST',
      url: '/api/scan',
      payload: {},
    });
    expect(missingDir.statusCode).toBe(400);

    const malformedDir = await app.inject({
      method: 'POST',
      url: '/api/scan',
      payload: { dir: '' },
    });
    expect(malformedDir.statusCode).toBe(400);

    const malformedReset = await app.inject({
      method: 'POST',
      url: '/api/data-management/reset',
      payload: { confirmation: 7 },
    });
    expect(malformedReset.statusCode).toBe(400);
  });

  it('waits for direct compatibility scans before closing the Runtime database', async () => {
    const scanDirectory = mkdtempSync(join(tmpdir(), 'agent-profile-close-scan-'));
    const closingRuntime = createRuntime({
      database: createDatabase(':memory:'),
      autoScanDir: null,
      defaultScanDir: '~/.claude/projects',
    });
    try {
      writeFileSync(
        join(scanDirectory, 'session.jsonl'),
        `${JSON.stringify({
          uuid: 'turn-1',
          sessionId: 'close-scan-session',
          timestamp: '2026-01-01T00:00:00.000Z',
          type: 'assistant',
          message: {
            role: 'assistant',
            model: 'deepseek-v4-flash',
            content: [{ type: 'text', text: 'done' }],
            usage: { input_tokens: 1000, output_tokens: 100 },
          },
        })}\n`,
      );

      const scan = closingRuntime.imports.runCompatibilityScan(scanDirectory);
      await closingRuntime.close();
      await expect(scan).resolves.toMatchObject({ imported: 1, failed: 0 });
    } finally {
      await closingRuntime.close();
      rmSync(scanDirectory, { recursive: true, force: true });
    }
  });

  it('requires explicit confirmation and resets only generated analysis data', async () => {
    await waitForIdleImport();
    runtime.database
      .prepare(
        `INSERT INTO sessions (id, file_path, agent, start_time, imported_at, tags)
         VALUES ('reset-session', 'fixture://reset', 'fixture', 1, 1, 'important')`,
      )
      .run();
    runtime.database
      .prepare(
        `INSERT INTO spans (id, session_id, type, name, start_time)
         VALUES ('reset-span', 'reset-session', 'llm_turn', 'fixture', 1)`,
      )
      .run();

    const summary = await app.inject({ method: 'GET', url: '/api/data-management/summary' });
    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toMatchObject({ sessions: 1, spans: 1, annotatedSessions: 1 });

    const rejected = await app.inject({
      method: 'POST',
      url: '/api/data-management/reset',
      payload: { confirmation: 'RESET' },
    });
    expect(rejected.statusCode).toBe(400);

    const reset = await app.inject({
      method: 'POST',
      url: '/api/data-management/reset',
      payload: { confirmation: summary.json().resetConfirmation },
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toMatchObject({
      deleted: { sessions: 1, spans: 1, annotatedSessions: 1 },
      retained: {
        pricingRows: expect.any(Number),
        modelContextRows: expect.any(Number),
        migrations: expect.any(Number),
      },
    });
    expect(runtime.database.prepare('SELECT COUNT(*) as count FROM sessions').get()).toEqual({
      count: 0,
    });
  });

  async function waitForIdleImport(): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt++) {
      const status = await app.inject({ method: 'GET', url: '/api/imports/status' });
      if (!status.json().active) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('import job did not become idle');
  }
});
