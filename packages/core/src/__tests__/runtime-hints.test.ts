import { describe, expect, it } from 'vitest';
import {
  buildRuntimeHint,
  type RuntimeHintEventSignal,
  type RuntimeHintHistoricalEvidence,
} from '../runtime-hints';

const historical: RuntimeHintHistoricalEvidence = {
  experimentId: 'experiment-1',
  cohortId: 'cohort-1',
  configurationRole: 'candidate',
  profileGeneratedAt: 9_900,
  evaluationStatus: 'ready',
  primaryMetric: 'duration_ms',
  primaryStatus: 'descriptive',
  primaryRelativeDelta: 0.1,
  guardrails: [{ metric: 'duration_ms', status: 'passed' }],
  limitations: ['Historical comparison remains descriptive.'],
};

function events(kind: string = 'tool_result'): RuntimeHintEventSignal[] {
  return [
    { eventId: 'event-1', sequence: 1, capturedAt: 9_800, kind, isError: true },
    { eventId: 'event-2', sequence: 2, capturedAt: 9_900, kind, status: 'failed' },
  ];
}

describe('runtime hints', () => {
  it('emits a bounded hint only for fresh complete events and ready history', () => {
    const report = buildRuntimeHint({
      now: 10_000,
      taskId: 'task-1',
      runId: 'run-1',
      events: events(),
      totalEvents: 2,
      historicalEvidence: historical,
      lastIssuedAt: null,
      optIn: true,
    });

    expect(report).toMatchObject({
      schemaVersion: 'runtime-hint/v1',
      status: 'available',
      hint: {
        category: 'repeated_tool_failure',
        confidence: 'medium',
        evidence: { eventIds: ['event-1', 'event-2'], sequences: [1, 2] },
      },
      coverage: { status: 'complete', freshness: 'fresh', ageMs: 100 },
    });
    expect(report.hint?.evidence).not.toHaveProperty('input');
  });

  it('suppresses opt-out, stale, partial, and insufficient evidence states', () => {
    const base = {
      now: 10_000,
      taskId: 'task-1',
      runId: 'run-1',
      events: events(),
      totalEvents: 2,
      historicalEvidence: historical,
      lastIssuedAt: null,
    };
    expect(buildRuntimeHint({ ...base, optIn: false }).suppression?.reason).toBe('opt_in_required');
    expect(
      buildRuntimeHint({
        ...base,
        now: 1_000_000,
        events: events().map((event) => ({ ...event, capturedAt: 1 })),
        optIn: true,
      }).suppression?.reason,
    ).toBe('stale_events');
    expect(
      buildRuntimeHint({
        ...base,
        events: events().map((event) => ({ ...event, capturedAt: 10_001 })),
        optIn: true,
      }).suppression?.reason,
    ).toBe('future_events');
    expect(buildRuntimeHint({ ...base, totalEvents: 3, optIn: true }).suppression?.reason).toBe(
      'partial_event_coverage',
    );
    expect(
      buildRuntimeHint({
        ...base,
        events: [
          ...events(),
          { eventId: 'event-3', sequence: 3, capturedAt: 9_950, kind: 'run_finished' },
        ],
        totalEvents: 3,
        optIn: true,
      }).suppression?.reason,
    ).toBe('run_finished');
    expect(
      buildRuntimeHint({ ...base, historicalEvidence: null, optIn: true }).suppression?.reason,
    ).toBe('historical_evidence_insufficient');
    expect(
      buildRuntimeHint({ ...base, lastIssuedAt: 9_900, optIn: true }).suppression?.reason,
    ).toBe('rate_limited');
  });

  it('does not issue a hint for unrelated events', () => {
    const report = buildRuntimeHint({
      now: 10_000,
      taskId: 'task-1',
      runId: 'run-1',
      events: events('turn_finished'),
      totalEvents: 2,
      historicalEvidence: historical,
      lastIssuedAt: null,
      optIn: true,
    });
    expect(report.suppression?.reason).toBe('no_supported_signal');
  });

  it('does not treat unknown legacy coverage as complete', () => {
    const report = buildRuntimeHint({
      now: 10_000,
      taskId: 'task-1',
      runId: 'run-1',
      events: events(),
      totalEvents: 2,
      coverageKnown: false,
      historicalEvidence: historical,
      lastIssuedAt: null,
      optIn: true,
    });

    expect(report.suppression?.reason).toBe('partial_event_coverage');
    expect(report.coverage.status).toBe('partial');
  });
});
