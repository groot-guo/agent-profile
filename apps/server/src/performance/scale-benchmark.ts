import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { FastifyInstance } from 'fastify';
import { createDatabase, lookupPricing } from '../database';
import { SessionRepository } from '../ingestion/session-repository';
import {
  collectQueryPlans,
  measureUnchangedSync,
  REPRESENTATIVE_SCALE,
  type ScaleFixtureSummary,
  seedScaleFixture,
} from './scale-fixture';

interface EndpointBudget {
  medianMs: number;
  responseBytes: number;
}

interface EndpointMeasurement {
  medianMs: number;
  maxMs: number;
  responseBytes: number;
  rssBeforeBytes: number;
  rssAfterBytes: number;
}

interface BenchmarkReport {
  schemaVersion: 'scale-benchmark/v1';
  generatedAt: string;
  runtime: { node: string; platform: string; arch: string };
  fixture: ScaleFixtureSummary & { databaseBytes: number };
  queryPlans: ReturnType<typeof collectQueryPlans>;
  unchangedSync: {
    durationMs: number;
    loads: number;
    scanned: number;
    unchanged: number;
  };
  endpoints: Record<'sessions' | 'stats' | 'analysis' | 'evidence', EndpointMeasurement>;
  process: { startMaxRssBytes: number; finalMaxRssBytes: number; growthBytes: number };
  budgets: typeof DESKTOP_BUDGETS;
  budgetFailures: string[];
  limitations: string[];
}

const DESKTOP_BUDGETS = {
  unchangedSyncMs: 500,
  maxRssBytes: 768 * 1024 * 1024,
  endpoints: {
    sessions: { medianMs: 300, responseBytes: 1_500_000 },
    stats: { medianMs: 2_000, responseBytes: 750_000 },
    analysis: { medianMs: 4_000, responseBytes: 5_000_000 },
    evidence: { medianMs: 2_000, responseBytes: 4_000_000 },
  } satisfies Record<string, EndpointBudget>,
};

const checkBudgets = process.argv.includes('--check');
const tempDirectory = mkdtempSync(join(tmpdir(), 'agent-profile-scale-'));
const databasePath = join(tempDirectory, 'trace.db');
const startMaxRssBytes = maxRssBytes();

