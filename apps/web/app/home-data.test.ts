import { describe, expect, it } from 'vitest';
import { loadHomeStatistics, loadImportStatus, loadSessionDiscovery } from './home-data';

describe('Home data ownership', () => {
  it('loads one bounded Session window, bounded Home statistics, and import status', async () => {
    const urls: string[] = [];
    const request = async (url: string) => {
      urls.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => {
          if (url.includes('/session-discovery')) {
            return {
              page: { limit: 120 },
              sessions: Array.from({ length: 120 }, (_, id) => ({ id })),
            };
          }
          if (url.endsWith('/home-statistics')) return { overview: {}, recentTools: [] };
          return { jobId: null, active: false, operation: null, sources: [] };
        },
      };
    };

    await Promise.all([
      loadSessionDiscovery(
        'http://local/api',
        {
          agent: 'codex',
          project: '/repo/alpha',
          query: 'cache',
          timeRange: '7d',
          sort: 'tokens',
          quickView: 'unpriced',
          selectedId: 'selected',
        },
        undefined,
        request,
      ),
      loadHomeStatistics('http://local/api', request),
      loadImportStatus('http://local/api', request),
    ]);

    expect(urls).toEqual([
      'http://local/api/session-discovery?limit=120&agent=codex&project=%2Frepo%2Falpha&q=cache&range=7d&sort=tokens&view=unpriced&selected=selected',
      'http://local/api/home-statistics',
      'http://local/api/imports/status',
    ]);
    expect(urls[0]).not.toContain('/sessions?');
    expect(urls.some((url) => url.includes('/tools'))).toBe(false);
  });
});
