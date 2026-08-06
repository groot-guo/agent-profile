export type TaskStatus = 'planned' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
export type TaskContentMode = 'structured' | 'local_text';
export type TaskComplexity = 'small' | 'medium' | 'large';
export type TaskLinkRole = 'primary' | 'continuation' | 'subagent' | 'verification';
export type CohortStatus = 'active' | 'archived';
export type ExperimentStatus = 'draft' | 'running' | 'completed' | 'cancelled';
export type ExperimentEvidenceStatus = 'not_collected' | 'insufficient_evidence' | 'ready';
export type ExperimentDecision = 'keep' | 'rollback' | 'insufficient_evidence';
export type TaskEvidenceProvenance = {
  producer: string;
  capturedAt: number;
  source: 'local_session' | 'local_git';
  sourceId: string;
  basis: string;
};

export interface TaskRecord {
  id: string;
  projectId: string | null;
  title: string;
  type: string;
  status: TaskStatus;
  contentMode: TaskContentMode;
  goal: string | null;
  acceptanceCriteria: string[] | null;
  complexity: TaskComplexity | null;
  createdAt: number;
  updatedAt: number;
}

export interface TaskSessionLinkRecord {
  taskId: string;
  sessionId: string;
  configSnapshotId: string | null;
  role: TaskLinkRole;
  startedAt: number | null;
  finishedAt: number | null;
  available: boolean;
  agent: string | null;
  name: string | null;
  provenance?: TaskEvidenceProvenance;
}

export interface ConfigurationRecord {
  id: string;
  agent: string;
  model: string | null;
  agentRulesVersion: string | null;
  toolPolicyVersion: string | null;
  promptTemplateVersion: string | null;
  sourceHash: string;
  createdAt: number;
}

export interface CohortRecord {
  id: string;
  title: string;
  definition: Record<string, unknown>;
  status: CohortStatus;
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
  status: ExperimentStatus;
  evidenceStatus: ExperimentEvidenceStatus;
  decision: ExperimentDecision | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateTaskBody {
  id?: string;
  projectId?: string;
  title: string;
  type: string;
  status?: TaskStatus;
  contentMode?: TaskContentMode;
  goal?: string;
  acceptanceCriteria?: string[];
  complexity?: TaskComplexity;
}

export interface UpdateTaskBody {
  projectId?: string | null;
  title?: string;
  type?: string;
  status?: TaskStatus;
  contentMode?: TaskContentMode;
  goal?: string | null;
  acceptanceCriteria?: string[] | null;
  complexity?: TaskComplexity | null;
}

export interface CreateConfigurationBody {
  id?: string;
  agent: string;
  model?: string;
  agentRulesVersion?: string;
  toolPolicyVersion?: string;
  promptTemplateVersion?: string;
  sourceHash: string;
}

export interface AttachSessionBody {
  sessionId: string;
  configSnapshotId?: string;
  role?: TaskLinkRole;
  startedAt?: number;
  finishedAt?: number;
  provenance?: TaskEvidenceProvenance;
}

export interface UpsertOutcomeBody {
  buildStatus?: 'passed' | 'failed' | 'skipped' | 'not_run' | null;
  testStatus?: 'passed' | 'failed' | 'skipped' | 'not_run' | null;
  lintStatus?: 'passed' | 'failed' | 'skipped' | 'not_run' | null;
  gitCommit?: string | null;
  humanRating?: number | null;
  reworkReason?: string | null;
  completedAt?: number | null;
  evidence?: Array<{
    kind: string;
    status?: 'passed' | 'failed' | 'skipped' | 'not_run';
    reference?: string;
    provenance?: TaskEvidenceProvenance;
  }>;
}

export interface CreateCohortBody {
  id?: string;
  title: string;
  definition: Record<string, unknown>;
  status?: CohortStatus;
}

export interface UpdateCohortBody {
  title?: string;
  definition?: Record<string, unknown>;
  status?: CohortStatus;
}

export interface CreateExperimentBody {
  id?: string;
  title: string;
  cohortId: string;
  controlConfigId: string;
  candidateConfigId: string;
  primaryMetric: string;
  guardrails?: unknown[];
  status?: ExperimentStatus;
  evidenceStatus?: ExperimentEvidenceStatus;
  decision?: ExperimentDecision;
}

export interface UpdateExperimentBody {
  title?: string;
  primaryMetric?: string;
  guardrails?: unknown[];
  status?: ExperimentStatus;
  evidenceStatus?: ExperimentEvidenceStatus;
  decision?: ExperimentDecision | null;
}

export const TASK_STATUSES = [
  'planned',
  'in_progress',
  'completed',
  'failed',
  'cancelled',
] as const;
export const TASK_CONTENT_MODES = ['structured', 'local_text'] as const;
export const TASK_COMPLEXITIES = ['small', 'medium', 'large'] as const;
export const TASK_LINK_ROLES = ['primary', 'continuation', 'subagent', 'verification'] as const;
export const COHORT_STATUSES = ['active', 'archived'] as const;
export const EXPERIMENT_STATUSES = ['draft', 'running', 'completed', 'cancelled'] as const;
export const EXPERIMENT_EVIDENCE_STATUSES = [
  'not_collected',
  'insufficient_evidence',
  'ready',
] as const;
export const EXPERIMENT_DECISIONS = ['keep', 'rollback', 'insufficient_evidence'] as const;

const taskStatusSchema = { type: 'string', enum: [...TASK_STATUSES] } as const;
const taskContentModeSchema = { type: 'string', enum: [...TASK_CONTENT_MODES] } as const;
const taskComplexitySchema = { type: 'string', enum: [...TASK_COMPLEXITIES] } as const;
const taskLinkRoleSchema = { type: 'string', enum: [...TASK_LINK_ROLES] } as const;
const cohortStatusSchema = { type: 'string', enum: [...COHORT_STATUSES] } as const;
const experimentStatusSchema = { type: 'string', enum: [...EXPERIMENT_STATUSES] } as const;
const experimentEvidenceStatusSchema = {
  type: 'string',
  enum: [...EXPERIMENT_EVIDENCE_STATUSES],
} as const;
const experimentDecisionSchema = {
  type: ['string', 'null'],
  enum: [...EXPERIMENT_DECISIONS, null],
} as const;

const verificationStatusSchema = {
  type: ['string', 'null'],
  enum: ['passed', 'failed', 'skipped', 'not_run', null],
} as const;

const provenanceSchema = {
  type: 'object',
  properties: {
    producer: { type: 'string', maxLength: 100 },
    capturedAt: { type: 'number' },
    source: { type: 'string', enum: ['local_session', 'local_git'] },
    sourceId: { type: 'string', maxLength: 500 },
    basis: { type: 'string', maxLength: 500 },
    sessionId: { type: 'string', maxLength: 500 },
  },
} as const;

export const createTaskBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'type'],
  properties: {
    id: { type: 'string', maxLength: 500 },
    projectId: { type: 'string', maxLength: 500 },
    title: { type: 'string', minLength: 1, maxLength: 200 },
    type: { type: 'string', minLength: 1, maxLength: 80 },
    status: taskStatusSchema,
    contentMode: taskContentModeSchema,
    goal: { type: 'string', maxLength: 4_000 },
    acceptanceCriteria: {
      type: 'array',
      maxItems: 100,
      items: { type: 'string', minLength: 1, maxLength: 1_000 },
    },
    complexity: taskComplexitySchema,
  },
} as const;

