import type { DataManagementSummary, ResetResponse } from '@agent-profile/contracts';
import type { FastifyInstance } from 'fastify';
import type { ImportSourceId } from '../ingestion/import-job-manager';
import { getImportStatus, ImportServiceError, startImport } from '../ingestion/import-service';
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

  app.get('/api/imports/status', async () => getImportStatus(runtime));

  app.post<{ Body: ImportBody }>('/api/imports', async (request, reply) => {
    try {
      return reply.status(202).send(await startImport(runtime, request.body?.sources));
    } catch (error) {
      if (!(error instanceof ImportServiceError)) throw error;
      return reply
        .status(error.code === 'invalid_source' ? 400 : 409)
        .send({ error: error.message });
    }
  });

  app.post<{ Body: ImportBody }>('/api/imports/rebuild', async (request, reply) => {
    try {
      return reply.status(202).send(await startImport(runtime, request.body?.sources, 'rebuild'));
    } catch (error) {
      if (!(error instanceof ImportServiceError)) throw error;
      return reply
        .status(error.code === 'invalid_source' ? 400 : 409)
        .send({ error: error.message });
    }
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
