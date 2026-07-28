export const TASK_PROFILE_SCHEMA_VERSION = 'task-profile/v1' as const;

export type TaskStatus = 'planned' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
export type VerificationStatus = 'passed' | 'failed' | 'skipped' | 'not_run';

export interface TaskOutcomeEvidence {
  kind: string;
  status?: VerificationStatus;
  reference?: string;
}

export interface TaskProfileTask {
  id: string;
  projectId?: string;
  title: string;
  type: string;
  status: TaskStatus;
  complexity?: 'small' | 'medium' | 'large';
}

export interface TaskProfileConfiguration {
  id: string;
  agent: string;
  model?: string;
  agentRulesVersion?: string;
  toolPolicyVersion?: string;
  promptTemplateVersion?: string;
  sourceHash: string;
}

export interface TaskProfileOutcome {
  buildStatus: VerificationStatus | null;
  testStatus: VerificationStatus | null;
  lintStatus: VerificationStatus | null;
  gitCommit: string | null;
  humanRating: number | null;
  reworkReason: string | null;
  completedAt: number | null;
  evidence: TaskOutcomeEvidence[];
}

export interface TaskProfileSessionSample {
  id: string;
  available: boolean;
  role: 'primary' | 'continuation' | 'subagent' | 'verification';
  configSnapshotId?: string;
  agent?: string;
  inputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  outputTokens?: number;
  totalCost?: number;
  costUnknownCount?: number;
  peakContextTokens?: number;
  cacheHitRate?: number;
  startTime?: number;
  endTime?: number;
  toolCalls?: number;
  toolErrors?: number;
}

export interface TaskProfileInput {
  task: TaskProfileTask;
  configurations: TaskProfileConfiguration[];
  sessions: TaskProfileSessionSample[];
  outcome?: TaskProfileOutcome;
  cohortIds?: string[];
  generatedAt?: number;
}

export interface TaskProfileReport {
  schemaVersion: typeof TASK_PROFILE_SCHEMA_VERSION;
  generatedAt: number;
  task: TaskProfileTask;
  configurations: TaskProfileConfiguration[];
  outcome: TaskProfileOutcome | null;
  profile: {
    linkedSessions: number;
    availableSessions: number;
    agents: string[];
    totalTokens: number;
    totalCost: number;
    costCoverage: number;
    durationMs: number | null;
    peakContextTokens: number | null;
    cacheHitRate: number | null;
    toolCalls: number;
    toolErrors: number;
    toolErrorRate: number | null;
  };
  comparison: {
    cohortIds: string[];
    status: 'not_requested' | 'definition_only';
    interpretation: string;
  };
  coverage: {
    sessions: { linked: number; available: number; ratio: number };
    outcome: {
      status: 'not_collected' | 'partial' | 'verified';
      observedFields: number;
      totalFields: number;
    };
  };
  limitations: string[];
}

export function buildTaskProfile(input: TaskProfileInput): TaskProfileReport {
  const available = input.sessions.filter((session) => session.available);
  const totalTokens = available.reduce(
    (sum, session) =>
      sum +
      (session.inputTokens ?? 0) +
      (session.cacheCreationTokens ?? 0) +
      (session.cacheReadTokens ?? 0) +
      (session.outputTokens ?? 0),
    0,
  );
  const knownCostSessions = available.filter((session) => (session.costUnknownCount ?? 0) === 0);
  const totalCost = knownCostSessions.reduce((sum, session) => sum + (session.totalCost ?? 0), 0);
  const durationSamples = available
    .map((session) =>
      session.startTime != null && session.endTime != null
        ? Math.max(0, session.endTime - session.startTime)
        : null,
    )
    .filter((value): value is number => value !== null);
  const contextSamples = available
    .map((session) => session.peakContextTokens)
    .filter((value): value is number => value != null);
  const cacheSamples = available
    .map((session) => session.cacheHitRate)
    .filter((value): value is number => value != null);
  const toolCalls = available.reduce((sum, session) => sum + (session.toolCalls ?? 0), 0);
  const toolErrors = available.reduce((sum, session) => sum + (session.toolErrors ?? 0), 0);
  const observedOutcomeFields = input.outcome
    ? [
        input.outcome.buildStatus,
        input.outcome.testStatus,
        input.outcome.lintStatus,
        input.outcome.gitCommit,
        input.outcome.humanRating,
      ].filter((value) => value != null).length
    : 0;
  const outcomeStatus =
    observedOutcomeFields === 0
      ? 'not_collected'
      : observedOutcomeFields === 5
        ? 'verified'
        : 'partial';
  const cohortIds = input.cohortIds ?? [];
  const limitations: string[] = [];
  if (available.length < input.sessions.length) {
    limitations.push(
      'One or more linked Sessions are currently unavailable after local data reset or source changes.',
    );
  }
  if (outcomeStatus !== 'verified') {
    limitations.push(
      'Outcome evidence is missing or partial; process metrics do not prove delivery quality.',
    );
  }
  if (knownCostSessions.length < available.length) {
    limitations.push(
      'Some linked Sessions use models without known pricing; total cost has partial coverage.',
    );
  }
  limitations.push(
    'Cohort and experiment records describe comparison scope; they do not establish causality by themselves.',
  );

  return {
    schemaVersion: TASK_PROFILE_SCHEMA_VERSION,
    generatedAt: input.generatedAt ?? Date.now(),
    task: input.task,
    configurations: input.configurations,
    outcome: input.outcome ?? null,
    profile: {
      linkedSessions: input.sessions.length,
      availableSessions: available.length,
      agents: [
        ...new Set(available.map((session) => session.agent).filter(Boolean) as string[]),
      ].sort(),
      totalTokens,
      totalCost,
      costCoverage: available.length > 0 ? knownCostSessions.length / available.length : 0,
      durationMs: durationSamples.length > 0 ? durationSamples.reduce((a, b) => a + b, 0) : null,
      peakContextTokens: contextSamples.length > 0 ? Math.max(...contextSamples) : null,
      cacheHitRate:
        cacheSamples.length > 0
          ? cacheSamples.reduce((sum, value) => sum + value, 0) / cacheSamples.length
          : null,
      toolCalls,
      toolErrors,
      toolErrorRate: toolCalls > 0 ? toolErrors / toolCalls : null,
    },
    comparison: {
      cohortIds,
      status: cohortIds.length > 0 ? 'definition_only' : 'not_requested',
      interpretation:
        'No configuration is labelled better without sufficient comparable Tasks and explicit Outcome guardrails.',
    },
    coverage: {
      sessions: {
        linked: input.sessions.length,
        available: available.length,
        ratio: input.sessions.length > 0 ? available.length / input.sessions.length : 0,
      },
      outcome: { status: outcomeStatus, observedFields: observedOutcomeFields, totalFields: 5 },
    },
    limitations,
  };
}
