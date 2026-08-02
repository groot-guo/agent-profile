import { createHash, randomUUID } from 'node:crypto';
import {
  COST_CALCULATOR_VERSION,
  COST_CURRENCY,
  COST_UNIT,
  calcCost,
  isRuntimeMode,
  type Pricing,
  type Span,
} from '@agent-profile/core';
import type { DatabaseConnection } from '../database';
import { lookupPricing } from '../database';
import { seedModelContextDefaults, seedPricingDefaults } from './defaults';
import type {
  CatalogSourceKind,
  ModelCatalogExport,
  ModelCatalogImport,
  ModelContextRecord,
  ModelInventoryItem,
  PricingAliasRecord,
  PricingRecord,
  RecalculationPreview,
  RecalculationResult,
  RecalculationScope,
} from './types';
import { MODEL_CATALOG_CALCULATOR_VERSION, MODEL_CATALOG_SCHEMA_VERSION } from './types';

interface PricingInput {
  model: string;
  inputPrice: number;
  cacheCreationPrice: number;
  cacheReadPrice: number;
  outputPrice: number;
  currency?: string;
  unit?: string;
  effectiveFrom?: number;
  sourceReference?: string;
  pricingScheme?: string;
  status?: 'active' | 'superseded' | 'unsupported';
}

interface ContextInput {
  model: string;
  contextWindow: number;
  sourceReference?: string;
  auditedAt?: number;
}

interface AliasInput {
  rawModel: string;
  pricingModel: string;
  sourceReference?: string;
  auditedAt?: number;
}

interface CatalogSpan {
  id: string;
  sessionId: string;
  model?: string;
  startTime: number;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  cost: number;
  costUnknown: boolean;
}

function asContextRecord(row: Record<string, unknown>): ModelContextRecord {
  return {
    model: String(row.model),
    contextWindow: Number(row.contextWindow),
    sourceKind: (row.sourceKind as CatalogSourceKind) || 'legacy',
    sourceReference: typeof row.sourceReference === 'string' ? row.sourceReference : undefined,
    auditedAt: typeof row.auditedAt === 'number' ? row.auditedAt : undefined,
    revision: Number(row.revision || 1),
    userOverride: Boolean(row.userOverride),
  };
}

function normalizeScope(scope: RecalculationScope = {}): RecalculationScope {
  const models = scope.models?.map((model) => model.trim()).filter(Boolean);
  return {
    ...(models && models.length > 0 ? { models: [...new Set(models)].sort() } : {}),
    ...(scope.startTime === undefined ? {} : { startTime: scope.startTime }),
    ...(scope.endTime === undefined ? {} : { endTime: scope.endTime }),
  };
}

export class ModelCatalogService {
  constructor(
    private readonly database: DatabaseConnection,
    private readonly clock: () => number,
  ) {}

  seedDefaults(): void {
    seedPricingDefaults(this.database);
    seedModelContextDefaults(this.database);
  }

  lookupPricing(model?: string, at = this.clock()): Pricing | undefined {
    return lookupPricing(this.database, model, at);
  }

  lookupContextWindow(model?: string): number | undefined {
    if (!model) return undefined;
    const row = this.database
      .prepare('SELECT context_window as contextWindow FROM model_context WHERE model = ?')
      .get(model) as { contextWindow: number } | undefined;
    return row?.contextWindow;
  }

  listPricing(model?: string): PricingRecord[] {
    const rows = this.database
      .prepare(
        `SELECT model, input_price as inputPrice, cache_creation_price as cacheCreationPrice,
          cache_read_price as cacheReadPrice, output_price as outputPrice, currency, unit,
          COALESCE(effective_from, 0) as effectiveFrom,
          source_kind as sourceKind, source_reference as sourceReference,
          pricing_scheme as pricingScheme, revision, status,
          created_at as createdAt, superseded_at as supersededAt
         FROM pricing
         WHERE status IN ('active', 'unsupported')${model ? ' AND model = ?' : ''}
         ORDER BY model, COALESCE(effective_from, 0), revision`,
      )
      .all(...(model ? [model] : [])) as PricingRecord[];
    return rows;
  }

