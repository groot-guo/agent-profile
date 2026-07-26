import {
  buildPromptIterationReport,
  MAX_PROMPT_CHARACTERS,
  reviewPromptStructure,
} from '@agent-profile/core';
import type { FastifyInstance } from 'fastify';
import type { DatabaseConnection } from '../database';
import { db } from '../db';
import { buildProfileReport } from './profiles';

interface PromptReviewBody {
  prompt: string;
  agent?: string;
  includeEvidence?: boolean;
}

const promptReviewBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['prompt'],
  properties: {
    prompt: { type: 'string', minLength: 1, maxLength: MAX_PROMPT_CHARACTERS },
    agent: { type: 'string', minLength: 1, maxLength: 100 },
    includeEvidence: { type: 'boolean' },
  },
} as const;

export function registerPromptReviewRoutes(
  app: FastifyInstance,
  database: DatabaseConnection = db,
): void {
  app.post<{ Body: PromptReviewBody }>(
    '/api/prompt-review',
    { schema: { body: promptReviewBodySchema } },
    async (request, reply) => {
      const prompt = request.body.prompt;
      if (prompt.trim().length === 0) {
        return reply.status(400).send({ error: 'prompt must contain non-whitespace text' });
      }

      const agentProfile = request.body.agent
        ? buildProfileReport(database).profiles.find(
            (profile) => profile.agent === request.body.agent,
          )
        : undefined;
      if (request.body.agent && !agentProfile) {
        return reply.status(404).send({
          error: 'agent profile not found',
          agent: request.body.agent,
        });
      }

      const review = reviewPromptStructure(prompt, {
        includeEvidence: request.body.includeEvidence === true,
      });
      return buildPromptIterationReport(review, agentProfile);
    },
  );
}
