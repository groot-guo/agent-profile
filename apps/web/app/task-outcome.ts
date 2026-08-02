import type { TaskOutcomeEvidence, VerificationStatus } from '@agent-profile/core';

export const OUTCOME_VERIFICATION_STATUSES = ['passed', 'failed', 'skipped', 'not_run'] as const;

export interface OutcomeDraft {
  buildStatus: string;
  testStatus: string;
  lintStatus: string;
  gitCommit: string;
  humanRating: string;
  reworkReason: string;
  completedAt: string;
  evidence: Array<{ id: string; kind: string; status: string; reference: string }>;
}

export function emptyOutcomeDraft(): OutcomeDraft {
  return {
    buildStatus: '',
    testStatus: '',
    lintStatus: '',
    gitCommit: '',
    humanRating: '',
    reworkReason: '',
    completedAt: '',
    evidence: [],
  };
}

export function outcomeDraftFromRecord(
  outcome: {
    buildStatus: VerificationStatus | null;
    testStatus: VerificationStatus | null;
    lintStatus: VerificationStatus | null;
    gitCommit: string | null;
    humanRating: number | null;
    reworkReason: string | null;
    completedAt: number | null;
    evidence: TaskOutcomeEvidence[];
  } | null,
): OutcomeDraft {
  if (!outcome) return emptyOutcomeDraft();
  return {
    buildStatus: outcome.buildStatus ?? '',
    testStatus: outcome.testStatus ?? '',
    lintStatus: outcome.lintStatus ?? '',
    gitCommit: outcome.gitCommit ?? '',
    humanRating: outcome.humanRating?.toString() ?? '',
    reworkReason: outcome.reworkReason ?? '',
    completedAt: outcome.completedAt == null ? '' : localDateTime(outcome.completedAt),
    evidence: outcome.evidence.map((item, index) => ({
      id: `stored-${index}-${item.kind}-${item.reference ?? ''}`,
      kind: item.kind,
      status: item.status ?? '',
      reference: item.reference ?? '',
    })),
  };
}

export function outcomePayload(draft: OutcomeDraft): {
  buildStatus: VerificationStatus | null;
  testStatus: VerificationStatus | null;
  lintStatus: VerificationStatus | null;
  gitCommit: string | null;
  humanRating: number | null;
  reworkReason: string | null;
  completedAt: number | null;
  evidence: TaskOutcomeEvidence[];
} {
  return {
    buildStatus: verificationStatus(draft.buildStatus),
    testStatus: verificationStatus(draft.testStatus),
    lintStatus: verificationStatus(draft.lintStatus),
    gitCommit: optionalText(draft.gitCommit),
    humanRating: optionalRating(draft.humanRating),
    reworkReason: optionalText(draft.reworkReason),
    completedAt: optionalDate(draft.completedAt),
    evidence: draft.evidence.map(evidenceItem),
  };
}

function verificationStatus(value: string): VerificationStatus | null {
  if (!value) return null;
  if (OUTCOME_VERIFICATION_STATUSES.includes(value as VerificationStatus)) {
    return value as VerificationStatus;
  }
  throw new Error('invalid_verification_status');
}

function optionalText(value: string): string | null {
  const text = value.trim();
  return text || null;
}

function optionalRating(value: string): number | null {
  if (!value) return null;
  const rating = Number(value);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error('invalid_human_rating');
  }
  return rating;
}

function optionalDate(value: string): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) throw new Error('invalid_completed_at');
  return time;
}

function evidenceItem({
  id: _id,
  ...value
}: OutcomeDraft['evidence'][number]): TaskOutcomeEvidence {
  const kind = value.kind.trim();
  if (!kind || kind.length > 80) throw new Error('invalid_outcome_evidence');
  const reference = optionalText(value.reference);
  if (reference && reference.length > 500) throw new Error('text_too_long');
  return {
    kind,
    status: verificationStatus(value.status) ?? undefined,
    reference: reference ?? undefined,
  };
}

function localDateTime(time: number): string {
  const date = new Date(time - new Date(time).getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}
