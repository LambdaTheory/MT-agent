import type { ProductIdMapping } from '../mapping/productIdMapping.js';
import type { GoodsLinkLifecycleState, GoodsRemovedLinkItem } from '../publicTraffic/goodsLinkLifecycle.js';
import type { GoodsFirstSeenIndex } from '../publicTraffic/goodsSnapshot.js';
import { canonicalProductShortName, type ProductNameMap } from '../publicTraffic/productDisplayName.js';
import type { LinkRegistryEntry, LinkRegistrySource, LinkRegistryStatus } from './types.js';

export interface BuildLinkRegistryInput {
  productIdMapping?: ProductIdMapping;
  productNameMap?: ProductNameMap;
  productNameHints?: Record<string, string | string[]>;
  firstSeen?: GoodsFirstSeenIndex;
  lifecycle?: GoodsLinkLifecycleState | null;
}

interface DraftEntry {
  internalProductId: string;
  platformProductId?: string;
  productName?: string;
  shortName?: string;
  sameSkuGroupId?: string;
  status?: LinkRegistryStatus;
  firstSeenDate?: string;
  lastSeenDate?: string;
  nameHints: Set<string>;
  aliases: Set<string>;
  sources: Set<LinkRegistrySource>;
}

function validInternalId(value: string): string | null {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? trimmed : null;
}

function draftFor(drafts: Map<string, DraftEntry>, internalProductId: string): DraftEntry {
  const existing = drafts.get(internalProductId);
  if (existing) return existing;

  const draft: DraftEntry = { internalProductId, nameHints: new Set<string>(), aliases: new Set<string>(), sources: new Set<LinkRegistrySource>() };
  drafts.set(internalProductId, draft);
  return draft;
}

function setPlatformProductId(draft: DraftEntry, platformProductId: string): void {
  const trimmed = platformProductId.trim();
  if (trimmed && !draft.platformProductId) draft.platformProductId = trimmed;
}

function setProductName(draft: DraftEntry, productName: string): void {
  const trimmed = productName.trim();
  if (trimmed && !draft.productName) draft.productName = trimmed;
}

function addNameHint(draft: DraftEntry, value: string | undefined): void {
  const trimmed = value?.trim();
  if (!trimmed) return;
  const canonical = canonicalProductShortName(trimmed);
  if (canonical) draft.nameHints.add(canonical);
  draft.aliases.add(trimmed);
  draft.aliases.add(canonical);
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
    addNameHint(draft, shortName);
    draft.sources.add('product_name_map');
  }
}

function addFirstSeen(drafts: Map<string, DraftEntry>, firstSeen: GoodsFirstSeenIndex): void {
  for (const [internalProductIdValue, entry] of Object.entries(firstSeen)) {
    const internalProductId = validInternalId(internalProductIdValue);
    if (!internalProductId) continue;

    const draft = draftFor(drafts, internalProductId);
    setPlatformProductId(draft, entry.platformProductId);
    setProductName(draft, entry.productName);
    draft.firstSeenDate = entry.firstSeenDate;
    addNameHint(draft, entry.productName);
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
    setProductName(draft, entry.productName);
    draft.status = 'active';
    addNameHint(draft, entry.productName);
    draft.sources.add('goods_link_lifecycle');
  }

  for (const [internalProductId, item] of latestRemovedByInternalId(lifecycle.removedLinks)) {
    const draft = draftFor(drafts, internalProductId);
    setPlatformProductId(draft, item.platformProductId);
    setProductName(draft, item.productName);
    addNameHint(draft, item.productName);
    if (draft.status !== 'active') {
      draft.status = 'removed';
      draft.lastSeenDate = item.removedDate;
    }
    draft.sources.add('goods_link_lifecycle');
  }
}

function addProductNameHints(drafts: Map<string, DraftEntry>, productNameHints: Record<string, string | string[]>): void {
  for (const [internalProductIdValue, hints] of Object.entries(productNameHints)) {
    const internalProductId = validInternalId(internalProductIdValue);
    if (!internalProductId) continue;
    const draft = draftFor(drafts, internalProductId);
    const values = Array.isArray(hints) ? hints : [hints];
    for (const value of values) addNameHint(draft, value);
  }
}

function sameSkuBrandPrefix(name: string): string {
  if (/^佳能/u.test(name)) return 'canon';
  if (/^索尼/u.test(name)) return 'sony';
  if (/^(?:大疆|DJI)(?:\s|$)/iu.test(name)) return 'dji';
  if (/^(?:影石\s*)?Insta360(?:\s|$)/iu.test(name)) return 'insta360';
  if (/^富士/u.test(name)) return 'fujifilm';
  if (/^尼康/u.test(name)) return 'nikon';
  if (/^松下/u.test(name)) return 'panasonic';
  if (/^vivo(?:\s|$)/iu.test(name)) return 'vivo';
  if (/^iPhone(?:\s|$)/iu.test(name)) return 'iphone';
  if (/^iPad(?:\s|$)/iu.test(name)) return 'ipad';
  if (/^苹果/u.test(name)) return 'apple';
  return '';
}

