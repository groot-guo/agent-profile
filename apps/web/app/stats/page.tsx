'use client';

import { isSessionRecordsProject } from '@agent-profile/core/project';
import { useEffect, useState } from 'react';
import { API } from '../config';
import { AgentMark, getModelIcon } from '../icons';
import { projectLabel } from '../project-label';
import { AGENT_COLORS, AGENT_LABELS, C, FS, fmtTokens, R, SP } from '../theme';
import { BarRow, Card, Empty, Notice, SectionTitle, StatCard } from '../ui';

interface StatsData {
  overview: {
    totalSessions: number;
    totalTokens: number;
    totalCost: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    avgCacheHitRate: number;
    avgPeakContext: number;
    sessionsWithCostUnknown: number;
  };
  byAgent: {
    agent: string;
    sessions: number;
    totalTokens: number;
    totalCost: number;
    avgCacheHitRate: number;
  }[];
  byProject: { cwd: string; sessions: number; totalTokens: number; totalCost: number }[];
  byModel: {
    model: string;
    kind: 'model' | 'provider_only' | 'unknown';
    rawModels: string[];
    sessions: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCost: number;
  }[];
  distribution: {
    costBins: { bin: string; min: number; max: number | null; count: number }[];
    tokenBins: { bin: string; min: number; max: number | null; count: number }[];
    modelDistribution: {
      model: string;
      kind: 'model' | 'provider_only' | 'unknown';
      rawModels: string[];
      count: number;
      tokens: number;
    }[];
    agentDistribution: { agent: string; count: number; tokens: number }[];
  };
  baseline?: {
    projects: Record<
      string,
      {
        sessions: number;
        avgCost: number;
        medCost: number;
        p95Cost: number;
        avgTokens: number;
        avgCacheHit: number;
      }
    >;
    anomalySessions: string[];
  };
  trends?: { day: string; tokens: number; cost: number; sessions: number; avgCacheHit: number }[];
}

