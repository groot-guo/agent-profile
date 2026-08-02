export type ExperimentEvidenceStatus = 'not_collected' | 'insufficient_evidence' | 'ready';

export type ExperimentDecision = 'keep' | 'rollback' | 'insufficient_evidence';

export function allowedExperimentDecisions(
  evidenceStatus: ExperimentEvidenceStatus,
): ExperimentDecision[] {
  if (evidenceStatus === 'ready') {
    return ['insufficient_evidence', 'keep', 'rollback'];
  }
  return ['insufficient_evidence'];
}
