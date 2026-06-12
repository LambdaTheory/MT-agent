import type { GoodsSnapshotItem } from './types.js';

export interface GoodsLinkLifecycleActiveEntry {
  platformProductId: string;
  productName: string;
}

export interface GoodsRemovedLinkItem {
  productId: string;
  platformProductId: string;
  productName: string;
  removedDate: string;
  reason: '商品总表缺失';
  source: 'goods_snapshot_diff';
}

export interface GoodsLinkLifecycleState {
  active: Record<string, GoodsLinkLifecycleActiveEntry>;
  removedLinks: GoodsRemovedLinkItem[];
}

function validInternalId(item: GoodsSnapshotItem): string | null {
  const trimmed = item.internalProductId.trim();
  return /^\d+$/.test(trimmed) ? trimmed : null;
}

function startOfRetentionWindow(referenceDate: string, days: number): Date {
  const reference = new Date(`${referenceDate}T00:00:00.000`);
  reference.setDate(reference.getDate() - days + 1);
  return reference;
}

function inRetentionWindow(removedDate: string, referenceDate: string, days: number): boolean {
  const removed = new Date(`${removedDate}T00:00:00.000`);
  const start = startOfRetentionWindow(referenceDate, days);
  const end = new Date(`${referenceDate}T23:59:59.999`);
  return removed >= start && removed <= end;
}

function activeFromSnapshot(current: GoodsSnapshotItem[]): Record<string, GoodsLinkLifecycleActiveEntry> {
  const active: Record<string, GoodsLinkLifecycleActiveEntry> = {};
  for (const item of current) {
    const id = validInternalId(item);
    if (id === null || active[id]) continue;
    active[id] = { platformProductId: item.platformProductId, productName: item.productName };
  }
  return active;
}

export function updateGoodsLinkLifecycle(input: { currentDate: string; previous: GoodsLinkLifecycleState | null; current: GoodsSnapshotItem[]; retentionDays?: number }): { state: GoodsLinkLifecycleState; removedLinks: GoodsRemovedLinkItem[] } {
  const retentionDays = input.retentionDays ?? 7;
  const active = activeFromSnapshot(input.current);

  if (!input.previous) {
    const state = { active, removedLinks: [] };
    return { state, removedLinks: [] };
  }

  const latestRemoved = new Map<string, GoodsRemovedLinkItem>();
  for (const item of input.previous.removedLinks) {
    if (inRetentionWindow(item.removedDate, input.currentDate, retentionDays)) latestRemoved.set(item.productId, item);
  }

  for (const [productId, entry] of Object.entries(input.previous.active)) {
    if (active[productId]) continue;
    latestRemoved.set(productId, {
      productId,
      platformProductId: entry.platformProductId,
      productName: entry.productName,
      removedDate: input.currentDate,
      reason: '商品总表缺失',
      source: 'goods_snapshot_diff',
    });
  }

  const removedLinks = [...latestRemoved.values()]
    .filter((item) => inRetentionWindow(item.removedDate, input.currentDate, retentionDays))
    .sort((left, right) => right.removedDate.localeCompare(left.removedDate) || left.productId.localeCompare(right.productId));
  const state = { active, removedLinks };
  return { state, removedLinks };
}
