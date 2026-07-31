import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, lookupPricing } from '../database';
import { SessionRepository } from '../ingestion/session-repository';
import { registerTaskRoutes } from '../routes/tasks';
import { TaskRepository } from '../task-repository';

describe('Task/Outcome foundations', () => {
  const databases: ReturnType<typeof createDatabase>[] = [];

  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
  });

  it('persists Task relationships and keeps missing Outcome fields distinct', () => {
    const database = createDatabase(':memory:');
    databases.push(database);
    seedSession(database, 'session-1');
    const repository = new TaskRepository(database);

    expect(() =>
      repository.createTask({
        title: 'Private goal',
        type: 'feature',
        goal: 'raw goal text',
      }),
    ).toThrowError('local_text_mode_required');

    const task = repository.createTask({
      title: 'Task one',
      type: 'feature',
      contentMode: 'local_text',
      goal: 'Implement the local feature',
      acceptanceCriteria: ['tests pass'],
    });
    const configuration = repository.createConfiguration({
      agent: 'codex',
      model: 'fixture-model',
      agentRulesVersion: 'rules-v1',
      sourceHash: 'sha256:fixture',
    });
    repository.attachSession(task.id, {
      sessionId: 'session-1',
      configSnapshotId: configuration.id,
      role: 'primary',
    });
    expect(() => repository.attachSession(task.id, { sessionId: 'session-1' })).toThrowError(
      'task_session_exists',
    );

    const missing = repository.buildProfile(task.id);
    expect(missing.outcome).toBeNull();
    expect(missing.coverage.outcome.status).toBe('not_collected');

    repository.upsertOutcome(task.id, { testStatus: 'failed', evidence: [{ kind: 'test' }] });
    const profile = repository.buildProfile(task.id);
    expect(profile.outcome?.testStatus).toBe('failed');
    expect(profile.coverage.outcome.status).toBe('partial');
    expect(profile.profile).toMatchObject({
      linkedSessions: 1,
      availableSessions: 1,
      totalTokens: 19,
      toolCalls: 1,
      toolErrors: 1,
    });
  });

  it('retains Task/Outcome/configuration links across generated-data reset', () => {
    const database = createDatabase(':memory:');
    databases.push(database);
    seedSession(database, 'session-reset');
    const repository = new TaskRepository(database);
    const sessionRepository = new SessionRepository(database, (model, at) =>
      lookupPricing(database, model, at),
    );
    const task = repository.createTask({ title: 'Reset retention', type: 'maintenance' });
    const configuration = repository.createConfiguration({
      agent: 'opencode',
      sourceHash: 'sha256:reset',
    });
    repository.attachSession(task.id, {
      sessionId: 'session-reset',
      configSnapshotId: configuration.id,
    });
    repository.upsertOutcome(task.id, { buildStatus: 'passed' });

    expect(sessionRepository.resetGeneratedData()).toMatchObject({ sessions: 1, spans: 1 });
    expect(repository.requireTask(task.id).title).toBe('Reset retention');
    expect(repository.getOutcome(task.id)?.buildStatus).toBe('passed');
    expect(repository.listConfigurations()).toHaveLength(1);
    expect(repository.listTaskSessions(task.id)[0]).toMatchObject({
      sessionId: 'session-reset',
      available: false,
      configSnapshotId: configuration.id,
    });
    expect(repository.buildProfile(task.id).coverage.sessions.ratio).toBe(0);
  });

  it('persists every Outcome field and rejects malformed structured evidence', async () => {
    const database = createDatabase(':memory:');
    databases.push(database);
    const repository = new TaskRepository(database);
    const task = repository.createTask({ title: 'Complete Outcome', type: 'feature' });
    const completedAt = 1_785_496_245_123;

    repository.upsertOutcome(task.id, {
      buildStatus: 'passed',
      testStatus: 'failed',
      lintStatus: 'skipped',
      gitCommit: 'abc123',
      humanRating: 4,
      reworkReason: 'A test needs follow-up',
      completedAt,
      evidence: [{ kind: 'ci', status: 'failed', reference: 'local://run/1' }],
    });

    expect(repository.getOutcome(task.id)).toEqual({
      buildStatus: 'passed',
      testStatus: 'failed',
      lintStatus: 'skipped',
      gitCommit: 'abc123',
      humanRating: 4,
      reworkReason: 'A test needs follow-up',
      completedAt,
      evidence: [{ kind: 'ci', status: 'failed', reference: 'local://run/1' }],
    });
    expect(repository.buildProfile(task.id).coverage.outcome).toEqual({
      status: 'verified',
      observedFields: 5,
      totalFields: 5,
    });

    const app = Fastify();
    registerTaskRoutes(app, { database });
    for (const payload of [
      { evidence: {} },
      { evidence: [{ kind: 7 }] },
      { evidence: [{ kind: 'ci', status: 'unknown' }] },
      { evidence: [{ kind: 'ci', status: { toString: null } }] },
      { completedAt: 'not-a-timestamp' },
      { evidence: Array.from({ length: 51 }, () => ({ kind: 'ci' })) },
    ]) {
      const response = await app.inject({
        method: 'PUT',
        url: `/api/tasks/${task.id}/outcome`,
        payload,
      });
      expect(response.statusCode).toBe(400);
    }
    expect(() => repository.upsertOutcome(task.id, { completedAt: Number.NaN })).toThrowError(
      'invalid_completed_at',
    );
    await app.close();
  });

  it('exposes bounded APIs and prevents an evidence-free causal experiment decision', async () => {
    const database = createDatabase(':memory:');
    databases.push(database);
    seedSession(database, 'session-api');
    const app = Fastify();
    registerTaskRoutes(app, {
      database,
    });

    const rejected = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { title: 'Task', type: 'feature', goal: 'not explicitly enabled' },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toEqual({ error: 'local_text_mode_required' });

    const task = (
      await app.inject({
        method: 'POST',
        url: '/api/tasks',
        payload: { title: 'API task', type: 'feature' },
      })
    ).json();
    const control = (
      await app.inject({
        method: 'POST',
        url: '/api/config-snapshots',
        payload: { agent: 'codex', sourceHash: 'control-hash' },
      })
    ).json();
    const candidate = (
      await app.inject({
        method: 'POST',
        url: '/api/config-snapshots',
        payload: { agent: 'codex', sourceHash: 'candidate-hash' },
      })
    ).json();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/tasks/${task.id}/sessions`,
          payload: { sessionId: 'session-api', configSnapshotId: candidate.id },
        })
      ).statusCode,
    ).toBe(201);

    const cohort = (
      await app.inject({
        method: 'POST',
        url: '/api/cohorts',
        payload: { title: 'Feature cohort', definition: { type: 'feature' } },
      })
    ).json();
    const invalidExperiment = await app.inject({
      method: 'POST',
      url: '/api/experiments',
      payload: {
        title: 'Unsafe conclusion',
        cohortId: cohort.id,
        controlConfigId: control.id,
        candidateConfigId: candidate.id,
        primaryMetric: 'test_pass_rate',
        guardrails: ['cost'],
        evidenceStatus: 'insufficient_evidence',
        decision: 'keep',
      },
    });
    expect(invalidExperiment.statusCode).toBe(400);

    const experiment = await app.inject({
      method: 'POST',
      url: '/api/experiments',
      payload: {
        title: 'Controlled comparison',
        cohortId: cohort.id,
        controlConfigId: control.id,
        candidateConfigId: candidate.id,
        primaryMetric: 'test_pass_rate',
        guardrails: ['cost'],
        evidenceStatus: 'insufficient_evidence',
        decision: 'insufficient_evidence',
      },
    });
    expect(experiment.statusCode).toBe(201);
    expect(experiment.json()).toMatchObject({ decision: 'insufficient_evidence' });

    const completedExperiment = await app.inject({
      method: 'PATCH',
      url: `/api/experiments/${experiment.json().id}`,
      payload: { status: 'completed', evidenceStatus: 'ready', decision: 'keep' },
    });
    expect(completedExperiment.statusCode).toBe(200);
    expect(completedExperiment.json()).toMatchObject({
      status: 'completed',
      evidenceStatus: 'ready',
      decision: 'keep',
    });

    const profile = await app.inject({ method: 'GET', url: `/api/tasks/${task.id}/profile` });
    expect(profile.statusCode).toBe(200);
    expect(profile.json()).toMatchObject({
      schemaVersion: 'task-profile/v1',
      comparison: { status: 'definition_only' },
    });
    await app.close();
  });
});

function seedSession(database: ReturnType<typeof createDatabase>, id: string) {
  database
    .prepare(
      `INSERT INTO sessions (
        id, file_path, agent, start_time, end_time, input_tokens,
        cache_creation_tokens, cache_read_tokens, output_tokens, total_cost,
        cost_unknown_count, peak_context_tokens, cache_hit_rate, imported_at
      ) VALUES (?, ?, 'codex', 100, 250, 10, 2, 3, 4, 1.5, 0, 15, 0.2, 300)`,
    )
    .run(id, `/tmp/${id}.jsonl`);
  database
    .prepare(
      `INSERT INTO spans (
        id, session_id, type, name, start_time, end_time, is_error
      ) VALUES (?, ?, 'tool_call', 'Bash', 120, 130, 1)`,
    )
    .run(`${id}:tool`, id);
}
