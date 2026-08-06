import type { ExperimentDecision, ExperimentEvidenceStatus } from '@agent-profile/contracts';

export type { ExperimentDecision, ExperimentEvidenceStatus };

export function allowedExperimentDecisions(
  evidenceStatus: ExperimentEvidenceStatus,
): ExperimentDecision[] {
  if (evidenceStatus === 'ready') {
    return ['insufficient_evidence', 'keep', 'rollback'];
  }
  return ['insufficient_evidence'];
}
