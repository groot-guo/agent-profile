import type { TaskOutcomeEvidence } from './task-profile';

export const OUTCOME_EVIDENCE_SCHEMA_VERSION = 'outcome-evidence/v1' as const;

export interface OutcomeEvidenceCaptureLimits {
  maxRecords: number;
  maxReferenceCharacters: number;
  content: 'metadata_only';
}

export interface OutcomeEvidenceAdapterReport {
  schemaVersion: typeof OUTCOME_EVIDENCE_SCHEMA_VERSION;
  taskId: string;
  producer: string;
  capturedAt: number;
  source: 'local_git';
  records: TaskOutcomeEvidence[];
  captureLimits: OutcomeEvidenceCaptureLimits;
  limitations: string[];
}
