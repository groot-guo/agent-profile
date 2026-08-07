import type {
  TaskEvidenceProvenance,
  TaskOutcomeEvidence,
  TaskProfileConfiguration,
  TaskProfileOutcome,
  TaskProfileSessionSample,
  TaskStatus,
  VerificationStatus,
} from '@agent-profile/core';
import type {
  CohortRecord,
  ExperimentRecord,
  TaskRecord,
  TaskSessionRecord,
} from './task-repository';

export interface TaskRow {
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

export interface ConfigRow {
  id: string;
  agent: string;
  model: string | null;
  agent_rules_version: string | null;
  tool_policy_version: string | null;
  prompt_template_version: string | null;
  source_hash: string;
}

export interface TaskSessionRow {
  task_id: string;
  session_id: string;
  config_snapshot_id: string | null;
  role: TaskRole;
  started_at: number | null;
  finished_at: number | null;
  link_provenance_json: string | null;
  stored_session_id: string | null;
  agent: string | null;
  name: string | null;
}

export interface OutcomeRow {
  build_status: VerificationStatus | null;
  test_status: VerificationStatus | null;
  lint_status: VerificationStatus | null;
  git_commit: string | null;
  human_rating: number | null;
  rework_reason: string | null;
  completed_at: number | null;
  evidence_json: string | null;
}

export interface CohortRow {
  id: string;
  title: string;
  definition_json: string;
  status: CohortRecord['status'];
  created_at: number;
  updated_at: number;
}

export interface ExperimentRow {
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

export interface ProfileSessionRow {
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

export interface ExperimentProfileRow {
  taskId: string;
  projectId: string | null;
  type: string;
  complexity: TaskRecord['complexity'] | null;
  configSnapshotId: string;
  outcomeVerified: number;
  sessionCount: number;
  durationSessions: number;
  durationMs: number;
  totalTokens: number;
  totalCost: number;
  costUnknownCount: number;
  peakContextTokens: number | null;
  cacheReadTokens: number;
  contextTokens: number;
  toolCalls: number;
  toolErrors: number;
}

type TaskRole = TaskProfileSessionSample['role'];
type TaskContentMode = 'structured' | 'local_text';

export function mapTask(row: TaskRow): TaskRecord {
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

export function mapConfiguration(row: ConfigRow): TaskProfileConfiguration {
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

export function mapTaskSession(row: TaskSessionRow): TaskSessionRecord {
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
    ...(row.link_provenance_json
      ? { provenance: JSON.parse(row.link_provenance_json) as TaskEvidenceProvenance }
      : {}),
  };
}

export function mapOutcome(row: OutcomeRow): TaskProfileOutcome {
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

export function mapCohort(row: CohortRow): CohortRecord {
  return {
    id: row.id,
    title: row.title,
    definition: JSON.parse(row.definition_json) as Record<string, unknown>,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapExperiment(row: ExperimentRow): ExperimentRecord {
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

export function mapProfileSession(row: ProfileSessionRow): TaskProfileSessionSample {
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
