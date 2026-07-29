import type { FastifyInstance } from 'fastify';
import type { AppRuntime } from '../runtime';
import { registerDiagnosisRoutes } from './diagnosis';
import { registerHealthRoutes } from './health';
import { registerPricingRoutes } from './pricing';
import { registerProfileRoutes } from './profiles';
import { registerPromptReviewRoutes } from './prompt-review';
import { registerScanRoutes } from './scan';
import { registerSessionEvidenceRoutes } from './session-evidence';
import { registerSessionRoutes } from './sessions';
import { registerStatsRoutes } from './stats';
import { registerTaskRoutes } from './tasks';

export function registerRoutes(app: FastifyInstance, runtime: AppRuntime): void {
  registerScanRoutes(app, runtime);
  registerSessionEvidenceRoutes(app, runtime);
  registerSessionRoutes(app, runtime);
  registerDiagnosisRoutes(app, runtime);
  registerPricingRoutes(app, runtime);
  registerProfileRoutes(app, runtime);
  registerPromptReviewRoutes(app, runtime);
  registerHealthRoutes(app);
  registerStatsRoutes(app, runtime);
  registerTaskRoutes(app, runtime);
}
