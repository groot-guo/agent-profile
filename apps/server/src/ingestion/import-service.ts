import type {
  ImportJobStatusResponse,
  ImportOperation,
  ImportSourceId,
} from '@agent-profile/contracts';
import type { DatabaseConnection } from '../database';
import { primarySessionPredicate } from '../primary-sessions';
import { projectScopeDescriptor, projectScopeSql } from '../project-scope';
import type { AppRuntime } from '../runtime';
import type { ImportJobStatus } from './import-job-manager';

export type ImportServiceErrorCode = 'invalid_source' | 'operation_conflict';

export class ImportServiceError extends Error {
  constructor(readonly code: ImportServiceErrorCode) {
    super(code === 'invalid_source' ? 'invalid import source' : 'import job already active');
  }
}

export async function getImportStatus(runtime: AppRuntime): Promise<ImportJobStatusResponse> {
  const status = await runtime.imports.jobs.refreshAvailability();
  return withStoredCounts(runtime.database, status, runtime.projectRoot);
}

export async function startImport(
  runtime: AppRuntime,
  sourceIds?: unknown,
  operation: ImportOperation = 'sync',
): Promise<ImportJobStatusResponse> {
  const { jobs } = runtime.imports;
  const selectedSourceIds = sourceIds ?? jobs.sourceIds();
  if (!validSourceIds(selectedSourceIds, jobs.sourceIds())) {
    throw new ImportServiceError('invalid_source');
  }

  const current = jobs.snapshot();
  if (current.active && current.operation !== operation) {
    throw new ImportServiceError('operation_conflict');
  }

  return withStoredCounts(
    runtime.database,
    await jobs.start(selectedSourceIds, operation),
    runtime.projectRoot,
  );
}

export async function runImport(
  runtime: AppRuntime,
  sourceIds?: unknown,
): Promise<ImportJobStatusResponse> {
  await startImport(runtime, sourceIds);
  await runtime.imports.jobs.waitForIdle();
  return getImportStatus(runtime);
}

function withStoredCounts(
  database: DatabaseConnection,
  status: ImportJobStatus,
  projectRoot: string | null,
): ImportJobStatusResponse {
  const scope = projectScopeSql(projectRoot, 'sessions');
  const rows = database
    .prepare(
      `SELECT COALESCE(source_kind, agent) as sourceKind, COUNT(*) as sessions
       FROM sessions
       WHERE COALESCE(source_kind, agent) IS NOT NULL
         AND ${primarySessionPredicate()}
         AND ${scope.clause}
       GROUP BY COALESCE(source_kind, agent)`,
    )
    .all(...scope.parameters) as { sourceKind: string; sessions: number }[];
  const counts = new Map(rows.map((row) => [row.sourceKind, row.sessions]));
  return {
    ...status,
    scope: projectScopeDescriptor(projectRoot),
    sources: status.sources.map((source) => ({
      ...source,
      storedSessions: counts.get(source.id) ?? 0,
    })),
  };
}

function validSourceIds(
  sourceIds: unknown,
  knownSourceIds: ImportSourceId[],
): sourceIds is ImportSourceId[] {
  return (
    Array.isArray(sourceIds) &&
    sourceIds.every(
      (sourceId): sourceId is ImportSourceId =>
        typeof sourceId === 'string' && knownSourceIds.includes(sourceId as ImportSourceId),
    )
  );
}
