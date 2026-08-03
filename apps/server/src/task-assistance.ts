import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  TASK_ASSISTANCE_PRODUCER,
  TASK_ASSISTANCE_SCHEMA_VERSION,
  type TaskAssistanceReport,
  type TaskEvidenceProvenance,
  type TaskGitCommitCandidate,
  type TaskSessionCandidate,
} from '@agent-profile/core';
import type { DatabaseConnection } from './database';
import { primarySessionPredicate } from './primary-sessions';
import type { TaskRecord } from './task-repository';

const execFileAsync = promisify(execFile);
const TASK_ASSISTANCE_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_SESSION_CANDIDATES = 20;
const MAX_GIT_CANDIDATES = 20;
const MAX_GIT_REPOSITORIES = 3;

interface CandidateSessionRow {
  id: string;
  projectId: string;
  agent: string;
  startTime: number;
  endTime: number | null;
  cwd: string | null;
}

interface GitCommitRow {
  hash: string;
  message: string;
  date: string;
  author: string;
}

export async function buildTaskAssistanceReport(
  database: DatabaseConnection,
  task: Pick<TaskRecord, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>,
  now = Date.now(),
): Promise<TaskAssistanceReport> {
  const generatedAt = now;
  const sessionRows = findCandidateSessions(database, task, generatedAt);
  const sessions = sessionRows.map((row) => taskSessionCandidate(row, generatedAt));
  const git = await findCandidateCommits(sessionRows, task, generatedAt);
  const limitations = [
    'Candidates use the same project key and a bounded local time window; they are not proof of Task membership.',
    'Accept each Session link and each Git evidence item separately; no suggestion changes a Task automatically.',
    'A Git candidate is a local reference only and never marks build, test, lint, or Outcome success.',
  ];
  if (!task.projectId) {
    limitations.push('Task has no project key, so no project-correlated candidates were proposed.');
  }
  if (git.failedRepositories > 0) {
    limitations.push(`${git.failedRepositories} local Git repository lookup(s) were unavailable.`);
  }
  return {
    schemaVersion: TASK_ASSISTANCE_SCHEMA_VERSION,
    generatedAt,
    taskId: task.id,
    candidates: { sessions, gitCommits: git.candidates },
    limitations,
  };
}

function findCandidateSessions(
  database: DatabaseConnection,
  task: Pick<TaskRecord, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>,
  now: number,
): CandidateSessionRow[] {
  if (!task.projectId) return [];
  const from = Math.max(0, task.createdAt - TASK_ASSISTANCE_WINDOW_MS);
  const to = Math.max(task.updatedAt, now);
  const rows = database
    .prepare(
      `SELECT s.id, s.project_key AS projectId, s.agent, s.start_time AS startTime,
        s.end_time AS endTime, s.cwd
       FROM sessions s
       WHERE ${primarySessionPredicate('s')}
         AND s.project_key = ?
         AND s.start_time >= ?
         AND s.start_time <= ?
         AND NOT EXISTS (
           SELECT 1 FROM task_sessions ts
           WHERE ts.task_id = ? AND ts.session_id = s.id
         )
       ORDER BY s.start_time DESC, s.id DESC
       LIMIT ?`,
    )
    .all(task.projectId, from, to, task.id, MAX_SESSION_CANDIDATES + 1) as CandidateSessionRow[];
  return rows.slice(0, MAX_SESSION_CANDIDATES);
}

async function findCandidateCommits(
  sessions: CandidateSessionRow[],
  task: Pick<TaskRecord, 'createdAt' | 'updatedAt'>,
  now: number,
): Promise<{ candidates: TaskGitCommitCandidate[]; failedRepositories: number }> {
  const repositories = [...new Set(sessions.map((session) => session.cwd).filter(Boolean))].slice(
    0,
    MAX_GIT_REPOSITORIES,
  ) as string[];
  const from = Math.max(0, task.createdAt - TASK_ASSISTANCE_WINDOW_MS);
  const to = Math.max(task.updatedAt, now);
  const candidates: TaskGitCommitCandidate[] = [];
  let failedRepositories = 0;
  for (const cwd of repositories) {
    const result = await readGitCommits(cwd, from, to);
    if (!result.ok) {
      failedRepositories += 1;
      continue;
    }
    for (const commit of result.commits) {
      if (candidates.some((candidate) => candidate.hash === commit.hash)) continue;
      const provenance: TaskEvidenceProvenance = {
        producer: TASK_ASSISTANCE_PRODUCER,
        capturedAt: now,
        source: 'local_git',
        sourceId: commit.hash,
        basis: 'local_git_time_window',
      };
      candidates.push({
        suggestionId: `git:${commit.hash}`,
        ...commit,
        evidence: {
          kind: 'git_commit',
          reference: `local://git/${commit.hash}`,
          provenance,
        },
        provenance,
      });
      if (candidates.length >= MAX_GIT_CANDIDATES) return { candidates, failedRepositories };
    }
  }
  return { candidates, failedRepositories };
}

async function readGitCommits(
  cwd: string,
  from: number,
  to: number,
): Promise<{ ok: true; commits: GitCommitRow[] } | { ok: false }> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      [
        '-C',
        cwd,
        'log',
        '--format=%H%x1f%s%x1f%aI%x1f%an%x1e',
        `--after=${new Date(from).toISOString()}`,
        `--before=${new Date(to).toISOString()}`,
        '--no-merges',
        '--max-count=20',
      ],
      { encoding: 'utf8', timeout: 5_000, maxBuffer: 1_048_576 },
    );
    return { ok: true, commits: parseGitCommits(String(stdout)) };
  } catch {
    return { ok: false };
  }
}

function parseGitCommits(stdout: string): GitCommitRow[] {
  return stdout
    .split('\x1e')
    .filter(Boolean)
    .flatMap((record) => {
      const [hash, message, date, author] = record.split('\x1f');
      if (!hash || !message || !date || !author) return [];
      return [{ hash, message: message.slice(0, 200), date, author: author.slice(0, 120) }];
    });
}

function taskSessionCandidate(row: CandidateSessionRow, capturedAt: number): TaskSessionCandidate {
  const provenance: TaskEvidenceProvenance = {
    producer: TASK_ASSISTANCE_PRODUCER,
    capturedAt,
    source: 'local_session',
    sourceId: row.id,
    basis: 'same_project_time_window',
  };
  return {
    suggestionId: `session:${row.id}`,
    sessionId: row.id,
    projectId: row.projectId,
    agent: row.agent,
    startedAt: row.startTime,
    finishedAt: row.endTime,
    relation: 'same_project_time_window',
    provenance,
  };
}
