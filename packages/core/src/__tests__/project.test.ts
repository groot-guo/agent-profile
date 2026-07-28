import { describe, expect, it } from 'vitest';
import {
  CODEX_SESSION_RECORDS_PROJECT,
  classifySessionProject,
  isSessionRecordsProject,
  sessionRecordsProjectAgent,
} from '../project';

describe('Session project classification', () => {
  it('keeps captured cwd authoritative', () => {
    expect(
      classifySessionProject({
        agent: 'codex',
        cwd: '/workspace/agent-profile',
        filePath: '/Users/example/.codex/sessions/2026/07/28/rollout.jsonl',
      }),
    ).toBe('/workspace/agent-profile');
  });

  it('classifies dated Codex storage without cwd as Codex Session records', () => {
    const project = classifySessionProject({
      agent: 'codex',
      filePath: '/Users/example/.codex/sessions/2026/07/28/rollout.jsonl',
    });

    expect(project).toBe(CODEX_SESSION_RECORDS_PROJECT);
    expect(project).not.toContain('/28');
    expect(isSessionRecordsProject(project)).toBe(true);
    expect(sessionRecordsProjectAgent(project)).toBe('codex');
  });

  it('classifies a non-empty Codex-managed dated workspace as Session records', () => {
    expect(
      classifySessionProject({
        agent: 'codex',
        cwd: '/Users/example/Documents/Codex/2026-07-28/new-chat',
        filePath: '/Users/example/.codex/sessions/2026/07/28/rollout.jsonl',
      }),
    ).toBe(CODEX_SESSION_RECORDS_PROJECT);
  });

  it('does not collapse an ordinary Codex project elsewhere under Documents', () => {
    expect(
      classifySessionProject({
        agent: 'codex',
        cwd: '/Users/example/Documents/Codex/projects/real-repository',
      }),
    ).toBe('/Users/example/Documents/Codex/projects/real-repository');
  });

  it('retains only the explicit Claude projects-path fallback', () => {
    expect(
      classifySessionProject({
        agent: 'claude-code',
        filePath: '/Users/example/.claude/projects/-Users-example-repo/session.jsonl',
      }),
    ).toBe('/Users/example/repo');

    expect(
      classifySessionProject({
        agent: 'claude-code',
        filePath: '/Users/example/transcripts/arbitrary-parent/session.jsonl',
      }),
    ).toBe('agent-profile:session-records:claude-code');
  });
});
