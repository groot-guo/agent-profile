import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  OUTCOME_EVIDENCE_SCHEMA_VERSION,
  type OutcomeEvidenceAdapterReport,
  type TaskEvidenceProvenance,
  type TaskOutcomeEvidence,
} from '@agent-profile/core';

const execFileAsync = promisify(execFile);
const PRODUCER = 'agent-profile/local-git-outcome-adapter';
const MAX_RECORDS = 2;
const MAX_REFERENCE_CHARACTERS = 500;

export async function collectLocalGitOutcomeEvidence(
  taskId: string,
  cwd: string | undefined,
  capturedAt = Date.now(),
): Promise<OutcomeEvidenceAdapterReport> {
  const limitations = [
    'This adapter reads Git metadata only; it does not execute build, test, or lint commands.',
    'Observed Git metadata is not a passing verification result and does not establish delivery quality.',
    'The response omits repository paths, commit messages, file names, and worktree contents.',
  ];
  if (!cwd) {
    return report(
      taskId,
      capturedAt,
      [notCapturedRecord(capturedAt)],
      limitations,
      'Git cwd unavailable.',
    );
  }

  const head = await runGit(cwd, ['rev-parse', 'HEAD']);
  const status = await runGit(cwd, ['status', '--porcelain=v1', '--untracked-files=no']);
  if (!head.ok || !isCommitHash(head.stdout)) {
    return report(
      taskId,
      capturedAt,
      [notCapturedRecord(capturedAt)],
      limitations,
      'Git HEAD unavailable.',
    );
  }
  const provenance = buildProvenance(capturedAt, head.stdout.trim(), 'git_worktree_snapshot');
  const records: TaskOutcomeEvidence[] = [
    {
      kind: 'git_commit',
      status: 'observed',
      reference: `local://git/${head.stdout.trim()}`,
      provenance,
    },
  ];
  if (status.ok) {
    records.push({
      kind: 'git_worktree',
      status: 'observed',
      reference: `local://git/worktree/${head.stdout.trim()}`,
      provenance: buildProvenance(capturedAt, head.stdout.trim(), 'git_worktree_snapshot'),
    });
  } else {
    limitations.push('Git worktree status was not captured.');
  }
  return report(taskId, capturedAt, records, limitations);
}

function report(
  taskId: string,
  capturedAt: number,
  records: TaskOutcomeEvidence[],
  limitations: string[],
  extra?: string,
): OutcomeEvidenceAdapterReport {
  return {
    schemaVersion: OUTCOME_EVIDENCE_SCHEMA_VERSION,
    taskId,
    producer: PRODUCER,
    capturedAt,
    source: 'local_git',
    records,
    captureLimits: {
      maxRecords: MAX_RECORDS,
      maxReferenceCharacters: MAX_REFERENCE_CHARACTERS,
      content: 'metadata_only',
    },
    limitations: extra ? [...limitations, extra] : limitations,
  };
}

function notCapturedRecord(capturedAt: number): TaskOutcomeEvidence {
  return {
    kind: 'git_worktree',
    status: 'not_captured',
    provenance: buildProvenance(capturedAt, 'git:unavailable', 'git_worktree_snapshot'),
  };
}

function buildProvenance(
  capturedAt: number,
  sourceId: string,
  basis: string,
): TaskEvidenceProvenance {
  return {
    producer: PRODUCER,
    capturedAt,
    source: 'local_git',
    sourceId,
    basis,
  };
}

async function runGit(
  cwd: string,
  args: string[],
): Promise<{ ok: true; stdout: string } | { ok: false }> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      timeout: 3_000,
      maxBuffer: 32 * 1_024,
    });
    return { ok: true, stdout: String(stdout) };
  } catch {
    return { ok: false };
  }
}

function isCommitHash(value: string): boolean {
  return /^[0-9a-f]{7,128}$/i.test(value.trim());
}
