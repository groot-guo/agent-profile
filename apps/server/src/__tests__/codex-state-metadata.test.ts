import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadCodexStateMetadataIndex,
  resolveCodexStateDatabasePath,
} from '../ingestion/codex-state-metadata';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Codex state metadata', () => {
  it('prefers local session-index titles and exposes agent identity and child edges', () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-profile-codex-state-'));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, 'state.sqlite');
    const database = new Database(databasePath);
    database.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        rollout_path TEXT NOT NULL,
        title TEXT NOT NULL,
        agent_nickname TEXT,
        agent_role TEXT,
        agent_path TEXT
      );
      CREATE TABLE thread_spawn_edges (
        parent_thread_id TEXT NOT NULL,
        child_thread_id TEXT PRIMARY KEY,
        status TEXT NOT NULL
      );
      INSERT INTO threads (
        id, rollout_path, title, agent_nickname, agent_role, agent_path
      ) VALUES
        ('parent', '/codex/parent.jsonl', '真实标题', 'Root', 'primary', '/root'),
        ('child', '/codex/child.jsonl', '子会话', 'Audit', 'review', '/root/audit');
      INSERT INTO thread_spawn_edges (parent_thread_id, child_thread_id, status)
        VALUES ('parent', 'child', 'completed');
    `);
    database
      .prepare('INSERT INTO threads (id, rollout_path, title) VALUES (?, ?, ?)')
      .run(
        'opaque',
        '/codex/opaque.jsonl',
        '<codex_delegation><source_thread_id>parent</source_thread_id>',
      );
    database.close();
    writeFileSync(
      join(directory, 'session_index.jsonl'),
      [
        JSON.stringify({ id: 'parent', thread_name: '本地父会话' }),
        JSON.stringify({ id: 'child', thread_name: '本地子会话' }),
      ].join('\n'),
    );

    const index = loadCodexStateMetadataIndex(databasePath);
    const parent = index.metadataFor('/codex/parent.jsonl');
    const child = index.metadataFor('/other/child.jsonl', 'child');

    expect(parent).toMatchObject({
      threadId: 'parent',
      title: '本地父会话',
      agentNickname: 'Root',
      agentRole: 'primary',
      agentPath: '/root',
      sourceChildMetadata: {
        child: {
          agentNickname: 'Audit',
          agentRole: 'review',
          agentPath: '/root/audit',
        },
      },
    });
    expect(child).toMatchObject({
      threadId: 'child',
      title: '本地子会话',
      sourceParentSessionId: 'parent',
    });
    expect(index.metadataFor('/codex/opaque.jsonl')?.title).toBeUndefined();
    expect(parent?.fingerprint).toMatch(/^[a-f0-9]{16}$/);
  });

  it('returns an empty index when the optional state database is unavailable', () => {
    const index = loadCodexStateMetadataIndex('/tmp/agent-profile-no-such-state.sqlite');
    expect(index.metadataFor('/codex/missing.jsonl', 'missing')).toBeUndefined();
  });

  it('selects the highest numbered state database in a Codex home', () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-profile-codex-home-'));
    temporaryDirectories.push(directory);
    const codexDirectory = join(directory, '.codex');
    mkdirSync(codexDirectory);
    const database = new Database(join(codexDirectory, 'state_7.sqlite'));
    database.close();

    expect(resolveCodexStateDatabasePath(directory)).toBe(join(codexDirectory, 'state_7.sqlite'));
  });
});
