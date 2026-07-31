import { describe, expect, it } from 'vitest';
import { buildOutcomePayload, outcomeToDraft } from './outcome-model';

describe('Task Outcome editor model', () => {
  it('round-trips every supported Outcome field without changing missing semantics', () => {
    const completedAt = new Date('2026-07-31T12:30:45.123').getTime();
    const draft = outcomeToDraft({
      buildStatus: 'passed',
      testStatus: 'failed',
      lintStatus: 'skipped',
      gitCommit: ' abc123 ',
      humanRating: 4,
      reworkReason: ' Follow-up required ',
      completedAt,
      evidence: [{ kind: 'ci', status: 'failed', reference: ' local://run/1 ' }],
    });

    expect(buildOutcomePayload(draft)).toEqual({
      ok: true,
      value: {
        buildStatus: 'passed',
        testStatus: 'failed',
        lintStatus: 'skipped',
        gitCommit: 'abc123',
        humanRating: 4,
        reworkReason: 'Follow-up required',
        completedAt,
        evidence: [{ kind: 'ci', status: 'failed', reference: 'local://run/1' }],
      },
    });

    expect(buildOutcomePayload(outcomeToDraft(null))).toEqual({
      ok: true,
      value: {
        buildStatus: null,
        testStatus: null,
        lintStatus: null,
        gitCommit: null,
        humanRating: null,
        reworkReason: null,
        completedAt: null,
        evidence: [],
      },
    });
  });

  it('rejects malformed or unbounded structured evidence before saving', () => {
    const missingKind = outcomeToDraft(null);
    missingKind.evidence = [{ id: 'missing-kind', kind: '', status: 'passed', reference: '' }];
    const missingKindResult = buildOutcomePayload(missingKind);
    expect(missingKindResult.ok).toBe(false);
    if (!missingKindResult.ok) {
      expect(missingKindResult.errors.evidence[0]?.kind).toContain('证据类型');
    }

    const tooMany = outcomeToDraft(null);
    tooMany.evidence = Array.from({ length: 51 }, (_, index) => ({
      id: `check-${index}`,
      kind: `check-${index}`,
      status: '',
      reference: '',
    }));
    const tooManyResult = buildOutcomePayload(tooMany);
    expect(tooManyResult.ok).toBe(false);
    if (!tooManyResult.ok) {
      expect(tooManyResult.errors.evidenceLimit).toContain('50');
    }
  });
});
