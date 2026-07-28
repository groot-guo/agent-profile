import { randomUUID } from 'node:crypto';
import {
  buildTaskProfile,
  type TaskOutcomeEvidence,
  type TaskProfileConfiguration,
  type TaskProfileOutcome,
  type TaskProfileReport,
  type TaskProfileSessionSample,
  type TaskProfileTask,
  type TaskStatus,
  type VerificationStatus,
} from '@agent-profile/core';
import type { DatabaseConnection } from './database';

type TaskRole = TaskProfileSessionSample['role'];
type TaskContentMode = 'structured' | 'local_text';

export class TaskModelError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode = 400,
  ) {
    super(code);
  }
}

export interface TaskRecord extends TaskProfileTask {
  contentMode: TaskContentMode;
  goal: string | null;
  acceptanceCriteria: string[] | null;
  createdAt: number;
  updatedAt: number;
}

export interface TaskSessionRecord {
  taskId: string;
  sessionId: string;
  configSnapshotId: string | null;
  role: TaskRole;
  startedAt: number | null;
  finishedAt: number | null;
  available: boolean;
  agent: string | null;
  name: string | null;
}

export interface CohortRecord {
  id: string;
  title: string;
  definition: Record<string, unknown>;
  status: 'active' | 'archived';
  createdAt: number;
  updatedAt: number;
}

export interface ExperimentRecord {
  id: string;
  title: string;
  cohortId: string;
  controlConfigId: string;
  candidateConfigId: string;
  primaryMetric: string;
  guardrails: unknown[];
  status: 'draft' | 'running' | 'completed' | 'cancelled';
  evidenceStatus: 'not_collected' | 'insufficient_evidence' | 'ready';
  decision: 'keep' | 'rollback' | 'insufficient_evidence' | null;
  createdAt: number;
  updatedAt: number;
}

export class TaskRepository {
  constructor(private readonly database: DatabaseConnection) {}

  createTask(input: {
    id?: string;
    projectId?: string;
    title: string;
    type: string;
    status?: TaskStatus;
    contentMode?: TaskContentMode;
    goal?: string;
    acceptanceCriteria?: string[];
    complexity?: 'small' | 'medium' | 'large';
  }): TaskRecord {
    const id = input.id?.trim() || randomUUID();
    const title = requiredText(input.title, 'invalid_task_title', 200);
    const type = requiredText(input.type, 'invalid_task_type', 80);
    const contentMode = input.contentMode ?? 'structured';
    if (contentMode === 'structured' && (input.goal || input.acceptanceCriteria?.length)) {
      throw new TaskModelError('local_text_mode_required');
    }
    const now = Date.now();
    this.database
      .prepare(
        `INSERT INTO tasks (
          id, project_id, title, type, status, content_mode, goal,
          acceptance_criteria, complexity, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        optionalText(input.projectId, 500),
        title,
        type,
        input.status ?? 'planned',
        contentMode,
        contentMode === 'local_text' ? optionalText(input.goal, 4_000) : null,
        contentMode === 'local_text' && input.acceptanceCriteria
          ? JSON.stringify(
              input.acceptanceCriteria.map((item) =>
                requiredText(item, 'invalid_acceptance', 1_000),
              ),
            )
          : null,
        input.complexity ?? null,
        now,
        now,
      );
    return this.requireTask(id);
  }

  listTasks(): TaskRecord[] {
    return (
      this.database.prepare('SELECT * FROM tasks ORDER BY updated_at DESC, id').all() as TaskRow[]
    ).map(mapTask);
  }

  requireTask(id: string): TaskRecord {
    const row = this.database.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as
      | TaskRow
      | undefined;
    if (!row) throw new TaskModelError('task_not_found', 404);
    return mapTask(row);
  }

  updateTask(
    id: string,
    input: Partial<{
      projectId: string | null;
      title: string;
      type: string;
      status: TaskStatus;
      contentMode: TaskContentMode;
      goal: string | null;
      acceptanceCriteria: string[] | null;
      complexity: 'small' | 'medium' | 'large' | null;
    }>,
  ): TaskRecord {
    const current = this.requireTask(id);
    const contentMode = input.contentMode ?? current.contentMode;
    const goal = input.goal === undefined ? current.goal : input.goal;
    const acceptance =
      input.acceptanceCriteria === undefined
        ? current.acceptanceCriteria
        : input.acceptanceCriteria;
    if (contentMode === 'structured' && (goal || acceptance?.length)) {
      throw new TaskModelError('local_text_mode_required');
    }
    this.database
      .prepare(
        `UPDATE tasks SET project_id = ?, title = ?, type = ?, status = ?,
          content_mode = ?, goal = ?, acceptance_criteria = ?, complexity = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.projectId === undefined
          ? (current.projectId ?? null)
          : optionalText(input.projectId, 500),
        input.title === undefined
          ? current.title
          : requiredText(input.title, 'invalid_task_title', 200),
        input.type === undefined ? current.type : requiredText(input.type, 'invalid_task_type', 80),
        input.status ?? current.status,
        contentMode,
        contentMode === 'local_text' ? optionalText(goal, 4_000) : null,
        contentMode === 'local_text' && acceptance
          ? JSON.stringify(
              acceptance.map((item) => requiredText(item, 'invalid_acceptance', 1_000)),
            )
          : null,
        input.complexity === undefined ? (current.complexity ?? null) : input.complexity,
        Date.now(),
        id,
      );
    return this.requireTask(id);
  }

