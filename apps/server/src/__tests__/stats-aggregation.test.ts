import { CODEX_SESSION_RECORDS_PROJECT } from '@agent-profile/core';
import { describe, expect, it } from 'vitest';
import { buildProjectStats, loadDashboardSpanAggregates } from '../routes/stats';

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
    expect(aggregates.modelMap.get('unknown:fixture-model')).toMatchObject({ count: 400 });
    expect(aggregates.recentTools).toEqual([{ name: 'Read', count: 30, errors: 1 }]);
  });

  it('groups safe aliases while retaining provider-only and unknown identities', () => {
    const rows = [
      { model: 'DeepSeek-V4-Flash', count: 2, inputTokens: 10, outputTokens: 2, cost: 1 },
      { model: 'deepseek-v4-flash', count: 3, inputTokens: 20, outputTokens: 4, cost: 2 },
      { model: 'litellm', count: 1, inputTokens: 5, outputTokens: 1, cost: 0 },
      { model: 'glm-5-2-origin', count: 1, inputTokens: 5, outputTokens: 1, cost: 0 },
    ];
    let query = 0;
    const aggregates = loadDashboardSpanAggregates({
      prepare() {
        query++;
        return { all: () => (query === 1 ? rows : []) };
      },
    } as unknown as Parameters<typeof loadDashboardSpanAggregates>[0]);

    expect(aggregates.modelMap.get('model:deepseek-v4-flash')).toMatchObject({
      count: 5,
      rawModels: ['DeepSeek-V4-Flash', 'deepseek-v4-flash'],
    });
    expect(aggregates.modelMap.get('provider:litellm')).toMatchObject({ kind: 'provider_only' });
    expect(aggregates.modelMap.get('unknown:glm-5-2-origin')).toMatchObject({ kind: 'unknown' });
  });

  it('uses one Codex Session-record category for totals, baselines, and anomalies', () => {
    const sessions = [
      projectSession(
        'codex-a',
        'codex',
        undefined,
        '/Users/example/.codex/sessions/2026/07/27/rollout-a.jsonl',
        1,
      ),
      projectSession(
        'codex-b',
        'codex',
        undefined,
        '/Users/example/.codex/sessions/2026/07/28/rollout-b.jsonl',
        1,
      ),
      projectSession(
        'codex-c',
        'codex',
        undefined,
        '/Users/example/.codex/sessions/2026/07/28/rollout-c.jsonl',
        1,
      ),
      projectSession(
        'codex-anomaly',
        'codex',
        undefined,
        '/Users/example/.codex/sessions/2026/07/28/rollout-d.jsonl',
        5,
      ),
      projectSession('codex-project', 'codex', '/workspace/project', '/rollout-e.jsonl', 2),
    ];

    const stats = buildProjectStats(sessions);

    expect(stats.byProject).toContainEqual({
      cwd: CODEX_SESSION_RECORDS_PROJECT,
      sessions: 4,
      totalTokens: 60,
      totalCost: 8,
    });
    expect(stats.byProject).toContainEqual({
      cwd: '/workspace/project',
      sessions: 1,
      totalTokens: 15,
      totalCost: 2,
    });
    expect(stats.baselineProjects[CODEX_SESSION_RECORDS_PROJECT]).toMatchObject({
      sessions: 4,
      medCost: 1,
    });
    expect(stats.anomalySessions).toEqual(['codex-anomaly']);
    expect(Object.keys(stats.baselineProjects)).not.toContain('28');
  });
});

function projectSession(
  id: string,
  agent: string,
  cwd: string | undefined,
  filePath: string,
  totalCost: number,
): Record<string, unknown> {
  return {
    id,
    agent,
    cwd,
    filePath,
    inputTokens: 10,
    cacheCreationTokens: 1,
    cacheReadTokens: 2,
    outputTokens: 2,
    totalCost,
    cacheHitRate: 0.5,
  };
}
