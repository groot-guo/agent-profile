export const COHORT_RUNTIME_PROFILE_SCHEMA_VERSION = 'cohort-runtime-profile/v1' as const;
export const MIN_RUNTIME_PROFILE_TASKS = 3;
export const MIN_RUNTIME_PROFILE_COVERAGE = 0.5;

export type RuntimeProfileMetric =
  | 'duration_ms'
  | 'total_tokens'
  | 'total_cost'
  | 'tool_error_rate'
  | 'peak_context_tokens'
  | 'cache_hit_rate';

export interface RuntimeProfileTaskInput {
  id: string;
  configGroup: 'control' | 'candidate';
  outcomeVerified: boolean;
  metrics: Partial<Record<RuntimeProfileMetric, number | null>>;
}

export interface RuntimeProfileDistribution {
  metric: RuntimeProfileMetric;
  observed: number;
  coverage: number;
  mean: number | null;
  median: number | null;
  p90: number | null;
  min: number | null;
  max: number | null;
}

export interface RuntimeProfileGroup {
  configId: string;
  eligibleTasks: number;
  totalTasks: number;
  outcomeCoverage: number;
  taskIds: string[];
  distributions: RuntimeProfileDistribution[];
}

export interface RuntimeProfileComparison {
  metric: RuntimeProfileMetric;
  status: 'descriptive' | 'insufficient_evidence';
  controlObserved: number;
  candidateObserved: number;
  relativeDelta: number | null;
  direction: 'higher' | 'lower' | 'similar' | 'unknown';
  interpretation: string;
}

export interface RuntimeProfileGuardrail {
  metric: RuntimeProfileMetric | null;
  maxRelativeRegression: number | null;
  status: 'passed' | 'failed' | 'insufficient_evidence' | 'not_evaluable';
  relativeDelta: number | null;
  interpretation: string;
}

export interface CohortRuntimeProfileInput {
  experimentId: string;
  title: string;
  cohortId: string;
  controlConfigId: string;
  candidateConfigId: string;
  primaryMetric: string;
  guardrails: unknown[];
  tasks: RuntimeProfileTaskInput[];
  persistedDecision?: string | null;
  generatedAt?: number;
}

export interface CohortRuntimeProfileReport {
  schemaVersion: typeof COHORT_RUNTIME_PROFILE_SCHEMA_VERSION;
  generatedAt: number;
  experiment: {
    id: string;
    title: string;
    cohortId: string;
    controlConfigId: string;
    candidateConfigId: string;
    primaryMetric: string;
    persistedDecision: string | null;
  };
  sample: {
    totalTasks: number;
    outcomeEligibleTasks: number;
    minimumTasksPerGroup: number;
    minimumMetricCoverage: number;
  };
  groups: {
    control: RuntimeProfileGroup;
    candidate: RuntimeProfileGroup;
  };
  comparisons: RuntimeProfileComparison[];
  guardrails: RuntimeProfileGuardrail[];
  evaluationStatus: 'ready' | 'insufficient_evidence';
  interpretation: string;
  limitations: string[];
}