  createConfiguration(input: {
    id?: string;
    agent: string;
    model?: string;
    agentRulesVersion?: string;
    toolPolicyVersion?: string;
    promptTemplateVersion?: string;
    sourceHash: string;
  }): TaskProfileConfiguration {
    const id = input.id?.trim() || randomUUID();
    this.database
      .prepare(
        `INSERT INTO config_snapshots (
          id, agent, model, agent_rules_version, tool_policy_version,
          prompt_template_version, source_hash, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        requiredText(input.agent, 'invalid_agent', 80),
        optionalText(input.model, 200),
        optionalText(input.agentRulesVersion, 200),
        optionalText(input.toolPolicyVersion, 200),
        optionalText(input.promptTemplateVersion, 200),
        requiredText(input.sourceHash, 'invalid_source_hash', 256),
        Date.now(),
      );
    return this.requireConfiguration(id);
  }

  listConfigurations(): TaskProfileConfiguration[] {
    return (
      this.database
        .prepare('SELECT * FROM config_snapshots ORDER BY created_at DESC, id')
        .all() as ConfigRow[]
    ).map(mapConfiguration);
  }

  attachSession(
    taskId: string,
    input: {
      sessionId: string;
      configSnapshotId?: string;
      role?: TaskRole;
      startedAt?: number;
      finishedAt?: number;
    },
  ): TaskSessionRecord {
    this.requireTask(taskId);
    const sessionId = requiredText(input.sessionId, 'invalid_session_id', 500);
    if (!this.database.prepare('SELECT 1 FROM sessions WHERE id = ?').get(sessionId)) {
      throw new TaskModelError('session_not_found', 404);
    }
    if (input.configSnapshotId) this.requireConfiguration(input.configSnapshotId);
    try {
      this.database
        .prepare(
          `INSERT INTO task_sessions (
            task_id, session_id, config_snapshot_id, role, started_at, finished_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          taskId,
          sessionId,
          input.configSnapshotId ?? null,
          input.role ?? 'primary',
          input.startedAt ?? null,
          input.finishedAt ?? null,
          Date.now(),
        );
    } catch (error) {
      if (String(error).includes('UNIQUE constraint failed')) {
        throw new TaskModelError('task_session_exists', 409);
      }
      throw error;
    }
    const linked = this.listTaskSessions(taskId).find((link) => link.sessionId === sessionId);
    if (!linked) throw new TaskModelError('task_session_not_found', 500);
    return linked;
  }

