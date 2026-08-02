import { describe, expect, it } from 'vitest';
import { projectProfileUpdateState, projectProfileUrl } from './project-profile-data';

describe('project profile data', () => {
  it('builds an encoded, range-scoped Project Profile URL', () => {
    expect(projectProfileUrl('http://localhost:3000/api', '/workspace/agent profile', '30d')).toBe(
      'http://localhost:3000/api/projects/%2Fworkspace%2Fagent%20profile/profile?range=30d',
    );
  });

  it('refreshes only when the update cursor advances', () => {
    expect(projectProfileUpdateState(4, 4)).toEqual({ version: 4, shouldRefresh: false });
    expect(projectProfileUpdateState(4, 3)).toEqual({ version: 4, shouldRefresh: false });
    expect(projectProfileUpdateState(4, 5)).toEqual({ version: 5, shouldRefresh: true });
  });
});
