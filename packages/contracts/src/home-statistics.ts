export const HOME_STATISTICS_SCHEMA_VERSION = 'home-statistics/v1';

export interface HomeSessionHighlight {
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
}

export interface HomeStatisticsResponse {
  schemaVersion: typeof HOME_STATISTICS_SCHEMA_VERSION;
  overview: {
    totalSessions: number;
    totalTokens: number;
    totalCost: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    avgCacheHitRate: number;
    avgPeakContext: number;
    sessionsWithCostUnknown: number;
    sessionsWithKnownCost: number;
    sessionsExcluded: number;
  };
  recentTools: Array<{ name: string; count: number; errors: number }>;
  topByCost: HomeSessionHighlight[];
  topByTokens: HomeSessionHighlight[];
}
