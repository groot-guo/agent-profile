import type {
  OutcomeEvidenceStatus,
  TaskEvidenceProvenance,
  TaskOutcomeEvidence,
  TaskProfileOutcome,
} from '@agent-profile/core';

export class TaskModelError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode = 400,
  ) {
    super(code);
  }
}

export function requiredText(value: string, code: string, max: number): string {
  const text = value?.trim();
  if (!text || text.length > max) throw new TaskModelError(code);
  return text;
}

export function optionalText(value: string | null | undefined, max: number): string | null {
  if (value == null) return null;
  const text = value.trim();
  if (!text) return null;
  if (text.length > max) throw new TaskModelError('text_too_long');
  return text;
}

export function validateOutcomeEvidenceList(value: unknown): TaskOutcomeEvidence[] {
  if (!Array.isArray(value) || value.length > 50) {
    throw new TaskModelError('invalid_outcome_evidence');
  }
  return value.map(validateOutcomeEvidence);
}

export function validateOutcomeEvidence(value: unknown): TaskOutcomeEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TaskModelError('invalid_outcome_evidence');
  }
  const evidence = value as Record<string, unknown>;
  if (typeof evidence.kind !== 'string') throw new TaskModelError('invalid_outcome_evidence');
  if (
    evidence.status !== undefined &&
    (typeof evidence.status !== 'string' ||
      !['not_captured', 'observed', 'passed', 'failed', 'skipped', 'not_run'].includes(
        evidence.status,
      ))
  ) {
    throw new TaskModelError('invalid_outcome_evidence');
  }
  if (evidence.reference != null && typeof evidence.reference !== 'string') {
    throw new TaskModelError('invalid_outcome_evidence');
  }
  return {
    kind: requiredText(evidence.kind, 'invalid_outcome_evidence', 80),
    status: evidence.status as OutcomeEvidenceStatus | undefined,
    reference: optionalText(evidence.reference as string | null | undefined, 500) ?? undefined,
    ...(evidence.provenance === undefined
      ? {}
      : { provenance: validateEvidenceProvenance(evidence.provenance) }),
  };
}

export function validateEvidenceProvenance(value: unknown): TaskEvidenceProvenance | undefined {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TaskModelError('invalid_task_provenance');
  }
  const provenance = value as Record<string, unknown>;
  if (
    typeof provenance.producer !== 'string' ||
    typeof provenance.capturedAt !== 'number' ||
    !Number.isSafeInteger(provenance.capturedAt) ||
    typeof provenance.source !== 'string' ||
    !['local_session', 'local_git'].includes(provenance.source) ||
    typeof provenance.sourceId !== 'string' ||
    typeof provenance.basis !== 'string'
  ) {
    throw new TaskModelError('invalid_task_provenance');
  }
  return {
    producer: requiredText(provenance.producer, 'invalid_task_provenance', 200),
    capturedAt: provenance.capturedAt,
    source: provenance.source as TaskEvidenceProvenance['source'],
    sourceId: requiredText(provenance.sourceId, 'invalid_task_provenance', 500),
    basis: requiredText(provenance.basis, 'invalid_task_provenance', 200),
  };
}

export function optionalTimestamp(value: number | null): number | null {
  if (value == null) return null;
  if (!Number.isFinite(value)) throw new TaskModelError('invalid_completed_at');
  return value;
}

export function isVerifiedOutcome(outcome: TaskProfileOutcome | null): boolean {
  return Boolean(
    outcome?.buildStatus &&
      outcome.testStatus &&
      outcome.lintStatus &&
      outcome.gitCommit &&
      outcome.humanRating != null,
  );
}
