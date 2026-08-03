import { describe, expect, it } from 'vitest';
import { buildCohortRuntimeProfile } from '../cohort-runtime-profile';
import { buildPostRunFeedback } from '../post-run-feedback';

function profile(decision: string | null = 'keep', ready = true) {
  return buildCohortRuntimeProfile({
    experimentId: 'experiment-1',
    title: 'Runtime experiment',
    cohortId: 'cohort-1',
    controlConfigId: 'control-1',
    candidateConfigId: 'candidate-1',
    primaryMetric: 'duration_ms',
    guardrails: [{ metric: 'duration_ms', maxRelativeRegression: 0.2 }],
    persistedDecision: decision,
    generatedAt: 200,
    tasks: [
      ...Array.from({ length: ready ? 3 : 1 }, (_, index) => ({
        id: `control-task-${index}`,
        configGroup: 'control' as const,
        outcomeVerified: true,
        metrics: { duration_ms: 100 + index },
      })),
      ...Array.from({ length: ready ? 3 : 1 }, (_, index) => ({
        id: `candidate-task-${index}`,
        configGroup: 'candidate' as const,
        outcomeVerified: true,
        metrics: { duration_ms: 120 + index },
      })),
    ],
  });
}

describe('post-run feedback', () => {
  it('emits a bounded candidate finding with linked evidence', () => {
    const report = buildPostRunFeedback({
      task: {
        id: 'candidate-task-0',
        status: 'completed',
        outcomeVerified: true,
        completedAt: 300,
      },
      experiment: {
        id: 'experiment-1',
        cohortId: 'cohort-1',
        status: 'completed',
        profile: profile(),
        taskRole: 'candidate',
      },
      generatedAt: 400,
    });

    expect(report).toMatchObject({
      schemaVersion: 'post-run-feedback/v1',
      status: 'available',
      findings: [{ id: 'consider_candidate', action: 'consider_candidate' }],
      suppression: null,
    });
    expect(report.findings[0]?.evidence).toMatchObject({
      experimentId: 'experiment-1',
      profileSchemaVersion: 'cohort-runtime-profile/v1',
      primaryMetric: 'duration_ms',
    });
    expect(JSON.stringify(report)).not.toContain('prompt');
  });

  it('suppresses incomplete, stale, and control evidence', () => {
    const base = {
      id: 'candidate-task-0',
      status: 'completed',
      outcomeVerified: true,
      completedAt: 300,
    };
    expect(
      buildPostRunFeedback({
        task: { ...base, outcomeVerified: false },
        experiment: {
          id: 'experiment-1',
          cohortId: 'cohort-1',
          status: 'completed',
          profile: profile(),
          taskRole: 'candidate',
        },
      }).suppression?.reason,
    ).toBe('outcome_not_verified');
    expect(
      buildPostRunFeedback({
        task: base,
        experiment: {
          id: 'experiment-1',
          cohortId: 'cohort-1',
          status: 'completed',
          profile: profile('keep', false),
          taskRole: 'candidate',
        },
      }).suppression?.reason,
    ).toBe('stale_evidence');
    expect(
      buildPostRunFeedback({
        task: { ...base, id: 'control-task-0' },
        experiment: {
          id: 'experiment-1',
          cohortId: 'cohort-1',
          status: 'completed',
          profile: profile(),
          taskRole: 'control',
        },
      }).suppression?.reason,
    ).toBe('control_baseline');
  });
});
