import type { SessionDiscoveryItem, SessionDiscoveryPage } from '@agent-profile/contracts';

export const TASK_SESSION_SEARCH_LIMIT = 50;

interface JsonResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

type FetchJson = (url: string, init?: RequestInit) => Promise<JsonResponse>;

export interface TaskSessionSearchResult {
  sessions: SessionDiscoveryItem[];
  matched: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export async function searchTaskSessions(
  api: string,
  query: string,
  cursor: string | undefined,
  request: FetchJson = fetch,
): Promise<TaskSessionSearchResult> {
  const params = new URLSearchParams({ limit: String(TASK_SESSION_SEARCH_LIMIT) });
  const normalized = query.trim();
  if (normalized) params.set('q', normalized);
  if (cursor) params.set('cursor', cursor);

  const response = await request(`${api}/session-discovery?${params}`);
  if (!response.ok) throw new Error(`Task session discovery HTTP ${response.status}`);
  const page = (await response.json()) as SessionDiscoveryPage;
  return {
    sessions: page.sessions,
    matched: page.counts.matched,
    hasMore: page.page.hasMore,
    nextCursor: page.page.nextCursor,
  };
}
