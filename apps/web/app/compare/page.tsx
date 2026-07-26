'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { API } from '../config';
import { getAgentIcon } from '../icons';
import { C, fmtDuration, fmtTokens } from '../theme';

interface CompareSession {
  id: string; name?: string; agent: string; filePath: string;
  startTime: number; endTime?: number; cwd?: string;
  inputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; outputTokens: number;
  totalCost: number; costUnknownCount: number;
  peakContextTokens: number; avgContextTokens: number;
  cacheHitRate: number; messageCount: number;
  turnCount: number; toolCount: number; duration: number; totalTokens: number;
}

export default function ComparePage() {
  const searchParams = useSearchParams();
  const ids = searchParams.get('ids') || '';
  const [sessions, setSessions] = useState<CompareSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!ids) { setLoading(false); return; }
    fetch(`${API}/sessions/compare?ids=${ids}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => setSessions(d.sessions || []))
      .catch((e) => setError(e instanceof Error ? e.message : 'failed'))
      .finally(() => setLoading(false));
  }, [ids]);

  if (loading) return <div style={{ padding: 24, color: C.sub }}>Loading…</div>;
  if (error) return <div style={{ padding: 24, color: C.high }}>{error}</div>;
  if (sessions.length < 2) return <div style={{ padding: 24 }}><Link href="/" style={{ color: C.link }}>← Back</Link><div style={{ color: C.sub, marginTop: 16 }}>需要 2 个 session：在 URL 中加 ?ids=ID1,ID2</div></div>;

  const rows = [
    { label: 'Agent', key: 'agent' as const, fmt: (v: string) => <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{getAgentIcon(v, 14)} {v}</span> },
    { label: 'Duration', key: 'duration' as const, fmt: (v: number) => fmtDuration(v) },
    { label: 'Messages', key: 'messageCount' as const, fmt: (v: number) => `${v}` },
    { label: 'LLM Turns', key: 'turnCount' as const, fmt: (v: number) => `${v}` },
    { label: 'Tool Calls', key: 'toolCount' as const, fmt: (v: number) => `${v}` },
    { label: 'Input Tokens', key: 'inputTokens' as const, fmt: (v: number) => fmtTokens(v) },
    { label: 'Cache Read Tokens', key: 'cacheReadTokens' as const, fmt: (v: number) => fmtTokens(v) },
    { label: 'Output Tokens', key: 'outputTokens' as const, fmt: (v: number) => fmtTokens(v) },
    { label: 'Total Tokens', key: 'totalTokens' as const, fmt: (v: number) => fmtTokens(v) },
    { label: 'Peak Context', key: 'peakContextTokens' as const, fmt: (v: number) => fmtTokens(v) },
    { label: 'Avg Context', key: 'avgContextTokens' as const, fmt: (v: number) => fmtTokens(v) },
    { label: 'Cache Hit Rate', key: 'cacheHitRate' as const, fmt: (v: number) => `${(v * 100).toFixed(1)}%` },
    { label: 'Cost', key: 'totalCost' as const, fmt: (v: number, s: CompareSession) => s.costUnknownCount > 0 ? '—' : `¥${v.toFixed(4)}` },
  ];

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
      <Link href="/" style={{ color: C.link, fontSize: 13, textDecoration: 'none' }}>← Sessions</Link>
      <h2 style={{ margin: '8px 0 16px', fontSize: 20, fontWeight: 700, color: C.text }}>Session Compare</h2>

      <div style={{ display: 'grid', gridTemplateColumns: `40px 200px repeat(${sessions.length}, 1fr)`, gap: 0, fontSize: 12 }}>
        {/* Headers */}
        <div style={{ padding: '6px 8px', color: C.sub, fontWeight: 600, borderBottom: `2px solid ${C.border}` }}>#</div>
        <div style={{ padding: '6px 8px', color: C.sub, fontWeight: 600, borderBottom: `2px solid ${C.border}` }}>Metric</div>
        {sessions.map((s, i) => (
          <div key={s.id} style={{ padding: '6px 8px', fontWeight: 700, color: C.text, borderBottom: `2px solid ${C.border}` }}>
            {getAgentIcon(s.agent, 14)} {s.name || s.id.slice(0, 8)}
          </div>
        ))}

        {/* Rows */}
        {rows.map((row) => {
          const values = sessions.map((s) => s[row.key] as number | string);
          const numValues = values.map((v) => typeof v === 'string' ? 0 : v as number);
          const maxVal = Math.max(...numValues, 1);
          return (
            <div key={row.label} style={{ display: 'contents' }}>
              <div style={{ padding: '5px 8px', color: C.mute, borderBottom: `1px solid ${C.borderSoft}` }}></div>
              <div style={{ padding: '5px 8px', color: C.sub, borderBottom: `1px solid ${C.borderSoft}` }}>{row.label}</div>
              {sessions.map((s, i) => {
                const v = s[row.key] as number;
                const isNumeric = typeof v === 'number';
                const ratio = isNumeric && maxVal > 0 ? v / maxVal : 0;
                return (
                  <div key={s.id} style={{
                    padding: '5px 8px', borderBottom: `1px solid ${C.borderSoft}`,
                    background: isNumeric && row.key !== 'cacheHitRate'
                      ? `linear-gradient(to right, ${C.link}14 ${ratio * 100}%, transparent ${ratio * 100}%)`
                      : 'transparent',
                  }}>
                    <span style={{ color: C.text, fontWeight: row.key === 'totalCost' || row.key === 'totalTokens' ? 600 : 400 }}>
                      {row.fmt(v as never, s)}
                    </span>
                    {isNumeric && sessions.length > 1 && (
                      <span style={{ fontSize: 10, marginLeft: 4, color: i === numValues.indexOf(maxVal) ? C.cr : C.mute }}>
                        {i === numValues.indexOf(maxVal) ? 'max' : i === numValues.lastIndexOf(Math.min(...numValues)) ? 'min' : ''}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
