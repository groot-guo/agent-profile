'use client';

import type {
  CohortRecord,
  ConfigurationRecord,
  ExperimentRecord,
  SessionDiscoveryItem,
  TaskRecord,
  TaskSessionLinkRecord,
} from '@agent-profile/contracts';
import type {
  PostRunFeedbackReport,
  TaskAssistanceReport,
  TaskGitCommitCandidate,
  TaskProfileOutcome,
  TaskProfileReport,
  TaskStatus,
} from '@agent-profile/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { API } from '../config';
import { allowedExperimentDecisions } from '../experiment-guardrail';
import { sessionDisplayTitle, sessionProject } from '../session-navigation';
import { C, FS, fmtTokens, R, SP } from '../theme';
import { Card, Chip, Empty, Notice, SoftButton, StatCard } from '../ui';
import { OutcomeEditor } from './outcome-editor';
import { outcomeToDraft } from './outcome-model';
import { SessionPicker } from './session-picker';
import styles from './tasks.module.css';

interface TaskDetail {
  task: TaskRecord;
  sessions: TaskSessionLinkRecord[];
  outcome: TaskProfileOutcome | null;
}

interface TaskFeedbackResponse {
  feedback: PostRunFeedbackReport[];
}

const EMPTY_IDS: ReadonlySet<string> = new Set();

