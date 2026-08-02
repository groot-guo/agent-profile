import { describe, expect, it } from 'vitest';
import {
  isCurrentSessionDetailStatus,
  parseSessionDetailStatus,
  SESSION_DETAIL_STATUS_TYPE,
} from './session-detail-transition';

describe('Session detail transition protocol', () => {
  it('accepts only a well-formed readiness status for the selected Session', () => {
    const status = parseSessionDetailStatus({
      type: SESSION_DETAIL_STATUS_TYPE,
      id: 'session-a',
      status: 'ready',
    });

    expect(status).toEqual({
      type: SESSION_DETAIL_STATUS_TYPE,
      id: 'session-a',
      status: 'ready',
    });
    expect(isCurrentSessionDetailStatus(status, 'session-a')).toBe(true);
    expect(isCurrentSessionDetailStatus(status, 'session-b')).toBe(false);
  });

  it('rejects malformed or unsupported cross-document messages', () => {
    expect(parseSessionDetailStatus(null)).toBeNull();
    expect(
      parseSessionDetailStatus({ type: SESSION_DETAIL_STATUS_TYPE, id: '', status: 'ready' }),
    ).toBeNull();
    expect(
      parseSessionDetailStatus({
        type: SESSION_DETAIL_STATUS_TYPE,
        id: 'session-a',
        status: 'loading',
      }),
    ).toBeNull();
    expect(
      parseSessionDetailStatus({ type: 'unknown', id: 'session-a', status: 'error' }),
    ).toBeNull();
  });
});
