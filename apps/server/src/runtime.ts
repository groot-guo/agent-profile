import type { Pricing } from '@agent-profile/core';
import { defaultDatabasePathFor, ensureDatabaseDirectory } from './data-path';
import type { DatabaseConnection } from './database';
import { createDatabase } from './database';
import type { ImportSourceDefinition } from './ingestion/import-job-manager';
import { ImportRuntime } from './ingestion/import-runtime';
import {
  createLlmDiagnoser,
  type ProviderTestResult,
  type SemanticDiagnoser,
  testProviderConnection,
} from './llm-diagnoser';
import { ModelCatalogService } from './model-catalog/service';
import { normalizeProjectRoot } from './project-scope';
import {
  loadProviderConfiguration,
  type ProviderConfiguration,
  type ProviderStatus,
  type ProviderTestStatus,
  providerStatus,
  saveProviderConfiguration,
} from './provider-config';
import { SemanticDiagnosisRepository } from './semantic-diagnosis-repository';

export type PricingResolver = (model?: string, at?: number) => Pricing | undefined;
export type ContextWindowResolver = (model?: string) => number | undefined;

export interface AppRuntime {
  database: DatabaseConnection;
  projectRoot: string | null;
  clock: () => number;
  modelCatalog: ModelCatalogService;
  pricingResolver: PricingResolver;
  contextWindowResolver: ContextWindowResolver;
  imports: ImportRuntime;
  semanticDiagnosis: SemanticDiagnosisRepository;
  provider: {
    status(): ProviderStatus;
    configure(configuration: ProviderConfiguration): void;
    test(): Promise<ProviderTestResult>;
    diagnoser(): SemanticDiagnoser | null;
  };
  close: () => Promise<void>;
}

export interface RuntimeOptions {
  database: DatabaseConnection;
  projectRoot?: string | null;
  providerFetch?: typeof fetch;
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
  const projectRoot = normalizeProjectRoot(options.projectRoot);
  const modelCatalog = new ModelCatalogService(database, clock);
  modelCatalog.seedDefaults();

  const pricingResolver: PricingResolver = (model, at = clock()) =>
    modelCatalog.lookupPricing(model, at);
  const contextWindowResolver: ContextWindowResolver = (model) =>
    modelCatalog.lookupContextWindow(model);
  const imports = new ImportRuntime({
    database,
    projectRoot,
    pricingResolver,
    autoScanDir: options.autoScanDir,
    defaultScanDir: options.defaultScanDir,
    sourceDefinitions: options.sourceDefinitions,
    onError: options.onImportError,
    clock,
  });
  const semanticDiagnosis = new SemanticDiagnosisRepository(database);
  modelCatalog.onUpdate = (sessionIds) => imports.updates.publish(sessionIds);
  modelCatalog.onContextUpdate = () => imports.updates.publish([], true);
  let providerConfiguration = loadProviderConfiguration();
  let providerDiagnoser = providerConfiguration
    ? createLlmDiagnoser(providerConfiguration.apiKey, {
        baseUrl: providerConfiguration.baseUrl,
        model: providerConfiguration.model,
        provider: providerConfiguration.provider,
      })
    : null;
  let providerTestStatus: ProviderTestStatus = 'untested';
  let isClosed = false;

  return {
    database,
    projectRoot,
    clock,
    modelCatalog,
    pricingResolver,
    contextWindowResolver,
    imports,
    semanticDiagnosis,
    provider: {
      status: () => providerStatus(providerConfiguration, { testStatus: providerTestStatus }),
      configure: (configuration) => {
        saveProviderConfiguration(configuration);
        providerConfiguration = configuration;
        providerTestStatus = 'untested';
        providerDiagnoser = createLlmDiagnoser(configuration.apiKey, {
          baseUrl: configuration.baseUrl,
          model: configuration.model,
          provider: configuration.provider,
        });
      },
      test: async () => {
        const result = await testProviderConnection(providerConfiguration, options.providerFetch);
        if (result.status === 'passed' || result.reason !== 'not_configured') {
          providerTestStatus = result.status;
        }
        return result;
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
