export const RUNTIME_HINT_SCHEMA_VERSION = 'runtime-hint/v1' as const;
export const RUNTIME_HINT_ADOPTION_SCHEMA_VERSION = 'runtime-hint-adoption/v1' as const;
export const RUNTIME_HINT_MAX_AGE_MS = 5 * 60 * 1_000;
export const RUNTIME_HINT_EXPIRY_MS = 60 * 1_000;
export const RUNTIME_HINT_MIN_INTERVAL_MS = 30 * 1_000;

export type RuntimeHintSuppressionReason =
  | 'opt_in_required'
  | 'run_not_observed'
  | 'stale_events'
  | 'future_events'
  | 'partial_event_coverage'
  | 'run_finished'
  | 'historical_evidence_insufficient'
  | 'rate_limited'
  | 'no_supported_signal';

export type RuntimeHintAdoptionStatus = 'adopted' | 'ignored' | 'not_recorded';

export interface RuntimeHintEventSignal {
  eventId: string;
  sequence: number;
  capturedAt: number;
  kind: string;
  status?: string;
  isError?: boolean;
  configurationSnapshotId?: string;
}

export interface RuntimeHintHistoricalEvidence {
  experimentId: string;
  cohortId: string;
  configurationRole: 'control' | 'candidate';
  profileGeneratedAt: number;
  evaluationStatus: 'ready';
  primaryMetric: string;
  primaryStatus: 'descriptive';
  primaryRelativeDelta: number | null;
  guardrails: Array<{ metric: string | null; status: string }>;
  limitations: string[];
}

export interface RuntimeHintCoverage {
  observed: number;
  total: number;
  status: 'complete' | 'partial' | 'not_captured';
  firstSequence: number | null;
  lastSequence: number | null;
  latestCapturedAt: number | null;
  ageMs: number | null;
  freshness: 'fresh' | 'stale' | 'future' | 'not_captured';
}

export interface RuntimeHintEvidence {
  eventIds: string[];
  sequences: number[];
  historical: Pick<
    RuntimeHintHistoricalEvidence,
    | 'experimentId'
    | 'cohortId'
    | 'configurationRole'
    | 'profileGeneratedAt'
    | 'primaryMetric'
    | 'primaryStatus'
    | 'primaryRelativeDelta'
    | 'guardrails'
  >;
}

export interface RuntimeHint {
  id: string;
  category: 'repeated_tool_failure';
  confidence: 'medium';
  generatedAt: number;
  expiresAt: number;
  title: string;
  summary: string;
  action: string;
  evidence: RuntimeHintEvidence;
  limitations: string[];
}

export interface RuntimeHintReport {
  schemaVersion: typeof RUNTIME_HINT_SCHEMA_VERSION;
  generatedAt: number;
  taskId: string | null;
  runId: string;
  status: 'available' | 'suppressed';
  hint: RuntimeHint | null;
  suppression: { reason: RuntimeHintSuppressionReason; detail: string } | null;
  coverage: RuntimeHintCoverage;
  historicalEvidence: RuntimeHintHistoricalEvidence | null;
  limitations: string[];
}

export interface RuntimeHintAdoptionRecord {
  schemaVersion: typeof RUNTIME_HINT_ADOPTION_SCHEMA_VERSION;
  hintId: string;
  taskId: string;
  runId: string;
  status: RuntimeHintAdoptionStatus;
  producer: string;
  recordedAt: number;
  evidence: RuntimeHintEvidence;
  limitations: string[];
}

export interface RuntimeHintInput {
  now: number;
  taskId: string | null;
  runId: string;
  events: RuntimeHintEventSignal[];
  totalEvents: number;
  rejectedEvents?: number;
  coverageKnown?: boolean;
  historicalEvidence: RuntimeHintHistoricalEvidence | null;
  lastIssuedAt: number | null;
  optIn: boolean;
}

export function buildRuntimeHint(input: RuntimeHintInput): RuntimeHintReport {
  const coverage = buildCoverage(input);
  const base = {
    schemaVersion: RUNTIME_HINT_SCHEMA_VERSION,
    generatedAt: input.now,
    taskId: input.taskId,
    runId: input.runId,
    coverage,
    historicalEvidence: input.historicalEvidence,
  } as const;
  const suppression = suppressionFor(input, coverage);
  if (suppression) {
    return {
      ...base,
      status: 'suppressed',
      hint: null,
      suppression,
      limitations: reportLimitations(input.historicalEvidence),
    };
  }

  const failureEvents = input.events.filter(isToolFailure);
  const hint: RuntimeHint = {
    id: `runtime-hint:${input.runId}:${coverage.lastSequence}:repeated-tool-failure`,
    category: 'repeated_tool_failure',
    confidence: 'medium',
    generatedAt: input.now,
    expiresAt: input.now + RUNTIME_HINT_EXPIRY_MS,
    title: 'Review repeated tool failures before continuing',
    summary:
      'This fresh Runtime window contains repeated failed tool-result events and ready historical comparison evidence.',
    action:
      'Inspect the failure boundary, narrow the next tool operation, and record the explicit Task Outcome before retaining a strategy change.',
    evidence: {
      eventIds: failureEvents.slice(-5).map((event) => event.eventId),
      sequences: failureEvents.slice(-5).map((event) => event.sequence),
      historical: historicalEvidenceForHint(input.historicalEvidence),
    },
    limitations: reportLimitations(input.historicalEvidence),
  };
  return {
    ...base,
    status: 'available',
    hint,
    suppression: null,
    limitations: reportLimitations(input.historicalEvidence),
  };
}