  listTaskSessions(taskId: string): TaskSessionRecord[] {
    this.requireTask(taskId);
    return (
      this.database
        .prepare(
          `SELECT ts.task_id, ts.session_id, ts.config_snapshot_id, ts.role,
            ts.started_at, ts.finished_at, s.id AS stored_session_id,
            s.agent, s.name
           FROM task_sessions ts
           LEFT JOIN sessions s ON s.id = ts.session_id
           WHERE ts.task_id = ?
           ORDER BY COALESCE(ts.started_at, s.start_time, ts.created_at), ts.session_id`,
        )
        .all(taskId) as TaskSessionRow[]
    ).map(mapTaskSession);
  }

  upsertOutcome(
    taskId: string,
    input: Partial<{
      buildStatus: VerificationStatus | null;
      testStatus: VerificationStatus | null;
      lintStatus: VerificationStatus | null;
      gitCommit: string | null;
      humanRating: number | null;
      reworkReason: string | null;
      completedAt: number | null;
      evidence: TaskOutcomeEvidence[];
    }>,
  ): TaskProfileOutcome {
    this.requireTask(taskId);
    const current = this.getOutcome(taskId);
    const next: TaskProfileOutcome = {
      buildStatus:
        input.buildStatus === undefined ? (current?.buildStatus ?? null) : input.buildStatus,
      testStatus: input.testStatus === undefined ? (current?.testStatus ?? null) : input.testStatus,
      lintStatus: input.lintStatus === undefined ? (current?.lintStatus ?? null) : input.lintStatus,
      gitCommit:
        input.gitCommit === undefined
          ? (current?.gitCommit ?? null)
          : optionalText(input.gitCommit, 200),
      humanRating:
        input.humanRating === undefined ? (current?.humanRating ?? null) : input.humanRating,
      reworkReason:
        input.reworkReason === undefined
          ? (current?.reworkReason ?? null)
          : optionalText(input.reworkReason, 2_000),
      completedAt:
        input.completedAt === undefined ? (current?.completedAt ?? null) : input.completedAt,
      evidence: input.evidence
        ? input.evidence.map(validateOutcomeEvidence)
        : (current?.evidence ?? []),
    };
    if (
      next.humanRating != null &&
      (!Number.isInteger(next.humanRating) || next.humanRating < 1 || next.humanRating > 5)
    ) {
      throw new TaskModelError('invalid_human_rating');
    }
    this.database
      .prepare(
        `INSERT INTO task_outcomes (
          task_id, build_status, test_status, lint_status, git_commit, human_rating,
          rework_reason, completed_at, evidence_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(task_id) DO UPDATE SET
          build_status = excluded.build_status,
          test_status = excluded.test_status,
          lint_status = excluded.lint_status,
          git_commit = excluded.git_commit,
          human_rating = excluded.human_rating,
          rework_reason = excluded.rework_reason,
          completed_at = excluded.completed_at,
          evidence_json = excluded.evidence_json,
          updated_at = excluded.updated_at`,
      )
      .run(
        taskId,
        next.buildStatus,
        next.testStatus,
        next.lintStatus,
        next.gitCommit,
        next.humanRating,
        next.reworkReason,
        next.completedAt,
        JSON.stringify(next.evidence),
        Date.now(),
      );
    const stored = this.getOutcome(taskId);
    if (!stored) throw new TaskModelError('task_outcome_not_found', 500);
    return stored;
  }

  getOutcome(taskId: string): TaskProfileOutcome | null {
    const row = this.database
      .prepare('SELECT * FROM task_outcomes WHERE task_id = ?')
      .get(taskId) as OutcomeRow | undefined;
    return row ? mapOutcome(row) : null;
  }

  createCohort(input: {
    id?: string;
    title: string;
    definition: Record<string, unknown>;
    status?: 'active' | 'archived';
  }): CohortRecord {
    const id = input.id?.trim() || randomUUID();
    const now = Date.now();
    this.database
      .prepare(
        `INSERT INTO cohorts (id, title, definition_json, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        requiredText(input.title, 'invalid_cohort_title', 200),
        JSON.stringify(input.definition),
        input.status ?? 'active',
        now,
        now,
      );
    return this.requireCohort(id);
  }

  listCohorts(): CohortRecord[] {
    return (
      this.database
        .prepare('SELECT * FROM cohorts ORDER BY updated_at DESC, id')
        .all() as CohortRow[]
    ).map(mapCohort);
  }

  updateCohort(
    id: string,
    input: Partial<{
      title: string;
      definition: Record<string, unknown>;
      status: CohortRecord['status'];
    }>,
  ): CohortRecord {
    const current = this.requireCohort(id);
    this.database
      .prepare(
        `UPDATE cohorts SET title = ?, definition_json = ?, status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.title === undefined
          ? current.title
          : requiredText(input.title, 'invalid_cohort_title', 200),
        JSON.stringify(input.definition ?? current.definition),
        input.status ?? current.status,
        Date.now(),
        id,
      );
    return this.requireCohort(id);
  }

