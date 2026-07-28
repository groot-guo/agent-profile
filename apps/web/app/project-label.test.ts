import { CODEX_SESSION_RECORDS_PROJECT } from '@agent-profile/core/project';
import { describe, expect, it } from 'vitest';
import { projectLabel } from './project-label';

describe('projectLabel', () => {
  it('gives the filesystem root a visible non-project label', () => {
    expect(projectLabel('/')).toBe('系统根目录');
  });

  it('uses the last segment for normal project paths', () => {
    expect(projectLabel('/Users/example/workspace')).toBe('workspace');
    expect(projectLabel('/Users/example/workspace/')).toBe('workspace');
  });

  it('gives source Session-record categories a direct label', () => {
    expect(projectLabel(CODEX_SESSION_RECORDS_PROJECT)).toBe('Codex 会话记录');
  });
});
