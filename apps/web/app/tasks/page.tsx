'use client';

import type {
  SessionSummary,
  TaskProfileReport,
  TaskStatus,
  VerificationStatus,
} from '@agent-profile/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { API } from '../config';
import { sessionDisplayTitle } from '../session-navigation';
import {
  emptyOutcomeDraft,
  OUTCOME_VERIFICATION_STATUSES,
  type OutcomeDraft,
  outcomeDraftFromRecord,
  outcomePayload,
} from '../task-outcome';
import { C, FS, fmtTokens, R, SP } from '../theme';
import { Card, Chip, Empty, Notice, SoftButton, StatCard } from '../ui';

interface TaskRecord {
  id: string;
  projectId?: string;
  title: string;
  type: string;
  status: TaskStatus;
  contentMode: 'structured' | 'local_text';
  goal: string | null;
  acceptanceCriteria: string[] | null;
}

interface Configuration {
  id: string;
  agent: string;
  model?: string;
  sourceHash: string;
}

interface TaskDetail {
  task: TaskRecord;
  sessions: Array<{
    sessionId: string;
    configSnapshotId: string | null;
    role: string;
    available: boolean;
    agent: string | null;
    name: string | null;
  }>;
  outcome: {
    buildStatus: VerificationStatus | null;
    testStatus: VerificationStatus | null;
    lintStatus: VerificationStatus | null;
    gitCommit: string | null;
    humanRating: number | null;
    reworkReason: string | null;
    completedAt: number | null;
    evidence: Array<{
      kind: string;
      status?: VerificationStatus;
      reference?: string;
    }>;
  } | null;
}