  listPricingHistory(model: string): PricingRecord[] {
    return this.database
      .prepare(
        `SELECT model, input_price as inputPrice, cache_creation_price as cacheCreationPrice,
          cache_read_price as cacheReadPrice, output_price as outputPrice, currency, unit,
          effective_from as effectiveFrom, source_kind as sourceKind,
          source_reference as sourceReference, pricing_scheme as pricingScheme,
          revision, status, created_at as createdAt, superseded_at as supersededAt
         FROM pricing_history WHERE model = ?
         ORDER BY effective_from, revision`,
      )
      .all(model) as PricingRecord[];
  }

  listAliases(rawModel?: string): PricingAliasRecord[] {
    return this.database
      .prepare(
        `SELECT raw_model as rawModel, pricing_model as pricingModel,
          pricing_equivalent as pricingEquivalent, source_kind as sourceKind,
          source_reference as sourceReference, audited_at as auditedAt, revision
         FROM pricing_aliases ${rawModel ? 'WHERE raw_model = ?' : ''}
         ORDER BY raw_model`,
      )
      .all(...(rawModel ? [rawModel] : []))
      .map((row) => ({
        ...(row as PricingAliasRecord),
        pricingEquivalent: true as const,
      }));
  }

  listContexts(model?: string): ModelContextRecord[] {
    const rows = this.database
      .prepare(
        `SELECT model, context_window as contextWindow, source_kind as sourceKind,
          source_reference as sourceReference, audited_at as auditedAt,
          revision, user_override as userOverride
         FROM model_context ${model ? 'WHERE model = ?' : ''} ORDER BY model`,
      )
      .all(...(model ? [model] : [])) as Record<string, unknown>[];
    return rows.map(asContextRecord);
  }

  upsertPricing(input: PricingInput, sourceKind: CatalogSourceKind = 'manual'): PricingRecord {
    this.assertConfigurableModel(input.model);
    const effectiveFrom = input.effectiveFrom ?? this.clock();
    const previous = this.database
      .prepare(
        `SELECT COALESCE(MAX(revision), 0) as revision FROM pricing_history
         WHERE model = ? AND effective_from = ?`,
      )
      .get(input.model, effectiveFrom) as { revision: number };
    const revision = previous.revision + 1;
    const createdAt = this.clock();
    const row = {
      ...input,
      currency: input.currency ?? COST_CURRENCY,
      unit: input.unit ?? COST_UNIT,
      effectiveFrom,
      sourceKind,
      pricingScheme: input.pricingScheme ?? 'flat_four_token_classes',
      status:
        input.status ??
        (input.pricingScheme && input.pricingScheme !== 'flat_four_token_classes'
          ? 'unsupported'
          : 'active'),
      revision,
      createdAt,
    };
    this.database.transaction(() => {
      this.database
        .prepare(
          `UPDATE pricing_history SET status = 'superseded', superseded_at = ?
           WHERE model = ? AND effective_from = ? AND status = 'active'`,
        )
        .run(row.createdAt, row.model, row.effectiveFrom);
      this.database
        .prepare(
          `INSERT INTO pricing_history (
            id, model, input_price, cache_creation_price, cache_read_price,
            output_price, currency, unit, effective_from, source_kind,
            source_reference, pricing_scheme, revision, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          row.model,
          row.inputPrice,
          row.cacheCreationPrice,
          row.cacheReadPrice,
          row.outputPrice,
          row.currency,
          row.unit,
          row.effectiveFrom,
          row.sourceKind,
          row.sourceReference ?? null,
          row.pricingScheme,
          row.revision,
          row.status,
          row.createdAt,
        );
      const current = this.database
        .prepare(
          `SELECT effective_from as effectiveFrom FROM pricing
           WHERE model = ? AND COALESCE(effective_from, 0) = ? LIMIT 1`,
        )
        .get(row.model, row.effectiveFrom) as { effectiveFrom: number | null } | undefined;
      if (current) {
        this.database
          .prepare(
            `UPDATE pricing SET input_price = ?, cache_creation_price = ?,
              cache_read_price = ?, output_price = ?, currency = ?, unit = ?,
              source_kind = ?, source_reference = ?, pricing_scheme = ?, revision = ?,
              status = ?, created_at = ?, superseded_at = NULL
             WHERE model = ? AND effective_from IS ?`,
          )
          .run(
            row.inputPrice,
            row.cacheCreationPrice,
            row.cacheReadPrice,
            row.outputPrice,
            row.currency,
            row.unit,
            row.sourceKind,
            row.sourceReference ?? null,
            row.pricingScheme,
            row.revision,
            row.status,
            row.createdAt,
            row.model,
            current.effectiveFrom,
          );
      } else {
        this.database
          .prepare(
            `INSERT INTO pricing (
            model, input_price, cache_creation_price, cache_read_price, output_price,
            currency, unit, effective_from, source_kind, source_reference,
            pricing_scheme, revision, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            row.model,
            row.inputPrice,
            row.cacheCreationPrice,
            row.cacheReadPrice,
            row.outputPrice,
            row.currency,
            row.unit,
            row.effectiveFrom,
            row.sourceKind,
            row.sourceReference ?? null,
            row.pricingScheme,
            row.revision,
            row.status,
            row.createdAt,
          );
      }
    })();
    return this.listPricing(row.model).find(
      (pricing) => pricing.effectiveFrom === row.effectiveFrom,
    ) as PricingRecord;
  }

