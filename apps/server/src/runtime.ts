import type { Pricing } from '@agent-profile/core';
import { defaultDatabasePathFor, ensureDatabaseDirectory } from './data-path';
import type { DatabaseConnection } from './database';
import { createDatabase } from './database';
import type { ImportSourceDefinition } from './ingestion/import-job-manager';
import { ImportRuntime } from './ingestion/import-runtime';
import { createLlmDiagnoser, type SemanticDiagnoser } from './llm-diagnoser';
import { ModelCatalogService } from './model-catalog/service';
import {
  loadProviderConfiguration,
  providerStatus,
  saveProviderConfiguration,
  type ProviderConfiguration,
  type ProviderStatus,
} from './provider-config';

export type PricingResolver = (model?: string, at?: number) => Pricing | undefined;
export type ContextWindowResolver = (model?: string) => number | undefined;

export interface AppRuntime {
  database: DatabaseConnection;
  clock: () => number;
  modelCatalog: ModelCatalogService;
  pricingResolver: PricingResolver;
  contextWindowResolver: ContextWindowResolver;
  imports: ImportRuntime;
  provider: {
    status(): ProviderStatus;
    configure(configuration: ProviderConfiguration): void;
    diagnoser(): SemanticDiagnoser | null;
  };
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
  const modelCatalog = new ModelCatalogService(database, clock);
  modelCatalog.seedDefaults();

  const pricingResolver: PricingResolver = (model, at = clock()) =>
    modelCatalog.lookupPricing(model, at);
  const contextWindowResolver: ContextWindowResolver = (model) =>
    modelCatalog.lookupContextWindow(model);
  const imports = new ImportRuntime({
    database,
    pricingResolver,
    autoScanDir: options.autoScanDir,
    defaultScanDir: options.defaultScanDir,
    sourceDefinitions: options.sourceDefinitions,
    onError: options.onImportError,
    clock,
  });
  modelCatalog.onUpdate = (sessionIds) => imports.updates.publish(sessionIds);
  let providerConfiguration = loadProviderConfiguration();
  let providerDiagnoser = providerConfiguration
    ? createLlmDiagnoser(providerConfiguration.apiKey, {
        baseUrl: providerConfiguration.baseUrl,
        model: providerConfiguration.model,
        provider: providerConfiguration.provider,
      })
    : null;
  let isClosed = false;

  return {
    database,
    clock,
    modelCatalog,
    pricingResolver,
    contextWindowResolver,
    imports,
    provider: {
      status: () => providerStatus(providerConfiguration),
      configure: (configuration) => {
        saveProviderConfiguration(configuration);
        providerConfiguration = configuration;
        providerDiagnoser = createLlmDiagnoser(configuration.apiKey, {
          baseUrl: configuration.baseUrl,
          model: configuration.model,
          provider: configuration.provider,
        });
      },
      diagnoser: () => providerDiagnoser,
    },
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
