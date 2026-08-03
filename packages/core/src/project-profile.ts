export const PROJECT_PROFILE_SCHEMA_VERSION = 'project-profile/v1' as const;

export type ProjectEvidenceStatus = 'observed' | 'partial' | 'not_captured';

export interface ProjectProfileSessionSample {
  id: string;
  available: boolean;
  agent?: string | null;
  sourceKind?: string | null;
  startTime?: number | null;
  endTime?: number | null;
  inputTokens?: number | null;
  cacheCreationTokens?: number | null;
  cacheReadTokens?: number | null;
  outputTokens?: number | null;
  totalCost?: number | null;
  costUnknownCount?: number | null;
  cacheHitRate?: number | null;
  peakContextTokens?: number | null;
}

export interface ProjectProfileToolSample {
  sessionId: string;
  name: string;
  startTime?: number | null;
  isError: boolean;
}

export interface ProjectProfileInput {
  project: { key: string; label: string };
  sessions: ProjectProfileSessionSample[];
  tools: ProjectProfileToolSample[];
  sampled?: boolean;
  toolSampled?: boolean;
  range?: { from: number | null; to: number | null };
  generatedAt?: number;
}

interface ProjectProfileMetricCoverage {
  observed: number;
  total: number;
  ratio: number;
}

interface ProjectProfileEvidenceCoverage {
  status: ProjectEvidenceStatus;
  sessions: number;
  limitation?: string;
}

export interface ProjectProfileReport {
  schemaVersion: typeof PROJECT_PROFILE_SCHEMA_VERSION;
  generatedAt: number;
  project: { key: string; label: string };
  scope: {
    from: number | null;
    to: number | null;
    linkedSessions: number;
    availableSessions: number;
    sampled: boolean;
    agents: Array<{ agent: string; sessions: number }>;
    sources: Array<{ sourceKind: string; sessions: number; observed: boolean }>;
  };
  metrics: {
    totalTokens: number;
    totalCost: number;
    costCoverage: ProjectProfileMetricCoverage;
    cacheHitRate: number | null;
    cacheHitCoverage: ProjectProfileMetricCoverage;
    peakContextTokens: number | null;
    peakContextCoverage: ProjectProfileMetricCoverage;
    durationMs: number | null;
    durationCoverage: ProjectProfileMetricCoverage;
    toolCalls: number;
    toolErrors: number;
    toolErrorRate: number | null;
  };
  tools: Array<{ name: string; calls: number; errors: number; sessions: number }>;
  trends: Array<{
    day: string;
    sessions: number;
    tokens: number;
    cost: number;
    costCoverage: number;
    toolCalls: number;
    toolErrors: number;
  }>;
  coverage: {
    sessions: ProjectProfileMetricCoverage & { sampled: boolean };
    sources: ProjectProfileMetricCoverage;
    resources: ProjectProfileEvidenceCoverage;
    tools: ProjectProfileEvidenceCoverage;
    files: ProjectProfileEvidenceCoverage;
  };
  limitations: string[];
}