  upsertContext(input: ContextInput, sourceKind: CatalogSourceKind = 'manual'): ModelContextRecord {
    this.assertConfigurableModel(input.model);
    const previous = this.database
      .prepare('SELECT COALESCE(revision, 0) as revision FROM model_context WHERE model = ?')
      .get(input.model) as { revision: number } | undefined;
    const revision = (previous?.revision ?? 0) + 1;
    this.database
      .prepare(
        `INSERT INTO model_context (
          model, context_window, source_kind, source_reference, audited_at,
          revision, user_override
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(model) DO UPDATE SET
          context_window = excluded.context_window,
          source_kind = excluded.source_kind,
          source_reference = excluded.source_reference,
          audited_at = excluded.audited_at,
          revision = excluded.revision,
          user_override = excluded.user_override`,
      )
      .run(
        input.model,
        input.contextWindow,
        sourceKind,
        input.sourceReference ?? null,
        input.auditedAt ?? null,
        revision,
        sourceKind === 'manual' ? 1 : 0,
      );
    return this.listContexts(input.model)[0];
  }

  upsertAlias(input: AliasInput, sourceKind: CatalogSourceKind = 'manual'): PricingAliasRecord {
    if (!input.rawModel || !input.pricingModel || input.rawModel === input.pricingModel) {
      throw new Error('invalid_pricing_alias');
    }
    this.assertConfigurableModel(input.rawModel);
    this.assertConfigurableModel(input.pricingModel);
    const previous = this.listAliases(input.rawModel)[0];
    const revision = (previous?.revision ?? 0) + 1;
    this.database
      .prepare(
        `INSERT INTO pricing_aliases (
          raw_model, pricing_model, pricing_equivalent, source_kind,
          source_reference, audited_at, revision
        ) VALUES (?, ?, 1, ?, ?, ?, ?)
        ON CONFLICT(raw_model) DO UPDATE SET
          pricing_model = excluded.pricing_model,
          pricing_equivalent = excluded.pricing_equivalent,
          source_kind = excluded.source_kind,
          source_reference = excluded.source_reference,
          audited_at = excluded.audited_at,
          revision = excluded.revision`,
      )
      .run(
        input.rawModel,
        input.pricingModel,
        sourceKind,
        input.sourceReference ?? null,
        input.auditedAt ?? null,
        revision,
      );
    return this.listAliases(input.rawModel)[0];
  }

