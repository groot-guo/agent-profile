import type { ProjectProfileReport } from '@agent-profile/core';

export type ProjectProfileRange = 'all' | '7d' | '30d' | '90d';

export type ProjectPageCoverageStatus = 'complete' | 'not_applicable' | 'not_captured' | 'partial';

export interface ProjectPageMetricCoverage {
  observed: number;
  total: number;
  coverage: number | null;
  status: ProjectPageCoverageStatus;
}

export interface ProjectPageReport {
  schemaVersion: string;
  scope: {
    project: string;
    sessions: number;
    timeRange: { startTime: number | null; endTime: number | null };
    sourceCoverage: Array<{ source: string; sessions: number }>;
  };
  resources: { totalTokens: number; totalCost: number; averageDurationMs: number | null };
  reliability: { toolCalls: number; observedToolErrors: number };
  coverage: {
    cost: ProjectPageMetricCoverage;
    duration: ProjectPageMetricCoverage;
    tool: ProjectPageMetricCoverage;
    file: ProjectPageMetricCoverage;
  };
  tools: Array<{ name: string; calls: number; errors: number }>;
  trends: {
    points: Array<{
      startTime: number;
      endTime: number;
      sessions: number;
      totalTokens: number;
      totalCost: number;
      costCoverage: ProjectPageMetricCoverage;
      tool: { calls: number; observedErrors: number; sessionCoverage: number | null };
    }>;
  };
  limitations: string[];
}

export function projectProfileUrl(
  api: string,
  project: string,
  range: ProjectProfileRange,
  now = Date.now(),
): string {
  const query = [`project=${encodeURIComponent(project)}`];
  if (range !== 'all') {
    const days = Number.parseInt(range, 10);
    query.push(`from=${now - days * 86_400_000}`, `to=${now}`);
  }
  return `${api}/projects/profile?${query.join('&')}`;
}

export function projectProfileUpdateState(
  currentVersion: number,
  receivedVersion: number,
): { version: number; shouldRefresh: boolean } {
  if (receivedVersion <= currentVersion) {
    return { version: currentVersion, shouldRefresh: false };
  }
  return { version: receivedVersion, shouldRefresh: true };
}

export function normalizeProjectProfileReport(report: ProjectProfileReport): ProjectPageReport {
  const totalSessions = report.scope.availableSessions;
  const trendPoints = report.trends.map((trend) => {
    const startTime = Date.parse(`${trend.day}T00:00:00.000Z`);
    return {
      startTime,
      endTime: startTime + 86_400_000,
      sessions: trend.sessions,
      totalTokens: trend.tokens,
      totalCost: trend.cost,
      costCoverage: metricCoverage(Math.round(trend.costCoverage * trend.sessions), trend.sessions),
      tool: {
        calls: trend.toolCalls,
        observedErrors: trend.toolErrors,
        sessionCoverage: null,
      },
    };
  });
  const firstTrend = trendPoints[0];
  const lastTrend = trendPoints[trendPoints.length - 1];
  return {
    schemaVersion: report.schemaVersion,
    scope: {
      project: report.project.key,
      sessions: report.scope.linkedSessions,
      timeRange: {
        startTime: firstTrend?.startTime ?? report.scope.from,
        endTime: lastTrend?.endTime ?? report.scope.to,
      },
      sourceCoverage: report.scope.sources.map((source) => ({
        source: source.sourceKind,
        sessions: source.sessions,
      })),
    },
    resources: {
      totalTokens: report.metrics.totalTokens,
      totalCost: report.metrics.totalCost,
      averageDurationMs:
        report.metrics.durationMs != null && report.metrics.durationCoverage.observed > 0
          ? report.metrics.durationMs / report.metrics.durationCoverage.observed
          : null,
    },
    reliability: {
      toolCalls: report.metrics.toolCalls,
      observedToolErrors: report.metrics.toolErrors,
    },
    coverage: {
      cost: metricCoverage(report.metrics.costCoverage.observed, report.metrics.costCoverage.total),
      duration: metricCoverage(
        report.metrics.durationCoverage.observed,
        report.metrics.durationCoverage.total,
      ),
      tool: evidenceCoverage(report.coverage.tools.sessions, totalSessions),
      file: evidenceCoverage(report.coverage.files.sessions, totalSessions),
    },
    tools: report.tools.map(({ name, calls, errors }) => ({ name, calls, errors })),
    trends: { points: trendPoints },
    limitations: report.limitations,
  };
}

function metricCoverage(observed: number, total: number): ProjectPageMetricCoverage {
  if (total === 0) return { observed: 0, total: 0, coverage: null, status: 'not_applicable' };
  return {
    observed,
    total,
    coverage: observed / total,
    status: observed === 0 ? 'not_captured' : observed === total ? 'complete' : 'partial',
  };
}

function evidenceCoverage(observed: number, total: number): ProjectPageMetricCoverage {
  return metricCoverage(observed, total);
}
