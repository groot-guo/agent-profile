import { statSync } from 'node:fs';
import {
  analyzeSession,
  diagnoseSession,
  findTranscriptFiles,
  type Pricing,
  parseTranscript,
  readTranscript,
  type ScanResult,
  type SessionDetail,
  type SessionSummary,
  type Span,
} from '@agent-profile/core';
import type { FastifyInstance } from 'fastify';
import { db, getModelContext, getPricing } from './db';

interface ScanBody {
  dir: string;
}
interface PricingBody {
  model: string;
  inputPrice: number;
  cacheCreationPrice: number;
  cacheReadPrice: number;
  outputPrice: number;
  effectiveFrom?: number;
}
interface ModelContextBody {
  model: string;
  contextWindow: number;
}

const SESSION_COLS = `id, name, file_path as filePath, file_mtime as fileMtime, file_size as fileSize,
  file_lines as fileLines, start_time as startTime, end_time as endTime, cwd, git_branch as gitBranch,
  claude_version as claudeVersion, input_tokens as inputTokens, cache_creation_tokens as cacheCreationTokens,
  cache_read_tokens as cacheReadTokens, output_tokens as outputTokens, total_cost as totalCost,
  cost_unknown_count as costUnknownCount, peak_context_tokens as peakContextTokens,
  avg_context_tokens as avgContextTokens, cache_hit_rate as cacheHitRate,
  message_count as messageCount, imported_at as importedAt`;

const SPAN_COLS = `id, session_id as sessionId, parent_id as parentId, type, name,
  start_time as startTime, end_time as endTime, input_tokens as inputTokens,
  cache_creation_tokens as cacheCreationTokens, cache_read_tokens as cacheReadTokens,
  output_tokens as outputTokens, context_tokens as contextTokens, output_bytes as outputBytes,
  model, cost, cost_unknown as costUnknown, stop_reason as stopReason,
  is_error as isError, is_sidechain as isSidechain, metadata`;

function parseSpanRow(s: Record<string, unknown>): Span {
  s.costUnknown = !!s.costUnknown;
  s.isError = !!s.isError;
  s.isSidechain = !!s.isSidechain;
  if (s.metadata && typeof s.metadata === 'string') {
    try {
      s.metadata = JSON.parse(s.metadata as string);
    } catch {
      /* keep */
    }
  }
  return s as unknown as Span;
}

