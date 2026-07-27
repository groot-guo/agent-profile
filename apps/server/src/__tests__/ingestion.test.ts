import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ParsedSession, Span } from '@agent-profile/core';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, lookupPricing } from '../database';
import { importFromSource } from '../ingestion/import-coordinator';
import { MiMoSourceAdapter } from '../ingestion/mimo-adapter';
import { SessionRepository } from '../ingestion/session-repository';
import { TranscriptSourceAdapter } from '../ingestion/transcript-adapter';
import type { SourceAdapter } from '../ingestion/types';
import { ZedSourceAdapter } from '../ingestion/zed-adapter';

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('session ingestion boundary', () => {
  it('atomically replaces spans and preserves user annotations', () => {
    const database = createDatabase(':memory:');
    const repository = new SessionRepository(database, (model, at) =>
      lookupPricing(database, model, at),
    );

    repository.replace(
      { parsed: createParsedSession('session-1', 'span-old') },
      { kind: 'claude', updatedAt: 100, fingerprint: 'first' },
      1000,
    );
    database
      .prepare("UPDATE sessions SET tags = 'important', notes = 'keep me' WHERE id = ?")
      .run('session-1');

    repository.replace(
      { parsed: createParsedSession('session-1', 'span-new') },
      { kind: 'claude', updatedAt: 200, fingerprint: 'second' },
      2000,
    );

    expect(
      database
        .prepare(
          `SELECT tags, notes, source_kind as sourceKind,
            source_updated_at as sourceUpdatedAt,
            source_fingerprint as sourceFingerprint
           FROM sessions WHERE id = ?`,
        )
        .get('session-1'),
    ).toEqual({
      tags: 'important',
      notes: 'keep me',
      sourceKind: 'claude',
      sourceUpdatedAt: 200,
      sourceFingerprint: 'second',
    });
    expect(
      database.prepare('SELECT id FROM spans WHERE session_id = ? ORDER BY id').all('session-1'),
    ).toEqual([{ id: 'span-new' }]);
    database.close();
  });

  it('reports imported, skipped, updated, and failed items independently', async () => {
    const database = createDatabase(':memory:');
    const repository = new SessionRepository(database, (model, at) =>
      lookupPricing(database, model, at),
    );
    let loads = 0;
    const adapter = createAdapter('revision-1', () => {
      loads++;
      return { parsed: createParsedSession('session-1', 'span-1') };
    });

    expect(await importFromSource(adapter, repository)).toMatchObject({
      scanned: 1,
      imported: 1,
      updated: 0,
      skipped: 0,
      failed: 0,
      skipReasons: { unchanged_revision: 0, not_importable: 0 },
    });
    expect(await importFromSource(adapter, repository)).toMatchObject({
      imported: 0,
      updated: 0,
      skipped: 1,
      failed: 0,
      skipReasons: { unchanged_revision: 1, not_importable: 0 },
    });
    expect(loads).toBe(1);

    expect(
      await importFromSource(
        createAdapter('revision-2', () => ({
          parsed: createParsedSession('session-1', 'span-2'),
        })),
        repository,
      ),
    ).toMatchObject({ imported: 0, updated: 1, skipped: 0, failed: 0 });

    const failingAdapter: SourceAdapter = {
      kind: 'fixture',
      discover: async () => [
        {
          key: 'broken',
          revision: { kind: 'fixture', updatedAt: 3, fingerprint: 'broken' },
          load: async () => {
            throw new Error('broken fixture');
          },
        },
      ],
    };
    expect(await importFromSource(failingAdapter, repository)).toMatchObject({
      scanned: 1,
      imported: 0,
      updated: 0,
      skipped: 0,
      failed: 1,
      skipReasons: { unchanged_revision: 0, not_importable: 0 },
    });

    const notImportableAdapter: SourceAdapter = {
      kind: 'fixture',
      discover: async () => [
        {
          key: 'empty',
          revision: { kind: 'fixture', updatedAt: 4, fingerprint: 'empty' },
          load: async () => null,
        },
      ],
    };
    expect(await importFromSource(notImportableAdapter, repository)).toMatchObject({
      scanned: 1,
      imported: 0,
      updated: 0,
      skipped: 1,
      failed: 0,
      skipReasons: { unchanged_revision: 0, not_importable: 1 },
    });
    database.close();
  });

  it('refreshes Zed and MiMo sessions when their source revisions change', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-profile-ingestion-'));
    tempDirectories.push(directory);
    const zedPath = join(directory, 'threads.db');
    const mimoPath = join(directory, 'mimo.db');
    createZedFixture(zedPath);
    createMiMoFixture(mimoPath);

    const target = createDatabase(':memory:');
    const repository = new SessionRepository(target, (model, at) =>
      lookupPricing(target, model, at),
    );
    const identityDecompress = async (input: Buffer) => input;

    expect(
      await importFromSource(
        new ZedSourceAdapter({ databasePath: zedPath, decompress: identityDecompress }),
        repository,
      ),
    ).toMatchObject({ imported: 1, updated: 0, skipped: 0 });
    expect(await importFromSource(new MiMoSourceAdapter(mimoPath), repository)).toMatchObject({
      imported: 1,
      updated: 0,
      skipped: 0,
    });

    expect(
      await importFromSource(
        new ZedSourceAdapter({ databasePath: zedPath, decompress: identityDecompress }),
        repository,
      ),
    ).toMatchObject({ imported: 0, updated: 0, skipped: 1 });
    expect(await importFromSource(new MiMoSourceAdapter(mimoPath), repository)).toMatchObject({
      imported: 0,
      updated: 0,
      skipped: 1,
    });

    const zed = new Database(zedPath);
    zed
      .prepare("UPDATE threads SET summary = 'updated', updated_at = '2026-07-26T01:00:00Z'")
      .run();
    zed.close();
    const mimo = new Database(mimoPath);
    mimo.prepare('UPDATE session SET title = ?, time_updated = ?').run('updated', 2000);
    mimo.close();

    expect(
      await importFromSource(
        new ZedSourceAdapter({ databasePath: zedPath, decompress: identityDecompress }),
        repository,
      ),
    ).toMatchObject({ imported: 0, updated: 1, skipped: 0 });
    expect(await importFromSource(new MiMoSourceAdapter(mimoPath), repository)).toMatchObject({
      imported: 0,
      updated: 1,
      skipped: 0,
    });

    expect(target.prepare('SELECT name FROM sessions WHERE id = ?').get('zed-session')).toEqual({
      name: 'updated',
    });
    expect(target.prepare('SELECT name FROM sessions WHERE id = ?').get('mimo-session')).toEqual({
      name: 'updated',
    });
    target.close();
  });

  it('applies the same revision decisions to transcript files', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-profile-transcript-'));
    tempDirectories.push(directory);
    const transcriptPath = join(directory, 'session.jsonl');
    writeFileSync(transcriptPath, `${createClaudeLine('turn-1', 10)}\n`);

    const target = createDatabase(':memory:');
    const repository = new SessionRepository(target, (model, at) =>
      lookupPricing(target, model, at),
    );

    expect(
      await importFromSource(new TranscriptSourceAdapter(directory, 'claude'), repository),
    ).toMatchObject({ imported: 1, updated: 0, skipped: 0 });
    expect(
      await importFromSource(new TranscriptSourceAdapter(directory, 'claude'), repository),
    ).toMatchObject({ imported: 0, updated: 0, skipped: 1 });

    writeFileSync(
      transcriptPath,
      `${createClaudeLine('turn-1', 10)}\n${createClaudeLine('turn-2', 20)}\n`,
    );
    expect(
      await importFromSource(new TranscriptSourceAdapter(directory, 'claude'), repository),
    ).toMatchObject({ imported: 0, updated: 1, skipped: 0 });
    expect(
      target
        .prepare('SELECT message_count as messageCount FROM sessions WHERE id = ?')
        .get('claude-session'),
    ).toEqual({ messageCount: 2 });
    target.close();
  });
});

