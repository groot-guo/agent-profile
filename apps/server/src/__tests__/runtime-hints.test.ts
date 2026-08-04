import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../database';
import { registerRuntimeHintRoutes } from '../routes/runtime-hints';
import { appendRuntimeEventBatch } from '../runtime-event-collector';
import { TaskRepository } from '../task-repository';

const databases: DatabaseConnection[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('runtime hint routes', () => {
  it('requires opt-in and suppresses unobserved runs', async () => {
    const database = createDatabase(':memory:');
    databases.push(database);
    const app = Fastify({ logger: false });
    registerRuntimeHintRoutes(app, { database, clock: () => 1_800_000_000_000 });

    const missingOptIn = await app.inject({
      method: 'GET',
      url: '/api/runtime/runs/run-missing/hint',
    });
    expect(missingOptIn.statusCode).toBe(400);
    expect(missingOptIn.json()).toEqual({ error: 'runtime_hint_opt_in_required' });

    const suppressed = await app.inject({
      method: 'GET',
      url: '/api/runtime/runs/run-missing/hint?optIn=true',
    });
    expect(suppressed.statusCode).toBe(200);
    expect(suppressed.json()).toMatchObject({
      schemaVersion: 'runtime-hint/v1',
      status: 'suppressed',
      suppression: { reason: 'run_not_observed' },
    });
    await app.close();
  });

  it('issues a bounded hint from ready history and records explicit adoption', async () => {
    const database = createDatabase(':memory:');
    databases.push(database);
    const repository = new TaskRepository(database);
    createComparisonFixture(repository, database);
    insertRuntimeEvents(database);
    const app = Fastify({ logger: false });
    registerRuntimeHintRoutes(app, { database, clock: () => 1_800_000_000_100 });

    const hint = await app.inject({
      method: 'GET',
      url: '/api/runtime/runs/run-1/hint?optIn=true',
    });
    expect(hint.statusCode).toBe(200);
    const report = hint.json();
    expect(report).toMatchObject({
      schemaVersion: 'runtime-hint/v1',
      status: 'available',
      hint: {
        category: 'repeated_tool_failure',
        evidence: {
          eventIds: ['event-1', 'event-2'],
          historical: { experimentId: 'experiment-1', cohortId: 'cohort-1' },
        },
      },
    });
    expect(hint.body).not.toContain('private-command');

    const adoption = await app.inject({
      method: 'POST',
      url: `/api/runtime/hints/${report.hint.id}/adoption`,
      payload: {
        schemaVersion: 'runtime-hint-adoption/v1',
        status: 'ignored',
        producer: 'local-agent-test',
      },
    });
    expect(adoption.statusCode).toBe(201);
    expect(adoption.json()).toMatchObject({
      schemaVersion: 'runtime-hint-adoption/v1',
      hintId: report.hint.id,
      status: 'ignored',
      taskId: 'task-candidate-0',
      runId: 'run-1',
      evidence: { eventIds: ['event-1', 'event-2'] },
    });
    expect(
      database
        .prepare('SELECT status FROM runtime_hint_adoptions WHERE hint_id = ?')
        .get(report.hint.id),
    ).toEqual({ status: 'ignored' });
    await app.close();
  });

  it('does not reissue an active hint before its expiry', async () => {
    const database = createDatabase(':memory:');
    databases.push(database);
    const repository = new TaskRepository(database);
    createComparisonFixture(repository, database);
    insertRuntimeEvents(database);
    let now = 1_800_000_000_100;
    const app = Fastify({ logger: false });
    registerRuntimeHintRoutes(app, { database, clock: () => now });

    const first = await app.inject({
      method: 'GET',
      url: '/api/runtime/runs/run-1/hint?optIn=true',
    });
    expect(first.json()).toMatchObject({ status: 'available' });

    now += 30_000;
    const beforeExpiry = await app.inject({
      method: 'GET',
      url: '/api/runtime/runs/run-1/hint?optIn=true',
    });
    expect(beforeExpiry.json()).toMatchObject({
      status: 'suppressed',
      suppression: { reason: 'rate_limited' },
    });

    now += 30_000;
    const afterExpiry = await app.inject({
      method: 'GET',
      url: '/api/runtime/runs/run-1/hint?optIn=true',
    });
    expect(afterExpiry.json()).toMatchObject({ status: 'available' });
    await app.close();
  });

  it('suppresses a hint when a prior event batch was rejected', async () => {
    const database = createDatabase(':memory:');
    databases.push(database);
    const repository = new TaskRepository(database);
    createComparisonFixture(repository, database);
    insertRuntimeEvents(database);
    appendRuntimeEventBatch(database, {
      schemaVersion: 'runtime-event-batch/v1',
      events: [
        {
          schemaVersion: 'runtime-event/v1',
          eventId: 'event-rejected',
          taskId: 'task-candidate-0',
          runId: 'run-1',
          sequence: 1,
          capturedAt: 1_800_000_000_070,
          kind: 'tool_result',
          payload: { isError: true, configurationSnapshotId: 'config-candidate' },
        },
      ],
      coverageComplete: true,
    });
    const app = Fastify({ logger: false });
    registerRuntimeHintRoutes(app, { database, clock: () => 1_800_000_000_100 });

    const response = await app.inject({
      method: 'GET',
      url: '/api/runtime/runs/run-1/hint?optIn=true',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'suppressed',
      suppression: { reason: 'partial_event_coverage' },
      coverage: { status: 'partial' },
    });
    await app.close();
  });

  it('suppresses hints when event coverage predates the coverage migration', async () => {
    const database = createDatabase(':memory:');
    databases.push(database);
    const repository = new TaskRepository(database);
    createComparisonFixture(repository, database);
    insertRuntimeEvents(database);
    database.prepare('DELETE FROM runtime_event_coverage WHERE run_id = ?').run('run-1');
    const app = Fastify({ logger: false });
    registerRuntimeHintRoutes(app, { database, clock: () => 1_800_000_000_100 });

    const response = await app.inject({
      method: 'GET',
      url: '/api/runtime/runs/run-1/hint?optIn=true',
    });
    expect(response.json()).toMatchObject({
      status: 'suppressed',
      suppression: { reason: 'partial_event_coverage' },
      coverage: { status: 'partial' },
    });
    await app.close();
  });

  it('keeps legacy coverage unknown after a later event append', () => {
    const database = createDatabase(':memory:');
    databases.push(database);
    database
      .prepare(
        `INSERT INTO runtime_events (
           event_id, task_id, run_id, sequence, captured_at, kind,
           parent_event_id, payload_json, received_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'legacy-event',
        'task-candidate-0',
        'legacy-run',
        1,
        1_800_000_000_000,
        'tool_result',
        null,
        JSON.stringify({ isError: true }),
        1_800_000_000_001,
      );
    database.prepare('DELETE FROM runtime_event_coverage WHERE run_id = ?').run('legacy-run');

    appendRuntimeEventBatch(database, {
      schemaVersion: 'runtime-event-batch/v1',
      events: [
        {
          schemaVersion: 'runtime-event/v1',
          eventId: 'new-event',
          taskId: 'task-candidate-0',
          runId: 'legacy-run',
          sequence: 2,
          capturedAt: 1_800_000_000_050,
          kind: 'tool_result',
          payload: { isError: true },
        },
      ],
    });

    const coverage = database
      .prepare(
        'SELECT coverage_known as coverageKnown FROM runtime_event_coverage WHERE run_id = ?',
      )
      .get('legacy-run');
    expect(coverage).toEqual({ coverageKnown: 0 });
  });

  it('uses only historical evidence that belongs to the current Task', () => {
    const database = createDatabase(':memory:');
    databases.push(database);
    const repository = new TaskRepository(database);
    createComparisonFixture(repository, database);
    repository.createCohort({
      id: 'cohort-2',
      title: 'Second cohort',
      definition: { projectId: 'project-2', type: 'maintenance' },
    });
    repository.createExperiment({
      id: 'experiment-2',
      title: 'Second experiment',
      cohortId: 'cohort-2',
      controlConfigId: 'config-control',
      candidateConfigId: 'config-candidate',
      primaryMetric: 'duration_ms',
      guardrails: [{ metric: 'duration_ms', maxRelativeRegression: 0.5 }],
      status: 'completed',
      evidenceStatus: 'ready',
      decision: 'keep',
    });
    for (let index = 0; index < 6; index++) {
      const taskId = `task-second-${index}`;
      const sessionId = `session-second-${index}`;
      const configuration = index < 3 ? 'config-control' : 'config-candidate';
      repository.createTask({
        id: taskId,
        title: `Second ${taskId}`,
        type: 'maintenance',
        projectId: 'project-2',
      });
      repository.upsertOutcome(taskId, {
        buildStatus: 'passed',
        testStatus: 'passed',
        lintStatus: 'passed',
        gitCommit: `second-commit-${index}`,
        humanRating: 4,
        completedAt: 1_799_999_100_000 + index,
      });
      database
        .prepare(
          `INSERT INTO sessions (
             id, file_path, agent, start_time, end_time, total_cost, cost_unknown_count
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          sessionId,
          `fixture://${sessionId}`,
          'codex',
          1_799_999_100_000 + index,
          1_799_999_100_100 + index,
          1,
          0,
        );
      repository.attachSession(taskId, { sessionId, configSnapshotId: configuration });
    }

    expect(
      repository.findRuntimeHintHistoricalEvidence('task-second-3', 'config-candidate'),
    ).toMatchObject({ experimentId: 'experiment-2', cohortId: 'cohort-2' });
  });
});

function createComparisonFixture(repository: TaskRepository, database: DatabaseConnection): void {
  repository.createConfiguration({
    id: 'config-control',
    agent: 'codex',
    sourceHash: 'hash-control',
  });
  repository.createConfiguration({
    id: 'config-candidate',
    agent: 'codex',
    sourceHash: 'hash-candidate',
  });
  repository.createCohort({
    id: 'cohort-1',
    title: 'Fixture cohort',
    definition: { type: 'feature' },
  });
  repository.createExperiment({
    id: 'experiment-1',
    title: 'Fixture experiment',
    cohortId: 'cohort-1',
    controlConfigId: 'config-control',
    candidateConfigId: 'config-candidate',
    primaryMetric: 'duration_ms',
    guardrails: [{ metric: 'duration_ms', maxRelativeRegression: 0.5 }],
    status: 'completed',
    evidenceStatus: 'ready',
    decision: 'keep',
  });
  for (const [index, configuration] of [
    'config-control',
    'config-control',
    'config-control',
    'config-candidate',
    'config-candidate',
    'config-candidate',
  ].entries()) {
    const taskId = index < 3 ? `task-control-${index}` : `task-candidate-${index - 3}`;
    const sessionId = `session-${index}`;
    repository.createTask({ id: taskId, title: `Fixture ${taskId}`, type: 'feature' });
    repository.upsertOutcome(taskId, {
      buildStatus: 'passed',
      testStatus: 'passed',
      lintStatus: 'passed',
      gitCommit: `commit-${index}`,
      humanRating: 4,
      completedAt: 1_799_999_000_000 + index,
    });
    database
      .prepare(
        `INSERT INTO sessions (
           id, file_path, agent, start_time, end_time, total_cost, cost_unknown_count
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sessionId,
        `fixture://${sessionId}`,
        'codex',
        1_799_999_000_000 + index,
        1_799_999_000_100 + index,
        1,
        0,
      );
    repository.attachSession(taskId, { sessionId, configSnapshotId: configuration });
  }
}

function insertRuntimeEvents(database: DatabaseConnection): void {
  const insert = database.prepare(
    `INSERT INTO runtime_events (
       event_id, task_id, run_id, sequence, captured_at, kind,
       parent_event_id, payload_json, received_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insert.run(
    'event-1',
    'task-candidate-0',
    'run-1',
    1,
    1_800_000_000_000,
    'tool_result',
    null,
    JSON.stringify({ isError: true, configurationSnapshotId: 'config-candidate' }),
    1_800_000_000_001,
  );
  insert.run(
    'event-2',
    'task-candidate-0',
    'run-1',
    2,
    1_800_000_000_050,
    'tool_result',
    null,
    JSON.stringify({ status: 'failed', configurationSnapshotId: 'config-candidate' }),
    1_800_000_000_051,
  );
  database
    .prepare(
      `INSERT INTO runtime_event_coverage (
         run_id, task_id, submitted_events, observed_events, rejected_events, coverage_known, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run('run-1', 'task-candidate-0', 2, 2, 0, 1, 1_800_000_000_051);
}
