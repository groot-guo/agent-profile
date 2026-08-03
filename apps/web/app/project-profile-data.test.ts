import { describe, expect, it } from 'vitest';
import { projectProfileUpdateState, projectProfileUrl } from './project-profile-data';

describe('project profile data', () => {
  it('builds an encoded, range-scoped Project Profile URL', () => {
    expect(
      projectProfileUrl(
        'http://localhost:3000/api',
        '/workspace/agent profile',
        '30d',
        Date.UTC(2026, 7, 30),
      ),
    ).toBe(
      `http://localhost:3000/api/projects/profile?project=%2Fworkspace%2Fagent%20profile&from=${Date.UTC(2026, 6, 31)}&to=${Date.UTC(2026, 7, 30)}`,
    );
  });

  it('refreshes only when the update cursor advances', () => {
    expect(projectProfileUpdateState(4, 4)).toEqual({ version: 4, shouldRefresh: false });
    expect(projectProfileUpdateState(4, 3)).toEqual({ version: 4, shouldRefresh: false });
    expect(projectProfileUpdateState(4, 5)).toEqual({ version: 5, shouldRefresh: true });
  });
});
