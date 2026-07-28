import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { type ScanResult, zedThreadsDbPath } from '@agent-profile/core';
import type { FastifyInstance } from 'fastify';
import { config } from '../config';
import { db, getPricing } from '../db';
import { importFromSource } from '../ingestion/import-coordinator';
import {
  ImportJobManager,
  type ImportJobStatus,
  type ImportSourceId,
} from '../ingestion/import-job-manager';
import { MiMoSourceAdapter } from '../ingestion/mimo-adapter';
import { OpenCodeSourceAdapter } from '../ingestion/opencode-adapter';
import { SessionRepository } from '../ingestion/session-repository';
import { TranscriptSourceAdapter } from '../ingestion/transcript-adapter';
import { ZedSourceAdapter, type ZedSourceAdapterOptions } from '../ingestion/zed-adapter';

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

const sessionRepository = new SessionRepository(db, getPricing);
const claudeDirectory =
  config.autoScanDir && config.autoScanDir !== config.defaultScanDir
    ? config.autoScanDir
    : config.defaultScanDir;
const codexDirectory = '~/.codex/sessions';
const mimoDatabasePath = `${homedir()}/.local/share/mimocode/mimocode.db`;
const openCodeDatabasePath = `${homedir()}/.local/share/opencode/opencode.db`;

