import type { SessionSummary } from '@agent-profile/core';
import { CODEX_SESSION_RECORDS_PROJECT } from '@agent-profile/core/project';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SESSION_NAVIGATION,
  filterProjectPickerOptions,
  filterSessions,
  groupSessionsByTime,
  groupSessionsForDisplay,
  parseSessionNavigation,
  projectOptions,
  projectPickerOptions,
  projectPickerOptionsFromFacets,
  serializeSessionNavigation,
  sessionDisplayTitle,
  sessionProject,
  visibleSessionSlice,
  writeSessionSelectionHistory,
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
      project: '/repo/alpha',
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
      '?q=cache&project=%2Frepo%2Falpha&agent=codex&range=7d&sort=tokens&view=unpriced&session=a',
    );
    expect(serializeSessionNavigation(state)).toBe(
      'q=cache&project=%2Frepo%2Falpha&agent=codex&range=7d&sort=tokens&view=unpriced&session=a',
    );
    expect(parseSessionNavigation('?sort=invalid&view=invalid&range=invalid')).toMatchObject({
      sort: 'time',
      quickView: 'all',
      timeRange: 'all',
    });
  });

  it('pushes the first Session detail and replaces later Session selections', () => {
    const pushState = vi.fn();
    const replaceState = vi.fn();

    writeSessionSelectionHistory(
      { state: null, pushState, replaceState },
      '/?project=alpha&session=a',
    );
    writeSessionSelectionHistory(
      { state: { agentProfileSession: true }, pushState, replaceState },
      '/?project=alpha&session=b',
    );

    expect(pushState).toHaveBeenCalledOnce();
    expect(pushState).toHaveBeenCalledWith(
      { agentProfileSession: true },
      '',
      '/?project=alpha&session=a',
    );
    expect(replaceState).toHaveBeenCalledOnce();
    expect(replaceState).toHaveBeenCalledWith(
      { agentProfileSession: true },
      '',
      '/?project=alpha&session=b',
    );
  });

  it('uses exact project and rolling recent-range filters', () => {
    const now = new Date('2026-07-27T12:00:00+08:00').getTime();
    const sessions = [
      session('recent-alpha', '/repo/alpha', 'codex', now - 2 * 86_400_000, 0),
      session('old-alpha', '/repo/alpha', 'codex', now - 8 * 86_400_000, 0),
      session('recent-alpha-tools', '/repo/alpha-tools', 'codex', now - 86_400_000, 0),
    ];
    const result = filterSessions(
      sessions,
      new Set(),
      {
        ...DEFAULT_SESSION_NAVIGATION,
        project: '/repo/alpha',
        timeRange: '7d',
      },
      now,
    );
    expect(result.map((item) => item.id)).toEqual(['recent-alpha']);
  });

  it('prefers source titles and gives untitled Sessions a metadata-only display title', () => {
    const titled = session('named', '/repo/alpha', 'codex', 100, 0);
    expect(sessionDisplayTitle(titled)).toBe('session named');

    const untitled = { ...session('opaque-session-id', '/repo/alpha', 'codex', 100, 0), name: '' };
    const title = sessionDisplayTitle(untitled);
    expect(title).toContain('Codex · alpha ·');
    expect(title).not.toContain('opaque-session-id');
  });

  it('classifies Codex managed dated workspaces as one searchable Session-record category', () => {
    const first = session(
      'dated-a',
      '/Users/example/Documents/Codex/2026-07-27/chat-a',
      'codex',
      100,
      0,
    );
    first.filePath =
      '/Users/example/.codex/sessions/2026/07/27/rollout-2026-07-27T10-00-00-a.jsonl';
    const second = session(
      'dated-b',
      '/Users/example/Documents/Codex/2026-07-28/chat-b',
      'codex',
      200,
      0,
    );
    second.filePath =
      '/Users/example/.codex/sessions/2026/07/28/rollout-2026-07-28T10-00-00-b.jsonl';

    expect(sessionProject(first)).toBe(CODEX_SESSION_RECORDS_PROJECT);
    expect(sessionProject(second)).toBe(CODEX_SESSION_RECORDS_PROJECT);
    expect(projectOptions([first, second])).toEqual([
      { project: CODEX_SESSION_RECORDS_PROJECT, count: 2 },
    ]);

    const untitled = { ...first, name: '' };
    expect(sessionDisplayTitle(untitled)).toContain('Codex 会话记录 ·');
    expect(sessionDisplayTitle(untitled)).not.toContain('Codex · Codex');
    expect(
      filterSessions([first, second], new Set(), {
        ...DEFAULT_SESSION_NAVIGATION,
        query: 'Codex 会话记录',
      }).map((item) => item.id),
    ).toEqual(['dated-b', 'dated-a']);
  });

  it('retains the explicit Claude projects-path fallback without using arbitrary parents', () => {
    const claude = session('claude', undefined, 'claude-code', 100, 0);
    claude.filePath = '/Users/example/.claude/projects/-Users-example-repo/session.jsonl';
    expect(sessionProject(claude)).toBe('/Users/example/repo');
  });

  it('builds non-duplicated project-picker groups with short names, parent paths, and recency', () => {
    const records = session(
      'records',
      '/Users/example/Documents/Codex/2026-07-28/chat-a',
      'codex',
      500,
      0,
    );
    records.filePath = '/Users/example/.codex/sessions/2026/07/28/rollout-a.jsonl';
    const options = projectPickerOptions(
      [
        session('older-alpha', '/Users/example/GitHub/alpha', 'codex', 100, 0),
        session('newer-alpha', '/Users/example/GitHub/alpha', 'claude-code', 400, 0),
        session('beta', '/Users/example/GitLab/beta', 'codex', 300, 0),
        session('gamma', '/Users/example/gamma', 'codex', 200, 0),
        records,
      ],
      2,
    );

    expect(options).toEqual([
      {
        project: CODEX_SESSION_RECORDS_PROJECT,
        name: 'Codex 会话记录',
        parentPath: '',
        count: 1,
        lastUsedAt: 500,
        group: 'records',
      },
      {
        project: '/Users/example/GitHub/alpha',
        name: 'alpha',
        parentPath: '/Users/example/GitHub',
        count: 2,
        lastUsedAt: 400,
        group: 'recent',
      },
      {
        project: '/Users/example/GitLab/beta',
        name: 'beta',
        parentPath: '/Users/example/GitLab',
        count: 1,
        lastUsedAt: 300,
        group: 'recent',
      },
      {
        project: '/Users/example/gamma',
        name: 'gamma',
        parentPath: '/Users/example',
        count: 1,
        lastUsedAt: 200,
        group: 'other',
      },
    ]);
    expect(filterProjectPickerOptions(options, 'GitLab/beta').map((option) => option.name)).toEqual(
      ['beta'],
    );
    expect(filterProjectPickerOptions(options, 'Codex 会话').map((option) => option.name)).toEqual([
      'Codex 会话记录',
    ]);
    expect(filterProjectPickerOptions(options, 'agent-profile')).toEqual([]);

    expect(
      projectPickerOptionsFromFacets(
        options.map((option) => ({
          project: option.project,
          count: option.count,
          lastUsedAt: option.lastUsedAt,
        })),
        2,
      ),
    ).toEqual(options);
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

  it('preserves server order when the active sort is not chronological', () => {
    const sessions = [
      session('today-high', '/repo/alpha', 'codex', 300, 0),
      session('yesterday-mid', '/repo/alpha', 'codex', 100, 0),
      session('today-low', '/repo/alpha', 'codex', 200, 0),
    ];

    const groups = groupSessionsForDisplay(sessions, 'cost');

    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('成本最高');
    expect(groups[0].sessions.map((item) => item.id)).toEqual([
      'today-high',
      'yesterday-mid',
      'today-low',
    ]);
  });
});

function session(
  id: string,
  cwd: string | undefined,
  agent: string,
  startTime: number,
  costUnknownCount: number,
): SessionSummary {
  return {
    id,
    name: `session ${id}`,
    filePath: cwd ? `${cwd}/${id}.jsonl` : `/transcripts/${id}.jsonl`,
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
