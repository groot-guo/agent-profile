import type {
  ImportOperation,
  ImportSourceId,
  ImportSourceState,
  ImportSourceStatusResponse,
  ProjectScope,
} from './common';

export const CLI_SCHEMA_VERSION = 'agent-profile-cli/v1';
export const CLI_DIAGNOSIS_SCHEMA_VERSION = 'cli-diagnosis/v1';
export const CLI_EVIDENCE_SCHEMA_VERSION = 'cli-evidence/v1';

export type CliCommand =
  | 'help'
  | 'version'
  | 'doctor'
  | 'sources'
  | 'sync'
  | 'serve'
  | 'sessions'
  | 'stats'
  | 'profiles'
  | 'task-profile'
  | 'diagnosis'
  | 'evidence'
  | 'task-outcome'
  | 'task-feedback';

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
  scope?: ProjectScope;
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
  scope?: ProjectScope;
  limitations: string[];
}

export interface CliSyncReport {
  schemaVersion: typeof CLI_SCHEMA_VERSION;
  command: 'sync';
  requestedSources: ImportSourceId[];
  imports: CliImportStatus;
  sources: ImportSourceStatusResponse[];
  scope?: ProjectScope;
  limitations: string[];
}

export interface CliServeReport {
  schemaVersion: typeof CLI_SCHEMA_VERSION;
  command: 'serve';
  url: string;
  apiUrl: string;
  databasePath: string;
  host: string;
  port: number;
  scope?: ProjectScope;
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
  scope?: ProjectScope;
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
    kind:
      | 'model'
      | 'provider_only'
      | 'runtime_mode'
      | 'synthetic'
      | 'opaque'
      | 'review_required'
      | 'unknown';
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
      kind:
        | 'model'
        | 'provider_only'
        | 'runtime_mode'
        | 'synthetic'
        | 'opaque'
        | 'review_required'
        | 'unknown';
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
  scope?: ProjectScope;
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
  scope?: ProjectScope;
  limitations: string[];
}

export interface CliTaskProfileData {
  schemaVersion: string;
  generatedAt: number;
  task: {
    id: string;
    title: string;
    type: string;
    status: 'planned' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  };
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

export interface CliDiagnosisFindingReference {
  type: string;
  severity: 'high' | 'medium' | 'low';
  wastedTokens: number;
  wastedCost: number;
  costUnknown: boolean;
  spanIds: string[];
}

export interface CliDiagnosisReport {
  schemaVersion: typeof CLI_SCHEMA_VERSION;
  command: 'diagnosis';
  sessionId: string;
  diagnosis: {
    schemaVersion: typeof CLI_DIAGNOSIS_SCHEMA_VERSION;
    generatedAt: number;
    session: { id: string; agent: string; startTime: number; endTime: number | null };
    findings: CliDiagnosisFindingReference[];
    totalWastedTokens: number;
    totalWastedCost: number;
    costUnknownCount: number;
    semantic: {
      requested: boolean;
      consent: 'not_granted' | 'granted';
      status: 'not_requested' | 'not_configured' | 'insufficient_evidence' | 'completed' | 'failed';
      provider: 'anthropic' | 'openai' | null;
      audit: {
        recorded: boolean;
        retention: 'process_bounded_content_free';
        rawContentStored: false;
      };
    };
    limitations: string[];
  };
  limitations: string[];
}

export type CliEvidenceSpanType = 'llm_turn' | 'tool_call' | 'thinking' | 'answer';
export type CliEvidenceLane = 'main' | 'sidechain';
export type CliEvidenceOutcome = 'observed_error' | 'no_error_observed' | 'not_applicable';
export type CliEvidenceParentLink =
  | 'root'
  | 'linked'
  | 'missing_parent'
  | 'cross_session'
  | 'source_user'
  | 'corrupted_ownership'
  | 'not_captured';

export interface CliEvidenceCoverage {
  observed: number;
  total: number;
  coverage: number | null;
  status: 'available' | 'partial' | 'complete' | 'not_captured' | 'not_applicable';
}

export interface CliEvidenceReference {
  sequence: number;
  id: string;
  parentId: string | null;
  parentLink: CliEvidenceParentLink;
  type: CliEvidenceSpanType;
  lane: CliEvidenceLane;
  outcome: CliEvidenceOutcome;
  startTime: number;
  endTime: number | null;
  durationMs: number | null;
}

export interface CliEvidenceReport {
  schemaVersion: typeof CLI_SCHEMA_VERSION;
  command: 'evidence';
  sessionId: string;
  evidence: {
    schemaVersion: typeof CLI_EVIDENCE_SCHEMA_VERSION;
    generatedAt: number;
    session: { id: string; agent: string; startTime: number; endTime: number | null };
    scope: { events: number; returnedReferences: number };
    coverage: {
      timing: CliEvidenceCoverage;
      parentLinks: CliEvidenceCoverage;
      toolInputs: CliEvidenceCoverage;
      toolOutputs: CliEvidenceCoverage;
      modelIdentity: CliEvidenceCoverage;
      content: CliEvidenceCoverage;
    };
    privacy: {
      contentMode: 'none';
      previewCharacters: 0;
      secretRedaction: true;
      rawContentIncluded: false;
    };
    references: CliEvidenceReference[];
    limitations: string[];
  };
  limitations: string[];
}

export type CliOutcomeEvidenceStatus =
  | 'not_captured'
  | 'observed'
  | 'passed'
  | 'failed'
  | 'skipped'
  | 'not_run';
export type CliOutcomeEvidenceSource = 'local_session' | 'local_git';

export interface CliTaskOutcomeReport {
  schemaVersion: typeof CLI_SCHEMA_VERSION;
  command: 'task-outcome';
  taskId: string;
  saved: {
    evidenceCount: number;
    kind: string;
    status: CliOutcomeEvidenceStatus | null;
    coverage: {
      observedFields: number;
      totalFields: number;
      status: 'not_collected' | 'partial' | 'verified';
    };
  };
  limitations: string[];
}

export interface CliTaskFeedbackReport {
  schemaVersion: typeof CLI_SCHEMA_VERSION;
  command: 'task-feedback';
  taskId: string;
  feedback: Array<Record<string, unknown>>;
  limitations: string[];
}

export type CliReport =
  | CliHelpReport
  | CliVersionReport
  | CliDoctorReport
  | CliSourcesReport
  | CliSyncReport
  | CliServeReport
  | CliSessionsReport
  | CliStatsReport
  | CliProfilesReport
  | CliTaskProfileReport
  | CliDiagnosisReport
  | CliEvidenceReport
  | CliTaskOutcomeReport
  | CliTaskFeedbackReport;
