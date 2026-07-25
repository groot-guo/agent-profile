'use client';

import type { SessionSummary } from '@agent-profile/core';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { DashboardView } from './dashboard';
import { API, DEFAULT_SCAN_DIR } from './config';
import { getAgentIcon } from './icons';
import { AGENT_COLORS, AGENT_LABELS, C } from './theme';

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

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch(`${API}/sessions`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSessions(await res.json());
      setError('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'fetch failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  const onScan = async () => {
    setScanning(true);
    setError('');
    setScanResult('');
    try {
      const res = await fetch(`${API}/scan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dir: DEFAULT_SCAN_DIR }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const r = (await res.json()) as { scanned: number; imported: number; skipped: number };
      setScanResult(`扫描 ${r.scanned} 文件，新导入 ${r.imported}，跳过 ${r.skipped}`);
      fetchSessions();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'scan failed');
    } finally {
      setScanning(false);
    }
  };

  const filtered = agentFilter === 'all' ? sessions : sessions.filter((s) => s.agent === agentFilter);

  // Group by project for sidebar tree
  const groups = new Map<string, SessionSummary[]>();
  for (const s of filtered) {
    const p = s.cwd || decodeProject(projectOf(s.filePath));
    const arr = groups.get(p);
    if (arr) arr.push(s);
    else groups.set(p, [s]);
  }
  const projectList = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));

  // Agent counts for filter
  const agentCounts = new Map<string, number>();
  agentCounts.set('all', sessions.length);
  for (const s of sessions) agentCounts.set(s.agent, (agentCounts.get(s.agent) || 0) + 1);
  const agents = ['all', ...new Set(sessions.map((s) => s.agent))];

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 53px)', overflow: 'hidden' }}>
      {/* ======== SIDEBAR ======== */}
      <div style={{
        width: 320, minWidth: 320, borderRight: `1px solid ${C.border}`,
        background: C.card, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Sidebar header */}
        <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.borderSoft}`, background: C.bg }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'flex', gap: 4, flex: 1 }}>
              <button onClick={() => { setLoading(true); fetchSessions(); }}
                style={{ padding: '4px 12px', background: C.card, border: `1px solid ${C.border}`, borderRadius: 4, cursor: 'pointer', fontSize: 11, color: C.text, flex: 1 }}>
                🔄 刷新
              </button>
              <button onClick={onScan} disabled={scanning}
                style={{ padding: '4px 12px', background: scanning ? '#aceebb' : '#2da44e', color: '#fff', border: 'none', borderRadius: 4, cursor: scanning ? 'wait' : 'pointer', fontSize: 11, fontWeight: 600 }}>
                {scanning ? '...' : 'Re-scan'}
              </button>
            </div>
            <Link href="/stats"
              style={{ fontSize: 12, color: C.link, textDecoration: 'none', padding: '3px 8px', border: `1px solid ${C.border}`, borderRadius: 4 }}>📊</Link>
          </div>
          {scanResult && <div style={{ fontSize: 10, color: C.cr, marginTop: 4 }}>✓ {scanResult}</div>}
          {error && <div style={{ fontSize: 10, color: C.high, marginTop: 4 }}>{error}</div>}
        </div>

        {/* Agent filter tabs */}
        <div style={{ padding: '6px 14px', borderBottom: `1px solid ${C.borderSoft}`, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {agents.map((agent) => {
            const active = agentFilter === agent;
            const color = agent === 'all' ? C.link : AGENT_COLORS[agent] || AGENT_COLORS.unknown;
            return (
              <button key={agent} onClick={() => setAgentFilter(agent)}
                style={{
                  padding: '2px 10px', borderRadius: 12, fontSize: 11, cursor: 'pointer',
                  border: active ? `1.5px solid ${color}` : `1px solid ${C.borderSoft}`,
                  background: active ? `${color}12` : 'transparent',
                  color: active ? color : C.sub, fontWeight: active ? 600 : 400,
                }}>
                {agent !== 'all' && <span style={{ marginRight: 2 }}>{getAgentIcon(agent, 12)}</span>} {agent === 'all' ? 'All' : AGENT_LABELS[agent] || agent}
                <span style={{ marginLeft: 3, opacity: 0.6 }}>{agentCounts.get(agent)}</span>
              </button>
            );
          })}
        </div>

        {/* Session list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: 24, color: C.sub, textAlign: 'center', fontSize: 12 }}>Loading…</div>
          ) : (
            projectList.map(([proj, ss]) => (
              <ProjectNode key={proj} project={proj} sessions={ss} selectedId={selectedId} onSelect={setSelectedId} />
            ))
          )}
        </div>

        {/* Sidebar footer */}
        <div style={{ padding: '6px 14px', borderTop: `1px solid ${C.borderSoft}`, fontSize: 10, color: C.mute }}>
          {sessions.length} sessions · {projectList.length} projects
        </div>
      </div>

      {/* ======== CONTENT AREA ======== */}
      <div style={{ flex: 1, overflowY: 'auto', background: C.bg }}>
        {selectedId ? (
          <div style={{ height: '100%' }}>
            <div style={{ padding: '8px 16px', borderBottom: `1px solid ${C.border}`, background: C.card, display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={() => setSelectedId(null)}
                style={{ padding: '4px 12px', background: C.card, border: `1px solid ${C.border}`, borderRadius: 4, cursor: 'pointer', fontSize: 12, color: C.link }}>
                ← 回到主页
              </button>
              <span style={{ fontSize: 12, color: C.sub, flex: 1 }}>
                {(() => { const s = sessions.find((x) => x.id === selectedId); return s ? <>{getAgentIcon(s.agent, 14)} {s.name || s.id.slice(0, 8)}</> : ''; })()}
              </span>
            </div>
            <iframe src={`/session/${selectedId}?embed=1`}
              style={{ width: '100%', height: 'calc(100% - 37px)', border: 'none', background: C.bg }} />
          </div>
        ) : (
          <DashboardView onSelectSession={(id) => setSelectedId(id)} />
        )}
      </div>
    </div>
  );
}

function ProjectNode({ project, sessions, selectedId, onSelect }: {
  project: string; sessions: SessionSummary[]; selectedId: string | null; onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <div onClick={() => setOpen(!open)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', cursor: 'pointer', userSelect: 'none', background: C.bg }}>
        <span style={{ color: C.sub, fontSize: 9 }}>{open ? '▼' : '▶'}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          📁 {project.split('/').pop() || project}
        </span>
        <span style={{ fontSize: 10, color: C.sub }}>{sessions.length}</span>
      </div>
      {open && sessions.map((s) => (
        <div key={s.id} onClick={() => onSelect(s.id)}
          style={{
            padding: '5px 14px 5px 32px', cursor: 'pointer', fontSize: 12, color: selectedId === s.id ? C.link : C.text,
            background: selectedId === s.id ? `${C.link}0D` : 'transparent',
            borderLeft: selectedId === s.id ? `3px solid ${C.link}` : '3px solid transparent',
            display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden',
          }}>
          <span style={{ flexShrink: 0 }}>{getAgentIcon(s.agent, 13)}</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {s.name || s.id.slice(0, 8)}
          </span>
          <span style={{ fontSize: 10, color: s.costUnknownCount > 0 ? C.medium : C.sub, flexShrink: 0 }}>
            {s.costUnknownCount > 0 ? '—' : `¥${s.totalCost.toFixed(2)}`}
          </span>
        </div>
      ))}
    </div>
  );
}
