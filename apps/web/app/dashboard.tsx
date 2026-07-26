'use client';

import type { SessionSummary } from '@agent-profile/core';
import { useEffect, useState } from 'react';
import { API } from './config';
import { getAgentIcon } from './icons';
import { AGENT_COLORS, AGENT_LABELS, C, fmtTokens, FS, R, SP } from './theme';
import { BarRow, Card, Empty, SectionTitle, StatCard, TokenStrip } from './ui';

const SHADOW_CARD = 'var(--shadow-card)';

interface StatsOverview {
  totalSessions: number;
  totalTokens: number;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  avgCacheHitRate: number;
  avgPeakContext: number;
  sessionsWithCostUnknown: number;
}

interface ToolFreq {
  name: string;
  count: number;
  errors: number;
}

export function DashboardView({ onSelectSession }: { onSelectSession?: (id: string) => void }) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [overview, setOverview] = useState<StatsOverview | null>(null);
  const [toolFreqs, setToolFreqs] = useState<ToolFreq[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`${API}/stats`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
      fetch(`${API}/sessions`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
    ]).then(async ([stats, sessionList]) => {
      if (cancelled) return;
      setOverview(stats.overview);
      setSessions(sessionList);

      // 聚合最近 30 个 session 的工具调用频率
      const toolMap = new Map<string, { count: number; errors: number }>();
      for (const s of sessionList.slice(0, 30)) {
        try {
          const res = await fetch(`${API}/session/${s.id}/tools`);
          const tools = await res.json();
          for (const t of tools) {
            const entry = toolMap.get(t.name) || { count: 0, errors: 0 };
            entry.count++;
            if (t.isError) entry.errors++;
            toolMap.set(t.name, entry);
          }
        } catch { /* skip */ }
      }
      const freqs: ToolFreq[] = [...toolMap.entries()]
        .map(([name, e]) => ({ name, ...e }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 15);
      if (!cancelled) setToolFreqs(freqs);
      if (!cancelled) setLoading(false);
    }).catch((err) => {
      if (!cancelled) setLoading(false);
      console.warn('Dashboard load failed:', err instanceof Error ? err.message : err);
    });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <Empty text="加载总览中…" />;
  if (!overview) return null;

  const totalOf = (s: SessionSummary) => s.inputTokens + s.cacheCreationTokens + s.cacheReadTokens + s.outputTokens;
  const topByCost = [...sessions].sort((a, b) => b.totalCost - a.totalCost).slice(0, 10);
  const topByTokens = [...sessions].sort((a, b) => totalOf(b) - totalOf(a)).slice(0, 10);
  const agentCounts = new Map<string, number>();
  for (const s of sessions) agentCounts.set(s.agent, (agentCounts.get(s.agent) || 0) + 1);

  return (
    <div style={{ padding: SP.xl, maxWidth: 1200, margin: '0 auto' }}>
      {/* 主指标 */}
      <SectionTitle meta={`共 ${overview.totalSessions} 个会话`}>总览</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: SP.md, marginBottom: SP.md }}>
        <StatCard value={overview.totalSessions} label="会话数" tip="已导入的 session 总数" />
        <StatCard value={fmtTokens(overview.totalTokens)} label="总 Token" tip="input + cache_creation + cache_read + output 合计" />
        <StatCard value={`¥${overview.totalCost.toFixed(2)}`} label="总成本" warn={overview.sessionsWithCostUnknown > 0} tip="按模型定价表计算;未定价模型不计入" />
        <StatCard value={`${(overview.avgCacheHitRate * 100).toFixed(1)}%`} label="平均 Cache 命中" tip="cache_read ÷ (input + cache_creation + cache_read),越高越省成本" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: SP.md, marginBottom: SP.xl }}>
        <StatCard value={fmtTokens(overview.avgPeakContext)} label="平均峰值上下文" tip="各会话上下文窗口峰值的平均值" />
        <StatCard value={fmtTokens(overview.totalInputTokens)} label="总输入(含 cache)" tip="input + cache_creation + cache_read" />
        <StatCard value={fmtTokens(overview.totalOutputTokens)} label="总输出" />
        <StatCard value={`${overview.sessionsWithCostUnknown}`} label="未定价会话" warn={overview.sessionsWithCostUnknown > 0} tip="包含未知模型的会话,成本无法计算,列表中标记为「未定价」" />
      </div>

      {/* Agent 分布 */}
      <SectionTitle>Agent 分布</SectionTitle>
      <div style={{ display: 'flex', gap: SP.md, flexWrap: 'wrap', marginBottom: SP.xl }}>
        {[...agentCounts.entries()].map(([agent, count]) => (
          <div key={agent} style={{
            padding: `${SP.md}px ${SP.lg}px`, background: C.card, borderRadius: R.lg,
            boxShadow: SHADOW_CARD, display: 'flex', alignItems: 'center', gap: SP.md, minWidth: 132,
          }}>
            <span style={{ display: 'inline-flex' }}>{getAgentIcon(agent, 20)}</span>
            <div>
              <div style={{ fontSize: FS.cap, color: AGENT_COLORS[agent] || C.mute, fontWeight: 500 }}>{AGENT_LABELS[agent] || agent}</div>
              <div className="tnum" style={{ fontSize: FS.kpi, fontWeight: 600, color: C.text, lineHeight: 1.25 }}>{count}</div>
            </div>
          </div>
        ))}
      </div>

      {/* 工具频次 */}
      {toolFreqs.length > 0 && (
        <Card title="高频工具" meta="最近 30 个会话">
          {toolFreqs.map((t) => (
            <BarRow
              key={t.name}
              label={t.name}
              ratio={t.count / toolFreqs[0].count}
              color={t.errors > 0 ? C.medium : C.link}
              right={<>{t.count} 次{t.errors > 0 && <span style={{ color: C.high }}> · 错误 {t.errors}</span>}</>}
            />
          ))}
        </Card>
      )}

      {/* Top 会话 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: SP.xl }}>
        <Card title="成本 Top 10">
          <TopList sessions={topByCost} metric={(s) => `¥${s.totalCost.toFixed(3)}`} metricColor={C.out} onSelect={onSelectSession} />
        </Card>
        <Card title="Token Top 10">
          <TopList sessions={topByTokens} metric={(s) => fmtTokens(totalOf(s))} metricColor={C.link} onSelect={onSelectSession} />
        </Card>
      </div>

      {/* 数据口径 */}
      <Card title="数据口径说明" pad={SP.lg}>
        <div style={{ fontSize: FS.sm, color: C.sub, lineHeight: 1.9 }}>
          <Line>Token 取自 transcript 原始 <Code>usage</Code> 字段(input / cache_creation / cache_read / output),未做估算或补全</Line>
          <Line>成本 = (input×输入价 + cc×创建价 + cr×读取价 + output×输出价) ÷ 1M,按模型定价表计算</Line>
          <Line>上下文大小 = input + cache_creation + cache_read;Cache 命中率 = cache_read ÷ 上下文大小</Line>
          <Line>未知模型的成本不估算,统一显示「未定价」</Line>
          <Line>扫描目录:~/.claude/projects、~/.codex/sessions、Zed threads.db(启动时自动扫描)</Line>
        </div>
      </Card>
    </div>
  );
}

