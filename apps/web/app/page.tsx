'use client';

import type { SessionSummary } from '@agent-profile/core';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { API, DEFAULT_SCAN_DIR } from './config';
import { AGENT_COLORS, AGENT_LABELS, C, fmtDuration, fmtTokens } from './theme';

// 从 filePath 提取 project（~/.claude/projects/<project>/<file>.jsonl）
function projectOf(filePath: string): string {
  const parts = filePath.split('/');
  const idx = parts.indexOf('projects');
  if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
  return parts[parts.length - 2] || 'unknown';
}

// Claude Code project 目录名是 cwd 路径的 / → -，还原可读路径
function decodeProject(p: string): string {
  if (p.startsWith('-')) return `/${p.slice(1).replace(/-/g, '/')}`;
  return p;
}

export default function HomePage() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dir, setDir] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState('');

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

  // 首次加载 + 手动刷新（不再轮询）
  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const onScan = async () => {
    setScanning(true);
    setError('');
    setScanResult('');
    try {
      const res = await fetch(`${API}/scan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dir: dir || DEFAULT_SCAN_DIR }),
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

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 26, fontWeight: 700, color: C.text }}>
          Agent <span style={{ color: C.link }}>Profile</span>
        </h1>
        <p style={{ margin: 0, fontSize: 13, color: C.sub }}>
          Claude Code session transcript 的离线分析：Token · Cost · 调用链 · 诊断
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          value={dir}
          onChange={(e) => setDir(e.target.value)}
          placeholder={`transcript 目录，如 /Users/you/.claude/projects（留空默认 ${DEFAULT_SCAN_DIR}）`}
          style={{
            flex: 1,
            padding: '8px 12px',
            background: C.card,
            color: C.text,
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            fontSize: 13,
            outline: 'none',
          }}
          onKeyDown={(e) => e.key === 'Enter' && onScan()}
        />
        <button
          onClick={onScan}
          disabled={scanning}
          style={{
            padding: '8px 20px',
            background: scanning ? '#aceebb' : '#2da44e',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: scanning ? 'wait' : 'pointer',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {scanning ? 'Scanning…' : 'Scan'}
        </button>
        <button
          onClick={() => { setLoading(true); fetchSessions(); }}
          style={{
            padding: '8px 16px',
            background: C.card,
            color: C.text,
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          🔄
        </button>
      </div>

      {scanResult && (
        <div style={{ fontSize: 12, color: C.cr, marginBottom: 12 }}>✓ {scanResult}</div>
      )}
      {error && <div style={{ fontSize: 12, color: C.high, marginBottom: 12 }}>{error}</div>}

      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: C.sub,
          marginBottom: 10,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
      >
        Sessions {sessions.length > 0 && `(${sessions.length})`}
      </div>

      {loading ? (
        <div style={{ color: C.sub, padding: 40, textAlign: 'center' }}>Loading…</div>
      ) : sessions.length === 0 ? (
        <div
          style={{
            color: C.sub,
            padding: 48,
            textAlign: 'center',
            background: C.card,
            border: `1px solid ${C.borderSoft}`,
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          暂无数据。输入 Claude Code projects 目录后点 Scan 开始分析。
        </div>
      ) : (
        <ProjectGroups sessions={sessions} />
      )}
    </div>
  );
}

function ProjectGroups({ sessions }: { sessions: SessionSummary[] }) {
  const groups = new Map<string, SessionSummary[]>();
  for (const s of sessions) {
    const p = s.cwd || decodeProject(projectOf(s.filePath));
    const arr = groups.get(p);
    if (arr) arr.push(s);
    else groups.set(p, [s]);
  }
  const list = [...groups.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {list.map(([proj, ss]) => (
        <ProjectGroup key={proj} project={proj} sessions={ss} />
      ))}
    </div>
  );
}

function ProjectGroup({ project, sessions }: { project: string; sessions: SessionSummary[] }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 8,
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <span style={{ color: C.sub, fontSize: 10, width: 12 }}>{open ? '▼' : '▶'}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{project}</span>
        <span style={{ fontSize: 11, color: C.sub }}>{sessions.length} sessions</span>
      </div>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 20 }}>
          {sessions.map((s) => (
            <SessionCard key={s.id} s={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function SessionCard({ s }: { s: SessionSummary }) {
  const dur = s.endTime ? s.endTime - s.startTime : 0;
  const cache = s.cacheCreationTokens + s.cacheReadTokens;
  const total = s.inputTokens + cache + s.outputTokens || 1;
  const unknown = s.costUnknownCount > 0;
  return (
    <Link
      href={`/session/${s.id}`}
      style={{
        display: 'grid',
        gridTemplateColumns: '2.2fr 0.8fr 2fr 0.8fr',
        gap: 16,
        alignItems: 'center',
        padding: '14px 18px',
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        textDecoration: 'none',
        color: 'inherit',
        transition: 'border-color 0.15s',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <span
            style={{
              fontSize: 10,
              padding: '1px 6px',
              borderRadius: 3,
              background: (AGENT_COLORS[s.agent] || AGENT_COLORS.unknown) + '18',
              color: AGENT_COLORS[s.agent] || AGENT_COLORS.unknown,
              fontWeight: 600,
            }}
          >
            {AGENT_LABELS[s.agent] || s.agent}
          </span>
        </div>
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: C.text,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {s.name || s.id.slice(0, 8)}
        </div>
        <div style={{ fontSize: 11, color: C.sub, marginTop: 3 }}>
          {s.messageCount} msgs · {s.claudeVersion || 'unknown'}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{fmtDuration(dur)}</div>
        <div style={{ fontSize: 10, color: C.sub }}>duration</div>
      </div>

      <div>
        <div
          style={{
            display: 'flex',
            height: 7,
            borderRadius: 3,
            overflow: 'hidden',
            background: C.borderSoft,
            marginBottom: 4,
          }}
        >
          <div style={{ width: `${(s.inputTokens / total) * 100}%`, background: C.input }} />
          <div style={{ width: `${(s.cacheCreationTokens / total) * 100}%`, background: C.cc }} />
          <div style={{ width: `${(s.cacheReadTokens / total) * 100}%`, background: C.cr }} />
          <div style={{ width: `${(s.outputTokens / total) * 100}%`, background: C.out }} />
        </div>
        <div style={{ fontSize: 10, color: C.sub }}>
          <span style={{ color: C.input }}>in {fmtTokens(s.inputTokens)}</span>{' '}
          <span style={{ color: C.cr }}>cache {fmtTokens(cache)}</span>{' '}
          <span style={{ color: C.out }}>out {fmtTokens(s.outputTokens)}</span>
        </div>
      </div>

      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: unknown ? C.medium : C.text }}>
          {unknown ? '—' : `¥${s.totalCost.toFixed(4)}`}
        </div>
        <div style={{ fontSize: 10, color: unknown ? C.medium : C.sub }}>
          {unknown ? `⚠ ${s.costUnknownCount} 未定价` : 'cost'}
        </div>
      </div>
    </Link>
  );
}
