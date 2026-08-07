import { describe, expect, it } from 'vitest';
import { searchTaskSessions, TASK_SESSION_SEARCH_LIMIT } from './task-session-search';

describe('Task Session search', () => {
  it('queries one bounded discovery window instead of the full Session array', async () => {
    const urls: string[] = [];
    const request = async (url: string) => {
      urls.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          counts: { matched: 3, total: 500 },
          page: { limit: TASK_SESSION_SEARCH_LIMIT, hasMore: false, nextCursor: null },
          sessions: [{ id: 'one' }, { id: 'two' }, { id: 'three' }],
        }),
      };
    };

    const result = await searchTaskSessions(
      'http://local/api',
      'agent-profile',
      undefined,
      request,
    );

    expect(urls).toEqual([
      `http://local/api/session-discovery?limit=${TASK_SESSION_SEARCH_LIMIT}&q=agent-profile`,
    ]);
    expect(urls[0]).not.toContain('/sessions?');
    expect(result.sessions.map((session) => session.id)).toEqual(['one', 'two', 'three']);
    expect(result.matched).toBe(3);
    expect(result.hasMore).toBe(false);
  });

  it('appends the bounded cursor for the next window and drops empty queries', async () => {
    const urls: string[] = [];
    const request = async (url: string) => {
      urls.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          counts: { matched: 500, total: 500 },
          page: { limit: TASK_SESSION_SEARCH_LIMIT, hasMore: true, nextCursor: 'cursor-2' },
          sessions: [],
        }),
      };
    };

    const result = await searchTaskSessions('http://local/api', '   ', 'cursor-1', request);

    expect(urls).toEqual([
      `http://local/api/session-discovery?limit=${TASK_SESSION_SEARCH_LIMIT}&cursor=cursor-1`,
    ]);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe('cursor-2');
  });

  it('surfaces non-OK responses as errors', async () => {
    const request = async () => ({ ok: false, status: 500, json: async () => ({}) });
    await expect(searchTaskSessions('http://local/api', '', undefined, request)).rejects.toThrow(
      'Task session discovery HTTP 500',
    );
  });
});