function createAdapter(fingerprint: string, load: () => { parsed: ParsedSession }): SourceAdapter {
  return {
    kind: 'fixture',
    discover: async () => [
      {
        key: 'session-1',
        sessionId: 'session-1',
        revision: { kind: 'fixture', updatedAt: 1, fingerprint },
        load: async () => load(),
      },
    ],
  };
}

function createParsedSession(sessionId: string, spanId: string): ParsedSession {
  const span: Span = {
    id: spanId,
    sessionId,
    parentId: null,
    type: 'llm_turn',
    name: 'fixture-model',
    startTime: 100,
    endTime: 200,
    inputTokens: 10,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 5,
    contextTokens: 0,
    outputBytes: 0,
    model: 'fixture-model',
    cost: 0,
    costUnknown: false,
    isError: false,
    isSidechain: false,
  };
  return {
    sessionId,
    meta: {
      filePath: `fixture://${sessionId}`,
      startTime: 100,
      endTime: 200,
      messageCount: 1,
      agent: 'fixture',
    },
    spans: [span],
  };
}

function createZedFixture(path: string): void {
  const database = new Database(path);
  database.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      summary TEXT,
      folder_paths TEXT,
      updated_at TEXT,
      created_at TEXT,
      data_type TEXT,
      data BLOB
    );
  `);
  database
    .prepare(
      `INSERT INTO threads (
        id, summary, folder_paths, updated_at, created_at, data_type, data
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      'zed-session',
      'initial',
      '["/tmp/project"]',
      '2026-07-26T00:00:00Z',
      '2026-07-26T00:00:00Z',
      'opaque',
      Buffer.from(
        JSON.stringify({
          model: { provider: 'fixture', model: 'fixture-model' },
          request_token_usage: {
            'zed-request': { input_tokens: 10, output_tokens: 5 },
          },
          messages: [
            { User: { id: 'zed-request', content: [{ Text: 'fixture prompt' }] } },
            { Agent: { content: [{ Text: 'fixture answer' }], tool_results: {} } },
          ],
        }),
      ),
    );
  database.close();
}

