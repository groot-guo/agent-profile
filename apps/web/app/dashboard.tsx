'use client';

import type { SessionSummary } from '@agent-profile/core';
import type { ImportJobStatus } from './config';
import { AgentMark } from './icons';
import { importExperienceState, sourceStatusText } from './import-state';
import { AGENT_COLORS, AGENT_LABELS, C, FS, fmtTokens, R, SP } from './theme';
import { BarRow, Card, SectionTitle, SoftButton, StatCard, TokenStrip } from './ui';

const SHADOW_CARD = 'var(--shadow-card)';
const DASHBOARD_SKELETON_KEYS = [
  'sessions',
  'tokens',
  'cost',
  'cache',
  'context',
  'input',
  'output',
  'pricing',
] as const;

export interface StatsOverview {
  totalSessions: number;
  totalTokens: number;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  avgCacheHitRate: number;
  avgPeakContext: number;
  sessionsWithCostUnknown: number;
}

export interface ToolFreq {
  name: string;
  count: number;
  errors: number;
}

export function DashboardView({
  sessions,
  overview,
  toolFreqs,
  loading,
  importStatus,
  onStartImport,
  onSelectSession,
}: {
  sessions: SessionSummary[];
  overview: StatsOverview | null;
  toolFreqs: ToolFreq[];
  loading: boolean;
  importStatus: ImportJobStatus | null;
  onStartImport: () => void;
  onSelectSession?: (id: string) => void;
}) {
  const experienceState = importExperienceState(loading, sessions.length, importStatus);
  if (experienceState === 'loading') return <DashboardSkeleton />;
  if (!overview) return null;
  if (sessions.length === 0) {
    return <FirstRunOnboarding importStatus={importStatus} onStartImport={onStartImport} />;
  }

  const totalOf = (s: SessionSummary) =>
    s.inputTokens + s.cacheCreationTokens + s.cacheReadTokens + s.outputTokens;
  const topByCost = [...sessions].sort((a, b) => b.totalCost - a.totalCost).slice(0, 10);
  const topByTokens = [...sessions].sort((a, b) => totalOf(b) - totalOf(a)).slice(0, 10);
  const agentCounts = new Map<string, number>();
  for (const s of sessions) agentCounts.set(s.agent, (agentCounts.get(s.agent) || 0) + 1);

  return (
    <div style={{ padding: SP.xl, maxWidth: 1200, margin: '0 auto' }}>
      {/* 主指标 */}
      <SectionTitle meta={`共 ${overview.totalSessions} 个会话`}>总览</SectionTitle>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: SP.md,
          marginBottom: SP.md,
        }}
      >
        <StatCard value={overview.totalSessions} label="会话数" tip="已导入的 session 总数" />
        <StatCard
          value={fmtTokens(overview.totalTokens)}
          label="总 Token"
          tip="input + cache_creation + cache_read + output 合计"
        />
        <StatCard
          value={`¥${overview.totalCost.toFixed(2)}`}
          label="总成本"
          warn={overview.sessionsWithCostUnknown > 0}
          tip="按模型定价表计算;未定价模型不计入"
        />
        <StatCard
          value={`${(overview.avgCacheHitRate * 100).toFixed(1)}%`}
          label="平均 Cache 命中"
          tip="cache_read ÷ (input + cache_creation + cache_read),越高越省成本"
        />
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: SP.md,
          marginBottom: SP.xl,
        }}
      >
        <StatCard
          value={fmtTokens(overview.avgPeakContext)}
          label="平均峰值上下文"
          tip="各会话上下文窗口峰值的平均值"
        />
        <StatCard
          value={fmtTokens(overview.totalInputTokens)}
          label="总输入(含 cache)"
          tip="input + cache_creation + cache_read"
        />
        <StatCard value={fmtTokens(overview.totalOutputTokens)} label="总输出" />
        <StatCard
          value={`${overview.sessionsWithCostUnknown}`}
          label="未定价会话"
          warn={overview.sessionsWithCostUnknown > 0}
          tip="包含未知模型的会话,成本无法计算,列表中标记为「未定价」"
        />
      </div>

      {/* Agent 分布 */}
      <SectionTitle>Agent 分布</SectionTitle>
      <div style={{ display: 'flex', gap: SP.md, flexWrap: 'wrap', marginBottom: SP.xl }}>
        {[...agentCounts.entries()].map(([agent, count]) => (
          <div
            key={agent}
            style={{
              padding: `${SP.md}px ${SP.lg}px`,
              background: C.card,
              borderRadius: R.lg,
              boxShadow: SHADOW_CARD,
              display: 'flex',
              alignItems: 'center',
              gap: SP.md,
              minWidth: 132,
            }}
          >
            <AgentMark agent={agent} size={28} />
            <div>
              <div
                style={{ fontSize: FS.cap, color: AGENT_COLORS[agent] || C.mute, fontWeight: 500 }}
              >
                {AGENT_LABELS[agent] || agent}
              </div>
              <div
                className="tnum"
                style={{ fontSize: FS.kpi, fontWeight: 600, color: C.text, lineHeight: 1.25 }}
              >
                {count}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 工具频次 */}
      {toolFreqs.length > 0 && (
        <Card title="高频工具" meta="最近 30 个会话">
          {toolFreqs.map((t) => (
            <BarRow
              key={t.name}
              label={t.name}
              ratio={t.count / toolFreqs[0].count}
              color={t.errors > 0 ? C.medium : C.link}
              right={
                <>
                  {t.count} 次
                  {t.errors > 0 && <span style={{ color: C.high }}> · 错误 {t.errors}</span>}
                </>
              }
            />
          ))}
        </Card>
      )}

      {/* Top 会话 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: SP.xl,
        }}
      >
        <Card title="成本 Top 10">
          <TopList
            sessions={topByCost}
            metric={(s) => `¥${s.totalCost.toFixed(3)}`}
            metricColor={C.out}
            onSelect={onSelectSession}
          />
        </Card>
        <Card title="Token Top 10">
          <TopList
            sessions={topByTokens}
            metric={(s) => fmtTokens(totalOf(s))}
            metricColor={C.link}
            onSelect={onSelectSession}
          />
        </Card>
      </div>

      {/* 数据口径 */}
      <Card title="数据口径说明" pad={SP.lg}>
        <div style={{ fontSize: FS.sm, color: C.sub, lineHeight: 1.9 }}>
          <Line>
            Token 优先取自来源 <Code>usage</Code> 字段(input / cache_creation / cache_read /
            output)； Codex 只有 total 时保留为已标记的未分类回退，不按文本长度估算
          </Line>
          <Line>
            成本 = (input×输入价 + cc×创建价 + cr×读取价 + output×输出价) ÷ 1M,按模型定价表计算
          </Line>
          <Line>
            上下文大小 = input + cache_creation + cache_read;Cache 命中率 = cache_read ÷ 上下文大小
          </Line>
          <Line>未知模型的成本不估算,统一显示「未定价」</Line>
          <Line>启动与“重新扫描”共享任务状态，检查 Claude Code、Codex、Zed 和 MiMo Code</Line>
        </div>
      </Card>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="正在加载数据总览"
      style={{ padding: SP.xl, maxWidth: 1200, margin: '0 auto', minHeight: 520 }}
    >
      <div style={{ width: 120, height: 20, borderRadius: R.sm, background: C.borderSoft }} />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: SP.md,
          marginTop: SP.lg,
        }}
      >
        {DASHBOARD_SKELETON_KEYS.map((key) => (
          <div
            key={key}
            style={{ height: 92, borderRadius: R.lg, background: C.card, boxShadow: SHADOW_CARD }}
          />
        ))}
      </div>
    </div>
  );
}