  createExperiment(input: {
    id?: string;
    title: string;
    cohortId: string;
    controlConfigId: string;
    candidateConfigId: string;
    primaryMetric: string;
    guardrails: unknown[];
    status?: ExperimentRecord['status'];
    evidenceStatus?: ExperimentRecord['evidenceStatus'];
    decision?: ExperimentRecord['decision'];
  }): ExperimentRecord {
    this.requireCohort(input.cohortId);
    this.requireConfiguration(input.controlConfigId);
    this.requireConfiguration(input.candidateConfigId);
    const id = input.id?.trim() || randomUUID();
    const now = Date.now();
    this.database
      .prepare(
        `INSERT INTO experiments (
          id, title, cohort_id, control_config_id, candidate_config_id,
          primary_metric, guardrails_json, status, evidence_status, decision,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        requiredText(input.title, 'invalid_experiment_title', 200),
        input.cohortId,
        input.controlConfigId,
        input.candidateConfigId,
        requiredText(input.primaryMetric, 'invalid_primary_metric', 100),
        JSON.stringify(input.guardrails),
        input.status ?? 'draft',
        input.evidenceStatus ?? 'not_collected',
        input.decision ?? null,
        now,
        now,
      );
    return this.requireExperiment(id);
  }

  listExperiments(): ExperimentRecord[] {
    return (
      this.database
        .prepare('SELECT * FROM experiments ORDER BY updated_at DESC, id')
        .all() as ExperimentRow[]
    ).map(mapExperiment);
  }

  updateExperiment(
    id: string,
    input: Partial<{
      title: string;
      primaryMetric: string;
      guardrails: unknown[];
      status: ExperimentRecord['status'];
      evidenceStatus: ExperimentRecord['evidenceStatus'];
      decision: ExperimentRecord['decision'];
    }>,
  ): ExperimentRecord {
    const current = this.requireExperiment(id);
    this.database
      .prepare(
        `UPDATE experiments SET title = ?, primary_metric = ?, guardrails_json = ?,
          status = ?, evidence_status = ?, decision = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.title === undefined
          ? current.title
          : requiredText(input.title, 'invalid_experiment_title', 200),
        input.primaryMetric === undefined
          ? current.primaryMetric
          : requiredText(input.primaryMetric, 'invalid_primary_metric', 100),
        JSON.stringify(input.guardrails ?? current.guardrails),
        input.status ?? current.status,
        input.evidenceStatus ?? current.evidenceStatus,
        input.decision === undefined ? current.decision : input.decision,
        Date.now(),
        id,
      );
    return this.requireExperiment(id);
  }

  buildProfile(taskId: string): TaskProfileReport {
    const task = this.requireTask(taskId);
    const rows = this.database
      .prepare(
        `SELECT ts.session_id, ts.config_snapshot_id, ts.role,
          s.id AS stored_session_id, s.agent, s.input_tokens, s.cache_creation_tokens,
          s.cache_read_tokens, s.output_tokens, s.total_cost, s.cost_unknown_count,
          s.peak_context_tokens, s.cache_hit_rate, s.start_time, s.end_time,
          SUM(CASE WHEN sp.type = 'tool_call' THEN 1 ELSE 0 END) AS tool_calls,
          SUM(CASE WHEN sp.type = 'tool_call' AND sp.is_error = 1 THEN 1 ELSE 0 END) AS tool_errors
         FROM task_sessions ts
         LEFT JOIN sessions s ON s.id = ts.session_id
         LEFT JOIN spans sp ON sp.session_id = s.id
         WHERE ts.task_id = ?
         GROUP BY ts.task_id, ts.session_id`,
      )
      .all(taskId) as ProfileSessionRow[];
    const configIds = [
      ...new Set(rows.map((row) => row.config_snapshot_id).filter(Boolean) as string[]),
    ];
    const configurations = configIds.map((id) => this.requireConfiguration(id));
    const cohortIds = this.listCohorts()
      .filter((cohort) => cohortMatches(cohort, task))
      .map((cohort) => cohort.id);
    return buildTaskProfile({
      task,
      configurations,
      sessions: rows.map(mapProfileSession),
      outcome: this.getOutcome(taskId) ?? undefined,
      cohortIds,
    });
  }