export const updateTaskBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    projectId: { type: ['string', 'null'], maxLength: 500 },
    title: { type: 'string', minLength: 1, maxLength: 200 },
    type: { type: 'string', minLength: 1, maxLength: 80 },
    status: taskStatusSchema,
    contentMode: taskContentModeSchema,
    goal: { type: ['string', 'null'], maxLength: 4_000 },
    acceptanceCriteria: {
      type: ['array', 'null'],
      maxItems: 100,
      items: { type: 'string', minLength: 1, maxLength: 1_000 },
    },
    complexity: { type: ['string', 'null'], enum: [...TASK_COMPLEXITIES, null] },
  },
} as const;

export const createConfigurationBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['agent', 'sourceHash'],
  properties: {
    id: { type: 'string', maxLength: 500 },
    agent: { type: 'string', minLength: 1, maxLength: 80 },
    model: { type: 'string', maxLength: 200 },
    agentRulesVersion: { type: 'string', maxLength: 200 },
    toolPolicyVersion: { type: 'string', maxLength: 200 },
    promptTemplateVersion: { type: 'string', maxLength: 200 },
    sourceHash: { type: 'string', minLength: 1, maxLength: 256 },
  },
} as const;

export const attachSessionBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sessionId'],
  properties: {
    sessionId: { type: 'string', minLength: 1, maxLength: 500 },
    configSnapshotId: { type: 'string', maxLength: 500 },
    role: taskLinkRoleSchema,
    startedAt: { type: 'number' },
    finishedAt: { type: 'number' },
    provenance: provenanceSchema,
  },
} as const;

export const upsertOutcomeBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    buildStatus: verificationStatusSchema,
    testStatus: verificationStatusSchema,
    lintStatus: verificationStatusSchema,
    gitCommit: { type: ['string', 'null'], maxLength: 200 },
    humanRating: { type: ['number', 'null'], minimum: 1, maximum: 5 },
    reworkReason: { type: ['string', 'null'], maxLength: 2_000 },
    completedAt: { type: ['number', 'null'] },
    evidence: {
      type: 'array',
      maxItems: 50,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind'],
        properties: {
          kind: { type: 'string', minLength: 1, maxLength: 80 },
          status: {
            type: ['string', 'null'],
            enum: ['passed', 'failed', 'skipped', 'not_run', null],
          },
          reference: { type: 'string', maxLength: 500 },
          provenance: provenanceSchema,
        },
      },
    },
  },
} as const;

export const createCohortBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'definition'],
  properties: {
    id: { type: 'string', maxLength: 500 },
    title: { type: 'string', minLength: 1, maxLength: 200 },
    definition: { type: 'object' },
    status: cohortStatusSchema,
  },
} as const;

export const updateCohortBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 200 },
    definition: { type: 'object' },
    status: cohortStatusSchema,
  },
} as const;

export const createExperimentBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'cohortId', 'controlConfigId', 'candidateConfigId', 'primaryMetric'],
  properties: {
    id: { type: 'string', maxLength: 500 },
    title: { type: 'string', minLength: 1, maxLength: 200 },
    cohortId: { type: 'string', minLength: 1, maxLength: 500 },
    controlConfigId: { type: 'string', minLength: 1, maxLength: 500 },
    candidateConfigId: { type: 'string', minLength: 1, maxLength: 500 },
    primaryMetric: { type: 'string', minLength: 1, maxLength: 200 },
    guardrails: { type: 'array' },
    status: experimentStatusSchema,
    evidenceStatus: experimentEvidenceStatusSchema,
    decision: experimentDecisionSchema,
  },
} as const;

export const updateExperimentBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 200 },
    primaryMetric: { type: 'string', minLength: 1, maxLength: 100 },
    guardrails: { type: 'array' },
    status: experimentStatusSchema,
    evidenceStatus: experimentEvidenceStatusSchema,
    decision: experimentDecisionSchema,
  },
} as const;
