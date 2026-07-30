import type {
  DataManagementSummary,
  ImportJobStatusResponse,
  ImportSourceStatusResponse,
  PublicScanResult,
} from '@agent-profile/contracts';

export const API = process.env.NEXT_PUBLIC_API || '/api';

export type ImportResult = PublicScanResult;
export type ImportSourceStatus = ImportSourceStatusResponse;
export type ImportJobStatus = ImportJobStatusResponse;
export type { DataManagementSummary };
