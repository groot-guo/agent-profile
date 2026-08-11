'use client';

import type { HomeStatisticsResponse, SessionDiscoveryPage } from '@agent-profile/contracts';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { API, type DataManagementSummary, type ImportJobStatus } from './config';
import { DashboardView } from './dashboard';
import { DataManagementDialog } from './data-management-dialog';
import {
  loadHomeStatistics,
  loadImportStatus,
  loadSessionDiscovery,
  waitForSessionUpdates,
} from './home-data';
import { AgentMark } from './icons';
import { ImportProgressPanel } from './import-progress';
import { canResetData, summarizeImport, summarizeReset } from './import-state';
import { ProjectPicker } from './project-picker';
import { activityStateAt, groupSessionsWithActivity } from './session-activity';
import {
  isCurrentSessionDetailStatus,
  parseSessionDetailNavigation,
  parseSessionDetailStatus,
  type SessionDetailStatus,
} from './session-detail-transition';
import {
  ChevronGlyph,
  MoreGlyph,
  SearchGlyph,
  SessionDetailLoading,
  SessionListSkeleton,
  SessionRow,
} from './session-list-ui';
import {
  DEFAULT_SESSION_NAVIGATION,
  parseSessionNavigation,
  projectPickerOptionsFromFacets,
  type SessionQuickView,
  type SessionSort,
  type SessionTimeRange,
  serializeSessionNavigation,
  sessionDisplayTitle,
  sessionProject,
  writeSessionSelectionHistory,
} from './session-navigation';
import { AGENT_COLORS, AGENT_LABELS, C, FS, SP } from './theme';
import { Empty, Notice, SoftButton } from './ui';

const SESSION_SCROLL_KEY = 'agent-profile:session-list-scroll';

