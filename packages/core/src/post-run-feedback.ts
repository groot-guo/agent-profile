import type {
  CohortRuntimeProfileReport,
  RuntimeProfileComparison,
  RuntimeProfileGuardrail,
} from './cohort-runtime-profile';

export const POST_RUN_FEEDBACK_SCHEMA_VERSION = 'post-run-feedback/v1' as const;

export type PostRunFeedbackSuppression =
  | 'task_not_completed'
  | 'outcome_not_verified'
  | 'task_not_in_comparable_sample'
  | 'insufficient_evidence'
  | 'stale_evidence'
  | 'experiment_not_completed'
  | 'no_persisted_decision'
  | 'control_baseline';

export interface PostRunFeedbackInput {
  task: {
    id: string;
    status: string;
    outcomeVerified: boolean;
    completedAt: number | null;
  };
  experiment: {
    id: string;
    cohortId: string;
    status: string;
    profile: CohortRuntimeProfileReport;
    taskRole: 'control' | 'candidate';
  };
  generatedAt?: number;
}

export interface PostRunFeedbackEvidence {
  experimentId: string;
  cohortId: string;
  profileSchemaVersion: CohortRuntimeProfileReport['schemaVersion'];
  profileGeneratedAt: number;
  evaluationStatus: CohortRuntimeProfileReport['evaluationStatus'];
  primaryMetric: string;
  primaryComparison: Pick<
    RuntimeProfileComparison,
    'metric' | 'status' | 'controlObserved' | 'candidateObserved' | 'relativeDelta' | 'direction'
  > | null;
  guardrails: Array<
    Pick<RuntimeProfileGuardrail, 'metric' | 'maxRelativeRegression' | 'status' | 'relativeDelta'>
  >;
  limitations: string[];
}

export interface PostRunFeedbackFinding {
  id: 'consider_candidate' | 'avoid_candidate';
  action: 'consider_candidate' | 'avoid_candidate';
  title: string;
  summary: string;
  evidence: PostRunFeedbackEvidence;
  limitations: string[];
}

export interface PostRunFeedbackReport {
  schemaVersion: typeof POST_RUN_FEEDBACK_SCHEMA_VERSION;
  generatedAt: number;
  task: {
    id: string;
    outcomeVerified: boolean;
    configurationRole: 'control' | 'candidate';
  };
  status: 'available' | 'suppressed';
  findings: PostRunFeedbackFinding[];
  suppression: { reason: PostRunFeedbackSuppression; detail: string } | null;
  limitations: string[];
}

export function buildPostRunFeedback(input: PostRunFeedbackInput): PostRunFeedbackReport {
  const { task, experiment } = input;
  const profile = experiment.profile;
  const generatedAt = input.generatedAt ?? Date.now();
  const base = {
    schemaVersion: POST_RUN_FEEDBACK_SCHEMA_VERSION,
    generatedAt,
    task: {
      id: task.id,
      outcomeVerified: task.outcomeVerified,
      configurationRole: experiment.taskRole,
    },
  } as const;

  const suppression = suppressionFor(input);
  if (suppression) {
    return {
      ...base,
      status: 'suppressed',
      findings: [],
      suppression,
      limitations: [
        'Post-run feedback is read-only and remains suppressed until its evidence and Task boundaries are current.',
        ...profile.limitations,
      ],
    };
  }

  const evidence = buildEvidence(experiment.id, experiment.cohortId, profile);
  const keep = profile.experiment.persistedDecision === 'keep';
  const finding: PostRunFeedbackFinding = keep
    ? {
        id: 'consider_candidate',
        action: 'consider_candidate',
        title: 'Consider the candidate configuration for similar Tasks',
        summary:
          'The persisted Experiment decision is keep and this completed Task used the candidate configuration; treat this as bounded observed evidence, not a causal guarantee.',
        evidence,
        limitations: profile.limitations,
      }
    : {
        id: 'avoid_candidate',
        action: 'avoid_candidate',
        title: 'Avoid reusing the candidate configuration without review',
        summary:
          'The persisted Experiment decision is rollback and this completed Task used the candidate configuration; inspect the linked guardrails before reuse.',
        evidence,
        limitations: profile.limitations,
      };
  return {
    ...base,
    status: 'available',
    findings: [finding],
    suppression: null,
    limitations: [
      'This finding is a bounded post-run observation linked to one Experiment; it is not a universal quality or causal claim.',
      ...profile.limitations,
    ],
  };
}

function suppressionFor(
  input: PostRunFeedbackInput,
): { reason: PostRunFeedbackSuppression; detail: string } | null {
  const { task, experiment } = input;
  const profile = experiment.profile;
  if (task.status !== 'completed') {
    return {
      reason: 'task_not_completed',
      detail: 'Feedback is available only after a Task is completed.',
    };
  }
  if (!task.outcomeVerified) {
    return {
      reason: 'outcome_not_verified',
      detail: 'All tracked Outcome fields must be present before a finding is emitted.',
    };
  }
  const inControl = profile.groups.control.taskIds.includes(task.id);
  const inCandidate = profile.groups.candidate.taskIds.includes(task.id);
  if (!inControl && !inCandidate) {
    return {
      reason: 'task_not_in_comparable_sample',
      detail: 'The Task is not part of the current comparable control/candidate sample.',
    };
  }
  if (experiment.status !== 'completed') {
    return {
      reason: 'experiment_not_completed',
      detail: 'The Experiment must be completed before post-run feedback is emitted.',
    };
  }
  if (profile.evaluationStatus !== 'ready') {
    return {
      reason: profile.experiment.persistedDecision ? 'stale_evidence' : 'insufficient_evidence',
      detail: profile.experiment.persistedDecision
        ? 'The persisted decision is stale because the current Profile no longer meets its evidence thresholds.'
        : 'The current Profile does not meet its minimum sample and coverage thresholds.',
    };
  }
  if (
    profile.experiment.persistedDecision !== 'keep' &&
    profile.experiment.persistedDecision !== 'rollback'
  ) {
    return {
      reason: 'no_persisted_decision',
      detail: 'Only an explicit keep or rollback decision can produce a post-run finding.',
    };
  }
  if (inControl || experiment.taskRole === 'control') {
    return {
      reason: 'control_baseline',
      detail:
        'Control Tasks provide the comparison baseline and do not receive candidate guidance.',
    };
  }
  return null;
}

function buildEvidence(
  experimentId: string,
  cohortId: string,
  profile: CohortRuntimeProfileReport,
): PostRunFeedbackEvidence {
  const primaryComparison = profile.comparisons.find(
    (comparison) => comparison.metric === profile.experiment.primaryMetric,
  );
  return {
    experimentId,
    cohortId,
    profileSchemaVersion: profile.schemaVersion,
    profileGeneratedAt: profile.generatedAt,
    evaluationStatus: profile.evaluationStatus,
    primaryMetric: profile.experiment.primaryMetric,
    primaryComparison: primaryComparison
      ? {
          metric: primaryComparison.metric,
          status: primaryComparison.status,
          controlObserved: primaryComparison.controlObserved,
          candidateObserved: primaryComparison.candidateObserved,
          relativeDelta: primaryComparison.relativeDelta,
          direction: primaryComparison.direction,
        }
      : null,
    guardrails: profile.guardrails.map((guardrail) => ({
      metric: guardrail.metric,
      maxRelativeRegression: guardrail.maxRelativeRegression,
      status: guardrail.status,
      relativeDelta: guardrail.relativeDelta,
    })),
    limitations: profile.limitations,
  };
}
