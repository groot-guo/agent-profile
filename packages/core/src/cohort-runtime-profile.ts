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

export type RuntimeProfileStratumDimension = 'project_id' | 'task_type' | 'complexity';

export interface RuntimeProfileComparabilityInput {
  dimensions: RuntimeProfileStratumDimension[];
  minTasksPerGroup?: number;
  minOutcomeCoverage?: number;
}

export interface RuntimeProfileStratumReport {
  key: string;
  controlTasks: number;
  candidateTasks: number;
  controlEligibleTasks: number;
  candidateEligibleTasks: number;
  controlOutcomeCoverage: number;
  candidateOutcomeCoverage: number;
  status: 'included' | 'excluded';
  reason: 'missing_stratum_value' | 'missing_counterpart' | 'insufficient_outcome_evidence' | null;
}

export interface RuntimeProfileComparabilityReport {
  status: 'comparable' | 'not_comparable';
  dimensions: RuntimeProfileStratumDimension[];
  minTasksPerGroup: number;
  minOutcomeCoverage: number;
  strata: RuntimeProfileStratumReport[];
  includedTaskIds: string[];
  excludedTaskIds: string[];
}

export interface RuntimeProfileTaskInput {
  id: string;
  configGroup: 'control' | 'candidate';
  outcomeVerified: boolean;
  metrics: Partial<Record<RuntimeProfileMetric, number | null>>;
  strata?: Partial<Record<RuntimeProfileStratumDimension, string | null>>;
}

export interface RuntimeProfileDistribution {
  metric: RuntimeProfileMetric;
  observed: number;
  coverage: number;
  mean: number | null;
  median: number | null;
  p25: number | null;
  p90: number | null;
  p75: number | null;
  min: number | null;
  max: number | null;
  standardDeviation: number | null;
}

export interface RuntimeProfileGroup {
  configId: string;
  eligibleTasks: number;
  totalTasks: number;
  comparableTasks: number;
  outcomeCoverage: number;
  taskIds: string[];
  excludedTaskIds: string[];
  distributions: RuntimeProfileDistribution[];
}

export interface RuntimeProfileUncertainty {
  method: 'normal_approximation_95' | 'not_available';
  relativeDeltaLower: number | null;
  relativeDeltaUpper: number | null;
}

export interface RuntimeProfileComparison {
  metric: RuntimeProfileMetric;
  status: 'descriptive' | 'insufficient_evidence';
  controlObserved: number;
  candidateObserved: number;
  controlMedian: number | null;
  candidateMedian: number | null;
  absoluteDelta: number | null;
  relativeDelta: number | null;
  direction: 'higher' | 'lower' | 'similar' | 'unknown';
  uncertainty: RuntimeProfileUncertainty;
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
  comparability?: RuntimeProfileComparabilityInput;
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
    comparableTasks: number;
    excludedTasks: number;
  };
  comparability: RuntimeProfileComparabilityReport;
  groups: {
    control: RuntimeProfileGroup;
    candidate: RuntimeProfileGroup;
  };
  comparisons: RuntimeProfileComparison[];
  guardrails: RuntimeProfileGuardrail[];
  evaluationStatus: 'ready' | 'insufficient_evidence' | 'not_comparable';
  interpretation: string;
  limitations: string[];
}

