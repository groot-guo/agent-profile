import type { ModelCatalogInventoryItem } from '@agent-profile/contracts';
import { describe, expect, it } from 'vitest';
import {
  buildPricingPayload,
  catalogIdentityGroup,
  catalogPriority,
  formatCatalogDate,
  isPreviewCurrent,
  type PricingDraft,
  sortCatalogModels,
} from './model-catalog';

function inventory(
  model: string,
  overrides: Partial<ModelCatalogInventoryItem> = {},
): ModelCatalogInventoryItem {
  return {
    model,
    identityKind: 'model',
    billingEligibility: 'billable',
    observedSpans: 1,
    observedSessions: 1,
    latestObservedAt: 100,
    pricing: null,
    pricingAlias: null,
    context: null,
    pricingKnown: false,
    contextKnown: false,
    ...overrides,
  };
}

describe('Model Catalog workspace view model', () => {
  it('prioritizes observed unsupported and unpriced models before configured models', () => {
    const configured = inventory('configured', {
      observedSpans: 100,
      pricingKnown: true,
      contextKnown: true,
      pricing: {
        model: 'configured',
        inputPrice: 1,
        cacheCreationPrice: 1,
        cacheReadPrice: 0.1,
        outputPrice: 2,
        currency: 'CNY',
        unit: 'per_million_tokens',
        effectiveFrom: 0,
        sourceKind: 'manual',
        pricingScheme: 'flat_four_token_classes',
        revision: 1,
        status: 'active',
        createdAt: 1,
      },
    });
    const unsupported = inventory('unsupported', {
      pricing: configured.pricing
        ? { ...configured.pricing, model: 'unsupported', status: 'unsupported' }
        : null,
    });
    const unpriced = inventory('unpriced', { observedSpans: 20 });

    expect(
      sortCatalogModels([configured, unpriced, unsupported]).map((item) => item.model),
    ).toEqual(['unsupported', 'unpriced', 'configured']);
    expect(catalogPriority(configured)).toBe('configured');
  });

  it('validates four-token pricing and converts local effective time to epoch milliseconds', () => {
    const draft: PricingDraft = {
      inputPrice: '1.5',
      cacheCreationPrice: '2',
      cacheReadPrice: '0.25',
      outputPrice: '8',
      effectiveAt: '2026-07-31T12:30',
      sourceReference: ' https://example.com/pricing ',
    };

    expect(buildPricingPayload(draft)).toEqual({
      ok: true,
      value: {
        inputPrice: 1.5,
        cacheCreationPrice: 2,
        cacheReadPrice: 0.25,
        outputPrice: 8,
        effectiveFrom: new Date('2026-07-31T12:30').getTime(),
        sourceReference: 'https://example.com/pricing',
      },
    });
    expect(buildPricingPayload({ ...draft, outputPrice: '-1' })).toEqual({
      ok: false,
      error: '四类价格都必须是大于或等于 0 的数字。',
    });
  });

  it('rejects execution when a preview no longer matches the current pricing revision', () => {
    expect(isPreviewCurrent({ pricingRevision: 'revision-a' }, 'revision-a')).toBe(true);
    expect(isPreviewCurrent({ pricingRevision: 'revision-a' }, 'revision-b')).toBe(false);
  });

  it('keeps the epoch-zero applicability time distinct from missing time', () => {
    expect(formatCatalogDate(0)).not.toBe('未记录');
    expect(formatCatalogDate()).toBe('未记录');
  });

  it('groups inventory into billable, review, and excluded identity buckets', () => {
    expect(catalogIdentityGroup(inventory('gpt-5.6-sol'))).toBe('billable');
    expect(
      catalogIdentityGroup(
        inventory('astron-code-latest', {
          identityKind: 'opaque',
          billingEligibility: 'excluded',
        }),
      ),
    ).toBe('excluded');
    expect(
      catalogIdentityGroup(
        inventory('<synthetic>', {
          identityKind: 'synthetic',
          billingEligibility: 'excluded',
        }),
      ),
    ).toBe('excluded');
    expect(
      catalogIdentityGroup(
        inventory('custom-label', {
          identityKind: 'unknown',
          billingEligibility: 'review_required',
        }),
      ),
    ).toBe('review');
  });
});