function cohortDefinitionFields(definition: Record<string, unknown>): {
  projectId?: string;
  type?: string;
  complexity?: string;
} {
  const projectId = typeof definition.projectId === 'string' ? definition.projectId : undefined;
  const type = typeof definition.type === 'string' ? definition.type : undefined;
  const complexity = typeof definition.complexity === 'string' ? definition.complexity : undefined;
  return { projectId, type, complexity };
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
  const [configurations, setConfigurations] = useState<ConfigurationRecord[]>([]);
  const [cohorts, setCohorts] = useState<CohortRecord[]>([]);
  const [experiments, setExperiments] = useState<ExperimentRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [profile, setProfile] = useState<TaskProfileReport | null>(null);
  const [assistance, setAssistance] = useState<TaskAssistanceReport | null>(null);
  const [assistanceLoading, setAssistanceLoading] = useState(false);
  const [assistanceError, setAssistanceError] = useState(false);
  const [dismissedAssistance, setDismissedAssistance] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<PostRunFeedbackReport[]>([]);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [title, setTitle] = useState('');
  const [type, setType] = useState('feature');
  const [projectId, setProjectId] = useState('');
  const [sourceSession, setSourceSession] = useState<SessionDiscoveryItem | null>(null);
  const [attachSession, setAttachSession] = useState<SessionDiscoveryItem | null>(null);
  const [configId, setConfigId] = useState('');
  const [role, setRole] = useState('primary');
  const [agent, setAgent] = useState('codex');
  const [model, setModel] = useState('');
  const [sourceHash, setSourceHash] = useState('');
  const [outcome, setOutcome] = useState(() => outcomeToDraft(null));
  const [outcomeSaving, setOutcomeSaving] = useState(false);
  const [cohortTitle, setCohortTitle] = useState('');
  const [cohortProject, setCohortProject] = useState('');
  const [cohortType, setCohortType] = useState('');
  const [cohortComplexity, setCohortComplexity] = useState('');
  const [cohortStatus, setCohortStatus] = useState<CohortRecord['status']>('active');
  const [editingCohortId, setEditingCohortId] = useState<string | null>(null);
  const [experimentTitle, setExperimentTitle] = useState('');
  const [experimentCohortId, setExperimentCohortId] = useState('');
  const [controlConfigId, setControlConfigId] = useState('');
  const [candidateConfigId, setCandidateConfigId] = useState('');
  const [primaryMetric, setPrimaryMetric] = useState('');
  const [guardrails, setGuardrails] = useState('');
  const [editingExperimentId, setEditingExperimentId] = useState<string | null>(null);

  const loadBase = useCallback(async () => {
    const [taskResponse, configResponse, cohortResponse, experimentResponse] = await Promise.all([
      fetch(`${API}/tasks`),
      fetch(`${API}/config-snapshots`),
      fetch(`${API}/cohorts`),
      fetch(`${API}/experiments`),
    ]);
    const taskJson = await taskResponse.json();
    const configJson = await configResponse.json();
    const cohortJson = await cohortResponse.json();
    const experimentJson = await experimentResponse.json();
    setTasks(taskJson.tasks ?? []);
    setConfigurations(configJson.configurations ?? []);
    setCohorts(cohortJson.cohorts ?? []);
    setExperiments(experimentJson.experiments ?? []);
    setSelectedId((current) => current ?? taskJson.tasks?.[0]?.id ?? null);
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const [detailResponse, profileResponse, feedbackResponse] = await Promise.all([
      fetch(`${API}/tasks/${id}`),
      fetch(`${API}/tasks/${id}/profile`),
      fetch(`${API}/tasks/${id}/feedback?optIn=true`),
    ]);
    if (!detailResponse.ok || !profileResponse.ok || !feedbackResponse.ok) {
      throw new Error('load_failed');
    }
    const nextDetail = (await detailResponse.json()) as TaskDetail;
    setDetail(nextDetail);
    setProfile((await profileResponse.json()) as TaskProfileReport);
    const nextFeedback = (await feedbackResponse.json()) as TaskFeedbackResponse;
    setFeedback(nextFeedback.feedback ?? []);
    setOutcome(outcomeToDraft(nextDetail.outcome));
  }, []);

  const loadAssistance = useCallback(async (id: string) => {
    setAssistanceLoading(true);
    setAssistanceError(false);
    try {
      const response = await fetch(`${API}/tasks/${id}/assistance`);
      if (!response.ok) throw new Error('assistance_failed');
      setAssistance((await response.json()) as TaskAssistanceReport);
    } catch {
      setAssistance(null);
      setAssistanceError(true);
    } finally {
      setAssistanceLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBase().catch(() => setNotice({ kind: 'err', text: '任务数据加载失败' }));
  }, [loadBase]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setProfile(null);
      setFeedback([]);
      setAssistance(null);
      return;
    }
    setDismissedAssistance(new Set());
    loadDetail(selectedId).catch(() => setNotice({ kind: 'err', text: '任务详情加载失败' }));
    void loadAssistance(selectedId);
  }, [loadAssistance, loadDetail, selectedId]);

  const linkedIds = useMemo(
    () => new Set(detail?.sessions.map((item) => item.sessionId) ?? []),
    [detail],
  );
  const suggestedSessions =
    assistance?.candidates.sessions.filter((item) => !dismissedAssistance.has(item.suggestionId)) ??
    [];
  const suggestedGitCommits =
    assistance?.candidates.gitCommits.filter(
      (item) => !dismissedAssistance.has(item.suggestionId),
    ) ?? [];

  async function createTask() {
    const response = await send('/tasks', 'POST', {
      title,
      type,
      projectId: projectId || undefined,
    });
    if (!response) return;
    setTitle('');
    setSourceSession(null);
    await loadBase();
    setSelectedId(response.id);
    setNotice({ kind: 'ok', text: '任务已创建' });
  }

  function prefillTaskFromSession() {
    if (!sourceSession) return;
    setProjectId(sessionProject(sourceSession));
    if (!title.trim()) setTitle(`复盘 ${sessionDisplayTitle(sourceSession)}`);
    setNotice({ kind: 'ok', text: '已从本地 Session 预填项目和标题；不会自动关联 Session' });
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

  async function attachSelectedSession() {
    if (!selectedId) return;
    if (!attachSession) return;
    const response = await send(`/tasks/${selectedId}/sessions`, 'POST', {
      sessionId: attachSession.id,
      configSnapshotId: configId || undefined,
      role,
    });
    if (!response) return;
    setAttachSession(null);
    await loadDetail(selectedId);
    await loadAssistance(selectedId);
    setNotice({ kind: 'ok', text: 'Session 已关联' });
  }

  async function acceptSessionCandidate(
    candidate: TaskAssistanceReport['candidates']['sessions'][number],
  ) {
    if (!selectedId) return;
    const response = await send(`/tasks/${selectedId}/sessions`, 'POST', {
      sessionId: candidate.sessionId,
      role: 'primary',
      startedAt: candidate.startedAt,
      finishedAt: candidate.finishedAt ?? undefined,
      provenance: candidate.provenance,
    });
    if (!response) return;
    setDismissedAssistance((current) => new Set(current).add(candidate.suggestionId));
    await loadDetail(selectedId);
    await loadAssistance(selectedId);
    setNotice({ kind: 'ok', text: '已确认关联候选 Session' });
  }

  function dismissAssistanceSuggestion(suggestionId: string) {
    setDismissedAssistance((current) => new Set(current).add(suggestionId));
  }

  function acceptGitCandidate(candidate: TaskGitCommitCandidate) {
    const evidence = candidate.evidence;
    setOutcome((current) => {
      if (current.evidence.some((item) => item.reference === evidence.reference)) return current;
      return {
        ...current,
        evidence: [
          ...current.evidence,
          {
            id: `suggested-${candidate.hash}`,
            kind: evidence.kind,
            status: evidence.status ?? '',
            reference: evidence.reference ?? '',
            provenance: candidate.provenance,
          },
        ],
      };
    });
    setDismissedAssistance((current) => new Set(current).add(candidate.suggestionId));
    setNotice({ kind: 'ok', text: 'Git 候选已加入 Outcome 草稿；请检查后显式保存' });
  }

  async function saveOutcome(payload: TaskProfileOutcome): Promise<boolean> {
    if (!selectedId) return false;
    setOutcomeSaving(true);
    try {
      const response = await send(`/tasks/${selectedId}/outcome`, 'PUT', payload);
      if (!response) return false;
      await loadDetail(selectedId);
      setNotice({ kind: 'ok', text: 'Outcome 已保存' });
      return true;
    } finally {
      setOutcomeSaving(false);
    }
  }

  async function saveCohort() {
    const isEditing = editingCohortId !== null;
    const definition = Object.fromEntries(
      Object.entries({
        projectId: cohortProject.trim() || undefined,
        type: cohortType.trim() || undefined,
        complexity: cohortComplexity || undefined,
      }).filter(([, value]) => value !== undefined),
    );
    const response = isEditing
      ? await send(`/cohorts/${editingCohortId}`, 'PATCH', {
          title: cohortTitle,
          definition,
          status: cohortStatus,
        })
      : await send('/cohorts', 'POST', { title: cohortTitle, definition, status: cohortStatus });
    if (!response) return;
    setCohortTitle('');
    setCohortProject('');
    setCohortType('');
    setCohortComplexity('');
    setCohortStatus('active');
    setEditingCohortId(null);
    await loadBase();
    setExperimentCohortId(response.id);
    setNotice({ kind: 'ok', text: isEditing ? 'Cohort 定义已更新' : 'Cohort 定义已创建' });
  }

  function startCohortEdit(cohort: CohortRecord) {
    setEditingCohortId(cohort.id);
    setCohortTitle(cohort.title);
    const { projectId, type, complexity } = cohortDefinitionFields(cohort.definition);
    setCohortProject(projectId ?? '');
    setCohortType(type ?? '');
    setCohortComplexity(complexity ?? '');
    setCohortStatus(cohort.status);
  }

  async function saveExperiment() {
    const isEditing = editingExperimentId !== null;
    const payload = {
      title: experimentTitle,
      primaryMetric,
      guardrails: guardrails
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean),
    };
    const response = isEditing
      ? await send(`/experiments/${editingExperimentId}`, 'PATCH', payload)
      : await send('/experiments', 'POST', {
          ...payload,
          cohortId: experimentCohortId,
          controlConfigId,
          candidateConfigId,
        });
    if (!response) return;
    setExperimentTitle('');
    setPrimaryMetric('');
    setGuardrails('');
    setEditingExperimentId(null);
    await loadBase();
    setNotice({
      kind: 'ok',
      text: isEditing ? 'Experiment 定义已更新' : 'Experiment 定义已创建',
    });
  }

  function startExperimentEdit(experiment: ExperimentRecord) {
    setEditingExperimentId(experiment.id);
    setExperimentTitle(experiment.title);
    setExperimentCohortId(experiment.cohortId);
    setControlConfigId(experiment.controlConfigId);
    setCandidateConfigId(experiment.candidateConfigId);
    setPrimaryMetric(experiment.primaryMetric);
    setGuardrails(
      experiment.guardrails.filter((item): item is string => typeof item === 'string').join('\n'),
    );
  }

  async function updateExperimentDecision(
    id: string,
    evidenceStatus: ExperimentRecord['evidenceStatus'],
    decision: ExperimentRecord['decision'],
  ) {
    const response = await send(`/experiments/${id}`, 'PATCH', { evidenceStatus, decision });
    if (!response) return;
    await loadBase();
    if (selectedId) await loadDetail(selectedId);
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
    <main className={styles.page}>
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
      <div className={styles.workspace}>
        <div>
          <Card title="新建任务">
            <div style={{ display: 'grid', gap: 8 }}>
              <input
                style={fieldStyle}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="任务标题"
              />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
                <SessionPicker
                  excludeIds={EMPTY_IDS}
                  value={sourceSession}
                  onChange={setSourceSession}
                  placeholder="从观测 Session 预填（可选）"
                />
                <SoftButton disabled={!sourceSession} onClick={prefillTaskFromSession}>
                  预填
                </SoftButton>
              </div>
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
            <div className={styles.summaryGrid}>
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
                label={`Outcome 覆盖 · ${profile.coverage.outcome.observedFields}/${profile.coverage.outcome.totalFields}`}
                warn={profile.coverage.outcome.status !== 'verified'}
              />
            </div>

            <Card title="Session 与配置" meta={`${detail.sessions.length} linked`}>
              <div className={styles.sessionAttachGrid}>
                <SessionPicker
                  excludeIds={linkedIds}
                  value={attachSession}
                  onChange={setAttachSession}
                  placeholder="搜索并选择 Session"
                />
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
                <SoftButton
                  variant="primary"
                  disabled={!attachSession}
                  onClick={attachSelectedSession}
                >
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

            <Card title="本地 Task 建议" meta="候选 · 逐项确认">
              <div style={{ color: C.sub, fontSize: FS.cap, lineHeight: 1.6 }}>
                建议只基于项目 key、时间窗口和本地 Git 元数据；不会自动关联 Session，也不会把 Git
                提交当作通过结果。确认 Git 项目后仍需在 Outcome 卡片中显式保存。
              </div>
              {assistanceLoading && (
                <div style={{ color: C.mute, marginTop: 10 }}>正在生成本地候选…</div>
              )}
              {assistanceError && (
                <Notice kind="err">本地候选暂时不可用；Task/Outcome 仍可手动维护。</Notice>
              )}
              {!assistanceLoading &&
                !assistanceError &&
                suggestedSessions.length === 0 &&
                suggestedGitCommits.length === 0 && (
                  <Empty
                    text="暂无候选"
                    hint="需要 Task 项目 key 与时间窗口内的本地 Session 或 Git 记录"
                  />
                )}
              {suggestedSessions.length > 0 && (
                <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                  <strong style={{ fontSize: FS.sm }}>可关联 Session</strong>
                  {suggestedSessions.map((candidate) => (
                    <div key={candidate.suggestionId} className="ap-row">
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <div>
                          <div className="tnum">{candidate.sessionId}</div>
                          <div style={{ color: C.sub, fontSize: FS.cap }}>
                            {candidate.agent} · {new Date(candidate.startedAt).toLocaleString()} ·{' '}
                            {candidate.projectId}
                          </div>
                          <div style={{ color: C.mute, fontSize: FS.cap }}>
                            来源 {candidate.provenance.source} · 生成于{' '}
                            {new Date(candidate.provenance.capturedAt).toLocaleString()}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                          <SoftButton
                            variant="primary"
                            onClick={() => acceptSessionCandidate(candidate)}
                          >
                            确认关联
                          </SoftButton>
                          <SoftButton
                            onClick={() => dismissAssistanceSuggestion(candidate.suggestionId)}
                          >
                            忽略
                          </SoftButton>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {suggestedGitCommits.length > 0 && (
                <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
                  <strong style={{ fontSize: FS.sm }}>本地 Git 提交候选</strong>
                  {suggestedGitCommits.map((candidate) => (
                    <div key={candidate.suggestionId} className="ap-row">
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ minWidth: 0 }}>
                          <div className="tnum clamp1" title={candidate.hash}>
                            {candidate.hash}
                          </div>
                          <div className="clamp1" title={candidate.message}>
                            {candidate.message}
                          </div>
                          <div style={{ color: C.mute, fontSize: FS.cap }}>
                            {candidate.author} · {candidate.date} · {candidate.provenance.basis}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                          <SoftButton
                            variant="primary"
                            onClick={() => acceptGitCandidate(candidate)}
                          >
                            加入 Outcome 草稿
                          </SoftButton>
                          <SoftButton
                            onClick={() => dismissAssistanceSuggestion(candidate.suggestionId)}
                          >
                            忽略
                          </SoftButton>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {assistance && (
                <div style={{ color: C.mute, fontSize: FS.cap, marginTop: 10 }}>
                  {assistance.limitations[0]}
                </div>
              )}
            </Card>

            <div className={styles.twoColumn}>
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
              <Card
                title="Outcome"
                meta={`${profile.coverage.outcome.status} · ${profile.coverage.outcome.observedFields}/${profile.coverage.outcome.totalFields}`}
              >
                <OutcomeEditor
                  draft={outcome}
                  coverage={profile.coverage.outcome}
                  saving={outcomeSaving}
                  onChange={setOutcome}
                  onSave={saveOutcome}
                />
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
            <Card title="已验证的任务后反馈" meta="显式读取 · 只读">
              {feedback.length === 0 ? (
                <Empty text="暂无关联的 cohort 反馈" hint="需要可比较的 Experiment 样本" />
              ) : (
                <div style={{ display: 'grid', gap: 10 }}>
                  {feedback.map((item) =>
                    item.status === 'available' ? (
                      item.findings.map((finding) => (
                        <div key={`${item.task.id}:${finding.id}`} className="ap-row">
                          <strong>{finding.title}</strong>
                          <p style={{ margin: '6px 0', color: C.sub, fontSize: FS.sm }}>
                            {finding.summary}
                          </p>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <Chip color={C.link}>{finding.action}</Chip>
                            <Chip color={C.medium}>
                              {finding.evidence.profileSchemaVersion} ·{' '}
                              {finding.evidence.primaryMetric}
                            </Chip>
                            <Chip color={C.medium}>Experiment {finding.evidence.experimentId}</Chip>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div key={`${item.task.id}:${item.suppression?.reason}`} className="ap-row">
                        <strong>反馈已抑制</strong>
                        <p style={{ margin: '6px 0', color: C.sub, fontSize: FS.sm }}>
                          {item.suppression?.detail}
                        </p>
                        <Chip color={C.medium}>{item.suppression?.reason}</Chip>
                      </div>
                    ),
                  )}
                </div>
              )}
            </Card>
            <Card title="Cohort 与 Experiment 定义" meta="仅定义范围，不计算赢家">
              <div style={{ display: 'grid', gap: 10 }}>
                <div style={{ display: 'grid', gap: 8 }}>
                  <strong>Cohort 范围</strong>
                  <input
                    style={fieldStyle}
                    value={cohortTitle}
                    onChange={(event) => setCohortTitle(event.target.value)}
                    placeholder="Cohort 标题"
                  />
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                      gap: 8,
                    }}
                  >
                    <input
                      style={fieldStyle}
                      value={cohortProject}
                      onChange={(event) => setCohortProject(event.target.value)}
                      placeholder="项目范围（可选）"
                    />
                    <input
                      style={fieldStyle}
                      value={cohortType}
                      onChange={(event) => setCohortType(event.target.value)}
                      placeholder="Task 类型（可选）"
                    />
                    <select
                      style={fieldStyle}
                      value={cohortComplexity}
                      onChange={(event) => setCohortComplexity(event.target.value)}
                    >
                      <option value="">复杂度不限</option>
                      {['small', 'medium', 'large'].map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </div>
                  <select
                    style={fieldStyle}
                    value={cohortStatus}
                    onChange={(event) =>
                      setCohortStatus(event.target.value as CohortRecord['status'])
                    }
                  >
                    <option value="active">active</option>
                    <option value="archived">archived</option>
                  </select>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <SoftButton disabled={!cohortTitle.trim()} onClick={saveCohort}>
                      {editingCohortId ? '保存 Cohort' : '创建 Cohort'}
                    </SoftButton>
                    {editingCohortId && (
                      <SoftButton
                        onClick={() => {
                          setEditingCohortId(null);
                          setCohortTitle('');
                          setCohortProject('');
                          setCohortType('');
                          setCohortComplexity('');
                          setCohortStatus('active');
                        }}
                      >
                        取消编辑
                      </SoftButton>
                    )}
                  </div>
                </div>
                {cohorts.length === 0 ? (
                  <Empty text="尚无 Cohort 定义" hint="后续可建立可比较的 Task 范围" />
                ) : (
                  cohorts.map((cohort) => (
                    <div
                      key={cohort.id}
                      className="ap-row"
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0, 1fr) 110px',
                        gap: 8,
                      }}
                    >
                      <strong>{cohort.title}</strong>
                      <span style={{ color: C.sub, fontSize: FS.cap }}>
                        {cohort.status} ·{' '}
                        {cohortDefinitionFields(cohort.definition).projectId ?? '所有项目'} ·{' '}
                        {cohortDefinitionFields(cohort.definition).type ?? '所有类型'}
                      </span>
                      <SoftButton onClick={() => startCohortEdit(cohort)}>编辑</SoftButton>
                    </div>
                  ))
                )}
                <div style={{ display: 'grid', gap: 8 }}>
                  <strong>Experiment 定义</strong>
                  <input
                    style={fieldStyle}
                    value={experimentTitle}
                    onChange={(event) => setExperimentTitle(event.target.value)}
                    placeholder="Experiment 标题"
                  />
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                      gap: 8,
                    }}
                  >
                    <select
                      style={fieldStyle}
                      value={experimentCohortId}
                      onChange={(event) => setExperimentCohortId(event.target.value)}
                      disabled={Boolean(editingExperimentId)}
                    >
                      <option value="">选择 Cohort</option>
                      {cohorts.map((cohort) => (
                        <option key={cohort.id} value={cohort.id}>
                          {cohort.title}
                        </option>
                      ))}
                    </select>
                    <select
                      style={fieldStyle}
                      value={controlConfigId}
                      onChange={(event) => setControlConfigId(event.target.value)}
                      disabled={Boolean(editingExperimentId)}
                    >
                      <option value="">Control 配置</option>
                      {configurations.map((config) => (
                        <option key={config.id} value={config.id}>
                          {config.agent} · {config.model ?? config.sourceHash}
                        </option>
                      ))}
                    </select>
                    <select
                      style={fieldStyle}
                      value={candidateConfigId}
                      onChange={(event) => setCandidateConfigId(event.target.value)}
                      disabled={Boolean(editingExperimentId)}
                    >
                      <option value="">Candidate 配置</option>
                      {configurations.map((config) => (
                        <option key={config.id} value={config.id}>
                          {config.agent} · {config.model ?? config.sourceHash}
                        </option>
                      ))}
                    </select>
                  </div>
                  <input
                    style={fieldStyle}
                    value={primaryMetric}
                    onChange={(event) => setPrimaryMetric(event.target.value)}
                    placeholder="主要指标，例如 test_pass_rate"
                  />
                  <textarea
                    style={{ ...fieldStyle, height: 56, padding: 10, resize: 'vertical' }}
                    value={guardrails}
                    onChange={(event) => setGuardrails(event.target.value)}
                    placeholder="Guardrail，每行一项"
                  />
                  <SoftButton
                    disabled={
                      !experimentTitle.trim() ||
                      !experimentCohortId ||
                      !controlConfigId ||
                      !candidateConfigId ||
                      !primaryMetric.trim() ||
                      controlConfigId === candidateConfigId
                    }
                    onClick={saveExperiment}
                  >
                    {editingExperimentId ? '保存 Experiment' : '创建 Experiment'}
                  </SoftButton>
                </div>
                {experiments.map((experiment) => (
                  <div key={experiment.id} className="ap-row" style={{ display: 'grid', gap: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <strong>{experiment.title}</strong>
                      <SoftButton onClick={() => startExperimentEdit(experiment)}>编辑</SoftButton>
                    </div>
                    <span style={{ color: C.sub, fontSize: FS.cap }}>
                      {experiment.primaryMetric} · {experiment.guardrails.length} 项 guardrails
                    </span>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
                        gap: 8,
                      }}
                    >
                      <select
                        style={fieldStyle}
                        value={experiment.evidenceStatus}
                        onChange={(event) =>
                          updateExperimentDecision(
                            experiment.id,
                            event.target.value as ExperimentRecord['evidenceStatus'],
                            experiment.decision,
                          )
                        }
                      >
                        {['not_collected', 'insufficient_evidence', 'ready'].map((value) => (
                          <option key={value}>{value}</option>
                        ))}
                      </select>
                      <select
                        style={fieldStyle}
                        value={experiment.decision ?? ''}
                        onChange={(event) =>
                          updateExperimentDecision(
                            experiment.id,
                            experiment.evidenceStatus,
                            (event.target.value || null) as ExperimentRecord['decision'],
                          )
                        }
                      >
                        <option value="">尚无决策</option>
                        {allowedExperimentDecisions(experiment.evidenceStatus).map((decision) => (
                          <option key={decision} value={decision}>
                            {decision}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}
      </div>
    </main>
  );
}
