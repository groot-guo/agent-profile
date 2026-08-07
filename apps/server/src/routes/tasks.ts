import { isAbsolute } from 'node:path';
import {
  type AttachSessionBody,
  attachSessionBodySchema,
  type CreateCohortBody,
  type CreateConfigurationBody,
  type CreateExperimentBody,
  type CreateTaskBody,
  createCohortBodySchema,
  createConfigurationBodySchema,
  createExperimentBodySchema,
  createTaskBodySchema,
  type UpdateCohortBody,
  type UpdateExperimentBody,
  type UpdateTaskBody,
  type UpsertOutcomeBody,
  updateCohortBodySchema,
  updateExperimentBodySchema,
  updateTaskBodySchema,
  upsertOutcomeBodySchema,
} from '@agent-profile/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { collectLocalGitOutcomeEvidence } from '../local-git-outcome-adapter';
import { getTaskProfileReport } from '../reports-service';
import type { AppRuntime } from '../runtime';
import { buildTaskAssistanceReport } from '../task-assistance';
import { TaskRepository } from '../task-repository';
import { TaskModelError } from '../task-validation';

type TaskRuntime = Pick<AppRuntime, 'database'>;

export function registerTaskRoutes(app: FastifyInstance, runtime: TaskRuntime) {
  const { database } = runtime;
  const repository = new TaskRepository(database);

  app.get('/api/tasks', async () => ({ tasks: repository.listTasks() }));

  app.post<{ Body: CreateTaskBody }>(
    '/api/tasks',
    { schema: { body: createTaskBodySchema } },
    async (request, reply) => respond(reply, 201, () => repository.createTask(request.body)),
  );

  app.get<{ Params: { id: string } }>('/api/tasks/:id', async (request, reply) =>
    respond(reply, 200, () => ({
      task: repository.requireTask(request.params.id),
      sessions: repository.listTaskSessions(request.params.id),
      outcome: repository.getOutcome(request.params.id),
    })),
  );

  app.get<{ Params: { id: string } }>('/api/tasks/:id/assistance', async (request, reply) => {
    try {
      const task = repository.requireTask(request.params.id);
      return reply.code(200).send(await buildTaskAssistanceReport(database, task));
    } catch (error) {
      if (error instanceof TaskModelError) {
        return reply.code(error.statusCode).send({ error: error.code });
      }
      throw error;
    }
  });

  app.get<{ Params: { id: string }; Querystring: { source: 'local_git' } }>(
    '/api/tasks/:id/outcome-evidence',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          required: ['source'],
          properties: { source: { type: 'string', enum: ['local_git'] } },
        },
      },
    },
    async (request, reply) => {
      try {
        if (request.query.source !== 'local_git') {
          return reply.code(400).send({ error: 'unsupported_outcome_evidence_source' });
        }
        const task = repository.requireTask(request.params.id);
        const linkedCwd = database
          .prepare(
            `SELECT s.cwd FROM task_sessions ts
             JOIN sessions s ON s.id = ts.session_id
             WHERE ts.task_id = ? AND s.cwd IS NOT NULL
             ORDER BY ts.created_at, ts.session_id LIMIT 1`,
          )
          .get(request.params.id) as { cwd: string } | undefined;
        const cwd =
          linkedCwd?.cwd ??
          (task.projectId && isAbsolute(task.projectId) ? task.projectId : undefined);
        return reply.code(200).send(await collectLocalGitOutcomeEvidence(task.id, cwd));
      } catch (error) {
        if (error instanceof TaskModelError) {
          return reply.code(error.statusCode).send({ error: error.code });
        }
        throw error;
      }
    },
  );

  app.patch<{ Params: { id: string }; Body: UpdateTaskBody }>(
    '/api/tasks/:id',
    { schema: { body: updateTaskBodySchema } },
    async (request, reply) =>
      respond(reply, 200, () => repository.updateTask(request.params.id, request.body)),
  );

  app.get<{ Params: { id: string } }>('/api/tasks/:id/sessions', async (request, reply) =>
    respond(reply, 200, () => ({ sessions: repository.listTaskSessions(request.params.id) })),
  );

  app.post<{ Params: { id: string }; Body: AttachSessionBody }>(
    '/api/tasks/:id/sessions',
    { schema: { body: attachSessionBodySchema } },
    async (request, reply) =>
      respond(reply, 201, () => repository.attachSession(request.params.id, request.body)),
  );

  app.put<{ Params: { id: string }; Body: UpsertOutcomeBody }>(
    '/api/tasks/:id/outcome',
    { schema: { body: upsertOutcomeBodySchema } },
    async (request, reply) =>
      respond(reply, 200, () => repository.upsertOutcome(request.params.id, request.body)),
  );

  app.get<{ Params: { id: string } }>('/api/tasks/:id/profile', async (request, reply) =>
    respond(reply, 200, () => getTaskProfileReport(runtime, request.params.id)),
  );

  app.get<{ Params: { id: string }; Querystring: { optIn?: string } }>(
    '/api/tasks/:id/feedback',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { optIn: { type: 'string', enum: ['true'] } },
        },
      },
    },
    async (request, reply) => {
      if (request.query.optIn !== 'true') {
        return reply.code(400).send({ error: 'post_run_feedback_opt_in_required' });
      }
      return respond(reply, 200, () => ({
        feedback: repository.buildTaskFeedback(request.params.id),
      }));
    },
  );

  app.get('/api/config-snapshots', async () => ({
    configurations: repository.listConfigurations(),
  }));

  app.post<{ Body: CreateConfigurationBody }>(
    '/api/config-snapshots',
    { schema: { body: createConfigurationBodySchema } },
    async (request, reply) =>
      respond(reply, 201, () => repository.createConfiguration(request.body)),
  );

  app.get('/api/cohorts', async () => ({ cohorts: repository.listCohorts() }));

  app.post<{ Body: CreateCohortBody }>(
    '/api/cohorts',
    { schema: { body: createCohortBodySchema } },
    async (request, reply) => respond(reply, 201, () => repository.createCohort(request.body)),
  );

  app.patch<{ Params: { id: string }; Body: UpdateCohortBody }>(
    '/api/cohorts/:id',
    { schema: { body: updateCohortBodySchema } },
    async (request, reply) =>
      respond(reply, 200, () => repository.updateCohort(request.params.id, request.body)),
  );

  app.get('/api/experiments', async () => ({ experiments: repository.listExperiments() }));

  app.get<{ Params: { id: string } }>('/api/experiments/:id/profile', async (request, reply) =>
    respond(reply, 200, () => repository.buildExperimentProfile(request.params.id)),
  );

  app.post<{ Body: CreateExperimentBody }>(
    '/api/experiments',
    { schema: { body: createExperimentBodySchema } },
    async (request, reply) =>
      respond(reply, 201, () =>
        repository.createExperiment({ ...request.body, guardrails: request.body.guardrails ?? [] }),
      ),
  );

  app.patch<{ Params: { id: string }; Body: UpdateExperimentBody }>(
    '/api/experiments/:id',
    { schema: { body: updateExperimentBodySchema } },
    async (request, reply) =>
      respond(reply, 200, () => repository.updateExperiment(request.params.id, request.body)),
  );
}

function respond(reply: FastifyReply, successStatus: number, action: () => unknown) {
  try {
    return reply.code(successStatus).send(action());
  } catch (error) {
    if (error instanceof TaskModelError) {
      return reply.code(error.statusCode).send({ error: error.code });
    }
    const message = String(error);
    if (
      message.includes('CHECK constraint failed') ||
      message.includes('FOREIGN KEY constraint failed')
    ) {
      return reply.code(400).send({ error: 'invalid_task_model' });
    }
    if (message.includes('UNIQUE constraint failed')) {
      return reply.code(409).send({ error: 'record_exists' });
    }
    throw error;
  }
}
