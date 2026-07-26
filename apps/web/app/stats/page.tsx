'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { API } from '../config';
import { getAgentIcon, getModelIcon } from '../icons';
import { AGENT_COLORS, AGENT_LABELS, C, fmtTokens } from '../theme';

interface StatsData {
  overview: {
    totalSessions: number; totalTokens: number; totalCost: number;
    totalInputTokens: number; totalOutputTokens: number;
    avgCacheHitRate: number; avgPeakContext: number; sessionsWithCostUnknown: number;
  };
  byAgent: { agent: string; sessions: number; totalTokens: number; totalCost: number; avgCacheHitRate: number }[];
  byProject: { cwd: string; sessions: number; totalTokens: number; totalCost: number }[];
  byModel: { model: string; sessions: number; totalInputTokens: number; totalOutputTokens: number; totalCost: number }[];
  distribution: {
    costBins: { bin: string; min: number; max: number | null; count: number }[];
    tokenBins: { bin: string; min: number; max: number | null; count: number }[];
    modelDistribution: { model: string; count: number; tokens: number }[];
    agentDistribution: { agent: string; count: number; tokens: number }[];
  };
  baseline?: {
    projects: Record<string, { sessions: number; avgCost: number; medCost: number; p95Cost: number; avgTokens: number; avgCacheHit: number }>;
    anomalySessions: string[];
  };
  trends?: { day: string; tokens: number; cost: number; sessions: number; avgCacheHit: number }[];
}

