'use client';

import type {
  CostAttribution,
  DiagnosisResult,
  EfficiencyMetrics,
  EfficiencyScore,
  PerformanceMetrics,
  SessionAnalysisContextPoint,
  SessionAnalysisSpanSummary,
  SessionAnalysisToolEvent,
  SessionAnalysisTurnEvent,
  SessionDetail,
  SessionSummary,
  Span,
  ToolParamAnalysis,
} from '@agent-profile/core';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { API } from '../../config';
import { waitForSessionUpdates } from '../../home-data';
import { AgentMark } from '../../icons';
import { sessionDisplayTitle } from '../../session-navigation';
import {
  C,
  CAT_COLOR,
  catOf,
  DIAG_LABEL,
  FS,
  fmtBytes,
  fmtDuration,
  fmtTime,
  fmtTokens,
  R,
  SEV_COLOR,
  SEV_LABEL,
  SP,
} from '../../theme';
import { BarRow, Card, Chip, Empty, Notice, SoftButton, StatCard, TokenStrip } from '../../ui';
import { EvidencePanel } from './evidence-panel';

interface SessionAnalysis {
  schemaVersion: string;
  session: SessionSummary;
  spanSummary: SessionAnalysisSpanSummary;
  context: {
    total: number;
    isSampled: boolean;
    points: SessionAnalysisContextPoint[];
  };
  toolWindow: {
    total: number;
    isWindowed: boolean;
    events: SessionAnalysisToolEvent[];
  };
  sidechainTurnWindow: {
    total: number;
    isWindowed: boolean;
    events: SessionAnalysisTurnEvent[];
  };
  diagnosis: DiagnosisResult;
  efficiency: EfficiencyMetrics;
  costAttribution: CostAttribution;
  score: EfficiencyScore;
  commits: { hash: string; message: string; date: string; author: string }[];
  performance: PerformanceMetrics;
  toolParams: ToolParamAnalysis;
  limitations: string[];
}

type SessionView = 'overview' | 'context' | 'tools' | 'evidence';

async function loadLegacyAnalysis(id: string, signal: AbortSignal): Promise<SessionAnalysis> {
  const [
    session,
    context,
    diagnosis,
    efficiency,
    costAttribution,
    score,
    commits,
    performance,
    toolParams,
  ] = await Promise.all([
    fetch(`${API}/session/${id}`, { signal }).then((r) =>
      r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)),
    ),
    fetch(`${API}/session/${id}/context`, { signal }).then((r) =>
      r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)),
    ),
    fetch(`${API}/session/${id}/diagnosis`, { signal }).then((r) => (r.ok ? r.json() : null)),
    fetch(`${API}/session/${id}/efficiency`, { signal }).then((r) => (r.ok ? r.json() : null)),
    fetch(`${API}/session/${id}/cost-attribution`, { signal }).then((r) =>
      r.ok ? r.json() : null,
    ),
    fetch(`${API}/session/${id}/score`, { signal }).then((r) => (r.ok ? r.json() : null)),
    fetch(`${API}/session/${id}/commits`, { signal }).then((r) =>
      r.ok ? r.json() : { commits: [] },
    ),
    fetch(`${API}/session/${id}/performance`, { signal }).then((r) => (r.ok ? r.json() : null)),
    fetch(`${API}/session/${id}/tool-params`, { signal }).then((r) => (r.ok ? r.json() : null)),
  ]);
  const legacySession = session as SessionDetail;
  const windows = buildLegacyAnalysisWindows(legacySession.spans);
  const { spans: _spans, ...summary } = legacySession;
  return {
    schemaVersion: 'legacy-session-analysis',
    session: summary,
    spanSummary: windows.spanSummary,
    context: { total: context.length, isSampled: false, points: context },
    toolWindow: windows.toolWindow,
    sidechainTurnWindow: windows.sidechainTurnWindow,
    diagnosis,
    efficiency,
    costAttribution,
    score,
    commits: commits.commits || [],
    performance,
    toolParams,
    limitations: [
      'Legacy Server fallback returned a complete Span response. Restart the API to use bounded analysis.',
    ],
  } as SessionAnalysis;
}

async function loadSessionAnalysis(id: string, signal: AbortSignal): Promise<SessionAnalysis> {
  const response = await fetch(`${API}/session/${id}/analysis-summary`, { signal });
  if (response.ok) return response.json() as Promise<SessionAnalysis>;
  if (response.status === 404) return loadLegacyAnalysis(id, signal);
  throw new Error(`HTTP ${response.status}`);
}

