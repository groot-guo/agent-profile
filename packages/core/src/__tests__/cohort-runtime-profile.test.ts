import { describe, expect, it } from 'vitest';
import { buildCohortRuntimeProfile, type RuntimeProfileTaskInput } from '../cohort-runtime-profile';

function task(
  id: string,
  configGroup: RuntimeProfileTaskInput['configGroup'],
  duration: number,
  outcomeVerified = true,
): RuntimeProfileTaskInput {
  return {
    id,
    configGroup,
    outcomeVerified,
    metrics: {
      duration_ms: duration,
      total_tokens: duration * 10,
      total_cost: duration,
      tool_error_rate: 0.1,
      peak_context_tokens: 100,
      cache_hit_rate: 0.2,
    },
  };
}

describe('cohort runtime profile', () => {
  it('builds distributions and bounded guardrail results without a winner label', () => {
    const report = buildCohortRuntimeProfile({
      experimentId: 'experiment-1',
      title: 'fixture experiment',
      cohortId: 'cohort-1',
      controlConfigId: 'config-control',
      candidateConfigId: 'config-candidate',
      primaryMetric: 'duration_ms',
      guardrails: [{ metric: 'duration_ms', maxRelativeRegression: 0.2 }],
      tasks: [
        task('control-1', 'control', 100),
        task('control-2', 'control', 110),
        task('control-3', 'control', 90),
        task('candidate-1', 'candidate', 130),
        task('candidate-2', 'candidate', 120),
        task('candidate-3', 'candidate', 110),
      ],
      generatedAt: 123,
    });

    expect(report.schemaVersion).toBe('cohort-runtime-profile/v1');
    expect(report.evaluationStatus).toBe('ready');
    expect(report.groups.control.eligibleTasks).toBe(3);
    expect(report.groups.candidate.eligibleTasks).toBe(3);
    expect(report.groups.control.distributions[0]).toMatchObject({
      metric: 'duration_ms',
      observed: 3,
      median: 100,
      p25: 90,
      p90: 110,
      p75: 110,
    });
    expect(report.guardrails[0]).toMatchObject({ status: 'passed', metric: 'duration_ms' });
    expect(report.comparisons.find((item) => item.metric === 'duration_ms')).toMatchObject({
      status: 'descriptive',
      direction: 'higher',
      uncertainty: { method: 'normal_approximation_95' },
    });
    expect(report).not.toHaveProperty('winner');
  });

  it('keeps missing Outcome and unsupported guardrails insufficient', () => {
    const report = buildCohortRuntimeProfile({
      experimentId: 'experiment-2',
      title: 'insufficient fixture',
      cohortId: 'cohort-1',
      controlConfigId: 'control',
      candidateConfigId: 'candidate',
      primaryMetric: 'duration_ms',
      guardrails: [{ name: 'free-form guardrail' }],
      tasks: [
        task('control-1', 'control', 100),
        task('control-2', 'control', 110),
        task('control-3', 'control', 90, false),
        task('candidate-1', 'candidate', 100),
      ],
    });

    expect(report.evaluationStatus).toBe('insufficient_evidence');
    expect(report.comparability.status).toBe('comparable');
    expect(report.sample.outcomeEligibleTasks).toBe(3);
    expect(report.groups.control.eligibleTasks).toBe(0);
    expect(report.guardrails[0].status).toBe('not_evaluable');
    expect(report.limitations.join(' ')).toContain('Outcome-eligible');
  });

  it('excludes strata without a counterpart or sufficient Outcome evidence', () => {
    const report = buildCohortRuntimeProfile({
      experimentId: 'experiment-3',
      title: 'stratified fixture',
      cohortId: 'cohort-1',
      controlConfigId: 'control',
      candidateConfigId: 'candidate',
      primaryMetric: 'duration_ms',
      guardrails: [],
      comparability: { dimensions: ['task_type'] },
      tasks: [
        ...[100, 110, 90].map((duration, index) =>
          task(`control-feature-${index}`, 'control', duration),
        ),
        ...[130, 120, 110].map((duration, index) =>
          task(`candidate-feature-${index}`, 'candidate', duration),
        ),
        task('control-maintenance', 'control', 100),
      ].map((item, index) => ({
        ...item,
        strata: { task_type: index === 6 ? 'maintenance' : 'feature' },
      })),
    });

    expect(report.evaluationStatus).toBe('ready');
    expect(report.comparability).toMatchObject({
      status: 'comparable',
      excludedTaskIds: ['control-maintenance'],
    });
    expect(report.comparability.strata).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'task_type=maintenance', reason: 'missing_counterpart' }),
      ]),
    );
    expect(report.groups.control.comparableTasks).toBe(3);
    expect(report.sample.excludedTasks).toBe(1);
  });

  it('does not treat missing declared stratum values as comparable', () => {
    const report = buildCohortRuntimeProfile({
      experimentId: 'experiment-4',
      title: 'missing stratum fixture',
      cohortId: 'cohort-1',
      controlConfigId: 'control',
      candidateConfigId: 'candidate',
      primaryMetric: 'duration_ms',
      guardrails: [],
      comparability: { dimensions: ['complexity'] },
      tasks: [
        task('control-1', 'control', 100),
        task('control-2', 'control', 100),
        task('control-3', 'control', 100),
        task('candidate-1', 'candidate', 100),
        task('candidate-2', 'candidate', 100),
        task('candidate-3', 'candidate', 100),
      ],
    });

    expect(report.evaluationStatus).toBe('not_comparable');
    expect(report.comparability.strata[0]).toMatchObject({
      reason: 'missing_stratum_value',
      status: 'excluded',
    });
  });
});