export function buildCohortRuntimeProfile(
  input: CohortRuntimeProfileInput,
): CohortRuntimeProfileReport {
  const controlTasks = input.tasks.filter((task) => task.configGroup === 'control');
  const candidateTasks = input.tasks.filter((task) => task.configGroup === 'candidate');
  const control = buildGroup(input.controlConfigId, controlTasks);
  const candidate = buildGroup(input.candidateConfigId, candidateTasks);
  const comparisons = RUNTIME_PROFILE_METRICS.map((metric) =>
    compareMetric(metric, control, candidate),
  );
  const primary = normalizeMetric(input.primaryMetric);
  const primaryComparison = comparisons.find((comparison) => comparison.metric === primary);
  const guardrails = input.guardrails.map((guardrail) => evaluateGuardrail(guardrail, comparisons));
  const enoughSamples =
    control.eligibleTasks >= MIN_RUNTIME_PROFILE_TASKS &&
    candidate.eligibleTasks >= MIN_RUNTIME_PROFILE_TASKS;
  const primaryReady =
    primaryComparison?.status === 'descriptive' &&
    primaryComparison.controlObserved / Math.max(1, control.eligibleTasks) >=
      MIN_RUNTIME_PROFILE_COVERAGE &&
    primaryComparison.candidateObserved / Math.max(1, candidate.eligibleTasks) >=
      MIN_RUNTIME_PROFILE_COVERAGE;
  const guardrailsReady = guardrails.every(
    (guardrail) => guardrail.status === 'passed' || guardrail.status === 'failed',
  );
  const evaluationStatus =
    enoughSamples && primaryReady && guardrailsReady ? 'ready' : 'insufficient_evidence';

  const limitations: string[] = [];
  if (!enoughSamples) {
    limitations.push(
      `Each configuration needs at least ${MIN_RUNTIME_PROFILE_TASKS} Outcome-eligible Tasks before comparison.`,
    );
  }
  if (input.tasks.some((task) => !task.outcomeVerified)) {
    limitations.push(
      'Tasks without all five tracked Outcome fields remain visible in the total but are excluded from outcome-guarded comparison.',
    );
  }
  if (guardrails.some((guardrail) => guardrail.status === 'not_evaluable')) {
    limitations.push(
      'One or more persisted guardrails are not in the bounded metric/threshold shape and were not evaluated.',
    );
  }
  limitations.push(
    'Comparisons describe observed distributions within this Cohort; they do not prove a universal Agent, configuration, or causal quality winner.',
  );

  return {
    schemaVersion: COHORT_RUNTIME_PROFILE_SCHEMA_VERSION,
    generatedAt: input.generatedAt ?? Date.now(),
    experiment: {
      id: input.experimentId,
      title: input.title,
      cohortId: input.cohortId,
      controlConfigId: input.controlConfigId,
      candidateConfigId: input.candidateConfigId,
      primaryMetric: input.primaryMetric,
      persistedDecision: input.persistedDecision ?? null,
    },
    sample: {
      totalTasks: input.tasks.length,
      outcomeEligibleTasks: input.tasks.filter((task) => task.outcomeVerified).length,
      minimumTasksPerGroup: MIN_RUNTIME_PROFILE_TASKS,
      minimumMetricCoverage: MIN_RUNTIME_PROFILE_COVERAGE,
    },
    groups: { control, candidate },
    comparisons,
    guardrails,
    evaluationStatus,
    interpretation:
      evaluationStatus === 'ready'
        ? 'Evidence is sufficient for bounded descriptive comparison and guardrail evaluation; it is not a universal quality or causal verdict.'
        : 'Evidence is insufficient for a guarded comparison; no configuration decision is inferred.',
    limitations,
  };
}

const RUNTIME_PROFILE_METRICS: RuntimeProfileMetric[] = [
  'duration_ms',
  'total_tokens',
  'total_cost',
  'tool_error_rate',
  'peak_context_tokens',
  'cache_hit_rate',
];

function buildGroup(configId: string, tasks: RuntimeProfileTaskInput[]): RuntimeProfileGroup {
  const eligibleTasks = tasks.filter((task) => task.outcomeVerified);
  return {
    configId,
    eligibleTasks: eligibleTasks.length,
    totalTasks: tasks.length,
    outcomeCoverage: tasks.length > 0 ? eligibleTasks.length / tasks.length : 0,
    taskIds: tasks.map((task) => task.id),
    distributions: RUNTIME_PROFILE_METRICS.map((metric) => {
      const values = eligibleTasks
        .map((task) => task.metrics[metric])
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
      return distribution(metric, values, eligibleTasks.length);
    }),
  };
}

function distribution(
  metric: RuntimeProfileMetric,
  values: number[],
  eligibleTasks: number,
): RuntimeProfileDistribution {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    metric,
    observed: sorted.length,
    coverage: eligibleTasks > 0 ? sorted.length / eligibleTasks : 0,
    mean: sorted.length > 0 ? sorted.reduce((sum, value) => sum + value, 0) / sorted.length : null,
    median: nearestRank(sorted, 0.5),
    p90: nearestRank(sorted, 0.9),
    min: sorted[0] ?? null,
    max: sorted.at(-1) ?? null,
  };
}

