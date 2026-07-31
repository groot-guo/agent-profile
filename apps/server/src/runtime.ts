import type { Pricing } from '@agent-profile/core';
import { defaultDatabasePathFor, ensureDatabaseDirectory } from './data-path';
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

export const defaultDatabasePath = defaultDatabasePathFor();

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
    clock,
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
      await imports.close();
      database.close();
    },
  };
}

export function createProductionRuntime(options: ProductionRuntimeOptions): AppRuntime {
  const databasePath = options.databasePath || process.env.TRACE_DB_PATH || defaultDatabasePath;
  ensureDatabaseDirectory(databasePath);
  const database = createDatabase(databasePath);
  return createRuntime({ ...options, database });
}
