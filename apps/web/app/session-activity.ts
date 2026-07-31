import {
  SESSION_ACTIVITY_RECENT_WINDOW_MS,
  SESSION_ACTIVITY_UPDATING_WINDOW_MS,
  type SessionActivityState,
  type SessionDiscoveryItem,
} from '@agent-profile/contracts';
import { groupSessionsForDisplay, type SessionSort } from './session-navigation';

export function activityStateAt(
  session: Pick<SessionDiscoveryItem, 'activityState' | 'activityBasis' | 'lastActivityAt'>,
  now = Date.now(),
): SessionActivityState {
  if (session.activityBasis !== 'revision_change' || session.lastActivityAt === null) {
    return session.activityState;
  }
  const age = Math.max(0, now - session.lastActivityAt);
  if (age <= SESSION_ACTIVITY_UPDATING_WINDOW_MS) return 'updating';
  if (age <= SESSION_ACTIVITY_RECENT_WINDOW_MS) return 'recent';
  return 'settled';
}

export function groupSessionsWithActivity(
  sessions: SessionDiscoveryItem[],
  sort: SessionSort,
  now = Date.now(),
): Array<{ key: string; label: string; sessions: SessionDiscoveryItem[] }> {
  if (sort !== 'time') return groupSessionsForDisplay(sessions, sort, now);
  const active: SessionDiscoveryItem[] = [];
  const settled: SessionDiscoveryItem[] = [];
  for (const session of sessions) {
    const state = activityStateAt(session, now);
    if (state === 'updating' || state === 'recent') active.push(session);
    else settled.push(session);
  }
  return [
    ...(active.length > 0 ? [{ key: 'active', label: '活跃会话', sessions: active }] : []),
    ...groupSessionsForDisplay(settled, sort, now),
  ];
}

export function activityLabel(state: SessionActivityState): string | null {
  if (state === 'updating') return '正在更新';
  if (state === 'recent') return '最近活跃';
  return null;
}
