import { CODEX_SESSION_RECORDS_PROJECT } from '@agent-profile/core';
import { describe, expect, it } from 'vitest';
import { createDatabase } from '../database';
import {
  buildHomeStatistics,
  buildModelViews,
  buildProjectStats,
  buildStatsReport,
  loadDashboardSpanAggregates,
} from '../routes/stats';

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
    expect(queries[0]).toContain('primary_span.is_sidechain = 0');
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

    const views = buildModelViews(aggregates.modelMap);
    expect(views.byModel.map((entry) => entry.model)).toEqual([
      'deepseek-v4-flash',
      'litellm（未提供具体模型）',
      'glm-5-2-origin',
    ]);
    expect(views.modelDistribution.map((entry) => entry.model)).toEqual([
      'deepseek-v4-flash',
      'litellm（未提供具体模型）',
      'glm-5-2-origin',
    ]);
    expect(views.byModel.some((entry) => entry.model.startsWith('model:'))).toBe(false);
  });

  it('excludes sidechain-only Codex records from primary model aggregates', () => {
    const database = createDatabase(':memory:');
    try {
      database
        .prepare(
          `INSERT INTO sessions (id, file_path, agent, start_time)
           VALUES ('codex-root', 'fixture://root', 'codex', 1000),
                  ('codex-guardian', 'fixture://guardian', 'codex', 1001)`,
        )
        .run();
      database
        .prepare(
          `INSERT INTO spans (
            id, session_id, type, name, start_time, input_tokens, output_tokens,
            model, cost, is_sidechain
          ) VALUES
            ('root-turn', 'codex-root', 'llm_turn', 'gpt-5.6-sol', 1000, 10, 2,
             'gpt-5.6-sol', 0, 0),
            ('guardian-turn', 'codex-guardian', 'llm_turn', 'codex-auto-review',
             1001, 20, 4, 'codex-auto-review', 0, 1)`,
        )
        .run();

      const aggregates = loadDashboardSpanAggregates(database);
      expect(aggregates.modelMap.get('model:gpt-5.6-sol')).toMatchObject({ count: 1 });
      expect(aggregates.modelMap.has('model:codex-auto-review')).toBe(false);
    } finally {
      database.close();
    }
  });

  it('uses one Codex Session-record category for totals, baselines, and anomalies', () => {
    const sessions = [
      projectSession(
        'codex-a',
        'codex',
        '/Users/example/Documents/Codex/2026-07-27/chat-a',
        '/Users/example/.codex/sessions/2026/07/27/rollout-a.jsonl',
        1,
      ),
      projectSession(
        'codex-b',
        'codex',
        '/Users/example/Documents/Codex/2026-07-28/chat-b',
        '/Users/example/.codex/sessions/2026/07/28/rollout-b.jsonl',
        1,
      ),
      projectSession(
        'codex-c',
        'codex',
        '/Users/example/Documents/Codex/2026-07-28/chat-c',
        '/Users/example/.codex/sessions/2026/07/28/rollout-c.jsonl',
        1,
      ),
      projectSession(
        'codex-anomaly',
        'codex',
        '/Users/example/Documents/Codex/2026-07-28/chat-d',
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

  it('builds a bounded privacy-safe Home statistics response with set-based totals', () => {
    const database = createDatabase(':memory:');
    try {
      database
        .prepare(
          `INSERT INTO sessions (
            id, name, file_path, agent, project_key, start_time, end_time,
            input_tokens, cache_creation_tokens, cache_read_tokens, output_tokens,
            total_cost, cost_unknown_count, cache_hit_rate, peak_context_tokens
          ) VALUES
            ('cost-top', 'stored content', 'fixture://cost', 'claude-code', '/workspace/a',
             3000, 3100, 10, 2, 3, 4, 9, 0, 0.3, 100),
            ('token-top', NULL, 'fixture://tokens', 'codex', '/workspace/b',
             2000, 2200, 100, 20, 30, 40, 2, 1, 0.4, 200),
            ('normal', NULL, 'fixture://normal', 'zed', '/workspace/c',
             1000, 1300, 5, 1, 1, 2, 1, 0, 0.5, 300)`,
        )
        .run();
      database
        .prepare(
          `INSERT INTO spans (id, session_id, type, name, start_time, is_error, is_sidechain)
           VALUES
             ('cost-tool', 'cost-top', 'tool_call', 'Read', 3001, 0, 0),
             ('token-tool', 'token-top', 'tool_call', 'Read', 2001, 1, 0),
             ('normal-tool', 'normal', 'tool_call', 'Edit', 1001, 0, 0)`,
        )
        .run();

      const report = buildHomeStatistics(database);

      expect(report).toMatchObject({
        schemaVersion: 'home-statistics/v1',
        overview: {
          totalSessions: 3,
          totalTokens: 218,
          totalCost: 12,
          sessionsWithCostUnknown: 1,
        },
        recentTools: [
          { name: 'Read', count: 2, errors: 1 },
          { name: 'Edit', count: 1, errors: 0 },
        ],
      });
      expect(report.topByCost[0]).toMatchObject({ id: 'cost-top' });
      expect(report.topByTokens[0]).toMatchObject({ id: 'token-top' });
      expect(JSON.stringify(report)).not.toContain('stored content');
      expect(JSON.stringify(report)).not.toContain('fixture://');
    } finally {
      database.close();
    }
  });

  it('counts missing Home average metrics as zero', () => {
    const database = createDatabase(':memory:');
    try {
      database
        .prepare(
          `INSERT INTO sessions (
            id, file_path, agent, start_time, cache_hit_rate, peak_context_tokens
          ) VALUES
            ('observed', 'fixture://observed', 'claude-code', 2000, 1, 100),
            ('missing', 'fixture://missing', 'claude-code', 1000, NULL, NULL)`,
        )
        .run();

      const report = buildHomeStatistics(database);

      expect(report.overview.avgCacheHitRate).toBe(0.5);
      expect(report.overview.avgPeakContext).toBe(50);
    } finally {
      database.close();
    }
  });

  it('preserves full statistics semantics through set-based Session aggregation', () => {
    const database = createDatabase(':memory:');
    try {
      const insert = database.prepare(
        `INSERT INTO sessions (
          id, file_path, agent, project_key, start_time, end_time,
          input_tokens, cache_creation_tokens, cache_read_tokens, output_tokens,
          total_cost, cost_unknown_count, cache_hit_rate, peak_context_tokens
        ) VALUES (?, ?, 'claude-code', '/workspace/a', ?, ?, ?, 0, 0, 0, ?, ?, ?, ?)`,
      );
      insert.run(
        'low',
        'fixture://low',
        Date.UTC(2026, 6, 1),
        Date.UTC(2026, 6, 1) + 10,
        500,
        1,
        0,
        0.1,
        100,
      );
      insert.run(
        'mid',
        'fixture://mid',
        Date.UTC(2026, 6, 1),
        Date.UTC(2026, 6, 1) + 20,
        5_000,
        2,
        1,
        0.2,
        200,
      );
      insert.run(
        'high',
        'fixture://high',
        Date.UTC(2026, 6, 2),
        Date.UTC(2026, 6, 2) + 30,
        50_000,
        10,
        0,
        0.3,
        300,
      );
      for (const id of ['low', 'mid', 'high']) {
        database
          .prepare(
            `INSERT INTO spans (id, session_id, type, name, start_time, model, is_sidechain)
             VALUES (?, ?, 'llm_turn', 'fixture', 1, 'fixture-model', 0)`,
          )
          .run(`${id}-span`, id);
      }

      const report = buildStatsReport(database);

      expect(report.overview).toMatchObject({
        totalSessions: 3,
        totalTokens: 55_500,
        totalCost: 13,
        sessionsWithCostUnknown: 1,
      });
      expect(report.byAgent).toEqual([
        expect.objectContaining({ agent: 'claude-code', sessions: 3, totalTokens: 55_500 }),
      ]);
      expect(report.byProject).toEqual([
        { cwd: '/workspace/a', sessions: 3, totalTokens: 55_500, totalCost: 13 },
      ]);
      expect(report.baseline?.projects['/workspace/a']).toMatchObject({
        sessions: 3,
        medCost: 2,
        p95Cost: 10,
      });
      expect(report.baseline?.anomalySessions).toEqual(['high']);
      expect(report.distribution.tokenBins.map((bin) => bin.count)).toEqual([1, 1, 1, 0, 0, 0]);
      expect(report.trends).toEqual([
        expect.objectContaining({ day: '2026-07-01', sessions: 2, tokens: 5_500 }),
        expect.objectContaining({ day: '2026-07-02', sessions: 1, tokens: 50_000 }),
      ]);
    } finally {
      database.close();
    }
  });

  it('keeps anomaly Sessions in reverse chronological order', () => {
    const database = createDatabase(':memory:');
    try {
      const insert = database.prepare(
        `INSERT INTO sessions (
          id, file_path, agent, project_key, start_time, total_cost
        ) VALUES (?, ?, 'claude-code', '/workspace/a', ?, ?)`,
      );
      for (const [id, startTime, totalCost] of [
        ['baseline-a', 1_000, 1],
        ['baseline-b', 2_000, 1],
        ['baseline-c', 3_000, 1],
        ['baseline-d', 4_000, 1],
        ['a-older-anomaly', 5_000, 10],
        ['z-newer-anomaly', 6_000, 11],
      ] as const) {
        insert.run(id, `fixture://${id}`, startTime, totalCost);
      }

      const report = buildStatsReport(database);

      expect(report.baseline?.anomalySessions).toEqual(['z-newer-anomaly', 'a-older-anomaly']);
    } finally {
      database.close();
    }
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
