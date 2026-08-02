import { describe, expect, it } from 'vitest';
import { relationshipStatusLabel, shortSessionId } from './source-relationship';

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
});
