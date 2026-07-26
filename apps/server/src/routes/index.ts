import type { FastifyInstance } from 'fastify';
import { registerDiagnosisRoutes } from './diagnosis';
import { registerHealthRoutes } from './health';
import { registerPricingRoutes } from './pricing';
import { registerProfileRoutes } from './profiles';
import { registerPromptReviewRoutes } from './prompt-review';
import { registerScanRoutes } from './scan';
import { registerSessionEvidenceRoutes } from './session-evidence';
import { registerSessionRoutes } from './sessions';
import { registerStatsRoutes } from './stats';

export function registerRoutes(app: FastifyInstance) {
  registerScanRoutes(app);
  registerSessionEvidenceRoutes(app);
  registerSessionRoutes(app);
  registerDiagnosisRoutes(app);
  registerPricingRoutes(app);
  registerProfileRoutes(app);
  registerPromptReviewRoutes(app);
  registerHealthRoutes(app);
  registerStatsRoutes(app);
}
