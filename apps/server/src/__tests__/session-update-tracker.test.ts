import { describe, expect, it, vi } from 'vitest';
import { SessionUpdateTracker } from '../session-update-tracker';

describe('Session update tracker', () => {
  it('returns bounded changed Session IDs after a cursor', async () => {
    const tracker = new SessionUpdateTracker({ clock: () => 1_000, historyLimit: 2 });

    tracker.publish(['session-a', 'session-b']);
    tracker.publish(['session-b', 'session-c']);

    await expect(tracker.waitFor(0, 0)).resolves.toEqual({
      version: 2,
      observedAt: 1_000,
      reset: false,
      sessionIds: ['session-a', 'session-b', 'session-c'],
    });
  });

  it('wakes one serialized waiter and marks an expired cursor for refresh', async () => {
    vi.useFakeTimers();
    try {
      const tracker = new SessionUpdateTracker({ clock: () => 2_000, historyLimit: 1 });
      const waiting = tracker.waitFor(0, 30_000);

      tracker.publish(['session-a']);
      await expect(waiting).resolves.toMatchObject({ version: 1, sessionIds: ['session-a'] });

      tracker.publish(['session-b']);
      await expect(tracker.waitFor(0, 0)).resolves.toEqual({
        version: 2,
        observedAt: 2_000,
        reset: true,
        sessionIds: ['session-b'],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns the same cursor after a bounded wait with no changes', async () => {
    vi.useFakeTimers();
    try {
      const tracker = new SessionUpdateTracker({ clock: () => 3_000 });
      const waiting = tracker.waitFor(0, 25_000);

      await vi.advanceTimersByTimeAsync(25_000);

      await expect(waiting).resolves.toEqual({
        version: 0,
        observedAt: 3_000,
        reset: false,
        sessionIds: [],
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
