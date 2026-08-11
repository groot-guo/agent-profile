import {
  type DataManagementSummary,
  IMPORT_BODY_SCHEMA,
  type ImportBody,
  RESET_BODY_SCHEMA,
  type ResetBody,
  type ResetResponse,
  SCAN_BODY_SCHEMA,
  type ScanBody,
} from '@agent-profile/contracts';
import type { FastifyInstance } from 'fastify';
import { getImportStatus, ImportServiceError, startImport } from '../ingestion/import-service';
import { classifyProjectCwd, projectScopeDescriptor } from '../project-scope';
import type { AppRuntime } from '../runtime';

const RESET_CONFIRMATION = 'RESET LOCAL DATA';

export function registerScanRoutes(app: FastifyInstance, runtime: AppRuntime): void {
  const { database, imports } = runtime;
  const { jobs } = imports;

  app.get('/api/imports/status', async () => getImportStatus(runtime));

  app.post<{ Body: ImportBody }>(
    '/api/imports',
    { schema: { body: IMPORT_BODY_SCHEMA } },
    async (request, reply) => {
      try {
        return reply.status(202).send(await startImport(runtime, request.body?.sources));
      } catch (error) {
        if (!(error instanceof ImportServiceError)) throw error;
        return reply
          .status(error.code === 'invalid_source' ? 400 : 409)
          .send({ error: error.message });
      }
    },
  );

  app.post<{ Body: ImportBody }>(
    '/api/imports/rebuild',
    { schema: { body: IMPORT_BODY_SCHEMA } },
    async (request, reply) => {
      try {
        return reply.status(202).send(await startImport(runtime, request.body?.sources, 'rebuild'));
      } catch (error) {
        if (!(error instanceof ImportServiceError)) throw error;
        return reply
          .status(error.code === 'invalid_source' ? 400 : 409)
          .send({ error: error.message });
      }
    },
  );

  app.get('/api/data-management/summary', async () =>
    dataManagementSummary(database, runtime.projectRoot),
  );

  app.post<{ Body: ResetBody }>(
    '/api/data-management/reset',
    { schema: { body: RESET_BODY_SCHEMA } },
    async (request, reply) => {
      if (request.body?.confirmation !== RESET_CONFIRMATION) {
        return reply.status(400).send({ error: 'confirmation required' });
      }
      if (jobs.snapshot().active) {
        return reply.status(409).send({ error: 'import job already active' });
      }
      const before = dataManagementSummary(database, runtime.projectRoot);
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
    },
  );

  app.post<{ Body: ScanBody }>(
    '/api/scan',
    { schema: { body: SCAN_BODY_SCHEMA } },
    async (request, reply) => {
      const { dir, agent } = request.body;
      if (!dir) return reply.status(400).send({ error: 'dir required' });
      return imports.runCompatibilityScan(dir, agent);
    },
  );
}

function dataManagementSummary(
  database: AppRuntime['database'],
  projectRoot: string | null,
): DataManagementSummary {
  const count = (table: string) =>
    (database.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number }).count;
  const sessionRows = database.prepare('SELECT id, cwd, tags, notes FROM sessions').all() as Array<{
    id: string;
    cwd: string | null;
    tags: string | null;
    notes: string | null;
  }>;
  const includedRows = projectRoot
    ? sessionRows.filter((row) => classifyProjectCwd(row.cwd, projectRoot) === 'included')
    : sessionRows;
  const excludedSessions = projectRoot
    ? sessionRows.filter((row) => classifyProjectCwd(row.cwd, projectRoot) === 'excluded').length
    : 0;
  const unassignedSessions = sessionRows.filter(
    (row) => classifyProjectCwd(row.cwd, projectRoot) === 'unassigned',
  ).length;
  const annotatedSessions = includedRows.filter(
    (row) => (row.tags ?? '').trim() !== '' || (row.notes ?? '').trim() !== '',
  ).length;
  const spans =
    projectRoot && includedRows.length > 0
      ? (
          database
            .prepare(
              `SELECT COUNT(*) as count FROM spans WHERE session_id IN (${includedRows
                .map(() => '?')
                .join(', ')})`,
            )
            .get(...includedRows.map((row) => row.id)) as { count: number }
        ).count
      : projectRoot
        ? 0
        : count('spans');
  return {
    sessions: includedRows.length,
    spans,
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
    scope: projectScopeDescriptor(projectRoot),
    coverage: {
      includedSessions: includedRows.length,
      excludedSessions,
      unassignedSessions,
    },
  };
}