export default function StatsPage() {
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`${API}/stats`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'failed'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Empty text="加载统计中…" />;
  if (error || !data)
    return (
      <div style={{ padding: SP.xl }}>
        <Notice kind="err">{error || '统计数据加载失败'}</Notice>
      </div>
    );

  const { overview, byAgent, byProject, byModel, distribution } = data;

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: SP.xl }}>
      <SectionTitle meta="全量消费统计">统计</SectionTitle>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: SP.md,
          marginBottom: SP.md,
        }}
      >
        <StatCard value={overview.totalSessions} label="会话数" />
        <StatCard
          value={fmtTokens(overview.totalTokens)}
          label="总 Token"
          tip="input + cache_creation + cache_read + output 合计"
        />
        <StatCard
          value={`¥${overview.totalCost.toFixed(2)}`}
          label="总成本"
          warn={overview.sessionsWithCostUnknown > 0}
          tip="按模型定价表计算;未定价模型不计入"
        />
        <StatCard
          value={`${(overview.avgCacheHitRate * 100).toFixed(1)}%`}
          label="平均 Cache 命中"
          tip="cache_read ÷ (input + cache_creation + cache_read)"
        />
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: SP.md,
          marginBottom: SP.xl,
        }}
      >
        <StatCard value={fmtTokens(overview.avgPeakContext)} label="平均峰值上下文" />
        <StatCard value={fmtTokens(overview.totalInputTokens)} label="总输入(含 cache)" />
        <StatCard value={fmtTokens(overview.totalOutputTokens)} label="总输出" />
        <StatCard
          value={`${overview.sessionsWithCostUnknown}`}
          label="未定价会话"
          warn={overview.sessionsWithCostUnknown > 0}
          tip="包含未知模型的会话,成本无法计算"
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: SP.xl }}>
        <DistCard title="成本分布" bins={distribution.costBins} color={C.out} />
        <DistCard title="Token 分布" bins={distribution.tokenBins} color={C.link} />
      </div>

      {data.trends && data.trends.length > 1 && (
        <Card title="每日趋势" meta={`共 ${data.trends.length} 天`}>
          <TrendChart trends={data.trends} />
        </Card>
      )}

      <Card title="按 Agent">
        <div style={{ display: 'flex', gap: SP.xl, alignItems: 'center', flexWrap: 'wrap' }}>
          <PieChart
            items={distribution.agentDistribution.map((a) => ({
              label: AGENT_LABELS[a.agent] || a.agent,
              value: a.tokens,
              color: AGENT_COLORS[a.agent] || C.mute,
            }))}
            size={140}
          />
          <div style={{ flex: 1, minWidth: 220 }}>
            {byAgent.map((a) => (
              <div
                key={a.agent}
                className="ap-row"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: SP.md,
                  fontSize: FS.sm,
                  padding: '6px 8px',
                  borderRadius: R.md,
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.text }}>
                  <AgentMark agent={a.agent} size={18} /> {AGENT_LABELS[a.agent] || a.agent}
                </span>
                <span className="tnum" style={{ color: C.sub, fontSize: FS.cap }}>
                  {a.sessions} 会话 · {fmtTokens(a.totalTokens)} · ¥{a.totalCost.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Card title="按项目" meta={`Top ${Math.min(10, byProject.length)}`}>
        {byProject.slice(0, 10).map((p) => (
          <div
            key={p.cwd}
            className="ap-row"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: SP.md,
              fontSize: FS.sm,
              padding: '6px 8px',
              borderRadius: R.md,
            }}
          >
            <span
              className="clamp1"
              title={isSessionRecordsProject(p.cwd) ? projectLabel(p.cwd) : p.cwd}
              style={{ color: C.text, minWidth: 0, flex: 1 }}
            >
              {isSessionRecordsProject(p.cwd) ? projectLabel(p.cwd) : p.cwd}
            </span>
            <span className="tnum" style={{ color: C.sub, flexShrink: 0, fontSize: FS.cap }}>
              {p.sessions} 会话 · {fmtTokens(p.totalTokens)} · ¥{p.totalCost.toFixed(2)}
            </span>
          </div>
        ))}
      </Card>

      {data.baseline && Object.keys(data.baseline.projects).length > 0 && (
        <Card title="项目基线与异常">
          {Object.entries(data.baseline.projects)
            .slice(0, 10)
            .map(([proj, bl]) => (
              <div
                key={proj}
                className="ap-row"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: SP.md,
                  fontSize: FS.sm,
                  padding: '6px 8px',
                  borderRadius: R.md,
                }}
              >
                <span
                  className="clamp1"
                  title={proj}
                  style={{ color: C.text, minWidth: 0, flex: 1 }}
                >
                  {projectLabel(proj)}
                </span>
                <span className="tnum" style={{ color: C.sub, flexShrink: 0, fontSize: FS.cap }}>
                  {bl.sessions} 会话 · 中位 ¥{bl.medCost.toFixed(4)} · P95 ¥{bl.p95Cost.toFixed(4)}{' '}
                  · 均 {fmtTokens(bl.avgTokens)}
                </span>
              </div>
            ))}
          {data.baseline.anomalySessions.length > 0 && (
            <div style={{ marginTop: SP.md }}>
              <Notice kind="err">
                {data.baseline.anomalySessions.length} 个会话成本超过项目 3×
                中位数,已在会话列表中标记「异常」
              </Notice>
            </div>
          )}
        </Card>
      )}

      <Card title="按模型">
        <div style={{ display: 'flex', gap: SP.xl, alignItems: 'center', flexWrap: 'wrap' }}>
          <PieChart
            items={byModel.map((m) => ({
              label: m.model,
              value: m.totalInputTokens,
              color: modelColor(m.model),
            }))}
            size={120}
          />
          <div style={{ flex: 1, minWidth: 220 }}>
            {byModel.slice(0, 8).map((m) => (
              <div
                key={m.model}
                className="ap-row"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: SP.md,
                  fontSize: FS.sm,
                  padding: '6px 8px',
                  borderRadius: R.md,
                }}
              >
                <span
                  className="clamp1"
                  title={m.rawModels.join('\n')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    color: C.text,
                    minWidth: 0,
                  }}
                >
                  {getModelIcon(m.model, 14)} {m.model}
                  {m.kind !== 'model' && (
                    <span style={{ color: C.mute, fontSize: FS.cap }}>
                      {m.kind === 'provider_only' ? 'provider' : '未归一'}
                    </span>
                  )}
                </span>
                <span className="tnum" style={{ color: C.sub, flexShrink: 0, fontSize: FS.cap }}>
                  {m.sessions} 轮 · {fmtTokens(m.totalInputTokens)} · ¥{m.totalCost.toFixed(4)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}

function DistCard({
  title,
  bins,
  color,
}: {
  title: string;
  bins: { bin: string; count: number }[];
  color: string;
}) {
  const max = Math.max(...bins.map((b) => b.count), 1);
  return (
    <Card title={title}>
      {bins.map((b) => (
        <BarRow
          key={b.bin}
          label={b.bin}
          labelWidth={76}
          ratio={b.count / max}
          color={color}
          right={`${b.count}`}
        />
      ))}
    </Card>
  );
}