function createClaudeLine(uuid: string, outputTokens: number): string {
  return JSON.stringify({
    type: 'assistant',
    sessionId: 'claude-session',
    uuid,
    parentUuid: null,
    timestamp: `2026-07-26T00:00:${uuid === 'turn-1' ? '00' : '01'}.000Z`,
    cwd: '/tmp/project',
    message: {
      model: 'fixture-model',
      usage: {
        input_tokens: 10,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: outputTokens,
      },
      content: [],
    },
  });
}

function createMiMoFixture(path: string): void {
  const database = new Database(path);
  database.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      title TEXT,
      directory TEXT,
      time_created INTEGER,
      time_updated INTEGER
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      agent_id TEXT,
      time_created INTEGER,
      data TEXT
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT,
      session_id TEXT,
      data TEXT
    );
  `);
  database
    .prepare(
      'INSERT INTO session (id, title, directory, time_created, time_updated) VALUES (?, ?, ?, ?, ?)',
    )
    .run('mimo-session', 'initial', '/tmp/project', 1000, 1000);
  database
    .prepare(
      'INSERT INTO message (id, session_id, agent_id, time_created, data) VALUES (?, ?, ?, ?, ?)',
    )
    .run(
      'mimo-message',
      'mimo-session',
      'agent',
      1000,
      JSON.stringify({
        role: 'assistant',
        modelID: 'fixture-model',
        providerID: 'fixture',
        tokens: { input: 10, output: 5, reasoning: 0 },
        time: { created: 1000, completed: 1100 },
      }),
    );
  database.close();
}
