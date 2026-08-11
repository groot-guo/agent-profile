import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ParsedSession, Span } from '@agent-profile/core';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, lookupPricing } from '../database';
import { importFromSource } from '../ingestion/import-coordinator';
import { MiMoSourceAdapter } from '../ingestion/mimo-adapter';
import { OpenCodeSourceAdapter } from '../ingestion/opencode-adapter';
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

  it('forces unchanged revisions through atomic replacement without losing annotations', async () => {
    const database = createDatabase(':memory:');
    const repository = new SessionRepository(database, (model, at) =>
      lookupPricing(database, model, at),
    );
    let spanId = 'span-first';
    const adapter = createAdapter('revision-1', () => ({
      parsed: createParsedSession('session-1', spanId),
    }));

    await importFromSource(adapter, repository);
    database
      .prepare("UPDATE sessions SET tags = 'important', notes = 'keep me' WHERE id = ?")
      .run('session-1');
    spanId = 'span-rebuilt';

    expect(await importFromSource(adapter, repository, { force: true })).toMatchObject({
      imported: 0,
      updated: 1,
      skipped: 0,
      failed: 0,
    });
    expect(
      database.prepare('SELECT tags, notes FROM sessions WHERE id = ?').get('session-1'),
    ).toEqual({
      tags: 'important',
      notes: 'keep me',
    });
    expect(database.prepare('SELECT id FROM spans WHERE session_id = ?').all('session-1')).toEqual([
      { id: 'span-rebuilt' },
    ]);
    database.close();
  });

  it('resets generated analysis while retaining configuration and migration records', () => {
    const database = createDatabase(':memory:');
    const repository = new SessionRepository(database, (model, at) =>
      lookupPricing(database, model, at),
    );
    repository.replace(
      { parsed: createParsedSession('session-1', 'span-1') },
      { kind: 'fixture', updatedAt: 1, fingerprint: 'revision-1' },
    );
    database.prepare("UPDATE sessions SET tags = 'important' WHERE id = ?").run('session-1');
    database
      .prepare(
        `INSERT INTO pricing (
          model, input_price, cache_creation_price, cache_read_price, output_price,
          currency, unit, effective_from
        ) VALUES ('fixture-model', 1, 1, 1, 1, 'CNY', 'per_million_tokens', 0)`,
      )
      .run();
    database
      .prepare("INSERT INTO model_context (model, context_window) VALUES ('fixture-model', 1000)")
      .run();

    expect(repository.resetGeneratedData()).toEqual({
      sessions: 1,
      spans: 1,
      annotatedSessions: 1,
    });
    expect(database.prepare('SELECT COUNT(*) as count FROM sessions').get()).toEqual({ count: 0 });
    expect(database.prepare('SELECT COUNT(*) as count FROM spans').get()).toEqual({ count: 0 });
    expect(database.prepare('SELECT COUNT(*) as count FROM pricing').get()).toEqual({ count: 1 });
    expect(database.prepare('SELECT COUNT(*) as count FROM model_context').get()).toEqual({
      count: 1,
    });
    expect(
      (
        database.prepare('SELECT COUNT(*) as count FROM schema_migrations').get() as {
          count: number;
        }
      ).count,
    ).toBeGreaterThan(0);
    database.close();
  });

  it('refreshes database-backed sessions when their source revisions change', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-profile-ingestion-'));
    tempDirectories.push(directory);
    const zedPath = join(directory, 'threads.db');
    const mimoPath = join(directory, 'mimo.db');
    const openCodePath = join(directory, 'opencode.db');
    createZedFixture(zedPath);
    createMiMoFixture(mimoPath);
    createOpenCodeFixture(openCodePath);

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
      await importFromSource(new OpenCodeSourceAdapter(openCodePath), repository),
    ).toMatchObject({
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
    expect(
      await importFromSource(new OpenCodeSourceAdapter(openCodePath), repository),
    ).toMatchObject({
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
    const opencode = new Database(openCodePath);
    opencode.prepare('UPDATE session SET title = ?, time_updated = ?').run('updated', 2000);
    opencode.close();

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
    expect(
      await importFromSource(new OpenCodeSourceAdapter(openCodePath), repository),
    ).toMatchObject({
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
    expect(
      target.prepare('SELECT name FROM sessions WHERE id = ?').get('opencode-session'),
    ).toEqual({
      name: 'updated',
    });
    target.close();
  });

  it('does not discover an unavailable OpenCode database', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-profile-opencode-missing-'));
    tempDirectories.push(directory);

    await expect(
      new OpenCodeSourceAdapter(join(directory, 'missing.db')).discover(),
    ).resolves.toEqual([]);
  });

  it('fails an incompatible OpenCode schema without changing stored analysis', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-profile-opencode-incompatible-'));
    tempDirectories.push(directory);
    const openCodePath = join(directory, 'opencode.db');
    const source = new Database(openCodePath);
    source.exec('CREATE TABLE unsupported (id TEXT PRIMARY KEY)');
    source.close();

    const target = createDatabase(':memory:');
    const repository = new SessionRepository(target, (model, at) =>
      lookupPricing(target, model, at),
    );

    await expect(
      importFromSource(new OpenCodeSourceAdapter(openCodePath), repository),
    ).rejects.toThrow();
    expect(target.prepare('SELECT COUNT(*) AS count FROM sessions').get()).toEqual({ count: 0 });
    expect(target.prepare('SELECT COUNT(*) AS count FROM spans').get()).toEqual({ count: 0 });
    target.close();
  });

  it('replaces a legacy Zed parser revision without changing the source row', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-profile-zed-revision-'));
    tempDirectories.push(directory);
    const zedPath = join(directory, 'threads.db');
    createZedFixture(zedPath);

    const target = createDatabase(':memory:');
    const repository = new SessionRepository(target, (model, at) =>
      lookupPricing(target, model, at),
    );
    repository.replace(
      { parsed: createParsedSession('zed-session', 'legacy-summary') },
      {
        kind: 'zed',
        updatedAt: Date.parse('2026-07-26T00:00:00Z'),
        fingerprint: 'zed:2026-07-26T00:00:00Z:opaque:0',
      },
      Date.now(),
    );

    const adapter = new ZedSourceAdapter({
      databasePath: zedPath,
      decompress: async (input) => input,
    });
    expect(await importFromSource(adapter, repository)).toMatchObject({
      imported: 0,
      updated: 1,
      skipped: 0,
    });
    expect(
      target
        .prepare('SELECT cwd, message_count as messageCount FROM sessions WHERE id = ?')
        .get('zed-session'),
    ).toEqual({ cwd: '/tmp/project', messageCount: 1 });
    expect(
      target.prepare('SELECT COUNT(*) as count FROM spans WHERE session_id = ?').get('zed-session'),
    ).toEqual({ count: 2 });

    expect(await importFromSource(adapter, repository)).toMatchObject({
      imported: 0,
      updated: 0,
      skipped: 1,
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

  it('reuses a validated Claude suffix and falls back on rewrites or malformed lines', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-profile-transcript-append-'));
    tempDirectories.push(directory);
    const transcriptPath = join(directory, 'session.jsonl');
    writeFileSync(transcriptPath, `${createClaudeLine('turn-1', 10)}\n`);

    const target = createDatabase(':memory:');
    const repository = new SessionRepository(target, (model, at) =>
      lookupPricing(target, model, at),
    );
    const adapter = new TranscriptSourceAdapter(directory, 'claude-code');
    await expect(importFromSource(adapter, repository)).resolves.toMatchObject({ imported: 1 });

    appendFileSync(
      transcriptPath,
      `${createClaudeLine('turn-2', 20).replace('"sessionId":"claude-session",', '')}\n`,
    );
    const [appendItem] = await adapter.discover();
    const appendCandidate = await appendItem.load();
    expect(appendCandidate && 'append' in appendCandidate).toBe(true);
    expect(await importFromSource(adapter, repository)).toMatchObject({
      imported: 0,
      updated: 1,
      failed: 0,
    });
    expect(
      target
        .prepare(
          `SELECT id, type, parent_id as parentId, start_time as startTime,
            end_time as endTime, input_tokens as inputTokens, output_tokens as outputTokens
           FROM spans WHERE session_id = ? ORDER BY start_time, id`,
        )
        .all('claude-session'),
    ).toEqual([
      {
        id: 'turn-1',
        type: 'llm_turn',
        parentId: null,
        startTime: Date.parse('2026-07-26T00:00:00.000Z'),
        endTime: Date.parse('2026-07-26T00:00:01.000Z'),
        inputTokens: 10,
        outputTokens: 10,
      },
      {
        id: 'turn-2',
        type: 'llm_turn',
        parentId: null,
        startTime: Date.parse('2026-07-26T00:00:01.000Z'),
        endTime: null,
        inputTokens: 10,
        outputTokens: 20,
      },
    ]);

    writeFileSync(
      transcriptPath,
      `${createClaudeLine('turn-1', 99)}\n${createClaudeLine('turn-2', 20)}\n`,
    );
    const [rewrittenItem] = await adapter.discover();
    const rewritten = await rewrittenItem.load();
    expect(rewritten && 'append' in rewritten).toBe(false);
    expect(await importFromSource(adapter, repository)).toMatchObject({ updated: 1, failed: 0 });
    expect(
      target.prepare('SELECT output_tokens as outputTokens FROM spans WHERE id = ?').get('turn-1'),
    ).toEqual({ outputTokens: 99 });

    appendFileSync(transcriptPath, `not-json\n${createClaudeLine('turn-3', 30)}\n`);
    const [malformedItem] = await adapter.discover();
    const malformed = await malformedItem.load();
    expect(malformed && 'append' in malformed).toBe(false);
    expect(await importFromSource(adapter, repository)).toMatchObject({ updated: 1, failed: 0 });
    expect(
      target
        .prepare('SELECT message_count as messageCount FROM sessions WHERE id = ?')
        .get('claude-session'),
    ).toEqual({ messageCount: 3 });
    target.close();
  });

  it('appends an independent Codex turn only when its boundary is complete', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-profile-codex-append-'));
    tempDirectories.push(directory);
    const transcriptPath = join(directory, 'session.jsonl');
    writeFileSync(transcriptPath, `${createModernCodexTranscript()}\n`);

    const target = createDatabase(':memory:');
    const repository = new SessionRepository(target, (model, at) =>
      lookupPricing(target, model, at),
    );
    const adapter = new TranscriptSourceAdapter(directory, 'codex');
    await expect(importFromSource(adapter, repository)).resolves.toMatchObject({ imported: 1 });

    appendFileSync(transcriptPath, `${createCodexTurn('modern-turn-2', '12:01')}\n`);
    const [appendItem] = await adapter.discover();
    const appendCandidate = await appendItem.load();
    expect(appendCandidate && 'append' in appendCandidate).toBe(true);
    await expect(importFromSource(adapter, repository)).resolves.toMatchObject({
      updated: 1,
      failed: 0,
    });
    expect(
      target
        .prepare(
          `SELECT id, model, input_tokens as inputTokens, output_tokens as outputTokens
           FROM spans WHERE session_id = ? AND type = 'llm_turn' ORDER BY start_time`,
        )
        .all('modern-codex-session'),
    ).toEqual([
      {
        id: 'codex:modern-codex-session:modern-turn',
        model: 'gpt-5.6-sol',
        inputTokens: 100,
        outputTokens: 15,
      },
      {
        id: 'codex:modern-codex-session:modern-turn-2',
        model: 'gpt-5.6-sol',
        inputTokens: 100,
        outputTokens: 15,
      },
    ]);

    appendFileSync(
      transcriptPath,
      `${JSON.stringify({
        timestamp: '2026-07-28T12:02:00.000Z',
        type: 'event_msg',
        payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 1 } } },
      })}\n`,
    );
    const [partialItem] = await adapter.discover();
    const partial = await partialItem.load();
    expect(partial && 'append' in partial).toBe(false);
    target.close();
  });

  it('keeps an already closed Claude turn end time unchanged during append', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-profile-transcript-end-time-'));
    tempDirectories.push(directory);
    const transcriptPath = join(directory, 'session.jsonl');
    const interveningUser = JSON.stringify({
      type: 'user',
      sessionId: 'claude-session',
      uuid: 'user-1',
      timestamp: '2026-07-26T00:00:01.000Z',
      message: { role: 'user', content: 'continuation' },
    });
    writeFileSync(transcriptPath, `${createClaudeLineAt('turn-1', 10, 0)}\n${interveningUser}\n`);

    const target = createDatabase(':memory:');
    const repository = new SessionRepository(target, (model, at) =>
      lookupPricing(target, model, at),
    );
    const adapter = new TranscriptSourceAdapter(directory, 'claude-code');
    await importFromSource(adapter, repository);
    appendFileSync(transcriptPath, `${createClaudeLineAt('turn-2', 20, 2)}\n`);
    expect(await importFromSource(adapter, repository)).toMatchObject({ updated: 1, failed: 0 });
    expect(
      target.prepare('SELECT end_time as endTime FROM spans WHERE id = ?').get('turn-1'),
    ).toEqual({ endTime: Date.parse('2026-07-26T00:00:01.000Z') });
    target.close();
  });

  it('excludes migrated external history and safely removes prior generated data', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-profile-codex-revision-'));
    tempDirectories.push(directory);
    const transcriptPath = join(directory, 'session.jsonl');
    writeFileSync(transcriptPath, createMigratedCodexTranscript());

    const target = createDatabase(':memory:');
    const repository = new SessionRepository(target, (model, at) =>
      lookupPricing(target, model, at),
    );
    const legacy = createParsedSession('migrated-codex-session', 'legacy-span');
    legacy.meta.agent = 'codex';
    legacy.meta.cwd = '/Users/guogenyuan/Desktop/im';
    repository.replace(
      { parsed: legacy },
      { kind: 'codex', updatedAt: 1, fingerprint: 'file:legacy' },
    );

    const adapter = new TranscriptSourceAdapter(directory, 'codex');
    const [item] = await adapter.discover();
    expect(item.revision.fingerprint).toMatch(/^file:codex-v8:/);
    expect(await importFromSource(adapter, repository)).toMatchObject({
      imported: 0,
      updated: 0,
      skipped: 1,
      removed: 1,
      failed: 0,
      skipReasons: { excluded_non_actionable: 1 },
    });
    expect(
      target.prepare('SELECT id FROM sessions WHERE id = ?').get('migrated-codex-session'),
    ).toBeUndefined();

    repository.replace(
      { parsed: legacy },
      { kind: 'codex', updatedAt: 1, fingerprint: 'file:legacy' },
    );
    target
      .prepare("UPDATE sessions SET tags = 'keep-tag', notes = 'keep-note' WHERE id = ?")
      .run('migrated-codex-session');
    expect(await importFromSource(adapter, repository)).toMatchObject({
      imported: 0,
      updated: 0,
      skipped: 0,
      removed: 0,
      failed: 1,
    });
    expect(
      target.prepare('SELECT tags, notes FROM sessions WHERE id = ?').get('migrated-codex-session'),
    ).toEqual({ tags: 'keep-tag', notes: 'keep-note' });
    target.close();
  });

  it('refreshes an older Codex parser revision with captured turn models', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-profile-codex-model-'));
    tempDirectories.push(directory);
    writeFileSync(join(directory, 'session.jsonl'), createModernCodexTranscript());

    const target = createDatabase(':memory:');
    const repository = new SessionRepository(target, (model, at) =>
      lookupPricing(target, model, at),
    );
    const legacy = createParsedSession('modern-codex-session', 'legacy-span');
    legacy.meta.agent = 'codex';
    repository.replace(
      { parsed: legacy },
      { kind: 'codex', updatedAt: 1, fingerprint: 'file:codex-v2:1:1' },
    );

    const adapter = new TranscriptSourceAdapter(directory, 'codex');
    expect(await importFromSource(adapter, repository)).toMatchObject({
      imported: 0,
      updated: 1,
      skipped: 0,
      failed: 0,
    });
    expect(
      target
        .prepare(
          "SELECT model FROM spans WHERE session_id = ? AND type = 'llm_turn' ORDER BY start_time",
        )
        .all('modern-codex-session'),
    ).toEqual([{ model: 'gpt-5.6-sol' }]);
    expect(await importFromSource(adapter, repository)).toMatchObject({
      imported: 0,
      updated: 0,
      skipped: 1,
      failed: 0,
    });
    target.close();
  });

  it('imports Codex state titles and source-native child lineage into stored relationships', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-profile-codex-state-import-'));
    tempDirectories.push(directory);
    const transcriptPath = join(directory, 'parent.jsonl');
    const entries = createModernCodexTranscript()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    entries.push(
      {
        timestamp: '2026-07-28T12:00:03.000Z',
        type: 'event_msg',
        payload: {
          type: 'sub_agent_activity',
          kind: 'started',
          occurred_at_ms: 1_785_024_003_000,
          agent_thread_id: 'child-codex-session',
          agent_path: '/root/audit',
        },
      },
      {
        timestamp: '2026-07-28T12:00:05.000Z',
        type: 'response_item',
        payload: {
          type: 'agent_message',
          author: '/root/audit',
          content: [{ type: 'input_text', text: 'Message Type: FINAL_ANSWER\nDone' }],
        },
      },
    );
    writeFileSync(transcriptPath, entries.map((entry) => JSON.stringify(entry)).join('\n'));

    const statePath = join(directory, 'state.sqlite');
    const state = new Database(statePath);
    state.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        rollout_path TEXT NOT NULL,
        title TEXT,
        agent_nickname TEXT,
        agent_role TEXT,
        agent_path TEXT
      );
      CREATE TABLE thread_spawn_edges (
        parent_thread_id TEXT NOT NULL,
        child_thread_id TEXT PRIMARY KEY,
        status TEXT NOT NULL
      );
    `);
    state
      .prepare(
        `INSERT INTO threads (
          id, rollout_path, title, agent_nickname, agent_role, agent_path
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('modern-codex-session', transcriptPath, 'State DB 标题', 'Root', 'primary', '/root');
    state
      .prepare(
        `INSERT INTO threads (
          id, rollout_path, title, agent_nickname, agent_role, agent_path
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'child-codex-session',
        join(directory, 'child.jsonl'),
        '子 agent',
        'Audit',
        'review',
        '/root/audit',
      );
    state
      .prepare(
        `INSERT INTO thread_spawn_edges (parent_thread_id, child_thread_id, status)
         VALUES (?, ?, ?)`,
      )
      .run('modern-codex-session', 'child-codex-session', 'completed');
    state.close();

    const target = createDatabase(':memory:');
    const repository = new SessionRepository(target, (model, at) =>
      lookupPricing(target, model, at),
    );
    const adapter = new TranscriptSourceAdapter(directory, 'codex', undefined, {
      codexStateDatabasePath: statePath,
    });
    expect(await importFromSource(adapter, repository)).toMatchObject({ imported: 1, failed: 0 });
    expect(
      target.prepare('SELECT name FROM sessions WHERE id = ?').get('modern-codex-session'),
    ).toEqual({ name: 'State DB 标题' });
    expect(
      target
        .prepare(
          `SELECT parent_session_id as parentSessionId, call_started_at as callStartedAt,
             callback_at as callbackAt, callback_status as callbackStatus,
             agent_nickname as agentNickname, agent_role as agentRole, agent_path as agentPath
           FROM session_relationships WHERE child_session_id = ?`,
        )
        .get('child-codex-session'),
    ).toEqual({
      parentSessionId: 'modern-codex-session',
      callStartedAt: 1_785_024_003_000,
      callbackAt: Date.parse('2026-07-28T12:00:05.000Z'),
      callbackStatus: 'final_answer',
      agentNickname: 'Audit',
      agentRole: 'review',
      agentPath: '/root/audit',
    });
    target.close();
  });

  it('atomically replaces a source-native child relationship without touching annotations', () => {
    const target = createDatabase(':memory:');
    const repository = new SessionRepository(target, (model, at) =>
      lookupPricing(target, model, at),
    );
    const child = createParsedSession('codex-child', 'child-span');
    child.meta.sourceParentSessionId = 'codex-parent';
    repository.replace(
      { parsed: child },
      { kind: 'codex', updatedAt: 1, fingerprint: 'codex:child-v1' },
    );
    target.prepare("UPDATE sessions SET tags = 'keep' WHERE id = ?").run('codex-child');

    child.meta.sourceParentSessionId = 'codex-parent-replaced';
    repository.replace(
      { parsed: child },
      { kind: 'codex', updatedAt: 2, fingerprint: 'codex:child-v2' },
    );

    expect(
      target
        .prepare(
          'SELECT parent_session_id as parentSessionId, source_kind as sourceKind FROM session_relationships WHERE child_session_id = ?',
        )
        .get('codex-child'),
    ).toEqual({ parentSessionId: 'codex-parent-replaced', sourceKind: 'codex' });
    expect(target.prepare('SELECT tags FROM sessions WHERE id = ?').get('codex-child')).toEqual({
      tags: 'keep',
    });
    repository.resetGeneratedData();
    expect(target.prepare('SELECT COUNT(*) as count FROM session_relationships').get()).toEqual({
      count: 0,
    });
    target.close();
  });

  it('preserves parent-provided call and callback evidence across reverse import order', () => {
    const target = createDatabase(':memory:');
    const repository = new SessionRepository(target, (model, at) =>
      lookupPricing(target, model, at),
    );
    const child = createParsedSession('lineage-child', 'lineage-child-span');
    child.meta.agent = 'codex';
    child.meta.sourceParentSessionId = 'lineage-parent';
    child.meta.sourceAgentNickname = 'Audit';
    child.meta.sourceAgentRole = 'review';
    child.meta.sourceAgentPath = '/root/audit';

    repository.replace(
      { parsed: child },
      { kind: 'codex', updatedAt: 1, fingerprint: 'lineage:child' },
      100,
    );

    const parent = createParsedSession('lineage-parent', 'lineage-parent-span');
    parent.meta.agent = 'codex';
    parent.meta.sourceChildLineage = [
      {
        childSessionId: 'lineage-child',
        agentNickname: 'Audit',
        agentRole: 'review',
        agentPath: '/root/audit',
        callStartedAt: 200,
        callbackAt: 300,
        callbackStatus: 'final_answer',
      },
    ];
    repository.replace(
      { parsed: parent },
      { kind: 'codex', updatedAt: 2, fingerprint: 'lineage:parent' },
      400,
    );

    expect(
      target
        .prepare(
          `SELECT parent_session_id as parentSessionId, call_started_at as callStartedAt,
             callback_at as callbackAt, callback_status as callbackStatus,
             agent_nickname as agentNickname, agent_role as agentRole, agent_path as agentPath
           FROM session_relationships WHERE child_session_id = ?`,
        )
        .get('lineage-child'),
    ).toEqual({
      parentSessionId: 'lineage-parent',
      callStartedAt: 200,
      callbackAt: 300,
      callbackStatus: 'final_answer',
      agentNickname: 'Audit',
      agentRole: 'review',
      agentPath: '/root/audit',
    });

    child.meta.sourceAgentNickname = undefined;
    child.meta.sourceAgentRole = undefined;
    child.meta.sourceAgentPath = undefined;
    repository.replace(
      { parsed: child },
      { kind: 'codex', updatedAt: 3, fingerprint: 'lineage:child-reimport' },
      500,
    );
    expect(
      target
        .prepare(
          `SELECT call_started_at as callStartedAt, callback_at as callbackAt,
             callback_status as callbackStatus, agent_nickname as agentNickname
           FROM session_relationships WHERE child_session_id = ?`,
        )
        .get('lineage-child'),
    ).toEqual({
      callStartedAt: 200,
      callbackAt: 300,
      callbackStatus: 'final_answer',
      agentNickname: 'Audit',
    });
    target.close();
  });

  it('excludes only MiMo copies of canonical Claude Code histories', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-profile-mimo-external-'));
    tempDirectories.push(directory);
    const mimoPath = join(directory, 'mimo.db');
    createMiMoExternalHistoryFixture(mimoPath);

    const target = createDatabase(':memory:');
    const repository = new SessionRepository(target, (model, at) =>
      lookupPricing(target, model, at),
    );
    const legacyCopy = createParsedSession('mimo-session', 'legacy-mimo-span');
    legacyCopy.meta.agent = 'mimo-code';
    repository.replace(
      { parsed: legacyCopy },
      { kind: 'mimo-code', updatedAt: 1, fingerprint: 'mimo:legacy' },
    );

    const adapter = new MiMoSourceAdapter(mimoPath);
    const items = await adapter.discover();
    const externalHistory = items.find((item) => item.sessionId === 'mimo-session');
    expect(externalHistory?.revision.fingerprint).toMatch(/^mimo-v2:/);
    await expect(externalHistory?.load()).resolves.toEqual({
      excluded: true,
      sessionId: 'mimo-session',
      reason: 'non_actionable_external_history',
    });

    expect(await importFromSource(adapter, repository)).toMatchObject({
      scanned: 3,
      imported: 2,
      updated: 0,
      skipped: 1,
      removed: 1,
      failed: 0,
      protectedAnnotatedSessions: 0,
      skipReasons: { excluded_non_actionable: 1 },
    });
    expect(
      target.prepare('SELECT id FROM sessions WHERE id = ?').get('mimo-session'),
    ).toBeUndefined();
    expect(
      target
        .prepare('SELECT id FROM sessions WHERE id IN (?, ?) ORDER BY id')
        .all('mimo-noncanonical-cc', 'mimo-non-cc'),
    ).toEqual([{ id: 'mimo-non-cc' }, { id: 'mimo-noncanonical-cc' }]);

    expect(await importFromSource(adapter, repository)).toMatchObject({
      imported: 0,
      updated: 0,
      skipped: 3,
      removed: 0,
      failed: 0,
      skipReasons: { unchanged_revision: 2, excluded_non_actionable: 1 },
    });

    const directClaude = createParsedSession('mimo-session', 'direct-claude-span');
    directClaude.meta.agent = 'claude-code';
    repository.replace(
      { parsed: directClaude },
      { kind: 'claude-code', updatedAt: 1, fingerprint: 'claude:direct' },
    );
    expect(
      target
        .prepare("SELECT COUNT(*) AS count FROM sessions WHERE source_kind = 'claude-code'")
        .get(),
    ).toEqual({ count: 1 });
    expect(await importFromSource(adapter, repository)).toMatchObject({
      skipped: 3,
      removed: 0,
      failed: 0,
      skipReasons: { unchanged_revision: 2, excluded_non_actionable: 1 },
    });
    expect(
      target
        .prepare("SELECT COUNT(*) AS count FROM sessions WHERE source_kind = 'claude-code'")
        .get(),
    ).toEqual({ count: 1 });

    target.close();
  });

  it('retains annotated MiMo copies of external Claude histories and reports manual cleanup', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-profile-mimo-annotated-'));
    tempDirectories.push(directory);
    const mimoPath = join(directory, 'mimo.db');
    createMiMoExternalHistoryFixture(mimoPath);

    const target = createDatabase(':memory:');
    const repository = new SessionRepository(target, (model, at) =>
      lookupPricing(target, model, at),
    );
    const legacyCopy = createParsedSession('mimo-session', 'legacy-mimo-span');
    legacyCopy.meta.agent = 'mimo-code';
    repository.replace(
      { parsed: legacyCopy },
      { kind: 'mimo-code', updatedAt: 1, fingerprint: 'mimo:legacy' },
    );
    target
      .prepare("UPDATE sessions SET tags = 'keep', notes = 'user annotation' WHERE id = ?")
      .run('mimo-session');

    expect(await importFromSource(new MiMoSourceAdapter(mimoPath), repository)).toMatchObject({
      imported: 2,
      removed: 0,
      failed: 1,
      protectedAnnotatedSessions: 1,
      skipReasons: { excluded_non_actionable: 0 },
    });
    expect(
      target.prepare('SELECT tags, notes FROM sessions WHERE id = ?').get('mimo-session'),
    ).toEqual({
      tags: 'keep',
      notes: 'user annotation',
    });
    target.close();
  });

  it('stores source-native parent evidence without merging parent tokens into the child', () => {
    const database = createDatabase(':memory:');
    const repository = new SessionRepository(database, (model, at) =>
      lookupPricing(database, model, at),
    );

    repository.replace(
      {
        parsed: createChildParsedSession('child-session', 'child-span', 'parent-session'),
      },
      { kind: 'codex', updatedAt: 100, fingerprint: 'child-v1' },
      1000,
    );

    const relationship = database
      .prepare(
        `SELECT child_session_id as childSessionId,
          parent_session_id as parentSessionId,
          source_kind as sourceKind, relation_kind as relationKind
         FROM session_relationships WHERE child_session_id = ?`,
      )
      .get('child-session');
    expect(relationship).toEqual({
      childSessionId: 'child-session',
      parentSessionId: 'parent-session',
      sourceKind: 'codex',
      relationKind: 'source_parent',
    });
    // 父 Session 不存在时，child 的 token 仍只来自自身 evidence，绝不合并。
    const childAggregate = database
      .prepare(
        `SELECT input_tokens as inputTokens, total_cost as totalCost,
          cost_unknown_count as costUnknownCount
         FROM sessions WHERE id = ?`,
      )
      .get('child-session');
    expect(childAggregate).toMatchObject({ inputTokens: 10, totalCost: 0, costUnknownCount: 1 });
    database.close();
  });
});

function createChildParsedSession(
  sessionId: string,
  spanId: string,
  sourceParentSessionId: string,
): ParsedSession {
  const parsed = createParsedSession(sessionId, spanId);
  parsed.meta.agent = 'codex';
  parsed.meta.sourceParentSessionId = sourceParentSessionId;
  return parsed;
}

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
    costStatus: 'unknown_pricing',
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
  return createClaudeLineAt(uuid, outputTokens, uuid === 'turn-1' ? 0 : 1);
}

function createClaudeLineAt(uuid: string, outputTokens: number, second: number): string {
  return JSON.stringify({
    type: 'assistant',
    sessionId: 'claude-session',
    uuid,
    parentUuid: null,
    timestamp: `2026-07-26T00:00:${String(second).padStart(2, '0')}.000Z`,
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

function createMigratedCodexTranscript(): string {
  const timestamp = '2026-07-08T10:05:43.713Z';
  return [
    {
      timestamp,
      type: 'session_meta',
      payload: {
        id: 'migrated-codex-session',
        cwd: '/Users/guogenyuan/Desktop/im',
        source: 'vscode',
        originator: 'Codex Desktop',
      },
    },
    {
      timestamp,
      type: 'event_msg',
      payload: {
        type: 'task_started',
        turn_id: 'external-import-turn-1',
        started_at: 1_780_000_000,
      },
    },
    {
      timestamp,
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'fixture prompt' }],
      },
    },
    {
      timestamp,
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'fixture answer' }],
      },
    },
    {
      timestamp,
      type: 'event_msg',
      payload: {
        type: 'task_complete',
        turn_id: 'external-import-turn-1',
        completed_at: 1_780_000_030,
      },
    },
  ]
    .map((entry) => JSON.stringify(entry))
    .join('\n');
}

function createModernCodexTranscript(): string {
  return [
    {
      timestamp: '2026-07-28T12:00:00.000Z',
      type: 'session_meta',
      payload: {
        id: 'modern-codex-session',
        cwd: '/tmp/project',
        source: 'vscode',
        originator: 'Codex Desktop',
        model_provider: 'openai',
      },
    },
    {
      timestamp: '2026-07-28T12:00:01.000Z',
      type: 'turn_context',
      payload: { turn_id: 'modern-turn', model: 'gpt-5.6-sol' },
    },
    {
      timestamp: '2026-07-28T12:00:02.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: {
            input_tokens: 100,
            cached_input_tokens: 20,
            output_tokens: 10,
            reasoning_output_tokens: 5,
            total_tokens: 135,
          },
        },
      },
    },
  ]
    .map((entry) => JSON.stringify(entry))
    .join('\n');
}

function createCodexTurn(turnId: string, time: string): string {
  const timestamp = `2026-07-28T${time}:00.000Z`;
  return [
    {
      timestamp,
      type: 'turn_context',
      payload: { turn_id: turnId, model: 'gpt-5.6-sol' },
    },
    {
      timestamp: `2026-07-28T${time}:01.000Z`,
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: {
            input_tokens: 100,
            cached_input_tokens: 20,
            output_tokens: 10,
            reasoning_output_tokens: 5,
            total_tokens: 135,
          },
        },
      },
    },
  ]
    .map((entry) => JSON.stringify(entry))
    .join('\n');
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
    CREATE TABLE external_import (
      source TEXT NOT NULL,
      source_key TEXT NOT NULL,
      session_id TEXT NOT NULL,
      source_path TEXT NOT NULL,
      source_mtime INTEGER NOT NULL,
      time_imported INTEGER NOT NULL,
      PRIMARY KEY (source, source_key)
    );
  `);
  insertMiMoSession(database, 'mimo-session', 'initial', 1000);
  database.close();
}

