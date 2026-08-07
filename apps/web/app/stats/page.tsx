'use client';

import type { ProjectProfileReport } from '@agent-profile/core';
import { isSessionRecordsProject } from '@agent-profile/core/project';
import { useEffect, useState } from 'react';
import { API } from '../config';
import { AgentMark, getModelIcon } from '../icons';
import { projectLabel } from '../project-label';
import {
  DistCard,
  PieChart,
  ProjectProfileCard,
  type StatsData,
  TrendChart,
} from '../stats-charts';
import { AGENT_COLORS, AGENT_LABELS, C, FS, fmtTokens, R, SP } from '../theme';
import { Card, Empty, Notice, SectionTitle, StatCard } from '../ui';

export default function StatsPage() {
  const [data, setData] = useState<StatsData | null>(null);
  const [selectedProject, setSelectedProject] = useState('');
  const [projectProfile, setProjectProfile] = useState<ProjectProfileReport | null>(null);
  const [projectProfileError, setProjectProfileError] = useState('');
  const [projectProfileLoading, setProjectProfileLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`${API}/stats`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'failed'))
      .finally(() => setLoading(false));
  }, []);

  const activeProject = selectedProject || data?.byProject[0]?.cwd || '';

  useEffect(() => {
    if (!activeProject) return;
    const controller = new AbortController();
    setProjectProfileLoading(true);
    setProjectProfileError('');
    fetch(`${API}/projects/profile?project=${encodeURIComponent(activeProject)}`, {
      signal: controller.signal,
    })
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)),
      )
      .then((report: ProjectProfileReport) => setProjectProfile(report))
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setProjectProfile(null);
          setProjectProfileError(reason instanceof Error ? reason.message : '项目画像加载失败');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setProjectProfileLoading(false);
      });
    return () => controller.abort();
  }, [activeProject]);

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

      <ProjectProfileCard
        projects={byProject}
        selectedProject={activeProject}
        profile={projectProfile}
        loading={projectProfileLoading}
        error={projectProfileError}
        onProjectChange={setSelectedProject}
      />

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

const MODEL_PALETTE = [C.link, C.cc, C.cr, C.out, C.medium, '#D98E4A', '#CE7350', '#6FA3D9'];
const modelColorMap = new Map<string, string>();
let modelColorIdx = 0;

function modelColor(model: string): string {
  if (!modelColorMap.has(model)) {
    modelColorMap.set(model, MODEL_PALETTE[modelColorIdx % MODEL_PALETTE.length]);
    modelColorIdx++;
  }
  return modelColorMap.get(model) ?? MODEL_PALETTE[0];
}
