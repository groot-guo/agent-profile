export const API = process.env.NEXT_PUBLIC_API || 'http://localhost:3000/api';

export interface ImportResult {
  scanned: number;
  imported: number;
  updated: number;
  skipped: number;
  removed: number;
  failed: number;
}

export interface ImportSourceStatus {
  id: 'claude-code' | 'codex' | 'zed' | 'mimo-code' | 'opencode';
  label: string;
  available: boolean;
  state: 'idle' | 'scanning' | 'completed' | 'failed';
  result: ImportResult | null;
  startedAt: number | null;
  completedAt: number | null;
  error: 'source_scan_failed' | null;
  storedSessions: number;
}

export interface ImportJobStatus {
  jobId: string | null;
  active: boolean;
  operation: 'sync' | 'rebuild' | null;
  sources: ImportSourceStatus[];
}

export interface DataManagementSummary {
  sessions: number;
  spans: number;
  annotatedSessions: number;
  pricingRows: number;
  modelContextRows: number;
  migrations: number;
  resetConfirmation: string;
}