export function buildProjectProfile(input: ProjectProfileInput): ProjectProfileReport {
  const available = input.sessions.filter((session) => session.available);
  const knownCost = available.filter((session) => (session.costUnknownCount ?? 0) === 0);
  const cacheSamples = available.filter((session) => session.cacheHitRate != null);
  const contextSamples = available.filter((session) => session.peakContextTokens != null);
  const durationValues = available
    .map((session) =>
      session.startTime != null && session.endTime != null
        ? session.endTime - session.startTime
        : null,
    )
    .filter((value): value is number => value != null);
  const sourceCounts = countBy(available, (session) => session.sourceKind?.trim() || 'unknown');
  const agentCounts = countBy(available, (session) => session.agent?.trim() || 'unknown');
  const toolMap = new Map<string, { calls: number; errors: number; sessions: Set<string> }>();
  const trendMap = new Map<
    string,
    {
      sessions: number;
      tokens: number;
      cost: number;
      knownCost: number;
      tools: number;
      errors: number;
    }
  >();

  for (const tool of input.tools) {
    const current = toolMap.get(tool.name) ?? { calls: 0, errors: 0, sessions: new Set<string>() };
    current.calls += 1;
    current.errors += tool.isError ? 1 : 0;
    current.sessions.add(tool.sessionId);
    toolMap.set(tool.name, current);
  }
  for (const session of available) {
    const day = toDay(session.startTime);
    if (!day) continue;
    const current = trendMap.get(day) ?? {
      sessions: 0,
      tokens: 0,
      cost: 0,
      knownCost: 0,
      tools: 0,
      errors: 0,
    };
    current.sessions += 1;
    current.tokens += sessionTokens(session);
    if ((session.costUnknownCount ?? 0) === 0 && session.totalCost != null) {
      current.cost += session.totalCost;
      current.knownCost += 1;
    }
    trendMap.set(day, current);
  }
  for (const tool of input.tools) {
    const day = toDay(tool.startTime);
    const current = day ? trendMap.get(day) : undefined;
    if (current) {
      current.tools += 1;
      current.errors += tool.isError ? 1 : 0;
    }
  }

  const toolCalls = input.tools.length;
  const toolErrors = input.tools.filter((tool) => tool.isError).length;
  const toolSessionCount = new Set(input.tools.map((tool) => tool.sessionId)).size;
  const sourceObserved = available.filter((session) => Boolean(session.sourceKind?.trim())).length;
  const resourceObserved = available.filter(
    (session) =>
      session.inputTokens != null ||
      session.cacheCreationTokens != null ||
      session.cacheReadTokens != null ||
      session.outputTokens != null ||
      session.peakContextTokens != null,
  ).length;
  const limitations: string[] = [];
  if (input.sampled) {
    limitations.push('Session scope is sampled; aggregates describe the selected local sample.');
  }
  if (input.toolSampled) {
    limitations.push('Tool evidence is sampled; tool counts are lower bounds for this scope.');
  }
  if (sourceObserved < available.length) {
    limitations.push('Some Sessions have no captured source kind; source coverage is partial.');
  }
  if (knownCost.length < available.length) {
    limitations.push('Unknown-pricing Sessions are excluded from trusted cost totals.');
  }
  if (input.tools.length === 0) {
    limitations.push('No normalized tool-call evidence was captured for this scope.');
  }
  limitations.push(
    'File-level evidence is not normalized; this report does not claim repository coverage.',
  );
  limitations.push(
    'Process metrics describe observed behavior and do not prove delivery quality or causality.',
  );

  return {
    schemaVersion: PROJECT_PROFILE_SCHEMA_VERSION,
    generatedAt: input.generatedAt ?? Date.now(),
    project: input.project,
    scope: {
      from: input.range?.from ?? null,
      to: input.range?.to ?? null,
      linkedSessions: input.sessions.length,
      availableSessions: available.length,
      sampled: Boolean(input.sampled),
      agents: [...agentCounts.entries()]
        .map(([agent, sessions]) => ({ agent, sessions }))
        .sort(
          (left, right) => right.sessions - left.sessions || left.agent.localeCompare(right.agent),
        ),
      sources: [...sourceCounts.entries()]
        .map(([sourceKind, sessions]) => ({
          sourceKind,
          sessions,
          observed: sourceKind !== 'unknown',
        }))
        .sort(
          (left, right) =>
            right.sessions - left.sessions || left.sourceKind.localeCompare(right.sourceKind),
        ),
    },
    metrics: {
      totalTokens: available.reduce((sum, session) => sum + sessionTokens(session), 0),
      totalCost: knownCost.reduce((sum, session) => sum + (session.totalCost ?? 0), 0),
      costCoverage: coverage(knownCost.length, available.length),
      cacheHitRate: average(cacheSamples.map((session) => session.cacheHitRate as number)),
      cacheHitCoverage: coverage(cacheSamples.length, available.length),
      peakContextTokens: average(
        contextSamples.map((session) => session.peakContextTokens as number),
      ),
      peakContextCoverage: coverage(contextSamples.length, available.length),
      durationMs: durationValues.length
        ? durationValues.reduce((sum, value) => sum + value, 0)
        : null,
      durationCoverage: coverage(durationValues.length, available.length),
      toolCalls,
      toolErrors,
      toolErrorRate: toolCalls > 0 ? toolErrors / toolCalls : null,
    },
    tools: [...toolMap.entries()]
      .map(([name, stat]) => ({
        name,
        calls: stat.calls,
        errors: stat.errors,
        sessions: stat.sessions.size,
      }))
      .sort((left, right) => right.calls - left.calls || left.name.localeCompare(right.name)),
    trends: [...trendMap.entries()]
      .map(([day, trend]) => ({
        day,
        sessions: trend.sessions,
        tokens: trend.tokens,
        cost: trend.cost,
        costCoverage: trend.sessions > 0 ? trend.knownCost / trend.sessions : 0,
        toolCalls: trend.tools,
        toolErrors: trend.errors,
      }))
      .sort((left, right) => left.day.localeCompare(right.day)),
    coverage: {
      sessions: {
        ...coverage(available.length, input.sessions.length),
        sampled: Boolean(input.sampled),
      },
      sources: coverage(sourceObserved, available.length),
      resources: evidenceCoverage(resourceObserved, available.length),
      tools: evidenceCoverage(toolSessionCount, available.length),
      files: {
        status: 'not_captured',
        sessions: 0,
        limitation: 'File-level evidence is not part of the normalized Session contract.',
      },
    },
    limitations,
  };
}

function sessionTokens(session: ProjectProfileSessionSample): number {
  return (
    (session.inputTokens ?? 0) +
    (session.cacheCreationTokens ?? 0) +
    (session.cacheReadTokens ?? 0) +
    (session.outputTokens ?? 0)
  );
}

function countBy(
  sessions: ProjectProfileSessionSample[],
  key: (session: ProjectProfileSessionSample) => string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const session of sessions) counts.set(key(session), (counts.get(key(session)) ?? 0) + 1);
  return counts;
}

function coverage(observed: number, total: number): ProjectProfileMetricCoverage {
  return { observed, total, ratio: total > 0 ? observed / total : 0 };
}

function evidenceCoverage(observed: number, total: number): ProjectProfileEvidenceCoverage {
  return {
    status: observed === 0 ? 'not_captured' : observed < total ? 'partial' : 'observed',
    sessions: observed,
    limitation: observed < total ? 'Evidence is missing for some Sessions.' : undefined,
  };
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function toDay(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}
