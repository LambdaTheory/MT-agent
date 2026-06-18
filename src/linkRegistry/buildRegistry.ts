import type { ProductIdMapping } from '../mapping/productIdMapping.js';
import type { GoodsLinkLifecycleState, GoodsRemovedLinkItem } from '../publicTraffic/goodsLinkLifecycle.js';
import type { GoodsFirstSeenIndex } from '../publicTraffic/goodsSnapshot.js';
import type { ProductNameMap } from '../publicTraffic/productDisplayName.js';
import type { LinkRegistryEntry, LinkRegistrySource, LinkRegistryStatus } from './types.js';

export interface BuildLinkRegistryInput {
  productIdMapping?: ProductIdMapping;
  productNameMap?: ProductNameMap;
  firstSeen?: GoodsFirstSeenIndex;
  lifecycle?: GoodsLinkLifecycleState | null;
}

interface DraftEntry {
  internalProductId: string;
  platformProductId?: string;
  shortName?: string;
  status?: LinkRegistryStatus;
  firstSeenDate?: string;
  lastSeenDate?: string;
  sources: Set<LinkRegistrySource>;
}

function validInternalId(value: string): string | null {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? trimmed : null;
}

function draftFor(drafts: Map<string, DraftEntry>, internalProductId: string): DraftEntry {
  const existing = drafts.get(internalProductId);
  if (existing) return existing;

  const draft: DraftEntry = { internalProductId, sources: new Set<LinkRegistrySource>() };
  drafts.set(internalProductId, draft);
  return draft;
}

function setPlatformProductId(draft: DraftEntry, platformProductId: string): void {
  const trimmed = platformProductId.trim();
  if (trimmed && !draft.platformProductId) draft.platformProductId = trimmed;
}

function addProductIdMapping(drafts: Map<string, DraftEntry>, mapping: ProductIdMapping): void {
  const pairs = Object.entries(mapping).sort(([leftPlatform], [rightPlatform]) => leftPlatform.localeCompare(rightPlatform));
  for (const [platformProductId, internalProductIdValue] of pairs) {
    const internalProductId = validInternalId(internalProductIdValue);
    if (!internalProductId) continue;

    const draft = draftFor(drafts, internalProductId);
    setPlatformProductId(draft, platformProductId);
    draft.sources.add('product_id_mapping');
  }
}

function addProductNameMap(drafts: Map<string, DraftEntry>, productNameMap: ProductNameMap): void {
  for (const [internalProductIdValue, name] of Object.entries(productNameMap)) {
    const internalProductId = validInternalId(internalProductIdValue);
    const shortName = name.trim();
    if (!internalProductId || !shortName) continue;

    const draft = draftFor(drafts, internalProductId);
    draft.shortName = shortName;
    draft.sources.add('product_name_map');
  }
}

function addFirstSeen(drafts: Map<string, DraftEntry>, firstSeen: GoodsFirstSeenIndex): void {
  for (const [internalProductIdValue, entry] of Object.entries(firstSeen)) {
    const internalProductId = validInternalId(internalProductIdValue);
    if (!internalProductId) continue;

    const draft = draftFor(drafts, internalProductId);
    setPlatformProductId(draft, entry.platformProductId);
    draft.firstSeenDate = entry.firstSeenDate;
    draft.sources.add('goods_first_seen');
  }
}

function latestRemovedByInternalId(removedLinks: GoodsRemovedLinkItem[]): Map<string, GoodsRemovedLinkItem> {
  const latest = new Map<string, GoodsRemovedLinkItem>();
  for (const item of removedLinks) {
    const internalProductId = validInternalId(item.productId);
    if (!internalProductId) continue;

    const existing = latest.get(internalProductId);
    if (!existing || item.removedDate > existing.removedDate) latest.set(internalProductId, item);
  }
  return latest;
}

function addLifecycle(drafts: Map<string, DraftEntry>, lifecycle: GoodsLinkLifecycleState): void {
  for (const [internalProductIdValue, entry] of Object.entries(lifecycle.active)) {
    const internalProductId = validInternalId(internalProductIdValue);
    if (!internalProductId) continue;

    const draft = draftFor(drafts, internalProductId);
    setPlatformProductId(draft, entry.platformProductId);
    draft.status = 'active';
    draft.sources.add('goods_link_lifecycle');
  }

  for (const [internalProductId, item] of latestRemovedByInternalId(lifecycle.removedLinks)) {
    const draft = draftFor(drafts, internalProductId);
    setPlatformProductId(draft, item.platformProductId);
    if (draft.status !== 'active') {
      draft.status = 'removed';
      draft.lastSeenDate = item.removedDate;
    }
    draft.sources.add('goods_link_lifecycle');
  }
}

function compareInternalProductId(left: LinkRegistryEntry, right: LinkRegistryEntry): number {
  const leftNumber = Number(left.internalProductId);
  const rightNumber = Number(right.internalProductId);
  return leftNumber - rightNumber || left.internalProductId.localeCompare(right.internalProductId);
}

function finalizeEntry(draft: DraftEntry): LinkRegistryEntry {
  return {
    internalProductId: draft.internalProductId,
    ...(draft.platformProductId ? { platformProductId: draft.platformProductId } : {}),
    ...(draft.shortName ? { shortName: draft.shortName } : {}),
    status: draft.status ?? 'unknown',
    ...(draft.firstSeenDate ? { firstSeenDate: draft.firstSeenDate } : {}),
    ...(draft.lastSeenDate ? { lastSeenDate: draft.lastSeenDate } : {}),
    source: [...draft.sources].sort(),
  };
}

export function buildLinkRegistry(input: BuildLinkRegistryInput): LinkRegistryEntry[] {
  const drafts = new Map<string, DraftEntry>();

  addProductIdMapping(drafts, input.productIdMapping ?? {});
  addProductNameMap(drafts, input.productNameMap ?? {});
  addFirstSeen(drafts, input.firstSeen ?? {});
  if (input.lifecycle) addLifecycle(drafts, input.lifecycle);

  return [...drafts.values()].map(finalizeEntry).sort(compareInternalProductId);
}
