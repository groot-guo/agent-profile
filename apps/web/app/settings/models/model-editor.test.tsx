import type { ModelCatalogInventoryItem } from '@agent-profile/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ModelEditor } from './model-editor';

const item: ModelCatalogInventoryItem = {
  model: 'claude-opus-4-8-20260905',
  identityKind: 'model',
  billingEligibility: 'billable',
  observedSpans: 2,
  observedSessions: 1,
  latestObservedAt: 0,
  pricing: null,
  pricingAlias: null,
  context: null,
  pricingKnown: false,
  contextKnown: false,
  historicalCostSyncPending: false,
};

function renderEditor(historicalCostSyncPending: boolean): string {
  return renderToStaticMarkup(
    createElement(ModelEditor, {
      item: { ...item, historicalCostSyncPending },
      history: [],
      pricingRevision: 'revision-1',
      onReload: async () => {},
      onFeedback: () => {},
    }),
  );
}

describe('ModelEditor price synchronization notice', () => {
  it('offers an explicit model-scoped preview when stored price provenance is stale', () => {
    const markup = renderEditor(true);

    expect(markup).toContain('当前价格 revision 尚未同步');
    expect(markup).toContain('查看历史同步预览');
    expect(markup).toContain('claude-opus-4-8-20260905');
  });

  it('does not show the pending notice when stored provenance matches the price revision', () => {
    expect(renderEditor(false)).not.toContain('当前价格 revision 尚未同步');
  });
});
