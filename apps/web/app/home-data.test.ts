import { describe, expect, it } from 'vitest';
import { loadDashboardData, loadImportStatus } from './home-data';

describe('Home data ownership', () => {
  it('loads Sessions, Stats, and import status once without per-Session tool requests', async () => {
    const urls: string[] = [];
    const request = async (url: string) => {
      urls.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => {
          if (url.endsWith('/sessions')) return Array.from({ length: 400 }, (_, id) => ({ id }));
          if (url.endsWith('/stats')) return { overview: {}, recentTools: [] };
          return { jobId: null, active: false, sources: [] };
        },
      };
    };

    await Promise.all([
      loadDashboardData('http://local/api', request),
      loadImportStatus('http://local/api', request),
    ]);

    expect(urls).toEqual([
      'http://local/api/sessions',
      'http://local/api/stats',
      'http://local/api/imports/status',
    ]);
    expect(urls.some((url) => url.includes('/tools'))).toBe(false);
  });
});