function buildLegacyAnalysisWindows(
  spans: Span[],
): Pick<SessionAnalysis, 'spanSummary' | 'toolWindow' | 'sidechainTurnWindow'> {
  const turns = spans.filter((span) => span.type === 'llm_turn');
  const mainTools = spans.filter((span) => span.type === 'tool_call' && !span.isSidechain);
  const sidechainTurns = turns.filter((turn) => turn.isSidechain);
  const sidechainTools = spans.filter((span) => span.type === 'tool_call' && span.isSidechain);
  const toolStats = new Map<string, { total: number; errors: number }>();
  for (const tool of mainTools) {
    const current = toolStats.get(tool.name) ?? { total: 0, errors: 0 };
    toolStats.set(tool.name, {
      total: current.total + 1,
      errors: current.errors + (tool.isError ? 1 : 0),
    });
  }
  const sortedTools = [...toolStats.entries()].sort(
    ([leftName, left], [rightName, right]) =>
      right.total - left.total || leftName.localeCompare(rightName),
  );
  return {
    spanSummary: {
      events: spans.length,
      llmTurns: turns.length,
      mainToolCalls: mainTools.length,
      sidechainToolCalls: sidechainTools.length,
      observedToolErrors: mainTools.filter((tool) => tool.isError).length,
      toolNames: sortedTools.map(([name, value]) => ({ name, count: value.total })),
      toolErrors: sortedTools
        .filter(([, value]) => value.errors > 0)
        .map(([name, value]) => ({ name, total: value.total, errors: value.errors })),
      sidechain: {
        turns: sidechainTurns.length,
        tools: sidechainTools.length,
        tokens: sidechainTurns.reduce(
          (total, turn) =>
            total +
            turn.inputTokens +
            turn.cacheCreationTokens +
            turn.cacheReadTokens +
            turn.outputTokens,
          0,
        ),
        cost: sidechainTurns.reduce((total, turn) => total + turn.cost, 0),
        costUnknownCount: sidechainTurns.filter((turn) => turn.costUnknown).length,
        taskNames: [...new Set(sidechainTurns.map((turn) => turn.name).filter(Boolean))].slice(
          0,
          20,
        ),
      },
    },
    toolWindow: {
      total: mainTools.length,
      isWindowed: mainTools.length > 50,
      events: mainTools.slice(-50).map((tool) => ({
        id: tool.id,
        name: tool.name,
        startTime: tool.startTime,
        endTime: tool.endTime ?? null,
        outputBytes: tool.outputBytes,
        isError: tool.isError,
      })),
    },
    sidechainTurnWindow: {
      total: sidechainTurns.length,
      isWindowed: sidechainTurns.length > 20,
      events: sidechainTurns.slice(0, 20).map((turn) => ({
        id: turn.id,
        name: turn.name,
        startTime: turn.startTime,
        inputTokens: turn.inputTokens,
        outputTokens: turn.outputTokens,
      })),
    },
  };
}

