import type { ParsedSession } from '@agent-profile/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../database';
import { importFromSource } from '../ingestion/import-coordinator';
import { SessionRepository } from '../ingestion/session-repository';
import type { SourceAdapter } from '../ingestion/types';
import { classifyProjectCwd, isProjectCwd, projectScopeDescriptor } from '../project-scope';

function parsedSession(id: string, cwd?: string): ParsedSession {
  return {
    sessionId: id,
    meta: {
      filePath: `fixture://${id}`,
      startTime: 1,
      cwd,
      agent: 'fixture',
      messageCount: 1,
    },
    spans: [],
  };
}

function source(sessions: Array<{ id: string; cwd?: string }>): SourceAdapter {
  return {
    kind: 'fixture',
    discover: async () =>
      sessions.map((session) => ({
        key: session.id,
        sessionId: session.id,
        revision: { kind: 'fixture', updatedAt: 1, fingerprint: `revision:${session.id}` },
        load: async () => ({ parsed: parsedSession(session.id, session.cwd) }),
      })),
  };
}

describe('project scope', () => {
  const databases: ReturnType<typeof createDatabase>[] = [];

  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
  });

  it('requires a path boundary and labels missing cwd as unassigned', () => {
    expect(isProjectCwd('/workspace/project/src', '/workspace/project')).toBe(true);
    expect(isProjectCwd('/workspace/project-archive', '/workspace/project')).toBe(false);
    expect(classifyProjectCwd(undefined, '/workspace/project')).toBe('unassigned');
    expect(classifyProjectCwd('/workspace/other', '/workspace/project')).toBe('excluded');
    expect(classifyProjectCwd('/workspace/project', null)).toBe('included');
    expect(projectScopeDescriptor('/workspace/project')).toEqual({
      mode: 'project',
      projectRoot: '/workspace/project',
      label: 'project',
    });
  });

  it('imports only sessions inside the selected project and reports coverage', async () => {
    const database = createDatabase(':memory:');
    databases.push(database);
    const repository = new SessionRepository(database, () => undefined);
    const result = await importFromSource(
      source([
        { id: 'inside', cwd: '/workspace/project/src' },
        { id: 'outside', cwd: '/workspace/other' },
        { id: 'unassigned' },
      ]),
      repository,
      { projectRoot: '/workspace/project' },
    );

    expect(result).toMatchObject({
      imported: 1,
      skipped: 2,
      projectCoverage: {
        projectRoot: '/workspace/project',
        discovered: 3,
        included: 1,
        excluded: 1,
        unassigned: 1,
      },
    });
    expect(database.prepare('SELECT id FROM sessions ORDER BY id').all()).toEqual([
      { id: 'inside' },
    ]);
  });

  it('resets only sessions inside the selected project', async () => {
    const database = createDatabase(':memory:');
    databases.push(database);
    const repository = new SessionRepository(database, () => undefined);
    await importFromSource(
      source([
        { id: 'inside', cwd: '/workspace/project/src' },
        { id: 'outside', cwd: '/workspace/other' },
      ]),
      repository,
    );

    expect(repository.resetGeneratedData('/workspace/project')).toEqual({
      sessions: 1,
      spans: 0,
      annotatedSessions: 0,
    });
    expect(database.prepare('SELECT id FROM sessions').all()).toEqual([{ id: 'outside' }]);
  });

  it('removes an unannotated in-scope row when its source cwd moves outside', async () => {
    const database = createDatabase(':memory:');
    databases.push(database);
    const repository = new SessionRepository(database, () => undefined);
    await importFromSource(source([{ id: 'moved', cwd: '/workspace/project/src' }]), repository);

    const result = await importFromSource(
      source([{ id: 'moved', cwd: '/workspace/other' }]),
      repository,
      { force: true, projectRoot: '/workspace/project' },
    );

    expect(result).toMatchObject({ removed: 1, skipped: 1, failed: 0 });
    expect(database.prepare('SELECT id FROM sessions').all()).toEqual([]);
  });
});
