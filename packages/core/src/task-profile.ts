export const TASK_PROFILE_SCHEMA_VERSION = 'task-profile/v1' as const;

export type TaskStatus = 'planned' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
export type VerificationStatus = 'passed' | 'failed' | 'skipped' | 'not_run';

export type TaskEvidenceSource = 'local_session' | 'local_git';
export type OutcomeEvidenceStatus = 'not_captured' | 'observed' | VerificationStatus;

export interface TaskEvidenceProvenance {
  producer: string;
  capturedAt: number;
  source: TaskEvidenceSource;
  sourceId: string;
  basis: string;
}

export interface TaskOutcomeEvidence {
  kind: string;
  status?: OutcomeEvidenceStatus;
  reference?: string;
  provenance?: TaskEvidenceProvenance;
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

export type TaskGraphEdgeKind = 'source_parent';

export interface TaskGraphEdge {
  /** Child Session id (the requester of the relationship). */
  from: string;
  /** Parent Session id (the relationship target). */
  to: string;
  kind: TaskGraphEdgeKind;
  /** Source that captured the relationship, e.g. `codex`. */
  source: string;
  /** Whether the counterpart Session row exists in storage. */
  counterpartAvailable: boolean;
  /** Whether the counterpart is also linked to this Task. */
  counterpartLinked: boolean;
}

export interface TaskGraphNode {
  id: string;
  available: boolean;
  role: TaskProfileSessionSample['role'];
  agent?: string;
}

export interface TaskGraphAttribution {
  agent: string;
  linkedSessions: number;
  availableSessions: number;
  totalTokens: number;
  totalCost: number;
  costUnknownCount: number;
  toolCalls: number;
  toolErrors: number;
}

export interface TaskGraphCoverage {
  relationships: {
    captured: number;
    partial: number;
    absent: number;
  };
}

export interface TaskGraph {
  nodes: TaskGraphNode[];
  edges: TaskGraphEdge[];
  attribution: TaskGraphAttribution[];
  coverage: TaskGraphCoverage;
}

export interface TaskProfileInput {
  task: TaskProfileTask;
  configurations: TaskProfileConfiguration[];
  sessions: TaskProfileSessionSample[];
  relationships?: TaskGraphEdge[];
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
  graph: TaskGraph;
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
  const relationships = input.relationships ?? [];
  const linkedIds = new Set(input.sessions.map((session) => session.id));
  const graphEdges = relationships
    .filter((edge) => linkedIds.has(edge.from) || linkedIds.has(edge.to))
    .map((edge) => ({
      ...edge,
      counterpartLinked: linkedIds.has(edge.from) && linkedIds.has(edge.to),
    }));
  const attributionByAgent = new Map<string, TaskGraphAttribution>();
  for (const session of input.sessions) {
    if (!session.agent) continue;
    const entry = attributionByAgent.get(session.agent) ?? {
      agent: session.agent,
      linkedSessions: 0,
      availableSessions: 0,
      totalTokens: 0,
      totalCost: 0,
      costUnknownCount: 0,
      toolCalls: 0,
      toolErrors: 0,
    };
    entry.linkedSessions += 1;
    if (session.available) {
      entry.availableSessions += 1;
      entry.totalTokens +=
        (session.inputTokens ?? 0) +
        (session.cacheCreationTokens ?? 0) +
        (session.cacheReadTokens ?? 0) +
        (session.outputTokens ?? 0);
      entry.totalCost += session.totalCost ?? 0;
      entry.costUnknownCount += session.costUnknownCount ?? 0;
      entry.toolCalls += session.toolCalls ?? 0;
      entry.toolErrors += session.toolErrors ?? 0;
    }
    attributionByAgent.set(session.agent, entry);
  }
  const attribution = [...attributionByAgent.values()].sort((a, b) =>
    a.agent.localeCompare(b.agent),
  );
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
  const nodeWithEdge = new Set<string>();
  for (const edge of graphEdges) {
    nodeWithEdge.add(edge.from);
    nodeWithEdge.add(edge.to);
  }
  const partialEdges = graphEdges.filter(
    (edge) => !edge.counterpartAvailable || !edge.counterpartLinked,
  ).length;
  const absentNodes = input.sessions.filter((session) => !nodeWithEdge.has(session.id)).length;
  const graph: TaskGraph = {
    nodes: input.sessions.map((session) => ({
      id: session.id,
      available: session.available,
      role: session.role,
      agent: session.agent,
    })),
    edges: graphEdges,
    attribution,
    coverage: {
      relationships: {
        captured: graphEdges.length,
        partial: partialEdges,
        absent: absentNodes,
      },
    },
  };
  if (graphEdges.some((edge) => !edge.counterpartAvailable)) {
    limitations.push(
      'One or more Task graph edges reference a Session whose stored row is unavailable after local data reset or source changes.',
    );
  }
  if (graphEdges.some((edge) => !edge.counterpartLinked)) {
    limitations.push(
      'One or more Task graph edges reference a Session outside the Task; the counterpart is not linked, so combined attribution cannot include it.',
    );
  }
  if (absentNodes > 0) {
    limitations.push(
      'One or more linked Sessions have no stored source-native relationship; the Task graph cannot distinguish parent/child evidence for those Sessions.',
    );
  }
  if (graphEdges.length > 0) {
    limitations.push(
      'Task graph edges come only from explicit Task links and source-native relationships; child Sessions are never merged into a parent twice.',
    );
  }
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
    graph,
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