function buildCoverage(input: RuntimeHintInput): RuntimeHintCoverage {
  const sorted = [...input.events].sort((left, right) => left.sequence - right.sequence);
  const latestCapturedAt = sorted.reduce<number | null>(
    (latest, event) => Math.max(latest ?? event.capturedAt, event.capturedAt),
    null,
  );
  const ageMs = latestCapturedAt == null ? null : input.now - latestCapturedAt;
  const observed = sorted.length;
  const rejectedEvents = Math.max(0, input.rejectedEvents ?? 0);
  const coverageKnown = input.coverageKnown ?? true;
  return {
    observed,
    total: input.totalEvents,
    status:
      observed === 0
        ? input.totalEvents === 0 && rejectedEvents === 0
          ? 'not_captured'
          : 'partial'
        : !coverageKnown || rejectedEvents > 0 || observed < input.totalEvents
          ? 'partial'
          : 'complete',
    firstSequence: sorted[0]?.sequence ?? null,
    lastSequence: sorted.at(-1)?.sequence ?? null,
    latestCapturedAt,
    ageMs,
    freshness:
      latestCapturedAt == null
        ? 'not_captured'
        : latestCapturedAt > input.now
          ? 'future'
          : ageMs != null && ageMs <= RUNTIME_HINT_MAX_AGE_MS
            ? 'fresh'
            : 'stale',
  };
}

function suppressionFor(
  input: RuntimeHintInput,
  coverage: RuntimeHintCoverage,
): { reason: RuntimeHintSuppressionReason; detail: string } | null {
  if (!input.optIn) {
    return {
      reason: 'opt_in_required',
      detail: 'Runtime hints require an explicit opt-in request for each read.',
    };
  }
  if (coverage.status === 'not_captured') {
    return {
      reason: 'run_not_observed',
      detail: 'No Runtime events were observed for this run.',
    };
  }
  if (coverage.freshness === 'stale') {
    return {
      reason: 'stale_events',
      detail: 'The newest Runtime event is outside the bounded freshness window.',
    };
  }
  if (coverage.freshness === 'future') {
    return {
      reason: 'future_events',
      detail: 'Runtime event timestamps cannot be later than the server observation time.',
    };
  }
  if (coverage.status === 'partial') {
    return {
      reason: 'partial_event_coverage',
      detail: 'The bounded event window is incomplete, so no in-run hint is issued.',
    };
  }
  if (input.events.some((event) => event.kind === 'run_finished')) {
    return {
      reason: 'run_finished',
      detail: 'Completed Runs do not receive in-run hints.',
    };
  }
  if (
    input.historicalEvidence?.evaluationStatus !== 'ready' ||
    input.historicalEvidence?.primaryStatus !== 'descriptive'
  ) {
    return {
      reason: 'historical_evidence_insufficient',
      detail: 'A fresh ready historical comparison is required before issuing a Runtime hint.',
    };
  }
  if (input.lastIssuedAt != null && input.now - input.lastIssuedAt < RUNTIME_HINT_MIN_INTERVAL_MS) {
    return {
      reason: 'rate_limited',
      detail: 'Runtime hints are rate-limited per run to avoid influencing execution repeatedly.',
    };
  }
  if (input.events.filter(isToolFailure).length < 2) {
    return {
      reason: 'no_supported_signal',
      detail: 'No bounded repeated tool-failure signal met the hint threshold.',
    };
  }
  return null;
}

function isToolFailure(event: RuntimeHintEventSignal): boolean {
  return event.kind === 'tool_result' && (event.isError === true || event.status === 'failed');
}

function historicalEvidenceForHint(
  historical: RuntimeHintHistoricalEvidence | null,
): RuntimeHintEvidence['historical'] {
  if (!historical) throw new Error('historical evidence is required for an available hint');
  return {
    experimentId: historical.experimentId,
    cohortId: historical.cohortId,
    configurationRole: historical.configurationRole,
    profileGeneratedAt: historical.profileGeneratedAt,
    primaryMetric: historical.primaryMetric,
    primaryStatus: historical.primaryStatus,
    primaryRelativeDelta: historical.primaryRelativeDelta,
    guardrails: historical.guardrails,
  };
}

function reportLimitations(historical: RuntimeHintHistoricalEvidence | null): string[] {
  return [
    'This opt-in hint is a bounded hypothesis from local Runtime metadata and descriptive historical evidence; it is not a diagnosis, quality verdict, or causal configuration recommendation.',
    'The hint contains event and comparison references only; prompt, answer, thinking, tool input, and tool output content are not stored or returned.',
    ...(historical?.limitations ?? []),
  ];
}
