import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../database';
import {
  discoverSessionPage,
  discoverSessions,
  type SessionDiscoveryError,
} from '../session-discovery-service';

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

  it('filters, sorts, counts, and paginates bounded Web discovery without source content', () => {
    insertDiscoverySession(database, {
      id: 'alpha-high',
      agent: 'claude-code',
      project: '/workspace/alpha',
      startTime: 4_000,
      totalCost: 9,
      totalTokens: 900,
      name: 'stored reasoning must not be emitted',
    });
    insertDiscoverySession(database, {
      id: 'alpha-tie-b',
      agent: 'claude-code',
      project: '/workspace/alpha',
      startTime: 3_000,
      totalCost: 4,
      totalTokens: 800,
    });
    insertDiscoverySession(database, {
      id: 'alpha-tie-a',
      agent: 'claude-code',
      project: '/workspace/alpha',
      startTime: 2_000,
      totalCost: 4,
      totalTokens: 700,
    });
    insertDiscoverySession(database, {
      id: 'beta-unpriced',
      agent: 'codex',
      project: '/workspace/beta',
      startTime: 5_000,
      totalCost: 20,
      totalTokens: 1_000,
      costUnknownCount: 1,
    });

    const firstPage = discoverSessionPage(database, {
      agent: 'claude-code',
      project: '/workspace/alpha',
      query: 'alpha',
      sort: 'cost',
      limit: 2,
      selectedId: 'beta-unpriced',
    });

    expect(firstPage).toMatchObject({
      schemaVersion: 'session-discovery/v2',
      counts: { matched: 3, total: 4 },
      page: { limit: 2, hasMore: true },
      sessions: [{ id: 'alpha-high' }, { id: 'alpha-tie-b' }],
      selectedSession: { id: 'beta-unpriced', project: '/workspace/beta' },
      facets: {
        agents: [
          { agent: 'claude-code', count: 3 },
          { agent: 'codex', count: 1 },
        ],
        projects: [
          { project: '/workspace/alpha', count: 3, lastUsedAt: 4_000 },
          { project: '/workspace/beta', count: 1, lastUsedAt: 5_000 },
        ],
      },
    });
    expect(firstPage.page.nextCursor).toEqual(expect.any(String));
    expect(JSON.stringify(firstPage)).not.toContain('fixture://');
    expect(JSON.stringify(firstPage)).not.toContain('stored reasoning must not be emitted');

    const secondPage = discoverSessionPage(database, {
      agent: 'claude-code',
      project: '/workspace/alpha',
      query: 'alpha',
      sort: 'cost',
      limit: 2,
      cursor: firstPage.page.nextCursor ?? undefined,
    });
    expect(secondPage).toMatchObject({
      page: { hasMore: false, nextCursor: null },
      sessions: [{ id: 'alpha-tie-a' }],
    });
  });

  it('keeps cursors bound to normalized filters and supports quick views', () => {
    insertDiscoverySession(database, {
      id: 'normal-low',
      project: '/workspace/alpha',
      startTime: 1_000,
      totalCost: 1,
    });
    insertDiscoverySession(database, {
      id: 'normal-mid',
      project: '/workspace/alpha',
      startTime: 2_000,
      totalCost: 2,
    });
    insertDiscoverySession(database, {
      id: 'anomaly-high',
      project: '/workspace/alpha',
      startTime: 3_000,
      totalCost: 10,
    });
    insertDiscoverySession(database, {
      id: 'unpriced',
      project: '/workspace/beta',
      startTime: 4_000,
      totalCost: 0,
      costUnknownCount: 1,
    });

    const firstPage = discoverSessionPage(database, { limit: 1 });
    expect(() =>
      discoverSessionPage(database, {
        limit: 1,
        sort: 'tokens',
        cursor: firstPage.page.nextCursor ?? undefined,
      }),
    ).toThrow('session cursor does not match query');

    expect(
      discoverSessionPage(database, { quickView: 'anomaly' }).sessions.map((session) => session.id),
    ).toEqual(['anomaly-high']);
    expect(
      discoverSessionPage(database, { quickView: 'unpriced' }).sessions.map(
        (session) => session.id,
      ),
    ).toEqual(['unpriced']);
  });

  it('classifies source-observed activity without treating end time as completion', () => {
    const now = 1_000_000;
    insertDiscoverySession(database, {
      id: 'updating',
      project: '/workspace/alpha',
      startTime: 100,
      totalCost: 1,
      sourceKind: 'claude-code',
      sourceUpdatedAt: now - 10_000,
    });
    insertDiscoverySession(database, {
      id: 'recent',
      project: '/workspace/alpha',
      startTime: 200,
      totalCost: 1,
      sourceKind: 'codex',
      sourceUpdatedAt: now - 60_000,
    });
    insertDiscoverySession(database, {
      id: 'settled',
      project: '/workspace/alpha',
      startTime: 300,
      totalCost: 1,
      sourceKind: 'claude-code',
      sourceUpdatedAt: now - 600_000,
    });
    insertDiscoverySession(database, {
      id: 'unavailable',
      project: '/workspace/alpha',
      startTime: 400,
      totalCost: 1,
      sourceKind: 'opencode',
      sourceUpdatedAt: now - 1_000,
    });

    const result = discoverSessionPage(database, {
      now,
      availableSourceKinds: new Set(['claude-code', 'codex']),
    });

    expect(
      Object.fromEntries(
        result.sessions.map((session) => [
          session.id,
          {
            state: session.activityState,
            basis: session.activityBasis,
            provisional: session.provisional,
            lastActivityAt: session.lastActivityAt,
            observedAt: session.activityObservedAt,
          },
        ]),
      ),
    ).toEqual({
      unavailable: {
        state: 'unknown',
        basis: 'source_unavailable',
        provisional: false,
        lastActivityAt: now - 1_000,
        observedAt: now,
      },
      settled: {
        state: 'settled',
        basis: 'revision_change',
        provisional: false,
        lastActivityAt: now - 600_000,
        observedAt: now,
      },
      recent: {
        state: 'recent',
        basis: 'revision_change',
        provisional: true,
        lastActivityAt: now - 60_000,
        observedAt: now,
      },
      updating: {
        state: 'updating',
        basis: 'revision_change',
        provisional: true,
        lastActivityAt: now - 10_000,
        observedAt: now,
      },
    });
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

function insertDiscoverySession(
  database: DatabaseConnection,
  input: {
    id: string;
    agent?: string;
    project: string;
    startTime: number;
    totalCost: number;
    totalTokens?: number;
    costUnknownCount?: number;
    name?: string;
    sourceKind?: string;
    sourceUpdatedAt?: number;
  },
): void {
  database
    .prepare(
      `INSERT INTO sessions (
        id, name, file_path, agent, project_key, source_kind, source_updated_at,
        start_time, end_time, input_tokens, total_cost, cost_unknown_count, imported_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.name ?? null,
      `fixture://${input.id}`,
      input.agent ?? 'claude-code',
      input.project,
      input.sourceKind ?? null,
      input.sourceUpdatedAt ?? null,
      input.startTime,
      input.startTime + 100,
      input.totalTokens ?? 0,
      input.totalCost,
      input.costUnknownCount ?? 0,
      input.startTime,
    );
  database
    .prepare(
      `INSERT INTO spans (id, session_id, type, name, start_time, is_sidechain)
       VALUES (?, ?, 'llm_turn', 'fixture', ?, 0)`,
    )
    .run(`${input.id}-span`, input.id, input.startTime);
}
