import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pricing } from '@agent-profile/core';
import type { DatabaseConnection } from './database';
import { createDatabase, lookupPricing } from './database';
import { getModelContextForDb, seedModelContextDefaults, seedPricingDefaults } from './db';
import type { ImportSourceDefinition } from './ingestion/import-job-manager';
import { ImportRuntime } from './ingestion/import-runtime';

export type PricingResolver = (model?: string, at?: number) => Pricing | undefined;
export type ContextWindowResolver = (model?: string) => number | undefined;

export interface AppRuntime {
  database: DatabaseConnection;
  clock: () => number;
  pricingResolver: PricingResolver;
  contextWindowResolver: ContextWindowResolver;
  imports: ImportRuntime;
  close: () => Promise<void>;
}

export interface RuntimeOptions {
  database: DatabaseConnection;
  autoScanDir: string | null;
  defaultScanDir: string;
  clock?: () => number;
  sourceDefinitions?: ImportSourceDefinition[];
  onImportError?: (source: ImportSourceDefinition, error: unknown) => void;
}

export interface ProductionRuntimeOptions extends Omit<RuntimeOptions, 'database'> {
  databasePath?: string;
}

const serverDir = dirname(fileURLToPath(import.meta.url));
export const defaultDatabasePath = resolve(serverDir, '..', 'trace.db');

export function createRuntime(options: RuntimeOptions): AppRuntime {
  const { database } = options;
  const clock = options.clock ?? (() => Date.now());
  seedPricingDefaults(database);
  seedModelContextDefaults(database);

  const pricingResolver: PricingResolver = (model, at = clock()) =>
    lookupPricing(database, model, at);
  const contextWindowResolver: ContextWindowResolver = (model) =>
    getModelContextForDb(database, model);
  const imports = new ImportRuntime({
    database,
    pricingResolver,
    autoScanDir: options.autoScanDir,
    defaultScanDir: options.defaultScanDir,
    sourceDefinitions: options.sourceDefinitions,
    onError: options.onImportError,
  });
  let isClosed = false;

  return {
    database,
    clock,
    pricingResolver,
    contextWindowResolver,
    imports,
    close: async () => {
      if (isClosed) return;
      isClosed = true;
      await imports.waitForIdle();
      database.close();
    },
  };
}

export function createProductionRuntime(options: ProductionRuntimeOptions): AppRuntime {
  const database = createDatabase(
    options.databasePath || process.env.TRACE_DB_PATH || defaultDatabasePath,
  );
  return createRuntime({ ...options, database });
}
