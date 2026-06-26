import type { ActivitySubmitSessionProduct } from './submitSession.js';

export interface ActivityCancellationProduct extends ActivitySubmitSessionProduct {
  productName?: string;
}

export interface ActivityCancellationPickProduct {
  platformProductId: string;
  merchantProductId: string;
  productName?: string;
}

export interface ActivityListRowSnapshot {
  productName: string;
  activityTime: string;
  status: string;
  operationText: string;
}

export interface ActivityListExtractedProductIds {
  platformProductIds: string[];
  merchantProductIds: string[];
  internalProductIds: string[];
}

const PRODUCT_NAME_TRUNCATION_MARKERS = [
  '\u5e73\u53f0\u4fa7\u7f16\u7801',
  '\u5546\u5bb6\u4fa7\u7f16\u7801',
  'ID:',
  'ID：',
];
const PLATFORM_PRODUCT_ID_PATTERN = /\b(20\d{17,})\b/gu;
const MERCHANT_PRODUCT_ID_PATTERN = /\b([A-Za-z0-9]{6,}(?:-[A-Za-z0-9]{2,10}){2,})\b/gu;
const INTERNAL_PRODUCT_ID_PATTERN = /(?:端内ID|内部ID|商品ID中间位)\s*[:：]?\s*(\d{2,10})/gu;

const CANCEL_BUTTON_PATTERNS: Array<[RegExp, number]> = [
  [/\u53d6\u6d88\u5dee\u5f02\u5316\u5b9a\u4ef7/u, 600],
  [/\u6279\u91cf\u5220\u9664/u, 580],
  [/\u79fb\u9664/u, 560],
  [/\u53d6\u6d88\u6d3b\u52a8/u, 520],
  [/\u7ed3\u675f\u6d3b\u52a8/u, 500],
  [/\u505c\u6b62\u6d3b\u52a8/u, 480],
  [/\u5220\u9664/u, 300],
  [/\u53d6\u6d88/u, 260],
  [/\u7ed3\u675f/u, 220],
] as const;

function normalizeText(value: string | null | undefined): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))];
}

export function extractActivityListProductIds(text: string): ActivityListExtractedProductIds {
  const normalized = normalizeText(text);
  return {
    platformProductIds: unique(Array.from(normalized.matchAll(PLATFORM_PRODUCT_ID_PATTERN), (match) => match[1] ?? '')),
    merchantProductIds: unique(Array.from(normalized.matchAll(MERCHANT_PRODUCT_ID_PATTERN), (match) => match[1] ?? '')),
    internalProductIds: unique(Array.from(normalized.matchAll(INTERNAL_PRODUCT_ID_PATTERN), (match) => match[1] ?? '')),
  };
}

export function simplifyCancellationProductName(value: string | undefined): string {
  let normalized = normalizeText(value);
  for (const marker of PRODUCT_NAME_TRUNCATION_MARKERS) {
    const index = normalized.indexOf(marker);
    if (index >= 0) normalized = normalized.slice(0, index).trim();
  }
  return normalized.replace(/\.{2,}|…+/gu, '').trim();
}

export function hydrateActivityCancellationProducts(
  sessionProducts: ActivitySubmitSessionProduct[],
  pickedProducts: ActivityCancellationPickProduct[] = [],
): ActivityCancellationProduct[] {
  const pickedIndex = new Map(
    pickedProducts.flatMap((product) => {
      const keys = [product.platformProductId, product.merchantProductId].filter(Boolean);
      return keys.map((key) => [key, product] as const);
    }),
  );

  return sessionProducts.map((product) => {
    const picked = pickedIndex.get(product.platformProductId) ?? pickedIndex.get(product.merchantProductId);
    return {
      ...product,
      ...(picked?.productName ? { productName: picked.productName } : {}),
    };
  });
}

function containsDate(text: string, date: string | undefined): boolean {
  if (!date) return true;
  return normalizeText(text).includes(date);
}

function plusOneDay(date: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1));
  return parsed.toISOString().slice(0, 10);
}

function matchesEndDate(text: string, date: string | undefined): boolean {
  if (!date) return true;
  if (containsDate(text, date)) return true;
  const plusOne = plusOneDay(date);
  return plusOne ? containsDate(text, plusOne) : false;
}

export function matchesActivityListRow(
  row: ActivityListRowSnapshot,
  input: { products: ActivityCancellationProduct[]; startsAt?: string; endsAt?: string },
): boolean {
  const rowProductName = simplifyCancellationProductName(row.productName);
  const productMatched = input.products.length === 0
    || input.products.some((product) => {
      const expected = simplifyCancellationProductName(product.productName);
      return expected ? rowProductName.includes(expected) || expected.includes(rowProductName) : false;
    });
  if (!productMatched) return false;
  if (!containsDate(row.activityTime, input.startsAt)) return false;
  if (!matchesEndDate(row.activityTime, input.endsAt)) return false;
  return true;
}

function buttonLabelScore(label: string): number {
  const normalized = normalizeText(label);
  for (const [pattern, score] of CANCEL_BUTTON_PATTERNS) {
    if (pattern.test(normalized)) return score;
  }
  return -1;
}

export function chooseCancellationButtonLabel(labels: string[]): string | null {
  return labels
    .map((label) => normalizeText(label))
    .filter((label) => label.length > 0 && buttonLabelScore(label) >= 0)
    .sort((left, right) => buttonLabelScore(right) - buttonLabelScore(left))[0]
    ?? null;
}
