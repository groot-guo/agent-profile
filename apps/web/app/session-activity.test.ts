import type { SessionDiscoveryItem } from '@agent-profile/contracts';
import { describe, expect, it } from 'vitest';
import { activityStateAt, groupSessionsWithActivity } from './session-activity';

describe('Session activity presentation', () => {
  it('re-evaluates revision activity as time advances', () => {
    expect(activityStateAt(session('a', 990_000), 1_000_000)).toBe('updating');
    expect(activityStateAt(session('a', 940_000), 1_000_000)).toBe('recent');
    expect(activityStateAt(session('a', 100_000), 1_000_000)).toBe('settled');
    expect(activityStateAt({ ...session('a', null), activityState: 'unknown' }, 1_000_000)).toBe(
      'unknown',
    );
  });

  it('pins changing Sessions only for chronological discovery', () => {
    const sessions = [session('settled', 100_000), session('live', 990_000)];

    expect(groupSessionsWithActivity(sessions, 'time', 1_000_000)[0]).toMatchObject({
      key: 'active',
      label: '活跃会话',
      sessions: [{ id: 'live' }],
    });
    expect(groupSessionsWithActivity(sessions, 'cost', 1_000_000)).toHaveLength(1);
  });
});

function session(id: string, lastActivityAt: number | null): SessionDiscoveryItem {
  return {
    id,
    agent: 'codex',
    project: '/repo',
    startTime: 100,
    endTime: 200,
    inputTokens: 1,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 1,
    totalCost: 0,
    costUnknownCount: 0,
    costCurrency: 'CNY',
    peakContextTokens: 1,
    avgContextTokens: 1,
    cacheHitRate: 0,
    messageCount: 1,
    importedAt: 100,
    isAnomaly: false,
    activityState: lastActivityAt === null ? 'unknown' : 'settled',
    activityBasis: lastActivityAt === null ? 'not_observed' : 'revision_change',
    lastActivityAt,
    activityObservedAt: 100,
    provisional: false,
  };
}
