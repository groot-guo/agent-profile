import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../database';
import { discoverSessions, type SessionDiscoveryError } from '../session-discovery-service';

describe('session discovery service', () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase(':memory:');
  });

  afterEach(() => {
    database.close();
  });

  it('returns primary Session summaries through a stable bounded cursor without paths', () => {
    insertSession(database, 'session-a', 900);
    insertSession(database, 'session-b', 1_000);
    insertSession(database, 'session-c', 1_000);
    insertSession(database, 'codex-child', 1_100, true);
    database
      .prepare(
        "UPDATE sessions SET name = 'stored reasoning must not be emitted' WHERE id = 'session-c'",
      )
      .run();

    const firstPage = discoverSessions(database, { limit: 2 });

    expect(firstPage).toMatchObject({
      limit: 2,
      hasMore: true,
      sessions: [{ id: 'session-c' }, { id: 'session-b' }],
    });
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(JSON.stringify(firstPage)).not.toContain('fixture://');
    expect(JSON.stringify(firstPage)).not.toContain('stored reasoning must not be emitted');

    const secondPage = discoverSessions(database, {
      limit: 2,
      cursor: firstPage.nextCursor ?? undefined,
    });

    expect(secondPage).toMatchObject({
      hasMore: false,
      nextCursor: null,
      sessions: [{ id: 'session-a' }],
    });
  });

  it('rejects malformed cursors before querying the database', () => {
    expect(() => discoverSessions(database, { cursor: 'not-a-cursor' })).toThrow(
      'invalid session cursor',
    );
    try {
      discoverSessions(database, { cursor: 'not-a-cursor' });
      expect.unreachable('expected invalid cursor to throw');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'invalid_cursor',
      } satisfies Partial<SessionDiscoveryError>);
    }
  });
});

function insertSession(
  database: DatabaseConnection,
  id: string,
  startTime: number,
  isCodexChild = false,
): void {
  database
    .prepare(
      `INSERT INTO sessions (id, file_path, agent, start_time, imported_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, `fixture://${id}`, isCodexChild ? 'codex' : 'claude-code', startTime, startTime);
  database
    .prepare(
      `INSERT INTO spans (id, session_id, type, name, start_time, is_sidechain)
       VALUES (?, ?, 'llm_turn', 'fixture', ?, ?)`,
    )
    .run(`${id}-span`, id, startTime, isCodexChild ? 1 : 0);
}