function compareMetric(
  metric: RuntimeProfileMetric,
  control: RuntimeProfileGroup,
  candidate: RuntimeProfileGroup,
): RuntimeProfileComparison {
  const controlDistribution = control.distributions.find((item) => item.metric === metric);
  const candidateDistribution = candidate.distributions.find((item) => item.metric === metric);
  const controlObserved = controlDistribution?.observed ?? 0;
  const candidateObserved = candidateDistribution?.observed ?? 0;
  const controlMean = controlDistribution?.mean ?? null;
  const candidateMean = candidateDistribution?.mean ?? null;
  const relativeDelta =
    controlMean != null && candidateMean != null && controlMean !== 0
      ? (candidateMean - controlMean) / Math.abs(controlMean)
      : null;
  const status =
    control.eligibleTasks >= MIN_RUNTIME_PROFILE_TASKS &&
    candidate.eligibleTasks >= MIN_RUNTIME_PROFILE_TASKS &&
    (controlDistribution?.coverage ?? 0) >= MIN_RUNTIME_PROFILE_COVERAGE &&
    (candidateDistribution?.coverage ?? 0) >= MIN_RUNTIME_PROFILE_COVERAGE
      ? 'descriptive'
      : 'insufficient_evidence';
  const direction =
    relativeDelta == null
      ? 'unknown'
      : Math.abs(relativeDelta) <= 0.1
        ? 'similar'
        : relativeDelta > 0
          ? 'higher'
          : 'lower';
  return {
    metric,
    status,
    controlObserved,
    candidateObserved,
    relativeDelta,
    direction,
    interpretation:
      status === 'descriptive'
        ? 'Observed relative difference only; direction has no universal quality meaning.'
        : 'Missing sample or metric coverage prevents a guarded comparison.',
  };
}

function evaluateGuardrail(
  value: unknown,
  comparisons: RuntimeProfileComparison[],
): RuntimeProfileGuardrail {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return notEvaluableGuardrail();
  }
  const metric = normalizeMetric((value as { metric?: unknown }).metric);
  const threshold = (value as { maxRelativeRegression?: unknown }).maxRelativeRegression;
  if (
    metric == null ||
    typeof threshold !== 'number' ||
    !Number.isFinite(threshold) ||
    threshold < 0
  ) {
    return notEvaluableGuardrail();
  }
  const comparison = comparisons.find((item) => item.metric === metric);
  if (comparison?.status !== 'descriptive' || comparison.relativeDelta == null) {
    return {
      metric,
      maxRelativeRegression: threshold,
      status: 'insufficient_evidence',
      relativeDelta: comparison?.relativeDelta ?? null,
      interpretation: 'The guardrail needs sufficient metric coverage and a non-zero control mean.',
    };
  }
  const failed = comparison.relativeDelta > threshold;
  return {
    metric,
    maxRelativeRegression: threshold,
    status: failed ? 'failed' : 'passed',
    relativeDelta: comparison.relativeDelta,
    interpretation: failed
      ? 'Candidate observed regression exceeds the configured relative threshold.'
      : 'Candidate observed value remains within the configured relative threshold.',
  };
}

function notEvaluableGuardrail(): RuntimeProfileGuardrail {
  return {
    metric: null,
    maxRelativeRegression: null,
    status: 'not_evaluable',
    relativeDelta: null,
    interpretation: 'Only { metric, maxRelativeRegression } guardrails are evaluated.',
  };
}

function normalizeMetric(value: unknown): RuntimeProfileMetric | null {
  return typeof value === 'string' &&
    RUNTIME_PROFILE_METRICS.includes(value as RuntimeProfileMetric)
    ? (value as RuntimeProfileMetric)
    : null;
}

function nearestRank(values: number[], quantile: number): number | null {
  if (values.length === 0) return null;
  return values[Math.max(0, Math.ceil(values.length * quantile) - 1)];
}
