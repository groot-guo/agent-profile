'use client';

import type { ProjectProfileReport } from '@agent-profile/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API } from '../config';
import { waitForSessionUpdates } from '../home-data';
import { projectLabel } from '../project-label';
import { ProjectPicker } from '../project-picker';
import {
  normalizeProjectProfileReport,
  type ProjectPageMetricCoverage,
  type ProjectPageReport,
  type ProjectProfileRange,
  projectProfileUpdateState,
  projectProfileUrl,
} from '../project-profile-data';
import { projectPickerOptionsFromFacets } from '../session-navigation';
import { C, FS, fmtDuration, fmtTokens, R, SP } from '../theme';
import { BarRow, Card, Chip, Empty, Notice, StatCard } from '../ui';

interface ProjectFacetResponse {
  facets: {
    projects: Array<{ project: string; count: number; lastUsedAt: number }>;
  };
}

const RANGES: Array<{ value: ProjectProfileRange; label: string }> = [
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
  { value: '90d', label: '近 90 天' },
  { value: 'all', label: '全部记录' },
];

export default function ProjectsPage() {
  const [facets, setFacets] = useState<ProjectFacetResponse['facets']['projects']>([]);
  const [project, setProject] = useState('');
  const [range, setRange] = useState<ProjectProfileRange>('30d');
  const [report, setReport] = useState<ProjectPageReport | null>(null);
  const [error, setError] = useState('');
  const [liveError, setLiveError] = useState('');
  const [updateVersion, setUpdateVersion] = useState(0);
  const reportQueryRef = useRef('');

  const fetchProjectFacets = useCallback(async (signal?: AbortSignal): Promise<void> => {
    const response = await fetch(`${API}/session-discovery?limit=1`, { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = (await response.json()) as ProjectFacetResponse;
    setFacets(data.facets.projects);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetchProjectFacets(controller.signal).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(errorMessage(reason, '项目列表加载失败'));
    });
    return () => controller.abort();
  }, [fetchProjectFacets]);

  const projects = useMemo(() => projectPickerOptionsFromFacets(facets), [facets]);
  const totalSessions = useMemo(
    () => facets.reduce((total, facet) => total + facet.count, 0),
    [facets],
  );

  useEffect(() => {
    if (!project && projects[0]) setProject(projects[0].project);
  }, [project, projects]);

  useEffect(() => {
    if (!project) {
      setReport(null);
      return;
    }
    const controller = new AbortController();
    const query = `${project}\u0000${range}`;
    const changedQuery = reportQueryRef.current !== query;
    reportQueryRef.current = query;
    setError('');
    if (changedQuery) setReport(null);
    fetch(projectProfileUrl(API, project, range), { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<ProjectProfileReport>;
      })
      .then((data) => setReport(normalizeProjectProfileReport(data)))
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(reason, '项目画像加载失败'));
      });
    return () => controller.abort();
  }, [project, range, updateVersion]);

  useEffect(() => {
    if (!project) return;
    const controller = new AbortController();
    let version = 0;
    const observe = async () => {
      while (!controller.signal.aborted) {
        try {
          const update = await waitForSessionUpdates(API, version, controller.signal);
          if (controller.signal.aborted) return;
          const next = projectProfileUpdateState(version, update.version);
          version = next.version;
          if (!next.shouldRefresh) continue;
          setUpdateVersion(next.version);
          await fetchProjectFacets(controller.signal);
          setLiveError('');
        } catch (reason: unknown) {
          if (controller.signal.aborted) return;
          setLiveError(`实时更新已暂停：${errorMessage(reason, '更新通道不可用')}`);
          return;
        }
      }
    };
    void observe();
    return () => controller.abort();
  }, [fetchProjectFacets, project]);

  return (
    <main style={{ maxWidth: 1180, margin: '0 auto', padding: SP.xl }}>
      <ProjectIntro facets={facets.length} />
      {error && <Notice kind="err">{error}。确认本地 API 服务正在运行。</Notice>}
      {liveError && <Notice kind="info">{liveError}</Notice>}

      <Card pad={SP.lg} style={{ marginTop: SP.xl }}>
        <div style={{ display: 'flex', gap: SP.lg, flexWrap: 'wrap', alignItems: 'end' }}>
          <div style={{ flex: '1 1 360px', minWidth: 0 }}>
            <ProjectPicker
              options={projects}
              totalCount={totalSessions}
              value={project}
              onChange={setProject}
            />
          </div>
          <RangePicker range={range} onChange={setRange} />
        </div>
      </Card>

      {!project && !error && (
        <Card>
          <Empty text="还没有可分析的项目" hint="先导入至少一条带项目归属的主链 Session。" />
        </Card>
      )}
      {project && !report && !error && <Empty text="正在汇总项目运行证据…" />}
      {report && <ProjectReport report={report} />}
    </main>
  );
}

