'use client';

import type { DiagnosisResult, SessionDetail, Span } from '@agent-profile/core';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { API } from '../../config';
import { getAgentIcon } from '../../icons';
import { C, CAT_COLOR, catOf, DIAG_LABEL, fmtBytes, fmtDuration, fmtTime, fmtTokens, SEV_COLOR } from '../../theme';

// 明细表分页每页行数
const TABLE_LIMIT = 30;

interface ContextPoint {
  startTime: number;
  contextTokens: number;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  model?: string;
  contextWindow: number | null;
}

export default function SessionPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const isEmbed = searchParams.get('embed') === '1';
  const [data, setData] = useState<SessionDetail | null>(null);
  const [ctx, setCtx] = useState<ContextPoint[]>([]);
  const [diag, setDiag] = useState<DiagnosisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      fetch(`${API}/session/${id}`).then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)),
      ),
      fetch(`${API}/session/${id}/context`).then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)),
      ),
      // diagnosis 为辅助层，失败不拖垮主数据展示
      fetch(`${API}/session/${id}/diagnosis`).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([d, c, dg]) => {
        setData(d);
        setCtx(c);
        setDiag(dg);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'failed'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div style={{ padding: 24, color: C.sub }}>Loading…</div>;
  if (error) return <div style={{ padding: 24, color: C.high }}>{error}</div>;
  if (!data) return null;

  const dur = data.endTime ? data.endTime - data.startTime : 0;
  const turns = data.spans.filter((s) => s.type === 'llm_turn');
  const allTools = data.spans.filter((s) => s.type === 'tool_call');
  const mainTools = allTools.filter((s) => !s.isSidechain);
  const sidechainSpans = data.spans.filter((s) => s.isSidechain);
  const sidechainTurns = sidechainSpans.filter((s) => s.type === 'llm_turn');
  const sidechainTools = sidechainSpans.filter((s) => s.type === 'tool_call');
  const sidechainTokens = sidechainTurns.reduce(
    (acc, t) => acc + t.inputTokens + t.cacheCreationTokens + t.cacheReadTokens + t.outputTokens, 0,
  );
  const sidechainCost = sidechainTurns.reduce((acc, t) => acc + t.cost, 0);

  const toolCounts = new Map<string, number>();
  for (const t of mainTools) toolCounts.set(t.name, (toolCounts.get(t.name) || 0) + 1);
  const toolBars = [...toolCounts.entries()].sort((a, b) => b[1] - a[1]);
  const maxToolCount = toolBars[0]?.[1] || 1;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 24 }}>
      {!isEmbed && (
        <Link href="/" style={{ color: C.link, fontSize: 13, textDecoration: 'none' }}>
          ← Sessions
        </Link>
      )}
      <h2 style={{ margin: '8px 0 4px', fontSize: 22, fontWeight: 600, color: C.text }}>
        {data.agent ? getAgentIcon(data.agent, 20) : null} {data.name || data.id.slice(0, 8)}
      </h2>
      <div style={{ fontSize: 12, color: C.sub, marginBottom: 16 }}>
        {data.claudeVersion || '-'} · {data.messageCount} msgs · {data.gitBranch || data.cwd || ''}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(6, 1fr)',
          gap: 10,
          marginBottom: 20,
        }}
      >
        <Metric label="时长" value={fmtDuration(dur)} />
        <Metric label="消息轮" value={`${data.messageCount}`} />
        <Metric label="工具调用" value={`${mainTools.length}${sidechainTools.length > 0 ? ` +${sidechainTools.length}` : ''}`} />
        <Metric label="峰值上下文" value={fmtTokens(data.peakContextTokens)} />
        <Metric label="cache 命中" value={`${(data.cacheHitRate * 100).toFixed(1)}%`} />
        <Metric
          label="Cost"
          value={data.costUnknownCount > 0 ? '—' : `¥${data.totalCost.toFixed(4)}`}
          warn={data.costUnknownCount > 0}
        />
      </div>

      {sidechainTurns.length > 0 && (
        <SidechainSummary
          turns={sidechainTurns.length}
          tools={sidechainTools.length}
          tokens={sidechainTokens}
          cost={sidechainCost}
          spans={sidechainSpans}
        />
      )}
      <Card title={`工具调用次数${mainTools.length < allTools.length ? '（主链路，不含子 agent）' : ''}`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {toolBars.map(([name, count]) => (
            <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <span style={{ width: 180, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {name}
              </span>
              <div style={{ flex: 1, height: 18, background: C.borderSoft, borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${(count / maxToolCount) * 100}%`, height: '100%', background: CAT_COLOR[catOf(name)] || C.mute, borderRadius: 3 }} />
              </div>
              <span style={{ width: 70, textAlign: 'right', color: C.sub }}>
                {count} 次 · {mainTools.length > 0 ? ((count / mainTools.length) * 100).toFixed(0) : 0}%
              </span>
            </div>
          ))}
        </div>
      </Card>

      {/* Tool error rate */}
      <Card title="工具错误率">
        <ToolErrors tools={mainTools} />
      </Card>

      {/* Tool timeline */}
      <Card title="工具调用时间线">
        <ToolTimeline tools={mainTools} />
      </Card>

      <Card title="上下文窗口增长曲线">
        <ContextChart points={ctx} />
      </Card>

      <Card title="Token 拆解">
        <TokenBar
          input={data.inputTokens}
          cc={data.cacheCreationTokens}
          cr={data.cacheReadTokens}
          out={data.outputTokens}
        />
      </Card>

      <Card title={`诊断建议${diag ? ` · 可优化 ~${fmtTokens(diag.totalWastedTokens)} token` : ''}`}>
        <DiagnosisList result={diag} />
      </Card>

      <Card title={`每轮 LLM 调用（${turns.length}）`}>
        <TurnsTable turns={turns} />
      </Card>

      <Card title={`每次工具调用（${mainTools.length}）`}>
        <ToolsTable tools={mainTools} />
      </Card>
    </div>
  );
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        padding: '10px 12px',
      }}
    >
      <div style={{ fontSize: 18, fontWeight: 600, color: warn ? C.medium : C.text }}>{value}</div>
      <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>{label}</div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        padding: 16,
        marginBottom: 20,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: C.sub, marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  );
}

function TokenBar({ input, cc, cr, out }: { input: number; cc: number; cr: number; out: number }) {
  const total = input + cc + cr + out || 1;
  const items = [
    { v: input, c: C.input, l: 'input' },
    { v: cc, c: C.cc, l: 'cache_create' },
    { v: cr, c: C.cr, l: 'cache_read' },
    { v: out, c: C.out, l: 'output' },
  ];
  return (
    <div>
      <div
        style={{
          display: 'flex',
          height: 14,
          borderRadius: 4,
          overflow: 'hidden',
          background: C.borderSoft,
        }}
      >
        {items.map((i) => (
          <div
            key={i.l}
            style={{ width: `${(i.v / total) * 100}%`, background: i.c, minWidth: i.v > 0 ? 3 : 0 }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 16, fontSize: 12, marginTop: 8, flexWrap: 'wrap' }}>
        {items.map((i) => (
          <span key={i.l} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span
              style={{
                display: 'inline-block',
                width: 9,
                height: 9,
                background: i.c,
                borderRadius: 2,
              }}
            />
            <span style={{ color: C.text, fontWeight: 600 }}>{fmtTokens(i.v)}</span>
            <span style={{ color: C.sub }}>
              {i.l} · {((i.v / total) * 100).toFixed(1)}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function ContextChart({ points }: { points: ContextPoint[] }) {
  if (points.length === 0) return <div style={{ color: C.sub, fontSize: 12 }}>无数据</div>;
  const W = 1000,
    H = 240,
    PAD = 44;
  const peak = Math.max(...points.map((p) => p.contextTokens));
  const window = points[0].contextWindow;
  const maxCtx = Math.max(peak, ...(window ? [window] : [0])) * 1.08 || 1;
  const x = (i: number) => PAD + (i / (points.length - 1 || 1)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - (v / maxCtx) * (H - PAD * 2);

  // 堆叠面积：cr(底) + cc + input(顶)，累加 = contextTokens
  const area = (topFn: (p: ContextPoint) => number, botFn: (p: ContextPoint) => number) => {
    let d = '';
    points.forEach((p, i) => {
      d += `${i === 0 ? 'M' : 'L'}${x(i)},${y(topFn(p))} `;
    });
    for (let i = points.length - 1; i >= 0; i--) {
      d += `L${x(i)},${y(botFn(points[i]))} `;
    }
    return `${d}Z`;
  };
  const crTop = (p: ContextPoint) => p.cacheReadTokens;
  const ccTop = (p: ContextPoint) => p.cacheReadTokens + p.cacheCreationTokens;
  const inTop = (p: ContextPoint) => p.contextTokens;
  const zero = () => 0;
  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.contextTokens)}`)
    .join(' ');

  return (
    <div>
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        style={{ background: C.card, borderRadius: 6, border: `1px solid ${C.borderSoft}` }}
      >
        {/* 网格线 */}
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={PAD}
            y1={PAD + (H - PAD * 2) * f}
            x2={W - PAD}
            y2={PAD + (H - PAD * 2) * f}
            stroke={C.grid}
            strokeWidth={1}
          />
        ))}
        {/* 窗口上限线 */}
        {window && (
          <>
            <line
              x1={PAD}
              y1={y(window)}
              x2={W - PAD}
              y2={y(window)}
              stroke={C.high}
              strokeWidth={1}
              strokeDasharray="5 3"
            />
            <text x={W - PAD} y={y(window) - 5} fill={C.high} fontSize={10} textAnchor="end">
              窗口上限 {fmtTokens(window)}
            </text>
          </>
        )}
        {/* 堆叠面积：cr(绿,底) → cc(紫) → input(蓝,顶) */}
        <path d={area(crTop, zero)} fill={C.cr} fillOpacity={0.22} />
        <path d={area(ccTop, crTop)} fill={C.cc} fillOpacity={0.22} />
        <path d={area(inTop, ccTop)} fill={C.input} fillOpacity={0.22} />
        {/* 顶层线 */}
        <path d={linePath} fill="none" stroke={C.input} strokeWidth={1.5} />
        {/* 轴 */}
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke={C.axis} />
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke={C.axis} />
        <text x={PAD} y={PAD - 6} fill={C.sub} fontSize={10}>
          {fmtTokens(maxCtx)}
        </text>
        <text x={PAD} y={H - PAD + 14} fill={C.sub} fontSize={10}>
          {fmtTime(points[0].startTime)}
        </text>
        <text x={W - PAD} y={H - PAD + 14} fill={C.sub} fontSize={10} textAnchor="end">
          {fmtTime(points[points.length - 1].startTime)}
        </text>
      </svg>
      <div
        style={{
          display: 'flex',
          gap: 16,
          fontSize: 11,
          marginTop: 8,
          color: C.sub,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <Legend color={C.input} label="input" />
        <Legend color={C.cc} label="cache_creation" />
        <Legend color={C.cr} label="cache_read" />
        <span>
          峰值 {fmtTokens(peak)}
          {window ? `，利用率 ${((peak / window) * 100).toFixed(1)}%` : '（窗口未配）'}
        </span>
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span
        style={{
          display: 'inline-block',
          width: 10,
          height: 10,
          background: color,
          opacity: 0.45,
          borderRadius: 2,
        }}
      />
      {label}
    </span>
  );
}

function Pager({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  const bstyle = {
    background: 'none',
    border: `1px solid ${C.border}`,
    color: C.link,
    cursor: 'pointer',
    fontSize: 12,
    padding: '4px 10px',
    borderRadius: 5,
  } as const;
  const dstyle = {
    background: 'none',
    border: `1px solid ${C.border}`,
    color: C.mute,
    cursor: 'default',
    fontSize: 12,
    padding: '4px 10px',
    borderRadius: 5,
    opacity: 0.5,
  } as const;
  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'center',
        marginTop: 10,
        fontSize: 12,
        color: C.sub,
      }}
    >
      <button
        style={page <= 1 ? dstyle : bstyle}
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        上一页
      </button>
      <span>
        第 {page} / {totalPages} 页 · 每页 {TABLE_LIMIT} 行
      </span>
      <button
        style={page >= totalPages ? dstyle : bstyle}
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
      >
        下一页
      </button>
    </div>
  );
}

function TurnsTable({ turns }: { turns: Span[] }) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(turns.length / TABLE_LIMIT));
  const shown = turns.slice((page - 1) * TABLE_LIMIT, page * TABLE_LIMIT);
  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: C.sub, textAlign: 'left', borderBottom: `1px solid ${C.border}` }}>
              <th style={{ padding: '6px 8px' }}>#</th>
              <th style={{ padding: '6px 8px' }}>时间</th>
              <th style={{ padding: '6px 8px' }}>model</th>
              <th style={{ padding: '6px 8px' }}>耗时</th>
              <th style={{ padding: '6px 8px' }}>in</th>
              <th style={{ padding: '6px 8px' }}>cc</th>
              <th style={{ padding: '6px 8px' }}>cr</th>
              <th style={{ padding: '6px 8px' }}>out</th>
              <th style={{ padding: '6px 8px' }}>上下文</th>
              <th style={{ padding: '6px 8px' }}>stop</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((t, i) => (
              <tr key={t.id} style={{ borderBottom: `1px solid ${C.borderSoft}`, color: C.text }}>
                <td style={{ padding: '6px 8px', color: C.mute }}>{i + 1}</td>
                <td style={{ padding: '6px 8px' }}>{fmtTime(t.startTime)}</td>
                <td style={{ padding: '6px 8px' }}>{t.model || '-'}</td>
                <td style={{ padding: '6px 8px' }}>
                  {fmtDuration(t.endTime ? t.endTime - t.startTime : 0)}
                </td>
                <td style={{ padding: '6px 8px', color: C.input }}>{fmtTokens(t.inputTokens)}</td>
                <td style={{ padding: '6px 8px', color: C.cc }}>{fmtTokens(t.cacheCreationTokens)}</td>
                <td style={{ padding: '6px 8px', color: C.cr }}>{fmtTokens(t.cacheReadTokens)}</td>
                <td style={{ padding: '6px 8px', color: C.out }}>{fmtTokens(t.outputTokens)}</td>
                <td style={{ padding: '6px 8px', fontWeight: 600 }}>{fmtTokens(t.contextTokens)}</td>
                <td style={{ padding: '6px 8px', color: C.sub }}>{t.stopReason || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={Math.min(page, totalPages)} totalPages={totalPages} onPage={setPage} />
    </div>
  );
}

function ToolsTable({ tools }: { tools: Span[] }) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(tools.length / TABLE_LIMIT));
  const shown = tools.slice((page - 1) * TABLE_LIMIT, page * TABLE_LIMIT);
  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: C.sub, textAlign: 'left', borderBottom: `1px solid ${C.border}` }}>
              <th style={{ padding: '6px 8px' }}>#</th>
              <th style={{ padding: '6px 8px' }}>工具</th>
              <th style={{ padding: '6px 8px' }}>类别</th>
              <th style={{ padding: '6px 8px' }}>时间</th>
              <th style={{ padding: '6px 8px' }}>耗时</th>
              <th style={{ padding: '6px 8px' }}>输出</th>
              <th style={{ padding: '6px 8px' }}>状态</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((t, i) => (
              <tr key={t.id} style={{ borderBottom: `1px solid ${C.borderSoft}`, color: C.text }}>
                <td style={{ padding: '6px 8px', color: C.mute }}>{i + 1}</td>
                <td style={{ padding: '6px 8px' }}>{t.name}</td>
                <td style={{ padding: '6px 8px' }}>
                  <span style={{ color: CAT_COLOR[catOf(t.name)] || C.mute }}>{catOf(t.name)}</span>
                </td>
                <td style={{ padding: '6px 8px' }}>{fmtTime(t.startTime)}</td>
                <td style={{ padding: '6px 8px' }}>
                  {fmtDuration(t.endTime ? t.endTime - t.startTime : 0)}
                </td>
                <td style={{ padding: '6px 8px' }}>{fmtBytes(t.outputBytes)}</td>
                <td style={{ padding: '6px 8px' }}>
                  {t.isError ? (
                    <span style={{ color: C.high }}>❌</span>
                  ) : (
                    <span style={{ color: C.cr }}>ok</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={Math.min(page, totalPages)} totalPages={totalPages} onPage={setPage} />
    </div>
  );
}

function SidechainSummary({
  turns,
  tools,
  tokens,
  cost,
  spans,
}: {
  turns: number;
  tools: number;
  tokens: number;
  cost: number;
  spans: Span[];
}) {
  const [open, setOpen] = useState(false);

  // 按任务名称分组子 agent spans
  const tasks = spans.filter((s) => s.type === 'llm_turn');
  const taskNames = new Set(tasks.map((t) => t.name).filter(Boolean));

  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.cc}`,
        borderLeft: `3px solid ${C.cc}`,
        borderRadius: 8,
        padding: 16,
        marginBottom: 20,
      }}
    >
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
        onClick={() => setOpen(!open)}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>
            🤖 Sub-agent 调用链 · {turns} 轮推理 · {tools} 次工具调用
          </div>
          <div style={{ fontSize: 12, color: C.sub, marginTop: 4 }}>
            子 agent token: {fmtTokens(tokens)} · cost:{' '}
            {cost > 0 ? `¥${cost.toFixed(4)}` : '—'}
            {taskNames.size > 0 && ` · 任务: ${[...taskNames].slice(0, 3).join(', ')}`}
          </div>
        </div>
        <span style={{ color: C.sub, fontSize: 10 }}>{open ? '▲' : '▼'} 展开</span>
      </div>
      {open && (
        <div style={{ marginTop: 12, borderTop: `1px solid ${C.borderSoft}`, paddingTop: 12 }}>
          <div style={{ fontSize: 12, color: C.sub, marginBottom: 8 }}>
            {turns} 轮子 agent 推理 · {tools} 次工具调用 · 约 {fmtTokens(tokens)} token
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {tasks.slice(0, 20).map((t) => (
              <div key={t.id} style={{ fontSize: 11, color: C.mute, display: 'flex', gap: 8 }}>
                <span style={{ minWidth: 70 }}>{fmtTime(t.startTime)}</span>
                <span>{t.name || t.id.slice(0, 12)}</span>
                <span style={{ color: C.sub }}>
                  in={fmtTokens(t.inputTokens)} out={fmtTokens(t.outputTokens)}
                </span>
              </div>
            ))}
            {tasks.length > 20 && (
              <div style={{ fontSize: 11, color: C.mute }}>
                … 还有 {tasks.length - 20} 轮
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ToolErrors({ tools }: { tools: Span[] }) {
  const byName = new Map<string, { total: number; errors: number }>();
  for (const t of tools) {
    const entry = byName.get(t.name) || { total: 0, errors: 0 };
    entry.total++;
    if (t.isError) entry.errors++;
    byName.set(t.name, entry);
  }
  const list = [...byName.entries()].filter(([, e]) => e.errors > 0).sort((a, b) => b[1].errors - a[1].errors);
  if (list.length === 0) return <div style={{ fontSize: 12, color: C.cr }}>✓ 无工具错误</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {list.map(([name, e]) => (
        <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <span style={{ width: 160, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
          <div style={{ flex: 1, height: 14, background: C.borderSoft, borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${((e.total - e.errors) / e.total) * 100}%`, height: '100%', background: C.cr, borderRadius: 3 }} />
          </div>
          <span style={{ width: 100, textAlign: 'right', color: C.high, fontSize: 11 }}>
            {e.errors}/{e.total} err ({((e.errors / e.total) * 100).toFixed(0)}%)
          </span>
        </div>
      ))}
    </div>
  );
}

