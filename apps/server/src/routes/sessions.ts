import type { SessionDetail, SessionSummary } from '@agent-profile/core';
import type { FastifyInstance } from 'fastify';
import { db, getModelContext } from '../db';
import { parseSpanRow, SESSION_COLS, SPAN_COLS } from './shared';

export function registerSessionRoutes(app: FastifyInstance) {
  app.get('/api/sessions', async () => {
    return db
      .prepare(`SELECT ${SESSION_COLS} FROM sessions ORDER BY start_time DESC`)
      .all() as SessionSummary[];
  });

  app.get<{ Params: { id: string } }>('/api/session/:id', async (req, reply) => {
    const session = db
      .prepare(`SELECT ${SESSION_COLS} FROM sessions WHERE id = ?`)
      .get(req.params.id) as SessionSummary | undefined;
    if (!session) return reply.status(404).send({ error: 'session not found' });
    const spans = db
      .prepare(`SELECT ${SPAN_COLS} FROM spans WHERE session_id = ? ORDER BY start_time ASC`)
      .all(req.params.id) as Record<string, unknown>[];
    return { ...session, spans: spans.map(parseSpanRow) } as SessionDetail;
  });

  // 每轮 LLM 调用明细
  app.get<{ Params: { id: string } }>('/api/session/:id/turns', async (req) => {
    const rows = db
      .prepare(
        `SELECT ${SPAN_COLS} FROM spans WHERE session_id = ? AND type = 'llm_turn' ORDER BY start_time ASC`,
      )
      .all(req.params.id) as Record<string, unknown>[];
    return rows.map(parseSpanRow);
  });

  // 每次工具调用明细
  app.get<{ Params: { id: string } }>('/api/session/:id/tools', async (req) => {
    const rows = db
      .prepare(
        `SELECT ${SPAN_COLS} FROM spans WHERE session_id = ? AND type = 'tool_call' ORDER BY start_time ASC`,
      )
      .all(req.params.id) as Record<string, unknown>[];
    return rows.map(parseSpanRow);
  });

  // 上下文增长曲线
  app.get<{ Params: { id: string } }>('/api/session/:id/context', async (req) => {
    const rows = db
      .prepare(
        `SELECT start_time as startTime, context_tokens as contextTokens,
              input_tokens as inputTokens, cache_creation_tokens as cacheCreationTokens,
              cache_read_tokens as cacheReadTokens, model
       FROM spans WHERE session_id = ? AND type = 'llm_turn' ORDER BY start_time ASC`,
      )
      .all(req.params.id) as {
      startTime: number;
      contextTokens: number;
      inputTokens: number;
      cacheCreationTokens: number;
      cacheReadTokens: number;
      model?: string;
    }[];
    return rows.map((r) => ({ ...r, contextWindow: getModelContext(r.model) ?? null }));
  });
}
