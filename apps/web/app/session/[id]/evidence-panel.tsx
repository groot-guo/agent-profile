'use client';

import type {
  CoverageStatus,
  EvidenceCoverage,
  EvidenceLane,
  EvidenceOutcome,
  SessionEvidenceEvent,
  SessionEvidenceReport,
  SpanType,
} from '@agent-profile/core';
import { useEffect, useMemo, useState } from 'react';
import { API } from '../../config';
import { C, FS, fmtBytes, fmtDuration, fmtTime, fmtTokens, R, SP } from '../../theme';
import { Card, Chip, Empty, Notice } from '../../ui';

const EVENT_BATCH = 80;

type TypeFilter = 'all' | SpanType;
type LaneFilter = 'all' | EvidenceLane;
type OutcomeFilter = 'all' | EvidenceOutcome;

export function EvidencePanel({ sessionId }: { sessionId: string }) {
  const [report, setReport] = useState<SessionEvidenceReport | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [laneFilter, setLaneFilter] = useState<LaneFilter>('all');
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>('all');
  const [visible, setVisible] = useState(EVENT_BATCH);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    void load('none');
  }, [sessionId]);

  async function load(content: 'none' | 'preview') {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(
        `${API}/session/${encodeURIComponent(sessionId)}/evidence?content=${content}`,
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setReport((await response.json()) as SessionEvidenceReport);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '证据时间线加载失败');
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(
    () =>
      (report?.events ?? []).filter(
        (event) =>
          (typeFilter === 'all' || event.type === typeFilter) &&
          (laneFilter === 'all' || event.lane === laneFilter) &&
          (outcomeFilter === 'all' || event.outcome === outcomeFilter),
      ),
    [report, typeFilter, laneFilter, outcomeFilter],
  );

  function updateFilter(setter: (value: string) => void, value: string) {
    setter(value);
    setVisible(EVENT_BATCH);
  }

  function toggleEvent(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (error) {
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
        <Empty text="正在组织完整的 Span 时间线…" />
      </Card>
    );
  }

  const showingPreviews = report.privacy.contentMode === 'preview';
  return (
    <Card
      title="规范化运行证据"
      meta={`${report.scope.events} events · ${report.schemaVersion}`}
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
          这里按时间展示数据库中的全部规范化 Span，不等同于完整原始对话：当前各来源并未统一采集
          用户消息和所有 Runtime 事件。缺失表示“未采集”，工具未标错只表示“未观察到错误”。
        </div>
        <button
          type="button"
          className="ap-btn"
          disabled={loading}
          onClick={() => void load(showingPreviews ? 'none' : 'preview')}
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
          onChange={(value) => updateFilter((next) => setTypeFilter(next as TypeFilter), value)}
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
          onChange={(value) => updateFilter((next) => setLaneFilter(next as LaneFilter), value)}
          options={[
            ['all', '主链 + Sidechain'],
            ['main', '主链'],
            ['sidechain', 'Sidechain'],
          ]}
        />
        <FilterSelect
          label="状态"
          value={outcomeFilter}
          onChange={(value) =>
            updateFilter((next) => setOutcomeFilter(next as OutcomeFilter), value)
          }
          options={[
            ['all', '全部状态'],
            ['observed_error', '观察到错误'],
            ['no_error_observed', '未观察到错误'],
            ['not_applicable', '不适用'],
          ]}
        />
        <span className="tnum" style={{ marginLeft: 'auto', color: C.mute, fontSize: FS.cap }}>
          {filtered.length} / {report.scope.events}
        </span>
      </div>

      {filtered.length === 0 ? (
        <Empty text="当前筛选条件下没有事件" />
      ) : (
        <div style={{ marginTop: SP.sm }}>
          {filtered.slice(0, visible).map((event) => (
            <EvidenceRow
              key={event.id}
              event={event}
              open={expanded.has(event.id)}
              onToggle={() => toggleEvent(event.id)}
            />
          ))}
          {visible < filtered.length && (
            <div style={{ textAlign: 'center', marginTop: SP.md }}>
              <button
                type="button"
                onClick={() => setVisible((current) => current + EVENT_BATCH)}
                style={{
                  border: 0,
                  background: 'transparent',
                  color: C.link,
                  cursor: 'pointer',
                  fontSize: FS.sm,
                }}
              >
                再显示 {Math.min(EVENT_BATCH, filtered.length - visible)} 条
              </button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function CoverageGrid({ report }: { report: SessionEvidenceReport }) {
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