  private requireConfiguration(id: string): TaskProfileConfiguration {
    const row = this.database.prepare('SELECT * FROM config_snapshots WHERE id = ?').get(id) as
      | ConfigRow
      | undefined;
    if (!row) throw new TaskModelError('config_snapshot_not_found', 404);
    return mapConfiguration(row);
  }

  private requireCohort(id: string): CohortRecord {
    const row = this.database.prepare('SELECT * FROM cohorts WHERE id = ?').get(id) as
      | CohortRow
      | undefined;
    if (!row) throw new TaskModelError('cohort_not_found', 404);
    return mapCohort(row);
  }

  private requireExperiment(id: string): ExperimentRecord {
    const row = this.database.prepare('SELECT * FROM experiments WHERE id = ?').get(id) as
      | ExperimentRow
      | undefined;
    if (!row) throw new TaskModelError('experiment_not_found', 404);
    return mapExperiment(row);
  }
}

interface TaskRow {
  id: string;
  project_id: string | null;
  title: string;
  type: string;
  status: TaskStatus;
  content_mode: TaskContentMode;
  goal: string | null;
  acceptance_criteria: string | null;
  complexity: TaskRecord['complexity'] | null;
  created_at: number;
  updated_at: number;
}

interface ConfigRow {
  id: string;
  agent: string;
  model: string | null;
  agent_rules_version: string | null;
  tool_policy_version: string | null;
  prompt_template_version: string | null;
  source_hash: string;
}

interface TaskSessionRow {
  task_id: string;
  session_id: string;
  config_snapshot_id: string | null;
  role: TaskRole;
  started_at: number | null;
  finished_at: number | null;
  stored_session_id: string | null;
  agent: string | null;
  name: string | null;
}

interface OutcomeRow {
  build_status: VerificationStatus | null;
  test_status: VerificationStatus | null;
  lint_status: VerificationStatus | null;
  git_commit: string | null;
  human_rating: number | null;
  rework_reason: string | null;
  completed_at: number | null;
  evidence_json: string | null;
}

interface CohortRow {
  id: string;
  title: string;
  definition_json: string;
  status: CohortRecord['status'];
  created_at: number;
  updated_at: number;
}

interface ExperimentRow {
  id: string;
  title: string;
  cohort_id: string;
  control_config_id: string;
  candidate_config_id: string;
  primary_metric: string;
  guardrails_json: string;
  status: ExperimentRecord['status'];
  evidence_status: ExperimentRecord['evidenceStatus'];
  decision: ExperimentRecord['decision'];
  created_at: number;
  updated_at: number;
}

interface ProfileSessionRow {
  session_id: string;
  config_snapshot_id: string | null;
  role: TaskRole;
  stored_session_id: string | null;
  agent: string | null;
  input_tokens: number | null;
  cache_creation_tokens: number | null;
  cache_read_tokens: number | null;
  output_tokens: number | null;
  total_cost: number | null;
  cost_unknown_count: number | null;
  peak_context_tokens: number | null;
  cache_hit_rate: number | null;
  start_time: number | null;
  end_time: number | null;
  tool_calls: number | null;
  tool_errors: number | null;
}

