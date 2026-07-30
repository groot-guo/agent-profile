export const SESSION_DISCOVERY_SCHEMA_VERSION = 'session-discovery/v1';

export type SessionDiscoverySort = 'time' | 'cost' | 'tokens' | 'cache' | 'duration';
export type SessionDiscoveryQuickView = 'all' | 'anomaly' | 'unpriced';
export type SessionDiscoveryTimeRange = 'all' | '1d' | '7d' | '30d' | '90d';

export interface SessionDiscoveryItem {
  id: string;
  agent: string;
  project: string;
  startTime: number;
  endTime: number | null;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  totalCost: number;
  costUnknownCount: number;
  costCurrency: string;
  peakContextTokens: number;
  avgContextTokens: number;
  cacheHitRate: number;
  messageCount: number;
  importedAt: number;
  isAnomaly: boolean;
}

export interface SessionDiscoveryPage {
  schemaVersion: typeof SESSION_DISCOVERY_SCHEMA_VERSION;
  query: {
    agent: string | null;
    project: string | null;
    query: string;
    timeRange: SessionDiscoveryTimeRange;
    sort: SessionDiscoverySort;
    quickView: SessionDiscoveryQuickView;
  };
  counts: {
    matched: number;
    total: number;
  };
  page: {
    limit: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
  facets: {
    agents: Array<{ agent: string; count: number }>;
    projects: Array<{ project: string; count: number; lastUsedAt: number }>;
  };
  sessions: SessionDiscoveryItem[];
  selectedSession: SessionDiscoveryItem | null;
}