function Line({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: SP.sm }}><span style={{ color: C.mute }}>·</span><span style={{ flex: 1 }}>{children}</span></div>;
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="tnum" style={{ background: C.borderSoft, padding: '1px 5px', borderRadius: 4, fontSize: FS.cap }}>{children}</code>;
}

function TopList({ sessions, metric, metricColor, onSelect }: {
  sessions: SessionSummary[];
  metric: (s: SessionSummary) => string;
  metricColor: string;
  onSelect?: (id: string) => void;
}) {
  return (
    <div>
      {sessions.map((s, i) => {
        const name = s.name || s.id.slice(0, 8);
        return (
          <div key={s.id} onClick={() => onSelect?.(s.id)} className="ap-row"
            style={{
              display: 'flex', alignItems: 'center', gap: SP.sm, cursor: 'pointer',
              padding: '6px 8px', borderRadius: R.md, fontSize: FS.sm,
            }}>
            <span className="tnum" style={{ width: 22, textAlign: 'right', color: i < 3 ? C.out : C.mute, fontWeight: i < 3 ? 600 : 400, flexShrink: 0, fontSize: FS.cap }}>
              {i + 1}
            </span>
            {getAgentIcon(s.agent, 14)}
            <span className="clamp1" title={name} style={{ color: C.text, flex: 1, minWidth: 0 }}>{name}</span>
            <span style={{ width: 72, flexShrink: 0, display: 'flex' }}>
              <TokenStrip input={s.inputTokens} cc={s.cacheCreationTokens} cr={s.cacheReadTokens} out={s.outputTokens} height={3} />
            </span>
            <span className="tnum" style={{ color: metricColor, fontWeight: 600, flexShrink: 0, fontSize: FS.sm }}>{metric(s)}</span>
          </div>
        );
      })}
    </div>
  );
}
