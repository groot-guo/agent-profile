'use client';

import type { CostAttribution, DiagnosisResult, EfficiencyMetrics, EfficiencyScore, PerformanceMetrics, SessionDetail, Span } from '@agent-profile/core';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
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
  outputTokens?: number;
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
  const [eff, setEff] = useState<EfficiencyMetrics | null>(null);
  const [costAttr, setCostAttr] = useState<CostAttribution | null>(null);
  const [score, setScore] = useState<EfficiencyScore | null>(null);
  const [commits, setCommits] = useState<{ hash: string; message: string; date: string; author: string }[]>([]);
  const [perf, setPerf] = useState<PerformanceMetrics | null>(null);
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
      fetch(`${API}/session/${id}/efficiency`).then((r) => (r.ok ? r.json() : null)),
      fetch(`${API}/session/${id}/cost-attribution`).then((r) => (r.ok ? r.json() : null)),
      fetch(`${API}/session/${id}/score`).then((r) => (r.ok ? r.json() : null)),
      fetch(`${API}/session/${id}/commits`).then((r) => (r.ok ? r.json() : Promise.resolve({ commits: [] }))),
      fetch(`${API}/session/${id}/performance`).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([d, c, dg, ef, ca, sc, cm, pf]) => {
        setData(d);
        setCtx(c);
        setDiag(dg);
        setEff(ef);
        setCostAttr(ca);
        setScore(sc);
        if (cm?.commits) setCommits(cm.commits);
        setPerf(pf);
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
        <span style={{ marginLeft: 12 }}>
          <TagEditor id={id} initialTags={(data as Record<string, unknown>).tags as string || ''} />
        </span>
        <span style={{ marginLeft: 12 }}>
          <a href={`${API}/session/${id}/export`} download style={{ color: C.link, textDecoration: 'none', fontSize: 11, padding: '2px 6px', border: `1px solid ${C.border}`, borderRadius: 3 }}>⬇ JSON</a>
          {' '}
          <a href={`${API}/session/${id}/export?format=csv`} download style={{ color: C.link, textDecoration: 'none', fontSize: 11, padding: '2px 6px', border: `1px solid ${C.border}`, borderRadius: 3 }}>⬇ CSV</a>
          {' '}
          <a href={`${API}/session/${id}/report`} download style={{ color: C.cc, textDecoration: 'none', fontSize: 11, padding: '2px 6px', border: `1px solid ${C.border}`, borderRadius: 3 }}>📋 Report</a>
        </span>
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
        {score && (
          <Metric
            label={`效率分${score.percentile ? ` · P${score.percentile}` : ''}`}
            value={`${score.score}`}
            warn={score.score < 50}
          />
        )}
      </div>

      {commits.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.cr}`, borderLeft: `3px solid ${C.cr}`, borderRadius: 8, padding: 12, marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 6 }}>🔗 Git 提交关联 · {commits.length} commits</div>
          {commits.slice(0, 5).map((c) => (
            <div key={c.hash} style={{ fontSize: 11, color: C.sub, padding: '2px 0', display: 'flex', gap: 8 }}>
              <code style={{ color: C.link, flexShrink: 0 }}>{c.hash.slice(0, 7)}</code>
              <span style={{ flex: 1, color: C.text }}>{c.message}</span>
              <span style={{ flexShrink: 0 }}>{c.date?.slice(0, 16)}</span>
            </div>
          ))}
          {commits.length > 5 && <div style={{ fontSize: 11, color: C.mute }}>… 还有 {commits.length - 5} 个提交</div>}
        </div>
      )}
      {sidechainTurns.length > 0 && (
        <SidechainSummary
          turns={sidechainTurns.length}
          tools={sidechainTools.length}
          tokens={sidechainTokens}
          cost={sidechainCost}
          spans={sidechainSpans}
        />
      )}
      {eff && (
        <EfficiencyPanel metrics={eff} />
      )}
      {costAttr && (
        <CostAttributionPanel attr={costAttr} />
      )}
      {perf && (
        <PerformancePanel metrics={perf} />
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
        <ContextChart points={ctx} tools={mainTools} />
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

function ContextChart({ points, tools }: { points: ContextPoint[]; tools: Span[] }) {
  if (points.length === 0) return <div style={{ color: C.sub, fontSize: 12 }}>无数据</div>;
  const W = 1000,
    H = 260,
    PAD = 50;
  const peak = Math.max(...points.map((p) => p.contextTokens));
  const window = points[0].contextWindow;
  const maxCtx = Math.max(peak, ...(window ? [window] : [0])) * 1.08 || 1;
  const x = (i: number) => PAD + (i / (points.length - 1 || 1)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - (v / maxCtx) * (H - PAD * 2);

  // Hover state
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scaleX = W / rect.width;
    const mouseX = (e.clientX - rect.left) * scaleX;
    // Find nearest point
    let nearest = 0;
    let minDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const dist = Math.abs(x(i) - mouseX);
      if (dist < minDist) { minDist = dist; nearest = i; }
    }
    // Only show if within chart area
    if (mouseX >= PAD - 10 && mouseX <= W - PAD + 10) {
      setHoverIdx(nearest);
    } else {
      setHoverIdx(null);
    }
  };

  // Spike detection
  const spikes: { turnIdx: number; delta: number; tools: Span[]; cx: number; cy: number }[] = [];
  for (let i = 1; i < points.length; i++) {
    const delta = points[i].contextTokens - points[i - 1].contextTokens;
    if (delta <= 0) continue;
    const isSpike = peak > 0 && (delta > peak * 0.2 || delta > 20_000);
    if (!isSpike) continue;

    // 找到该时间窗口内的工具调用
    const t0 = points[i - 1].startTime;
    const t1 = points[i].startTime;
    const windowTools = tools
      .filter((t) => t.startTime >= t0 && t.startTime <= t1)
      .sort((a, b) => b.outputBytes - a.outputBytes)
      .slice(0, 2);
    spikes.push({
      turnIdx: i,
      delta,
      tools: windowTools,
      cx: x(i),
      cy: y(points[i].contextTokens),
    });
  }

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
        ref={svgRef}
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        style={{ background: C.card, borderRadius: 6, border: `1px solid ${C.borderSoft}`, cursor: 'crosshair' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
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
        {/* Hover crosshair + tooltip */}
        {hoverIdx !== null && (() => {
          const p = points[hoverIdx];
          const hx = x(hoverIdx);
          const hy = y(p.contextTokens);
          const totalInput = p.inputTokens + p.cacheCreationTokens + p.cacheReadTokens;
          const tooltipW = 200, tooltipH = 90;
          const tipX = hx + 12 + tooltipW > W ? hx - tooltipW - 12 : hx + 12;
          const tipY = Math.max(10, hy - tooltipH / 2);
          return (
            <g>
              {/* 竖线十字线 */}
              <line x1={hx} y1={PAD} x2={hx} y2={H - PAD} stroke={C.mute} strokeWidth={1} strokeDasharray="4 3" opacity={0.5} />
              {/* 数据点圆 */}
              <circle cx={hx} cy={hy} r={5} fill={C.input} stroke={C.card} strokeWidth={2} />
              {/* Tooltip 背景 */}
              <rect x={tipX} y={tipY} width={tooltipW} height={tooltipH} rx={5} fill={C.card} stroke={C.border} strokeWidth={1} opacity={0.96} />
              {/* Tooltip 内容 */}
              <text x={tipX + 10} y={tipY + 18} fill={C.sub} fontSize={11} fontWeight={600}>
                Turn {hoverIdx + 1} · {fmtTime(p.startTime)}
              </text>
              <text x={tipX + 10} y={tipY + 36} fill={C.text} fontSize={12} fontWeight={700}>
                上下文 {fmtTokens(p.contextTokens)}
              </text>
              <text x={tipX + 10} y={tipY + 52} fill={C.sub} fontSize={11}>
                <tspan fill={C.input}>input {fmtTokens(p.inputTokens)}</tspan>
                {' + '}
                <tspan fill={C.cc}>cc {fmtTokens(p.cacheCreationTokens)}</tspan>
                {' + '}
                <tspan fill={C.cr}>cr {fmtTokens(p.cacheReadTokens)}</tspan>
              </text>
              <text x={tipX + 10} y={tipY + 68} fill={C.sub} fontSize={11}>
                总输入 {fmtTokens(totalInput)} · 输出 {fmtTokens(p.outputTokens ?? 0)}
              </text>
              {p.contextWindow && (
                <text x={tipX + 10} y={tipY + 82} fill={C.sub} fontSize={10}>
                  窗口利用率 {((p.contextTokens / p.contextWindow) * 100).toFixed(1)}%
                </text>
              )}
            </g>
          );
        })()}
        {/* 悬停时的高亮点（所有数据点） */}
        {hoverIdx !== null && points.map((p, i) => (
          <circle key={`dot-${i}`} cx={x(i)} cy={y(p.contextTokens)} r={i === hoverIdx ? 5 : 2} fill={i === hoverIdx ? C.input : C.mute} opacity={0.6} />
        ))}
        {/* Spike markers */}
        {spikes.map((sp, idx) => (
          <g key={`spike-${idx}`}>
            <line x1={sp.cx} y1={sp.cy + 4} x2={sp.cx} y2={sp.cy - 20} stroke={C.high} strokeWidth={1} strokeDasharray="3 2" opacity={0.7} />
            <circle cx={sp.cx} cy={sp.cy} r={4} fill={C.high} fillOpacity={0.8} stroke={C.card} strokeWidth={1}>
              <title>{`+${fmtTokens(sp.delta)} tokens${sp.tools.length > 0 ? ` — ${sp.tools.map((t) => t.name).join(', ')}` : ''}`}</title>
            </circle>
          </g>
        ))}
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
      {/* Spike 标注列表 */}
      {spikes.length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.borderSoft}` }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.sub, marginBottom: 6 }}>📈 上下文波动分析</div>
          {spikes.map((sp, idx) => (
            <div key={idx} style={{ fontSize: 11, color: C.text, padding: '2px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: C.high, fontWeight: 600, flexShrink: 0 }}>●</span>
              <span>
                Turn {sp.turnIdx} 增长 <span style={{ color: C.high, fontWeight: 600 }}>+{fmtTokens(sp.delta)}</span> tokens
                {sp.tools.length > 0 && (
                  <span style={{ color: C.sub }}>
                    {' '}— {sp.tools.map((t) => `${t.name} ${fmtBytes(t.outputBytes)}`).join(', ')}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
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
                <td style={{ padding: '6px 8px', color: C.mute }}>{(page - 1) * TABLE_LIMIT + i + 1}</td>
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
                <td style={{ padding: '6px 8px', color: C.mute }}>{(page - 1) * TABLE_LIMIT + i + 1}</td>
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
              <span style={{ color: C.mute, width: 24, textAlign: 'right', flexShrink: 0 }}>#{showAll || tools.length <= 50 ? i + 1 : tools.length - 50 + i + 1}</span>
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

function EfficiencyPanel({ metrics }: { metrics: EfficiencyMetrics }) {
  const topErrorTools = metrics.toolSuccessRates.filter((t) => t.errors > 0).slice(0, 5);
  const highTAR = metrics.thinkingActionRatios.filter((t) => t.ratio > 500 && t.toolCalls > 0).slice(0, 5);
  const hotFiles = metrics.fileOperations.slice(0, 10);

  return (
    <Card title={`行为效率分析 · ${metrics.toolSuccessRates.length} 种工具 · 上下文增速 ${fmtTokens(metrics.contextGrowthVelocity)}/轮 · Read→Edit ${(metrics.readToEditRate * 100).toFixed(0)}%`}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* 工具成功率 */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.sub, marginBottom: 8 }}>🔧 工具成功率</div>
          {metrics.toolSuccessRates.slice(0, 8).map((t) => (
            <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '2px 0' }}>
              <span style={{ width: 110, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
              <div style={{ flex: 1, height: 10, background: C.borderSoft, borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${t.successRate * 100}%`, height: '100%', background: t.successRate > 0.9 ? C.cr : t.successRate > 0.7 ? C.medium : C.high, borderRadius: 2 }} />
              </div>
              <span style={{ width: 52, textAlign: 'right', color: C.sub }}>{(t.successRate * 100).toFixed(0)}%</span>
              <span style={{ width: 44, textAlign: 'right', color: C.mute }}>{t.total}次{t.errors > 0 && <span style={{ color: C.high }}> err{t.errors}</span>}</span>
            </div>
          ))}
        </div>

        {/* Thinking/Action 比 */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.sub, marginBottom: 8 }}>🧠 Thinking / Action 比</div>
          <div style={{ fontSize: 11, color: C.sub, marginBottom: 8 }}>
            每轮 thinking 字符数 ÷ tool_call 次数，比率高 = "想得多做得少"
          </div>
          {metrics.thinkingActionRatios.length === 0 ? (
            <div style={{ fontSize: 11, color: C.mute }}>无数据</div>
          ) : (
            <div style={{ maxHeight: 180, overflowY: 'auto' }}>
              {metrics.thinkingActionRatios.slice(-10).reverse().map((t) => (
                <div key={t.turnId} style={{
                  display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '2px 0',
                  borderBottom: `1px solid ${C.borderSoft}`,
                  background: t.ratio > 2000 ? `${C.high}0D` : t.ratio > 1000 ? `${C.medium}0D` : 'transparent',
                }}>
                  <span style={{ color: C.mute, width: 36 }}>T{t.turnIndex}</span>
                  <span style={{ color: C.text, flex: 1 }}>
                    {t.toolCalls > 0 ? `${(t.thinkingChars / 1000).toFixed(1)}k char ÷ ${t.toolCalls} call = ${t.ratio} char/call` : `${(t.thinkingChars / 1000).toFixed(1)}k char · 0 call`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 高 Thinking/Action 比告警 */}
      {highTAR.length > 0 && (
        <div style={{ marginTop: 12, padding: '8px 12px', background: `${C.medium}12`, border: `1px solid ${C.medium}40`, borderRadius: 6, fontSize: 11 }}>
          <span style={{ color: C.medium, fontWeight: 600 }}>⚠ 高 Thinking/Action 比：</span>
          <span style={{ color: C.sub }}>{highTAR.map((t) => `T${t.turnIndex}(${t.ratio}c/c)`).join(', ')}。可能思考过度，建议提示 agent 减少多余推理。</span>
        </div>
      )}

      {/* 文件操作热度 Top 5 */}
      {hotFiles.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.sub, marginBottom: 8 }}>📁 文件操作热度 Top {Math.min(5, hotFiles.length)}</div>
          {hotFiles.slice(0, 5).map((f) => (
            <div key={f.path} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, padding: '2px 0' }}>
              <span style={{ flex: 1, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.path.split('/').slice(-2).join('/')}</span>
              <span style={{ color: C.link }}>Read {f.reads}</span>
              {f.edits > 0 && <span style={{ color: C.out }}>Edit {f.edits}</span>}
              {f.writes > 0 && <span style={{ color: C.cr }}>Write {f.writes}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Read→Edit 转化率 */}
      <div style={{ marginTop: 12, padding: '8px 12px', background: C.bg, borderRadius: 6, fontSize: 11, color: C.sub }}>
        📊 Read→Edit 转化率：
        <span style={{ fontWeight: 600, color: metrics.readToEditRate > 0.3 ? C.cr : metrics.readToEditRate > 0.1 ? C.medium : C.high }}>
          {(metrics.readToEditRate * 100).toFixed(0)}%
        </span>
        <span>（{hotFiles.filter((f) => f.reads > 0).length} 个文件被读，{hotFiles.filter((f) => f.edits > 0 || f.writes > 0).length} 个被修改）</span>
        {metrics.readToEditRate < 0.1 && hotFiles.filter((f) => f.reads > 0).length > 3 && (
          <span style={{ color: C.high, display: 'block', marginTop: 4 }}>
            💡 读了 {hotFiles.filter((f) => f.reads > 0).length} 个文件但几乎没改，可能存在大量冗余读取
          </span>
        )}
      </div>
    </Card>
  );
}

function CostAttributionPanel({ attr }: { attr: CostAttribution }) {
  const catColors: Record<string, string> = {
    文件操作: '#fb8f1e', 命令执行: '#d4a72c', 网络: '#bf8700',
    用户交互: '#218bff', MCP: '#bc4c00', 编排: '#d1572a', 元工具: '#8c959f', 其他: '#6e7681',
  };
  const phaseColors = [C.link, C.cc, C.cr];

  return (
    <Card title={`成本归因 · ¥${attr.totalCost.toFixed(4)} · 浪费比 ${(attr.wastedCostRatio * 100).toFixed(1)}%`}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* 按工具类别 */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.sub, marginBottom: 8 }}>📦 按工具类别</div>
          {attr.costByCategory.map((c) => (
            <div key={c.category} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '2px 0' }}>
              <span style={{
                padding: '1px 5px', borderRadius: 3, fontSize: 10, fontWeight: 600,
                background: `${catColors[c.category] || C.mute}20`, color: catColors[c.category] || C.mute,
                width: 56, textAlign: 'center', flexShrink: 0,
              }}>{c.category}</span>
              <div style={{ flex: 1, height: 10, background: C.borderSoft, borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${c.percentage * 100}%`, height: '100%', background: catColors[c.category] || C.mute, borderRadius: 2, minWidth: c.percentage > 0 ? 3 : 0 }} />
              </div>
              <span style={{ width: 52, textAlign: 'right', color: C.out, fontWeight: 600 }}>¥{c.cost.toFixed(4)}</span>
              <span style={{ width: 36, textAlign: 'right', color: C.sub }}>{(c.percentage * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>

        {/* 按阶段 */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.sub, marginBottom: 8 }}>⏱ 按阶段</div>
          {attr.costByPhase.map((p, i) => (
            <div key={p.phase} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, padding: '4px 0' }}>
              <span style={{ fontWeight: 600, color: phaseColors[i] || C.text, width: 36, flexShrink: 0 }}>{p.phase}</span>
              <div style={{ flex: 1, height: 14, background: C.borderSoft, borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${p.percentage * 100}%`, height: '100%', background: phaseColors[i] || C.mute, borderRadius: 3, minWidth: p.percentage > 0 ? 3 : 0 }} />
              </div>
              <span style={{ width: 48, textAlign: 'right', color: C.out, fontWeight: 600 }}>¥{p.cost.toFixed(4)}</span>
              <span style={{ width: 36, textAlign: 'right', color: C.sub }}>{(p.percentage * 100).toFixed(0)}%</span>
              <span style={{ width: 44, textAlign: 'right', color: C.mute }}>{p.turnCount}轮</span>
            </div>
          ))}
        </div>
      </div>

      {/* 浪费成本占比 */}
      {attr.wastedCostRatio > 0 && (
        <div style={{ marginTop: 12, padding: '8px 12px', background: `${attr.wastedCostRatio > 0.3 ? C.high : C.medium}12`, border: `1px solid ${attr.wastedCostRatio > 0.3 ? C.high : C.medium}40`, borderRadius: 6, fontSize: 11 }}>
          <span style={{ color: attr.wastedCostRatio > 0.3 ? C.high : C.medium, fontWeight: 600 }}>
            💸 诊断浪费占 {(attr.wastedCostRatio * 100).toFixed(1)}%
          </span>
          <span style={{ color: C.sub }}>
            {attr.wastedCostRatio > 0.3
              ? ' — 超过 30% 的成本可优化，建议重点关注诊断建议中的高严重度项'
              : ' — 浪费占比在可接受范围内'}
          </span>
        </div>
      )}
    </Card>
  );
}

function PerformancePanel({ metrics }: { metrics: PerformanceMetrics }) {
  const { turnLatency, toolLatency, toolLatencyByName, slowTurns, throughput, sessionDuration } = metrics;
  return (
    <Card title={`性能分析 · ${slowTurns.length} 慢轮 · 吞吐 ${(throughput / 1000).toFixed(1)}k tokens/min · ${(sessionDuration / 60000).toFixed(1)}min`}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
        <MiniStat label="Turn avg" value={fmtDuration(turnLatency.avg)} />
        <MiniStat label="Turn P95" value={fmtDuration(turnLatency.p95)} />
        <MiniStat label="Turn max" value={fmtDuration(turnLatency.max)} color={turnLatency.max > 60_000 ? C.high : undefined} />
        <MiniStat label="Tool avg" value={fmtDuration(toolLatency.avg)} />
      </div>
      {/* Slow turns list */}
      {slowTurns.length > 0 && (
        <div style={{ marginTop: 8, padding: '6px 10px', background: `${C.high}12`, borderRadius: 6, fontSize: 11 }}>
          <span style={{ color: C.high, fontWeight: 600 }}>🐢 慢轮（&gt;1.5x P95）：</span>
          <span style={{ color: C.sub }}>
            {slowTurns.slice(0, 8).map((t) => `T${t.turnIndex}(${fmtDuration(t.duration)})`).join(', ')}
            {slowTurns.length > 8 && ` …+${slowTurns.length - 8}`}
          </span>
        </div>
      )}
      {/* Slowest tools */}
      {toolLatencyByName.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.sub, marginBottom: 6 }}>🔧 最慢工具（avg延迟）</div>
          {toolLatencyByName.slice(0, 5).map((t) => (
            <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, padding: '2px 0' }}>
              <span style={{ width: 120, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
              <div style={{ flex: 1, height: 8, background: C.borderSoft, borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, t.avg / (toolLatencyByName[0]?.avg || 1) * 100)}%`, height: '100%', background: t.avg > 5000 ? C.high : C.medium, borderRadius: 2 }} />
              </div>
              <span style={{ color: C.sub, width: 50, textAlign: 'right' }}>{fmtDuration(t.avg)}</span>
              <span style={{ color: C.mute, width: 44, textAlign: 'right' }}>x{t.count}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: C.bg, borderRadius: 6, padding: '6px 10px' }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: color || C.text }}>{value}</div>
      <div style={{ fontSize: 10, color: C.sub }}>{label}</div>
    </div>
  );
}

function TagEditor({ id, initialTags }: { id: string; initialTags: string }) {
  const [tags, setTags] = useState(initialTags);
  const [editing, setEditing] = useState(false);
  const save = async () => {
    await fetch(`${API}/session/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tags }),
    });
    setEditing(false);
  };
  if (!editing) return (
    <span onClick={() => setEditing(true)} style={{ cursor: 'pointer', fontSize: 11, padding: '2px 6px', border: `1px dashed ${C.border}`, borderRadius: 3 }}>
      {tags ? tags.split(',').map((t) => (
        <span key={t} style={{ background: `${C.link}18`, color: C.link, padding: '0 4px', borderRadius: 2, marginRight: 3 }}>{t.trim()}</span>
      )) : '+ 标签'}
    </span>
  );
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="逗号分隔标签" size={15}
        style={{ padding: '1px 4px', fontSize: 11, border: `1px solid ${C.link}`, borderRadius: 3 }} />
      <button onClick={save} style={{ padding: '1px 6px', fontSize: 11, background: C.link, color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer' }}>✓</button>
    </span>
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
          key={f.spanIds[0] ? `${f.type}-${f.spanIds[0]}` : i}
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
