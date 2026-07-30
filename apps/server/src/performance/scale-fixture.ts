import { performance } from 'node:perf_hooks';
import type { ScanResult } from '@agent-profile/core';
import type { DatabaseConnection } from '../database';
import { importFromSource } from '../ingestion/import-coordinator';
import type { SessionRepository } from '../ingestion/session-repository';
import type { SourceAdapter } from '../ingestion/types';
import { primarySessionPredicate } from '../primary-sessions';

export interface ScaleFixtureConfig {
  sessions: number;
  spans: number;
  largeSessionSpans: number;
  projectCohortSessions: number;
  projectCohortSpans: number;
}

export interface ScaleFixtureSummary extends ScaleFixtureConfig {
  largestSessionId: string;
  projectCohortSpanTotal: number;
}

export const REPRESENTATIVE_SCALE: ScaleFixtureConfig = {
  sessions: 500,
  spans: 75_000,
  largeSessionSpans: 3_000,
  projectCohortSessions: 25,
  projectCohortSpans: 900,
};

export interface QueryPlanReport {
  sessionList: string[];
  sessionDiscovery: string[];
  sessionSpans: string[];
}

export interface UnchangedSyncMeasurement {
  durationMs: number;
  loads: number;
  result: ScanResult;
}

const FIXTURE_START_TIME = Date.UTC(2026, 6, 28, 0, 0, 0);
const AGENTS = ['claude-code', 'codex', 'zed', 'mimo-code', 'opencode'];
const TOOL_NAMES = ['Read', 'Edit', 'Bash'];

export function seedScaleFixture(
  database: DatabaseConnection,
  config: ScaleFixtureConfig = REPRESENTATIVE_SCALE,
): ScaleFixtureSummary {
  validateConfig(config);
  const spanCounts = allocateSpanCounts(config);
  const insertSession = database.prepare(`
    INSERT INTO sessions (
      id, name, file_path, agent, source_kind, source_updated_at,
      source_fingerprint, start_time, end_time, cwd, project_key, input_tokens,
      cache_creation_tokens, cache_read_tokens, output_tokens, total_cost,
      cost_unknown_count, cost_currency, cost_calculated_at,
      cost_calculator_version, peak_context_tokens, avg_context_tokens,
      cache_hit_rate, message_count, imported_at
    ) VALUES (
      @id, @name, @filePath, @agent, 'fixture', @sourceUpdatedAt,
      @sourceFingerprint, @startTime, @endTime, @cwd, @cwd, @inputTokens,
      @cacheCreationTokens, @cacheReadTokens, @outputTokens, @totalCost,
      0, 'CNY', @costCalculatedAt, 'fixture-v1', @peakContextTokens,
      @avgContextTokens, @cacheHitRate, @messageCount, @importedAt
    )
  `);
  const insertSpan = database.prepare(`
    INSERT INTO spans (
      id, session_id, parent_id, type, name, start_time, end_time,
      input_tokens, cache_creation_tokens, cache_read_tokens, output_tokens,
      context_tokens, output_bytes, model, cost, cost_unknown, cost_currency,
      pricing_effective_from, cost_calculated_at, cost_calculator_version,
      stop_reason, is_error, is_sidechain, metadata
    ) VALUES (
      @id, @sessionId, @parentId, @type, @name, @startTime, @endTime,
      @inputTokens, @cacheCreationTokens, @cacheReadTokens, @outputTokens,
      @contextTokens, @outputBytes, @model, @cost, 0, 'CNY', 0,
      @costCalculatedAt, 'fixture-v1', @stopReason, @isError, @isSidechain, NULL
    )
  `);

  database.transaction(() => {
    for (let sessionIndex = 0; sessionIndex < config.sessions; sessionIndex++) {
      const sessionId = fixtureSessionId(sessionIndex);
      const spanCount = spanCounts[sessionIndex];
      const startTime = FIXTURE_START_TIME - sessionIndex * 3_600_000;
      const project =
        sessionIndex < config.projectCohortSessions
          ? '/fixture/project-hot'
          : `/fixture/project-${Math.floor(sessionIndex / 25)}`;
      const turnCount = Math.ceil(spanCount / 4);
      insertSession.run({
        id: sessionId,
        name: `Fixture Session ${sessionIndex + 1}`,
        filePath: `fixture://source/${sessionId}`,
        agent: AGENTS[sessionIndex % AGENTS.length],
        sourceUpdatedAt: startTime,
        sourceFingerprint: fixtureFingerprint(sessionIndex),
        startTime,
        endTime: startTime + spanCount * 25,
        cwd: project,
        inputTokens: turnCount * 600,
        cacheCreationTokens: turnCount * 120,
        cacheReadTokens: turnCount * 480,
        outputTokens: turnCount * 160,
        totalCost: turnCount * 0.0015,
        costCalculatedAt: FIXTURE_START_TIME,
        peakContextTokens: 120_000,
        avgContextTokens: 60_000,
        cacheHitRate: 0.4,
        messageCount: turnCount,
        importedAt: FIXTURE_START_TIME,
      });

      for (let spanIndex = 0; spanIndex < spanCount; spanIndex++) {
        const turnOffset = spanIndex - (spanIndex % 4);
        const turnId = fixtureSpanId(sessionIndex, turnOffset);
        const typeIndex = spanIndex % 4;
        const type =
          typeIndex === 0
            ? 'llm_turn'
            : typeIndex === 1
              ? 'tool_call'
              : typeIndex === 2
                ? 'answer'
                : 'thinking';
        const spanStart = startTime + spanIndex * 25;
        insertSpan.run({
          id: fixtureSpanId(sessionIndex, spanIndex),
          sessionId,
          parentId: typeIndex === 0 ? null : turnId,
          type,
          name:
            type === 'llm_turn'
              ? 'fixture-model'
              : type === 'tool_call'
                ? TOOL_NAMES[Math.floor(spanIndex / 4) % TOOL_NAMES.length]
                : type,
          startTime: spanStart,
          endTime: spanStart + 20,
          inputTokens: type === 'llm_turn' ? 600 : 0,
          cacheCreationTokens: type === 'llm_turn' ? 120 : 0,
          cacheReadTokens: type === 'llm_turn' ? 480 : 0,
          outputTokens: type === 'llm_turn' ? 160 : 0,
          contextTokens: type === 'llm_turn' ? 1_200 : 0,
          outputBytes: type === 'tool_call' ? 4_096 : 0,
          model: type === 'llm_turn' ? 'fixture-model' : null,
          cost: type === 'llm_turn' ? 0.0015 : 0,
          costCalculatedAt: FIXTURE_START_TIME,
          stopReason: type === 'llm_turn' ? 'end_turn' : null,
          isError: type === 'tool_call' && spanIndex % 40 === 1 ? 1 : 0,
          isSidechain: spanIndex % 97 === 0 ? 1 : 0,
        });
      }
    }
  })();

  return {
    ...config,
    largestSessionId: fixtureSessionId(0),
    projectCohortSpanTotal: spanCounts
      .slice(0, config.projectCohortSessions)
      .reduce((total, count) => total + count, 0),
  };
}

