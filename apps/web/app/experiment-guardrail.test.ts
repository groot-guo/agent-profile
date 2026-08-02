import { describe, expect, it } from 'vitest';
import { allowedExperimentDecisions } from './experiment-guardrail';

describe('Experiment decision guardrail', () => {
  it('only permits delivery decisions after evidence is ready', () => {
    expect(allowedExperimentDecisions('not_collected')).toEqual(['insufficient_evidence']);
    expect(allowedExperimentDecisions('insufficient_evidence')).toEqual(['insufficient_evidence']);
    expect(allowedExperimentDecisions('ready')).toEqual([
      'insufficient_evidence',
      'keep',
      'rollback',
    ]);
  });
});