function ProjectIntro({ facets }: { facets: number }) {
  return (
    <section>
      <div
        className="tnum"
        style={{ color: C.mute, fontSize: FS.cap, letterSpacing: 0.8, marginBottom: SP.sm }}
      >
        runtime / project / observed evidence
      </div>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', gap: SP.lg, flexWrap: 'wrap' }}
      >
        <div style={{ maxWidth: 730 }}>
          <h1
            style={{ margin: 0, color: C.text, fontSize: 26, lineHeight: 1.2, letterSpacing: -0.6 }}
          >
            项目运行轨迹，不是交付判定
          </h1>
          <p
            style={{ color: C.sub, fontSize: FS.base, lineHeight: 1.75, margin: `${SP.sm}px 0 0` }}
          >
            把同一项目中已观察到的 Session
            汇成资源、工具与可靠性证据。范围、来源和字段覆盖度始终与数字一起出现；它不代表完整仓库活动，也不证明代码质量。
          </p>
        </div>
        <Chip color={C.link}>{facets} 个已观察项目</Chip>
      </div>
    </section>
  );
}

function RangePicker({
  range,
  onChange,
}: {
  range: ProjectProfileRange;
  onChange: (range: ProjectProfileRange) => void;
}) {
  return (
    <fieldset
      style={{ border: 0, margin: 0, padding: 0, display: 'flex', gap: 4, flexWrap: 'wrap' }}
    >
      <legend style={{ color: C.mute, fontSize: FS.cap, marginBottom: 4 }}>时间范围</legend>
      {RANGES.map((option) => {
        const active = option.value === range;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            style={{
              border: `1px solid ${active ? C.link : C.border}`,
              background: active ? `${C.link}14` : C.card,
              borderRadius: R.pill,
              color: active ? C.link : C.sub,
              cursor: 'pointer',
              fontSize: FS.sm,
              fontWeight: active ? 600 : 400,
              padding: '6px 10px',
            }}
          >
            {option.label}
          </button>
        );
      })}
    </fieldset>
  );
}