export default function SessionPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const isEmbed = searchParams.get('embed') === '1';
  const [data, setData] = useState<SessionSummary | null>(null);
  const [spanSummary, setSpanSummary] = useState<SessionAnalysisSpanSummary | null>(null);
  const [context, setContext] = useState<SessionAnalysis['context']>({
    total: 0,
    isSampled: false,
    points: [],
  });
  const [toolWindow, setToolWindow] = useState<SessionAnalysis['toolWindow']>({
    total: 0,
    isWindowed: false,
    events: [],
  });
  const [sidechainTurnWindow, setSidechainTurnWindow] = useState<
    SessionAnalysis['sidechainTurnWindow']
  >({ total: 0, isWindowed: false, events: [] });
  const [diag, setDiag] = useState<DiagnosisResult | null>(null);
  const [eff, setEff] = useState<EfficiencyMetrics | null>(null);
  const [costAttr, setCostAttr] = useState<CostAttribution | null>(null);
  const [score, setScore] = useState<EfficiencyScore | null>(null);
  const [commits, setCommits] = useState<
    { hash: string; message: string; date: string; author: string }[]
  >([]);
  const [perf, setPerf] = useState<PerformanceMetrics | null>(null);
  const [toolParams, setToolParams] = useState<ToolParamAnalysis | null>(null);
  const [activeView, setActiveView] = useState<SessionView>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [liveError, setLiveError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setActiveView('overview');
    setLoading(true);
    setError('');
    setLiveError('');

    const applyAnalysis = (analysis: SessionAnalysis) => {
      if (controller.signal.aborted) return;
      setData(analysis.session);
      setSpanSummary(analysis.spanSummary);
      setContext(analysis.context);
      setToolWindow(analysis.toolWindow);
      setSidechainTurnWindow(analysis.sidechainTurnWindow);
      setDiag(analysis.diagnosis);
      setEff(analysis.efficiency);
      setCostAttr(analysis.costAttribution);
      setScore(analysis.score);
      setCommits(analysis.commits);
      setPerf(analysis.performance);
      setToolParams(analysis.toolParams);
    };

    const run = async () => {
      try {
        applyAnalysis(await loadSessionAnalysis(id, controller.signal));
      } catch (reason: unknown) {
        if (controller.signal.aborted) return;
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError(reason instanceof Error ? reason.message : 'failed');
        return;
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }

      let version = 0;
      while (!controller.signal.aborted) {
        try {
          const update = await waitForSessionUpdates(API, version, controller.signal);
          if (controller.signal.aborted) return;
          const changed = update.version > version;
          version = update.version;
          if (changed && (update.reset || update.sessionIds.includes(id))) {
            applyAnalysis(await loadSessionAnalysis(id, controller.signal));
            setLiveError('');
          }
        } catch (reason: unknown) {
          if (controller.signal.aborted) return;
          if (reason instanceof DOMException && reason.name === 'AbortError') return;
          setLiveError(
            `实时更新已暂停：${reason instanceof Error ? reason.message : '更新通道不可用'}`,
          );
          return;
        }
      }
    };
    void run();
    return () => controller.abort();
  }, [id]);

  if (loading) return <Empty text="加载会话中…" />;
  if (error)
    return (
      <div style={{ padding: SP.xl }}>
        <Notice kind="err">{error}</Notice>
      </div>
    );
  if (!data || !spanSummary) return null;

  const dur = data.endTime ? data.endTime - data.startTime : 0;
  const mainTools = toolWindow.events;
  const toolBars = spanSummary.toolNames.map(({ name, count }) => [name, count] as const);
  const maxToolCount = toolBars[0]?.[1] || 1;
  const totalTokens =
    data.inputTokens + data.cacheCreationTokens + data.cacheReadTokens + data.outputTokens;
  const errorToolCount = spanSummary.observedToolErrors;
  const diagnosisCount = diag?.findings.length ?? 0;

  return (
    <div className="session-page">
      {!isEmbed && (
        <Link href="/" style={{ color: C.link, fontSize: FS.sm, textDecoration: 'none' }}>
          ← 返回列表
        </Link>
      )}

      {/* ===== 头部:名称 + meta + 操作 ===== */}
      <h2
        style={{
          margin: '6px 0 6px',
          fontSize: 20,
          fontWeight: 600,
          color: C.text,
          display: 'flex',
          alignItems: 'center',
          gap: SP.sm,
        }}
      >
        {data.agent ? <AgentMark agent={data.agent} size={26} /> : null}
        <span className="clamp1" title={sessionDisplayTitle(data)}>
          {sessionDisplayTitle(data)}
        </span>
      </h2>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: SP.sm,
          flexWrap: 'wrap',
          marginBottom: SP.md,
        }}
      >
        {data.claudeVersion && <Chip color={C.mute}>v{data.claudeVersion}</Chip>}
        <Chip color={C.mute}>
          <span className="tnum">{data.messageCount}</span>&nbsp;条消息
        </Chip>
        {(data.gitBranch || data.cwd) && (
          <Chip color={C.mute} tip={data.cwd || undefined}>
            {data.gitBranch || data.cwd}
          </Chip>
        )}
        <TagEditor id={id} initialTags={data.tags || ''} />
        <span style={{ flex: 1 }} />
        <ExportLink href={`${API}/session/${id}/export`} label="JSON" />
        <ExportLink href={`${API}/session/${id}/export?format=csv`} label="CSV" />
        <ExportLink href={`${API}/session/${id}/report`} label="Report" color={C.cc} />
      </div>
      {liveError && <Notice kind="info">{liveError}</Notice>}

      {/* ===== 指纹条:本会话 4 类 token 构成 ===== */}
      <div
        role="img"
        aria-label="本会话 Token 构成"
        style={{ display: 'flex', alignItems: 'center', gap: SP.md, marginBottom: SP.lg }}
      >
        <TokenStrip
          input={data.inputTokens}
          cc={data.cacheCreationTokens}
          cr={data.cacheReadTokens}
          out={data.outputTokens}
          height={8}
        />
      </div>

      {/* ===== KPI ===== */}
      <div className="session-kpi-grid">
        <StatCard label="时长" value={fmtDuration(dur)} />
        <StatCard label="消息轮数" value={`${data.messageCount}`} />
        <StatCard
          label="工具调用"
          value={`${spanSummary.mainToolCalls}${spanSummary.sidechainToolCalls > 0 ? ` +${spanSummary.sidechainToolCalls}` : ''}`}
          tip={
            spanSummary.sidechainToolCalls > 0
              ? `主链路 ${spanSummary.mainToolCalls} 次 + 子 agent ${spanSummary.sidechainToolCalls} 次`
              : '主链路工具调用次数'
          }
        />
        <StatCard
          label="峰值上下文"
          value={fmtTokens(data.peakContextTokens)}
          tip="会话中上下文窗口的最大占用"
        />
        <StatCard
          label="Cache 命中"
          value={`${(data.cacheHitRate * 100).toFixed(1)}%`}
          tip="cache_read ÷ (input + cache_creation + cache_read)"
        />
        <StatCard
          label="成本"
          value={data.costUnknownCount > 0 ? '未定价' : `¥${data.totalCost.toFixed(4)}`}
          warn={data.costUnknownCount > 0}
          tip={data.costUnknownCount > 0 ? '包含未知模型,成本无法计算' : '按模型定价表计算'}
          tipAlign="end"
        />
        {score && (
          <StatCard
            label={`效率分${score.percentile ? ` · P${score.percentile}` : ''}`}
            value={`${score.score}`}
            warn={score.score < 50}
            tip={
              score.percentile
                ? `超过 ${score.percentile}% 的同类会话;分数越低可优化空间越大`
                : '综合 cache 命中、浪费比等得出的效率评分'
            }
            tipAlign="end"
          />
        )}
      </div>

      <SessionViewNav
        active={activeView}
        embedded={isEmbed}
        items={[
          {
            id: 'overview',
            label: '概览',
            meta: diagnosisCount > 0 ? `${diagnosisCount} 项建议` : '运行结论',
          },
          {
            id: 'context',
            label: '上下文与成本',
            meta: `峰值 ${fmtTokens(data.peakContextTokens)}`,
          },
          { id: 'tools', label: '工具与链路', meta: `${spanSummary.mainToolCalls} 次调用` },
          { id: 'evidence', label: '运行证据', meta: `${spanSummary.events} 个 Span` },
        ]}
        onChange={setActiveView}
      />

      <section
        id="session-view-panel"
        role="tabpanel"
        aria-labelledby={`session-view-${activeView}-tab`}
        className="session-view-panel fade-in"
      >
        {activeView === 'overview' && (
          <>
            <ViewIntro
              eyebrow="运行结论"
              title="先看诊断，再决定是否下钻"
              description="这里保留最影响判断的建议、性能信号和交付痕迹；资源构成、工具过程和完整 Span 已拆到独立视图。"
            />
            <Card
              title="诊断建议"
              meta={diag ? `可优化 ~${fmtTokens(diag.totalWastedTokens)} token` : undefined}
            >
              <DiagnosisList result={diag} />
            </Card>
            {perf && <PerformancePanel metrics={perf} />}
            {commits.length > 0 && (
              <Card
                title="关联 Git 提交"
                meta={`${commits.length} commits`}
                style={{ boxShadow: `inset 3px 0 0 ${C.cr}, var(--shadow-card)` }}
              >
                {commits.slice(0, 5).map((commit) => (
                  <div key={commit.hash} className="ap-row session-commit-row">
                    <code
                      className="tnum"
                      style={{ color: C.link, flexShrink: 0, fontSize: FS.cap }}
                    >
                      {commit.hash.slice(0, 7)}
                    </code>
                    <span
                      className="clamp1"
                      title={commit.message}
                      style={{ flex: 1, color: C.text, minWidth: 0 }}
                    >
                      {commit.message}
                    </span>
                    <span
                      className="tnum"
                      style={{ flexShrink: 0, color: C.mute, fontSize: FS.cap }}
                    >
                      {commit.date?.slice(0, 16)}
                    </span>
                  </div>
                ))}
                {commits.length > 5 && (
                  <div style={{ fontSize: FS.cap, color: C.mute, padding: '3px 6px' }}>
                    … 还有 {commits.length - 5} 个提交
                  </div>
                )}
              </Card>
            )}
          </>
        )}

        {activeView === 'context' && (
          <>
            <ViewIntro
              eyebrow="资源轨迹"
              title="上下文怎样增长，成本花在哪里"
              description="把上下文曲线、四类 Token 和成本归因放在同一条分析路径里，避免在互不相邻的卡片之间来回对照。"
            />
            <Card
              title="上下文窗口增长曲线"
              meta={
                context.isSampled
                  ? `${context.points.length} / ${context.total} points · 有界采样`
                  : '窗口上限 · 内置估算'
              }
            >
              <ContextChart points={context.points} tools={mainTools} />
            </Card>
            <Card title="Token 拆解" meta={`合计 ${fmtTokens(totalTokens)}`}>
              <TokenStrip
                input={data.inputTokens}
                cc={data.cacheCreationTokens}
                cr={data.cacheReadTokens}
                out={data.outputTokens}
                height={14}
              />
              <div className="session-token-legend">
                {[
                  { v: data.inputTokens, c: C.input, l: 'input' },
                  { v: data.cacheCreationTokens, c: C.cc, l: 'cache_create' },
                  { v: data.cacheReadTokens, c: C.cr, l: 'cache_read' },
                  { v: data.outputTokens, c: C.out, l: 'output' },
                ].map((item) => (
                  <span
                    key={item.l}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  >
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        background: item.c,
                        borderRadius: 3,
                        display: 'inline-block',
                      }}
                    />
                    <span className="tnum" style={{ color: C.text, fontWeight: 600 }}>
                      {fmtTokens(item.v)}
                    </span>
                    <span style={{ color: C.sub }}>
                      {item.l} ·{' '}
                      <span className="tnum">
                        {((item.v / (totalTokens || 1)) * 100).toFixed(1)}%
                      </span>
                    </span>
                  </span>
                ))}
              </div>
            </Card>
            {costAttr && <CostAttributionPanel attr={costAttr} />}
          </>
        )}

        {activeView === 'tools' && (
          <>
            <ViewIntro
              eyebrow="执行过程"
              title="工具、参数与子链路放在一起看"
              description={`主链路 ${spanSummary.mainToolCalls} 次调用，其中 ${errorToolCount} 次观察到错误；Sidechain 单独计量，不混入主链路分布。事件明细通过有界窗口和 Evidence 分页查看。`}
            />
            {spanSummary.sidechain.turns > 0 && (
              <SidechainSummary summary={spanSummary.sidechain} turnWindow={sidechainTurnWindow} />
            )}
            {eff && <EfficiencyPanel metrics={eff} />}
            {toolParams && (
              <Card title="工具参数模式">
                <div className="session-tool-param-grid">
                  {toolParams.bashCategories.length > 0 && (
                    <div>
                      <SubHead>Bash 命令分类</SubHead>
                      {toolParams.bashCategories.map((item) => (
                        <KV key={item.category} k={item.category} v={`${item.count}`} />
                      ))}
                    </div>
                  )}
                  <div>
                    <SubHead>Read 参数</SubHead>
                    <KV k="带 limit 读取" v={`${toolParams.readParamStats.withLimit}`} />
                    <KV k="整文件读取" v={`${toolParams.readParamStats.withoutLimit}`} />
                    {toolParams.readParamStats.avgLimit != null && (
                      <KV k="平均 limit" v={`${toolParams.readParamStats.avgLimit}`} />
                    )}
                  </div>
                  {toolParams.frequentPairs.length > 0 && (
                    <div>
                      <SubHead>高频工具组合</SubHead>
                      {toolParams.frequentPairs.slice(0, 5).map((pair) => (
                        <KV key={pair.pair} k={pair.pair} v={`×${pair.count}`} />
                      ))}
                    </div>
                  )}
                </div>
              </Card>
            )}
            <div className="session-card-grid">
              <Card
                title="工具调用次数"
                meta={spanSummary.sidechainToolCalls > 0 ? '主链路' : undefined}
                style={{ marginBottom: 0 }}
              >
                {toolBars.length === 0 ? (
                  <Empty text="本会话没有工具调用" />
                ) : (
                  toolBars.map(([name, count]) => (
                    <BarRow
                      key={name}
                      label={name}
                      labelWidth={120}
                      ratio={count / maxToolCount}
                      color={CAT_COLOR[catOf(name)] || C.mute}
                      right={`${count} 次 · ${spanSummary.mainToolCalls > 0 ? ((count / spanSummary.mainToolCalls) * 100).toFixed(0) : 0}%`}
                    />
                  ))
                )}
              </Card>
              <Card
                title="工具错误"
                meta={`${errorToolCount} / ${spanSummary.mainToolCalls}`}
                style={{ marginBottom: 0 }}
              >
                <ToolErrors errors={spanSummary.toolErrors} />
              </Card>
            </div>
            <Card
              title="工具调用时间线"
              meta={
                toolWindow.isWindowed
                  ? `最近 ${mainTools.length} / ${toolWindow.total} 次`
                  : `共 ${toolWindow.total} 次`
              }
            >
              <ToolTimeline window={toolWindow} />
            </Card>
          </>
        )}

        {activeView === 'evidence' && (
          <>
            <ViewIntro
              eyebrow="规范化证据"
              title="需要核查时，再进入完整 Span"
              description="默认只加载结构化事件和覆盖度；输入、输出、thinking 与 answer 内容仍需主动请求脱敏且有界的预览。"
            />
            <EvidencePanel sessionId={id} revision={data.importedAt} />
          </>
        )}
      </section>
    </div>
  );
}

