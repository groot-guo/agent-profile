import { execFileSync } from 'node:child_process';
import { analyzeCostAttribution, analyzeEfficiency, analyzePerformance, analyzeToolParams, calcEfficiencyScore, diagnoseSessionSync, type DiagnosisResult, type EfficiencyScore, type SessionDetail, type SessionSummary, type Span } from '@agent-profile/core';
import type { FastifyInstance } from 'fastify';
import { db, getModelContext, getPricing } from '../db';
import { diagnoseDetail } from './diagnosis';
import { parseSpanRow, SESSION_COLS, SPAN_COLS } from './shared';

interface GitCommit {
  hash: string;
  message: string;
  date: string;
  author: string;
}

function scoreSession(session: SessionSummary, spans: Span[], diagnosis?: Pick<DiagnosisResult, 'totalWastedCost'>): EfficiencyScore {
  const efficiency = analyzeEfficiency(spans);
  const result = diagnosis || diagnoseSessionSync(
    { ...session, spans } as SessionDetail,
    { pricingLookup: getPricing, contextWindowLookup: getModelContext },
  );
  const totalTokens = session.inputTokens + session.cacheCreationTokens + session.cacheReadTokens + session.outputTokens;
  return calcEfficiencyScore(efficiency, session.cacheHitRate, totalTokens, session.outputTokens, session.totalCost, result.totalWastedCost);
}