try {
  const fixtureDatabase = createDatabase(databasePath);
  const fixture = seedScaleFixture(fixtureDatabase, REPRESENTATIVE_SCALE);
  const queryPlans = collectQueryPlans(fixtureDatabase, fixture.largestSessionId);
  const repository = new SessionRepository(fixtureDatabase, (model, at) =>
    lookupPricing(fixtureDatabase, model, at),
  );
  const unchanged = await measureUnchangedSync(repository, fixture.sessions);
  fixtureDatabase.close();

  process.env.AUTO_SCAN_DIR = '';
  process.env.LLM_API_KEY = '';
  const { createApp } = await import('../app');
  const { createProductionRuntime } = await import('../runtime');
  const runtime = createProductionRuntime({
    databasePath,
    autoScanDir: null,
    defaultScanDir: '~/.claude/projects',
  });
  const app = createApp(runtime, { logger: false, webOrigins: [] });
  await app.ready();

  const endpoints = {
    sessions: await measureEndpoint(app, '/api/sessions', (body) => {
      if (!Array.isArray(body) || body.length !== fixture.sessions) {
        throw new Error('Session-list response does not cover the representative fixture');
      }
    }),
    stats: await measureEndpoint(app, '/api/stats', (body) => {
      if (statsSessionCount(body) !== fixture.sessions) {
        throw new Error('Stats response does not cover the representative fixture');
      }
    }),
    analysis: await measureEndpoint(
      app,
      `/api/session/${fixture.largestSessionId}/analysis`,
      (body) => {
        if (analysisSpanCount(body) !== fixture.largeSessionSpans) {
          throw new Error('Analysis response does not cover the largest fixture Session');
        }
      },
    ),
    evidence: await measureEndpoint(
      app,
      `/api/session/${fixture.largestSessionId}/evidence?content=none`,
      (body) => {
        if (evidenceEventCount(body) !== fixture.largeSessionSpans) {
          throw new Error('Evidence response does not cover the largest fixture Session');
        }
      },
    ),
  };

  await app.close();
  await runtime.close();
  const finalMaxRssBytes = maxRssBytes();
  const budgetFailures = evaluateBudgets(endpoints, unchanged.durationMs, finalMaxRssBytes);
  const report: BenchmarkReport = {
    schemaVersion: 'scale-benchmark/v1',
    generatedAt: new Date().toISOString(),
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    fixture: { ...fixture, databaseBytes: databaseFileBytes(databasePath) },
    queryPlans,
    unchangedSync: {
      durationMs: round(unmodifiedNumber(unchanged.durationMs)),
      loads: unchanged.loads,
      scanned: unchanged.result.scanned,
      unchanged: unchanged.result.skipReasons.unchanged_revision,
    },
    endpoints,
    process: {
      startMaxRssBytes,
      finalMaxRssBytes,
      growthBytes: Math.max(0, finalMaxRssBytes - startMaxRssBytes),
    },
    budgets: DESKTOP_BUDGETS,
    budgetFailures,
    limitations: [
      'Budgets are generous desktop regression guards, not cross-machine product SLOs.',
      'The fixture contains normalized structural evidence only; it includes no prompt, answer, reasoning, or tool-output text.',
      'Fastify inject measures route/query/serialization work without browser rendering or network transport.',
      'Process max RSS includes fixture creation, module loading, SQLite, route execution, and serialization in one process.',
    ],
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (checkBudgets && budgetFailures.length > 0) process.exitCode = 1;
} finally {
  rmSync(tempDirectory, { recursive: true, force: true });
}

async function measureEndpoint(
  app: FastifyInstance,
  url: string,
  validate: (body: unknown) => void,
): Promise<EndpointMeasurement> {
  const warmup = await app.inject({ method: 'GET', url });
  if (warmup.statusCode !== 200) throw new Error(`${url} returned ${warmup.statusCode}`);
  validate(warmup.json());
  const durations: number[] = [];
  let responseBytes = 0;
  let rssBeforeBytes = 0;
  let rssAfterBytes = 0;
  for (let iteration = 0; iteration < 3; iteration++) {
    globalThis.gc?.();
    if (iteration === 0) rssBeforeBytes = process.memoryUsage().rss;
    const startedAt = performance.now();
    const response = await app.inject({ method: 'GET', url });
    durations.push(performance.now() - startedAt);
    if (response.statusCode !== 200) throw new Error(`${url} returned ${response.statusCode}`);
    responseBytes = Buffer.byteLength(response.payload);
    rssAfterBytes = process.memoryUsage().rss;
  }
  durations.sort((left, right) => left - right);
  return {
    medianMs: round(durations[1]),
    maxMs: round(durations[2]),
    responseBytes,
    rssBeforeBytes,
    rssAfterBytes,
  };
}

function evaluateBudgets(
  endpoints: BenchmarkReport['endpoints'],
  unchangedSyncMs: number,
  finalMaxRssBytes: number,
): string[] {
  const failures: string[] = [];
  if (unchangedSyncMs > DESKTOP_BUDGETS.unchangedSyncMs) {
    failures.push(
      `unchanged sync ${round(unchangedSyncMs)}ms exceeds ${DESKTOP_BUDGETS.unchangedSyncMs}ms`,
    );
  }
  if (finalMaxRssBytes > DESKTOP_BUDGETS.maxRssBytes) {
    failures.push(`max RSS ${finalMaxRssBytes} bytes exceeds ${DESKTOP_BUDGETS.maxRssBytes} bytes`);
  }
  for (const [name, measurement] of Object.entries(endpoints)) {
    const budget = DESKTOP_BUDGETS.endpoints[name as keyof typeof DESKTOP_BUDGETS.endpoints];
    if (measurement.medianMs > budget.medianMs) {
      failures.push(`${name} median ${measurement.medianMs}ms exceeds ${budget.medianMs}ms`);
    }
    if (measurement.responseBytes > budget.responseBytes) {
      failures.push(
        `${name} response ${measurement.responseBytes} bytes exceeds ${budget.responseBytes} bytes`,
      );
    }
  }
  return failures;
}

function statsSessionCount(body: unknown): number | null {
  if (!body || typeof body !== 'object') return null;
  const overview = (body as { overview?: unknown }).overview;
  if (!overview || typeof overview !== 'object') return null;
  const value = (overview as { totalSessions?: unknown }).totalSessions;
  return typeof value === 'number' ? value : null;
}

function analysisSpanCount(body: unknown): number | null {
  if (!body || typeof body !== 'object') return null;
  const session = (body as { session?: unknown }).session;
  if (!session || typeof session !== 'object') return null;
  const spans = (session as { spans?: unknown }).spans;
  return Array.isArray(spans) ? spans.length : null;
}

function evidenceEventCount(body: unknown): number | null {
  if (!body || typeof body !== 'object') return null;
  const scope = (body as { scope?: unknown }).scope;
  if (!scope || typeof scope !== 'object') return null;
  const events = (scope as { events?: unknown }).events;
  return typeof events === 'number' ? events : null;
}

function databaseFileBytes(path: string): number {
  return [path, `${path}-wal`, `${path}-shm`].reduce(
    (total, candidate) => total + (existsSync(candidate) ? statSync(candidate).size : 0),
    0,
  );
}

function maxRssBytes(): number {
  return process.resourceUsage().maxRSS * 1024;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function unmodifiedNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