const fieldStyle: React.CSSProperties = {
  width: '100%',
  minWidth: 0,
  height: 36,
  padding: '0 10px',
  border: `1px solid ${C.border}`,
  borderRadius: R.md,
  background: C.bg,
  color: C.text,
  font: 'inherit',
};

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [configurations, setConfigurations] = useState<Configuration[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [profile, setProfile] = useState<TaskProfileReport | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [title, setTitle] = useState('');
  const [type, setType] = useState('feature');
  const [projectId, setProjectId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [configId, setConfigId] = useState('');
  const [role, setRole] = useState('primary');
  const [agent, setAgent] = useState('codex');
  const [model, setModel] = useState('');
  const [sourceHash, setSourceHash] = useState('');
  const [outcome, setOutcome] = useState<OutcomeDraft>(emptyOutcomeDraft);

  const loadBase = useCallback(async () => {
    const [taskResponse, sessionResponse, configResponse] = await Promise.all([
      fetch(`${API}/tasks`),
      fetch(`${API}/sessions`),
      fetch(`${API}/config-snapshots`),
    ]);
    const taskJson = await taskResponse.json();
    const sessionJson = await sessionResponse.json();
    const configJson = await configResponse.json();
    setTasks(taskJson.tasks ?? []);
    setSessions(Array.isArray(sessionJson) ? sessionJson : []);
    setConfigurations(configJson.configurations ?? []);
    setSelectedId((current) => current ?? taskJson.tasks?.[0]?.id ?? null);
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const [detailResponse, profileResponse] = await Promise.all([
      fetch(`${API}/tasks/${id}`),
      fetch(`${API}/tasks/${id}/profile`),
    ]);
    if (!detailResponse.ok || !profileResponse.ok) throw new Error('load_failed');
    const nextDetail = (await detailResponse.json()) as TaskDetail;
    setDetail(nextDetail);
    setProfile((await profileResponse.json()) as TaskProfileReport);
    setOutcome(outcomeDraftFromRecord(nextDetail.outcome));
  }, []);

  useEffect(() => {
    loadBase().catch(() => setNotice({ kind: 'err', text: '任务数据加载失败' }));
  }, [loadBase]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setProfile(null);
      return;
    }
    loadDetail(selectedId).catch(() => setNotice({ kind: 'err', text: '任务详情加载失败' }));
  }, [loadDetail, selectedId]);

  const linkedIds = useMemo(
    () => new Set(detail?.sessions.map((item) => item.sessionId) ?? []),
    [detail],
  );
  const availableSessions = sessions.filter((item) => !linkedIds.has(item.id));

  async function createTask() {
    const response = await send('/tasks', 'POST', {
      title,
      type,
      projectId: projectId || undefined,
    });
    if (!response) return;
    setTitle('');
    await loadBase();
    setSelectedId(response.id);
    setNotice({ kind: 'ok', text: '任务已创建' });
  }

  async function createConfiguration() {
    const response = await send('/config-snapshots', 'POST', {
      agent,
      model: model || undefined,
      sourceHash,
    });
    if (!response) return;
    setSourceHash('');
    await loadBase();
    setConfigId(response.id);
    setNotice({ kind: 'ok', text: '配置快照已创建' });
  }

  async function attachSession() {
    if (!selectedId) return;
    const response = await send(`/tasks/${selectedId}/sessions`, 'POST', {
      sessionId,
      configSnapshotId: configId || undefined,
      role,
    });
    if (!response) return;
    setSessionId('');
    await loadDetail(selectedId);
    setNotice({ kind: 'ok', text: 'Session 已关联' });
  }

  async function saveOutcome() {
    if (!selectedId) return;
    let payload: ReturnType<typeof outcomePayload>;
    try {
      payload = outcomePayload(outcome);
    } catch (reason: unknown) {
      setNotice({
        kind: 'err',
        text: `Outcome 无法保存：${reason instanceof Error ? reason.message : '字段无效'}`,
      });
      return;
    }
    const response = await send(`/tasks/${selectedId}/outcome`, 'PUT', payload);
    if (!response) return;
    await loadDetail(selectedId);
    setNotice({ kind: 'ok', text: 'Outcome 已保存' });
  }

  async function updateStatus(status: TaskStatus) {
    if (!selectedId) return;
    const response = await send(`/tasks/${selectedId}`, 'PATCH', { status });
    if (!response) return;
    await loadBase();
    await loadDetail(selectedId);
  }

  async function send(path: string, method: string, body: unknown) {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await response.json();
    if (!response.ok) {
      setNotice({ kind: 'err', text: `操作失败：${json.error ?? response.status}` });
      return null;
    }
    return json;
  }

  return (
    <main style={{ maxWidth: 1320, margin: '0 auto', padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 20, color: C.text }}>任务验证</h1>
        <span className="tnum" style={{ color: C.mute, fontSize: FS.cap }}>
          {tasks.length} Tasks
        </span>
      </div>
      {notice && (
        <div style={{ marginBottom: SP.lg }}>
          <Notice kind={notice.kind} onClose={() => setNotice(null)}>
            {notice.text}
          </Notice>
        </div>
      )}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '320px minmax(0, 1fr)',
          gap: 20,
          alignItems: 'start',
        }}
      >
        <div>
          <Card title="新建任务">
            <div style={{ display: 'grid', gap: 8 }}>
              <input
                style={fieldStyle}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="任务标题"
              />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <input
                  style={fieldStyle}
                  value={type}
                  onChange={(event) => setType(event.target.value)}
                  placeholder="任务类型"
                />
                <input
                  style={fieldStyle}
                  value={projectId}
                  onChange={(event) => setProjectId(event.target.value)}
                  placeholder="项目"
                />
              </div>
              <SoftButton
                variant="primary"
                disabled={!title.trim() || !type.trim()}
                onClick={createTask}
              >
                创建
              </SoftButton>
            </div>
          </Card>
          <div style={{ display: 'grid', gap: 6 }}>
            {tasks.map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => setSelectedId(task.id)}
                style={{
                  padding: '10px 12px',
                  border: `1px solid ${selectedId === task.id ? C.link : C.borderSoft}`,
                  borderRadius: R.md,
                  background: selectedId === task.id ? `${C.link}12` : C.card,
                  color: C.text,
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <div className="clamp1" style={{ fontWeight: 600 }}>
                  {task.title}
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginTop: 4,
                    color: C.mute,
                    fontSize: FS.cap,
                  }}
                >
                  <span>{task.type}</span>
                  <span>{task.status}</span>
                </div>
              </button>
            ))}
            {tasks.length === 0 && <Empty text="暂无任务" />}
          </div>
        </div>

        {!detail || !profile ? (
          <Empty text="选择一个任务" />
        ) : (
          <div style={{ minWidth: 0 }}>
            <Card title={detail.task.title} meta={detail.task.projectId ?? detail.task.type}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(
                  ['planned', 'in_progress', 'completed', 'failed', 'cancelled'] as TaskStatus[]
                ).map((status) => (
                  <SoftButton
                    key={status}
                    variant={detail.task.status === status ? 'primary' : 'default'}
                    onClick={() => updateStatus(status)}
                  >
                    {status}
                  </SoftButton>
                ))}
              </div>
            </Card>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                gap: 10,
                marginBottom: 20,
              }}
            >
              <StatCard
                value={`${profile.profile.availableSessions}/${profile.profile.linkedSessions}`}
                label="Session 覆盖"
              />
              <StatCard value={fmtTokens(profile.profile.totalTokens)} label="总 Token" />
              <StatCard
                value={`¥${profile.profile.totalCost.toFixed(3)}`}
                label="已知成本"
                warn={profile.profile.costCoverage < 1}
              />
              <StatCard
                value={profile.coverage.outcome.status}
                label="Outcome 覆盖"
                warn={profile.coverage.outcome.status !== 'verified'}
              />
            </div>

            <Card title="Session 与配置" meta={`${detail.sessions.length} linked`}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr) 130px auto',
                  gap: 8,
                }}
              >
                <select
                  style={fieldStyle}
                  value={sessionId}
                  onChange={(event) => setSessionId(event.target.value)}
                >
                  <option value="">选择 Session</option>
                  {availableSessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {sessionDisplayTitle(session)}
                    </option>
                  ))}
                </select>
                <select
                  style={fieldStyle}
                  value={configId}
                  onChange={(event) => setConfigId(event.target.value)}
                >
                  <option value="">无配置快照</option>
                  {configurations.map((config) => (
                    <option key={config.id} value={config.id}>
                      {config.agent} · {config.model ?? config.sourceHash}
                    </option>
                  ))}
                </select>
                <select
                  style={fieldStyle}
                  value={role}
                  onChange={(event) => setRole(event.target.value)}
                >
                  {['primary', 'continuation', 'subagent', 'verification'].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
                <SoftButton variant="primary" disabled={!sessionId} onClick={attachSession}>
                  关联
                </SoftButton>
              </div>
              <div style={{ display: 'grid', gap: 6, marginTop: 12 }}>
                {detail.sessions.map((item) => (
                  <div
                    key={item.sessionId}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0, 1fr) auto auto',
                      gap: 8,
                      padding: '7px 0',
                      borderBottom: `1px solid ${C.borderSoft}`,
                    }}
                  >
                    <span className="clamp1">{item.name || item.sessionId}</span>
                    <Chip color={item.available ? C.cr : C.medium}>
                      {item.available ? item.agent || 'available' : 'unavailable'}
                    </Chip>
                    <span style={{ color: C.mute, fontSize: FS.cap }}>{item.role}</span>
                  </div>
                ))}
              </div>
            </Card>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
                gap: 16,
              }}
            >
              <Card title="配置快照">
                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <input
                      style={fieldStyle}
                      value={agent}
                      onChange={(event) => setAgent(event.target.value)}
                      placeholder="Agent"
                    />
                    <input
                      style={fieldStyle}
                      value={model}
                      onChange={(event) => setModel(event.target.value)}
                      placeholder="Model"
                    />
                  </div>
                  <input
                    style={fieldStyle}
                    value={sourceHash}
                    onChange={(event) => setSourceHash(event.target.value)}
                    placeholder="Source hash"
                  />
                  <SoftButton
                    disabled={!agent.trim() || !sourceHash.trim()}
                    onClick={createConfiguration}
                  >
                    保存快照
                  </SoftButton>
                </div>
              </Card>
              <Card title="Outcome">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  {(['buildStatus', 'testStatus', 'lintStatus'] as const).map((field) => (
                    <div
                      key={field}
                      style={{ display: 'grid', gap: 4, color: C.sub, fontSize: FS.cap }}
                    >
                      <span>{field.replace('Status', '')}</span>
                      <VerificationSelect
                        value={outcome[field]}
                        onChange={(value) =>
                          setOutcome((current) => ({ ...current, [field]: value }))
                        }
                      />
                    </div>
                  ))}
                </div>
                <input
                  style={{ ...fieldStyle, marginTop: 8 }}
                  value={outcome.gitCommit}
                  onChange={(event) =>
                    setOutcome((current) => ({ ...current, gitCommit: event.target.value }))
                  }
                  placeholder="Git commit"
                />
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '130px minmax(0, 1fr)',
                    gap: 8,
                    marginTop: 8,
                  }}
                >
                  <label style={{ display: 'grid', gap: 4, color: C.sub, fontSize: FS.cap }}>
                    人工评分
                    <select
                      style={fieldStyle}
                      value={outcome.humanRating}
                      onChange={(event) =>
                        setOutcome((current) => ({ ...current, humanRating: event.target.value }))
                      }
                    >
                      <option value="">未采集</option>
                      {[1, 2, 3, 4, 5].map((value) => (
                        <option key={value} value={value}>
                          {value} / 5
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: 'grid', gap: 4, color: C.sub, fontSize: FS.cap }}>
                    完成时间
                    <input
                      type="datetime-local"
                      style={fieldStyle}
                      value={outcome.completedAt}
                      onChange={(event) =>
                        setOutcome((current) => ({ ...current, completedAt: event.target.value }))
                      }
                    />
                  </label>
                </div>
                <label
                  style={{ display: 'grid', gap: 4, marginTop: 8, color: C.sub, fontSize: FS.cap }}
                >
                  返工原因（可选，仅存本机）
                  <textarea
                    style={{ ...fieldStyle, height: 72, padding: 10, resize: 'vertical' }}
                    value={outcome.reworkReason}
                    onChange={(event) =>
                      setOutcome((current) => ({ ...current, reworkReason: event.target.value }))
                    }
                  />
                </label>
                <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                    }}
                  >
                    <span style={{ color: C.sub, fontSize: FS.cap }}>
                      结构化验证证据（请勿输入 Prompt 或规则正文）
                    </span>
                    <SoftButton
                      onClick={() =>
                        setOutcome((current) => ({
                          ...current,
                          evidence: [
                            ...current.evidence,
                            { id: crypto.randomUUID(), kind: '', status: '', reference: '' },
                          ],
                        }))
                      }
                    >
                      添加证据
                    </SoftButton>
                  </div>
                  {outcome.evidence.map((item, index) => (
                    <div
                      key={item.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0, 1fr) 130px minmax(0, 1fr) auto',
                        gap: 8,
                      }}
                    >
                      <input
                        style={fieldStyle}
                        value={item.kind}
                        onChange={(event) =>
                          updateEvidence(setOutcome, index, { kind: event.target.value })
                        }
                        placeholder="类型，例如 test"
                      />
                      <VerificationSelect
                        value={item.status}
                        onChange={(status) => updateEvidence(setOutcome, index, { status })}
                      />
                      <input
                        style={fieldStyle}
                        value={item.reference}
                        onChange={(event) =>
                          updateEvidence(setOutcome, index, { reference: event.target.value })
                        }
                        placeholder="本地命令或引用"
                      />
                      <SoftButton
                        onClick={() =>
                          setOutcome((current) => ({
                            ...current,
                            evidence: current.evidence.filter(
                              (_, itemIndex) => itemIndex !== index,
                            ),
                          }))
                        }
                      >
                        删除
                      </SoftButton>
                    </div>
                  ))}
                </div>
                <SoftButton
                  variant="primary"
                  onClick={saveOutcome}
                  style={{ marginTop: 8, width: '100%' }}
                >
                  保存 Outcome
                </SoftButton>
              </Card>
            </div>
            <Card title="Task Profile" meta={profile.schemaVersion}>
              <div style={{ color: C.sub, fontSize: FS.sm }}>
                {profile.comparison.interpretation}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                {profile.limitations.map((item) => (
                  <Chip key={item} color={C.medium}>
                    {item}
                  </Chip>
                ))}
              </div>
            </Card>
          </div>
        )}
      </div>
    </main>
  );
}

function VerificationSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <select style={fieldStyle} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">未采集</option>
      {OUTCOME_VERIFICATION_STATUSES.map((status) => (
        <option key={status} value={status}>
          {status}
        </option>
      ))}
    </select>
  );
}

function updateEvidence(
  setOutcome: React.Dispatch<React.SetStateAction<OutcomeDraft>>,
  index: number,
  change: Partial<OutcomeDraft['evidence'][number]>,
): void {
  setOutcome((current) => ({
    ...current,
    evidence: current.evidence.map((item, itemIndex) =>
      itemIndex === index ? { ...item, ...change } : item,
    ),
  }));
}
