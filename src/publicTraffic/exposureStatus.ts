import type { ExposureCumulativeProduct, ExposureLinkStatus } from './types.js';

const ACTIVE_LABEL = '\u51fa\u552e\u4e2d';
const REMOVED_LABEL = '\u5df2\u4e0b\u67b6';
const ACTIVE_STATUS_PATTERN = /\u51fa\s*\u552e\s*\u4e2d/u;
const REMOVED_STATUS_PATTERN = /\u5df2\s*\u4e0b\s*\u67b6/u;

function normalizeText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function normalizeExposureStatusLabel(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  if (REMOVED_STATUS_PATTERN.test(text)) return REMOVED_LABEL;
  if (ACTIVE_STATUS_PATTERN.test(text)) return ACTIVE_LABEL;
  return null;
}

export function parseExposureLinkStatus(value: unknown): ExposureLinkStatus {
  const label = normalizeExposureStatusLabel(value);
  if (label === REMOVED_LABEL) return 'removed';
  if (label === ACTIVE_LABEL) return 'active';
  return 'unknown';
}

export function listingStatusOf(product: Pick<ExposureCumulativeProduct, 'listingStatus'>): ExposureLinkStatus {
  return product.listingStatus ?? 'unknown';
}

export function isRemovedExposureProduct(product: Pick<ExposureCumulativeProduct, 'listingStatus'>): boolean {
  return listingStatusOf(product) === 'removed';
}