function loadSpansForSessions(sessionIds: string[]): Map<string, Span[]> {
  const spansBySession = new Map<string, Span[]>();
  if (sessionIds.length === 0) return spansBySession;
  const placeholders = sessionIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT ${SPAN_COLS} FROM spans WHERE session_id IN (${placeholders}) ORDER BY start_time ASC`)
    .all(...sessionIds) as Record<string, unknown>[];
  for (const span of rows.map(parseSpanRow)) {
    const spans = spansBySession.get(span.sessionId) || [];
    spans.push(span);
    spansBySession.set(span.sessionId, spans);
  }
  return spansBySession;
}

function findAssociatedCommits(session: Pick<SessionSummary, 'cwd' | 'startTime' | 'endTime'>): { commits: GitCommit[]; error?: string } {
  if (!session.cwd) return { commits: [] };
  try {
    const after = new Date(session.startTime - 3_600_000).toISOString();
    const before = new Date((session.endTime || session.startTime) + 3_600_000).toISOString();
    const output = execFileSync(
      'git',
      ['-C', session.cwd, 'log', '--format=%H%x1f%s%x1f%aI%x1f%an%x1e', `--after=${after}`, `--before=${before}`, '--no-merges'],
      { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const commits = output.split('\x1e').filter(Boolean).flatMap((record) => {
      const [hash, message, date, author] = record.split('\x1f');
      return hash && message && date && author ? [{ hash, message, date, author }] : [];
    });
    return { commits };
  } catch {
    return { commits: [], error: 'git command failed (cwd may not be a git repo)' };
  }
}

function csvCell(value: unknown): string {
  const text = value == null ? '' : typeof value === 'string' ? value : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function registerSessionRoutes(app: FastifyInstance) {
  app.get('/api/sessions', async () => {
    return db
      .prepare(`SELECT ${SESSION_COLS} FROM sessions ORDER BY start_time DESC`)
      .all() as SessionSummary[];
  });

  // 标注 session
  app.patch<{ Params: { id: string }; Body: { tags?: string; notes?: string } }>('/api/session/:id', async (req, reply) => {
    const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(req.params.id) as { id: string } | undefined;
    if (!session) return reply.status(404).send({ error: 'session not found' });
    const { tags, notes } = req.body;
    if (tags !== undefined) db.prepare('UPDATE sessions SET tags = ? WHERE id = ?').run(tags, req.params.id);
    if (notes !== undefined) db.prepare('UPDATE sessions SET notes = ? WHERE id = ?').run(notes, req.params.id);
    return { ok: true };
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

  // Detail-page data is derived from the same span set. Serve it in one read so
  // loading a large session does not repeat the full spans query eight times.
  app.get<{ Params: { id: string } }>('/api/session/:id/analysis', async (req, reply) => {
    const session = db
      .prepare(`SELECT ${SESSION_COLS} FROM sessions WHERE id = ?`)
      .get(req.params.id) as SessionSummary | undefined;
    if (!session) return reply.status(404).send({ error: 'session not found' });
    const rows = db
      .prepare(`SELECT ${SPAN_COLS} FROM spans WHERE session_id = ? ORDER BY start_time ASC`)
      .all(req.params.id) as Record<string, unknown>[];
    const spans = rows.map(parseSpanRow);
    const detail = { ...session, spans } as SessionDetail;
    const diagnosis = await diagnoseDetail(detail);
    const efficiency = analyzeEfficiency(spans);
    const score = scoreSession(session, spans, diagnosis);

    if (session.cwd) {
      const cohort = db.prepare(`SELECT ${SESSION_COLS} FROM sessions WHERE cwd = ?`).all(session.cwd) as SessionSummary[];
      const spansBySession = loadSpansForSessions(cohort.map((candidate) => candidate.id));
      const cohortScores = cohort.map((candidate) => scoreSession(candidate, spansBySession.get(candidate.id) || []).score);
      score.cohortSize = cohortScores.length;
      score.percentile = cohortScores.length > 1
        ? Math.round(cohortScores.filter((candidateScore) => candidateScore <= score.score).length / cohortScores.length * 100)
        : undefined;
    }

    const context = spans
      .filter((span) => span.type === 'llm_turn')
      .map((span) => ({
        startTime: span.startTime,
        contextTokens: span.contextTokens,
        inputTokens: span.inputTokens,
        cacheCreationTokens: span.cacheCreationTokens,
        cacheReadTokens: span.cacheReadTokens,
        outputTokens: span.outputTokens,
        model: span.model,
        contextWindow: getModelContext(span.model) ?? null,
      }));

    return {
      session: detail,
      context,
      diagnosis,
      efficiency,
      costAttribution: analyzeCostAttribution(spans, diagnosis.totalWastedCost),
      score,
      commits: findAssociatedCommits(session).commits,
      performance: analyzePerformance(spans),
      toolParams: analyzeToolParams(spans),
    };
  });

  // 效率指标
  app.get<{ Params: { id: string } }>('/api/session/:id/efficiency', async (req, reply) => {
    const session = db
      .prepare(`SELECT id FROM sessions WHERE id = ?`)
      .get(req.params.id) as { id: string } | undefined;
    if (!session) return reply.status(404).send({ error: 'session not found' });
    const rows = db
      .prepare(`SELECT ${SPAN_COLS} FROM spans WHERE session_id = ? ORDER BY start_time ASC`)
      .all(req.params.id) as Record<string, unknown>[];
    const spans = rows.map(parseSpanRow);
    return analyzeEfficiency(spans);
  });

  // 成本归因
  app.get<{ Params: { id: string } }>('/api/session/:id/cost-attribution', async (req, reply) => {
    const session = db
      .prepare(`SELECT ${SESSION_COLS} FROM sessions WHERE id = ?`)
      .get(req.params.id) as SessionSummary | undefined;
    if (!session) return reply.status(404).send({ error: 'session not found' });
    const rows = db
      .prepare(`SELECT ${SPAN_COLS} FROM spans WHERE session_id = ? ORDER BY start_time ASC`)
      .all(req.params.id) as Record<string, unknown>[];
    const spans = rows.map(parseSpanRow);
    const detail = { ...session, spans } as SessionDetail;
    const diag = diagnoseSessionSync(detail, { pricingLookup: getPricing, contextWindowLookup: getModelContext });
    return analyzeCostAttribution(spans, diag.totalWastedCost);
  });

  // 效率评分
  app.get<{ Params: { id: string } }>('/api/session/:id/score', async (req, reply) => {
    const session = db
      .prepare(`SELECT ${SESSION_COLS} FROM sessions WHERE id = ?`)
      .get(req.params.id) as SessionSummary | undefined;
    if (!session) return reply.status(404).send({ error: 'session not found' });
    const rows = db
      .prepare(`SELECT ${SPAN_COLS} FROM spans WHERE session_id = ? ORDER BY start_time ASC`)
      .all(req.params.id) as Record<string, unknown>[];
    const spans = rows.map(parseSpanRow);
    const score = scoreSession(session, spans);
    // A score is comparable only within the same project. Load the cohort's
    // spans in one query, then rank by the same composite score shown in UI.
    if (session.cwd) {
      const cohort = db.prepare(`SELECT ${SESSION_COLS} FROM sessions WHERE cwd = ?`).all(session.cwd) as SessionSummary[];
      const spansBySession = loadSpansForSessions(cohort.map((candidate) => candidate.id));
      const cohortScores = cohort.map((candidate) => scoreSession(candidate, spansBySession.get(candidate.id) || []).score);
      score.cohortSize = cohortScores.length;
      score.percentile = cohortScores.length > 1
        ? Math.round(cohortScores.filter((candidateScore) => candidateScore <= score.score).length / cohortScores.length * 100)
        : undefined;
    }
    return score;
  });

  // 性能分析
  app.get<{ Params: { id: string } }>('/api/session/:id/performance', async (req, reply) => {
    const session = db
      .prepare(`SELECT id FROM sessions WHERE id = ?`)
      .get(req.params.id) as { id: string } | undefined;
    if (!session) return reply.status(404).send({ error: 'session not found' });
    const rows = db
      .prepare(`SELECT ${SPAN_COLS} FROM spans WHERE session_id = ? ORDER BY start_time ASC`)
      .all(req.params.id) as Record<string, unknown>[];
    return analyzePerformance(rows.map(parseSpanRow));
  });

  // 工具参数分析
  app.get<{ Params: { id: string } }>('/api/session/:id/tool-params', async (req, reply) => {
    const session = db
      .prepare(`SELECT id FROM sessions WHERE id = ?`)
      .get(req.params.id) as { id: string } | undefined;
    if (!session) return reply.status(404).send({ error: 'session not found' });
    const rows = db
      .prepare(`SELECT ${SPAN_COLS} FROM spans WHERE session_id = ? ORDER BY start_time ASC`)
      .all(req.params.id) as Record<string, unknown>[];
    return analyzeToolParams(rows.map(parseSpanRow));
  });

  // 数据导出
  app.get<{ Params: { id: string }; Querystring: { format?: string } }>('/api/session/:id/export', async (req, reply) => {
    const session = db
      .prepare(`SELECT ${SESSION_COLS} FROM sessions WHERE id = ?`)
      .get(req.params.id) as SessionSummary | undefined;
    if (!session) return reply.status(404).send({ error: 'session not found' });
    const rows = db
      .prepare(`SELECT ${SPAN_COLS} FROM spans WHERE session_id = ? ORDER BY start_time ASC`)
      .all(req.params.id) as Record<string, unknown>[];
    const spans = rows.map(parseSpanRow);
    const format = req.query.format || 'json';

    if (format === 'csv') {
      const headers = 'sessionId,sessionName,sessionAgent,sessionStartTime,sessionEndTime,sessionInputTokens,sessionCacheCreationTokens,sessionCacheReadTokens,sessionOutputTokens,sessionTotalCost,spanId,spanType,spanName,spanStartTime,spanEndTime,spanInputTokens,spanCacheCreationTokens,spanCacheReadTokens,spanOutputTokens,spanContextTokens,spanOutputBytes,spanModel,spanCost,spanIsError,spanIsSidechain,spanMetadata';
      const lines = spans.map((s) =>
        [
          session.id, session.name, session.agent, session.startTime, session.endTime,
          session.inputTokens, session.cacheCreationTokens, session.cacheReadTokens, session.outputTokens, session.totalCost.toFixed(6),
          s.id, s.type, s.name, s.startTime, s.endTime, s.inputTokens, s.cacheCreationTokens, s.cacheReadTokens,
          s.outputTokens, s.contextTokens, s.outputBytes, s.model, s.cost.toFixed(6), s.isError ? '1' : '0', s.isSidechain ? '1' : '0',
          s.metadata ? JSON.stringify(s.metadata) : '',
        ].map(csvCell).join(','),
      );
      return reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="session-${session.id.slice(0, 8)}.csv"`).send([headers, ...lines].join('\n'));
    }

    return { session, spans };
  });

  // Git 提交关联
  app.get<{ Params: { id: string } }>('/api/session/:id/commits', async (req, reply) => {
    const session = db
      .prepare(`SELECT id, start_time as startTime, end_time as endTime, cwd FROM sessions WHERE id = ?`)
      .get(req.params.id) as { id: string; startTime: number; endTime?: number; cwd?: string } | undefined;
    if (!session) return reply.status(404).send({ error: 'session not found' });
    return findAssociatedCommits(session);
  });

  // Markdown 报告导出
  app.get<{ Params: { id: string } }>('/api/session/:id/report', async (req, reply) => {
    const session = db
      .prepare(`SELECT ${SESSION_COLS} FROM sessions WHERE id = ?`)
      .get(req.params.id) as SessionSummary | undefined;
    if (!session) return reply.status(404).send({ error: 'session not found' });
    const rows = db
      .prepare(`SELECT ${SPAN_COLS} FROM spans WHERE session_id = ? ORDER BY start_time ASC`)
      .all(req.params.id) as Record<string, unknown>[];
    const spans = rows.map(parseSpanRow);
    const detail = { ...session, spans } as SessionDetail;
    const diag = diagnoseSessionSync(detail, { pricingLookup: getPricing, contextWindowLookup: getModelContext });
    const eff = analyzeEfficiency(spans);
    const totalTokens = session.inputTokens + session.cacheCreationTokens + session.cacheReadTokens + session.outputTokens;
    const turns = spans.filter((s) => s.type === 'llm_turn');
    const tools = spans.filter((s) => s.type === 'tool_call');

    const lines = [
      `# Session Report: ${session.name || session.id.slice(0, 8)}`,
      '',
      `- **Agent**: ${session.agent} | **Model**: ${turns[0]?.model || '-'}`,
      `- **Time**: ${new Date(session.startTime).toISOString()} (${session.endTime ? Math.round((session.endTime - session.startTime) / 60000) + 'min' : 'ongoing'})`,
      `- **Project**: ${session.cwd || '-'} | **Branch**: ${session.gitBranch || '-'}`,
      '',
      '## Token Breakdown',
      '',
      `| Type | Tokens | % |`,
      `|------|--------|---|`,
      `| Input | ${session.inputTokens.toLocaleString()} | ${totalTokens > 0 ? (session.inputTokens / totalTokens * 100).toFixed(1) : 0}% |`,
      `| Cache Creation | ${session.cacheCreationTokens.toLocaleString()} | ${totalTokens > 0 ? (session.cacheCreationTokens / totalTokens * 100).toFixed(1) : 0}% |`,
      `| Cache Read | ${session.cacheReadTokens.toLocaleString()} | ${totalTokens > 0 ? (session.cacheReadTokens / totalTokens * 100).toFixed(1) : 0}% |`,
      `| Output | ${session.outputTokens.toLocaleString()} | ${totalTokens > 0 ? (session.outputTokens / totalTokens * 100).toFixed(1) : 0}% |`,
      `| **Total** | **${totalTokens.toLocaleString()}** | |`,
      '',
      `- **Cost**: ¥${session.totalCost.toFixed(4)}${session.costUnknownCount > 0 ? ' (partial pricing)' : ''}`,
      `- **Peak Context**: ${session.peakContextTokens.toLocaleString()} tokens`,
      `- **Cache Hit Rate**: ${(session.cacheHitRate * 100).toFixed(1)}%`,
      '',
      '## Top Tools',
      '',
      ...eff.toolSuccessRates.slice(0, 10).map((t) => `- **${t.name}**: ${t.total} calls, ${(t.successRate * 100).toFixed(0)}% success`),
      '',
      '## Diagnosis',
      '',
      ...(diag.findings.length === 0 ? ['✓ No issues found.'] : [
        `Total wasted: ~${diag.totalWastedTokens.toLocaleString()} tokens (estimate)`,
        '',
        ...diag.findings.map((f) => `- **[${f.severity}] ${f.title}**\n  ${f.detail}\n  → ${f.suggestion}`),
      ]),
      '',
      '---',
      `*Generated by Agent Profile · ${new Date().toISOString().slice(0, 10)}*`,
    ];

    return reply.header('Content-Type', 'text/markdown; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="session-report.md"')
      .send(lines.join('\n'));
  });

  // Session 对比
  app.get<{ Querystring: { ids: string } }>('/api/sessions/compare', async (req, reply) => {
    const ids = (req.query.ids || '').split(',').filter(Boolean);
    if (ids.length < 2) return reply.status(400).send({ error: 'need at least 2 ids' });
    const sessions = ids.map((id) => {
      const s = db.prepare(`SELECT ${SESSION_COLS} FROM sessions WHERE id = ?`).get(id) as SessionSummary | undefined;
      if (!s) return null;
      const rows = db.prepare(`SELECT ${SPAN_COLS} FROM spans WHERE session_id = ? ORDER BY start_time ASC`).all(id) as Record<string, unknown>[];
      const spans = rows.map(parseSpanRow);
      const turns = spans.filter((sp) => sp.type === 'llm_turn');
      const tools = spans.filter((sp) => sp.type === 'tool_call');
      return {
        ...s,
        turnCount: turns.length,
        toolCount: tools.length,
        duration: s.endTime ? s.endTime - s.startTime : 0,
        totalTokens: s.inputTokens + s.cacheCreationTokens + s.cacheReadTokens + s.outputTokens,
      };
    }).filter(Boolean);
    return { sessions };
  });
}