function FirstRunOnboarding({
  importStatus,
  onStartImport,
}: {
  importStatus: ImportJobStatus | null;
  onStartImport: () => void;
}) {
  const sources = importStatus?.sources ?? [];
  const available = sources.filter((source) => source.available).length;
  const failures = sources.filter((source) => source.state === 'failed').length;
  const active = importStatus?.active ?? false;
  return (
    <div style={{ padding: SP.xl, maxWidth: 920, margin: '0 auto' }}>
      <Card title="开始分析本地 Agent 会话" pad={SP.xl}>
        <div style={{ color: C.sub, lineHeight: 1.7, maxWidth: 680 }}>
          Agent Profile 会在本机读取支持的数据源并生成分析。原始对话不会通过此状态页面返回，
          这里只显示数据源是否可用和导入数量。
        </div>
        <div
          aria-live="polite"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: SP.md,
            margin: `${SP.xl}px 0`,
          }}
        >
          {sources.map((source) => (
            <div
              key={source.id}
              style={{
                border: `1px solid ${C.borderSoft}`,
                borderRadius: R.lg,
                padding: SP.lg,
                minHeight: 112,
                background: C.bg,
              }}
            >
              <div style={{ fontWeight: 600, color: C.text }}>{source.label}</div>
              <div style={{ marginTop: SP.sm, color: C.sub, fontSize: FS.sm }}>
                {sourceStatusText(source)}
              </div>
              {source.result && (
                <div className="tnum" style={{ marginTop: 6, color: C.mute, fontSize: FS.cap }}>
                  新增 {source.result.imported} · 更新 {source.result.updated} · 跳过{' '}
                  {source.result.skipped}
                </div>
              )}
            </div>
          ))}
        </div>
        <SoftButton
          variant="primary"
          onClick={onStartImport}
          disabled={active}
          style={{ minHeight: 44, paddingInline: SP.xl }}
        >
          {active
            ? '正在导入本地数据…'
            : failures > 0
              ? '重试导入'
              : available === 0
                ? '重新检测数据源'
                : '导入可用数据源'}
        </SoftButton>
        {available === 0 && (
          <div style={{ marginTop: SP.md, color: C.mute, fontSize: FS.sm }}>
            暂未发现 Claude Code、Codex、Zed 或 MiMo Code 数据。使用过其中任一工具后再刷新检测。
          </div>
        )}
      </Card>
    </div>
  );
}

