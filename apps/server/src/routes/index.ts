import type { FastifyInstance } from 'fastify';
import { registerDiagnosisRoutes } from './diagnosis';
import { registerHealthRoutes } from './health';
import { registerPricingRoutes } from './pricing';
import { registerProfileRoutes } from './profiles';
import { registerScanRoutes } from './scan';
import { registerSessionRoutes } from './sessions';
import { registerStatsRoutes } from './stats';

export function registerRoutes(app: FastifyInstance) {
  registerScanRoutes(app);
  registerSessionRoutes(app);
  registerDiagnosisRoutes(app);
  registerPricingRoutes(app);
  registerProfileRoutes(app);
  registerHealthRoutes(app);
  registerStatsRoutes(app);
}