function ToolTimeline({ tools }: { tools: Span[] }) {
  const [showAll, setShowAll] = useState(false);
  const displayed = showAll ? tools : tools.slice(-50);
  if (tools.length === 0) return <div style={{ fontSize: 12, color: C.sub }}>无工具调用</div>;

  return (
    <div>
      <div style={{ maxHeight: 300, overflowY: 'auto', fontSize: 11 }}>
        {displayed.map((t, i) => {
          const dur = t.endTime ? t.endTime - t.startTime : 0;
          const cat = catOf(t.name);
          return (
            <div key={t.id} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0',
              borderBottom: `1px solid ${C.borderSoft}`, color: C.text,
            }}>
              <span style={{ color: C.mute, width: 24, textAlign: 'right', flexShrink: 0 }}>#{tools.length - (showAll ? tools.length - i : tools.length - 50 + i)}</span>
              <span style={{ width: 50, color: C.sub, flexShrink: 0 }}>{fmtTime(t.startTime)}</span>
              <span style={{
                padding: '1px 5px', borderRadius: 3, fontSize: 10, fontWeight: 600,
                background: `${CAT_COLOR[cat] || C.mute}20`, color: CAT_COLOR[cat] || C.mute,
                flexShrink: 0,
              }}>{cat}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{t.name}</span>
              <span style={{ color: C.sub, flexShrink: 0 }}>{fmtDuration(dur)}</span>
              <span style={{ width: 50, textAlign: 'right', color: C.sub, flexShrink: 0 }}>{fmtBytes(t.outputBytes)}</span>
              {t.isError ? <span style={{ color: C.high, flexShrink: 0 }}>❌</span> : <span style={{ color: C.cr, flexShrink: 0 }}>✓</span>}
            </div>
          );
        })}
      </div>
      {tools.length > 50 && !showAll && (
        <div style={{ textAlign: 'center', marginTop: 8, fontSize: 11, color: C.sub }}>
          显示最近 50 次（共 {tools.length} 次）·{' '}
          <button onClick={() => setShowAll(true)} style={{ background: 'none', border: 'none', color: C.link, cursor: 'pointer', fontSize: 11 }}>
            显示全部
          </button>
        </div>
      )}
    </div>
  );
}