function Line({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: SP.sm }}>
      <span style={{ color: C.mute }}>·</span>
      <span style={{ flex: 1 }}>{children}</span>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code
      className="tnum"
      style={{ background: C.borderSoft, padding: '1px 5px', borderRadius: 4, fontSize: FS.cap }}
    >
      {children}
    </code>
  );
}

function TopList({
  sessions,
  metric,
  metricColor,
  onSelect,
}: {
  sessions: SessionSummary[];
  metric: (s: SessionSummary) => string;
  metricColor: string;
  onSelect?: (id: string) => void;
}) {
  return (
    <div>
      {sessions.map((s, i) => {
        const name = s.name || s.id.slice(0, 8);
        return (
          <div
            key={s.id}
            onClick={() => onSelect?.(s.id)}
            className="ap-row"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: SP.sm,
              cursor: 'pointer',
              padding: '6px 8px',
              borderRadius: R.md,
              fontSize: FS.sm,
            }}
          >
            <span
              className="tnum"
              style={{
                width: 22,
                textAlign: 'right',
                color: i < 3 ? C.out : C.mute,
                fontWeight: i < 3 ? 600 : 400,
                flexShrink: 0,
                fontSize: FS.cap,
              }}
            >
              {i + 1}
            </span>
            <AgentMark agent={s.agent} size={18} />
            <span className="clamp1" title={name} style={{ color: C.text, flex: 1, minWidth: 0 }}>
              {name}
            </span>
            <span style={{ width: 72, flexShrink: 0, display: 'flex' }}>
              <TokenStrip
                input={s.inputTokens}
                cc={s.cacheCreationTokens}
                cr={s.cacheReadTokens}
                out={s.outputTokens}
                height={3}
              />
            </span>
            <span
              className="tnum"
              style={{ color: metricColor, fontWeight: 600, flexShrink: 0, fontSize: FS.sm }}
            >
              {metric(s)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
