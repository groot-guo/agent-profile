'use client';

import type {
  CoverageStatus,
  EvidenceCoverage,
  EvidenceLaneFilter,
  EvidenceOutcomeFilter,
  EvidenceTypeFilter,
  SessionEvidenceEvent,
  SessionEvidencePage,
  SpanType,
} from '@agent-profile/core';
import { useEffect, useRef, useState } from 'react';
import { API } from '../../config';
import { C, FS, fmtBytes, fmtDuration, fmtTime, fmtTokens, R, SP } from '../../theme';
import { Card, Chip, Empty, Notice } from '../../ui';
import { type EvidencePageFilters, evidencePageUrl, mergeEvidenceEvents } from './evidence-data';

export function EvidencePanel({ sessionId, revision }: { sessionId: string; revision?: number }) {
  const [report, setReport] = useState<SessionEvidencePage | null>(null);
  const [events, setEvents] = useState<SessionEvidenceEvent[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [contentMode, setContentMode] = useState<EvidencePageFilters['content']>('none');
  const [typeFilter, setTypeFilter] = useState<EvidenceTypeFilter>('all');
  const [laneFilter, setLaneFilter] = useState<EvidenceLaneFilter>('all');
  const [outcomeFilter, setOutcomeFilter] = useState<EvidenceOutcomeFilter>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const loadMoreControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    loadMoreControllerRef.current?.abort();
    loadMoreControllerRef.current = null;
    setLoadingMore(false);
    setLoading(true);
    setError('');
    setReport(null);
    setEvents([]);
    setExpanded(new Set());
    void fetchEvidencePage(
      sessionId,
      { content: contentMode, type: typeFilter, lane: laneFilter, outcome: outcomeFilter },
      undefined,
      controller.signal,
    )
      .then((next) => {
        if (controller.signal.aborted) return;
        setReport(next);
        setEvents(next.events);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError(reason instanceof Error ? reason.message : '证据时间线加载失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      loadMoreControllerRef.current?.abort();
      loadMoreControllerRef.current = null;
    };
  }, [contentMode, laneFilter, outcomeFilter, revision, sessionId, typeFilter]);

  async function loadMore(): Promise<void> {
    if (!report?.page.nextCursor || loadingMore) return;
    const controller = new AbortController();
    loadMoreControllerRef.current = controller;
    setLoadingMore(true);
    setError('');
    try {
      const next = await fetchEvidencePage(
        sessionId,
        { content: contentMode, type: typeFilter, lane: laneFilter, outcome: outcomeFilter },
        report.page.nextCursor,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setReport(next);
      setEvents((current) => mergeEvidenceEvents(current, next.events));
    } catch (reason: unknown) {
      if (controller.signal.aborted) return;
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setError(reason instanceof Error ? reason.message : '证据时间线加载失败');
    } finally {
      if (loadMoreControllerRef.current === controller) {
        loadMoreControllerRef.current = null;
        setLoadingMore(false);
      }
    }
  }

  function toggleEvent(id: string): void {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (error && !report) {
    return (
      <Card title="规范化运行证据">
        <Notice kind="info">
          证据时间线暂不可用：{error}。如果 Web 与 API 不是同一版本，请重启本地服务。
        </Notice>
      </Card>
    );
  }
  if (!report) {
    return (
      <Card title="规范化运行证据">
        <Empty text="正在加载有界证据窗口…" />
      </Card>
    );
  }

  const showingPreviews = contentMode === 'preview';
  const remaining = Math.max(0, report.counts.matched - events.length);
  return (
    <Card
      title="规范化运行证据"
      meta={`${report.counts.matched} / ${report.counts.total} events · ${report.schemaVersion}`}
      style={{ boxShadow: `inset 3px 0 0 ${C.link}, var(--shadow-card)` }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: SP.lg,
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          marginBottom: SP.md,
        }}
      >
        <div style={{ maxWidth: 700, color: C.sub, fontSize: FS.sm, lineHeight: 1.65 }}>
          这里按稳定 cursor 分页展示数据库中的规范化 Span。覆盖度描述完整
          Session，事件列表只是当前筛选下已加载的窗口；
          可持续加载直到到达全部匹配事件。缺失表示“未采集”，工具未标错只表示“未观察到错误”。
        </div>
        <button
          type="button"
          className="ap-btn"
          disabled={loading}
          onClick={() => setContentMode(showingPreviews ? 'none' : 'preview')}
          style={{
            border: `1px solid ${showingPreviews ? C.high : C.border}`,
            borderRadius: R.md,
            background: showingPreviews ? `${C.high}12` : C.card,
            color: showingPreviews ? C.high : C.link,
            padding: '6px 12px',
            cursor: loading ? 'wait' : 'pointer',
            fontSize: FS.sm,
          }}
        >
          {loading ? '加载中…' : showingPreviews ? '关闭内容预览' : '加载脱敏内容预览'}
        </button>
      </div>

      <CoverageGrid report={report} />

      <div
        style={{
          display: 'flex',
          gap: SP.sm,
          flexWrap: 'wrap',
          alignItems: 'center',
          padding: `${SP.md}px 0`,
          borderTop: `1px solid ${C.borderSoft}`,
          borderBottom: `1px solid ${C.borderSoft}`,
        }}
      >
        <FilterSelect
          label="事件"
          value={typeFilter}
          onChange={(value) => setTypeFilter(value as EvidenceTypeFilter)}
          options={[
            ['all', '全部类型'],
            ['llm_turn', 'LLM 回合'],
            ['tool_call', '工具调用'],
            ['thinking', 'Thinking'],
            ['answer', 'Answer'],
          ]}
        />
        <FilterSelect
          label="链路"
          value={laneFilter}
          onChange={(value) => setLaneFilter(value as EvidenceLaneFilter)}
          options={[
            ['all', '主链 + Sidechain'],
            ['main', '主链'],
            ['sidechain', 'Sidechain'],
          ]}
        />
        <FilterSelect
          label="状态"
          value={outcomeFilter}
          onChange={(value) => setOutcomeFilter(value as EvidenceOutcomeFilter)}
          options={[
            ['all', '全部状态'],
            ['observed_error', '观察到错误'],
            ['no_error_observed', '未观察到错误'],
            ['not_applicable', '不适用'],
          ]}
        />
        <span className="tnum" style={{ marginLeft: 'auto', color: C.mute, fontSize: FS.cap }}>
          已加载 {events.length} / 匹配 {report.counts.matched} / 全部 {report.counts.total}
        </span>
      </div>

      {error && (
        <div style={{ marginTop: SP.sm }}>
          <Notice kind="info">继续加载失败：{error}</Notice>
        </div>
      )}
      {events.length === 0 ? (
        <Empty text="当前筛选条件下没有事件" />
      ) : (
        <div style={{ marginTop: SP.sm }}>
          {events.map((event) => (
            <EvidenceRow
              key={event.id}
              event={event}
              open={expanded.has(event.id)}
              onToggle={() => toggleEvent(event.id)}
            />
          ))}
          {report.page.hasMore && report.page.nextCursor && (
            <div style={{ textAlign: 'center', marginTop: SP.md }}>
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => void loadMore()}
                style={{
                  border: 0,
                  background: 'transparent',
                  color: C.link,
                  cursor: loadingMore ? 'wait' : 'pointer',
                  fontSize: FS.sm,
                }}
              >
                {loadingMore ? '加载中…' : `继续加载 ${Math.min(report.page.limit, remaining)} 条`}
              </button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

async function fetchEvidencePage(
  sessionId: string,
  filters: EvidencePageFilters,
  cursor?: string,
  signal?: AbortSignal,
): Promise<SessionEvidencePage> {
  const response = await fetch(evidencePageUrl(API, sessionId, filters, cursor), { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as SessionEvidencePage;
}

function CoverageGrid({ report }: { report: SessionEvidencePage }) {
  const items: Array<[string, EvidenceCoverage]> = [
    ['结束时间', report.coverage.timing],
    ['父级关联', report.coverage.parentLinks],
    ['工具输入', report.coverage.toolInputs],
    ['工具输出', report.coverage.toolOutputs],
    ['模型身份', report.coverage.modelIdentity],
    ['内容字段', report.coverage.content],
  ];
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
        gap: SP.sm,
        marginBottom: SP.md,
      }}
    >
      {items.map(([label, item]) => (
        <div
          key={label}
          style={{
            padding: `${SP.sm}px ${SP.md}px`,
            borderRadius: R.md,
            background: C.bg,
            border: `1px solid ${C.borderSoft}`,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: SP.sm }}>
            <span style={{ color: C.sub, fontSize: FS.cap }}>{label}</span>
            <span style={{ color: coverageColor(item.status), fontSize: FS.cap }}>
              {coverageLabel(item.status)}
            </span>
          </div>
          <div className="tnum" style={{ color: C.text, fontWeight: 650, marginTop: 2 }}>
            {item.coverage === null ? '—' : `${(item.coverage * 100).toFixed(0)}%`}
            <span style={{ color: C.mute, fontWeight: 400, fontSize: FS.cap }}>
              {' '}
              {item.observed}/{item.total}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: SP.xs, color: C.mute }}>
      <span style={{ fontSize: FS.cap }}>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{
          border: `1px solid ${C.border}`,
          borderRadius: R.sm,
          background: C.card,
          color: C.text,
          padding: '4px 7px',
          fontSize: FS.cap,
        }}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function EvidenceRow({
  event,
  open,
  onToggle,
}: {
  event: SessionEvidenceEvent;
  open: boolean;
  onToggle: () => void;
}) {
  const color = eventColor(event);
  const totalTokens =
    event.metrics.inputTokens +
    event.metrics.cacheCreationTokens +
    event.metrics.cacheReadTokens +
    event.metrics.outputTokens;
  return (
    <article style={{ borderBottom: `1px solid ${C.borderSoft}` }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: '100%',
          border: 0,
          background: 'transparent',
          color: C.text,
          padding: `${SP.sm}px ${SP.xs}px`,
          display: 'grid',
          gridTemplateColumns: '38px 62px minmax(120px, 1fr) auto',
          gap: SP.sm,
          alignItems: 'center',
          textAlign: 'left',
          cursor: 'pointer',
        }}
      >
        <span className="tnum" style={{ color: C.mute, fontSize: FS.cap }}>
          {String(event.sequence).padStart(3, '0')}
        </span>
        <span className="tnum" style={{ color: C.mute, fontSize: FS.cap }}>
          {fmtTime(event.startTime)}
        </span>
        <span style={{ minWidth: 0, display: 'flex', gap: SP.sm, alignItems: 'center' }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: R.pill,
              background: color,
              flexShrink: 0,
            }}
          />
          <span className="clamp1" title={event.name}>
            {event.name}
          </span>
          <Chip color={color}>{typeLabel(event.type)}</Chip>
          {event.lane === 'sidechain' && <Chip color={C.cc}>Sidechain</Chip>}
          {event.outcome === 'observed_error' && <Chip color={C.high}>观察到错误</Chip>}
          {event.parentLink === 'missing_parent' && <Chip color={C.medium}>父级未采集</Chip>}
        </span>
        <span
          className="tnum"
          style={{
            display: 'flex',
            gap: SP.md,
            color: C.sub,
            fontSize: FS.cap,
            whiteSpace: 'nowrap',
          }}
        >
          {event.durationMs === null ? '时长未采集' : fmtDuration(event.durationMs)}
          {totalTokens > 0 && fmtTokens(totalTokens)}
          <span style={{ color: C.mute }}>{open ? '▲' : '▼'}</span>
        </span>
      </button>
      {open && (
        <div
          style={{
            margin: `0 ${SP.xs}px ${SP.sm}px 108px`,
            padding: SP.md,
            borderRadius: R.md,
            background: C.bg,
            color: C.sub,
            fontSize: FS.cap,
            lineHeight: 1.65,
            overflowWrap: 'anywhere',
          }}
        >
          <div className="tnum">
            id {event.id}
            {event.parentId && ` · parent ${event.parentId} (${parentLabel(event.parentLink)})`}
          </div>
          <div className="tnum" style={{ marginTop: SP.xs }}>
            model {event.model ?? 'not captured'} · output {fmtBytes(event.metrics.outputBytes)} ·
            cost{' '}
            {event.metrics.cost === null
              ? 'unknown'
              : `${event.metrics.costCurrency ?? 'currency unknown'} ${event.metrics.cost.toFixed(6)}`}
          </div>
          {event.content.fields.length > 0 && (
            <div style={{ display: 'grid', gap: SP.sm, marginTop: SP.sm }}>
              {event.content.fields.map((field) => (
                <div key={field.name}>
                  <div style={{ display: 'flex', gap: SP.sm, alignItems: 'center' }}>
                    <strong style={{ color: C.text }}>{field.name}</strong>
                    <Chip color={field.status === 'available' ? C.cr : C.mute}>
                      {field.status === 'available' ? '已采集' : '未采集'}
                    </Chip>
                    {field.sourceTruncated && <Chip color={C.medium}>源解析已截断</Chip>}
                  </div>
                  {field.preview !== undefined && (
                    <pre
                      style={{
                        margin: `${SP.xs}px 0 0`,
                        padding: SP.sm,
                        border: `1px solid ${C.borderSoft}`,
                        borderRadius: R.sm,
                        background: C.card,
                        color: C.sub,
                        font: '10px/1.6 var(--font-mono)',
                        whiteSpace: 'pre-wrap',
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {field.preview}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function eventColor(event: SessionEvidenceEvent) {
  if (event.outcome === 'observed_error') return C.high;
  if (event.type === 'llm_turn') return C.link;
  if (event.type === 'tool_call') return C.out;
  if (event.type === 'thinking') return C.cc;
  return C.cr;
}

function typeLabel(type: SpanType) {
  if (type === 'llm_turn') return 'LLM';
  if (type === 'tool_call') return '工具';
  if (type === 'thinking') return 'Thinking';
  return 'Answer';
}

function coverageColor(status: CoverageStatus) {
  if (status === 'complete') return C.cr;
  if (status === 'partial') return C.medium;
  return C.mute;
}

function coverageLabel(status: CoverageStatus) {
  if (status === 'complete') return '完整';
  if (status === 'partial') return '部分';
  if (status === 'not_captured') return '未采集';
  return '不适用';
}

function parentLabel(status: SessionEvidenceEvent['parentLink']) {
  if (status === 'linked') return '已关联';
  if (status === 'missing_parent') return '父级未采集';
  return '根事件';
}
