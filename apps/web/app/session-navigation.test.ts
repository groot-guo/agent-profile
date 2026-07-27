import type { SessionSummary } from '@agent-profile/core';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SESSION_NAVIGATION,
  filterSessions,
  groupSessionsByTime,
  parseSessionNavigation,
  projectOptions,
  serializeSessionNavigation,
  visibleSessionSlice,
} from './session-navigation';

describe('flat Session navigation', () => {
  it('composes project, Agent, search, quick-view, and sort filters', () => {
    const sessions = [
      session('a', '/repo/alpha', 'codex', 100, 0),
      session('b', '/repo/alpha', 'claude-code', 300, 1),
      session('c', '/repo/beta', 'codex', 200, 0),
    ];
    const result = filterSessions(sessions, new Set(['a']), {
      ...DEFAULT_SESSION_NAVIGATION,
      agent: 'codex',
      project: 'alpha',
      query: 'session',
      quickView: 'anomaly',
      sort: 'cost',
    });
    expect(result.map((item) => item.id)).toEqual(['a']);

    expect(
      filterSessions(sessions, new Set(), {
        ...DEFAULT_SESSION_NAVIGATION,
        quickView: 'unpriced',
      }).map((item) => item.id),
    ).toEqual(['b']);
  });

  it('round-trips stable URL state and ignores invalid enum values', () => {
    const state = parseSessionNavigation(
      '?q=cache&project=%2Frepo%2Falpha&agent=codex&sort=tokens&view=unpriced&session=a',
    );
    expect(serializeSessionNavigation(state)).toBe(
      'q=cache&project=%2Frepo%2Falpha&agent=codex&sort=tokens&view=unpriced&session=a',
    );
    expect(parseSessionNavigation('?sort=invalid&view=invalid')).toMatchObject({
      sort: 'time',
      quickView: 'all',
    });
  });

  it('groups recent Sessions by time and bounds a 400-row render', () => {
    const now = new Date('2026-07-27T12:00:00+08:00').getTime();
    const sessions = Array.from({ length: 400 }, (_, index) =>
      session(
        `session-${index}`,
        `/repo/project-${index % 4}`,
        'codex',
        now - index * 86_400_000,
        0,
      ),
    );
    expect(visibleSessionSlice(sessions, 120)).toHaveLength(120);
    expect(groupSessionsByTime(sessions.slice(0, 10), now).map((group) => group.label)).toEqual([
      '今天',
      '昨天',
      '最近 7 天',
      '最近 30 天',
    ]);
    expect(projectOptions(sessions)[0]).toEqual({ project: '/repo/project-0', count: 100 });
  });
});

function session(
  id: string,
  cwd: string,
  agent: string,
  startTime: number,
  costUnknownCount: number,
): SessionSummary {
  return {
    id,
    name: `session ${id}`,
    filePath: `${cwd}/${id}.jsonl`,
    cwd,
    agent,
    startTime,
    endTime: startTime + 100,
    inputTokens: 10,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 5,
    totalCost: startTime,
    costUnknownCount,
    peakContextTokens: 10,
    avgContextTokens: 10,
    cacheHitRate: 0,
    messageCount: 1,
    importedAt: startTime,
  };
}
