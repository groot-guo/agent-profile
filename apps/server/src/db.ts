import type { DatabaseConnection } from './database';

export { seedModelContextDefaults, seedPricingDefaults } from './model-catalog/defaults';

export function getModelContextForDb(
  database: DatabaseConnection,
  model?: string,
): number | undefined {
  if (!model) return undefined;
  const row = database
    .prepare('SELECT context_window as contextWindow FROM model_context WHERE model = ?')
    .get(model) as { contextWindow: number } | undefined;
  return row?.contextWindow;
}
