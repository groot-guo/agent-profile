export interface HealthResponse {
  ok: boolean;
  uptime: number;
}

export type ImportSourceId = 'claude-code' | 'codex' | 'zed' | 'mimo-code' | 'opencode';
export type ImportSourceState = 'idle' | 'scanning' | 'completed' | 'failed';
export type ImportOperation = 'sync' | 'rebuild';
export type ScanSkipReason = 'unchanged_revision' | 'not_importable' | 'excluded_non_actionable';

export interface PublicScanResult {
  scanned: number;
  imported: number;
  skipped: number;
  updated: number;
  removed: number;
  failed: number;
  protectedAnnotatedSessions: number;
  skipReasons: Record<ScanSkipReason, number>;
}

export interface ImportSourceStatusResponse {
  id: ImportSourceId;
  label: string;
  available: boolean;
  state: ImportSourceState;
  result: PublicScanResult | null;
  startedAt: number | null;
  completedAt: number | null;
  error: 'source_scan_failed' | null;
  storedSessions: number;
}

export interface ImportJobStatusResponse {
  jobId: string | null;
  active: boolean;
  operation: ImportOperation | null;
  sources: ImportSourceStatusResponse[];
}

export interface DataManagementSummary {
  sessions: number;
  spans: number;
  annotatedSessions: number;
  pricingRows: number;
  modelContextRows: number;
  migrations: number;
  tasks: number;
  outcomes: number;
  configSnapshots: number;
  cohorts: number;
  experiments: number;
  resetConfirmation: string;
}

export interface ResetResponse {
  deleted: { sessions: number; spans: number; annotatedSessions: number };
  retained: {
    pricingRows: number;
    modelContextRows: number;
    migrations: number;
    tasks: number;
    outcomes: number;
    configSnapshots: number;
    cohorts: number;
    experiments: number;
  };
}
