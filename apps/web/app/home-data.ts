import type { SessionSummary } from '@agent-profile/core';
import type { ImportJobStatus } from './config';
import type { StatsOverview, ToolFreq } from './dashboard';

interface JsonResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

type FetchJson = (url: string) => Promise<JsonResponse>;

export interface HomeStatsResponse {
  overview: StatsOverview;
  recentTools?: ToolFreq[];
  baseline?: { anomalySessions?: string[] };
}

export async function loadDashboardData(api: string, request: FetchJson = fetch) {
  const [sessionsResponse, statsResponse] = await Promise.all([
    request(`${api}/sessions`),
    request(`${api}/stats`),
  ]);
  if (!sessionsResponse.ok) throw new Error(`Sessions HTTP ${sessionsResponse.status}`);
  if (!statsResponse.ok) throw new Error(`Stats HTTP ${statsResponse.status}`);
  const [sessions, stats] = (await Promise.all([
    sessionsResponse.json(),
    statsResponse.json(),
  ])) as [SessionSummary[], HomeStatsResponse];
  return { sessions, stats };
}

export async function loadImportStatus(api: string, request: FetchJson = fetch) {
  const response = await request(`${api}/imports/status`);
  if (!response.ok) throw new Error(`Import status HTTP ${response.status}`);
  return (await response.json()) as ImportJobStatus;
}
