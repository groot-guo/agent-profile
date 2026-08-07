import { randomUUID } from 'node:crypto';
import {
  buildCohortRuntimeProfile,
  buildPostRunFeedback,
  buildTaskProfile,
  type CohortRuntimeProfileReport,
  type PostRunFeedbackReport,
  type RuntimeHintHistoricalEvidence,
  type RuntimeProfileComparabilityInput,
  type RuntimeProfileStratumDimension,
  type TaskEvidenceProvenance,
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
import {
  type CohortRow,
  type ConfigRow,
  type ExperimentProfileRow,
  type ExperimentRow,
  mapCohort,
  mapConfiguration,
  mapExperiment,
  mapOutcome,
  mapProfileSession,
  mapTask,
  mapTaskSession,
  type OutcomeRow,
  type ProfileSessionRow,
  type TaskRow,
  type TaskSessionRow,
} from './task-mappers';
import {
  isVerifiedOutcome,
  optionalText,
  optionalTimestamp,
  requiredText,
  TaskModelError,
  validateEvidenceProvenance,
  validateOutcomeEvidenceList,
} from './task-validation';

type TaskRole = TaskProfileSessionSample['role'];
type TaskContentMode = 'structured' | 'local_text';

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
  provenance?: TaskEvidenceProvenance;
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
      provenance?: TaskEvidenceProvenance;
    },
  ): TaskSessionRecord {
    this.requireTask(taskId);
    const sessionId = requiredText(input.sessionId, 'invalid_session_id', 500);
    if (!this.database.prepare('SELECT 1 FROM sessions WHERE id = ?').get(sessionId)) {
      throw new TaskModelError('session_not_found', 404);
    }
    if (input.configSnapshotId) this.requireConfiguration(input.configSnapshotId);
    const provenance = validateEvidenceProvenance(input.provenance);
    try {
      this.database
        .prepare(
          `INSERT INTO task_sessions (
            task_id, session_id, config_snapshot_id, role, started_at, finished_at,
            link_producer, link_captured_at, link_provenance_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          taskId,
          sessionId,
          input.configSnapshotId ?? null,
          input.role ?? 'primary',
          input.startedAt ?? null,
          input.finishedAt ?? null,
          provenance?.producer ?? null,
          provenance?.capturedAt ?? null,
          provenance ? JSON.stringify(provenance) : null,
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
            ts.started_at, ts.finished_at, ts.link_provenance_json,
            s.id AS stored_session_id,
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
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new TaskModelError('invalid_task_outcome');
    }
    this.requireTask(taskId);
    const current = this.getOutcome(taskId);
    if (input.gitCommit != null && typeof input.gitCommit !== 'string') {
      throw new TaskModelError('invalid_git_commit');
    }
    if (input.reworkReason != null && typeof input.reworkReason !== 'string') {
      throw new TaskModelError('invalid_rework_reason');
    }
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
        input.completedAt === undefined
          ? (current?.completedAt ?? null)
          : optionalTimestamp(input.completedAt),
      evidence:
        input.evidence === undefined
          ? (current?.evidence ?? [])
          : validateOutcomeEvidenceList(input.evidence),
    };
    if (
      next.humanRating != null &&
      (!Number.isInteger(next.humanRating) || next.humanRating < 1 || next.humanRating > 5)
    ) {
      throw new TaskModelError('invalid_human_rating');
    }
    if (
      next.completedAt != null &&
      (!Number.isSafeInteger(next.completedAt) || next.completedAt < 0)
    ) {
      throw new TaskModelError('invalid_completed_at');
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
    validateCohortDefinition(input.definition);
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
    const definition = input.definition ?? current.definition;
    validateCohortDefinition(definition);
    this.database
      .prepare(
        `UPDATE cohorts SET title = ?, definition_json = ?, status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.title === undefined
          ? current.title
          : requiredText(input.title, 'invalid_cohort_title', 200),
        JSON.stringify(definition),
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

  buildExperimentProfile(experimentId: string): CohortRuntimeProfileReport {
    const experiment = this.requireExperiment(experimentId);
    const cohort = this.requireCohort(experiment.cohortId);
    const rows = this.database
      .prepare(
        `SELECT t.id as taskId, t.project_id as projectId, t.type,
          t.complexity, ts.config_snapshot_id as configSnapshotId,
          CASE WHEN o.build_status IS NOT NULL AND o.test_status IS NOT NULL
            AND o.lint_status IS NOT NULL AND o.git_commit IS NOT NULL
            AND o.human_rating IS NOT NULL THEN 1 ELSE 0 END as outcomeVerified,
          COUNT(s.id) as sessionCount,
          SUM(CASE WHEN s.start_time IS NOT NULL AND s.end_time IS NOT NULL
            THEN 1 ELSE 0 END) as durationSessions,
          SUM(CASE WHEN s.start_time IS NOT NULL AND s.end_time IS NOT NULL
            THEN s.end_time - s.start_time ELSE 0 END) as durationMs,
          SUM(COALESCE(s.input_tokens, 0) + COALESCE(s.cache_creation_tokens, 0)
            + COALESCE(s.cache_read_tokens, 0) + COALESCE(s.output_tokens, 0)) as totalTokens,
          SUM(COALESCE(s.total_cost, 0)) as totalCost,
          SUM(COALESCE(s.cost_unknown_count, 0)) as costUnknownCount,
          MAX(s.peak_context_tokens) as peakContextTokens,
          SUM(COALESCE(s.cache_read_tokens, 0)) as cacheReadTokens,
          SUM(COALESCE(s.input_tokens, 0) + COALESCE(s.cache_creation_tokens, 0)
            + COALESCE(s.cache_read_tokens, 0)) as contextTokens,
          SUM(COALESCE(sp.toolCalls, 0)) as toolCalls,
          SUM(COALESCE(sp.toolErrors, 0)) as toolErrors
         FROM tasks t
         JOIN task_sessions ts ON ts.task_id = t.id
         LEFT JOIN sessions s ON s.id = ts.session_id
         LEFT JOIN task_outcomes o ON o.task_id = t.id
         LEFT JOIN (
           SELECT session_id,
             SUM(CASE WHEN type = 'tool_call' THEN 1 ELSE 0 END) as toolCalls,
             SUM(CASE WHEN type = 'tool_call' AND is_error = 1 THEN 1 ELSE 0 END) as toolErrors
           FROM spans GROUP BY session_id
         ) sp ON sp.session_id = s.id
         WHERE ts.config_snapshot_id IN (?, ?)
         GROUP BY t.id, ts.config_snapshot_id`,
      )
      .all(experiment.controlConfigId, experiment.candidateConfigId) as ExperimentProfileRow[];
    const configsByTask = new Map<string, Set<string>>();
    for (const row of rows) {
      const configs = configsByTask.get(row.taskId) ?? new Set<string>();
      configs.add(row.configSnapshotId);
      configsByTask.set(row.taskId, configs);
    }
    const tasks = rows
      .filter((row) => configsByTask.get(row.taskId)?.size === 1 && cohortMatches(cohort, row))
      .map((row) => ({
        id: row.taskId,
        configGroup:
          row.configSnapshotId === experiment.controlConfigId
            ? ('control' as const)
            : ('candidate' as const),
        outcomeVerified: row.outcomeVerified === 1,
        metrics: {
          duration_ms:
            row.sessionCount > 0 && row.durationSessions === row.sessionCount
              ? row.durationMs
              : null,
          total_tokens: row.sessionCount > 0 ? row.totalTokens : null,
          total_cost: row.costUnknownCount === 0 ? row.totalCost : null,
          tool_error_rate: row.toolCalls > 0 ? row.toolErrors / row.toolCalls : 0,
          peak_context_tokens: row.peakContextTokens,
          cache_hit_rate: row.contextTokens > 0 ? row.cacheReadTokens / row.contextTokens : null,
        },
        strata: {
          project_id: row.projectId,
          task_type: row.type,
          complexity: row.complexity,
        },
      }));
    return buildCohortRuntimeProfile({
      experimentId: experiment.id,
      title: experiment.title,
      cohortId: experiment.cohortId,
      controlConfigId: experiment.controlConfigId,
      candidateConfigId: experiment.candidateConfigId,
      primaryMetric: experiment.primaryMetric,
      guardrails: experiment.guardrails,
      persistedDecision: experiment.decision,
      comparability: comparabilityFromCohort(cohort.definition),
      tasks,
    });
  }

  findRuntimeHintHistoricalEvidence(
    taskId: string | null,
    configurationSnapshotId: string | null,
  ): RuntimeHintHistoricalEvidence | null {
    if (!taskId || !configurationSnapshotId) return null;
    const matchingExperiments: Array<RuntimeHintHistoricalEvidence> = [];
    for (const experiment of this.listExperiments()) {
      const configurationRole =
        experiment.controlConfigId === configurationSnapshotId
          ? ('control' as const)
          : experiment.candidateConfigId === configurationSnapshotId
            ? ('candidate' as const)
            : null;
      if (!configurationRole || experiment.status !== 'completed') continue;
      const profile = this.buildExperimentProfile(experiment.id);
      const taskRole = profile.groups.control.taskIds.includes(taskId)
        ? 'control'
        : profile.groups.candidate.taskIds.includes(taskId)
          ? 'candidate'
          : null;
      if (taskRole !== configurationRole) continue;
      const primary = profile.comparisons.find(
        (comparison) => comparison.metric === profile.experiment.primaryMetric,
      );
      if (profile.evaluationStatus !== 'ready' || primary?.status !== 'descriptive') continue;
      matchingExperiments.push({
        experimentId: experiment.id,
        cohortId: experiment.cohortId,
        configurationRole,
        profileGeneratedAt: profile.generatedAt,
        evaluationStatus: 'ready',
        primaryMetric: primary.metric,
        primaryStatus: 'descriptive',
        primaryRelativeDelta: primary.relativeDelta,
        guardrails: profile.guardrails.map((guardrail) => ({
          metric: guardrail.metric,
          status: guardrail.status,
        })),
        limitations: profile.limitations,
      });
    }
    return matchingExperiments.length === 1 ? matchingExperiments[0] : null;
  }

  buildTaskFeedback(taskId: string): PostRunFeedbackReport[] {
    const task = this.requireTask(taskId);
    const outcome = this.getOutcome(taskId);
    const outcomeVerified = isVerifiedOutcome(outcome);
    const feedback: PostRunFeedbackReport[] = [];
    for (const experiment of this.listExperiments()) {
      const profile = this.buildExperimentProfile(experiment.id);
      const taskRole = profile.groups.candidate.taskIds.includes(taskId)
        ? 'candidate'
        : profile.groups.control.taskIds.includes(taskId)
          ? 'control'
          : null;
      if (!taskRole) continue;
      feedback.push(
        buildPostRunFeedback({
          task: {
            id: task.id,
            status: task.status,
            outcomeVerified,
            completedAt: outcome?.completedAt ?? null,
          },
          experiment: {
            id: experiment.id,
            cohortId: experiment.cohortId,
            status: experiment.status,
            profile,
            taskRole,
          },
        }),
      );
    }
    return feedback;
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

function cohortMatches(
  cohort: CohortRecord,
  task: {
    projectId?: string | null;
    type: string;
    complexity?: TaskRecord['complexity'] | null;
  },
): boolean {
  const projectId = cohort.definition.projectId;
  const type = cohort.definition.type;
  const complexity = cohort.definition.complexity;
  return (
    (projectId == null || projectId === task.projectId) &&
    (type == null || type === task.type) &&
    (complexity == null || complexity === task.complexity)
  );
}

function comparabilityFromCohort(
  definition: Record<string, unknown>,
): RuntimeProfileComparabilityInput | undefined {
  validateCohortDefinition(definition);
  const value = definition.comparability;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const comparability = value as Record<string, unknown>;
  const dimensions = Array.isArray(comparability.dimensions)
    ? comparability.dimensions.filter(isRuntimeProfileStratumDimension)
    : [];
  if (dimensions.length === 0) return undefined;
  return {
    dimensions: [...new Set(dimensions)],
    ...(typeof comparability.minTasksPerGroup === 'number'
      ? { minTasksPerGroup: comparability.minTasksPerGroup }
      : {}),
    ...(typeof comparability.minOutcomeCoverage === 'number'
      ? { minOutcomeCoverage: comparability.minOutcomeCoverage }
      : {}),
  };
}

function validateCohortDefinition(definition: Record<string, unknown>): void {
  const value = definition.comparability;
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TaskModelError('invalid_comparability');
  }
  const comparability = value as Record<string, unknown>;
  if (
    !Array.isArray(comparability.dimensions) ||
    comparability.dimensions.length === 0 ||
    comparability.dimensions.some((dimension) => !isRuntimeProfileStratumDimension(dimension))
  ) {
    throw new TaskModelError('invalid_comparability');
  }
  if (
    comparability.minTasksPerGroup !== undefined &&
    (typeof comparability.minTasksPerGroup !== 'number' ||
      !Number.isSafeInteger(comparability.minTasksPerGroup) ||
      comparability.minTasksPerGroup <= 0)
  ) {
    throw new TaskModelError('invalid_comparability');
  }
  if (
    comparability.minOutcomeCoverage !== undefined &&
    (typeof comparability.minOutcomeCoverage !== 'number' ||
      !Number.isFinite(comparability.minOutcomeCoverage) ||
      comparability.minOutcomeCoverage < 0 ||
      comparability.minOutcomeCoverage > 1)
  ) {
    throw new TaskModelError('invalid_comparability');
  }
}

function isRuntimeProfileStratumDimension(value: unknown): value is RuntimeProfileStratumDimension {
  return value === 'project_id' || value === 'task_type' || value === 'complexity';
}