  listModels(at = this.clock()): ModelInventoryItem[] {
    const rows = this.database
      .prepare(
        `SELECT model, COUNT(*) as observedSpans, COUNT(DISTINCT session_id) as observedSessions,
          MAX(start_time) as latestObservedAt
         FROM spans WHERE type = 'llm_turn' AND model IS NOT NULL
         GROUP BY model ORDER BY latestObservedAt DESC, model`,
      )
      .all() as Array<{
      model: string;
      observedSpans: number;
      observedSessions: number;
      latestObservedAt: number;
    }>;
    return rows
      .filter((row) => !isRuntimeMode(row.model))
      .map((row) => {
        const pricing = this.applicablePricingRecord(row.model, at);
        const pricingAlias = this.listAliases(row.model)[0] ?? null;
        const context = this.listContexts(row.model)[0] ?? null;
        return {
          ...row,
          pricing,
          pricingAlias,
          context,
          pricingKnown:
            pricing !== null &&
            pricing.status === 'active' &&
            pricing.pricingScheme === 'flat_four_token_classes',
          contextKnown: context !== null,
        };
      });
  }

  private assertConfigurableModel(model: string): void {
    if (!isRuntimeMode(model)) return;
    const error = new Error('runtime_mode_not_configurable') as Error & { statusCode: number };
    error.statusCode = 400;
    throw error;
  }

  pricingRevision(): string {
    const rows = this.database
      .prepare(
        `SELECT model, input_price as inputPrice, cache_creation_price as cacheCreationPrice,
          cache_read_price as cacheReadPrice, output_price as outputPrice,
          currency, unit, effective_from as effectiveFrom, source_kind as sourceKind,
          source_reference as sourceReference, pricing_scheme as pricingScheme,
          revision, status FROM pricing ORDER BY model, effective_from, revision`,
      )
      .all() as unknown[];
    const aliases = this.listAliases();
    return createHash('sha256')
      .update(JSON.stringify({ rows, aliases }))
      .digest('hex')
      .slice(0, 16);
  }

  previewRecalculation(scope: RecalculationScope = {}): RecalculationPreview {
    const normalized = normalizeScope(scope);
    const spans = this.selectSpans(normalized);
    const before = this.coverage(spans, false);
    const after = this.coverage(spans, true);
    return {
      schemaVersion: MODEL_CATALOG_SCHEMA_VERSION,
      scope: normalized,
      pricingRevision: this.pricingRevision(),
      calculatorVersion: MODEL_CATALOG_CALCULATOR_VERSION,
      previewedAt: this.clock(),
      before,
      after,
      affectedCurrencies: spans.length > 0 ? [COST_CURRENCY] : [],
      unsupportedModels: spans
        .filter((span) => {
          const pricing = this.applicablePricingRecord(span.model, span.startTime);
          return pricing !== null && pricing.pricingScheme !== 'flat_four_token_classes';
        })
        .map((span) => span.model ?? '')
        .filter(Boolean)
        .filter((model, index, models) => models.indexOf(model) === index),
    };
  }

