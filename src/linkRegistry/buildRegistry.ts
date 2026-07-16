import type { DaemonCatalogSnapshot } from './daemonCatalog.js';
import type { ProductIdMapping } from '../mapping/productIdMapping.js';
import type { GoodsLinkLifecycleState, GoodsRemovedLinkItem } from '../publicTraffic/goodsLinkLifecycle.js';
import type { GoodsFirstSeenIndex } from '../publicTraffic/goodsSnapshot.js';
import type { ExposureCumulativeProduct, GoodsSnapshotItem, PlatformRestrictionObservation } from '../publicTraffic/types.js';
import { canonicalProductShortName, type ProductNameMap } from '../publicTraffic/productDisplayName.js';
import type { LinkListingState, LinkRegistryEntry, LinkRegistrySource, LinkRegistryStatus, PlatformProductIdConflict } from './types.js';
import { arbitrateListingState, listingStateToStatus, parseListingStateFromText, type ListingStateObservation } from './listingState.js';
import { sameSkuGroupRules } from './overrides.js';
import { attributeDelist, type PlatformRestrictionAttributionObservation } from './delistAttribution.js';
import type { AgentDelistEvent } from './delistOperationEvidence.js';

const LISTING_STATE_FRESHNESS_OVERRIDE_MS = 24 * 60 * 60 * 1000;

export interface BuildLinkRegistryInput {
  productIdMapping?: ProductIdMapping;
  productNameMap?: ProductNameMap;
  productNameHints?: Record<string, string | string[]>;
  goodsSnapshot?: GoodsSnapshotItem[];
  exposureCumulativeProducts?: ExposureCumulativeProduct[];
  firstSeen?: GoodsFirstSeenIndex;
  lifecycle?: GoodsLinkLifecycleState | null;
  daemonCatalog?: DaemonCatalogSnapshot | null;
  agentDelistEvents?: AgentDelistEvent[];
  suppressDelistAttribution?: boolean;
}

interface DraftEntry {
  internalProductId: string;
  platformProductId?: string;
  productName?: string;
  platformProductIdConflict?: PlatformProductIdConflict;
  productNamePriority?: number;
  categoryId?: string;
  categoryName?: string;
  productType?: string;
  shortName?: string;
  sameSkuGroupId?: string;
  status?: LinkRegistryStatus;
  statusPriority?: number;
  firstSeenDate?: string;
  lastSeenDate?: string;
  daemonStatusText?: string;
  daemonSyncStatus?: string;
  daemonChannels?: Set<string>;
  daemonTags?: Set<string>;
  daemonStockText?: string;
  daemonRowText?: string;
  daemonSnapshotAt?: string;
  listingObservations: ListingStateObservation[];
  platformRestrictions: PlatformRestrictionAttributionObservation[];
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

  const draft: DraftEntry = { internalProductId, listingObservations: [], platformRestrictions: [], nameHints: new Set<string>(), aliases: new Set<string>(), sources: new Set<LinkRegistrySource>() };
  drafts.set(internalProductId, draft);
  return draft;
}

function addListingObservation(draft: DraftEntry, observation: ListingStateObservation): void {
  draft.listingObservations.push(observation);
}

function setPlatformProductId(draft: DraftEntry, platformProductId: string): void {
  const trimmed = platformProductId.trim();
  if (trimmed && !draft.platformProductId) draft.platformProductId = trimmed;
}

function setProductName(draft: DraftEntry, productName: string, priority = 1): void {
  const trimmed = productName.trim();
  if (!trimmed) return;
  const currentPriority = draft.productNamePriority ?? 0;
  if (!draft.productName || priority >= currentPriority) {
    draft.productName = trimmed;
    draft.productNamePriority = priority;
  }
}

function setStatus(draft: DraftEntry, status: LinkRegistryStatus, priority = 1): void {
  const currentPriority = draft.statusPriority ?? 0;
  if (!draft.status || priority >= currentPriority) {
    draft.status = status;
    draft.statusPriority = priority;
  }
}

interface ListingTextDecision {
  state: LinkListingState;
  rawText: string;
}

function listingStatePriority(state: LinkListingState): number {
  if (state === 'delisted' || state === 'gone') return 3;
  if (state === 'on_sale') return 2;
  return 1;
}