export default function HomePage() {
  const [discovery, setDiscovery] = useState<SessionDiscoveryPage | null>(null);
  const [homeStatistics, setHomeStatistics] = useState<HomeStatisticsResponse | null>(null);
  const [importStatus, setImportStatus] = useState<ImportJobStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [statisticsLoading, setStatisticsLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [scanResult, setScanResult] = useState('');
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SessionSort>('time');
  const [projectFilter, setProjectFilter] = useState('');
  const [timeRange, setTimeRange] = useState<SessionTimeRange>('all');
  const [quickView, setQuickView] = useState<SessionQuickView>('all');
  const [showSecondaryFilters, setShowSecondaryFilters] = useState(false);
  const [navigationReady, setNavigationReady] = useState(false);
  const [showDataManagement, setShowDataManagement] = useState(false);
  const [showCompactImport, setShowCompactImport] = useState(false);
  const [dataSummary, setDataSummary] = useState<DataManagementSummary | null>(null);
  const [resetConfirmation, setResetConfirmation] = useState('');
  const [resetting, setResetting] = useState(false);
  const [activityNow, setActivityNow] = useState(() => Date.now());
  const [detailStatus, setDetailStatus] = useState<{
    id: string | null;
    status: SessionDetailStatus | 'loading';
  }>({ id: null, status: 'loading' });
  const sessionListRef = useRef<HTMLElement | null>(null);
  const actionMenuRef = useRef<HTMLDetailsElement | null>(null);
  const detailFrameRef = useRef<HTMLIFrameElement | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const discoveryRequestRef = useRef(0);
  const sessionUpdateVersionRef = useRef(0);
  const deferredSearch = useDeferredValue(search);
  selectedIdRef.current = selectedId;

  const fetchHomeStatistics = useCallback(async () => {
    setHomeStatistics(await loadHomeStatistics(API));
    setError('');
  }, []);

  const fetchImportStatus = useCallback(async () => {
    const status = await loadImportStatus(API);
    setImportStatus(status);
    return status;
  }, []);

  const refreshSessionDiscovery = useCallback(
    async (cursor?: string, append = false, silent = false) => {
      const requestId = ++discoveryRequestRef.current;
      if (append) setLoadingMore(true);
      else if (!silent) {
        setLoading(true);
        setDiscovery(null);
      }
      try {
        const page = await loadSessionDiscovery(
          API,
          {
            query: deferredSearch,
            project: projectFilter,
            agent: agentFilter,
            timeRange,
            sort: sortBy,
            quickView,
            selectedId: selectedIdRef.current,
          },
          cursor,
        );
        if (requestId !== discoveryRequestRef.current) return;
        setDiscovery((current) =>
          append && current
            ? {
                ...page,
                sessions: [...current.sessions, ...page.sessions],
                selectedSession: page.selectedSession ?? current.selectedSession,
              }
            : page,
        );
        setError('');
      } catch (reason: unknown) {
        if (requestId === discoveryRequestRef.current) {
          setError(reason instanceof Error ? reason.message : '会话加载失败');
        }
      } finally {
        if (requestId === discoveryRequestRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [agentFilter, deferredSearch, projectFilter, quickView, sortBy, timeRange],
  );

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([fetchHomeStatistics(), fetchImportStatus()]).then((results) => {
      if (cancelled) return;
      const failure = results.find((result) => result.status === 'rejected');
      if (failure?.status === 'rejected') {
        setError(failure.reason instanceof Error ? failure.reason.message : '加载失败');
      }
      setStatisticsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchHomeStatistics, fetchImportStatus]);

  useEffect(() => {
    if (!importStatus?.active) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const status = await fetchImportStatus();
        if (!status.active && !cancelled) {
          await Promise.all([fetchHomeStatistics(), refreshSessionDiscovery()]);
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
  }, [importStatus?.active, fetchHomeStatistics, fetchImportStatus, refreshSessionDiscovery]);

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
      setShowSecondaryFilters(state.agent !== 'all' || state.quickView !== 'all');
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
    if (!navigationReady) return;
    void refreshSessionDiscovery();
  }, [navigationReady, refreshSessionDiscovery]);

  useEffect(() => {
    if (!navigationReady) return;
    const controller = new AbortController();
    let version = sessionUpdateVersionRef.current;
    const observe = async () => {
      while (!controller.signal.aborted) {
        try {
          const update = await waitForSessionUpdates(API, version, controller.signal);
          if (controller.signal.aborted) return;
          const changed = update.version > version;
          version = update.version;
          sessionUpdateVersionRef.current = version;
          setActivityNow(update.observedAt);
          if (changed) {
            await Promise.all([
              fetchHomeStatistics(),
              refreshSessionDiscovery(undefined, false, true),
            ]);
          }
        } catch (reason: unknown) {
          if (controller.signal.aborted) return;
          setError(
            `实时更新已暂停：${reason instanceof Error ? reason.message : '更新通道不可用'}`,
          );
          return;
        }
      }
    };
    void observe();
    return () => controller.abort();
  }, [fetchHomeStatistics, navigationReady, refreshSessionDiscovery]);

  useEffect(() => {
    const closeMenu = (event: MouseEvent) => {
      if (!actionMenuRef.current?.contains(event.target as Node)) {
        actionMenuRef.current?.removeAttribute('open');
      }
    };
    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') actionMenuRef.current?.removeAttribute('open');
    };
    document.addEventListener('pointerdown', closeMenu);
    document.addEventListener('keydown', closeMenuOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeMenu);
      document.removeEventListener('keydown', closeMenuOnEscape);
    };
  }, []);

  useEffect(() => {
    if (!scanResult) return;
    const timer = window.setTimeout(() => setScanResult(''), 5000);
    return () => window.clearTimeout(timer);
  }, [scanResult]);

  useEffect(() => {
    if (selectedId || !navigationReady) return;
    const saved = Number(window.sessionStorage.getItem(SESSION_SCROLL_KEY) ?? 0);
    window.requestAnimationFrame(() => {
      if (sessionListRef.current) sessionListRef.current.scrollTop = saved;
    });
  }, [navigationReady, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    setDetailStatus({ id: selectedId, status: 'loading' });
  }, [selectedId]);

  useEffect(() => {
    const receiveDetailStatus = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== detailFrameRef.current?.contentWindow) return;
      const status = parseSessionDetailStatus(event.data);
      if (!status || !isCurrentSessionDetailStatus(status, selectedId)) return;
      setDetailStatus({ id: status.id, status: status.status });
    };
    window.addEventListener('message', receiveDetailStatus);
    return () => window.removeEventListener('message', receiveDetailStatus);
  }, [selectedId]);

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
      setShowDataManagement(false);
      if (!status.active) {
        await Promise.all([fetchHomeStatistics(), refreshSessionDiscovery()]);
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
      setShowDataManagement(false);
      window.requestAnimationFrame(() => actionMenuRef.current?.querySelector('summary')?.focus());
      if (!status.active) {
        await Promise.all([fetchHomeStatistics(), refreshSessionDiscovery()]);
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

  const openDataManagement = async () => {
    actionMenuRef.current?.removeAttribute('open');
    setShowDataManagement(true);
    setDataSummary(null);
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
      await Promise.all([
        fetchHomeStatistics(),
        refreshSessionDiscovery(),
        fetchImportStatus(),
        loadDataSummary(),
      ]);
      setScanResult(summarizeReset(result.deleted));
      setShowDataManagement(false);
      window.requestAnimationFrame(() => actionMenuRef.current?.querySelector('summary')?.focus());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'reset failed');
    } finally {
      setResetting(false);
    }
  };

  const scanning = importStatus?.active ?? false;
  const importHasFailures =
    importStatus?.sources.some((source) => source.state === 'failed') ?? false;

  useEffect(() => {
    if (importHasFailures && !scanning) {
      setShowCompactImport(true);
      return;
    }
    if (!scanning) {
      setShowCompactImport(false);
      return;
    }
    const timer = window.setTimeout(() => setShowCompactImport(true), 400);
    return () => window.clearTimeout(timer);
  }, [importHasFailures, scanning]);

  const refreshDashboard = () => {
    actionMenuRef.current?.removeAttribute('open');
    setStatisticsLoading(true);
    Promise.allSettled([
      fetchHomeStatistics(),
      refreshSessionDiscovery(),
      fetchImportStatus(),
    ]).finally(() => setStatisticsLoading(false));
  };

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
  const sessions = discovery?.sessions ?? [];
  const projects = useMemo(
    () => projectPickerOptionsFromFacets(discovery?.facets.projects ?? []),
    [discovery?.facets.projects],
  );
  const timeGroups = groupSessionsWithActivity(sessions, sortBy, activityNow);

  const agentCounts = new Map<string, number>();
  agentCounts.set('all', discovery?.counts.total ?? 0);
  for (const facet of discovery?.facets.agents ?? []) {
    agentCounts.set(facet.agent, facet.count);
  }
  const agents = ['all', ...(discovery?.facets.agents.map((facet) => facet.agent) ?? [])];

  const selected =
    sessions.find((session) => session.id === selectedId) ??
    discovery?.selectedSession ??
    homeStatistics?.topByCost.find((session) => session.id === selectedId) ??
    homeStatistics?.topByTokens.find((session) => session.id === selectedId) ??
    undefined;
  const isDetailPending =
    selectedId !== null && (detailStatus.id !== selectedId || detailStatus.status === 'loading');
  const matchedCount = discovery?.counts.matched ?? 0;
  const totalCount = discovery?.counts.total ?? homeStatistics?.overview.totalSessions ?? 0;
  const remainingCount = Math.max(0, matchedCount - sessions.length);
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
  const secondaryFilterCount = [agentFilter !== 'all', quickView !== 'all'].filter(Boolean).length;

  const selectSession = useCallback(
    (id: string) => {
      if (sessionListRef.current) {
        window.sessionStorage.setItem(SESSION_SCROLL_KEY, String(sessionListRef.current.scrollTop));
      }
      const query = serializeSessionNavigation({ ...navigationState, selectedId: id });
      writeSessionSelectionHistory(
        window.history,
        query ? `${window.location.pathname}?${query}` : window.location.pathname,
      );
      setSelectedId(id);
    },
    [navigationState],
  );

  const closeSession = () => {
    if (window.history.state?.agentProfileSession) window.history.back();
    else setSelectedId(null);
  };

  useEffect(() => {
    const receiveDetailNavigation = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== detailFrameRef.current?.contentWindow) return;
      const navigation = parseSessionDetailNavigation(event.data);
      if (!navigation || navigation.fromId !== selectedId) return;
      selectSession(navigation.id);
    };
    window.addEventListener('message', receiveDetailNavigation);
    return () => window.removeEventListener('message', receiveDetailNavigation);
  }, [selectSession, selectedId]);

  const clearFilters = () => {
    setSearch('');
    setProjectFilter('');
    setAgentFilter('all');
    setTimeRange('all');
    setQuickView('all');
    setShowSecondaryFilters(false);
  };

  const showFirstRunImport = !loading && totalCount === 0 && Boolean(importStatus?.active);
  const scopeLabel =
    importStatus?.scope?.mode === 'project'
      ? `当前项目 · ${importStatus.scope.label}`
      : importStatus
        ? '全局本地数据'
        : '作用域读取中…';
  if (showFirstRunImport && importStatus) {
    return (
      <div className="first-run-import-shell">
        <ImportProgressPanel status={importStatus} mode="page" />
        {error && (
          <div className="first-run-import-error">
            <Notice kind="err" onClose={() => setError('')}>
              {error}
            </Notice>
          </div>
        )}
      </div>
    );
  }

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
              <div style={{ color: C.mute, fontSize: FS.cap, marginTop: 5 }}>{scopeLabel}</div>
            </div>
            <div className="session-filter-result" aria-live="polite">
              <strong className="tnum">{matchedCount}</strong>
              <span className="tnum">/ {totalCount}</span>
              <small>匹配会话</small>
            </div>
          </div>

          <label className="session-search">
            <span className="session-search-icon" aria-hidden="true">
              <SearchGlyph />
            </span>
            <input
              aria-label="搜索会话"
              placeholder="搜索项目、Agent 或 ID"
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
            <ProjectPicker
              options={projects}
              totalCount={totalCount}
              value={projectFilter}
              onChange={setProjectFilter}
            />
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

          <details
            className="session-secondary-filters"
            open={showSecondaryFilters}
            onToggle={(event) => setShowSecondaryFilters(event.currentTarget.open)}
          >
            <summary>
              <span>
                <strong>更多筛选</strong>
                <small>结果视图、Agent</small>
              </span>
              <span className="tnum">
                {secondaryFilterCount > 0 ? `${secondaryFilterCount} 项已启用` : '可选'}
              </span>
              <ChevronGlyph />
            </summary>
            <div className="session-secondary-filter-body">
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

              <div className="session-filter-section-head session-agent-heading">
                <span>Agent 范围</span>
                <span className="tnum">{agents.length - 1} 个来源</span>
              </div>
              <div className="session-agent-filter">
                {agents.map((agent) => {
                  const active = agentFilter === agent;
                  const color =
                    agent === 'all' ? C.link : AGENT_COLORS[agent] || AGENT_COLORS.unknown;
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
                      <span className="tnum">{agentCounts.get(agent) ?? 0}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </details>
          {hasActiveFilters && (
            <button type="button" className="session-filter-clear" onClick={clearFilters}>
              清除全部筛选
            </button>
          )}
        </div>

        <div className="session-sidebar-operations">
          <div className="session-operation-actions">
            <button
              className="session-sync-button"
              type="button"
              onClick={onScan}
              disabled={scanning}
              aria-busy={scanning}
              title="检查所有可用来源，导入新增或变化的 Session"
            >
              {scanning && <span className="session-sync-spinner" aria-hidden="true" />}
              <span>{scanning ? '同步中' : '同步数据'}</span>
            </button>
            <details className="session-action-menu" ref={actionMenuRef}>
              <summary aria-label="更多数据操作" title="更多数据操作">
                <MoreGlyph />
              </summary>
              <div className="session-action-menu-popover">
                <button type="button" onClick={refreshDashboard}>
                  <strong>刷新显示</strong>
                  <span>重新读取当前列表，不扫描来源文件</span>
                </button>
                <button type="button" onClick={openDataManagement} disabled={scanning || resetting}>
                  <strong>数据管理</strong>
                  <span>强制重建或清空本地生成数据</span>
                </button>
              </div>
            </details>
          </div>
          {showCompactImport && importStatus && (
            <ImportProgressPanel status={importStatus} mode="compact" />
          )}
          {scanResult && (
            <div className="session-operation-notice">
              <Notice kind="ok" onClose={() => setScanResult('')}>
                {scanResult}
              </Notice>
            </div>
          )}
          {error && (
            <div className="session-operation-notice">
              <Notice kind="err" onClose={() => setError('')}>
                {error}
              </Notice>
            </div>
          )}
        </div>

        {/* Session 列表 */}
        <section ref={sessionListRef} aria-label="最近会话列表" className="session-list">
          {loading ? (
            <SessionListSkeleton />
          ) : sessions.length === 0 ? (
            <Empty
              text="没有匹配的会话"
              hint={hasActiveFilters ? '试试清除筛选条件' : '点击「同步数据」导入本地会话'}
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
                      anomaly={session.isAnomaly}
                      activityState={activityStateAt(session, activityNow)}
                      onSelect={selectSession}
                    />
                  ))}
                </section>
              ))}
              {discovery?.page.hasMore && discovery.page.nextCursor && (
                <div style={{ padding: `${SP.sm}px ${SP.lg}px` }}>
                  <SoftButton
                    onClick={() =>
                      void refreshSessionDiscovery(discovery.page.nextCursor ?? undefined, true)
                    }
                    disabled={loadingMore}
                    style={{ width: '100%' }}
                  >
                    {loadingMore ? '正在加载…' : `加载更多 · 尚有 ${remainingCount} 个会话`}
                  </SoftButton>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {/* ======== 内容区 ======== */}
      <div
        className="home-content"
        data-selected={selectedId ? 'true' : 'false'}
        style={{
          display: 'flex',
          flex: 1,
          flexDirection: 'column',
          overflowY: 'auto',
          background: C.bg,
        }}
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
                  <span className="clamp1" title={sessionDisplayTitle(selected)}>
                    {sessionDisplayTitle(selected)}
                  </span>
                </span>
              )}
            </div>
            <div className="session-detail-view">
              <iframe
                key={selectedId}
                ref={detailFrameRef}
                className="session-detail-iframe"
                title="所选会话详情"
                src={`/session/${selectedId}?embed=1`}
                style={{ background: C.bg }}
                aria-busy={isDetailPending}
                onError={() => setDetailStatus({ id: selectedId, status: 'error' })}
              />
              {isDetailPending && (
                <SessionDetailLoading
                  title={selected ? sessionDisplayTitle(selected) : undefined}
                />
              )}
              {detailStatus.id === selectedId && detailStatus.status === 'error' && (
                <div className="session-detail-recovery" role="status">
                  <Notice kind="err">会话详情暂时不可用；请返回总览后重新选择。</Notice>
                </div>
              )}
            </div>
          </div>
        ) : (
          <DashboardView
            overview={homeStatistics?.overview ?? null}
            toolFreqs={homeStatistics?.recentTools ?? []}
            topByCost={homeStatistics?.topByCost ?? []}
            topByTokens={homeStatistics?.topByTokens ?? []}
            agentCounts={discovery?.facets.agents ?? []}
            loading={statisticsLoading || loading}
            importStatus={importStatus}
            onStartImport={onScan}
            onSelectSession={selectSession}
          />
        )}
      </div>
      <DataManagementDialog
        open={showDataManagement}
        summary={dataSummary}
        scanning={scanning}
        resetting={resetting}
        confirmation={resetConfirmation}
        onConfirmationChange={setResetConfirmation}
        onClose={() => {
          setShowDataManagement(false);
          setResetConfirmation('');
          window.requestAnimationFrame(() =>
            actionMenuRef.current?.querySelector('summary')?.focus(),
          );
        }}
        onRebuild={onRebuild}
        onReset={onReset}
      />
    </div>
  );
}
