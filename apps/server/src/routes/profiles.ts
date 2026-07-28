import {
  type AgentProfileReport,
  type AgentProfileSessionSample,
  buildAgentProfileReport,
} from '@agent-profile/core';
import type { FastifyInstance } from 'fastify';
import type { DatabaseConnection } from '../database';
import { db } from '../db';
import { primarySessionPredicate } from '../primary-sessions';

interface ProfileRow {
  id: string;
  agent: string;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  totalCost: number;
  costUnknownCount: number;
  startTime: number;
  endTime: number | null;
  cacheHitRate: number;
  peakContextTokens: number;
  averageContextTokens: number;
  llmTurns: number;
  modelKnownTurns: number;
  toolCalls: number;
  toolErrors: number;
  toolEvidenceCalls: number;
  sidechainTurns: number;
  sidechainTools: number;
}

export function registerProfileRoutes(
  app: FastifyInstance,
  database: DatabaseConnection = db,
): void {
  app.get('/api/profiles/agents', async () => buildProfileReport(database));
  app.get<{ Params: { agent: string } }>('/api/profiles/agents/:agent', async (request, reply) => {
    const report = buildProfileReport(database);
    const profile = report.profiles.find((candidate) => candidate.agent === request.params.agent);
    if (!profile) {
      return reply.status(404).send({
        error: 'agent profile not found',
        agent: request.params.agent,
      });
    }
    return { ...report, profiles: [profile] };
  });
}

export function buildProfileReport(
  database: DatabaseConnection,
  generatedAt = Date.now(),
): AgentProfileReport {
  const rows = database
    .prepare(
      `SELECT
        s.id,
        s.agent,
        s.input_tokens as inputTokens,
        s.cache_creation_tokens as cacheCreationTokens,
        s.cache_read_tokens as cacheReadTokens,
        s.output_tokens as outputTokens,
        s.total_cost as totalCost,
        s.cost_unknown_count as costUnknownCount,
        s.start_time as startTime,
        s.end_time as endTime,
        s.cache_hit_rate as cacheHitRate,
        s.peak_context_tokens as peakContextTokens,
        s.avg_context_tokens as averageContextTokens,
        COUNT(CASE WHEN p.type = 'llm_turn' THEN 1 END) as llmTurns,
        COUNT(CASE WHEN p.type = 'llm_turn' AND p.model IS NOT NULL THEN 1 END)
          as modelKnownTurns,
        COUNT(CASE WHEN p.type = 'tool_call' THEN 1 END) as toolCalls,
        COUNT(CASE WHEN p.type = 'tool_call' AND p.is_error = 1 THEN 1 END)
          as toolErrors,
        COUNT(CASE WHEN p.type = 'tool_call' AND p.metadata IS NOT NULL THEN 1 END)
          as toolEvidenceCalls,
        COUNT(CASE WHEN p.type = 'llm_turn' AND p.is_sidechain = 1 THEN 1 END)
          as sidechainTurns,
        COUNT(CASE WHEN p.type = 'tool_call' AND p.is_sidechain = 1 THEN 1 END)
          as sidechainTools
       FROM sessions s
       LEFT JOIN spans p ON p.session_id = s.id
       WHERE ${primarySessionPredicate('s')}
       GROUP BY s.id
       ORDER BY s.start_time DESC`,
    )
    .all() as ProfileRow[];

  return buildAgentProfileReport(rows.map(toProfileSample), generatedAt);
}

function toProfileSample(row: ProfileRow): AgentProfileSessionSample {
  const totalTokens =
    number(row.inputTokens) +
    number(row.cacheCreationTokens) +
    number(row.cacheReadTokens) +
    number(row.outputTokens);
  const llmTurns = number(row.llmTurns);
  return {
    id: row.id,
    agent: row.agent || 'unknown',
    totalTokens,
    totalCostCny: number(row.costUnknownCount) === 0 ? number(row.totalCost) : undefined,
    durationMs:
      row.endTime !== null && number(row.endTime) >= number(row.startTime)
        ? number(row.endTime) - number(row.startTime)
        : undefined,
    cacheHitRate: llmTurns > 0 ? number(row.cacheHitRate) : undefined,
    peakContextTokens: llmTurns > 0 ? number(row.peakContextTokens) : undefined,
    averageContextTokens: llmTurns > 0 ? number(row.averageContextTokens) : undefined,
    llmTurns,
    modelKnownTurns: number(row.modelKnownTurns),
    toolCalls: number(row.toolCalls),
    toolErrors: number(row.toolErrors),
    toolEvidenceCalls: number(row.toolEvidenceCalls),
    sidechainTurns: number(row.sidechainTurns),
    sidechainTools: number(row.sidechainTools),
  };
}

function number(value: number | null | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}