function bestListingText(values: string[]): ListingTextDecision | null {
  let best: ListingTextDecision | null = null;
  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    const candidate = { state: parseListingStateFromText(value), rawText: value };
    if (!best || listingStatePriority(candidate.state) > listingStatePriority(best.state)) best = candidate;
  }
  return best;
}

function daemonListingText(syncStatus: string | undefined, listingStatusText: string | undefined): ListingTextDecision | null {
  const delisted = bestListingText([syncStatus ?? '', listingStatusText ?? '']);
  if (delisted?.state === 'delisted') return delisted;
  const syncText = syncStatus?.trim();
  if (syncText) return { state: parseListingStateFromText(syncText), rawText: syncText };
  const listingText = listingStatusText?.trim();
  return listingText ? { state: parseListingStateFromText(listingText), rawText: listingText } : null;
}

function addDaemonStrings(target: Set<string> | undefined, values: string[] | undefined): Set<string> | undefined {
  if (!values || values.length === 0) return target;
  const next = target ?? new Set<string>();
  for (const value of values.map((item) => item.trim()).filter(Boolean)) next.add(value);
  return next;
}

function addDaemonMetadata(draft: DraftEntry, item: NonNullable<BuildLinkRegistryInput['daemonCatalog']>['entries'][number]): void {
  draft.daemonStatusText ??= item.listingStatusText?.trim();
  draft.daemonSyncStatus ??= item.syncStatus?.trim();
  draft.daemonChannels = addDaemonStrings(draft.daemonChannels, item.channels);
  draft.daemonTags = addDaemonStrings(draft.daemonTags, item.tags);
  draft.daemonStockText ??= item.stockText?.trim();
  draft.daemonRowText ??= item.rowText?.trim();
  draft.daemonSnapshotAt ??= item.discoveredAt?.trim();
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

function addGoodsSnapshot(drafts: Map<string, DraftEntry>, goodsSnapshot: GoodsSnapshotItem[]): void {
  for (const item of goodsSnapshot) {
    const internalProductId = validInternalId(item.internalProductId);
    if (!internalProductId) continue;

    const draft = draftFor(drafts, internalProductId);
    setPlatformProductId(draft, item.platformProductId);
    setProductName(draft, item.productName, 3);
    if (item.listingState) {
      addListingObservation(draft, {
        source: 'goods_snapshot',
        state: item.listingState,
        observedAt: item.observedAt,
        rawText: item.listingStatusText,
      });
    }
    if (item.platformRestriction?.reasonText.trim()) {
      draft.platformRestrictions.push({
        restriction: item.platformRestriction,
        ...(item.listingState ? { listingState: item.listingState } : {}),
        ...(item.listingStatusText?.trim() ? { listingStatusText: item.listingStatusText.trim() } : {}),
        ...(item.observedAt ? { observedAt: item.observedAt } : {}),
      });
    }
    addNameHint(draft, item.productName);
    draft.sources.add('goods_snapshot');
  }
}

interface CurrentAuthoritativeProductIdPair {
  platformProductId: string;
  internalProductId: string;
}

function addCurrentAuthoritativePair(
  pairs: CurrentAuthoritativeProductIdPair[],
  platformProductIdValue: string | undefined,
  internalProductIdValue: string | undefined,
): void {
  const platformProductId = platformProductIdValue?.trim();
  const internalProductId = validInternalId(internalProductIdValue ?? '');
  if (!platformProductId || !internalProductId) return;
  pairs.push({ platformProductId, internalProductId });
}

function collectCurrentAuthoritativeProductIdPairs(input: BuildLinkRegistryInput): CurrentAuthoritativeProductIdPair[] {
  const pairs: CurrentAuthoritativeProductIdPair[] = [];
  const mappingPairs = Object.entries(input.productIdMapping ?? {}).sort(([leftPlatform], [rightPlatform]) => leftPlatform.localeCompare(rightPlatform));
  for (const [platformProductId, internalProductId] of mappingPairs) addCurrentAuthoritativePair(pairs, platformProductId, internalProductId);
  for (const item of input.goodsSnapshot ?? []) addCurrentAuthoritativePair(pairs, item.platformProductId, item.internalProductId);
  return pairs;
}

function addProductIdEdge(
  internalToPlatforms: Map<string, Set<string>>,
  platformToInternals: Map<string, Set<string>>,
  pair: CurrentAuthoritativeProductIdPair,
): void {
  const platforms = internalToPlatforms.get(pair.internalProductId) ?? new Set<string>();
  platforms.add(pair.platformProductId);
  internalToPlatforms.set(pair.internalProductId, platforms);

  const internals = platformToInternals.get(pair.platformProductId) ?? new Set<string>();
  internals.add(pair.internalProductId);
  platformToInternals.set(pair.platformProductId, internals);
}

function compareInternalProductIdValue(left: string, right: string): number {
  return Number(left) - Number(right) || left.localeCompare(right);
}

function buildPlatformProductIdConflicts(input: BuildLinkRegistryInput): Map<string, PlatformProductIdConflict> {
  const internalToPlatforms = new Map<string, Set<string>>();
  const platformToInternals = new Map<string, Set<string>>();
  for (const pair of collectCurrentAuthoritativeProductIdPairs(input)) addProductIdEdge(internalToPlatforms, platformToInternals, pair);

  const seedInternalProductIds = new Set<string>();
  for (const [internalProductId, platformProductIds] of internalToPlatforms) {
    if (platformProductIds.size > 1) seedInternalProductIds.add(internalProductId);
  }
  for (const internalProductIds of platformToInternals.values()) {
    if (internalProductIds.size > 1) {
      for (const internalProductId of internalProductIds) seedInternalProductIds.add(internalProductId);
    }
  }

  const conflicts = new Map<string, PlatformProductIdConflict>();
  const visitedInternalProductIds = new Set<string>();
  for (const seedInternalProductId of [...seedInternalProductIds].sort(compareInternalProductIdValue)) {
    if (visitedInternalProductIds.has(seedInternalProductId)) continue;

    const componentInternalProductIds = new Set<string>();
    const componentPlatformProductIds = new Set<string>();
    const internalStack = [seedInternalProductId];
    const platformStack: string[] = [];
    const visitedPlatformProductIds = new Set<string>();

    while (internalStack.length > 0 || platformStack.length > 0) {
      const internalProductId = internalStack.pop();
      if (internalProductId) {
        if (visitedInternalProductIds.has(internalProductId)) continue;
        visitedInternalProductIds.add(internalProductId);
        componentInternalProductIds.add(internalProductId);
        for (const platformProductId of internalToPlatforms.get(internalProductId) ?? []) platformStack.push(platformProductId);
        continue;
      }

      const platformProductId = platformStack.pop();
      if (!platformProductId || visitedPlatformProductIds.has(platformProductId)) continue;
      visitedPlatformProductIds.add(platformProductId);
      componentPlatformProductIds.add(platformProductId);
      for (const nextInternalProductId of platformToInternals.get(platformProductId) ?? []) internalStack.push(nextInternalProductId);
    }

    const conflict = {
      platformProductIds: [...componentPlatformProductIds].sort((left, right) => left.localeCompare(right)),
      internalProductIds: [...componentInternalProductIds].sort(compareInternalProductIdValue),
    };
    for (const internalProductId of conflict.internalProductIds) conflicts.set(internalProductId, conflict);
  }

  return conflicts;
}

function applyPlatformProductIdConflicts(drafts: Map<string, DraftEntry>, conflicts: Map<string, PlatformProductIdConflict>): void {
  for (const [internalProductId, conflict] of conflicts) {
    const draft = drafts.get(internalProductId);
    if (draft) draft.platformProductIdConflict = conflict;
  }
}

function addFirstSeen(drafts: Map<string, DraftEntry>, firstSeen: GoodsFirstSeenIndex): void {
  for (const [internalProductIdValue, entry] of Object.entries(firstSeen)) {
    const internalProductId = validInternalId(internalProductIdValue);
    if (!internalProductId) continue;

    const draft = draftFor(drafts, internalProductId);
    setPlatformProductId(draft, entry.platformProductId);
    setProductName(draft, entry.productName, 2);
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
    setProductName(draft, entry.productName, 2);
    setStatus(draft, 'active', 2);
    addListingObservation(draft, { source: 'goods_link_lifecycle', state: 'on_sale' });
    addNameHint(draft, entry.productName);
    draft.sources.add('goods_link_lifecycle');
  }

  for (const [internalProductId, item] of latestRemovedByInternalId(lifecycle.removedLinks)) {
    const draft = draftFor(drafts, internalProductId);
    setPlatformProductId(draft, item.platformProductId);
    setProductName(draft, item.productName, 2);
    addNameHint(draft, item.productName);
    if (draft.status !== 'active') {
      setStatus(draft, 'removed', 1);
      draft.lastSeenDate = item.removedDate;
    }
    addListingObservation(draft, { source: 'goods_link_lifecycle', state: 'gone', observedAt: item.removedDate, rawText: item.reason });
    draft.sources.add('goods_link_lifecycle');
  }
}

function addDaemonCatalog(drafts: Map<string, DraftEntry>, daemonCatalog: DaemonCatalogSnapshot): void {
  for (const item of daemonCatalog.entries) {
    const internalProductId = validInternalId(item.internalProductId);
    if (!internalProductId) continue;

    const draft = draftFor(drafts, internalProductId);
    setProductName(draft, item.productName, 4);
    const listingText = daemonListingText(item.syncStatus, item.listingStatusText);
    addListingObservation(draft, {
      source: 'daemon_catalog',
      state: listingText?.state ?? 'unknown',
      observedAt: item.discoveredAt,
      rawText: listingText?.rawText,
    });
    addNameHint(draft, item.productName);
    addDaemonMetadata(draft, item);
    draft.sources.add('daemon_catalog');
  }
}

function exposureStatusText(item: ExposureCumulativeProduct): string | undefined {
  const candidates = Object.entries(item.raw ?? {})
    .filter(([key, value]) => /状态|上架/u.test(key) && value.trim())
    .sort(([leftKey], [rightKey]) => Number(/商品状态|上架状态/u.test(rightKey)) - Number(/商品状态|上架状态/u.test(leftKey)));
  return bestListingText(candidates.map(([, value]) => value))?.rawText;
}

function addExposureCumulativeProducts(
  drafts: Map<string, DraftEntry>,
  exposureCumulativeProducts: ExposureCumulativeProduct[],
  productIdMapping: ProductIdMapping,
): void {
  for (const item of exposureCumulativeProducts) {
    const platformProductId = item.platformProductId.trim();
    const internalProductId = validInternalId(productIdMapping[platformProductId] ?? '');
    if (!platformProductId || !internalProductId) continue;

    const draft = draftFor(drafts, internalProductId);
    setPlatformProductId(draft, platformProductId);
    setProductName(draft, item.productName, 1);
    addNameHint(draft, item.productName);
    const statusText = exposureStatusText(item);
    if (statusText) {
      addListingObservation(draft, {
        source: 'exposure',
        state: parseListingStateFromText(statusText),
        rawText: statusText,
      });
    }
    draft.sources.add('exposure');
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
  if (/^ipod(?:\s|$)/iu.test(name)) return 'ipod';
  if (/^iPhone(?:\s|$)/iu.test(name)) return 'iphone';
  if (/^iPad(?:\s|$)/iu.test(name)) return 'ipad';
  if (/^苹果/u.test(name)) return 'apple';
  if (/^AMIRO(?:\s|$)/iu.test(name)) return 'amiro';
  if (/^SEAYEO(?:\s|$)/iu.test(name)) return 'seayeo';
  if (/^Ulike(?:\s|$)/iu.test(name)) return 'ulike';
  return '';
}

function inferredSpecialSameSkuGroupId(name: string): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) return undefined;

  const canonIxus = trimmed.match(/^(?:佳能|canon)\s+IXUS\s*([0-9]{2,3}(?:IS|HS)?)/iu);
  if (canonIxus) return `canon-ixus-${canonIxus[1].toLowerCase()}`;

  if (/^(?:佳能|canon)\s+RF\s+50mm\s+F1\.8\s+镜头$/iu.test(trimmed)) return 'canon-rf-50-f1-8';
  if (/^(?:佳能|canon)\s+RF-S\s+18-150mm\s+镜头$/iu.test(trimmed)) return 'canon-rf-s-18-150';
  if (/^(?:佳能|canon)\s+RF\s+100-400mm\s+镜头$/iu.test(trimmed)) return 'canon-rf-100-400';

  const fujiSquare = trimmed.match(/^富士\s+instax\s+SQUARE\s+SQ(1|20|40)$/iu);
  if (fujiSquare) return `fujifilm-instax-square-sq${fujiSquare[1]}`;

  const fujiMiniLink = trimmed.match(/^富士\s+instax\s+mini\s+Link\s*(2|3)$/iu);
  if (fujiMiniLink) return `fujifilm-instax-mini-link-${fujiMiniLink[1]}`;

  if (/^富士\s+instax\s+mini\s+SE$/iu.test(trimmed)) return 'fujifilm-instax-mini-se';
  if (/^(?:大疆|dji)\s+Action\s+6$/iu.test(trimmed)) return 'dji-action-6';
  if (/^AMIRO\s+ABM502$/i.test(trimmed)) return 'amiro-rainbow-light-mask-abm502';
  if (/^SEAYEO\s+.*大排灯美容仪$/u.test(trimmed)) return 'seayeo-led-face-mask';
  if (/^Ulike\s+Air\s+3$/i.test(trimmed)) return 'ulike-air-3';

  return undefined;
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
        .replace(/^ipod\s*/iu, '')
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
    const groupId = inferredSpecialSameSkuGroupId(canonical) ?? sameSkuSlug(canonical);
    if (groupId) draft.sameSkuGroupId = groupId;
  }
}

