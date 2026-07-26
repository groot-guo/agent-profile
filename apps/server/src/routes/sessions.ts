import { analyzeCostAttribution, analyzeEfficiency, analyzePerformance, analyzeToolParams, calcEfficiencyScore, diagnoseSessionSync, type SessionDetail, type SessionSummary } from '@agent-profile/core';
import type { FastifyInstance } from 'fastify';
import { db, getModelContext, getPricing } from '../db';
import { parseSpanRow, SESSION_COLS, SPAN_COLS } from './shared';

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
    const eff = analyzeEfficiency(spans);
    const detail = { ...session, spans } as SessionDetail;
    const diag = diagnoseSessionSync(detail, { pricingLookup: getPricing, contextWindowLookup: getModelContext });
    const totalTokens = session.inputTokens + session.cacheCreationTokens + session.cacheReadTokens + session.outputTokens;
    const score = calcEfficiencyScore(eff, session.cacheHitRate, totalTokens, session.outputTokens, session.totalCost, diag.totalWastedCost);
    // Compute percentile among all sessions
    const allScores = db.prepare(`
      SELECT id, total_cost as totalCost, cache_hit_rate as cacheHitRate,
             input_tokens + cache_creation_tokens + cache_read_tokens + output_tokens as totalTokens,
             output_tokens as outputTokens
      FROM sessions
    `).all() as { id: string; totalCost: number; cacheHitRate: number; totalTokens: number; outputTokens: number }[];
    // Quick percentile: count how many sessions have lower cache hit rate as proxy
    const betterCount = allScores.filter((s) => s.cacheHitRate > session.cacheHitRate).length;
    score.percentile = allScores.length > 1 ? Math.round((1 - betterCount / allScores.length) * 100) : undefined;
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
      const headers = 'id,type,name,startTime,endTime,inputTokens,ccTokens,crTokens,outputTokens,contextTokens,outputBytes,model,cost,isError,isSidechain';
      const lines = spans.map((s) =>
        [s.id, s.type, s.name, s.startTime, s.endTime || '', s.inputTokens, s.cacheCreationTokens, s.cacheReadTokens, s.outputTokens, s.contextTokens, s.outputBytes, s.model || '', s.cost.toFixed(6), s.isError ? '1' : '0', s.isSidechain ? '1' : '0'].join(','),
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
    if (!session.cwd) return { commits: [], error: 'no cwd for this session' };

    const { execSync } = await import('node:child_process');
    try {
      const after = new Date(session.startTime - 3600000).toISOString(); // 1h before session start
      const before = new Date((session.endTime || session.startTime) + 3600000).toISOString(); // 1h after session end
      const output = execSync(
        `git -C "${session.cwd}" log --format="%H|%s|%ai|%an" --after="${after}" --before="${before}" --no-merges 2>/dev/null || echo ""`,
        { encoding: 'utf-8', timeout: 5000 },
      ).trim();
      if (!output) return { commits: [] };
      const commits = output.split('\n').filter(Boolean).map((line) => {
        const [hash, message, date, author] = line.split('|');
        return { hash, message, date, author };
      });
      return { commits };
    } catch {
      return { commits: [], error: 'git command failed (cwd may not be a git repo)' };
    }
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
