import { describe, expect, it } from 'vitest';
import { loadDashboardSpanAggregates } from '../routes/stats';

describe('dashboard span aggregation', () => {
  it('uses two set-based queries regardless of Session count', () => {
    const queries: string[] = [];
    const database = {
      prepare(sql: string) {
        queries.push(sql);
        return {
          all: () =>
            queries.length === 1
              ? [
                  {
                    model: 'fixture-model',
                    count: 400,
                    inputTokens: 10_000,
                    outputTokens: 2_000,
                    cost: 12,
                  },
                ]
              : [{ name: 'Read', count: 30, errors: 1 }],
        };
      },
    } as Parameters<typeof loadDashboardSpanAggregates>[0];

    const aggregates = loadDashboardSpanAggregates(database);

    expect(queries).toHaveLength(2);
    expect(queries[0]).toContain('GROUP BY');
    expect(queries[1]).toContain('recent_sessions');
    expect(aggregates.modelMap.get('fixture-model')).toMatchObject({ count: 400 });
    expect(aggregates.recentTools).toEqual([{ name: 'Read', count: 30, errors: 1 }]);
  });
});