export function preferredShortNameForSameSkuGroup(groupId: string): string | undefined {
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
    [/^canon(?:-eos)?-r50$/i, () => 'R50'],
    [/^canon(?:-ccd)?-ixus-?130/i, () => 'IXUS 130'],
    [/^canon-ixus-(\d+(?:is|hs)?)$/i, (model) => `IXUS ${model.toUpperCase()}`],
    [/^canon-cp1500$/i, () => 'CP1500'],
    [/^canon-rf-100-400$/i, () => 'RF 100-400'],
    [/^canon-rf-50-f1-8$/i, () => 'RF 50 F1.8'],
    [/^canon-rf-s-18-150$/i, () => 'RF-S 18-150'],
    [/^ipod-touch-(\d+)$/i, (model) => `iPod touch ${model}`],
    [/^sony-.*zv1/i, () => 'ZV-1'],
    [/^vivo-x(\d+)-ultra$/i, (model) => `x${model} u`],
    [/^vivo x(\d+) pro$/i, (model) => `x${model}p`],
    [/^vivox(\d+)-pro$/i, (model) => `x${model}p`],
    [/^三星galaxy s23ultra$/u, () => 's23U'],
    [/^vivo-蔡司-2-35x增距镜-神器$/u, () => 'vivo 蔡司增距镜'],
    [/^fujifilm-mini-evo$/i, () => 'mini evo'],
    [/^fujifilm-wide-evo$/i, () => 'wide evo'],
    [/^fujifilm-instax-mini-link-(2|3)$/i, (model) => `Mini Link ${model}`],
    [/^fujifilm-instax-mini-se$/i, () => 'Mini SE'],
    [/^dji-action-6$/i, () => 'Action 6'],
    [/^amiro-rainbow-light-mask-abm502$/i, () => 'AMIRO ABM502'],
    [/^seayeo-led-face-mask$/i, () => 'SEAYEO 大排灯美容仪'],
    [/^ulike-air-3$/i, () => 'Ulike Air 3'],
  ];

  for (const [pattern, formatter] of patterns) {
    const match = trimmed.match(pattern);
    if (match) return formatter(...match.slice(1));
  }

  return undefined;
}

