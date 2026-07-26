'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { API } from '../config';
import { getAgentIcon } from '../icons';
import { C, fmtDuration, fmtTokens, FS, SP } from '../theme';
import { Card, Empty, Notice } from '../ui';

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
  return (
    <Suspense fallback={<Empty text="加载对比中…" />}>
      <CompareView />
    </Suspense>
  );
}

function CompareView() {
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

  if (loading) return <Empty text="加载对比中…" />;
  if (error) return <div style={{ padding: SP.xl }}><Notice kind="err">{error}</Notice></div>;
  if (sessions.length < 2) {
    return (
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: SP.xl }}>
        <Link href="/" style={{ color: C.link, fontSize: FS.sm, textDecoration: 'none' }}>← 返回列表</Link>
        <Empty text="需要 2 个会话才能对比" hint="在 URL 中加 ?ids=ID1,ID2" />
      </div>
    );
  }

  const rows = [
    { label: 'Agent', key: 'agent' as const, fmt: (v: string) => <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{getAgentIcon(v, 14)} {v}</span> },
    { label: '时长', key: 'duration' as const, fmt: (v: number) => fmtDuration(v) },
    { label: '消息数', key: 'messageCount' as const, fmt: (v: number) => `${v}` },
    { label: 'LLM 轮数', key: 'turnCount' as const, fmt: (v: number) => `${v}` },
    { label: '工具调用', key: 'toolCount' as const, fmt: (v: number) => `${v}` },
    { label: 'Input Tokens', key: 'inputTokens' as const, fmt: (v: number) => fmtTokens(v) },
    { label: 'Cache Read', key: 'cacheReadTokens' as const, fmt: (v: number) => fmtTokens(v) },
    { label: 'Output Tokens', key: 'outputTokens' as const, fmt: (v: number) => fmtTokens(v) },
    { label: '总 Tokens', key: 'totalTokens' as const, fmt: (v: number) => fmtTokens(v) },
    { label: '峰值上下文', key: 'peakContextTokens' as const, fmt: (v: number) => fmtTokens(v) },
    { label: '平均上下文', key: 'avgContextTokens' as const, fmt: (v: number) => fmtTokens(v) },
    { label: 'Cache 命中率', key: 'cacheHitRate' as const, fmt: (v: number) => `${(v * 100).toFixed(1)}%` },
    { label: '成本', key: 'totalCost' as const, fmt: (v: number, s: CompareSession) => s.costUnknownCount > 0 ? '未定价' : `¥${v.toFixed(4)}` },
  ];

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: SP.xl }}>
      <Link href="/" style={{ color: C.link, fontSize: FS.sm, textDecoration: 'none' }}>← 返回列表</Link>
      <h2 style={{ margin: '6px 0 16px', fontSize: FS.page, fontWeight: 600, color: C.text }}>会话对比</h2>

      <Card pad={SP.sm}>
        <div style={{ display: 'grid', gridTemplateColumns: `180px repeat(${sessions.length}, 1fr)`, gap: 0, fontSize: FS.sm }}>
          {/* 表头 */}
          <div style={{ padding: '10px 12px', color: C.sub, fontWeight: 500, fontSize: FS.cap, boxShadow: `0 1px 0 ${C.border}` }}>指标</div>
          {sessions.map((s) => (
            <div key={s.id} style={{ padding: '10px 12px', fontWeight: 600, color: C.text, boxShadow: `0 1px 0 ${C.border}`, minWidth: 0 }}>
              <span className="clamp1" title={s.name || s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
                {getAgentIcon(s.agent, 14)} {s.name || s.id.slice(0, 8)}
              </span>
            </div>
          ))}

          {/* 数据行:数值按比例做柔和底条,max/min 标记 */}
          {rows.map((row) => {
            const values = sessions.map((s) => s[row.key] as number | string);
            const numValues = values.map((v) => typeof v === 'string' ? 0 : v as number);
            const maxVal = Math.max(...numValues, 1);
            const minVal = Math.min(...numValues);
            return (
              <div key={row.label} style={{ display: 'contents' }}>
                <div style={{ padding: '7px 12px', color: C.sub, boxShadow: `0 1px 0 ${C.borderSoft}`, fontSize: FS.cap, display: 'flex', alignItems: 'center' }}>{row.label}</div>
                {sessions.map((s, i) => {
                  const v = s[row.key] as number;
                  const isNumeric = typeof v === 'number';
                  const ratio = isNumeric && maxVal > 0 ? v / maxVal : 0;
                  return (
                    <div key={s.id} style={{
                      padding: '7px 12px', boxShadow: `0 1px 0 ${C.borderSoft}`,
                      background: isNumeric && row.key !== 'cacheHitRate'
                        ? `linear-gradient(to right, ${C.link}12 ${ratio * 100}%, transparent ${ratio * 100}%)`
                        : 'transparent',
                    }}>
                      <span className="tnum" style={{ color: C.text, fontWeight: row.key === 'totalCost' || row.key === 'totalTokens' ? 600 : 400 }}>
                        {row.fmt(v as never, s)}
                      </span>
                      {isNumeric && sessions.length > 1 && numValues[i] === maxVal && maxVal !== minVal && (
                        <span style={{ fontSize: FS.cap, marginLeft: 6, color: C.cr }}>max</span>
                      )}
                      {isNumeric && sessions.length > 1 && numValues[i] === minVal && maxVal !== minVal && (
                        <span style={{ fontSize: FS.cap, marginLeft: 6, color: C.mute }}>min</span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
