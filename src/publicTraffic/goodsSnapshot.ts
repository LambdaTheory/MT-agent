import type { GoodsSnapshotItem, NewProductObservationItem } from './types.js';

function internalIdNumber(item: GoodsSnapshotItem): number {
  const parsed = Number.parseInt(item.internalProductId, 10);
  return Number.isFinite(parsed) ? parsed : -1;
}

export function detectNewGoods(date: string, previous: GoodsSnapshotItem[], current: GoodsSnapshotItem[]): NewProductObservationItem[] {
  const previousIds = new Set(previous.map((item) => item.internalProductId));
  return current
    .filter((item) => item.internalProductId && !previousIds.has(item.internalProductId))
    .map((item) => ({ ...item, date, source: 'goods_diff' }));
}

export function latestInternalIds(items: GoodsSnapshotItem[], limit: number): GoodsSnapshotItem[] {
  return [...items].sort((left, right) => internalIdNumber(right) - internalIdNumber(left)).slice(0, limit);
}
