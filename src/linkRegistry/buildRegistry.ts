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
  categoryId?: string;
  categoryName?: string;
  productType?: string;
  shortName?: string;
  sameSkuGroupId?: string;
  status?: LinkRegistryStatus;
  firstSeenDate?: string;
  lastSeenDate?: string;
  nameHints: Set<string>;
  aliases: Set<string>;
  sources: Set<LinkRegistrySource>;
}

function normalizedShortName(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const canonical = canonicalProductShortName(trimmed).trim();
  if (!canonical) return trimmed;
  if (canonical.length <= trimmed.length || trimmed.length >= 18) return canonical;
  return trimmed;
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
    const shortName = normalizedShortName(name) ?? name.trim();
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

function bestNameHint(hints: Set<string>): string | undefined {
  const candidates = [...hints]
    .map((value) => value.trim())
    .filter(Boolean)
    .sort((left, right) => left.length - right.length || left.localeCompare(right));
  return candidates.find((value) => value.length <= 24) ?? candidates[0];
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

function inferredShortNameFromGroupId(groupId: string): string | undefined {
  const trimmed = groupId.trim();
  if (!trimmed) return undefined;

  const patterns: Array<[RegExp, (...match: string[]) => string]> = [
    [/^dji-pocket-(3|4)$/i, (model) => `Pocket ${model}`],
    [/^dji-action-(4|5)-pro$/i, (model) => `Action ${model} Pro`],
    [/^dji-osmo-nano$/i, () => 'Osmo Nano'],
    [/^dji.*mobile-7p/i, () => 'mobile 7p'],
    [/^insta360-ace-pro-2$/i, () => 'Ace Pro 2'],
    [/^insta360-ace-pro$/i, () => 'Ace Pro'],
    [/^insta360-go-3s$/i, () => 'GO 3S'],
    [/^fujifilm-instax-wide-(300|400)$/i, (model) => `Wide ${model}`],
    [/^fujifilm-instax-mini-(11|12|40|90|99)$/i, (model) => `Mini ${model}`],
    [/^fujifilm-instax-square-(sq1|sq20|sq40)$/i, (model) => model.toUpperCase()],
    [/^fujifilm-(mini|wide)-evo$/i, (variant) => `${variant.toLowerCase()} evo`],
    [/^fujifilm-x-half$/i, () => 'X Half'],
    [/^canon-sx(\d+)(?:-hs)?$/i, (model) => `SX${model}`],
    [/^canon(?:-eos)?-r50$/i, () => 'r50'],
    [/^canon(?:-ccd)?-ixus-?130/i, () => 'IXUS 130'],
    [/^canon-cp1500$/i, () => 'CP1500'],
    [/^sony-.*zv1/i, () => 'ZV-1'],
    [/^vivo-x(\d+)-ultra$/i, (model) => `x${model} u`],
    [/^vivo x(\d+) pro$/i, (model) => `x${model}p`],
    [/^vivox(\d+)-pro$/i, (model) => `x${model}p`],
    [/^三星galaxy s23ultra$/u, () => 's23U'],
    [/^vivo-蔡司-2-35x增距镜-神器$/u, () => 'vivo 蔡司增距镜'],
    [/^fujifilm-mini-evo$/i, () => 'mini evo'],
    [/^fujifilm-wide-evo$/i, () => 'wide evo'],
  ];

  for (const [pattern, formatter] of patterns) {
    const match = trimmed.match(pattern);
    if (match) return formatter(...match.slice(1));
  }

  return undefined;
}

interface InferredClassification {
  categoryId: string;
  categoryName: string;
  productType: string;
}

function inferredClassificationFrom(draft: DraftEntry): InferredClassification | undefined {
  const key = [
    draft.sameSkuGroupId?.trim(),
    draft.shortName?.trim(),
    bestNameHint(draft.nameHints),
    draft.productName?.trim(),
  ].filter(Boolean).join(' ').toLowerCase();

  if (!key) return undefined;
  if (/iphone|vivo x\d+|x\d+\s*u(?:ltra)?|x\d+u\b|x\d+\s*p(?:ro)?|x\d+p\b|galaxy s23|s23u/.test(key)) {
    return { categoryId: 'phone', categoryName: '手机', productType: 'smartphone' };
  }
  if (/ipad/.test(key)) return { categoryId: 'tablet', categoryName: '平板', productType: 'tablet' };
  if (/增距镜|rf |镜头|长焦镜/.test(key)) return { categoryId: 'lens', categoryName: '镜头', productType: 'lens-accessory' };
  if (/mobile 7p|手机稳定器|手持云台/.test(key)) return { categoryId: 'gimbal', categoryName: '稳定器', productType: 'phone-gimbal' };
  if (/tripod|三脚架|fy820|fy830/.test(key)) return { categoryId: 'accessory', categoryName: '配件', productType: 'tripod' };
  if (/cp1500|打印机/.test(key)) return { categoryId: 'printer', categoryName: '打印机', productType: 'photo-printer' };
  if (/action|ace pro|go 3s/.test(key)) return { categoryId: 'camera', categoryName: '运动相机', productType: 'action-camera' };
  if (/pocket|instax|liplay|mini evo|wide evo|mini\s*(11|12|40|90|99)|wide\s*(300|400)|sq(1|20|40)|x-half|x half|x100v|rx10m4|zv-1|zv1|sx\d+|r50|ixus|g7x|g11|g12|zs\d+|fz\d+|a900|b700|p1000|osmo nano/.test(key)) {
    const productType = /pocket/.test(key)
      ? 'gimbal-camera'
      : /instax|liplay|mini evo|wide evo|mini\s*(11|12|40|90|99)|wide\s*(300|400)|sq(1|20|40)/.test(key)
        ? 'instant-camera'
        : 'camera';
    return { categoryId: 'camera', categoryName: '相机', productType };
  }
  return undefined;
}

function inferDraftMetadata(drafts: Map<string, DraftEntry>): void {
  for (const draft of drafts.values()) {
    draft.shortName = normalizedShortName(draft.shortName) ?? draft.shortName;
    if (!draft.shortName) {
      draft.shortName = inferredShortNameFromGroupId(draft.sameSkuGroupId ?? '')
        ?? bestNameHint(draft.nameHints);
      if (draft.shortName) addNameHint(draft, draft.shortName);
    }

    if (!draft.categoryId || !draft.categoryName || !draft.productType) {
      const inferred = inferredClassificationFrom(draft);
      if (inferred) {
        draft.categoryId ??= inferred.categoryId;
        draft.categoryName ??= inferred.categoryName;
        draft.productType ??= inferred.productType;
      }
    }
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
    ...(draft.categoryId ? { categoryId: draft.categoryId } : {}),
    ...(draft.categoryName ? { categoryName: draft.categoryName } : {}),
    ...(draft.productType ? { productType: draft.productType } : {}),
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
  inferDraftMetadata(drafts);

  return [...drafts.values()].map(finalizeEntry).sort(compareInternalProductId);
}
