'use client';

import type {
  AgentProfileReport,
  IterationHint,
  PromptCheckStatus,
  PromptIterationReport,
  PromptStructureCheck,
} from '@agent-profile/core';
import { type FormEvent, useEffect, useState } from 'react';
import { API } from '../config';
import { AGENT_LABELS, C, FS, R, SP } from '../theme';
import { Card, Chip, Notice } from '../ui';

const MAX_PROMPT_CHARACTERS = 20_000;

export default function PromptReviewPage() {
  const [prompt, setPrompt] = useState('');
  const [agent, setAgent] = useState('');
  const [includeEvidence, setIncludeEvidence] = useState(false);
  const [agents, setAgents] = useState<string[]>([]);
  const [report, setReport] = useState<PromptIterationReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`${API}/profiles/agents`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<AgentProfileReport>;
      })
      .then((profileReport) => setAgents(profileReport.profiles.map((profile) => profile.agent)))
      .catch(() => setAgents([]));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prompt.trim() || prompt.length > MAX_PROMPT_CHARACTERS) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API}/prompt-review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt,
          agent: agent || undefined,
          includeEvidence,
        }),
      });
      const payload = (await response.json()) as PromptIterationReport | { error?: string };
      if (!response.ok) {
        throw new Error(
          'error' in payload && payload.error ? payload.error : `HTTP ${response.status}`,
        );
      }
      setReport(payload as PromptIterationReport);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '审查请求失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 1180, margin: '0 auto', padding: SP.xl }}>
      <Intro />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.05fr) minmax(320px, .95fr)',
          gap: SP.xl,
          alignItems: 'start',
        }}
        className="prompt-review-grid"
      >
        <Card
          title="审查输入"
          meta={
            <span style={{ color: prompt.length > MAX_PROMPT_CHARACTERS ? C.high : C.mute }}>
              {prompt.length.toLocaleString()} / {MAX_PROMPT_CHARACTERS.toLocaleString()}
            </span>
          }
          style={{ border: `1px solid ${C.borderSoft}` }}
        >
          <form onSubmit={submit}>
            <label
              htmlFor="prompt-review-input"
              style={{ display: 'block', color: C.sub, fontSize: FS.sm, marginBottom: SP.sm }}
            >
              要检查的任务提示词
            </label>
            <textarea
              id="prompt-review-input"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={'目标：修复……\n范围：只修改……\n验收：……\n验证：运行……'}
              rows={18}
              spellCheck={false}
              style={{
                width: '100%',
                resize: 'vertical',
                minHeight: 280,
                padding: SP.md,
                border: `1px solid ${C.border}`,
                borderRadius: R.md,
                background: C.bg,
                color: C.text,
                font: '12px/1.7 var(--font-mono)',
              }}
            />

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(180px, 1fr) auto',
                gap: SP.md,
                alignItems: 'end',
                marginTop: SP.md,
              }}
              className="prompt-review-controls"
            >
              <label style={{ color: C.sub, fontSize: FS.sm }}>
                结合 Agent 运行画像（可选）
                <select
                  value={agent}
                  onChange={(event) => setAgent(event.target.value)}
                  style={{
                    display: 'block',
                    width: '100%',
                    marginTop: SP.xs,
                    padding: '8px 10px',
                    border: `1px solid ${C.border}`,
                    borderRadius: R.md,
                    background: C.card,
                    color: C.text,
                  }}
                >
                  <option value="">仅检查提示词结构</option>
                  {agents.map((agentName) => (
                    <option key={agentName} value={agentName}>
                      {AGENT_LABELS[agentName] ?? agentName}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                disabled={loading || !prompt.trim() || prompt.length > MAX_PROMPT_CHARACTERS}
                className="ap-btn"
                style={{
                  minHeight: 36,
                  padding: '8px 18px',
                  border: 0,
                  borderRadius: R.md,
                  background: C.link,
                  color: '#fff',
                  fontWeight: 600,
                  cursor: loading ? 'wait' : 'pointer',
                  opacity:
                    loading || !prompt.trim() || prompt.length > MAX_PROMPT_CHARACTERS ? 0.55 : 1,
                }}
              >
                {loading ? '正在审查…' : '生成迭代建议'}
              </button>
            </div>

            <label
              style={{
                display: 'flex',
                gap: SP.sm,
                alignItems: 'flex-start',
                marginTop: SP.md,
                color: C.sub,
                fontSize: FS.cap,
                lineHeight: 1.6,
              }}
            >
              <input
                type="checkbox"
                checked={includeEvidence}
                onChange={(event) => setIncludeEvidence(event.target.checked)}
                style={{ marginTop: 2 }}
              />
              在结果中包含经过密钥遮蔽、长度受限的原文片段。默认关闭；只在需要核对命中依据时开启。
            </label>
          </form>
          {error && (
            <div style={{ marginTop: SP.md }}>
              <Notice kind="err">审查失败：{error}。确认本地 API 服务正在运行。</Notice>
            </div>
          )}
        </Card>

        <PrivacyCard />
      </div>

      {report && <ReviewResult report={report} />}
    </main>
  );
}

function Intro() {
  return (
    <section style={{ marginBottom: SP.xl }}>
      <div
        className="tnum"
        style={{ color: C.mute, fontSize: FS.cap, letterSpacing: 0.8, marginBottom: SP.sm }}
      >
        runtime / prompt / iteration bench
      </div>
      <h1
        style={{
          margin: 0,
          color: C.text,
          fontSize: 26,
          lineHeight: 1.2,
          letterSpacing: -0.6,
        }}
      >
        把提示词改动变成可验证的假设
      </h1>
      <p
        style={{
          maxWidth: 780,
          color: C.sub,
          fontSize: FS.base,
          lineHeight: 1.75,
          margin: `${SP.sm}px 0 0`,
        }}
      >
        先检查目标、范围、验收、约束、上下文和验证结构；再选择性结合 Agent
        的运行画像形成建议。这里提供的是启发式线索，不是提示词评分，也不证明因果关系。
      </p>
    </section>
  );
}

function PrivacyCard() {
  return (
    <Card
      title="处理边界"
      meta="local · ephemeral"
      style={{
        border: `1px solid ${C.borderSoft}`,
        background: `linear-gradient(150deg, ${C.card}, ${C.link}08)`,
      }}
    >
      <div style={{ display: 'grid', gap: SP.md }}>
        <Boundary
          marker="01"
          title="不写入数据库"
          body="提示词只用于当前请求的内存计算，不进入 Session、Span 或新的持久化表。"
        />
        <Boundary
          marker="02"
          title="不调用语义模型"
          body="六项检查使用确定性的结构和关键词规则，不向外部 LLM 服务发送内容。"
        />
        <Boundary
          marker="03"
          title="证据默认关闭"
          body="返回结果默认不含原文；开启后也只返回最多两段、每段不超过 140 字符的遮蔽片段。"
        />
        <Boundary
          marker="04"
          title="Outcome 才是验收"
          body="一次只调整一个变量，用同类任务的测试、构建或人工验收结果判断是否保留。"
        />
      </div>
    </Card>
  );
}

function Boundary({ marker, title, body }: { marker: string; title: string; body: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '30px minmax(0, 1fr)', gap: SP.sm }}>
      <span className="tnum" style={{ color: C.link, fontSize: FS.cap, paddingTop: 1 }}>
        {marker}
      </span>
      <div>
        <div style={{ color: C.text, fontWeight: 600, fontSize: FS.sm }}>{title}</div>
        <div style={{ color: C.sub, fontSize: FS.cap, lineHeight: 1.65, marginTop: 2 }}>{body}</div>
      </div>
    </div>
  );
}

