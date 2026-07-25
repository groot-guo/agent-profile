'use client';

import type { SessionSummary } from '@agent-profile/core';
import { useEffect, useState } from 'react';
import { API } from './config';
import { getAgentIcon, getModelIcon } from './icons';
import { AGENT_COLORS, AGENT_LABELS, C, fmtTokens } from './theme';

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
    Promise.all([
      fetch(`${API}/stats`).then((r) => r.json()),
      fetch(`${API}/sessions`).then((r) => r.json()),
    ]).then(async ([stats, sessionList]) => {
      setOverview(stats.overview);
      setSessions(sessionList);

      // 聚合所有 session 的工具调用频率
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
      setToolFreqs(freqs);
      setLoading(false);
    });
  }, []);

  if (loading) return <div style={{ padding: 24, color: C.sub, textAlign: 'center' }}>Loading dashboard…</div>;
  if (!overview) return null;

  const topByCost = [...sessions].sort((a, b) => b.totalCost - a.totalCost).slice(0, 10);
  const topByTokens = [...sessions].sort((a, b) =>
    (b.inputTokens + b.cacheCreationTokens + b.cacheReadTokens + b.outputTokens) -
    (a.inputTokens + a.cacheCreationTokens + a.cacheReadTokens + a.outputTokens)
  ).slice(0, 10);
  const agentCounts = new Map<string, number>();
  for (const s of sessions) agentCounts.set(s.agent, (agentCounts.get(s.agent) || 0) + 1);

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ margin: '0 0 20px', fontSize: 20, fontWeight: 700, color: C.text }}>Overview</h2>

      {/* Overview cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 24 }}>
        <KC v={overview.totalSessions} label="Sessions" />
        <KC v={fmtTokens(overview.totalTokens)} label="Total Tokens" />
        <KC v={`¥${overview.totalCost.toFixed(2)}`} label="Total Cost" warn={overview.sessionsWithCostUnknown > 0} />
        <KC v={`${(overview.avgCacheHitRate * 100).toFixed(1)}%`} label="Avg Cache Hit" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 24 }}>
        <KC v={fmtTokens(overview.avgPeakContext)} label="Avg Peak Context" />
        <KC v={fmtTokens(overview.totalInputTokens)} label="Total Input" />
        <KC v={fmtTokens(overview.totalOutputTokens)} label="Total Output" />
        <KC v={`${overview.sessionsWithCostUnknown}`} label="Unpriced" warn={overview.sessionsWithCostUnknown > 0} />
      </div>

      {/* Agent distribution */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.sub, marginBottom: 10, textTransform: 'uppercase' }}>Agent Distribution</div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {[...agentCounts.entries()].map(([agent, count]) => (
            <div key={agent} style={{
              padding: '10px 18px', background: C.card, border: `1px solid ${C.border}`,
              borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8, minWidth: 120,
            }}>
              <span style={{ fontSize: 18 }}>{getAgentIcon(agent, 18)}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: AGENT_COLORS[agent] || C.mute }}>{AGENT_LABELS[agent] || agent}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: C.text }}>{count}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tool frequency bar chart */}
      {toolFreqs.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.sub, marginBottom: 10, textTransform: 'uppercase' }}>Top Tools (all sessions)</div>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {toolFreqs.map((t) => (
                <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  <span style={{ width: 120, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0, fontSize: 11 }}>{t.name}</span>
                  <div style={{ flex: 1, height: 14, background: C.borderSoft, borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${(t.count / toolFreqs[0].count) * 100}%`, height: '100%', background: t.errors > 0 ? C.medium : C.link, borderRadius: 3 }} />
                  </div>
                  <span style={{ width: 80, textAlign: 'right', color: C.sub, flexShrink: 0, fontSize: 11 }}>
                    {t.count} 次
                    {t.errors > 0 && <span style={{ color: C.high }}> err {t.errors}</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Top sessions by cost */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.sub, marginBottom: 8, textTransform: 'uppercase' }}>Top by Cost</div>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8 }}>
            {topByCost.map((s, i) => (
              <div key={s.id} onClick={() => onSelectSession?.(s.id)}
                style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 14px', fontSize: 12, borderBottom: i < 9 ? `1px solid ${C.borderSoft}` : 'none', alignItems: 'center', cursor: 'pointer' }}>
                <span style={{ color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ color: C.mute, marginRight: 4 }}>#{i + 1}</span>
                  {getAgentIcon(s.agent, 13)}
                  <span>{s.name || s.id.slice(0, 8)}</span>
                </span>
                <span style={{ color: C.out, fontWeight: 600, flexShrink: 0 }}>¥{s.totalCost.toFixed(4)}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.sub, marginBottom: 8, textTransform: 'uppercase' }}>Top by Tokens</div>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8 }}>
            {topByTokens.map((s, i) => {
              const total = s.inputTokens + s.cacheCreationTokens + s.cacheReadTokens + s.outputTokens;
              return (
                <div key={s.id} onClick={() => onSelectSession?.(s.id)}
                  style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 14px', fontSize: 12, borderBottom: i < 9 ? `1px solid ${C.borderSoft}` : 'none', alignItems: 'center', cursor: 'pointer' }}>
                  <span style={{ color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ color: C.mute, marginRight: 4 }}>#{i + 1}</span>
                    {getAgentIcon(s.agent, 13)}
                    <span>{s.name || s.id.slice(0, 8)}</span>
                  </span>
                  <span style={{ color: C.link, fontWeight: 600, flexShrink: 0 }}>{fmtTokens(total)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 数据计算声明 */}
      <div style={{ marginTop: 32, padding: '14px 16px', background: `${C.bg}`, border: `1px solid ${C.borderSoft}`, borderRadius: 8, fontSize: 11, color: C.mute, lineHeight: 1.7 }}>
        <div style={{ fontWeight: 600, color: C.sub, marginBottom: 4 }}>📐 数据说明</div>
        <div>· Token 数据来源：transcript 原始 <code style={{ background: C.borderSoft, padding: '1px 4px', borderRadius: 2 }}>usage</code> 字段（input / cache_creation / cache_read / output），未做估算或补全</div>
        <div>· Cost：本工具按模型定价表计算（¥ / 1M tokens），公式 = (input × in_price + cc × cc_price + cr × cr_price + output × out_price) / 1e6</div>
        <div>· contextTokens = input + cache_creation + cache_read（由本工具聚合）</div>
        <div>· cache 命中率 = cache_read / (input + cache_creation + cache_read)（由本工具计算）</div>
        <div>· 未定价模型：cost 显示 —，标记 costUnknown</div>
        <div>· 扫描目录：~/.claude/projects、~/.codex/sessions、Zed threads.db（启动时自动扫描）</div>
      </div>
    </div>
  );
}

function KC({ v, label, warn }: { v: number | string; label: string; warn?: boolean }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '12px 14px' }}>
      <div style={{ fontSize: 18, fontWeight: 600, color: warn ? C.medium : C.text }}>{v}</div>
      <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>{label}</div>
    </div>
  );
}
