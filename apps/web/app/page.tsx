'use client';

import type { SessionSummary } from '@agent-profile/core';
import { useCallback, useEffect, useState } from 'react';
import { API, TRANSCRIPT_SCAN_SOURCES } from './config';
import { DashboardView } from './dashboard';
import { AgentMark } from './icons';
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState('');
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [anomalyIds, setAnomalyIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<string>('time');

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch(`${API}/sessions`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSessions(await res.json());
      setError('');
      try {
        const statsRes = await fetch(`${API}/stats`);
        if (statsRes.ok) {
          const stats = await statsRes.json();
          if (stats.baseline?.anomalySessions) {
            setAnomalyIds(new Set(stats.baseline.anomalySessions));
          }
        }
      } catch {
        /* non-critical */
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'fetch failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const onScan = async () => {
    setScanning(true);
    setError('');
    setScanResult('');
    try {
      const total = { scanned: 0, imported: 0, updated: 0, skipped: 0, failed: 0 };
      const sourceResults: string[] = [];
      const sourceErrors: string[] = [];

      for (const source of TRANSCRIPT_SCAN_SOURCES) {
        try {
          const res = await fetch(`${API}/scan`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ dir: source.dir, agent: source.agent }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);

          const result = (await res.json()) as typeof total;
          total.scanned += result.scanned;
          total.imported += result.imported;
          total.updated += result.updated;
          total.skipped += result.skipped;
          total.failed += result.failed;
          sourceResults.push(`${source.label} ${result.scanned}`);
        } catch (reason: unknown) {
          total.failed++;
          sourceResults.push(`${source.label} 扫描失败`);
          sourceErrors.push(
            `${source.label}：${reason instanceof Error ? reason.message : '请求失败'}`,
          );
        }
      }

      setScanResult(
        `${sourceResults.join('、')} 个文件；新增 ${total.imported}，更新 ${total.updated}，未变化 ${total.skipped}` +
          (total.failed > 0 ? `，失败 ${total.failed}` : ''),
      );
      await fetchSessions();
      if (sourceErrors.length > 0) setError(sourceErrors.join('；'));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'scan failed');
    } finally {
      setScanning(false);
    }
  };

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
    <div style={{ display: 'flex', height: 'calc(100vh - var(--header-h))', overflow: 'hidden' }}>
      {/* ======== SIDEBAR ======== */}
      <div
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
              tip="扫描 Claude Code 与 Codex 会话目录，导入新增或变化的 transcript"
              tipAlign="start"
              style={{ flex: 1 }}
            >
              {scanning ? '扫描中…' : '重新扫描'}
            </SoftButton>
            <SoftButton
              onClick={() => {
                setLoading(true);
                fetchSessions();
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
            <Empty text="加载中…" />
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
      <div style={{ flex: 1, overflowY: 'auto', background: C.bg }}>
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
          <DashboardView onSelectSession={(id) => setSelectedId(id)} />
        )}
      </div>
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
