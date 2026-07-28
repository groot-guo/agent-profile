'use client';

import type { SessionSummary } from '@agent-profile/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API, type DataManagementSummary, type ImportJobStatus } from './config';
import { DashboardView, type StatsOverview, type ToolFreq } from './dashboard';
import { loadDashboardData, loadImportStatus } from './home-data';
import { AgentMark } from './icons';
import { canResetData, summarizeImport, summarizeReset } from './import-state';
import { projectLabel } from './project-label';
import {
  DEFAULT_SESSION_NAVIGATION,
  filterSessions,
  groupSessionsByTime,
  parseSessionNavigation,
  projectOptions,
  type SessionQuickView,
  type SessionSort,
  type SessionTimeRange,
  serializeSessionNavigation,
  sessionDisplayTitle,
  sessionProject,
  visibleSessionSlice,
} from './session-navigation';
import { AGENT_COLORS, AGENT_LABELS, C, FS, fmtAgo, R, SP } from './theme';
import { Chip, Empty, Notice, SoftButton, TokenStrip } from './ui';

const SESSION_RENDER_BATCH = 120;
const SESSION_SCROLL_KEY = 'agent-profile:session-list-scroll';

export default function HomePage() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [overview, setOverview] = useState<StatsOverview | null>(null);
  const [toolFreqs, setToolFreqs] = useState<ToolFreq[]>([]);
  const [importStatus, setImportStatus] = useState<ImportJobStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [scanResult, setScanResult] = useState('');
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [anomalyIds, setAnomalyIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SessionSort>('time');
  const [projectFilter, setProjectFilter] = useState('');
  const [timeRange, setTimeRange] = useState<SessionTimeRange>('all');
  const [quickView, setQuickView] = useState<SessionQuickView>('all');
  const [navigationReady, setNavigationReady] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState(SESSION_RENDER_BATCH);
  const [showDataManagement, setShowDataManagement] = useState(false);
  const [dataSummary, setDataSummary] = useState<DataManagementSummary | null>(null);
  const [resetConfirmation, setResetConfirmation] = useState('');
  const [resetting, setResetting] = useState(false);
  const sessionListRef = useRef<HTMLElement | null>(null);

  const fetchDashboardData = useCallback(async () => {
    const { sessions: sessionList, stats } = await loadDashboardData(API);
    setSessions(sessionList);
    setOverview(stats.overview);
    setToolFreqs(stats.recentTools ?? []);
    setAnomalyIds(new Set(stats.baseline?.anomalySessions ?? []));
    setError('');
  }, []);

  const fetchImportStatus = useCallback(async () => {
    const status = await loadImportStatus(API);
    setImportStatus(status);
    return status;
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([fetchDashboardData(), fetchImportStatus()]).then((results) => {
      if (cancelled) return;
      const failure = results.find((result) => result.status === 'rejected');
      if (failure?.status === 'rejected') {
        setError(failure.reason instanceof Error ? failure.reason.message : '加载失败');
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchDashboardData, fetchImportStatus]);

  useEffect(() => {
    if (!importStatus?.active) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const status = await fetchImportStatus();
        if (!status.active && !cancelled) {
          await fetchDashboardData();
          setScanResult(summarizeImport(status));
        }
      } catch (reason: unknown) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '同步状态获取失败');
      } finally {
        if (!cancelled) timer = window.setTimeout(poll, 1000);
      }
    };
    timer = window.setTimeout(poll, 1000);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [importStatus?.active, fetchDashboardData, fetchImportStatus]);

  useEffect(() => {
    const applyLocation = () => {
      const state = parseSessionNavigation(window.location.search);
      setSearch(state.query);
      setProjectFilter(state.project);
      setAgentFilter(state.agent);
      setTimeRange(state.timeRange);
      setSortBy(state.sort);
      setQuickView(state.quickView);
      setSelectedId(state.selectedId);
      setNavigationReady(true);
    };
    applyLocation();
    window.addEventListener('popstate', applyLocation);
    return () => window.removeEventListener('popstate', applyLocation);
  }, []);

  useEffect(() => {
    if (!navigationReady) return;
    const query = serializeSessionNavigation({
      query: search,
      project: projectFilter,
      agent: agentFilter,
      timeRange,
      sort: sortBy,
      quickView,
      selectedId,
    });
    const nextUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.replaceState(window.history.state, '', nextUrl);
  }, [
    agentFilter,
    navigationReady,
    projectFilter,
    quickView,
    search,
    selectedId,
    sortBy,
    timeRange,
  ]);

  useEffect(() => {
    setVisibleLimit(SESSION_RENDER_BATCH);
  }, [agentFilter, projectFilter, quickView, search, sortBy, timeRange]);

  useEffect(() => {
    if (selectedId || !navigationReady) return;
    const saved = Number(window.sessionStorage.getItem(SESSION_SCROLL_KEY) ?? 0);
    window.requestAnimationFrame(() => {
      if (sessionListRef.current) sessionListRef.current.scrollTop = saved;
    });
  }, [navigationReady, selectedId]);

  const onScan = async () => {
    setError('');
    setScanResult('');
    try {
      const response = await fetch(`${API}/imports`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const status = (await response.json()) as ImportJobStatus;
      setImportStatus(status);
      if (!status.active) {
        await fetchDashboardData();
        setScanResult(summarizeImport(status));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'scan failed');
    }
  };

  const onRebuild = async () => {
    setError('');
    setScanResult('');
    try {
      const response = await fetch(`${API}/imports/rebuild`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const status = (await response.json()) as ImportJobStatus;
      setImportStatus(status);
      if (!status.active) {
        await fetchDashboardData();
        setScanResult(summarizeImport(status));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'rebuild failed');
    }
  };

  const loadDataSummary = async () => {
    const response = await fetch(`${API}/data-management/summary`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const summary = (await response.json()) as DataManagementSummary;
    setDataSummary(summary);
    return summary;
  };

  const toggleDataManagement = async () => {
    const next = !showDataManagement;
    setShowDataManagement(next);
    if (!next || dataSummary) return;
    try {
      await loadDataSummary();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '数据摘要加载失败');
    }
  };

  const onReset = async () => {
    if (!canResetData(resetConfirmation, dataSummary)) return;
    setResetting(true);
    setError('');
    try {
      const response = await fetch(`${API}/data-management/reset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmation: resetConfirmation }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = (await response.json()) as {
        deleted: { sessions: number; spans: number; annotatedSessions: number };
      };
      setSelectedId(null);
      setResetConfirmation('');
      await Promise.all([fetchDashboardData(), fetchImportStatus(), loadDataSummary()]);
      setScanResult(summarizeReset(result.deleted));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'reset failed');
    } finally {
      setResetting(false);
    }
  };

  const scanning = importStatus?.active ?? false;

  const navigationState = useMemo(
    () => ({
      ...DEFAULT_SESSION_NAVIGATION,
      agent: agentFilter,
      project: projectFilter,
      query: search,
      timeRange,
      sort: sortBy,
      quickView,
      selectedId,
    }),
    [agentFilter, projectFilter, quickView, search, selectedId, sortBy, timeRange],
  );
  const filtered = useMemo(
    () => filterSessions(sessions, anomalyIds, navigationState),
    [anomalyIds, navigationState, sessions],
  );
  const projects = useMemo(() => projectOptions(sessions), [sessions]);
  const visibleSessions = visibleSessionSlice(filtered, visibleLimit);
  const timeGroups = groupSessionsByTime(visibleSessions);

  const agentCounts = new Map<string, number>();
  agentCounts.set('all', sessions.length);
  for (const s of sessions) agentCounts.set(s.agent, (agentCounts.get(s.agent) || 0) + 1);
  const agents = ['all', ...new Set(sessions.map((s) => s.agent))];

  const selected = sessions.find((x) => x.id === selectedId);
  const hasActiveFilters =
    Boolean(search || projectFilter) ||
    agentFilter !== 'all' ||
    timeRange !== 'all' ||
    quickView !== 'all';
  const activeFilterCount = [
    Boolean(search),
    Boolean(projectFilter),
    agentFilter !== 'all',
    timeRange !== 'all',
    quickView !== 'all',
  ].filter(Boolean).length;

  const selectSession = (id: string) => {
    if (sessionListRef.current) {
      window.sessionStorage.setItem(SESSION_SCROLL_KEY, String(sessionListRef.current.scrollTop));
    }
    const query = serializeSessionNavigation({ ...navigationState, selectedId: id });
    window.history.pushState(
      { agentProfileSession: true },
      '',
      query ? `${window.location.pathname}?${query}` : window.location.pathname,
    );
    setSelectedId(id);
  };

  const closeSession = () => {
    if (window.history.state?.agentProfileSession) window.history.back();
    else setSelectedId(null);
  };

  const clearFilters = () => {
    setSearch('');
    setProjectFilter('');
    setAgentFilter('all');
    setTimeRange('all');
    setQuickView('all');
  };

  return (
    <div
      className="home-shell"
      style={{ display: 'flex', height: 'calc(100vh - var(--header-h))', overflow: 'hidden' }}
    >
      {/* ======== SIDEBAR ======== */}
      <div className="home-sidebar">
        <div className="session-filter-console">
          <div className="session-filter-heading">
            <div>
              <div className="session-filter-eyebrow">Session index</div>
              <h1>会话浏览</h1>
            </div>
            <div className="session-filter-result" aria-live="polite">
              <strong className="tnum">{filtered.length}</strong>
              <span className="tnum">/ {sessions.length}</span>
              <small>匹配会话</small>
            </div>
          </div>

          <label className="session-search">
            <span className="session-search-icon" aria-hidden="true">
              <SearchGlyph />
            </span>
            <input
              aria-label="搜索会话"
              placeholder="搜索会话、项目或 ID"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label="清除搜索">
                清除
              </button>
            )}
          </label>

          <div className="session-filter-grid">
            <label className="session-filter-field session-filter-field-wide">
              <span>项目范围</span>
              <select
                aria-label="筛选项目"
                value={projectFilter}
                onChange={(event) => setProjectFilter(event.target.value)}
              >
                <option value="">全部项目 · {sessions.length}</option>
                {projects.map(({ project, count }) => (
                  <option key={project} value={project}>
                    {projectLabel(project)} · {count} — {project}
                  </option>
                ))}
              </select>
              <ChevronGlyph />
            </label>
            <label className="session-filter-field">
              <span>时间范围</span>
              <select
                aria-label="筛选最近会话"
                value={timeRange}
                onChange={(event) => setTimeRange(event.target.value as SessionTimeRange)}
              >
                <option value="all">不限时间</option>
                <option value="1d">最近 24 小时</option>
                <option value="7d">最近 7 天</option>
                <option value="30d">最近 30 天</option>
                <option value="90d">最近 90 天</option>
              </select>
              <ChevronGlyph />
            </label>
            <label className="session-filter-field">
              <span>排序方式</span>
              <select
                aria-label="会话排序方式"
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value as SessionSort)}
              >
                <option value="time">最近更新</option>
                <option value="cost">成本最高</option>
                <option value="tokens">Token 最多</option>
                <option value="cache">Cache 最低</option>
                <option value="duration">耗时最长</option>
              </select>
              <ChevronGlyph />
            </label>
          </div>

          <div className="session-filter-section-head">
            <span>结果视图</span>
            <span className="tnum">
              {hasActiveFilters ? `${activeFilterCount} 项筛选` : '无额外筛选'}
            </span>
          </div>
          <fieldset className="session-quick-view" aria-label="结果视图">
            {(
              [
                ['all', '全部'],
                ['anomaly', '异常'],
                ['unpriced', '未定价'],
              ] as Array<[SessionQuickView, string]>
            ).map(([value, label]) => {
              const active = quickView === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setQuickView(value)}
                >
                  {label}
                </button>
              );
            })}
          </fieldset>
          {hasActiveFilters && (
            <button type="button" className="session-filter-clear" onClick={clearFilters}>
              清除全部筛选
            </button>
          )}

          <div className="session-filter-section-head session-agent-heading">
            <span>Agent 范围</span>
            <span className="tnum">{agents.length - 1} 个来源</span>
          </div>
          <div className="session-agent-filter">
            {agents.map((agent) => {
              const active = agentFilter === agent;
              const color = agent === 'all' ? C.link : AGENT_COLORS[agent] || AGENT_COLORS.unknown;
              return (
                <button
                  key={agent}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setAgentFilter(agent)}
                  style={{ '--agent-color': color } as React.CSSProperties}
                >
                  {agent !== 'all' && <AgentMark agent={agent} size={18} />}
                  <span>
                    {agent === 'all'
                      ? '全部'
                      : agent === 'claude-code'
                        ? 'Claude'
                        : agent === 'mimo-code'
                          ? 'MiMo'
                          : AGENT_LABELS[agent] || agent}
                  </span>
                  <span className="tnum">{agentCounts.get(agent)}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="session-sidebar-operations">
          <div className="session-operation-actions">
            <button
              className="session-data-management-toggle"
              type="button"
              onClick={toggleDataManagement}
              disabled={scanning || resetting}
              title="强制重建分析，或在危险区清空本地生成数据"
            >
              {showDataManagement ? '收起' : '数据管理'}
            </button>
            <SoftButton
              variant="primary"
              onClick={onScan}
              disabled={scanning}
              tip="检查 Claude Code、Codex、Zed、MiMo Code 与 OpenCode，导入新增或变化的会话"
              tipAlign="start"
              style={{ flex: 1 }}
            >
              {scanning ? '扫描中…' : '重新扫描'}
            </SoftButton>
            <SoftButton
              onClick={() => {
                setLoading(true);
                Promise.allSettled([fetchDashboardData(), fetchImportStatus()]).finally(() =>
                  setLoading(false),
                );
              }}
              tip="重新加载列表(不扫描文件)"
              tipAlign="end"
              style={{ flex: 1 }}
            >
              刷新列表
            </SoftButton>
          </div>
          {showDataManagement && (
            <DataManagementPanel
              summary={dataSummary}
              scanning={scanning}
              resetting={resetting}
              confirmation={resetConfirmation}
              onConfirmationChange={setResetConfirmation}
              onRebuild={onRebuild}
              onReset={onReset}
            />
          )}
          {scanResult && (
            <Notice kind="ok" onClose={() => setScanResult('')}>
              {scanResult}
            </Notice>
          )}
          {error && (
            <Notice kind="err" onClose={() => setError('')}>
              {error}
            </Notice>
          )}
          {importStatus &&
            (importStatus.active || importStatus.sources.some((s) => s.state === 'failed')) && (
              <ImportStatusSummary status={importStatus} />
            )}
        </div>

        {/* Session 列表 */}
        <section ref={sessionListRef} aria-label="最近会话列表" className="session-list">
          {loading ? (
            <SessionListSkeleton />
          ) : filtered.length === 0 ? (
            <Empty
              text="没有匹配的会话"
              hint={hasActiveFilters ? '试试清除筛选条件' : '点击「重新扫描」导入本地会话'}
            />
          ) : (
            <>
              {timeGroups.map((group) => (
                <section key={group.key} aria-label={group.label} className="session-time-group">
                  <div className="session-time-heading">
                    <span>{group.label}</span>
                    <span className="tnum">{group.sessions.length}</span>
                  </div>
                  {group.sessions.map((session) => (
                    <SessionRow
                      key={session.id}
                      s={session}
                      project={sessionProject(session)}
                      selected={selectedId === session.id}
                      anomaly={anomalyIds.has(session.id)}
                      onSelect={selectSession}
                    />
                  ))}
                </section>
              ))}
              {visibleSessions.length < filtered.length && (
                <div style={{ padding: `${SP.sm}px ${SP.lg}px` }}>
                  <SoftButton
                    onClick={() => setVisibleLimit((limit) => limit + SESSION_RENDER_BATCH)}
                    style={{ width: '100%' }}
                  >
                    加载更多 · 尚有 {filtered.length - visibleSessions.length} 个会话
                  </SoftButton>
                </div>
              )}
            </>
          )}
        </section>

        {/* 底栏 */}
        <div className="session-list-footer">
          <span>
            已显示 <strong className="tnum">{visibleSessions.length}</strong> /{' '}
            <span className="tnum">{filtered.length}</span>
          </span>
          <span className="tnum">{projects.length} 个项目</span>
        </div>
      </div>

      {/* ======== 内容区 ======== */}
      <div
        className="home-content"
        data-selected={selectedId ? 'true' : 'false'}
        style={{ flex: 1, overflowY: 'auto', background: C.bg }}
      >
        {selectedId ? (
          <div className="session-detail-frame">
            <div
              className="session-detail-toolbar"
              style={{
                padding: `${SP.sm}px ${SP.lg}px`,
                background: C.card,
                boxShadow: '0 1px 0 var(--c-borderSoft)',
                display: 'flex',
                alignItems: 'center',
                gap: SP.md,
              }}
            >
              <SoftButton variant="ghost" onClick={closeSession}>
                ← 返回总览
              </SoftButton>
              {selected && (
                <span
                  className="session-detail-toolbar-title"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: FS.sm,
                    color: C.sub,
                    minWidth: 0,
                  }}
                >
                  <AgentMark agent={selected.agent} size={18} />
                  <span className="clamp1" title={selected.name || selected.id}>
                    {sessionDisplayTitle(selected)}
                  </span>
                </span>
              )}
            </div>
            <iframe
              className="session-detail-iframe"
              title="所选会话详情"
              src={`/session/${selectedId}?embed=1`}
              style={{ background: C.bg }}
            />
          </div>
        ) : (
          <DashboardView
            sessions={sessions}
            overview={overview}
            toolFreqs={toolFreqs}
            loading={loading}
            importStatus={importStatus}
            onStartImport={onScan}
            onSelectSession={(id) => setSelectedId(id)}
          />
        )}
      </div>
    </div>
  );
}

function DataManagementPanel({
  summary,
  scanning,
  resetting,
  confirmation,
  onConfirmationChange,
  onRebuild,
  onReset,
}: {
  summary: DataManagementSummary | null;
  scanning: boolean;
  resetting: boolean;
  confirmation: string;
  onConfirmationChange: (value: string) => void;
  onRebuild: () => void;
  onReset: () => void;
}) {
  return (
    <div
      style={{
        padding: SP.md,
        border: `1px solid ${C.border}`,
        borderRadius: R.md,
        background: C.bg,
        fontSize: FS.cap,
        color: C.sub,
        lineHeight: 1.55,
      }}
    >
      <div style={{ fontWeight: 600, color: C.text, marginBottom: SP.xs }}>推荐：强制重建分析</div>
      <div style={{ marginBottom: SP.sm }}>
        重新解析所有可用来源，即使来源指纹未变化。原有标签、备注、定价和模型窗口配置会保留；不可用来源的已有数据不会被删除。
      </div>
      <SoftButton variant="primary" onClick={onRebuild} disabled={scanning || resetting}>
        {scanning ? '任务进行中…' : '强制重建'}
      </SoftButton>

      <div
        style={{
          marginTop: SP.md,
          paddingTop: SP.md,
          borderTop: `1px solid ${C.high}55`,
          color: C.high,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: SP.xs }}>危险区：清空本地分析数据</div>
        {summary ? (
          <div style={{ marginBottom: SP.sm }}>
            将删除 {summary.sessions} 个会话和 {summary.spans} 个 Span
            {summary.annotatedSessions > 0
              ? `，其中 ${summary.annotatedSessions} 个带标签或备注`
              : ''}
            。定价、模型窗口、数据库迁移，以及 {summary.tasks} 个 Task、{summary.outcomes} 个
            Outcome、{summary.configSnapshots} 个配置快照、{summary.cohorts} 个 cohort 和{' '}
            {summary.experiments} 个 experiment 保留。操作前请停止 Server 并备份
            apps/server/trace.db（或 TRACE_DB_PATH 指定文件）。
          </div>
        ) : (
          <div style={{ marginBottom: SP.sm }}>正在读取影响范围…</div>
        )}
        {summary && (
          <>
            <input
              aria-label="本地数据重置确认"
              placeholder={`输入 ${summary.resetConfirmation}`}
              value={confirmation}
              onChange={(event) => onConfirmationChange(event.target.value)}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                marginBottom: SP.sm,
                padding: '6px 8px',
                border: `1px solid ${C.border}`,
                borderRadius: R.sm,
                background: C.card,
                color: C.text,
              }}
            />
            <SoftButton
              onClick={onReset}
              disabled={scanning || resetting || !canResetData(confirmation, summary)}
            >
              {resetting ? '正在清空…' : '永久清空生成数据'}
            </SoftButton>
          </>
        )}
      </div>
    </div>
  );
}

function ImportStatusSummary({ status }: { status: ImportJobStatus }) {
  const activeSources = status.sources.filter((source) => source.state === 'scanning');
  const failedSources = status.sources.filter((source) => source.state === 'failed');
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        padding: `${SP.sm}px ${SP.md}px`,
        borderRadius: R.md,
        background: C.bg,
        color: failedSources.length > 0 ? C.high : C.sub,
        fontSize: FS.cap,
        lineHeight: 1.6,
      }}
    >
      {activeSources.length > 0 &&
        `${status.operation === 'rebuild' ? '正在强制重建' : '正在同步'}：${activeSources
          .map((source) => source.label)
          .join('、')}`}
      {activeSources.length > 0 && failedSources.length > 0 && <br />}
      {failedSources.length > 0 &&
        `需要重试：${failedSources.map((source) => source.label).join('、')}`}
    </div>
  );
}

function SessionListSkeleton() {
  const rows = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="正在加载会话"
      style={{ padding: `0 ${SP.lg}px` }}
    >
      {rows.map((row, index) => (
        <div
          key={row}
          style={{
            height: 48,
            marginBottom: SP.sm,
            borderRadius: R.md,
            background: C.borderSoft,
            opacity: 1 - index * 0.07,
          }}
        />
      ))}
    </div>
  );
}

function SearchGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ChevronGlyph() {
  return (
    <svg
      className="session-filter-chevron"
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
    >
      <path
        d="m7 10 5 5 5-5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// 扁平三行布局:L1 名称;L2 项目;L3 agent · 时间 · 指纹条 · 费用/标记
function SessionRow({
  s,
  project,
  selected,
  anomaly,
  onSelect,
}: {
  s: SessionSummary;
  project: string;
  selected: boolean;
  anomaly: boolean;
  onSelect: (id: string) => void;
}) {
  const name = sessionDisplayTitle(s);
  return (
    <button
      type="button"
      onClick={() => onSelect(s.id)}
      className="session-row ap-row"
      data-selected={selected ? 'true' : 'false'}
      aria-current={selected ? 'true' : undefined}
    >
      <div
        className="clamp1"
        title={name}
        style={{
          fontSize: FS.sm,
          fontWeight: selected ? 600 : 400,
          color: selected ? C.link : C.text,
        }}
      >
        {name}
      </div>
      <div
        className="clamp1"
        title={project}
        style={{ marginTop: 2, color: C.mute, fontSize: FS.cap }}
      >
        {projectLabel(project)}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
        <AgentMark agent={s.agent} size={20} />
        <span className="tnum" style={{ fontSize: FS.cap, color: C.mute, flexShrink: 0 }}>
          {fmtAgo(s.startTime)}
        </span>
        <TokenStrip
          input={s.inputTokens}
          cc={s.cacheCreationTokens}
          cr={s.cacheReadTokens}
          out={s.outputTokens}
          tipMode="native"
        />
        {anomaly && (
          <Chip color={C.high} tipMode="native" tip="成本超过该项目 3× 中位数,建议查看诊断">
            异常
          </Chip>
        )}
        {s.costUnknownCount > 0 ? (
          <Chip color={C.medium} tipMode="native" tip="包含未定价模型,成本无法计算">
            未定价
          </Chip>
        ) : (
          <span className="tnum" style={{ fontSize: FS.cap, color: C.sub, flexShrink: 0 }}>
            ¥{s.totalCost.toFixed(2)}
          </span>
        )}
      </div>
    </button>
  );
}