function SessionViewNav({
  active,
  embedded,
  items,
  onChange,
}: {
  active: SessionView;
  embedded: boolean;
  items: { id: SessionView; label: string; meta: string }[];
  onChange: (view: SessionView) => void;
}) {
  return (
    <div className="session-view-nav" data-embedded={embedded ? 'true' : 'false'}>
      <div className="session-view-nav-label">
        <span>分析视图</span>
        <span className="tnum">04</span>
      </div>
      <div className="session-view-tabs" role="tablist" aria-label="Session 分析视图">
        {items.map((item) => {
          const selected = active === item.id;
          return (
            <button
              key={item.id}
              id={`session-view-${item.id}-tab`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls="session-view-panel"
              className="session-view-tab"
              data-active={selected ? 'true' : 'false'}
              onClick={() => onChange(item.id)}
            >
              <span>{item.label}</span>
              <span className="tnum">{item.meta}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ViewIntro({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="session-view-intro">
      <div>{eyebrow}</div>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

function SubHead({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ color: C.sub, fontWeight: 600, fontSize: FS.sm, marginBottom: SP.xs }}>
      {children}
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: SP.sm,
        padding: '2px 0',
        fontSize: FS.sm,
      }}
    >
      <span className="clamp1" title={k} style={{ color: C.text, minWidth: 0 }}>
        {k}
      </span>
      <span className="tnum" style={{ color: C.sub, flexShrink: 0 }}>
        {v}
      </span>
    </div>
  );
}

function ExportLink({
  href,
  label,
  color = C.link,
}: {
  href: string;
  label: string;
  color?: string;
}) {
  return (
    <a
      href={href}
      download
      className="ap-btn"
      style={{
        color,
        textDecoration: 'none',
        fontSize: FS.cap,
        fontWeight: 500,
        padding: '3px 10px',
        border: `1px solid ${C.border}`,
        borderRadius: R.md,
        background: C.card,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        transition: 'box-shadow .15s ease, transform .15s ease',
      }}
    >
      ⬇ {label}
    </a>
  );
}

function Note({ color, children }: { color: string; children: React.ReactNode }) {
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

function ContextChart({
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

function Legend({ color, label }: { color: string; label: string }) {
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

function SidechainSummary({
  summary,
  turnWindow,
}: {
  summary: SessionAnalysisSpanSummary['sidechain'];
  turnWindow: SessionAnalysis['sidechainTurnWindow'];
}) {
  const [open, setOpen] = useState(false);

  return (
    <Card style={{ boxShadow: `inset 3px 0 0 ${C.cc}, var(--shadow-card)` }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
          gap: SP.md,
        }}
        onClick={() => setOpen(!open)}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: FS.title, fontWeight: 600, color: C.text }}>子 agent 调用链</div>
          <div style={{ fontSize: FS.sm, color: C.sub, marginTop: 4 }}>
            <span className="tnum">{summary.turns}</span> 轮推理 ·{' '}
            <span className="tnum">{summary.tools}</span> 次工具调用 ·{' '}
            <span className="tnum">{fmtTokens(summary.tokens)}</span> token · 成本{' '}
            {summary.costUnknownCount > 0 ? (
              '部分未定价'
            ) : (
              <span className="tnum">¥{summary.cost.toFixed(4)}</span>
            )}
            {summary.taskNames.length > 0 && ` · 任务: ${summary.taskNames.slice(0, 3).join(', ')}`}
          </div>
        </div>
        <span
          style={{
            color: C.mute,
            fontSize: 10,
            flexShrink: 0,
            transition: 'transform .15s ease',
            transform: open ? 'none' : 'rotate(-90deg)',
          }}
        >
          ▼
        </span>
      </div>
      {open && (
        <div
          style={{
            marginTop: SP.md,
            paddingTop: SP.md,
            boxShadow: `0 1px 0 ${C.borderSoft} inset`,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {turnWindow.events.map((turn) => (
              <div
                key={turn.id}
                style={{ fontSize: FS.sm, color: C.sub, display: 'flex', gap: SP.sm }}
              >
                <span className="tnum" style={{ minWidth: 64, flexShrink: 0, color: C.mute }}>
                  {fmtTime(turn.startTime)}
                </span>
                <span
                  className="clamp1"
                  title={turn.name || turn.id}
                  style={{ color: C.text, minWidth: 0, flex: 1 }}
                >
                  {turn.name || turn.id.slice(0, 12)}
                </span>
                <span className="tnum" style={{ flexShrink: 0 }}>
                  in {fmtTokens(turn.inputTokens)} · out {fmtTokens(turn.outputTokens)}
                </span>
              </div>
            ))}
            {turnWindow.isWindowed && (
              <div style={{ fontSize: FS.cap, color: C.mute }}>
                当前显示前 {turnWindow.events.length} / {turnWindow.total} 轮；完整事件请使用
                Evidence 分页。
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function ToolErrors({ errors }: { errors: SessionAnalysisSpanSummary['toolErrors'] }) {
  if (errors.length === 0) return <div style={{ fontSize: FS.sm, color: C.cr }}>✓ 无工具错误</div>;

  return (
    <div>
      {errors.map((entry) => (
        <BarRow
          key={entry.name}
          label={entry.name}
          labelWidth={180}
          ratio={(entry.total - entry.errors) / entry.total}
          color={C.cr}
          right={
            <span style={{ color: C.high }}>
              {entry.errors}/{entry.total} 错误 ({((entry.errors / entry.total) * 100).toFixed(0)}%)
            </span>
          }
        />
      ))}
    </div>
  );
}

function ToolTimeline({ window }: { window: SessionAnalysis['toolWindow'] }) {
  if (window.total === 0) return <Empty text="无工具调用" />;
  const sequenceStart = window.total - window.events.length;

  return (
    <div>
      <div style={{ maxHeight: 320, overflowY: 'auto' }}>
        {window.events.map((tool, index) => {
          const duration = tool.endTime ? tool.endTime - tool.startTime : 0;
          const category = catOf(tool.name);
          return (
            <div
              key={tool.id}
              className="ap-row"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: SP.sm,
                padding: '4px 6px',
                borderRadius: R.sm,
                fontSize: FS.sm,
                color: C.text,
              }}
            >
              <span
                className="tnum"
                style={{
                  color: C.mute,
                  width: 26,
                  textAlign: 'right',
                  flexShrink: 0,
                  fontSize: FS.cap,
                }}
              >
                {sequenceStart + index + 1}
              </span>
              <span
                className="tnum"
                style={{ width: 58, color: C.mute, flexShrink: 0, fontSize: FS.cap }}
              >
                {fmtTime(tool.startTime)}
              </span>
              <Chip
                color={CAT_COLOR[category] || C.mute}
                style={{ width: 62, justifyContent: 'center', flexShrink: 0 }}
              >
                {category}
              </Chip>
              <span className="clamp1" title={tool.name} style={{ flex: 1, minWidth: 0 }}>
                {tool.name}
              </span>
              <span className="tnum" style={{ color: C.sub, flexShrink: 0, fontSize: FS.cap }}>
                {fmtDuration(duration)}
              </span>
              <span
                className="tnum"
                style={{
                  width: 56,
                  textAlign: 'right',
                  color: C.sub,
                  flexShrink: 0,
                  fontSize: FS.cap,
                }}
              >
                {fmtBytes(tool.outputBytes)}
              </span>
              {tool.isError ? (
                <span style={{ color: C.high, flexShrink: 0 }} title="工具返回错误">
                  ✕
                </span>
              ) : (
                <span style={{ color: C.cr, flexShrink: 0 }}>✓</span>
              )}
            </div>
          );
        })}
      </div>
      {window.isWindowed && (
        <div style={{ textAlign: 'center', marginTop: SP.sm, fontSize: FS.cap, color: C.sub }}>
          仅显示最近 {window.events.length} / {window.total} 次；完整工具事件请使用 Evidence 分页。
        </div>
      )}
    </div>
  );
}

function EfficiencyPanel({ metrics }: { metrics: EfficiencyMetrics }) {
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

function CostAttributionPanel({ attr }: { attr: CostAttribution }) {
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

function PerformancePanel({ metrics }: { metrics: PerformanceMetrics }) {
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

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: C.bg, borderRadius: R.md, padding: `${SP.sm}px ${SP.md}px` }}>
      <div className="tnum" style={{ fontSize: FS.title, fontWeight: 600, color: color || C.text }}>
        {value}
      </div>
      <div style={{ fontSize: FS.cap, color: C.sub }}>{label}</div>
    </div>
  );
}

function TagEditor({ id, initialTags }: { id: string; initialTags: string }) {
  const [tags, setTags] = useState(initialTags);
  const [editing, setEditing] = useState(false);
  const save = async () => {
    await fetch(`${API}/session/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tags }),
    });
    setEditing(false);
  };
  if (!editing)
    return (
      <span onClick={() => setEditing(true)} data-tip="点击编辑标签" style={{ cursor: 'pointer' }}>
        {tags ? (
          tags.split(',').map((t) => (
            <Chip key={t} color={C.link} style={{ marginRight: 3 }}>
              {t.trim()}
            </Chip>
          ))
        ) : (
          <Chip
            color={C.mute}
            style={{ border: `1px dashed ${C.border}`, background: 'transparent' }}
          >
            + 标签
          </Chip>
        )}
      </span>
    );
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      <input
        value={tags}
        onChange={(e) => setTags(e.target.value)}
        placeholder="逗号分隔标签"
        size={15}
        style={{
          padding: '3px 8px',
          fontSize: FS.cap,
          border: `1px solid ${C.link}`,
          borderRadius: R.sm,
          background: C.card,
          color: C.text,
          outline: 'none',
        }}
      />
      <SoftButton
        variant="primary"
        onClick={save}
        style={{ padding: '2px 10px', fontSize: FS.cap }}
      >
        保存
      </SoftButton>
    </span>
  );
}

function DiagnosisList({ result }: { result: DiagnosisResult | null }) {
  if (!result) return <Empty text="诊断不可用" hint="server 未返回诊断结果" />;
  if (result.findings.length === 0) {
    return <div style={{ color: C.cr, fontSize: FS.sm }}>✓ 未发现明显可优化项</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SP.md }}>
      {result.findings.map((f, i) => (
        <div
          key={f.spanIds[0] ? `${f.type}-${f.spanIds[0]}` : i}
          style={{
            borderRadius: R.md,
            padding: SP.md,
            boxShadow: `inset 3px 0 0 ${SEV_COLOR[f.severity]}`,
            background: `${SEV_COLOR[f.severity]}0A`,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: SP.md,
            }}
          >
            <div
              style={{
                minWidth: 0,
                display: 'flex',
                alignItems: 'center',
                gap: SP.sm,
                flexWrap: 'wrap',
              }}
            >
              <Chip color={SEV_COLOR[f.severity]}>
                {SEV_LABEL[f.severity] || f.severity} · {DIAG_LABEL[f.type]}
              </Chip>
              <span style={{ fontSize: FS.base, color: C.text, fontWeight: 600 }}>{f.title}</span>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div className="tnum" style={{ fontSize: FS.base, fontWeight: 600, color: C.cc }}>
                ~{fmtTokens(f.wastedTokens)}
              </div>
              <div
                className="tnum"
                style={{ fontSize: FS.cap, color: f.costUnknown ? C.medium : C.mute }}
              >
                {f.costUnknown ? '未定价' : `¥${f.wastedCost.toFixed(5)}`}
              </div>
            </div>
          </div>
          <div
            style={{
              fontSize: FS.sm,
              color: C.sub,
              marginTop: SP.sm,
              lineHeight: 1.6,
              wordBreak: 'break-word',
            }}
          >
            {f.detail}
          </div>
          <div
            style={{
              fontSize: FS.sm,
              color: C.cr,
              marginTop: SP.xs,
              lineHeight: 1.6,
              wordBreak: 'break-word',
            }}
          >
            💡 {f.suggestion}
          </div>
        </div>
      ))}
    </div>
  );
}
