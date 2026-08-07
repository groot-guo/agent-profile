import type { Pricing } from '@agent-profile/core';
import Database from 'better-sqlite3';
import { applyMigrations, type DatabaseConnection } from './schema';

export type { DatabaseConnection } from './schema';

export function createDatabase(filePath: string): DatabaseConnection {
  const database = new Database(filePath);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  applyMigrations(database);
  return database;
}

export function lookupPricing(
  database: DatabaseConnection,
  model?: string,
  at = Date.now(),
): Pricing | undefined {
  if (!model) return undefined;
  const exact = database
    .prepare(
      `SELECT model, input_price as inputPrice, cache_creation_price as cacheCreationPrice,
              cache_read_price as cacheReadPrice, output_price as outputPrice,
              currency, unit, COALESCE(effective_from, 0) as effectiveFrom,
              source_kind as sourceKind, source_reference as sourceReference,
              pricing_scheme as pricingScheme, revision, status,
              created_at as createdAt, superseded_at as supersededAt
       FROM pricing
       WHERE model = ? AND COALESCE(effective_from, 0) <= ?
         AND COALESCE(status, 'active') IN ('active', 'unsupported')
       ORDER BY COALESCE(effective_from, 0) DESC, revision DESC LIMIT 1`,
    )
    .get(model, at) as Pricing | undefined;
  if (exact) {
    return isSupportedPricing(exact) ? { ...exact, pricingModel: exact.model } : undefined;
  }
  const alias = database
    .prepare(
      `SELECT pricing_model as pricingModel FROM pricing_aliases
       WHERE raw_model = ? AND pricing_equivalent = 1`,
    )
    .get(model) as { pricingModel: string } | undefined;
  if (!alias) return undefined;
  const selected = database
    .prepare(
      `SELECT model, input_price as inputPrice, cache_creation_price as cacheCreationPrice,
              cache_read_price as cacheReadPrice, output_price as outputPrice,
              currency, unit, COALESCE(effective_from, 0) as effectiveFrom,
              source_kind as sourceKind, source_reference as sourceReference,
              pricing_scheme as pricingScheme, revision, status,
              created_at as createdAt, superseded_at as supersededAt
       FROM pricing
       WHERE model = ? AND COALESCE(effective_from, 0) <= ?
         AND COALESCE(status, 'active') IN ('active', 'unsupported')
       ORDER BY COALESCE(effective_from, 0) DESC, revision DESC LIMIT 1`,
    )
    .get(alias.pricingModel, at) as Pricing | undefined;
  return selected && isSupportedPricing(selected)
    ? { ...selected, pricingModel: selected.model }
    : undefined;
}

function isSupportedPricing(pricing: Pricing): boolean {
  return (
    (pricing.status ?? 'active') === 'active' &&
    (pricing.pricingScheme ?? 'flat_four_token_classes') === 'flat_four_token_classes'
  );
}