function comparableShortName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^(?:佳能|富士|大疆|影石|索尼|尼康|松下)\s*/gu, '')
    .replace(/^vivo\s*/giu, '')
    .replace(/\binstax\b/giu, '')
    .replace(/\bmm\b/giu, '')
    .replace(/镜头/gu, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '');
}

function shouldPreferInferredShortName(current: string | undefined, inferred: string | undefined): boolean {
  const currentTrimmed = current?.trim();
  const inferredTrimmed = inferred?.trim();
  if (!currentTrimmed || !inferredTrimmed) return false;
  if (currentTrimmed === inferredTrimmed) return false;
  return comparableShortName(currentTrimmed) === comparableShortName(inferredTrimmed);
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
  if (/ipod|ipod touch|touch\s*\d+/.test(key)) {
    return { categoryId: 'media-player', categoryName: '播放器', productType: 'music-player' };
  }
  if (/amiro|abm502|ulike air 3|seayeo|大排灯美容仪/.test(key)) {
    const productType = /ulike air 3/.test(key) ? 'hair-removal-device' : 'led-face-mask';
    return { categoryId: 'beauty-device', categoryName: '美容仪', productType };
  }
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

function normalizedClassificationOverride(draft: DraftEntry): InferredClassification | undefined {
  const key = [
    draft.sameSkuGroupId?.trim(),
    draft.shortName?.trim(),
    bestNameHint(draft.nameHints),
    draft.productName?.trim(),
  ].filter(Boolean).join(' ').toLowerCase();

  if (!key) return undefined;
  if (/vivo-zeiss-telephoto-lens/.test(key)) {
    return { categoryId: 'lens', categoryName: '\u955c\u5934', productType: 'lens-accessory' };
  }
  if (/vivo\s*蔡司增距镜|2\.35x\s*长焦增距镜|长焦增距镜/.test(key)) {
    return { categoryId: 'lens', categoryName: '\u955c\u5934', productType: 'lens-accessory' };
  }
  if (/dji-pocket-\d|pocket\s*\d/.test(key)) {
    return { categoryId: 'camera', categoryName: '\u76f8\u673a', productType: 'gimbal-camera' };
  }
  if (/insta360-go-3s|go\s*3s/.test(key)) {
    return { categoryId: 'camera', categoryName: '\u8fd0\u52a8\u76f8\u673a', productType: 'action-camera' };
  }
  if (/canon-g9|\bg9\b/.test(key)) {
    return { categoryId: 'camera', categoryName: '\u76f8\u673a', productType: 'camera' };
  }
  return undefined;
}

function applyGroupLevelClassification(drafts: Map<string, DraftEntry>): void {
  const groups = new Map<string, DraftEntry[]>();
  for (const draft of drafts.values()) {
    const sameSkuGroupId = draft.sameSkuGroupId?.trim();
    if (!sameSkuGroupId) continue;
    const existing = groups.get(sameSkuGroupId) ?? [];
    existing.push(draft);
    groups.set(sameSkuGroupId, existing);
  }

  for (const [groupId, groupDrafts] of groups) {
    const rule = sameSkuGroupRules.find((item) => item.matchSameSkuGroupId === groupId);
    if (!rule?.categoryId || !rule?.categoryName || !rule?.productType) continue;
    for (const draft of groupDrafts) {
      draft.sameSkuGroupId = rule.sameSkuGroupId ?? groupId;
      draft.categoryId = rule.categoryId;
      draft.categoryName = rule.categoryName;
      draft.productType = rule.productType;
    }
  }
}

function inferDraftMetadata(drafts: Map<string, DraftEntry>): void {
  for (const draft of drafts.values()) {
    draft.shortName = normalizedShortName(draft.shortName) ?? draft.shortName;
    const inferredShortName = preferredShortNameForSameSkuGroup(draft.sameSkuGroupId ?? '');
    if (shouldPreferInferredShortName(draft.shortName, inferredShortName)) {
      draft.shortName = inferredShortName;
      if (draft.shortName) addNameHint(draft, draft.shortName);
    }
    if (!draft.shortName) {
      draft.shortName = inferredShortName
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

    const normalized = normalizedClassificationOverride(draft);
    if (normalized) {
      draft.categoryId = normalized.categoryId;
      draft.categoryName = normalized.categoryName;
      draft.productType = normalized.productType;
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
  if (draft.sources.has('daemon_catalog')) score += 0.05;
  return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}

function updatedAtFor(draft: DraftEntry): string | undefined {
  return [draft.lastSeenDate, draft.firstSeenDate].find((value) => !!value);
}

function finalizeEntry(
  draft: DraftEntry,
  agentDelistEvents: AgentDelistEvent[],
  suppressDelistAttribution: boolean | undefined,
): LinkRegistryEntry {
  const listingDecision = arbitrateListingState(draft.listingObservations, { freshnessOverrideMs: LISTING_STATE_FRESHNESS_OVERRIDE_MS });
  const status = listingDecision.state === 'unknown' && draft.status ? draft.status : listingStateToStatus(listingDecision.state);
  const attribution = attributeDelist({
    listingState: listingDecision.state,
    statusObservedAt: listingDecision.observedAt,
    platformRestrictions: draft.platformRestrictions,
    agentDelistEvents: agentDelistEvents.filter((event) => event.internalProductId === draft.internalProductId),
    suppressDelistAttribution,
  });
  const aliases = [...draft.aliases]
    .map((value) => value.trim())
    .filter((value) => !!value)
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort();
  return {
    internalProductId: draft.internalProductId,
    ...(draft.platformProductId && !draft.platformProductIdConflict ? { platformProductId: draft.platformProductId } : {}),
    ...(draft.platformProductIdConflict ? { platformProductIdConflict: draft.platformProductIdConflict } : {}),
    ...(draft.productName ? { productName: draft.productName } : {}),
    ...(draft.categoryId ? { categoryId: draft.categoryId } : {}),
    ...(draft.categoryName ? { categoryName: draft.categoryName } : {}),
    ...(draft.productType ? { productType: draft.productType } : {}),
    ...(draft.shortName ? { shortName: draft.shortName } : {}),
    ...(aliases.length > 0 ? { aliases } : {}),
    ...(draft.sameSkuGroupId ? { sameSkuGroupId: draft.sameSkuGroupId } : {}),
    status,
    listingState: listingDecision.state,
    ...(listingDecision.source ? { statusSource: listingDecision.source } : {}),
    ...(listingDecision.observedAt ? { statusObservedAt: listingDecision.observedAt } : {}),
    ...(draft.firstSeenDate ? { firstSeenDate: draft.firstSeenDate } : {}),
    ...(draft.lastSeenDate ? { lastSeenDate: draft.lastSeenDate } : {}),
    ...(draft.daemonStatusText ? { daemonStatusText: draft.daemonStatusText } : {}),
    ...(draft.daemonSyncStatus ? { daemonSyncStatus: draft.daemonSyncStatus } : {}),
    ...(draft.daemonChannels && draft.daemonChannels.size > 0 ? { daemonChannels: [...draft.daemonChannels].sort() } : {}),
    ...(draft.daemonTags && draft.daemonTags.size > 0 ? { daemonTags: [...draft.daemonTags].sort() } : {}),
    ...(draft.daemonStockText ? { daemonStockText: draft.daemonStockText } : {}),
    ...(draft.daemonRowText ? { daemonRowText: draft.daemonRowText } : {}),
    ...(draft.daemonSnapshotAt ? { daemonSnapshotAt: draft.daemonSnapshotAt } : {}),
    ...(attribution ? {
      delistCause: attribution.cause,
      delistCauseConfidence: attribution.confidence,
      delistCauseEvidence: attribution.evidence,
    } : {}),
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
  addExposureCumulativeProducts(drafts, input.exposureCumulativeProducts ?? [], input.productIdMapping ?? {});
  addGoodsSnapshot(drafts, input.goodsSnapshot ?? []);
  addFirstSeen(drafts, input.firstSeen ?? {});
  if (input.lifecycle) addLifecycle(drafts, input.lifecycle);
  if (input.daemonCatalog) addDaemonCatalog(drafts, input.daemonCatalog);
  assignSameSkuGroupIds(drafts);
  inferDraftMetadata(drafts);
  applyGroupLevelClassification(drafts);
  inferDraftMetadata(drafts);
  applyPlatformProductIdConflicts(drafts, buildPlatformProductIdConflicts(input));

  return [...drafts.values()]
    .map((draft) => finalizeEntry(draft, input.agentDelistEvents ?? [], input.suppressDelistAttribution))
    .sort(compareInternalProductId);
}
