import { describe, expect, it } from 'vitest';
import { outcomePayload } from './task-outcome';

describe('Outcome form payload', () => {
  it('preserves null fields and converts supported structured evidence', () => {
    expect(
      outcomePayload({
        buildStatus: 'passed',
        testStatus: '',
        lintStatus: 'failed',
        gitCommit: '',
        humanRating: '5',
        reworkReason: 'addressed flaky test',
        completedAt: '2026-08-02T11:00',
        evidence: [{ id: 'evidence-1', kind: 'test', status: 'failed', reference: 'pnpm test' }],
      }),
    ).toEqual({
      buildStatus: 'passed',
      testStatus: null,
      lintStatus: 'failed',
      gitCommit: null,
      humanRating: 5,
      reworkReason: 'addressed flaky test',
      completedAt: new Date('2026-08-02T11:00').getTime(),
      evidence: [{ kind: 'test', status: 'failed', reference: 'pnpm test' }],
    });
  });

  it('rejects incomplete structured evidence instead of dropping it', () => {
    expect(() =>
      outcomePayload({
        buildStatus: '',
        testStatus: '',
        lintStatus: '',
        gitCommit: '',
        humanRating: '',
        reworkReason: '',
        completedAt: '',
        evidence: [{ id: 'evidence-1', kind: '', status: 'passed', reference: '' }],
      }),
    ).toThrowError('invalid_outcome_evidence');
  });
});
