'use client';

import type { SessionSummary } from '@agent-profile/core';
import { useCallback, useEffect, useState } from 'react';
import { API, type ImportJobStatus } from './config';
import { DashboardView, type StatsOverview, type ToolFreq } from './dashboard';
import { loadDashboardData, loadImportStatus } from './home-data';
import { AgentMark } from './icons';
import { summarizeImport } from './import-state';
import { AGENT_COLORS, AGENT_LABELS, C, FS, fmtAgo, R, SP } from './theme';
import { Chip, Empty, Notice, SoftButton, TokenStrip } from './ui';

function projectOf(filePath: string): string {
  const parts = filePath.split('/');
  const idx = parts.indexOf('projects');
  if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
  return parts[parts.length - 2] || 'unknown';
}

function decodeProject(p: string): string {
  if (p.startsWith('-')) return `/${p.slice(1).replace(/-/g, '/')}`;
  return p;
}

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
  const [sortBy, setSortBy] = useState<string>('time');

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

  const scanning = importStatus?.active ?? false;

  const filtered = sessions
    .filter((s) => agentFilter === 'all' || s.agent === agentFilter)
    .filter(
      (s) =>
        !search ||
        (s.name || '').toLowerCase().includes(search.toLowerCase()) ||
        (s.cwd || '').toLowerCase().includes(search.toLowerCase()) ||
        s.id.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => {
      switch (sortBy) {
        case 'cost':
          return b.totalCost - a.totalCost;
        case 'tokens':
          return (
            b.inputTokens +
            b.cacheCreationTokens +
            b.cacheReadTokens +
            b.outputTokens -
            (a.inputTokens + a.cacheCreationTokens + a.cacheReadTokens + a.outputTokens)
          );
        case 'cache':
          return a.cacheHitRate - b.cacheHitRate;
        case 'duration':
          return (b.endTime || 0) - b.startTime - ((a.endTime || 0) - a.startTime);
        default:
          return b.startTime - a.startTime;
      }
    });

  const groups = new Map<string, SessionSummary[]>();
  for (const s of filtered) {
    const p = s.cwd || decodeProject(projectOf(s.filePath));
    const arr = groups.get(p);
    if (arr) arr.push(s);
    else groups.set(p, [s]);
  }
  const projectList = [...groups.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  );

  const agentCounts = new Map<string, number>();
  agentCounts.set('all', sessions.length);
  for (const s of sessions) agentCounts.set(s.agent, (agentCounts.get(s.agent) || 0) + 1);
  const agents = ['all', ...new Set(sessions.map((s) => s.agent))];

  const selected = sessions.find((x) => x.id === selectedId);

  return (
    <div
      className="home-shell"
      style={{ display: 'flex', height: 'calc(100vh - var(--header-h))', overflow: 'hidden' }}
    >
      {/* ======== SIDEBAR ======== */}
      <div
        className="home-sidebar"
        style={{
          width: 340,
          minWidth: 340,
          background: C.card,
          boxShadow: '1px 0 0 var(--c-borderSoft)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          zIndex: 2,
        }}
      >
        {/* 操作区:搜索 + 排序 + 扫描 */}
        <div
          style={{
            padding: `${SP.md}px ${SP.lg}px ${SP.sm}px`,
            display: 'flex',
            flexDirection: 'column',
            gap: SP.sm,
          }}
        >
          <div style={{ display: 'flex', gap: SP.sm }}>
            <input
              placeholder="搜索名称 / 路径 / id…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                flex: 1,
                padding: '6px 12px',
                fontSize: FS.sm,
                minWidth: 0,
                border: `1px solid ${C.border}`,
                borderRadius: R.md,
                background: C.bg,
                color: C.text,
                outline: 'none',
              }}
            />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              data-tip="列表排序方式"
              style={{
                padding: '6px 8px',
                fontSize: FS.sm,
                border: `1px solid ${C.border}`,
                borderRadius: R.md,
                background: C.bg,
                color: C.text,
                cursor: 'pointer',
              }}
            >
              <option value="time">按时间</option>
              <option value="cost">按成本</option>
              <option value="tokens">按 Token</option>
              <option value="cache">按 Cache</option>
              <option value="duration">按耗时</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: SP.sm }}>
            <SoftButton
              variant="primary"
              onClick={onScan}
              disabled={scanning}
              tip="检查 Claude Code、Codex、Zed 与 MiMo Code，导入新增或变化的会话"
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

        {/* Agent 筛选 */}
        <div
          style={{
            padding: `${SP.xs}px ${SP.lg}px ${SP.sm}px`,
            display: 'flex',
            gap: 6,
            flexWrap: 'wrap',
          }}
        >
          {agents.map((agent) => {
            const active = agentFilter === agent;
            const color = agent === 'all' ? C.link : AGENT_COLORS[agent] || AGENT_COLORS.unknown;
            return (
              <button
                key={agent}
                onClick={() => setAgentFilter(agent)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '3px 11px',
                  borderRadius: R.pill,
                  fontSize: FS.cap,
                  cursor: 'pointer',
                  border: 'none',
                  background: active ? `${color}1F` : C.bg,
                  color: active ? color : C.sub,
                  fontWeight: active ? 600 : 400,
                  transition: 'background .12s ease',
                }}
              >
                {agent !== 'all' && <AgentMark agent={agent} size={18} />}
                {agent === 'all' ? '全部' : AGENT_LABELS[agent] || agent}
                <span className="tnum" style={{ opacity: 0.65 }}>
                  {agentCounts.get(agent)}
                </span>
              </button>
            );
          })}
        </div>

        {/* Session 列表 */}
        <div style={{ flex: 1, overflowY: 'auto', paddingBottom: SP.sm }}>
          {loading ? (
            <SessionListSkeleton />
          ) : projectList.length === 0 ? (
            <Empty
              text="没有匹配的会话"
              hint={search ? '试试更换搜索词或清除筛选' : '点击「重新扫描」导入本地会话'}
            />
          ) : (
            projectList.map(([proj, ss]) => (
              <ProjectNode
                key={proj}
                project={proj}
                sessions={ss}
                selectedId={selectedId}
                onSelect={setSelectedId}
                anomalyIds={anomalyIds}
              />
            ))
          )}
        </div>

        {/* 底栏 */}
        <div
          style={{
            padding: `${SP.sm}px ${SP.lg}px`,
            boxShadow: '0 -1px 0 var(--c-borderSoft)',
            fontSize: FS.cap,
            color: C.mute,
          }}
        >
          <span className="tnum">{sessions.length}</span> 个会话 ·{' '}
          <span className="tnum">{projectList.length}</span> 个项目
        </div>
      </div>

      {/* ======== 内容区 ======== */}
      <div
        className="home-content"
        data-selected={selectedId ? 'true' : 'false'}
        style={{ flex: 1, overflowY: 'auto', background: C.bg }}
      >
        {selectedId ? (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                padding: `${SP.sm}px ${SP.lg}px`,
                background: C.card,
                boxShadow: '0 1px 0 var(--c-borderSoft)',
                display: 'flex',
                alignItems: 'center',
                gap: SP.md,
              }}
            >
              <SoftButton variant="ghost" onClick={() => setSelectedId(null)}>
                ← 返回总览
              </SoftButton>
              {selected && (
                <span
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
                    {selected.name || selected.id.slice(0, 8)}
                  </span>
                </span>
              )}
            </div>
            <iframe
              title="所选会话详情"
              src={`/session/${selectedId}?embed=1`}
              style={{ width: '100%', flex: 1, border: 'none', background: C.bg }}
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
        `正在同步：${activeSources.map((source) => source.label).join('、')}`}
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