export const importJobManager = new ImportJobManager(
  [
    {
      id: 'claude-code',
      label: 'Claude Code',
      isAvailable: () => pathAvailable(claudeDirectory),
      run: (operation) =>
        scanTranscriptDirectory(claudeDirectory, 'claude-code', sessionRepository, {
          force: operation === 'rebuild',
        }),
    },
    {
      id: 'codex',
      label: 'Codex',
      isAvailable: () => pathAvailable(codexDirectory),
      run: (operation) =>
        scanTranscriptDirectory(codexDirectory, 'codex', sessionRepository, {
          force: operation === 'rebuild',
        }),
    },
    {
      id: 'zed',
      label: 'Zed',
      isAvailable: () => pathAvailable(zedThreadsDbPath()),
      run: (operation) => scanZedThreads({}, sessionRepository, { force: operation === 'rebuild' }),
    },
    {
      id: 'mimo-code',
      label: 'MiMo Code',
      isAvailable: () => pathAvailable(mimoDatabasePath),
      run: (operation) =>
        scanMiMoSessions(mimoDatabasePath, sessionRepository, { force: operation === 'rebuild' }),
    },
    {
      id: 'opencode',
      label: 'OpenCode',
      isAvailable: () => pathAvailable(openCodeDatabasePath),
      run: (operation) =>
        scanOpenCodeSessions(openCodeDatabasePath, sessionRepository, {
          force: operation === 'rebuild',
        }),
    },
  ],
  (source, error) => {
    console.warn(
      `${source.id} import failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  },
);

export function registerScanRoutes(app: FastifyInstance) {
  app.get('/api/imports/status', async () => importStatusWithStoredCounts());

  app.post<{ Body: ImportBody }>('/api/imports', async (request, reply) => {
    const sourceIds = request.body?.sources ?? importJobManager.sourceIds();
    if (
      !Array.isArray(sourceIds) ||
      sourceIds.some((sourceId) => !importJobManager.sourceIds().includes(sourceId))
    ) {
      return reply.status(400).send({ error: 'invalid import source' });
    }
    const current = importJobManager.snapshot();
    if (current.active && current.operation !== 'sync') {
      return reply.status(409).send({ error: 'import job already active' });
    }
    const status = await importJobManager.start(sourceIds);
    return reply.status(202).send(withStoredCounts(status));
  });

  app.post<{ Body: ImportBody }>('/api/imports/rebuild', async (request, reply) => {
    const sourceIds = request.body?.sources ?? importJobManager.sourceIds();
    if (
      !Array.isArray(sourceIds) ||
      sourceIds.some((sourceId) => !importJobManager.sourceIds().includes(sourceId))
    ) {
      return reply.status(400).send({ error: 'invalid import source' });
    }
    const current = importJobManager.snapshot();
    if (current.active && current.operation !== 'rebuild') {
      return reply.status(409).send({ error: 'import job already active' });
    }
    const status = await importJobManager.start(sourceIds, 'rebuild');
    return reply.status(202).send(withStoredCounts(status));
  });

  app.get('/api/data-management/summary', async () => dataManagementSummary());

  app.post<{ Body: ResetBody }>('/api/data-management/reset', async (request, reply) => {
    if (request.body?.confirmation !== RESET_CONFIRMATION) {
      return reply.status(400).send({ error: 'confirmation required' });
    }
    if (importJobManager.snapshot().active) {
      return reply.status(409).send({ error: 'import job already active' });
    }
    const before = dataManagementSummary();
    const deleted = sessionRepository.resetGeneratedData();
    return {
      deleted,
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
  });

  app.post<{ Body: ScanBody }>('/api/scan', async (request, reply) => {
    const { dir, agent } = request.body;
    if (!dir) return reply.status(400).send({ error: 'dir required' });
    const sourceId = knownTranscriptSource(dir, agent);
    if (sourceId) return importJobManager.runAndWait(sourceId);
    return scanTranscriptDirectory(dir, agent);
  });
}

export async function startStartupImports(): Promise<ImportJobStatus> {
  const sources: ImportSourceId[] = ['zed', 'mimo-code', 'opencode'];
  if (config.autoScanDir) {
    sources.push('claude-code');
    if (config.autoScanDir === config.defaultScanDir) sources.push('codex');
  }
  return importJobManager.start(sources);
}

export function scanTranscriptDirectory(
  directory: string,
  agent?: string,
  repository = sessionRepository,
  options: { force?: boolean } = {},
): Promise<ScanResult> {
  return importFromSource(new TranscriptSourceAdapter(directory, agent), repository, options);
}

export function autoScan(directory: string): Promise<ScanResult> {
  return scanTranscriptDirectory(directory);
}

export function scanZedThreads(
  options: ZedSourceAdapterOptions = {},
  repository = sessionRepository,
  importOptions: { force?: boolean } = {},
): Promise<ScanResult> {
  return importFromSource(new ZedSourceAdapter(options), repository, importOptions);
}

export function scanMiMoSessions(
  databasePath?: string,
  repository = sessionRepository,
  options: { force?: boolean } = {},
): Promise<ScanResult> {
  return importFromSource(new MiMoSourceAdapter(databasePath), repository, options);
}

export function scanOpenCodeSessions(
  databasePath?: string,
  repository = sessionRepository,
  options: { force?: boolean } = {},
): Promise<ScanResult> {
  return importFromSource(new OpenCodeSourceAdapter(databasePath), repository, options);
}

async function importStatusWithStoredCounts() {
  return withStoredCounts(await importJobManager.refreshAvailability());
}

function withStoredCounts(status: ImportJobStatus) {
  const rows = db
    .prepare(
      `SELECT COALESCE(source_kind, agent) as sourceKind, COUNT(*) as sessions
       FROM sessions
       WHERE COALESCE(source_kind, agent) IS NOT NULL
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

function knownTranscriptSource(directory: string, agent?: string): ImportSourceId | undefined {
  if (directory === claudeDirectory && (!agent || agent === 'claude-code')) return 'claude-code';
  if (directory === codexDirectory && (!agent || agent === 'codex')) return 'codex';
  return undefined;
}

function pathAvailable(path: string): boolean {
  const expanded = path === '~' || path.startsWith('~/') ? homedir() + path.slice(1) : path;
  try {
    statSync(resolve(expanded));
    return true;
  } catch {
    return false;
  }
}

function dataManagementSummary() {
  const count = (table: string) =>
    (db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number }).count;
  const annotatedSessions = (
    db
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
