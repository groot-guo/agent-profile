import type { CostAttribution, EfficiencyMetrics, PerformanceMetrics } from '@agent-profile/core';
import { C, CAT_COLOR, FS, fmtDuration, fmtTokens, R, SP } from '../../theme';
import { BarRow, Card, Chip } from '../../ui';

export function SubHead({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ color: C.sub, fontWeight: 600, fontSize: FS.sm, marginBottom: SP.xs }}>
      {children}
    </div>
  );
}

export function Note({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: SP.md,
        padding: `${SP.sm}px ${SP.md}px`,
        background: `${color}12`,
        borderRadius: R.md,
        fontSize: FS.sm,
        lineHeight: 1.6,
      }}
    >
      {children}
    </div>
  );
}

export function MiniStat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div style={{ background: C.bg, borderRadius: R.md, padding: `${SP.sm}px ${SP.md}px` }}>
      <div className="tnum" style={{ fontSize: FS.title, fontWeight: 600, color: color || C.text }}>
        {value}
      </div>
      <div style={{ fontSize: FS.cap, color: C.sub }}>{label}</div>
    </div>
  );
}

export function EfficiencyPanel({ metrics }: { metrics: EfficiencyMetrics }) {
  const highTAR = metrics.thinkingActionRatios
    .filter((t) => t.ratio > 500 && t.toolCalls > 0)
    .slice(0, 5);
  const hotFiles = metrics.fileOperations.slice(0, 10);

  return (
    <Card
      title="行为效率分析"
      meta={`${metrics.toolSuccessRates.length} 种工具 · 上下文增速 ${fmtTokens(metrics.contextGrowthVelocity)}/轮 · Read→Edit ${(metrics.readToEditRate * 100).toFixed(0)}%`}
    >
      <div className="session-analysis-grid">
        <div>
          <SubHead>工具成功率</SubHead>
          {metrics.toolSuccessRates.slice(0, 8).map((t) => (
            <BarRow
              key={t.name}
              label={t.name}
              labelWidth={110}
              ratio={t.successRate}
              color={t.successRate > 0.9 ? C.cr : t.successRate > 0.7 ? C.medium : C.high}
              right={
                <>
                  {(t.successRate * 100).toFixed(0)}%{' '}
                  <span style={{ color: C.mute }}>
                    {t.total}次
                    {t.errors > 0 && <span style={{ color: C.high }}> 错{t.errors}</span>}
                  </span>
                </>
              }
            />
          ))}
        </div>

        <div>
          <SubHead>Thinking / Action 比</SubHead>
          <div style={{ fontSize: FS.cap, color: C.mute, marginBottom: SP.sm }}>
            每轮 thinking 字符数 ÷ 工具调用次数,比率高 = 想得多做得少
          </div>
          {metrics.thinkingActionRatios.length === 0 ? (
            <div style={{ fontSize: FS.sm, color: C.mute }}>无数据</div>
          ) : (
            <div style={{ maxHeight: 180, overflowY: 'auto' }}>
              {metrics.thinkingActionRatios
                .slice(-10)
                .reverse()
                .map((t) => (
                  <div
                    key={t.turnId}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: SP.sm,
                      fontSize: FS.sm,
                      padding: '3px 6px',
                      borderRadius: R.sm,
                      background:
                        t.ratio > 2000
                          ? `${C.high}0D`
                          : t.ratio > 1000
                            ? `${C.medium}0D`
                            : 'transparent',
                    }}
                  >
                    <span
                      className="tnum"
                      style={{ color: C.mute, width: 38, flexShrink: 0, fontSize: FS.cap }}
                    >
                      T{t.turnIndex}
                    </span>
                    <span className="tnum" style={{ color: C.text, flex: 1, fontSize: FS.cap }}>
                      {t.toolCalls > 0
                        ? `${(t.thinkingChars / 1000).toFixed(1)}k 字符 ÷ ${t.toolCalls} 次 = ${t.ratio} 字符/次`
                        : `${(t.thinkingChars / 1000).toFixed(1)}k 字符 · 0 次调用`}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>

      {highTAR.length > 0 && (
        <Note color={C.medium}>
          <span style={{ color: C.medium, fontWeight: 600 }}>高 Thinking/Action 比:</span>
          <span style={{ color: C.sub }}>
            {highTAR.map((t) => `T${t.turnIndex}(${t.ratio}字符/次)`).join(', ')}
            。可能思考过度,建议提示 agent 减少多余推理。
          </span>
        </Note>
      )}

      {hotFiles.length > 0 && (
        <div style={{ marginTop: SP.lg }}>
          <SubHead>文件操作热度 Top {Math.min(5, hotFiles.length)}</SubHead>
          {hotFiles.slice(0, 5).map((f) => (
            <div
              key={f.path}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: SP.sm,
                fontSize: FS.sm,
                padding: '3px 0',
              }}
            >
              <span
                className="clamp1"
                title={f.path}
                style={{ flex: 1, color: C.text, minWidth: 0 }}
              >
                {f.path.split('/').slice(-2).join('/')}
              </span>
              <span className="tnum" style={{ color: C.input, flexShrink: 0, fontSize: FS.cap }}>
                Read {f.reads}
              </span>
              {f.edits > 0 && (
                <span className="tnum" style={{ color: C.out, flexShrink: 0, fontSize: FS.cap }}>
                  Edit {f.edits}
                </span>
              )}
              {f.writes > 0 && (
                <span className="tnum" style={{ color: C.cr, flexShrink: 0, fontSize: FS.cap }}>
                  Write {f.writes}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <Note color={C.link}>
        <span style={{ color: C.sub }}>Read→Edit 转化率:</span>
        <span
          className="tnum"
          style={{
            fontWeight: 600,
            color:
              metrics.readToEditRate > 0.3
                ? C.cr
                : metrics.readToEditRate > 0.1
                  ? C.medium
                  : C.high,
          }}
        >
          {' '}
          {(metrics.readToEditRate * 100).toFixed(0)}%
        </span>
        <span style={{ color: C.sub }}>
          ({hotFiles.filter((f) => f.reads > 0).length} 个文件被读,
          {hotFiles.filter((f) => f.edits > 0 || f.writes > 0).length} 个被修改)
        </span>
        {metrics.readToEditRate < 0.1 && hotFiles.filter((f) => f.reads > 0).length > 3 && (
          <span style={{ color: C.high, display: 'block', marginTop: 4 }}>
            读了 {hotFiles.filter((f) => f.reads > 0).length} 个文件但几乎没改,可能存在大量冗余读取
          </span>
        )}
      </Note>
    </Card>
  );
}

export function CostAttributionPanel({ attr }: { attr: CostAttribution }) {
  const phaseColors = [C.link, C.cc, C.cr];

  return (
    <Card
      title="成本归因"
      meta={`¥${attr.totalCost.toFixed(4)} · 浪费比 ${(attr.wastedCostRatio * 100).toFixed(1)}%`}
    >
      <div className="session-analysis-grid">
        <div>
          <SubHead>按工具类别</SubHead>
          {attr.costByCategory.map((c) => (
            <div
              key={c.category}
              style={{ display: 'flex', alignItems: 'center', gap: SP.sm, padding: '3px 0' }}
            >
              <Chip
                color={CAT_COLOR[c.category] || C.mute}
                style={{ width: 62, justifyContent: 'center', flexShrink: 0 }}
              >
                {c.category}
              </Chip>
              <div
                style={{
                  flex: 1,
                  height: 10,
                  background: C.borderSoft,
                  borderRadius: R.pill,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${c.percentage * 100}%`,
                    height: '100%',
                    background: CAT_COLOR[c.category] || C.mute,
                    borderRadius: R.pill,
                    minWidth: c.percentage > 0 ? 4 : 0,
                  }}
                />
              </div>
              <span
                className="tnum"
                style={{
                  width: 64,
                  textAlign: 'right',
                  color: C.out,
                  fontWeight: 600,
                  fontSize: FS.cap,
                }}
              >
                ¥{c.cost.toFixed(4)}
              </span>
              <span
                className="tnum"
                style={{ width: 36, textAlign: 'right', color: C.sub, fontSize: FS.cap }}
              >
                {(c.percentage * 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>

        <div>
          <SubHead>按阶段</SubHead>
          {attr.costByPhase.map((p, i) => (
            <div
              key={p.phase}
              style={{ display: 'flex', alignItems: 'center', gap: SP.sm, padding: '4px 0' }}
            >
              <span
                style={{
                  fontWeight: 600,
                  color: phaseColors[i] || C.text,
                  width: 44,
                  flexShrink: 0,
                  fontSize: FS.sm,
                }}
              >
                {p.phase}
              </span>
              <div
                style={{
                  flex: 1,
                  height: 10,
                  background: C.borderSoft,
                  borderRadius: R.pill,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${p.percentage * 100}%`,
                    height: '100%',
                    background: phaseColors[i] || C.mute,
                    borderRadius: R.pill,
                    minWidth: p.percentage > 0 ? 4 : 0,
                  }}
                />
              </div>
              <span
                className="tnum"
                style={{
                  width: 56,
                  textAlign: 'right',
                  color: C.out,
                  fontWeight: 600,
                  fontSize: FS.cap,
                }}
              >
                ¥{p.cost.toFixed(4)}
              </span>
              <span
                className="tnum"
                style={{ width: 34, textAlign: 'right', color: C.sub, fontSize: FS.cap }}
              >
                {(p.percentage * 100).toFixed(0)}%
              </span>
              <span
                className="tnum"
                style={{ width: 36, textAlign: 'right', color: C.mute, fontSize: FS.cap }}
              >
                {p.turnCount}轮
              </span>
            </div>
          ))}
        </div>
      </div>

      {attr.wastedCostRatio > 0 && (
        <Note color={attr.wastedCostRatio > 0.3 ? C.high : C.medium}>
          <span style={{ color: attr.wastedCostRatio > 0.3 ? C.high : C.medium, fontWeight: 600 }}>
            诊断浪费占 <span className="tnum">{(attr.wastedCostRatio * 100).toFixed(1)}%</span>
          </span>
          <span style={{ color: C.sub }}>
            {attr.wastedCostRatio > 0.3
              ? ' — 超过 30% 的成本可优化,建议重点关注诊断建议中的高严重度项'
              : ' — 浪费占比在可接受范围内'}
          </span>
        </Note>
      )}
    </Card>
  );
}

export function PerformancePanel({ metrics }: { metrics: PerformanceMetrics }) {
  const { turnLatency, toolLatency, toolLatencyByName, slowTurns, throughput, sessionDuration } =
    metrics;
  return (
    <Card
      title="性能分析"
      meta={`${slowTurns.length} 个慢轮 · 吞吐 ${(throughput / 1000).toFixed(1)}k tokens/min · 共 ${(sessionDuration / 60000).toFixed(1)}min`}
    >
      <div className="session-mini-stat-grid">
        <MiniStat label="Turn 平均" value={fmtDuration(turnLatency.avg)} />
        <MiniStat label="Turn P95" value={fmtDuration(turnLatency.p95)} />
        <MiniStat
          label="Turn 最大"
          value={fmtDuration(turnLatency.max)}
          color={turnLatency.max > 60_000 ? C.high : undefined}
        />
        <MiniStat label="工具平均" value={fmtDuration(toolLatency.avg)} />
      </div>
      {slowTurns.length > 0 && (
        <Note color={C.high}>
          <span style={{ color: C.high, fontWeight: 600 }}>慢轮(&gt;1.5× P95):</span>
          <span className="tnum" style={{ color: C.sub }}>
            {slowTurns
              .slice(0, 8)
              .map((t) => `T${t.turnIndex}(${fmtDuration(t.duration)})`)
              .join(', ')}
            {slowTurns.length > 8 && ` …+${slowTurns.length - 8}`}
          </span>
        </Note>
      )}
      {toolLatencyByName.length > 0 && (
        <div style={{ marginTop: SP.md }}>
          <SubHead>最慢工具(平均延迟)</SubHead>
          {toolLatencyByName.slice(0, 5).map((t) => (
            <BarRow
              key={t.name}
              label={t.name}
              labelWidth={130}
              ratio={Math.min(1, t.avg / (toolLatencyByName[0]?.avg || 1))}
              color={t.avg > 5000 ? C.high : C.medium}
              right={`${fmtDuration(t.avg)} · ×${t.count}`}
            />
          ))}
        </div>
      )}
    </Card>
  );
}