function mapTask(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    projectId: row.project_id ?? undefined,
    title: row.title,
    type: row.type,
    status: row.status,
    contentMode: row.content_mode,
    goal: row.goal,
    acceptanceCriteria: row.acceptance_criteria
      ? (JSON.parse(row.acceptance_criteria) as string[])
      : null,
    complexity: row.complexity ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapConfiguration(row: ConfigRow): TaskProfileConfiguration {
  return {
    id: row.id,
    agent: row.agent,
    model: row.model ?? undefined,
    agentRulesVersion: row.agent_rules_version ?? undefined,
    toolPolicyVersion: row.tool_policy_version ?? undefined,
    promptTemplateVersion: row.prompt_template_version ?? undefined,
    sourceHash: row.source_hash,
  };
}

function mapTaskSession(row: TaskSessionRow): TaskSessionRecord {
  return {
    taskId: row.task_id,
    sessionId: row.session_id,
    configSnapshotId: row.config_snapshot_id,
    role: row.role,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    available: row.stored_session_id != null,
    agent: row.agent,
    name: row.name,
  };
}

function mapOutcome(row: OutcomeRow): TaskProfileOutcome {
  return {
    buildStatus: row.build_status,
    testStatus: row.test_status,
    lintStatus: row.lint_status,
    gitCommit: row.git_commit,
    humanRating: row.human_rating,
    reworkReason: row.rework_reason,
    completedAt: row.completed_at,
    evidence: row.evidence_json ? (JSON.parse(row.evidence_json) as TaskOutcomeEvidence[]) : [],
  };
}

function mapCohort(row: CohortRow): CohortRecord {
  return {
    id: row.id,
    title: row.title,
    definition: JSON.parse(row.definition_json) as Record<string, unknown>,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapExperiment(row: ExperimentRow): ExperimentRecord {
  return {
    id: row.id,
    title: row.title,
    cohortId: row.cohort_id,
    controlConfigId: row.control_config_id,
    candidateConfigId: row.candidate_config_id,
    primaryMetric: row.primary_metric,
    guardrails: JSON.parse(row.guardrails_json) as unknown[],
    status: row.status,
    evidenceStatus: row.evidence_status,
    decision: row.decision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProfileSession(row: ProfileSessionRow): TaskProfileSessionSample {
  return {
    id: row.session_id,
    available: row.stored_session_id != null,
    role: row.role,
    configSnapshotId: row.config_snapshot_id ?? undefined,
    agent: row.agent ?? undefined,
    inputTokens: row.input_tokens ?? undefined,
    cacheCreationTokens: row.cache_creation_tokens ?? undefined,
    cacheReadTokens: row.cache_read_tokens ?? undefined,
    outputTokens: row.output_tokens ?? undefined,
    totalCost: row.total_cost ?? undefined,
    costUnknownCount: row.cost_unknown_count ?? undefined,
    peakContextTokens: row.peak_context_tokens ?? undefined,
    cacheHitRate: row.cache_hit_rate ?? undefined,
    startTime: row.start_time ?? undefined,
    endTime: row.end_time ?? undefined,
    toolCalls: row.tool_calls ?? 0,
    toolErrors: row.tool_errors ?? 0,
  };
}

function cohortMatches(cohort: CohortRecord, task: TaskRecord): boolean {
  const projectId = cohort.definition.projectId;
  const type = cohort.definition.type;
  const complexity = cohort.definition.complexity;
  return (
    (projectId == null || projectId === task.projectId) &&
    (type == null || type === task.type) &&
    (complexity == null || complexity === task.complexity)
  );
}

function requiredText(value: string, code: string, max: number): string {
  const text = value?.trim();
  if (!text || text.length > max) throw new TaskModelError(code);
  return text;
}

function optionalText(value: string | null | undefined, max: number): string | null {
  if (value == null) return null;
  const text = value.trim();
  if (!text) return null;
  if (text.length > max) throw new TaskModelError('text_too_long');
  return text;
}

function validateOutcomeEvidence(value: TaskOutcomeEvidence): TaskOutcomeEvidence {
  if (!value || typeof value !== 'object') throw new TaskModelError('invalid_outcome_evidence');
  return {
    kind: requiredText(value.kind, 'invalid_outcome_evidence', 80),
    status: value.status,
    reference: optionalText(value.reference, 500) ?? undefined,
  };
}
