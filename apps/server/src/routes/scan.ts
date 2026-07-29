import type {
  DataManagementSummary,
  ImportJobStatusResponse,
  ResetResponse,
} from '@agent-profile/contracts';
import type { FastifyInstance } from 'fastify';
import type { ImportJobStatus, ImportSourceId } from '../ingestion/import-job-manager';
import { primarySessionPredicate } from '../primary-sessions';
import type { AppRuntime } from '../runtime';

interface ScanBody {
  dir: string;
  agent?: string;
}

interface ImportBody {
  sources?: ImportSourceId[];
}

interface ResetBody {
  confirmation?: string;
}

const RESET_CONFIRMATION = 'RESET LOCAL DATA';

export function registerScanRoutes(app: FastifyInstance, runtime: AppRuntime): void {
  const { database, imports } = runtime;
  const { jobs } = imports;

  app.get('/api/imports/status', async () => importStatusWithStoredCounts(runtime));

  app.post<{ Body: ImportBody }>('/api/imports', async (request, reply) => {
    const sourceIds = request.body?.sources ?? jobs.sourceIds();
    if (!validSourceIds(sourceIds, jobs.sourceIds())) {
      return reply.status(400).send({ error: 'invalid import source' });
    }
    const current = jobs.snapshot();
    if (current.active && current.operation !== 'sync') {
      return reply.status(409).send({ error: 'import job already active' });
    }
    const status = await jobs.start(sourceIds);
    return reply.status(202).send(withStoredCounts(database, status));
  });

  app.post<{ Body: ImportBody }>('/api/imports/rebuild', async (request, reply) => {
    const sourceIds = request.body?.sources ?? jobs.sourceIds();
    if (!validSourceIds(sourceIds, jobs.sourceIds())) {
      return reply.status(400).send({ error: 'invalid import source' });
    }
    const current = jobs.snapshot();
    if (current.active && current.operation !== 'rebuild') {
      return reply.status(409).send({ error: 'import job already active' });
    }
    const status = await jobs.start(sourceIds, 'rebuild');
    return reply.status(202).send(withStoredCounts(database, status));
  });

  app.get('/api/data-management/summary', async () => dataManagementSummary(database));

  app.post<{ Body: ResetBody }>('/api/data-management/reset', async (request, reply) => {
    if (request.body?.confirmation !== RESET_CONFIRMATION) {
      return reply.status(400).send({ error: 'confirmation required' });
    }
    if (jobs.snapshot().active) {
      return reply.status(409).send({ error: 'import job already active' });
    }
    const before = dataManagementSummary(database);
    const response: ResetResponse = {
      deleted: imports.resetGeneratedData(),
      retained: {
        pricingRows: before.pricingRows,
        modelContextRows: before.modelContextRows,
        migrations: before.migrations,
        tasks: before.tasks,
        outcomes: before.outcomes,
        configSnapshots: before.configSnapshots,
        cohorts: before.cohorts,
        experiments: before.experiments,
      },
    };
    return response;
  });

  app.post<{ Body: ScanBody }>('/api/scan', async (request, reply) => {
    const { dir, agent } = request.body;
    if (!dir) return reply.status(400).send({ error: 'dir required' });
    return imports.runCompatibilityScan(dir, agent);
  });
}

async function importStatusWithStoredCounts(runtime: AppRuntime): Promise<ImportJobStatusResponse> {
  const status = await runtime.imports.jobs.refreshAvailability();
  return withStoredCounts(runtime.database, status);
}

function withStoredCounts(
  database: AppRuntime['database'],
  status: ImportJobStatus,
): ImportJobStatusResponse {
  const rows = database
    .prepare(
      `SELECT COALESCE(source_kind, agent) as sourceKind, COUNT(*) as sessions
       FROM sessions
       WHERE COALESCE(source_kind, agent) IS NOT NULL
         AND ${primarySessionPredicate()}
       GROUP BY COALESCE(source_kind, agent)`,
    )
    .all() as { sourceKind: string; sessions: number }[];
  const counts = new Map(rows.map((row) => [row.sourceKind, row.sessions]));
  return {
    ...status,
    sources: status.sources.map((source) => ({
      ...source,
      storedSessions: counts.get(source.id) ?? 0,
    })),
  };
}

function validSourceIds(
  sourceIds: ImportSourceId[] | unknown[],
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

function dataManagementSummary(database: AppRuntime['database']): DataManagementSummary {
  const count = (table: string) =>
    (database.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number }).count;
  const annotatedSessions = (
    database
      .prepare(
        "SELECT COUNT(*) as count FROM sessions WHERE TRIM(COALESCE(tags, '')) <> '' OR TRIM(COALESCE(notes, '')) <> ''",
      )
      .get() as { count: number }
  ).count;
  return {
    sessions: count('sessions'),
    spans: count('spans'),
    annotatedSessions,
    pricingRows: count('pricing'),
    modelContextRows: count('model_context'),
    migrations: count('schema_migrations'),
    tasks: count('tasks'),
    outcomes: count('task_outcomes'),
    configSnapshots: count('config_snapshots'),
    cohorts: count('cohorts'),
    experiments: count('experiments'),
    resetConfirmation: RESET_CONFIRMATION,
  };
}