export function buildCohortRuntimeProfile(
  input: CohortRuntimeProfileInput,
): CohortRuntimeProfileReport {
  const controlTasks = input.tasks.filter((task) => task.configGroup === 'control');
  const candidateTasks = input.tasks.filter((task) => task.configGroup === 'candidate');
  const comparability = buildComparability(input.tasks, input.comparability);
  const comparableTaskIds = new Set(comparability.includedTaskIds);
  const control = buildGroup(input.controlConfigId, controlTasks, comparableTaskIds);
  const candidate = buildGroup(input.candidateConfigId, candidateTasks, comparableTaskIds);
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
    comparability.status === 'not_comparable'
      ? 'not_comparable'
      : enoughSamples && primaryReady && guardrailsReady
        ? 'ready'
        : 'insufficient_evidence';

  const limitations: string[] = [];
  if (!enoughSamples) {
    limitations.push(
      `Each configuration needs at least ${MIN_RUNTIME_PROFILE_TASKS} Outcome-eligible Tasks before comparison.`,
    );
  }
  if (comparability.excludedTaskIds.length > 0) {
    limitations.push(
      'Tasks in strata without a comparable control/candidate counterpart or sufficient Outcome coverage are excluded from the guarded comparison.',
    );
  }
  if (comparability.status === 'not_comparable') {
    limitations.push(
      'No declared comparability stratum met the minimum counterpart, Outcome-quality, and metric-evidence rules.',
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
      comparableTasks: control.comparableTasks + candidate.comparableTasks,
      excludedTasks: comparability.excludedTaskIds.length,
    },
    comparability,
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

function buildGroup(
  configId: string,
  tasks: RuntimeProfileTaskInput[],
  comparableTaskIds: Set<string>,
): RuntimeProfileGroup {
  const comparableTasks = tasks.filter((task) => comparableTaskIds.has(task.id));
  const eligibleTasks = comparableTasks.filter((task) => task.outcomeVerified);
  return {
    configId,
    eligibleTasks: eligibleTasks.length,
    totalTasks: tasks.length,
    comparableTasks: comparableTasks.length,
    outcomeCoverage: comparableTasks.length > 0 ? eligibleTasks.length / comparableTasks.length : 0,
    taskIds: tasks.map((task) => task.id),
    excludedTaskIds: tasks.filter((task) => !comparableTaskIds.has(task.id)).map((task) => task.id),
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
    p25: nearestRank(sorted, 0.25),
    p90: nearestRank(sorted, 0.9),
    p75: nearestRank(sorted, 0.75),
    min: sorted[0] ?? null,
    max: sorted.at(-1) ?? null,
    standardDeviation: sampleStandardDeviation(sorted),
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
  const controlMedian = controlDistribution?.median ?? null;
  const candidateMedian = candidateDistribution?.median ?? null;
  const absoluteDelta =
    controlMean != null && candidateMean != null ? candidateMean - controlMean : null;
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
    controlMedian,
    candidateMedian,
    absoluteDelta,
    relativeDelta,
    direction,
    uncertainty: uncertaintyFor(
      controlDistribution,
      candidateDistribution,
      controlMean,
      relativeDelta,
    ),
    interpretation:
      status === 'descriptive'
        ? 'Observed relative difference only; direction has no universal quality meaning.'
        : 'Missing sample or metric coverage prevents a guarded comparison.',
  };
}

function buildComparability(
  tasks: RuntimeProfileTaskInput[],
  input: RuntimeProfileComparabilityInput | undefined,
): RuntimeProfileComparabilityReport {
  const dimensions = [...new Set(input?.dimensions ?? [])];
  const minTasksPerGroup = normalizeMinimum(input?.minTasksPerGroup, MIN_RUNTIME_PROFILE_TASKS);
  const minOutcomeCoverage = normalizeCoverage(
    input?.minOutcomeCoverage,
    MIN_RUNTIME_PROFILE_COVERAGE,
  );
  const buckets = new Map<
    string,
    { control: RuntimeProfileTaskInput[]; candidate: RuntimeProfileTaskInput[] }
  >();
  for (const task of tasks) {
    const key = stratumKey(task, dimensions);
    const bucket = buckets.get(key) ?? { control: [], candidate: [] };
    bucket[task.configGroup].push(task);
    buckets.set(key, bucket);
  }
  const strata = [...buckets.entries()].map(([key, bucket]) => {
    const controlEligibleTasks = bucket.control.filter((task) => task.outcomeVerified).length;
    const candidateEligibleTasks = bucket.candidate.filter((task) => task.outcomeVerified).length;
    const controlOutcomeCoverage = coverage(controlEligibleTasks, bucket.control.length);
    const candidateOutcomeCoverage = coverage(candidateEligibleTasks, bucket.candidate.length);
    const reason =
      hasMissingStratumValue(bucket.control, dimensions) ||
      hasMissingStratumValue(bucket.candidate, dimensions)
        ? ('missing_stratum_value' as const)
        : bucket.control.length === 0 || bucket.candidate.length === 0
          ? ('missing_counterpart' as const)
          : controlEligibleTasks < minTasksPerGroup ||
              candidateEligibleTasks < minTasksPerGroup ||
              controlOutcomeCoverage < minOutcomeCoverage ||
              candidateOutcomeCoverage < minOutcomeCoverage
            ? ('insufficient_outcome_evidence' as const)
            : null;
    return {
      key,
      controlTasks: bucket.control.length,
      candidateTasks: bucket.candidate.length,
      controlEligibleTasks,
      candidateEligibleTasks,
      controlOutcomeCoverage,
      candidateOutcomeCoverage,
      status: reason ? ('excluded' as const) : ('included' as const),
      reason,
    };
  });
  const includedKeys = new Set(
    strata.filter((stratum) => stratum.status === 'included').map((stratum) => stratum.key),
  );
  const hasStructuralCounterpart = strata.some(
    (stratum) =>
      stratum.controlTasks > 0 &&
      stratum.candidateTasks > 0 &&
      stratum.reason !== 'missing_stratum_value',
  );
  const includedTaskIds = tasks
    .filter((task) => includedKeys.has(stratumKey(task, dimensions)))
    .map((task) => task.id);
  const includedTaskIdSet = new Set(includedTaskIds);
  return {
    status: hasStructuralCounterpart ? 'comparable' : 'not_comparable',
    dimensions,
    minTasksPerGroup,
    minOutcomeCoverage,
    strata,
    includedTaskIds,
    excludedTaskIds: tasks.filter((task) => !includedTaskIdSet.has(task.id)).map((task) => task.id),
  };
}

function hasMissingStratumValue(
  tasks: RuntimeProfileTaskInput[],
  dimensions: RuntimeProfileStratumDimension[],
): boolean {
  return tasks.some((task) => dimensions.some((dimension) => !task.strata?.[dimension]?.trim()));
}

function stratumKey(
  task: RuntimeProfileTaskInput,
  dimensions: RuntimeProfileStratumDimension[],
): string {
  if (dimensions.length === 0) return 'all';
  return dimensions
    .map((dimension) => `${dimension}=${task.strata?.[dimension]?.trim() || '<not_captured>'}`)
    .join('|');
}

function uncertaintyFor(
  control: RuntimeProfileDistribution | undefined,
  candidate: RuntimeProfileDistribution | undefined,
  controlMean: number | null,
  relativeDelta: number | null,
): RuntimeProfileUncertainty {
  if (
    controlMean == null ||
    relativeDelta == null ||
    control?.standardDeviation == null ||
    candidate?.standardDeviation == null ||
    control.observed < 2 ||
    candidate.observed < 2
  ) {
    return { method: 'not_available', relativeDeltaLower: null, relativeDeltaUpper: null };
  }
  const standardError = Math.sqrt(
    control.standardDeviation ** 2 / control.observed +
      candidate.standardDeviation ** 2 / candidate.observed,
  );
  const margin = (1.96 * standardError) / Math.abs(controlMean);
  return {
    method: 'normal_approximation_95',
    relativeDeltaLower: relativeDelta - margin,
    relativeDeltaUpper: relativeDelta + margin,
  };
}

function sampleStandardDeviation(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1),
  );
}

function coverage(eligible: number, total: number): number {
  return total > 0 ? eligible / total : 0;
}

function normalizeMinimum(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function normalizeCoverage(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : fallback;
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
