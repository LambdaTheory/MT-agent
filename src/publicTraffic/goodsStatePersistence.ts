import { mutateJsonFileSerialized } from '../linkRegistry/persistence.js';
import { updateGoodsLinkLifecycle, type GoodsLinkLifecycleState, type GoodsRemovedLinkItem } from './goodsLinkLifecycle.js';
import { updateGoodsFirstSeen, type GoodsFirstSeenIndex } from './goodsSnapshot.js';
import type { GoodsSnapshotItem } from './types.js';

export function isGoodsLinkLifecycleState(value: unknown): value is GoodsLinkLifecycleState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  if (!state.active || typeof state.active !== 'object' || Array.isArray(state.active) || !Array.isArray(state.removedLinks)) return false;
  const activeValid = Object.values(state.active as Record<string, unknown>).every((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const record = entry as Record<string, unknown>;
    return typeof record.platformProductId === 'string' && typeof record.productName === 'string';
  });
  const removedValid = state.removedLinks.every((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const record = entry as Record<string, unknown>;
    return (
      typeof record.productId === 'string' &&
      typeof record.platformProductId === 'string' &&
      typeof record.productName === 'string' &&
      typeof record.removedDate === 'string' &&
      record.reason === '商品总表缺失' &&
      record.source === 'goods_snapshot_diff'
    );
  });
  return activeValid && removedValid;
}

export async function mutateGoodsSnapshotStateSerialized(
  path: string,
  compute: (previous: GoodsSnapshotItem[]) => GoodsSnapshotItem[] | Promise<GoodsSnapshotItem[]>,
): Promise<{ previous: GoodsSnapshotItem[]; current: GoodsSnapshotItem[] }> {
  let previousSnapshot: GoodsSnapshotItem[] = [];
  const current = await mutateJsonFileSerialized<GoodsSnapshotItem[]>(path, [], async (previous) => {
    previousSnapshot = previous;
    return compute(previous);
  });
  return { previous: previousSnapshot, current };
}

export async function updateGoodsFirstSeenStateSerialized(input: {
  path: string;
  currentDate: string;
  current: GoodsSnapshotItem[];
}): Promise<GoodsFirstSeenIndex> {
  let updated: GoodsFirstSeenIndex = {};
  await mutateJsonFileSerialized<GoodsFirstSeenIndex | null>(input.path, null, (previous) => {
    updated = updateGoodsFirstSeen({
      currentDate: input.currentDate,
      previous: previous ?? {},
      current: input.current,
      baseline: previous === null,
    });
    return updated;
  });
  return updated;
}

export async function updateGoodsLinkLifecycleStateSerialized(input: {
  path: string;
  currentDate: string;
  current: GoodsSnapshotItem[];
  suppressNewRemovals?: boolean;
  onInvalidState?: () => void;
}): Promise<{ state: GoodsLinkLifecycleState; removedLinks: GoodsRemovedLinkItem[] }> {
  let result: { state: GoodsLinkLifecycleState; removedLinks: GoodsRemovedLinkItem[] } | null = null;
  await mutateJsonFileSerialized<unknown>(input.path, null, (previous) => {
    const validPrevious = isGoodsLinkLifecycleState(previous) ? previous : null;
    if (previous !== null && validPrevious === null) input.onInvalidState?.();
    result = updateGoodsLinkLifecycle({
      currentDate: input.currentDate,
      previous: validPrevious,
      current: input.current,
      suppressNewRemovals: input.suppressNewRemovals,
    });
    return result.state;
  });
  if (result === null) throw new Error('Failed to update goods link lifecycle state');
  return result;
}