function ReviewResult({ report }: { report: PromptIterationReport }) {
  return (
    <section className="fade-in">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          gap: SP.md,
          flexWrap: 'wrap',
          marginBottom: SP.md,
        }}
      >
        <div>
          <h2 style={{ margin: 0, color: C.text, fontSize: 18 }}>结构证据与迭代建议</h2>
          <div style={{ color: C.mute, fontSize: FS.cap, marginTop: 3 }}>
            没有总分；逐项判断哪些信息需要显式化。
          </div>
        </div>
        <div style={{ display: 'flex', gap: SP.sm, flexWrap: 'wrap' }}>
          <Chip color={C.cr}>{report.review.summary.present} 项明确</Chip>
          <Chip color={C.medium}>{report.review.summary.partial} 项部分</Chip>
          <Chip color={C.high}>{report.review.summary.missing} 项缺失</Chip>
          {report.agentProfile && (
            <Chip color={C.link}>
              {AGENT_LABELS[report.agentProfile.agent] ?? report.agentProfile.agent} ·{' '}
              {report.agentProfile.sessions} sessions
            </Chip>
          )}
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
          gap: SP.md,
          marginBottom: SP.xl,
        }}
      >
        {report.review.checks.map((check) => (
          <CheckCard key={check.id} check={check} />
        ))}
      </div>

      <Card title="建议队列" meta={`${report.hints.length} hypotheses`}>
        <div style={{ display: 'grid', gap: SP.md }}>
          {report.hints.map((hint, index) => (
            <HintRow key={hint.id} hint={hint} index={index} />
          ))}
        </div>
        <div
          style={{
            marginTop: SP.lg,
            paddingTop: SP.md,
            borderTop: `1px solid ${C.borderSoft}`,
            color: C.sub,
            fontSize: FS.sm,
            lineHeight: 1.65,
          }}
        >
          <strong style={{ color: C.text }}>下一步：</strong> {report.nextStep}
        </div>
      </Card>
    </section>
  );
}

