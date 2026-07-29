import type {
  ImportOperation,
  ImportSourceId,
  ImportSourceState,
  ImportSourceStatusResponse,
} from './common';

export const CLI_SCHEMA_VERSION = 'agent-profile-cli/v1';

export type CliCommand =
  | 'help'
  | 'version'
  | 'doctor'
  | 'sources'
  | 'sync'
  | 'sessions'
  | 'stats'
  | 'profiles'
  | 'task-profile';

export interface CliHelpReport {
  schemaVersion: typeof CLI_SCHEMA_VERSION;
  command: 'help';
  usage: string;
  commands: CliCommand[];
}

export interface CliVersionReport {
  schemaVersion: typeof CLI_SCHEMA_VERSION;
  command: 'version';
  version: string;
}

export interface CliDoctorSource {
  id: ImportSourceId;
  label: string;
  available: boolean;
  state: ImportSourceState;
}

export interface CliDoctorReport {
  schemaVersion: typeof CLI_SCHEMA_VERSION;
  command: 'doctor';
  database: {
    path: string;
    existedBeforeRuntime: boolean;
  };
  imports: {
    active: boolean;
  };
  sources: CliDoctorSource[];
  limitations: string[];
}

export interface CliImportStatus {
  jobId: string | null;
  active: boolean;
  operation: ImportOperation | null;
}

export interface CliSourcesReport {
  schemaVersion: typeof CLI_SCHEMA_VERSION;
  command: 'sources';
  imports: CliImportStatus;
  sources: ImportSourceStatusResponse[];
  limitations: string[];
}

export interface CliSyncReport {
  schemaVersion: typeof CLI_SCHEMA_VERSION;
  command: 'sync';
  requestedSources: ImportSourceId[];
  imports: CliImportStatus;
  sources: ImportSourceStatusResponse[];
  limitations: string[];
}

export interface CliSessionSummary {
  id: string;
  agent: string;
  startTime: number;
  endTime: number | null;
  gitBranch: string | null;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  totalCost: number;
  costUnknownCount: number;
  costCurrency: string | null;
  peakContextTokens: number;
  avgContextTokens: number;
  cacheHitRate: number;
  messageCount: number;
  importedAt: number;
}

export interface CliSessionDiscoveryPage {
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
  sessions: CliSessionSummary[];
}

export interface CliSessionsReport extends CliSessionDiscoveryPage {
  schemaVersion: typeof CLI_SCHEMA_VERSION;
  command: 'sessions';
  limitations: string[];
}

export interface CliStatsData {
  overview: {
    totalSessions: number;
    totalTokens: number;
    totalCost: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    avgCacheHitRate: number;
    avgPeakContext: number;
    sessionsWithCostUnknown: number;
  };
  byAgent: {
    agent: string;
    sessions: number;
    totalTokens: number;
    totalCost: number;
    avgCacheHitRate: number;
  }[];
  byProject: { cwd: string; sessions: number; totalTokens: number; totalCost: number }[];
  byModel: {
    model: string;
    kind: 'model' | 'provider_only' | 'unknown';
    rawModels: string[];
    sessions: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCost: number;
  }[];
  recentTools: { name: string; count: number; errors: number }[];
  distribution: {
    costBins: { bin: string; min: number; max: number | null; count: number }[];
    tokenBins: { bin: string; min: number; max: number | null; count: number }[];
    modelDistribution: {
      model: string;
      kind: 'model' | 'provider_only' | 'unknown';
      rawModels: string[];
      count: number;
      tokens: number;
    }[];
    agentDistribution: { agent: string; count: number; tokens: number }[];
  };
  baseline?: {
    projects: Record<
      string,
      {
        sessions: number;
        avgCost: number;
        medCost: number;
        p95Cost: number;
        avgTokens: number;
        avgCacheHit: number;
      }
    >;
    anomalySessions: string[];
  };
  trends?: { day: string; tokens: number; cost: number; sessions: number; avgCacheHit: number }[];
}

export interface CliStatsReport {
  schemaVersion: typeof CLI_SCHEMA_VERSION;
  command: 'stats';
  statistics: CliStatsData;
  limitations: string[];
}

export interface CliAgentProfilesData {
  schemaVersion: string;
  generatedAt: number;
  scope: { agents: string[]; sessions: number };
  comparison: { status: 'ready' | 'insufficient_data' };
  profiles: unknown[];
  limitations: string[];
}

export interface CliProfilesReport {
  schemaVersion: typeof CLI_SCHEMA_VERSION;
  command: 'profiles';
  agentProfiles: CliAgentProfilesData;
  limitations: string[];
}

export interface CliTaskProfileData {
  schemaVersion: string;
  generatedAt: number;
  task: { id: string; title: string };
  profile: { linkedSessions: number; availableSessions: number };
  coverage: {
    outcome: { status: 'not_collected' | 'partial' | 'verified' };
  };
  limitations: string[];
}

export interface CliTaskProfileReport {
  schemaVersion: typeof CLI_SCHEMA_VERSION;
  command: 'task-profile';
  taskId: string;
  taskProfile: CliTaskProfileData;
  limitations: string[];
}

export type CliReport =
  | CliHelpReport
  | CliVersionReport
  | CliDoctorReport
  | CliSourcesReport
  | CliSyncReport
  | CliSessionsReport
  | CliStatsReport
  | CliProfilesReport
  | CliTaskProfileReport;