  executeRecalculation(
    scope: RecalculationScope = {},
    expectedPricingRevision?: string,
  ): RecalculationResult {
    const preview = this.previewRecalculation(scope);
    if (expectedPricingRevision && expectedPricingRevision !== preview.pricingRevision) {
      throw new Error('pricing_revision_changed');
    }
    const executedAt = this.clock();
    const runId = randomUUID();
    const spans = this.selectSpans(preview.scope);
    const sessionIds = [...new Set(spans.map((span) => span.sessionId))];
    let updatedSpans = 0;
    this.database.transaction(() => {
      const updateSpan = this.database.prepare(
        `UPDATE spans SET cost = ?, cost_unknown = ?, cost_currency = ?,
          pricing_effective_from = ?, pricing_model = ?, pricing_revision = ?,
          cost_calculated_at = ?, cost_calculator_version = ?
         WHERE id = ?`,
      );
      for (const span of spans) {
        const pricing = this.lookupPricing(span.model, span.startTime);
        const result = calcCost(this.asCoreSpan(span), pricing);
        updateSpan.run(
          result.cost,
          result.unknown ? 1 : 0,
          COST_CURRENCY,
          pricing?.effectiveFrom ?? 0,
          pricing?.pricingModel ?? pricing?.model ?? null,
          pricing?.revision ?? null,
          executedAt,
          COST_CALCULATOR_VERSION,
          span.id,
        );
        updatedSpans++;
      }
      const updateSession = this.database.prepare(
        `UPDATE sessions SET total_cost = ?, cost_unknown_count = ?, cost_currency = ?,
          cost_calculated_at = ?, cost_calculator_version = ? WHERE id = ?`,
      );
      if (Object.keys(preview.scope).length === 0) {
        this.database
          .prepare(
            `UPDATE sessions SET total_cost = 0, cost_unknown_count = 0,
              cost_currency = ?, cost_calculated_at = ?, cost_calculator_version = ?
             WHERE id IS NOT NULL`,
          )
          .run(COST_CURRENCY, executedAt, COST_CALCULATOR_VERSION);
      }
      for (const sessionId of sessionIds) {
        const totals = this.database
          .prepare(
            `SELECT COALESCE(SUM(cost), 0) as totalCost,
              COALESCE(SUM(cost_unknown), 0) as unknownCount
             FROM spans WHERE session_id = ? AND type = 'llm_turn'`,
          )
          .get(sessionId) as { totalCost: number; unknownCount: number };
        updateSession.run(
          totals.totalCost,
          totals.unknownCount,
          COST_CURRENCY,
          executedAt,
          COST_CALCULATOR_VERSION,
          sessionId,
        );
      }
      this.database
        .prepare(
          `INSERT INTO cost_recalculation_runs (
            id, scope_json, pricing_revision, calculator_version, previewed_at,
            executed_at, updated_spans, updated_sessions, unknown_before,
            unknown_after, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed')`,
        )
        .run(
          runId,
          JSON.stringify(preview.scope),
          preview.pricingRevision,
          preview.calculatorVersion,
          preview.previewedAt,
          executedAt,
          updatedSpans,
          sessionIds.length,
          preview.before.unknown,
          preview.after.unknown,
        );
    })();
    return {
      ...preview,
      runId,
      executedAt,
      updatedSpans,
      updatedSessions: sessionIds.length,
      status: 'completed',
    };
  }

  exportConfiguration(): ModelCatalogExport {
    return {
      schemaVersion: MODEL_CATALOG_SCHEMA_VERSION,
      exportedAt: this.clock(),
      pricing: this.listPricing(),
      modelContext: this.listContexts(),
      pricingAliases: this.listAliases(),
    };
  }

  importConfiguration(input: ModelCatalogImport): { pricing: number; modelContext: number } {
    if (input.schemaVersion !== MODEL_CATALOG_SCHEMA_VERSION) {
      throw new Error('unsupported_model_catalog_schema');
    }
    if (!Array.isArray(input.pricing) || !Array.isArray(input.modelContext)) {
      throw new Error('invalid_model_catalog_payload');
    }
    if (!Array.isArray(input.pricingAliases)) {
      throw new Error('invalid_model_catalog_payload');
    }
    for (const row of input.pricing) this.validatePricing(row);
    for (const row of input.modelContext) {
      if (!row.model || !Number.isInteger(row.contextWindow) || row.contextWindow < 1) {
        throw new Error('invalid_model_context_payload');
      }
    }
    for (const row of input.pricingAliases) {
      if (!row.rawModel || !row.pricingModel || row.pricingEquivalent !== true) {
        throw new Error('invalid_pricing_alias');
      }
    }
    let pricingCount = 0;
    let contextCount = 0;
    this.database.transaction(() => {
      for (const row of input.pricing) {
        this.upsertPricing(row, 'imported');
        pricingCount++;
      }
      for (const row of input.modelContext) {
        if (!row.model || !Number.isInteger(row.contextWindow) || row.contextWindow < 1) {
          throw new Error('invalid_model_context_payload');
        }
        this.upsertContext(
          {
            model: row.model,
            contextWindow: row.contextWindow,
            sourceReference: row.sourceReference,
            auditedAt: row.auditedAt,
          },
          'imported',
        );
        contextCount++;
      }
      for (const row of input.pricingAliases) {
        this.upsertAlias(row, 'imported');
      }
    })();
    return { pricing: pricingCount, modelContext: contextCount };
  }