function CheckCard({ check }: { check: PromptStructureCheck }) {
  const color = statusColor(check.status);
  return (
    <article
      style={{
        background: C.card,
        border: `1px solid ${C.borderSoft}`,
        borderTop: `3px solid ${color}`,
        borderRadius: R.lg,
        padding: SP.lg,
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: SP.sm }}>
        <div style={{ color: C.text, fontWeight: 650 }}>{check.label}</div>
        <Chip color={color}>{statusLabel(check.status)}</Chip>
      </div>
      <p style={{ color: C.sub, fontSize: FS.cap, lineHeight: 1.6, margin: `${SP.sm}px 0 0` }}>
        {check.explanation}
      </p>
      {check.evidence.length > 0 && (
        <div
          className="tnum"
          style={{
            marginTop: SP.sm,
            padding: SP.sm,
            borderRadius: R.sm,
            background: C.bg,
            color: C.sub,
            fontSize: 10,
            lineHeight: 1.55,
            overflowWrap: 'anywhere',
          }}
        >
          {check.evidence.map((evidence) => (
            <div key={evidence}>“{evidence}”</div>
          ))}
        </div>
      )}
    </article>
  );
}

function HintRow({ hint, index }: { hint: IterationHint; index: number }) {
  const color = hint.priority === 'high' ? C.high : hint.priority === 'medium' ? C.medium : C.link;
  return (
    <article
      style={{
        display: 'grid',
        gridTemplateColumns: '34px minmax(0, 1fr)',
        gap: SP.md,
        padding: SP.md,
        border: `1px solid ${C.borderSoft}`,
        borderRadius: R.md,
      }}
    >
      <div
        className="tnum"
        style={{
          width: 30,
          height: 30,
          borderRadius: R.pill,
          background: `${color}18`,
          color,
          display: 'grid',
          placeItems: 'center',
          fontSize: FS.cap,
          fontWeight: 700,
        }}
      >
        {String(index + 1).padStart(2, '0')}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', gap: SP.sm, flexWrap: 'wrap', alignItems: 'center' }}>
          <strong style={{ color: C.text }}>{hint.title}</strong>
          <Chip color={color}>{priorityLabel(hint.priority)}</Chip>
          <Chip color={sourceColor(hint.source)}>{sourceLabel(hint.source)}</Chip>
        </div>
        <div style={{ color: C.sub, fontSize: FS.sm, lineHeight: 1.65, marginTop: SP.sm }}>
          {hint.reason}
        </div>
        <div
          style={{
            color: C.text,
            fontSize: FS.sm,
            lineHeight: 1.65,
            marginTop: SP.sm,
            padding: `${SP.sm}px ${SP.md}px`,
            borderLeft: `2px solid ${color}`,
            background: `${color}08`,
          }}
        >
          {hint.action}
        </div>
        <div
          className="tnum"
          style={{
            color: C.mute,
            fontSize: 10,
            lineHeight: 1.55,
            marginTop: SP.sm,
            overflowWrap: 'anywhere',
          }}
        >
          {hint.evidence.join(' · ')}
        </div>
        <div style={{ color: C.mute, fontSize: FS.cap, lineHeight: 1.55, marginTop: SP.xs }}>
          护栏：{hint.guardrail}
        </div>
      </div>
    </article>
  );
}

function statusColor(status: PromptCheckStatus) {
  if (status === 'present') return C.cr;
  if (status === 'partial') return C.medium;
  return C.high;
}

function statusLabel(status: PromptCheckStatus) {
  if (status === 'present') return '明确';
  if (status === 'partial') return '部分';
  return '缺失';
}

function priorityLabel(priority: IterationHint['priority']) {
  if (priority === 'high') return '高优先级';
  if (priority === 'medium') return '中优先级';
  return '低优先级';
}

function sourceColor(source: IterationHint['source']) {
  if (source === 'combined') return C.cc;
  if (source === 'runtime_profile') return C.out;
  return C.link;
}

function sourceLabel(source: IterationHint['source']) {
  if (source === 'combined') return '结构 + 运行';
  if (source === 'runtime_profile') return '运行画像';
  return '提示词结构';
}
