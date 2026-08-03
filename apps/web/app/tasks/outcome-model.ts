import type {
  TaskEvidenceProvenance,
  TaskOutcomeEvidence,
  TaskProfileOutcome,
  VerificationStatus,
} from '@agent-profile/core';

export const MAX_OUTCOME_EVIDENCE = 50;

type DraftStatus = VerificationStatus | '';

export interface OutcomeEvidenceDraft {
  id: string;
  kind: string;
  status: DraftStatus;
  reference: string;
  provenance?: TaskEvidenceProvenance;
}

export interface OutcomeDraft {
  buildStatus: DraftStatus;
  testStatus: DraftStatus;
  lintStatus: DraftStatus;
  gitCommit: string;
  humanRating: '' | '1' | '2' | '3' | '4' | '5';
  reworkReason: string;
  completedAt: string;
  evidence: OutcomeEvidenceDraft[];
}

interface EvidenceErrors {
  kind?: string;
  reference?: string;
}

export interface OutcomeDraftErrors {
  gitCommit?: string;
  reworkReason?: string;
  completedAt?: string;
  evidenceLimit?: string;
  evidence: Record<number, EvidenceErrors>;
}

export type OutcomePayloadResult =
  | { ok: true; value: TaskProfileOutcome }
  | { ok: false; errors: OutcomeDraftErrors };

export function outcomeToDraft(outcome: TaskProfileOutcome | null): OutcomeDraft {
  return {
    buildStatus: outcome?.buildStatus ?? '',
    testStatus: outcome?.testStatus ?? '',
    lintStatus: outcome?.lintStatus ?? '',
    gitCommit: outcome?.gitCommit ?? '',
    humanRating: outcome?.humanRating
      ? (String(outcome.humanRating) as OutcomeDraft['humanRating'])
      : '',
    reworkReason: outcome?.reworkReason ?? '',
    completedAt: outcome?.completedAt == null ? '' : formatLocalDateTime(outcome.completedAt),
    evidence: (outcome?.evidence ?? []).map((item, index) => ({
      id: `stored-${index}`,
      kind: item.kind,
      status: item.status ?? '',
      reference: item.reference ?? '',
      ...(item.provenance ? { provenance: item.provenance } : {}),
    })),
  };
}

export function buildOutcomePayload(draft: OutcomeDraft): OutcomePayloadResult {
  const errors: OutcomeDraftErrors = { evidence: {} };
  const gitCommit = draft.gitCommit.trim();
  const reworkReason = draft.reworkReason.trim();
  let completedAt: number | null = null;

  if (gitCommit.length > 200) errors.gitCommit = 'Git commit 不能超过 200 个字符。';
  if (reworkReason.length > 2_000) errors.reworkReason = '返工原因不能超过 2000 个字符。';
  if (draft.completedAt) {
    completedAt = new Date(draft.completedAt).getTime();
    if (!Number.isSafeInteger(completedAt) || completedAt < 0) {
      errors.completedAt = '请输入有效的完成时间。';
    }
  }
  if (draft.evidence.length > MAX_OUTCOME_EVIDENCE) {
    errors.evidenceLimit = `结构化证据最多 ${MAX_OUTCOME_EVIDENCE} 条。`;
  }

  const evidence: TaskOutcomeEvidence[] = draft.evidence.map((item, index) => {
    const kind = item.kind.trim();
    const reference = item.reference.trim();
    const itemErrors: EvidenceErrors = {};
    if (!kind || kind.length > 80) itemErrors.kind = '证据类型必填，且不能超过 80 个字符。';
    if (reference.length > 500) itemErrors.reference = '证据引用不能超过 500 个字符。';
    if (Object.keys(itemErrors).length > 0) errors.evidence[index] = itemErrors;
    return {
      kind,
      status: item.status || undefined,
      reference: reference || undefined,
      ...(item.provenance ? { provenance: item.provenance } : {}),
    };
  });

  if (
    errors.gitCommit ||
    errors.reworkReason ||
    errors.completedAt ||
    errors.evidenceLimit ||
    Object.keys(errors.evidence).length > 0
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      buildStatus: draft.buildStatus || null,
      testStatus: draft.testStatus || null,
      lintStatus: draft.lintStatus || null,
      gitCommit: gitCommit || null,
      humanRating: draft.humanRating ? Number(draft.humanRating) : null,
      reworkReason: reworkReason || null,
      completedAt,
      evidence,
    },
  };
}

function formatLocalDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  const parts = [
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
  ].map((value) => String(value).padStart(2, '0'));
  const milliseconds = String(date.getMilliseconds()).padStart(3, '0');
  return `${parts[0]}-${parts[1]}-${parts[2]}T${parts[3]}:${parts[4]}:${parts[5]}.${milliseconds}`;
}
