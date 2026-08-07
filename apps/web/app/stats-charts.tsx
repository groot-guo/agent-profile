import type { ProjectProfileReport } from '@agent-profile/core';
import { useMemo, useState } from 'react';
import { ProjectPicker } from './project-picker';
import { projectPickerOptionsFromSummaries } from './session-navigation';
import { C, FS, fmtTokens, SP } from './theme';
import { BarRow, Card, Chip, Empty, Notice, SectionTitle, StatCard } from './ui';

export interface StatsData {
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

export function ProjectProfileCard({
  projects,
  selectedProject,
  profile,
  loading,
  error,
  onProjectChange,
}: {
  projects: StatsData['byProject'];
  selectedProject: string;
  profile: ProjectProfileReport | null;
  loading: boolean;
  error: string;
  onProjectChange: (project: string) => void;
}) {
  const options = useMemo(
    () =>
      projectPickerOptionsFromSummaries(
        projects.map((project, index) => ({
          project: project.cwd,
          count: project.sessions,
          lastUsedAt: projects.length - index,
        })),
        0,
      ),
    [projects],
  );
  const totalCount = projects.reduce((total, project) => total + project.sessions, 0);

  return (
    <Card title="Project Profile" meta="跨 Session 过程证据">
      <div style={{ display: 'grid', gap: SP.md }}>
        {options.length === 0 ? (
          <Empty text="暂无可分析项目" hint="导入带项目目录的 Session 后即可查看 Project Profile" />
        ) : (
          <>
            <ProjectPicker
              options={options}
              totalCount={totalCount}
              value={selectedProject}
              onChange={onProjectChange}
              allowAll={false}
            />
            {loading && <Empty text="项目画像加载中…" />}
            {error && <Notice kind="err">项目画像加载失败：{error}</Notice>}
            {!loading && !error && profile && <ProjectProfileSummary profile={profile} />}
            {!loading && !error && !profile && <Empty text="暂无项目 Profile" />}
          </>
        )}
      </div>
    </Card>
  );
}

export function ProjectProfileSummary({ profile }: { profile: ProjectProfileReport }) {
  const status = (value: string) =>
    value === 'observed' ? '已观察' : value === 'partial' ? '部分覆盖' : '未采集';
  return (
    <div style={{ display: 'grid', gap: SP.md }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: SP.md,
        }}
      >
        <StatCard
          value={`${profile.scope.availableSessions}/${profile.scope.linkedSessions}`}
          label="Session 可用"
          tip={profile.scope.sampled ? '当前结果为有界采样' : '当前项目范围内的 primary Session'}
        />
        <StatCard value={fmtTokens(profile.metrics.totalTokens)} label="项目 Token" />
        <StatCard
          value={`${(profile.metrics.costCoverage.ratio * 100).toFixed(0)}%`}
          label="成本覆盖"
          warn={profile.metrics.costCoverage.ratio < 1}
          tip="未知定价 Session 不计入可信成本总额"
        />
        <StatCard
          value={
            profile.metrics.toolErrorRate == null
              ? '未采集'
              : `${(profile.metrics.toolErrorRate * 100).toFixed(1)}%`
          }
          label="工具错误率"
          warn={profile.metrics.toolErrors > 0}
        />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Chip color={C.medium}>
          来源 {profile.coverage.sources.observed}/{profile.coverage.sources.total}
        </Chip>
        <Chip color={profile.coverage.tools.status === 'observed' ? C.cr : C.medium}>
          工具 {status(profile.coverage.tools.status)}
        </Chip>
        <Chip color={C.medium}>文件 {status(profile.coverage.files.status)}</Chip>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: SP.xl }}>
        <div>
          <SectionTitle meta={`${profile.tools.length} 类工具`}>工具可靠性</SectionTitle>
          {profile.tools.slice(0, 8).map((tool) => (
            <div
              key={tool.name}
              className="ap-row"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: SP.md,
                padding: '6px 8px',
                color: C.text,
                fontSize: FS.sm,
              }}
            >
              <span className="clamp1" title={tool.name}>
                {tool.name}
              </span>
              <span className="tnum" style={{ color: C.sub, flexShrink: 0 }}>
                {tool.calls} 次 · {tool.errors} 错误
              </span>
            </div>
          ))}
          {profile.tools.length === 0 && <Empty text="未采集工具调用" />}
        </div>
        <div>
          <SectionTitle meta={`${profile.trends.length} 天`}>日趋势</SectionTitle>
          {profile.trends.slice(-7).map((trend) => (
            <div
              key={trend.day}
              className="ap-row"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: SP.md,
                padding: '6px 8px',
                color: C.sub,
                fontSize: FS.cap,
              }}
            >
              <span>{trend.day}</span>
              <span className="tnum">
                {trend.sessions} 会话 · {fmtTokens(trend.tokens)} · {trend.toolErrors} 工具错误
              </span>
            </div>
          ))}
          {profile.trends.length === 0 && <Empty text="缺少可用日期证据" />}
        </div>
      </div>
      {profile.limitations.length > 0 && (
        <Notice kind="info">{profile.limitations.slice(0, 3).join('；')}</Notice>
      )}
    </div>
  );
}

export function DistCard({
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

export function PieChart({
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

export function TrendChart({
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
