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
  SessionSummary,
  ToolParamAnalysis,
} from '@agent-profile/core';
import { useState } from 'react';
import { API } from '../../config';
import {
  C,
  CAT_COLOR,
  catOf,
  FS,
  fmtBytes,
  fmtDuration,
  fmtTime,
  fmtTokens,
  R,
  SP,
} from '../../theme';
import { BarRow, Card, Chip, Empty, SoftButton } from '../../ui';
import type { SessionRelationshipReport } from './source-relationship-card';

export interface SessionAnalysis {
  schemaVersion: string;
  session: SessionSummary;
  relationships?: SessionRelationshipReport;
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

export function SidechainSummary({
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
            {summary.turns > 0 && summary.tokens === 0 && summary.cost === 0 ? (
              '不可用'
            ) : summary.costUnknownCount > 0 ? (
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

export function ToolErrors({ errors }: { errors: SessionAnalysisSpanSummary['toolErrors'] }) {
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

export function ToolTimeline({ window }: { window: SessionAnalysis['toolWindow'] }) {
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

export function TagEditor({ id, initialTags }: { id: string; initialTags: string }) {
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