export default function StatsPage() {
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/stats`).then((r) => r.json().then(setData)).finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: 24, color: C.sub }}>Loading…</div>;
  if (!data) return <div style={{ padding: 24, color: C.high }}>Failed to load stats</div>;

  const { overview, byAgent, byProject, byModel, distribution } = data;

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
      <Link href="/" style={{ color: C.link, fontSize: 13, textDecoration: 'none' }}>← Sessions</Link>
      <h2 style={{ margin: '8px 0 4px', fontSize: 22, fontWeight: 600, color: C.text }}>Stats</h2>
      <div style={{ fontSize: 12, color: C.sub, marginBottom: 24 }}>全量消费统计</div>

      {/* Overview cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 24 }}>
        <StatCard v={overview.totalSessions} label="Sessions" />
        <StatCard v={fmtTokens(overview.totalTokens)} label="Total Tokens" />
        <StatCard v={`¥${overview.totalCost.toFixed(2)}`} label="Total Cost" warn={overview.sessionsWithCostUnknown > 0} />
        <StatCard v={`${(overview.avgCacheHitRate * 100).toFixed(1)}%`} label="Avg Cache Hit" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 24 }}>
        <StatCard v={fmtTokens(overview.avgPeakContext)} label="Avg Peak Context" />
        <StatCard v={fmtTokens(overview.totalInputTokens)} label="Total Input" />
        <StatCard v={fmtTokens(overview.totalOutputTokens)} label="Total Output" />
        <StatCard v={`${overview.sessionsWithCostUnknown}`} label="Unpriced Sessions" warn={overview.sessionsWithCostUnknown > 0} />
      </div>

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
        <BarChart title="Cost 分布" bins={distribution.costBins} color={C.out} />
        <BarChart title="Token 分布" bins={distribution.tokenBins} color={C.link} />
      </div>

      {/* Daily trends */}
      {data.trends && data.trends.length > 1 && (
        <div style={{ marginBottom: 24 }}>
          <Section title="每日趋势">
            <TrendChart trends={data.trends} />
          </Section>
        </div>
      )}

      {/* Agent pie */}
      <Section title="按 Agent">
        <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
          <PieChart items={distribution.agentDistribution.map((a) => ({ label: AGENT_LABELS[a.agent] || a.agent, value: a.tokens, color: AGENT_COLORS[a.agent] || C.mute }))} size={140} />
          <div style={{ flex: 1, minWidth: 200 }}>
            {byAgent.map((a) => (
              <div key={a.agent} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: `1px solid ${C.borderSoft}` }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{getAgentIcon(a.agent, 14)} {AGENT_LABELS[a.agent] || a.agent}</span>
                <span style={{ color: C.sub }}>{a.sessions} sessions · {fmtTokens(a.totalTokens)} · ¥{a.totalCost.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* By project */}
      <Section title="按项目">
        {byProject.slice(0, 10).map((p) => (
          <div key={p.cwd} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: `1px solid ${C.borderSoft}` }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{p.cwd}</span>
            <span style={{ color: C.sub, flexShrink: 0 }}>{p.sessions} sessions · {fmtTokens(p.totalTokens)} · ¥{p.totalCost.toFixed(2)}</span>
          </div>
        ))}
      </Section>

      {/* Baselines */}
      {data.baseline && Object.keys(data.baseline.projects).length > 0 && (
        <Section title="项目基线 & 异常">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {Object.entries(data.baseline.projects).slice(0, 10).map(([proj, bl]) => (
              <div key={proj} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: `1px solid ${C.borderSoft}` }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '40%', color: C.text }}>{proj.split('/').pop() || proj}</span>
                <span style={{ color: C.sub }}>
                  {bl.sessions}会话 · 中位¥{bl.medCost.toFixed(4)} · P95 ¥{bl.p95Cost.toFixed(4)} · 均{fmtTokens(bl.avgTokens)}
                </span>
              </div>
            ))}
          </div>
          {data.baseline.anomalySessions.length > 0 && (
            <div style={{ marginTop: 8, padding: '6px 10px', background: `${C.high}12`, borderRadius: 6, fontSize: 11 }}>
              <span style={{ color: C.high, fontWeight: 600 }}>⚠ {data.baseline.anomalySessions.length} 个异常高成本会话</span>
              <span style={{ color: C.sub }}>（成本 &gt; 项目 3x 中位数），会话列表中已标记</span>
            </div>
          )}
        </Section>
      )}

      {/* By model */}
      <Section title="按 Model">
        <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
          <PieChart items={byModel.map((m) => ({ label: m.model, value: m.totalInputTokens, color: modelColor(m.model) }))} size={120} />
          <div style={{ flex: 1, minWidth: 200 }}>
            {byModel.slice(0, 8).map((m) => (
              <div key={m.model} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: `1px solid ${C.borderSoft}` }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{getModelIcon(m.model, 14)} {m.model}</span>
                <span style={{ color: C.sub }}>{m.sessions} turns · {fmtTokens(m.totalInputTokens)} · ¥{m.totalCost.toFixed(4)}</span>
              </div>
            ))}
          </div>
        </div>
      </Section>
    </div>
  );
}

function StatCard({ v, label, warn }: { v: number | string; label: string; warn?: boolean }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '12px 14px' }}>
      <div style={{ fontSize: 20, fontWeight: 600, color: warn ? C.medium : C.text }}>{v}</div>
      <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>{label}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: C.sub, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}</div>
      {children}
    </div>
  );
}

function BarChart({ title, bins, color }: { title: string; bins: { bin: string; count: number }[]; color: string }) {
  const max = Math.max(...bins.map((b) => b.count), 1);
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: C.sub, marginBottom: 12 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {bins.map((b) => (
          <div key={b.bin} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
            <span style={{ width: 70, textAlign: 'right', color: C.sub, flexShrink: 0 }}>{b.bin}</span>
            <div style={{ flex: 1, height: 16, background: C.borderSoft, borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${(b.count / max) * 100}%`, height: '100%', background: color, borderRadius: 3, minWidth: b.count > 0 ? 3 : 0 }} />
            </div>
            <span style={{ width: 30, color: C.mute }}>{b.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PieChart({ items, size }: { items: { label: string; value: number; color: string }[]; size: number }) {
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  const r = size / 2;
  let cumAngle = -Math.PI / 2;
  const slices: { path: string; color: string }[] = [];

  for (const item of items) {
    const angle = (item.value / total) * Math.PI * 2;
    if (angle <= 0) continue;
    const x1 = r + r * Math.cos(cumAngle);
    const y1 = r + r * Math.sin(cumAngle);
    cumAngle += angle;
    const x2 = r + r * Math.cos(cumAngle);
    const y2 = r + r * Math.sin(cumAngle);
    const largeArc = angle > Math.PI ? 1 : 0;
    slices.push({ path: `M${r},${r} L${x1},${y1} A${r},${r} 0 ${largeArc},1 ${x2},${y2} Z`, color: item.color });
  }

  return (
    <svg width={size + 20} height={size + 20} viewBox={`-10 -10 ${size + 20} ${size + 20}`}>
      {slices.map((s, i) => (
        <path key={i} d={s.path} fill={s.color} fillOpacity={0.75} stroke={C.card} strokeWidth={1.5} />
      ))}
    </svg>
  );
}

const MODEL_PALETTE = [C.link, C.cc, C.cr, C.out, C.medium, '#fb8f1e', '#d1572a', '#218bff'];
const modelColorMap = new Map<string, string>();
let modelColorIdx = 0;

function TrendChart({ trends }: { trends: { day: string; tokens: number; cost: number; sessions: number; avgCacheHit: number }[] }) {
  const W = 700, H = 200, PAD = 45;
  const maxCost = Math.max(...trends.map((t) => t.cost), 0.01);
  const maxTokens = Math.max(...trends.map((t) => t.tokens), 1);
  const x = (i: number) => PAD + (i / (trends.length - 1 || 1)) * (W - PAD * 2);
  const yCost = (v: number) => H - PAD - (v / maxCost) * (H - PAD * 2);
  const costLine = trends.map((t, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${yCost(t.cost)}`).join(' ');

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16 }}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`}>
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke={C.axis} />
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke={C.axis} />
        <path d={costLine} fill="none" stroke={C.out} strokeWidth={2} />
        {trends.map((t, i) => (
          <circle key={t.day} cx={x(i)} cy={yCost(t.cost)} r={3} fill={C.out}>
            <title>{t.day}: ¥{t.cost.toFixed(4)}, {fmtTokens(t.tokens)}, {t.sessions}会话</title>
          </circle>
        ))}
        <text x={PAD} y={PAD - 6} fill={C.sub} fontSize={10}>¥{maxCost.toFixed(2)}</text>
        <text x={PAD} y={H - PAD + 14} fill={C.sub} fontSize={10}>{trends[0]?.day || ''}</text>
        <text x={W - PAD} y={H - PAD + 14} fill={C.sub} fontSize={10} textAnchor="end">{trends[trends.length - 1]?.day || ''}</text>
      </svg>
      <div style={{ display: 'flex', gap: 16, fontSize: 11, marginTop: 6, color: C.sub }}>
        <span><span style={{ color: C.out, fontWeight: 600 }}>━</span> Daily Cost（¥）</span>
        <span>共 {trends.length} 天</span>
      </div>
    </div>
  );
}

function modelColor(model: string): string {
  if (!modelColorMap.has(model)) {
    modelColorMap.set(model, MODEL_PALETTE[modelColorIdx % MODEL_PALETTE.length]);
    modelColorIdx++;
  }
  return modelColorMap.get(model)!;
}