export function registerRoutes(app: FastifyInstance) {
  // 扫描 + 增量更新（mtime/size 未变跳过，变了删旧重插）
  app.post<{ Body: ScanBody }>('/api/scan', async (req, reply) => {
    const { dir } = req.body;
    if (!dir) return reply.status(400).send({ error: 'dir required' });
    const files = findTranscriptFiles(dir);
    let imported = 0,
      skipped = 0,
      updated = 0;
    const sessionIds: string[] = [];

    const insertSession = db.prepare(`
      INSERT INTO sessions (id, name, file_path, file_mtime, file_size, file_lines, start_time, end_time,
        cwd, git_branch, claude_version, input_tokens, cache_creation_tokens, cache_read_tokens,
        output_tokens, total_cost, cost_unknown_count, peak_context_tokens, avg_context_tokens,
        cache_hit_rate, message_count, imported_at)
      VALUES (@id, @name, @filePath, @fileMtime, @fileSize, @fileLines, @startTime, @endTime,
        @cwd, @gitBranch, @claudeVersion, @inputTokens, @cacheCreationTokens, @cacheReadTokens,
        @outputTokens, @totalCost, @costUnknownCount, @peakContextTokens, @avgContextTokens,
        @cacheHitRate, @messageCount, @importedAt)
    `);
    const insertSpan = db.prepare(`
      INSERT INTO spans (id, session_id, parent_id, type, name, start_time, end_time,
        input_tokens, cache_creation_tokens, cache_read_tokens, output_tokens, context_tokens,
        output_bytes, model, cost, cost_unknown, stop_reason, is_error, is_sidechain, metadata)
      VALUES (@id, @sessionId, @parentId, @type, @name, @startTime, @endTime,
        @inputTokens, @cacheCreationTokens, @cacheReadTokens, @outputTokens, @contextTokens,
        @outputBytes, @model, @cost, @costUnknown, @stopReason, @isError, @isSidechain, @metadata)
    `);
    const delSpans = db.prepare('DELETE FROM spans WHERE session_id = ?');
    const delSession = db.prepare('DELETE FROM sessions WHERE id = ?');
    const getExisting = db.prepare('SELECT file_mtime, file_size FROM sessions WHERE id = ?');
    const tx = db.transaction((rows: Span[]) => {
      for (const s of rows)
        insertSpan.run({
          id: s.id,
          sessionId: s.sessionId,
          parentId: s.parentId ?? null,
          type: s.type,
          name: s.name,
          startTime: s.startTime,
          endTime: s.endTime ?? null,
          inputTokens: s.inputTokens,
          cacheCreationTokens: s.cacheCreationTokens,
          cacheReadTokens: s.cacheReadTokens,
          outputTokens: s.outputTokens,
          contextTokens: s.contextTokens,
          outputBytes: s.outputBytes,
          model: s.model ?? null,
          cost: s.cost,
          costUnknown: s.costUnknown ? 1 : 0,
          stopReason: s.stopReason ?? null,
          isError: s.isError ? 1 : 0,
          isSidechain: s.isSidechain ? 1 : 0,
          metadata: s.metadata ? JSON.stringify(s.metadata) : null,
        });
    });

    for (const file of files) {
      const stat = statSync(file);
      const mtime = stat.mtimeMs,
        size = stat.size;
      const entries = readTranscript(file);
      const lines = entries.length;
      const parsed = parseTranscript(entries, { filePath: file });
      if (!parsed) {
        skipped++;
        continue;
      }

      const existing = getExisting.get(parsed.sessionId) as
        | { file_mtime: number; file_size: number }
        | undefined;
      if (existing && existing.file_mtime === mtime && existing.file_size === size) {
        skipped++;
        continue; // 未变
      }
      if (existing) {
        delSpans.run(parsed.sessionId);
        delSession.run(parsed.sessionId);
        updated++;
      } else {
        imported++;
      }

      const { summary, spans } = analyzeSession(parsed, getPricing, { mtime, size, lines });
      insertSession.run({
        id: summary.id,
        name: summary.name ?? null,
        filePath: summary.filePath,
        fileMtime: mtime,
        fileSize: size,
        fileLines: lines,
        startTime: summary.startTime,
        endTime: summary.endTime ?? null,
        cwd: summary.cwd ?? null,
        gitBranch: summary.gitBranch ?? null,
        claudeVersion: summary.claudeVersion ?? null,
        inputTokens: summary.inputTokens,
        cacheCreationTokens: summary.cacheCreationTokens,
        cacheReadTokens: summary.cacheReadTokens,
        outputTokens: summary.outputTokens,
        totalCost: summary.totalCost,
        costUnknownCount: summary.costUnknownCount,
        peakContextTokens: summary.peakContextTokens,
        avgContextTokens: summary.avgContextTokens,
        cacheHitRate: summary.cacheHitRate,
        messageCount: summary.messageCount,
        importedAt: summary.importedAt,
      });
      tx(spans);
      sessionIds.push(summary.id);
    }

    const result: ScanResult = { scanned: files.length, imported, skipped, updated, sessionIds };
    return result;
  });

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

  // P1 诊断建议清单
  app.get<{ Params: { id: string } }>('/api/session/:id/diagnosis', async (req, reply) => {
    const session = db
      .prepare(`SELECT ${SESSION_COLS} FROM sessions WHERE id = ?`)
      .get(req.params.id) as SessionSummary | undefined;
    if (!session) return reply.status(404).send({ error: 'session not found' });
    const rows = db
      .prepare(`SELECT ${SPAN_COLS} FROM spans WHERE session_id = ? ORDER BY start_time ASC`)
      .all(req.params.id) as Record<string, unknown>[];
    const detail = { ...session, spans: rows.map(parseSpanRow) } as SessionDetail;
    return diagnoseSession(detail, {
      pricingLookup: getPricing,
      contextWindowLookup: getModelContext,
    });
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

  app.get('/api/pricing', async () => {
    return db
      .prepare(
        `SELECT model, input_price as inputPrice, cache_creation_price as cacheCreationPrice,
      cache_read_price as cacheReadPrice, output_price as outputPrice, effective_from as effectiveFrom
      FROM pricing ORDER BY model`,
      )
      .all() as Pricing[];
  });

  app.put<{ Body: PricingBody }>('/api/pricing', async (req) => {
    const b = req.body;
    db.prepare(
      `INSERT INTO pricing (model, input_price, cache_creation_price, cache_read_price, output_price, effective_from)
      VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      b.model,
      b.inputPrice,
      b.cacheCreationPrice,
      b.cacheReadPrice,
      b.outputPrice,
      b.effectiveFrom ?? null,
    );
    return { ok: true };
  });

  app.get('/api/model-context', async () => {
    return db
      .prepare(`SELECT model, context_window as contextWindow FROM model_context ORDER BY model`)
      .all();
  });

  app.put<{ Body: ModelContextBody }>('/api/model-context', async (req) => {
    const b = req.body;
    db.prepare(
      `INSERT INTO model_context (model, context_window) VALUES (?, ?)
      ON CONFLICT(model) DO UPDATE SET context_window = excluded.context_window`,
    ).run(b.model, b.contextWindow);
    return { ok: true };
  });
}
