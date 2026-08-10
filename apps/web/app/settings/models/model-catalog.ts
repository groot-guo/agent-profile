import type {
  ModelCatalogInventoryItem,
  ModelCatalogRecalculationPreview,
} from '@agent-profile/contracts';

export type CatalogPriority = 'unsupported' | 'unpriced' | 'context-missing' | 'configured';
export type CatalogIdentityGroup = 'billable' | 'review' | 'excluded';

export interface PricingDraft {
  inputPrice: string;
  cacheCreationPrice: string;
  cacheReadPrice: string;
  outputPrice: string;
  effectiveAt: string;
  sourceReference: string;
}

interface PricingPayload {
  inputPrice: number;
  cacheCreationPrice: number;
  cacheReadPrice: number;
  outputPrice: number;
  effectiveFrom?: number;
  sourceReference?: string;
}

type PricingValidation = { ok: true; value: PricingPayload } | { ok: false; error: string };

export function catalogPriority(item: ModelCatalogInventoryItem): CatalogPriority {
  if (item.pricing?.status === 'unsupported') return 'unsupported';
  if (!item.pricingKnown) return 'unpriced';
  if (!item.contextKnown) return 'context-missing';
  return 'configured';
}

export function catalogIdentityGroup(item: ModelCatalogInventoryItem): CatalogIdentityGroup {
  if (item.billingEligibility === 'billable') return 'billable';
  if (item.billingEligibility === 'excluded') return 'excluded';
  return 'review';
}

export function identityGroupLabel(group: CatalogIdentityGroup): string {
  if (group === 'billable') return '可计费模型';
  if (group === 'excluded') return '排除标签';
  return '待审查标签';
}

const PRIORITY_ORDER: Record<CatalogPriority, number> = {
  unsupported: 0,
  unpriced: 1,
  'context-missing': 2,
  configured: 3,
};

export function sortCatalogModels(
  models: ModelCatalogInventoryItem[],
): ModelCatalogInventoryItem[] {
  return [...models].sort((left, right) => {
    const priority = PRIORITY_ORDER[catalogPriority(left)] - PRIORITY_ORDER[catalogPriority(right)];
    if (priority !== 0) return priority;
    if (right.observedSpans !== left.observedSpans) return right.observedSpans - left.observedSpans;
    if (right.latestObservedAt !== left.latestObservedAt) {
      return right.latestObservedAt - left.latestObservedAt;
    }
    return left.model.localeCompare(right.model);
  });
}

function parsePrice(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function buildPricingPayload(draft: PricingDraft): PricingValidation {
  const inputPrice = parsePrice(draft.inputPrice);
  const cacheCreationPrice = parsePrice(draft.cacheCreationPrice);
  const cacheReadPrice = parsePrice(draft.cacheReadPrice);
  const outputPrice = parsePrice(draft.outputPrice);
  if (
    inputPrice === null ||
    cacheCreationPrice === null ||
    cacheReadPrice === null ||
    outputPrice === null
  ) {
    return { ok: false, error: '四类价格都必须是大于或等于 0 的数字。' };
  }
  const effectiveFrom = draft.effectiveAt ? new Date(draft.effectiveAt).getTime() : undefined;
  if (effectiveFrom !== undefined && !Number.isFinite(effectiveFrom)) {
    return { ok: false, error: '生效时间不是有效的本地日期时间。' };
  }
  const sourceReference = draft.sourceReference.trim() || undefined;
  return {
    ok: true,
    value: {
      inputPrice,
      cacheCreationPrice,
      cacheReadPrice,
      outputPrice,
      ...(effectiveFrom === undefined ? {} : { effectiveFrom }),
      ...(sourceReference ? { sourceReference } : {}),
    },
  };
}

export function isPreviewCurrent(
  preview: Pick<ModelCatalogRecalculationPreview, 'pricingRevision'> | null,
  currentRevision: string,
): boolean {
  return preview?.pricingRevision === currentRevision;
}

export function formatCatalogDate(timestamp?: number): string {
  if (timestamp === undefined) return '未记录';
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
}

export function toLocalDateTime(timestamp: number): string {
  const date = new Date(timestamp - new Date(timestamp).getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}
