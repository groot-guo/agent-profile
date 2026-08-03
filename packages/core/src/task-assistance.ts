import type { TaskEvidenceProvenance, TaskOutcomeEvidence } from './task-profile';

export const TASK_ASSISTANCE_SCHEMA_VERSION = 'task-assistance/v1' as const;
export const TASK_ASSISTANCE_PRODUCER = 'agent-profile/local-task-assistance' as const;

export interface TaskSessionCandidate {
  suggestionId: string;
  sessionId: string;
  projectId: string;
  agent: string;
  startedAt: number;
  finishedAt: number | null;
  relation: 'same_project_time_window';
  provenance: TaskEvidenceProvenance;
}

export interface TaskGitCommitCandidate {
  suggestionId: string;
  hash: string;
  message: string;
  date: string;
  author: string;
  evidence: TaskOutcomeEvidence;
  provenance: TaskEvidenceProvenance;
}

export interface TaskAssistanceReport {
  schemaVersion: typeof TASK_ASSISTANCE_SCHEMA_VERSION;
  generatedAt: number;
  taskId: string;
  candidates: {
    sessions: TaskSessionCandidate[];
    gitCommits: TaskGitCommitCandidate[];
  };
  limitations: string[];
}