  private validatePricing(row: PricingRecord): void {
    if (
      !row.model ||
      [row.inputPrice, row.cacheCreationPrice, row.cacheReadPrice, row.outputPrice].some(
        (value) => typeof value !== 'number' || value < 0,
      ) ||
      row.currency !== COST_CURRENCY ||
      row.unit !== COST_UNIT ||
      !Number.isInteger(row.effectiveFrom) ||
      row.effectiveFrom < 0 ||
      !['active', 'unsupported'].includes(row.status)
    ) {
      throw new Error('invalid_pricing_payload');
    }
  }

  private applicablePricingRecord(model: string | undefined, at: number): PricingRecord | null {
    if (!model) return null;
    const exact = this.selectApplicablePricing(model, at);
    if (exact) return exact;
    const alias = this.listAliases(model)[0];
    return alias ? this.selectApplicablePricing(alias.pricingModel, at) : null;
  }

  private selectApplicablePricing(model: string, at: number): PricingRecord | null {
    return (
      (this.database
        .prepare(
          `SELECT model, input_price as inputPrice,
            cache_creation_price as cacheCreationPrice,
            cache_read_price as cacheReadPrice, output_price as outputPrice,
            currency, unit, COALESCE(effective_from, 0) as effectiveFrom,
            source_kind as sourceKind, source_reference as sourceReference,
            pricing_scheme as pricingScheme, revision, status,
            created_at as createdAt, superseded_at as supersededAt
           FROM pricing WHERE model = ? AND COALESCE(effective_from, 0) <= ?
             AND status IN ('active', 'unsupported')
           ORDER BY COALESCE(effective_from, 0) DESC, revision DESC LIMIT 1`,
        )
        .get(model, at) as PricingRecord | undefined) ?? null
    );
  }

  private selectSpans(scope: RecalculationScope): CatalogSpan[] {
    const conditions = ["type = 'llm_turn'"];
    const parameters: Array<string | number> = [];
    if (scope.models?.length) {
      conditions.push(`model IN (${scope.models.map(() => '?').join(',')})`);
      parameters.push(...scope.models);
    }
    if (scope.startTime !== undefined) {
      conditions.push('start_time >= ?');
      parameters.push(scope.startTime);
    }
    if (scope.endTime !== undefined) {
      conditions.push('start_time <= ?');
      parameters.push(scope.endTime);
    }
    return this.database
      .prepare(
        `SELECT id, session_id as sessionId, model, start_time as startTime,
          input_tokens as inputTokens, cache_creation_tokens as cacheCreationTokens,
          cache_read_tokens as cacheReadTokens, output_tokens as outputTokens,
          cost, cost_unknown as costUnknown FROM spans WHERE ${conditions.join(' AND ')}
         ORDER BY start_time, id`,
      )
      .all(...parameters) as CatalogSpan[];
  }

  private coverage(
    spans: CatalogSpan[],
    projected: boolean,
  ): { spans: number; sessions: number; known: number; unknown: number } {
    const known = projected
      ? spans.filter((span) => {
          const pricing = this.lookupPricing(span.model, span.startTime);
          return pricing !== undefined && pricing.pricingScheme === 'flat_four_token_classes';
        }).length
      : spans.filter((span) => !span.costUnknown).length;
    return {
      spans: spans.length,
      sessions: new Set(spans.map((span) => span.sessionId)).size,
      known,
      unknown: spans.length - known,
    };
  }

  private asCoreSpan(span: CatalogSpan): Span {
    return {
      id: span.id,
      sessionId: span.sessionId,
      type: 'llm_turn',
      name: '',
      startTime: span.startTime,
      inputTokens: span.inputTokens,
      cacheCreationTokens: span.cacheCreationTokens,
      cacheReadTokens: span.cacheReadTokens,
      outputTokens: span.outputTokens,
      contextTokens: 0,
      outputBytes: 0,
      model: span.model,
      cost: span.cost,
      costUnknown: span.costUnknown,
      isError: false,
      isSidechain: false,
    };
  }
}
