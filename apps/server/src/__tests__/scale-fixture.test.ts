import { describe, expect, it } from 'vitest';
import { createDatabase, lookupPricing } from '../database';
import { SessionRepository } from '../ingestion/session-repository';
import {
  collectQueryPlans,
  measureUnchangedSync,
  seedScaleFixture,
} from '../performance/scale-fixture';

describe('representative scale fixture', () => {
  it('creates deterministic non-content evidence and skips unchanged revisions before load', async () => {
    const database = createDatabase(':memory:');
    const fixture = seedScaleFixture(database, {
      sessions: 12,
      spans: 600,
      largeSessionSpans: 120,
      projectCohortSessions: 3,
      projectCohortSpans: 60,
    });
    expect(fixture).toMatchObject({
      sessions: 12,
      spans: 600,
      largestSessionId: 'scale-session-0000',
      projectCohortSpanTotal: 240,
    });
    expect(database.prepare('SELECT COUNT(*) AS count FROM sessions').get()).toEqual({ count: 12 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM spans').get()).toEqual({ count: 600 });
    expect(
      database.prepare('SELECT COUNT(*) AS count FROM spans WHERE metadata IS NOT NULL').get(),
    ).toEqual({
      count: 0,
    });

    const queryPlans = collectQueryPlans(database, fixture.largestSessionId);
    expect(queryPlans.sessionList.length).toBeGreaterThan(0);
    expect(queryPlans.sessionDiscovery.join(' ')).toContain('idx_sessions_discovery_time');
    expect(queryPlans.sessionSpans.join(' ')).toContain('idx_spans_session');

    const repository = new SessionRepository(database, (model, at) =>
      lookupPricing(database, model, at),
    );
    const unchanged = await measureUnchangedSync(repository, fixture.sessions);
    expect(unchanged.loads).toBe(0);
    expect(unchanged.result).toMatchObject({
      scanned: 12,
      skipped: 12,
      failed: 0,
      skipReasons: { unchanged_revision: 12 },
    });
    database.close();
  });
});