export function collectQueryPlans(
  database: DatabaseConnection,
  sessionId: string,
): QueryPlanReport {
  return {
    sessionList: planDetails(
      database
        .prepare('EXPLAIN QUERY PLAN SELECT id, start_time FROM sessions ORDER BY start_time DESC')
        .all(),
    ),
    sessionDiscovery: planDetails(
      database
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT s.id, s.start_time
           FROM sessions s
           WHERE ${primarySessionPredicate('s')}
           ORDER BY s.start_time DESC, s.id DESC
           LIMIT 121`,
        )
        .all(),
    ),
    sessionSpans: planDetails(
      database
        .prepare(
          'EXPLAIN QUERY PLAN SELECT id, start_time FROM spans WHERE session_id = ? ORDER BY start_time ASC, id ASC',
        )
        .all(sessionId),
    ),
  };
}

export async function measureUnchangedSync(
  repository: SessionRepository,
  sessionCount: number,
): Promise<UnchangedSyncMeasurement> {
  let loads = 0;
  const adapter: SourceAdapter = {
    kind: 'fixture',
    discover: async () =>
      Array.from({ length: sessionCount }, (_, sessionIndex) => ({
        key: fixtureSessionId(sessionIndex),
        sessionId: fixtureSessionId(sessionIndex),
        revision: {
          kind: 'fixture',
          updatedAt: FIXTURE_START_TIME - sessionIndex * 3_600_000,
          fingerprint: fixtureFingerprint(sessionIndex),
        },
        load: async () => {
          loads++;
          return null;
        },
      })),
  };
  const startedAt = performance.now();
  const result = await importFromSource(adapter, repository);
  return { durationMs: performance.now() - startedAt, loads, result };
}

function allocateSpanCounts(config: ScaleFixtureConfig): number[] {
  const cohortSpans =
    config.largeSessionSpans + (config.projectCohortSessions - 1) * config.projectCohortSpans;
  const remainingSessions = config.sessions - config.projectCohortSessions;
  const remainingSpans = config.spans - cohortSpans;
  const base = Math.floor(remainingSpans / remainingSessions);
  const remainder = remainingSpans % remainingSessions;
  return Array.from({ length: config.sessions }, (_, sessionIndex) => {
    if (sessionIndex === 0) return config.largeSessionSpans;
    if (sessionIndex < config.projectCohortSessions) return config.projectCohortSpans;
    const remainingIndex = sessionIndex - config.projectCohortSessions;
    return base + (remainingIndex < remainder ? 1 : 0);
  });
}

function validateConfig(config: ScaleFixtureConfig): void {
  const values = Object.values(config);
  if (values.some((value) => !Number.isInteger(value) || value <= 0)) {
    throw new Error('Scale fixture values must be positive integers');
  }
  if (config.projectCohortSessions >= config.sessions) {
    throw new Error('Scale fixture must retain non-cohort Sessions');
  }
  const cohortSpans =
    config.largeSessionSpans + (config.projectCohortSessions - 1) * config.projectCohortSpans;
  if (cohortSpans >= config.spans) {
    throw new Error('Scale fixture span budget must exceed the selected project cohort');
  }
}

function fixtureSessionId(sessionIndex: number): string {
  return `scale-session-${String(sessionIndex).padStart(4, '0')}`;
}

function fixtureSpanId(sessionIndex: number, spanIndex: number): string {
  return `${fixtureSessionId(sessionIndex)}-span-${String(spanIndex).padStart(5, '0')}`;
}

function fixtureFingerprint(sessionIndex: number): string {
  return `fixture:v1:${sessionIndex}`;
}

function planDetails(rows: unknown[]): string[] {
  return (rows as Array<{ detail?: string }>).flatMap((row) =>
    typeof row.detail === 'string' ? [row.detail] : [],
  );
}
