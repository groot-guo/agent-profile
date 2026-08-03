import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectLocalGitOutcomeEvidence } from '../local-git-outcome-adapter';

const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

describe('local Git Outcome evidence adapter', () => {
  it('returns bounded observed metadata without executing verification commands', async () => {
    const fixture = createGitFixture();
    const report = await collectLocalGitOutcomeEvidence('task-1', fixture, 1_800_000_000_000);

    expect(report).toMatchObject({
      schemaVersion: 'outcome-evidence/v1',
      taskId: 'task-1',
      source: 'local_git',
      producer: 'agent-profile/local-git-outcome-adapter',
      captureLimits: { maxRecords: 2, content: 'metadata_only' },
    });
    expect(report.records).toHaveLength(2);
    expect(report.records.map((record) => record.status)).toEqual(['observed', 'observed']);
    expect(report.records[0]?.provenance).toMatchObject({
      source: 'local_git',
      sourceId: expect.stringMatching(/^[0-9a-f]+$/),
      capturedAt: 1_800_000_000_000,
    });
    expect(JSON.stringify(report)).not.toContain(fixture);
    expect(report.limitations.join(' ')).toContain('does not execute build, test, or lint');
  });

  it('distinguishes unavailable Git from an observed result', async () => {
    const report = await collectLocalGitOutcomeEvidence('task-2', '/definitely/not/a/repository');

    expect(report.records).toEqual([
      expect.objectContaining({ kind: 'git_worktree', status: 'not_captured' }),
    ]);
    expect(report.limitations.join(' ')).toContain('Git HEAD unavailable');
  });

  it('keeps missing source explicit without creating a verification result', async () => {
    const report = await collectLocalGitOutcomeEvidence('task-3', undefined);

    expect(report.records[0]).toMatchObject({ kind: 'git_worktree', status: 'not_captured' });
    expect(report.records[0]?.reference).toBeUndefined();
    expect(report.limitations.join(' ')).toContain('Git cwd unavailable');
  });
});

function createGitFixture(): string {
  const fixture = mkdtempSync(join(tmpdir(), 'agent-profile-outcome-evidence-'));
  fixtures.push(fixture);
  execFileSync('git', ['-C', fixture, 'init', '-q']);
  execFileSync('git', ['-C', fixture, 'config', 'user.email', 'fixture@example.test']);
  execFileSync('git', ['-C', fixture, 'config', 'user.name', 'Fixture']);
  writeFileSync(join(fixture, 'file.txt'), 'fixture\n');
  execFileSync('git', ['-C', fixture, 'add', 'file.txt']);
  execFileSync('git', ['-C', fixture, 'commit', '-m', 'adapter fixture']);
  return fixture;
}
