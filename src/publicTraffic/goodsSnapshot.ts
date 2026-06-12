import type { GoodsSnapshotItem, NewProductObservationItem } from './types.js';

export interface GoodsFirstSeenEntry {
  firstSeenDate: string;
  platformProductId: string;
  productName: string;
  baseline?: boolean;
}

export type GoodsFirstSeenIndex = Record<string, GoodsFirstSeenEntry>;

function validInternalId(item: GoodsSnapshotItem): string | null {
  const trimmed = item.internalProductId.trim();
  return /^[0-9]+$/.test(trimmed) ? trimmed : null;
}

function internalIdNumber(item: GoodsSnapshotItem): number {
  const internalId = validInternalId(item);
  return internalId === null ? -1 : Number(internalId);
}

export function detectNewGoods(date: string, previous: GoodsSnapshotItem[], current: GoodsSnapshotItem[]): NewProductObservationItem[] {
  const previousIds = new Set(previous.map(validInternalId).filter((internalId) => internalId !== null));
  const emittedIds = new Set<string>();
  const observations: NewProductObservationItem[] = [];

  for (const item of current) {
    const internalId = validInternalId(item);
    if (internalId === null || previousIds.has(internalId) || emittedIds.has(internalId)) {
      continue;
    }

    emittedIds.add(internalId);
    observations.push({ ...item, internalProductId: internalId, date, source: 'goods_diff' });
  }

  return observations;
}

export function latestInternalIds(items: GoodsSnapshotItem[], limit: number): GoodsSnapshotItem[] {
  if (limit <= 0) {
    return [];
  }

  return [...items]
    .filter((item) => validInternalId(item) !== null)
    .sort((left, right) => internalIdNumber(right) - internalIdNumber(left))
    .slice(0, limit);
}

export function updateGoodsFirstSeen(input: { currentDate: string; previous: GoodsFirstSeenIndex; current: GoodsSnapshotItem[]; baseline?: boolean }): GoodsFirstSeenIndex {
  const next: GoodsFirstSeenIndex = { ...input.previous };
  for (const item of input.current) {
    const internalId = validInternalId(item);
    if (internalId === null || next[internalId]) continue;
    next[internalId] = {
      firstSeenDate: input.currentDate,
      platformProductId: item.platformProductId,
      productName: item.productName,
      ...(input.baseline ? { baseline: true } : {}),
    };
  }
  return next;
}

function startOfWindow(referenceDate: string, days: number): Date {
  const reference = new Date(`${referenceDate}T23:59:59.999`);
  reference.setDate(reference.getDate() - days);
  return reference;
}

export function filterFirstSeenWithinDays(current: GoodsSnapshotItem[], firstSeen: GoodsFirstSeenIndex, referenceDate: string, days: number): GoodsSnapshotItem[] {
  const start = startOfWindow(referenceDate, days);
  const end = new Date(`${referenceDate}T23:59:59.999`);
  return current.filter((item) => {
    const internalId = validInternalId(item);
    if (internalId === null) return false;
    const entry = firstSeen[internalId];
    if (!entry || entry.baseline) return false;
    const firstSeenDate = new Date(`${entry.firstSeenDate}T00:00:00.000`);
    return firstSeenDate >= start && firstSeenDate <= end;
  });
}
