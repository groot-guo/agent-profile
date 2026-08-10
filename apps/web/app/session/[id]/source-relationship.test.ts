import { describe, expect, it } from 'vitest';
import {
  callbackStatusLabel,
  relationshipDisplayName,
  relationshipStatusLabel,
  shortSessionId,
} from './source-relationship';

describe('source Session relationship UI labels', () => {
  it('keeps unavailable and not-captured source coverage distinct', () => {
    expect(relationshipStatusLabel('linked')).toBe('关系已关联');
    expect(relationshipStatusLabel('parent_unavailable')).toBe('父会话未导入');
    expect(relationshipStatusLabel('not_captured')).toBe('未采集');
  });

  it('bounds displayed source identifiers without changing short IDs', () => {
    expect(shortSessionId('short-id')).toBe('short-id');
    expect(shortSessionId('123456789012345678901')).toBe('12345678901234567890…');
  });

  it('prefers deterministic agent identity fields and falls back to the Session ID', () => {
    expect(
      relationshipDisplayName({
        id: 'child-session',
        agentNickname: 'Audit',
        agentRole: 'review',
        agentPath: '/root/audit',
      }),
    ).toBe('Audit');
    expect(relationshipDisplayName({ id: 'child-session', agentRole: 'review' })).toBe('review');
    expect(relationshipDisplayName({ id: 'child-session', agentPath: '/root/audit' })).toBe(
      '/root/audit',
    );
    expect(relationshipDisplayName({ id: 'child-session' })).toBe('child-session');
  });

  it('labels only captured callback statuses', () => {
    expect(callbackStatusLabel('observed')).toBe('已观察到回调');
    expect(callbackStatusLabel('final_answer')).toBe('已收到最终答复');
  });
});
