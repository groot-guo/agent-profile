import type {
  HomeStatisticsResponse,
  SessionDiscoveryPage,
  SessionUpdatesResponse,
} from '@agent-profile/contracts';
import type { ImportJobStatus } from './config';
import type { SessionNavigationState } from './session-navigation';

interface JsonResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

type FetchJson = (url: string, init?: RequestInit) => Promise<JsonResponse>;

export const HOME_SESSION_PAGE_LIMIT = 120;

export async function loadSessionDiscovery(
  api: string,
  state: SessionNavigationState,
  cursor?: string,
  request: FetchJson = fetch,
): Promise<SessionDiscoveryPage> {
  const params = new URLSearchParams({ limit: String(HOME_SESSION_PAGE_LIMIT) });
  if (state.agent !== 'all') params.set('agent', state.agent);
  if (state.project) params.set('project', state.project);
  if (state.query) params.set('q', state.query);
  if (state.timeRange !== 'all') params.set('range', state.timeRange);
  if (state.sort !== 'time') params.set('sort', state.sort);
  if (state.quickView !== 'all') params.set('view', state.quickView);
  if (state.selectedId) params.set('selected', state.selectedId);
  if (cursor) params.set('cursor', cursor);

  const response = await request(`${api}/session-discovery?${params}`);
  if (!response.ok) throw new Error(`Session discovery HTTP ${response.status}`);
  return (await response.json()) as SessionDiscoveryPage;
}

export async function loadHomeStatistics(
  api: string,
  request: FetchJson = fetch,
): Promise<HomeStatisticsResponse> {
  const response = await request(`${api}/home-statistics`);
  if (!response.ok) throw new Error(`Home statistics HTTP ${response.status}`);
  return (await response.json()) as HomeStatisticsResponse;
}

export async function loadImportStatus(
  api: string,
  request: FetchJson = fetch,
): Promise<ImportJobStatus> {
  const response = await request(`${api}/imports/status`);
  if (!response.ok) throw new Error(`Import status HTTP ${response.status}`);
  return (await response.json()) as ImportJobStatus;
}

export async function waitForSessionUpdates(
  api: string,
  after: number,
  signal: AbortSignal,
  request: FetchJson = fetch,
): Promise<SessionUpdatesResponse> {
  const params = new URLSearchParams({ after: String(after), wait: '25000' });
  const response = await request(`${api}/session-updates?${params}`, { signal });
  if (!response.ok) throw new Error(`Session updates HTTP ${response.status}`);
  return (await response.json()) as SessionUpdatesResponse;
}
