import type { SessionAnalysisContextPoint, SessionAnalysisToolEvent } from '@agent-profile/core';
import { useRef, useState } from 'react';
import { C, FS, fmtBytes, fmtTime, fmtTokens, R, SP } from '../../theme';
import { Empty } from '../../ui';
import { SubHead } from './analysis-panels';

export function ContextChart({
  points,
  tools,
}: {
  points: SessionAnalysisContextPoint[];
  tools: SessionAnalysisToolEvent[];
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  if (points.length === 0) return <Empty text="无上下文数据" />;
  const W = 1000,
    H = 260,
    PAD = 50;
  const peak = Math.max(...points.map((p) => p.contextTokens));
  const window = points[0].contextWindow;
  const maxCtx = Math.max(peak, ...(window ? [window] : [0])) * 1.08 || 1;
  const x = (i: number) => PAD + (i / (points.length - 1 || 1)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - (v / maxCtx) * (H - PAD * 2);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scaleX = W / rect.width;
    const mouseX = (e.clientX - rect.left) * scaleX;
    let nearest = 0;
    let minDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const dist = Math.abs(x(i) - mouseX);
      if (dist < minDist) {
        minDist = dist;
        nearest = i;
      }
    }
    if (mouseX >= PAD - 10 && mouseX <= W - PAD + 10) {
      setHoverIdx(nearest);
    } else {
      setHoverIdx(null);
    }
  };

  // Spike 检测:单轮增量 > 峰值 20% 或 > 20k
  const spikes: {
    turnIdx: number;
    delta: number;
    tools: SessionAnalysisToolEvent[];
    cx: number;
    cy: number;
  }[] = [];
  for (let i = 1; i < points.length; i++) {
    const delta = points[i].contextTokens - points[i - 1].contextTokens;
    if (delta <= 0) continue;
    const isSpike = peak > 0 && (delta > peak * 0.2 || delta > 20_000);
    if (!isSpike) continue;
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

  // 堆叠面积:cr(底) + cc + input(顶),累加 = contextTokens
  const area = (
    topFn: (p: SessionAnalysisContextPoint) => number,
    botFn: (p: SessionAnalysisContextPoint) => number,
  ) => {
    let d = '';
    points.forEach((p, i) => {
      d += `${i === 0 ? 'M' : 'L'}${x(i)},${y(topFn(p))} `;
    });
    for (let i = points.length - 1; i >= 0; i--) {
      d += `L${x(i)},${y(botFn(points[i]))} `;
    }
    return `${d}Z`;
  };
  const crTop = (p: SessionAnalysisContextPoint) => p.cacheReadTokens;
  const ccTop = (p: SessionAnalysisContextPoint) => p.cacheReadTokens + p.cacheCreationTokens;
  const inTop = (p: SessionAnalysisContextPoint) => p.contextTokens;
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
        style={{ background: C.bg, borderRadius: R.md, cursor: 'crosshair', display: 'block' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
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
              opacity={0.7}
            />
            <text x={W - PAD} y={y(window) - 5} fill={C.high} fontSize={10} textAnchor="end">
              窗口上限 {fmtTokens(window)}
            </text>
          </>
        )}
        <path d={area(crTop, zero)} fill={C.cr} fillOpacity={0.25} />
        <path d={area(ccTop, crTop)} fill={C.cc} fillOpacity={0.25} />
        <path d={area(inTop, ccTop)} fill={C.input} fillOpacity={0.25} />
        <path d={linePath} fill="none" stroke={C.input} strokeWidth={1.5} />
        {hoverIdx !== null &&
          (() => {
            const p = points[hoverIdx];
            const hx = x(hoverIdx);
            const hy = y(p.contextTokens);
            const totalInput = p.inputTokens + p.cacheCreationTokens + p.cacheReadTokens;
            const tooltipW = 200,
              tooltipH = 90;
            const tipX = hx + 12 + tooltipW > W ? hx - tooltipW - 12 : hx + 12;
            const tipY = Math.max(10, hy - tooltipH / 2);
            return (
              <g>
                <line
                  x1={hx}
                  y1={PAD}
                  x2={hx}
                  y2={H - PAD}
                  stroke={C.mute}
                  strokeWidth={1}
                  strokeDasharray="4 3"
                  opacity={0.5}
                />
                <circle cx={hx} cy={hy} r={5} fill={C.input} stroke={C.card} strokeWidth={2} />
                <rect
                  x={tipX}
                  y={tipY}
                  width={tooltipW}
                  height={tooltipH}
                  rx={8}
                  fill={C.card}
                  stroke={C.border}
                  strokeWidth={1}
                  opacity={0.97}
                />
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
        {hoverIdx !== null &&
          points.map((p, i) => (
            <circle
              key={`dot-${p.startTime}-${p.contextTokens}`}
              cx={x(i)}
              cy={y(p.contextTokens)}
              r={i === hoverIdx ? 5 : 2}
              fill={i === hoverIdx ? C.input : C.mute}
              opacity={0.6}
            />
          ))}
        {spikes.map((sp) => (
          <g key={`spike-${sp.turnIdx}`}>
            <line
              x1={sp.cx}
              y1={sp.cy + 4}
              x2={sp.cx}
              y2={sp.cy - 20}
              stroke={C.high}
              strokeWidth={1}
              strokeDasharray="3 2"
              opacity={0.7}
            />
            <circle
              cx={sp.cx}
              cy={sp.cy}
              r={4}
              fill={C.high}
              fillOpacity={0.8}
              stroke={C.card}
              strokeWidth={1}
            >
              <title>{`+${fmtTokens(sp.delta)} tokens${sp.tools.length > 0 ? ` — ${sp.tools.map((t) => t.name).join(', ')}` : ''}`}</title>
            </circle>
          </g>
        ))}
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
          gap: SP.lg,
          fontSize: FS.cap,
          marginTop: SP.sm,
          color: C.sub,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <Legend color={C.input} label="input" />
        <Legend color={C.cc} label="cache_creation" />
        <Legend color={C.cr} label="cache_read" />
        <span
          data-tip={
            window
              ? '利用率 = 峰值上下文 ÷ 模型窗口上限（内置估算，非 transcript 实测）'
              : '该模型未在内置 model_context 表中，无法计算利用率'
          }
          data-tip-align="end"
        >
          峰值 <span className="tnum">{fmtTokens(peak)}</span>
          {window ? (
            <>
              ,利用率 <span className="tnum">{((peak / window) * 100).toFixed(1)}%</span>
            </>
          ) : (
            '（该模型未内置窗口上限）'
          )}
        </span>
      </div>
      {spikes.length > 0 && (
        <div
          style={{
            marginTop: SP.md,
            paddingTop: SP.md,
            boxShadow: `0 1px 0 ${C.borderSoft} inset`,
          }}
        >
          <SubHead>上下文波动分析</SubHead>
          {spikes.map((sp) => (
            <div
              key={sp.turnIdx}
              style={{
                fontSize: FS.sm,
                color: C.text,
                padding: '2px 0',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                flexWrap: 'wrap',
              }}
            >
              <span style={{ color: C.high, fontWeight: 600, flexShrink: 0 }}>●</span>
              <span>
                Turn {sp.turnIdx} 增长{' '}
                <span className="tnum" style={{ color: C.high, fontWeight: 600 }}>
                  +{fmtTokens(sp.delta)}
                </span>{' '}
                tokens
              </span>
              {sp.tools.length > 0 && (
                <span style={{ color: C.sub }}>
                  — {sp.tools.map((t) => `${t.name} ${fmtBytes(t.outputBytes)}`).join(', ')}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span
        style={{
          display: 'inline-block',
          width: 10,
          height: 10,
          background: color,
          opacity: 0.5,
          borderRadius: 3,
        }}
      />
      {label}
    </span>
  );
}