function PieChart({
  items,
  size,
}: {
  items: { label: string; value: number; color: string }[];
  size: number;
}) {
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  const r = size / 2;
  let cumAngle = -Math.PI / 2;
  const slices: { path: string; color: string; label: string; pct: string }[] = [];

  for (const item of items) {
    const angle = (item.value / total) * Math.PI * 2;
    if (angle <= 0) continue;
    const x1 = r + r * Math.cos(cumAngle);
    const y1 = r + r * Math.sin(cumAngle);
    cumAngle += angle;
    const x2 = r + r * Math.cos(cumAngle);
    const y2 = r + r * Math.sin(cumAngle);
    const largeArc = angle > Math.PI ? 1 : 0;
    slices.push({
      path: `M${r},${r} L${x1},${y1} A${r},${r} 0 ${largeArc},1 ${x2},${y2} Z`,
      color: item.color,
      label: item.label,
      pct: ((item.value / total) * 100).toFixed(1),
    });
  }

  return (
    <svg width={size + 20} height={size + 20} viewBox={`-10 -10 ${size + 20} ${size + 20}`}>
      {slices.map((s) => (
        <path
          key={`${s.label}-${s.path}`}
          d={s.path}
          fill={s.color}
          fillOpacity={0.8}
          stroke={C.card}
          strokeWidth={2}
        >
          <title>
            {s.label}: {s.pct}%
          </title>
        </path>
      ))}
    </svg>
  );
}

const MODEL_PALETTE = [C.link, C.cc, C.cr, C.out, C.medium, '#D98E4A', '#CE7350', '#6FA3D9'];
const modelColorMap = new Map<string, string>();
let modelColorIdx = 0;

function TrendChart({
  trends,
}: {
  trends: { day: string; tokens: number; cost: number; sessions: number; avgCacheHit: number }[];
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const W = 700,
    H = 200,
    PAD = 45;
  const maxCost = Math.max(...trends.map((t) => t.cost), 0.01);
  const x = (i: number) => PAD + (i / (trends.length - 1 || 1)) * (W - PAD * 2);
  const yCost = (v: number) => H - PAD - (v / maxCost) * (H - PAD * 2);
  const costLine = trends.map((t, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${yCost(t.cost)}`).join(' ');
  const areaPath = `${costLine} L${x(trends.length - 1)},${H - PAD} L${x(0)},${H - PAD} Z`;
  const active = trends[activeIndex] ?? trends[0];

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={PAD}
            y1={PAD + (H - PAD * 2) * f}
            x2={W - PAD}
            y2={PAD + (H - PAD * 2) * f}
            stroke={C.grid}
            strokeWidth={1}
          />
        ))}
        <path d={areaPath} fill={C.out} fillOpacity={0.12} />
        <path d={costLine} fill="none" stroke={C.out} strokeWidth={2} strokeLinejoin="round" />
        {trends.map((t, i) => (
          <circle
            key={t.day}
            cx={x(i)}
            cy={yCost(t.cost)}
            r={i === activeIndex ? 5 : 3.5}
            fill={C.out}
            stroke={C.card}
            strokeWidth={1.5}
            tabIndex={0}
            aria-label={`${t.day}: 成本 ¥${t.cost.toFixed(4)}，${fmtTokens(t.tokens)} Token，${t.sessions} 会话`}
            onMouseEnter={() => setActiveIndex(i)}
            onFocus={() => setActiveIndex(i)}
          >
            <title>
              {t.day}: ¥{t.cost.toFixed(4)}, {fmtTokens(t.tokens)}, {t.sessions} 会话
            </title>
          </circle>
        ))}
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke={C.axis} />
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke={C.axis} />
        <text x={PAD} y={PAD - 6} fill={C.sub} fontSize={10}>
          ¥{maxCost.toFixed(2)}
        </text>
        <text x={PAD} y={H - PAD + 14} fill={C.sub} fontSize={10}>
          {trends[0]?.day || ''}
        </text>
        <text x={W - PAD} y={H - PAD + 14} fill={C.sub} fontSize={10} textAnchor="end">
          {trends[trends.length - 1]?.day || ''}
        </text>
      </svg>
      <div
        style={{ display: 'flex', gap: SP.lg, fontSize: FS.cap, marginTop: SP.xs, color: C.sub }}
      >
        <span>
          <span style={{ color: C.out, fontWeight: 600 }}>━</span> 每日成本(¥)
        </span>
        {active && (
          <span className="tnum" style={{ color: C.text }}>
            {active.day} · ¥{active.cost.toFixed(4)} · {fmtTokens(active.tokens)} ·{' '}
            {active.sessions} 会话 · Cache {(active.avgCacheHit * 100).toFixed(1)}%
          </span>
        )}
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