function ProjectReport({ report }: { report: ProjectPageReport }) {
  const project = projectLabel(report.scope.project);
  return (
    <>
      <section style={{ margin: `${SP.xl}px 0 ${SP.lg}px` }}>
        <div style={{ display: 'flex', alignItems: 'end', gap: SP.lg, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2
              className="clamp1"
              title={report.scope.project}
              style={{ margin: 0, color: C.text }}
            >
              {project}
            </h2>
            <div className="tnum" style={{ color: C.mute, fontSize: FS.cap, marginTop: 4 }}>
              {formatObservedRange(report.scope.timeRange)} · {report.schemaVersion}
            </div>
          </div>
          <div style={{ display: 'flex', gap: SP.sm, flexWrap: 'wrap' }}>
            <Chip color={C.cr}>{report.scope.sessions} 个 Session</Chip>
            <Chip color={C.medium}>文件：未采集</Chip>
          </div>
        </div>
      </section>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))',
          gap: SP.md,
          marginBottom: SP.xl,
        }}
      >
        <StatCard value={fmtTokens(report.resources.totalTokens)} label="已观察 Token" />
        <StatCard
          value={formatCost(report.resources.totalCost)}
          label="完整定价成本"
          warn={report.coverage.cost.status !== 'complete'}
          tip={coverageTip(report.coverage.cost)}
        />
        <StatCard
          value={fmtDuration(report.resources.averageDurationMs ?? undefined)}
          label="平均运行时长"
          warn={report.coverage.duration.status !== 'complete'}
          tip={coverageTip(report.coverage.duration)}
        />
        <StatCard
          value={`${report.reliability.observedToolErrors} / ${report.reliability.toolCalls}`}
          label="已观察工具错误"
          warn={report.reliability.observedToolErrors > 0}
          tip={coverageTip(report.coverage.tool)}
        />
      </div>

      <Card title="范围与覆盖" meta="每个字段独立计量">
        <div style={{ display: 'flex', gap: SP.sm, flexWrap: 'wrap', marginBottom: SP.lg }}>
          {report.scope.sourceCoverage.map((source) => (
            <Chip key={source.source} color={C.link}>
              {source.source} · {source.sessions} Session
            </Chip>
          ))}
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: SP.md,
          }}
        >
          <CoverageCard label="成本" coverage={report.coverage.cost} />
          <CoverageCard label="时长" coverage={report.coverage.duration} />
          <CoverageCard label="工具" coverage={report.coverage.tool} />
          <CoverageCard label="文件" coverage={report.coverage.file} />
        </div>
      </Card>

      <Card title="按日观察轨迹" meta="UTC 自然日；只列出有 Session 的日期">
        {report.trends.points.length === 0 ? (
          <Empty
            text="所选范围内没有主链 Session"
            hint="扩大时间范围，或确认项目归属是否被来源捕获。"
          />
        ) : (
          <div style={{ display: 'grid', gap: 0 }}>
            {report.trends.points.map((point) => (
              <div
                key={point.startTime}
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    '92px minmax(80px, 1fr) minmax(90px, 1fr) minmax(120px, 1fr)',
                  gap: SP.md,
                  alignItems: 'center',
                  borderTop: `1px solid ${C.borderSoft}`,
                  padding: `${SP.md}px 0`,
                  fontSize: FS.sm,
                }}
              >
                <strong className="tnum" style={{ color: C.text }}>
                  {formatUtcDay(point.startTime)}
                </strong>
                <div>
                  <div className="tnum" style={{ color: C.text }}>
                    {point.sessions} Session
                  </div>
                  <div style={{ color: C.mute, fontSize: FS.cap }}>
                    {fmtTokens(point.totalTokens)} Token
                  </div>
                </div>
                <div>
                  <div className="tnum" style={{ color: C.text }}>
                    {formatCost(point.totalCost)}
                  </div>
                  <div style={{ color: C.mute, fontSize: FS.cap }}>
                    {coverageTip(point.costCoverage)}
                  </div>
                </div>
                <div>
                  <div className="tnum" style={{ color: C.text }}>
                    {point.tool.observedErrors} 错误 / {point.tool.calls} 调用
                  </div>
                  <div style={{ color: C.mute, fontSize: FS.cap }}>
                    {point.tool.sessionCoverage == null
                      ? '工具会话覆盖：报告未提供'
                      : `工具证据覆盖 ${(point.tool.sessionCoverage * 100).toFixed(0)}%`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="已观察工具" meta="不是完整工具调用图">
        {report.tools.length === 0 ? (
          <Empty
            text="所选 Session 没有归一化工具调用"
            hint="这表示当前合同未观察到工具证据，不表示 Agent 没有使用工具。"
          />
        ) : (
          report.tools.map((tool) => (
            <BarRow
              key={tool.name}
              label={tool.name}
              ratio={tool.calls / Math.max(1, report.reliability.toolCalls)}
              color={tool.errors > 0 ? C.high : C.cr}
              right={`${tool.calls} 次 · ${tool.errors} 错误`}
            />
          ))
        )}
      </Card>

      <Card title="解释边界">
        <ul style={{ color: C.sub, fontSize: FS.sm, lineHeight: 1.7, margin: 0, paddingLeft: 20 }}>
          {report.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </Card>
    </>
  );
}

function CoverageCard({ label, coverage }: { label: string; coverage: ProjectPageMetricCoverage }) {
  return (
    <div
      style={{
        padding: SP.md,
        borderRadius: R.md,
        background: C.bg,
        border: `1px solid ${C.borderSoft}`,
      }}
    >
      <div style={{ color: C.text, fontSize: FS.sm, fontWeight: 600 }}>{label}</div>
      <div className="tnum" style={{ color: C.sub, fontSize: FS.cap, marginTop: 4 }}>
        {coverageTip(coverage)}
      </div>
    </div>
  );
}

function coverageTip(coverage: ProjectPageMetricCoverage): string {
  if (coverage.status === 'not_applicable') return '不适用：没有 Session';
  if (coverage.status === 'not_captured') return `未采集：0 / ${coverage.total}`;
  return `${coverage.observed} / ${coverage.total} · ${(coverage.coverage ?? 0) * 100}%`;
}

function formatObservedRange(range: { startTime: number | null; endTime: number | null }): string {
  if (range.startTime === null || range.endTime === null) return '所选范围内没有观察记录';
  return `观察范围 ${formatUtcDay(range.startTime)} — ${formatUtcDay(range.endTime)}`;
}

function formatUtcDay(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  }).format(timestamp);
}

function formatCost(cost: number): string {
  return `¥${cost.toFixed(cost >= 1 ? 2 : 4)}`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