function DiagnosisList({ result }: { result: DiagnosisResult | null }) {
  if (!result) return <div style={{ color: C.sub, fontSize: 12 }}>诊断不可用（server 未返回）</div>;
  if (result.findings.length === 0) {
    return <div style={{ color: C.cr, fontSize: 12 }}>✓ 未发现明显可优化项</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {result.findings.map((f, i) => (
        <div
          key={f.spanIds[0] ?? i}
          style={{
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            padding: 10,
            borderLeft: `3px solid ${SEV_COLOR[f.severity]}`,
            background: C.bg,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 12,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <span
                style={{
                  fontSize: 10,
                  color: SEV_COLOR[f.severity],
                  fontWeight: 600,
                  marginRight: 6,
                }}
              >
                {DIAG_LABEL[f.type]}
              </span>
              <span style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{f.title}</span>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.cc }}>
                ~{fmtTokens(f.wastedTokens)}
              </div>
              <div style={{ fontSize: 10, color: f.costUnknown ? C.medium : C.sub }}>
                {f.costUnknown ? '未定价' : `¥${f.wastedCost.toFixed(5)}`}
              </div>
            </div>
          </div>
          <div style={{ fontSize: 12, color: C.sub, marginTop: 6 }}>{f.detail}</div>
          <div style={{ fontSize: 12, color: C.cr, marginTop: 4 }}>💡 {f.suggestion}</div>
        </div>
      ))}
    </div>
  );
}