function ProjectNode({
  project,
  sessions,
  selectedId,
  onSelect,
  anomalyIds,
}: {
  project: string;
  sessions: SessionSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  anomalyIds: Set<string>;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ marginBottom: 4 }}>
      {/* 项目分组头:暖灰粘性横带,与白色 session 行区隔 */}
      <div
        onClick={() => setOpen(!open)}
        className="ap-row"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: `6px ${SP.lg}px`,
          cursor: 'pointer',
          userSelect: 'none',
          position: 'sticky',
          top: 0,
          zIndex: 1,
          background: C.bg,
          boxShadow: `0 1px 0 ${C.borderSoft}`,
        }}
      >
        <span
          style={{
            color: C.mute,
            fontSize: 9,
            transition: 'transform .15s ease',
            transform: open ? 'none' : 'rotate(-90deg)',
          }}
        >
          ▼
        </span>
        <FolderIcon />
        <span
          className="clamp1"
          title={project}
          style={{ fontSize: FS.base, fontWeight: 600, color: C.text, flex: 1 }}
        >
          {project.split('/').pop() || project}
        </span>
        <Chip color={C.mute} tipMode="native" tip={project}>
          {sessions.length}
        </Chip>
      </div>
      {/* 行组:树状引导线 + 缩进,明确归属关系 */}
      {open && (
        <div style={{ marginLeft: 15, borderLeft: `1px solid ${C.borderSoft}` }}>
          {sessions.map((s) => (
            <SessionRow
              key={s.id}
              s={s}
              selected={selectedId === s.id}
              anomaly={anomalyIds.has(s.id)}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FolderIcon({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      style={{ flexShrink: 0, color: C.mute, display: 'block' }}
    >
      <path
        d="M1.8 4.2a1 1 0 0 1 1-1h3.1l1.4 1.8h6a1 1 0 0 1 1 1v6.3a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1V4.2Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// 双行行布局:L1 名称独占整宽;L2 = agent · 时间 · 指纹条 · 费用/标记
function SessionRow({
  s,
  selected,
  anomaly,
  onSelect,
}: {
  s: SessionSummary;
  selected: boolean;
  anomaly: boolean;
  onSelect: (id: string) => void;
}) {
  const name = s.name || s.id.slice(0, 8);
  return (
    <div
      onClick={() => onSelect(s.id)}
      className={selected ? undefined : 'ap-row'}
      style={{
        margin: '1px 8px 1px 5px',
        padding: '6px 10px',
        borderRadius: R.md,
        cursor: 'pointer',
        background: selected ? `${C.link}14` : 'transparent',
      }}
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
    </div>
  );
}
