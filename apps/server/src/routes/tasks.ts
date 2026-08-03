import type { FastifyInstance, FastifyReply } from 'fastify';
import { getTaskProfileReport } from '../reports-service';
import type { AppRuntime } from '../runtime';
import { TaskModelError, TaskRepository } from '../task-repository';

type TaskRuntime = Pick<AppRuntime, 'database'>;

export function registerTaskRoutes(app: FastifyInstance, runtime: TaskRuntime) {
  const { database } = runtime;
  const repository = new TaskRepository(database);

  app.get('/api/tasks', async () => ({ tasks: repository.listTasks() }));

  app.post('/api/tasks', async (request, reply) =>
    respond(reply, 201, () =>
      repository.createTask(request.body as Parameters<typeof repository.createTask>[0]),
    ),
  );

  app.get<{ Params: { id: string } }>('/api/tasks/:id', async (request, reply) =>
    respond(reply, 200, () => ({
      task: repository.requireTask(request.params.id),
      sessions: repository.listTaskSessions(request.params.id),
      outcome: repository.getOutcome(request.params.id),
    })),
  );

  app.patch<{ Params: { id: string } }>('/api/tasks/:id', async (request, reply) =>
    respond(reply, 200, () =>
      repository.updateTask(
        request.params.id,
        request.body as Parameters<typeof repository.updateTask>[1],
      ),
    ),
  );

  app.get<{ Params: { id: string } }>('/api/tasks/:id/sessions', async (request, reply) =>
    respond(reply, 200, () => ({ sessions: repository.listTaskSessions(request.params.id) })),
  );

  app.post<{ Params: { id: string } }>('/api/tasks/:id/sessions', async (request, reply) =>
    respond(reply, 201, () =>
      repository.attachSession(
        request.params.id,
        request.body as Parameters<typeof repository.attachSession>[1],
      ),
    ),
  );

  app.put<{ Params: { id: string } }>('/api/tasks/:id/outcome', async (request, reply) =>
    respond(reply, 200, () =>
      repository.upsertOutcome(
        request.params.id,
        request.body as Parameters<typeof repository.upsertOutcome>[1],
      ),
    ),
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

  app.post('/api/config-snapshots', async (request, reply) =>
    respond(reply, 201, () =>
      repository.createConfiguration(
        request.body as Parameters<typeof repository.createConfiguration>[0],
      ),
    ),
  );

  app.get('/api/cohorts', async () => ({ cohorts: repository.listCohorts() }));

  app.post('/api/cohorts', async (request, reply) =>
    respond(reply, 201, () =>
      repository.createCohort(request.body as Parameters<typeof repository.createCohort>[0]),
    ),
  );

  app.patch<{ Params: { id: string } }>('/api/cohorts/:id', async (request, reply) =>
    respond(reply, 200, () =>
      repository.updateCohort(
        request.params.id,
        request.body as Parameters<typeof repository.updateCohort>[1],
      ),
    ),
  );

  app.get('/api/experiments', async () => ({ experiments: repository.listExperiments() }));

  app.get<{ Params: { id: string } }>('/api/experiments/:id/profile', async (request, reply) =>
    respond(reply, 200, () => repository.buildExperimentProfile(request.params.id)),
  );

  app.post('/api/experiments', async (request, reply) =>
    respond(reply, 201, () =>
      repository.createExperiment(
        request.body as Parameters<typeof repository.createExperiment>[0],
      ),
    ),
  );

  app.patch<{ Params: { id: string } }>('/api/experiments/:id', async (request, reply) =>
    respond(reply, 200, () =>
      repository.updateExperiment(
        request.params.id,
        request.body as Parameters<typeof repository.updateExperiment>[1],
      ),
    ),
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