function createMiMoExternalHistoryFixture(path: string): void {
  createMiMoFixture(path);
  const database = new Database(path);
  insertMiMoSession(database, 'mimo-noncanonical-cc', 'noncanonical cc', 2000);
  insertMiMoSession(database, 'mimo-non-cc', 'non-cc', 3000);
  database
    .prepare(
      `INSERT INTO external_import (
        source, source_key, session_id, source_path, source_mtime, time_imported
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      'cc',
      'canonical-claude',
      'mimo-session',
      join(homedir(), '.claude', 'projects', 'fixture', 'session.jsonl'),
      1000,
      1000,
    );
  database
    .prepare(
      `INSERT INTO external_import (
        source, source_key, session_id, source_path, source_mtime, time_imported
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      'cc',
      'noncanonical-claude',
      'mimo-noncanonical-cc',
      '/tmp/not-claude-projects/session.jsonl',
      1000,
      1000,
    );
  database
    .prepare(
      `INSERT INTO external_import (
        source, source_key, session_id, source_path, source_mtime, time_imported
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      'codex',
      'canonical-non-cc',
      'mimo-non-cc',
      join(homedir(), '.claude', 'projects', 'fixture', 'session.jsonl'),
      1000,
      1000,
    );
  database.close();
}

function insertMiMoSession(
  database: Database.Database,
  sessionId: string,
  title: string,
  time: number,
): void {
  database
    .prepare(
      'INSERT INTO session (id, title, directory, time_created, time_updated) VALUES (?, ?, ?, ?, ?)',
    )
    .run(sessionId, title, '/tmp/project', time, time);
  database
    .prepare(
      'INSERT INTO message (id, session_id, agent_id, time_created, data) VALUES (?, ?, ?, ?, ?)',
    )
    .run(
      `${sessionId}-message`,
      sessionId,
      'agent',
      time,
      JSON.stringify({
        role: 'assistant',
        modelID: 'fixture-model',
        providerID: 'fixture',
        tokens: { input: 10, output: 5, reasoning: 0 },
        time: { created: time, completed: time + 100 },
      }),
    );
}

function createOpenCodeFixture(path: string): void {
  const database = new Database(path);
  database.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      directory TEXT NOT NULL,
      model TEXT,
      agent TEXT,
      tokens_input INTEGER NOT NULL,
      tokens_output INTEGER NOT NULL,
      tokens_reasoning INTEGER NOT NULL,
      tokens_cache_read INTEGER NOT NULL,
      tokens_cache_write INTEGER NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      data TEXT NOT NULL
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `);
  database
    .prepare(
      `INSERT INTO session (
        id, title, directory, model, agent, tokens_input, tokens_output,
        tokens_reasoning, tokens_cache_read, tokens_cache_write, time_created, time_updated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      'opencode-session',
      'initial',
      '/tmp/project',
      JSON.stringify({ providerID: 'opencode', id: 'fixture-model' }),
      'build',
      10,
      5,
      1,
      3,
      2,
      1000,
      1000,
    );
  database
    .prepare('INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)')
    .run(
      'opencode-assistant',
      'opencode-session',
      1000,
      JSON.stringify({ role: 'assistant', time: { created: 1000, completed: 1100 } }),
    );
  database
    .prepare(
      'INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)',
    )
    .run(
      'opencode-answer',
      'opencode-assistant',
      'opencode-session',
      1000,
      JSON.stringify({ type: 'text', text: 'fixture answer' }),
    );
  database.close();
}