function sameSkuSlug(name: string): string {
  const prefix = sameSkuBrandPrefix(name);
  const withoutBrand = prefix
    ? name
        .replace(/^佳能\s*/u, '')
        .replace(/^索尼\s*/u, '')
        .replace(/^(?:大疆|DJI)\s*/iu, '')
        .replace(/^(?:影石\s*)?Insta360\s*/iu, '')
        .replace(/^富士\s*/u, '')
        .replace(/^尼康\s*/u, '')
        .replace(/^松下\s*/u, '')
        .replace(/^vivo\s*/iu, '')
        .replace(/^iPhone\s*/iu, '')
        .replace(/^iPad\s*/iu, '')
        .replace(/^苹果\s*/u, '')
    : name;
  const normalized = withoutBrand
    .toLowerCase()
    .replace(/[（）()]/g, ' ')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
  return [prefix, normalized].filter(Boolean).join('-') || normalized;
}

function canInferSameSkuGroup(name: string): boolean {
  return Boolean(sameSkuBrandPrefix(name)) || /\d/.test(name);
}

function assignSameSkuGroupIds(drafts: Map<string, DraftEntry>): void {
  for (const draft of drafts.values()) {
    const preferredName = draft.shortName?.trim() || [...draft.nameHints][0];
    if (!preferredName) continue;
    const canonical = canonicalProductShortName(preferredName);
    if (!canInferSameSkuGroup(canonical)) continue;
    const groupId = sameSkuSlug(canonical);
    if (groupId) draft.sameSkuGroupId = groupId;
  }
}

function compareInternalProductId(left: LinkRegistryEntry, right: LinkRegistryEntry): number {
  const leftNumber = Number(left.internalProductId);
  const rightNumber = Number(right.internalProductId);
  return leftNumber - rightNumber || left.internalProductId.localeCompare(right.internalProductId);
}

function confidenceFor(draft: DraftEntry): number {
  let score = 0.15;
  if (draft.platformProductId) score += 0.2;
  if (draft.productName) score += 0.15;
  if (draft.shortName) score += 0.2;
  if (draft.sameSkuGroupId) score += 0.15;
  if (draft.status && draft.status !== 'unknown') score += 0.1;
  if (draft.firstSeenDate || draft.lastSeenDate) score += 0.1;
  if (draft.sources.size >= 3) score += 0.1;
  return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}

function updatedAtFor(draft: DraftEntry): string | undefined {
  return [draft.lastSeenDate, draft.firstSeenDate].find((value) => !!value);
}

function finalizeEntry(draft: DraftEntry): LinkRegistryEntry {
  const aliases = [...draft.aliases]
    .map((value) => value.trim())
    .filter((value) => !!value)
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort();
  return {
    internalProductId: draft.internalProductId,
    ...(draft.platformProductId ? { platformProductId: draft.platformProductId } : {}),
    ...(draft.productName ? { productName: draft.productName } : {}),
    ...(draft.shortName ? { shortName: draft.shortName } : {}),
    ...(aliases.length > 0 ? { aliases } : {}),
    ...(draft.sameSkuGroupId ? { sameSkuGroupId: draft.sameSkuGroupId } : {}),
    status: draft.status ?? 'unknown',
    ...(draft.firstSeenDate ? { firstSeenDate: draft.firstSeenDate } : {}),
    ...(draft.lastSeenDate ? { lastSeenDate: draft.lastSeenDate } : {}),
    confidence: confidenceFor(draft),
    ...(updatedAtFor(draft) ? { updatedAt: updatedAtFor(draft) } : {}),
    source: [...draft.sources].sort(),
  };
}

export function buildLinkRegistry(input: BuildLinkRegistryInput): LinkRegistryEntry[] {
  const drafts = new Map<string, DraftEntry>();

  addProductIdMapping(drafts, input.productIdMapping ?? {});
  addProductNameMap(drafts, input.productNameMap ?? {});
  addProductNameHints(drafts, input.productNameHints ?? {});
  addFirstSeen(drafts, input.firstSeen ?? {});
  if (input.lifecycle) addLifecycle(drafts, input.lifecycle);
  assignSameSkuGroupIds(drafts);

  return [...drafts.values()].map(finalizeEntry).sort(compareInternalProductId);
}
