export const MODEL_CATALOG_SCHEMA_VERSION = 'model-catalog/v1' as const;
export const MODEL_CATALOG_CALCULATOR_VERSION = 'v1' as const;

export type ModelCatalogSourceKind = 'bundled' | 'manual' | 'imported' | 'legacy';
export type ModelCatalogPricingStatus = 'active' | 'superseded' | 'unsupported';

export interface ModelCatalogPricingRecord {
  model: string;
  inputPrice: number;
  cacheCreationPrice: number;
  cacheReadPrice: number;
  outputPrice: number;
  currency: 'CNY';
  unit: 'per_million_tokens';
  effectiveFrom: number;
  sourceKind: ModelCatalogSourceKind;
  sourceReference?: string;
  pricingScheme: string;
  revision: number;
  status: ModelCatalogPricingStatus;
  createdAt: number;
  supersededAt?: number;
}

export interface ModelCatalogAliasRecord {
  rawModel: string;
  pricingModel: string;
  pricingEquivalent: true;
  sourceKind: ModelCatalogSourceKind;
  sourceReference?: string;
  auditedAt?: number;
  revision: number;
}

export interface ModelCatalogContextRecord {
  model: string;
  contextWindow: number;
  sourceKind: ModelCatalogSourceKind;
  sourceReference?: string;
  auditedAt?: number;
  revision: number;
  userOverride: boolean;
}

export interface ModelCatalogInventoryItem {
  model: string;
  observedSpans: number;
  observedSessions: number;
  latestObservedAt: number;
  pricing: ModelCatalogPricingRecord | null;
  pricingAlias: ModelCatalogAliasRecord | null;
  context: ModelCatalogContextRecord | null;
  pricingKnown: boolean;
  contextKnown: boolean;
}

export interface ModelCatalogRecalculationScope {
  models?: string[];
  startTime?: number;
  endTime?: number;
}

export interface ModelCatalogRecalculationCoverage {
  spans: number;
  sessions: number;
  known: number;
  unknown: number;
}

export interface ModelCatalogRecalculationPreview {
  schemaVersion: typeof MODEL_CATALOG_SCHEMA_VERSION;
  scope: ModelCatalogRecalculationScope;
  pricingRevision: string;
  calculatorVersion: typeof MODEL_CATALOG_CALCULATOR_VERSION;
  previewedAt: number;
  before: ModelCatalogRecalculationCoverage;
  after: ModelCatalogRecalculationCoverage;
  affectedCurrencies: string[];
  unsupportedModels: string[];
}

export interface ModelCatalogRecalculationResult extends ModelCatalogRecalculationPreview {
  runId: string;
  executedAt: number;
  updatedSpans: number;
  updatedSessions: number;
  status: 'completed';
}

export interface ModelCatalogConfiguration {
  schemaVersion: typeof MODEL_CATALOG_SCHEMA_VERSION;
  exportedAt?: number;
  pricing: ModelCatalogPricingRecord[];
  modelContext: ModelCatalogContextRecord[];
  pricingAliases: ModelCatalogAliasRecord[];
}
