import type { LinkRegistryAliasResolutionCandidate, LinkRegistryStore } from '../linkRegistry/store.js';
import type { LinkRegistryEntry } from '../linkRegistry/types.js';
import type { PublicTrafficDataReportContext, PublicTrafficProductDataRow } from '../publicTraffic/types.js';

export type ProductRankingMatchMethod = 'internal_id' | 'same_sku_group' | 'alias';

export interface ProductRankingCandidate {
  sameSkuGroupId: string | null;
  shortName?: string;
  internalProductIds: string[];
}

export interface RankedProduct {
  internalProductId: string;
  platformProductId: string;
  productName: string;
  sevenDayShippedOrders: number;
  sevenDayAmount: number;
  sevenDayPublicVisits: number;
  oneDayShippedOrders: number;
  oneDayAmount: number;
  oneDayPublicVisits: number;
}

export type ProductRankingResult =
  | {
      status: 'ranked';
      query: string;
      matchedBy: ProductRankingMatchMethod;
      sameSkuGroupId: string | null;
      best: RankedProduct;
      ranking: RankedProduct[];
      excluded: Array<{ internalProductId: string; reason: 'removed' | 'missing_metrics' | 'missing_same_sku_group' }>;
      rationale: string;
      date: string;
    }
  | { status: 'ambiguous'; query: string; candidates: ProductRankingCandidate[] }
  | { status: 'not_found'; query: string }
  | { status: 'no_metrics'; query: string; sameSkuGroupId: string | null; excluded: Array<{ internalProductId: string; reason: 'removed' | 'missing_metrics' | 'missing_same_sku_group' }> };

interface ResolvedGroup {
  matchedBy: ProductRankingMatchMethod;
  sameSkuGroupId: string | null;
  entries: LinkRegistryEntry[];
}

function extractInternalProductId(displayProductId: string): string | null {
  return /^端内id\s*(\d+)$/i.exec(displayProductId.trim())?.[1] ?? null;
}

function candidateForGroup(sameSkuGroupId: string | null, entries: LinkRegistryEntry[]): ProductRankingCandidate {
  const shortName = entries.find((entry) => entry.shortName?.trim())?.shortName?.trim();
  return {
    sameSkuGroupId,
    ...(shortName ? { shortName } : {}),
    internalProductIds: entries.map((entry) => entry.internalProductId).sort((left, right) => Number(left) - Number(right) || left.localeCompare(right)),
  };
}

function candidateForAlias(candidate: LinkRegistryAliasResolutionCandidate): ProductRankingCandidate {
  return candidateForGroup(candidate.sameSkuGroupId, candidate.entries);
}

function sameSkuEntries(registry: LinkRegistryStore, sameSkuGroupId: string): LinkRegistryEntry[] {
  return registry.listBySameSkuGroup(sameSkuGroupId, { includeRemoved: true, includeUnknown: true });
}

function resolveGroup(registry: LinkRegistryStore, query: string): ResolvedGroup | ProductRankingResult {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return { status: 'not_found', query };

  if (/^\d+$/.test(trimmedQuery)) {
    const entry = registry.getByInternalId(trimmedQuery);
    if (!entry) return { status: 'not_found', query };
    const sameSkuGroupId = entry.sameSkuGroupId?.trim();
    if (!sameSkuGroupId) {
      return { status: 'no_metrics', query, sameSkuGroupId: '', excluded: [{ internalProductId: entry.internalProductId, reason: 'missing_same_sku_group' }] };
    }
    return { matchedBy: 'internal_id', sameSkuGroupId, entries: sameSkuEntries(registry, sameSkuGroupId) };
  }

  const directGroup = sameSkuEntries(registry, trimmedQuery);
  if (directGroup.length > 0) return { matchedBy: 'same_sku_group', sameSkuGroupId: trimmedQuery, entries: directGroup };

  const alias = registry.resolveAlias(trimmedQuery);
  if (alias.status === 'not_found') return { status: 'not_found', query };
  if (alias.status === 'multiple') return { status: 'ambiguous', query, candidates: alias.candidates.map(candidateForAlias) };
  const sameSkuGroupId = alias.sameSkuGroupId?.trim() ?? null;
  return {
    matchedBy: 'alias',
    sameSkuGroupId,
    entries: sameSkuGroupId ? sameSkuEntries(registry, sameSkuGroupId) : alias.entries,
  };
}

function rowInternalProductId(row: PublicTrafficProductDataRow): string | null {
  return extractInternalProductId(row.displayProductId);
}

function findRow(context: PublicTrafficDataReportContext, entry: LinkRegistryEntry): PublicTrafficProductDataRow | undefined {
  return context.rows.find((row) => {
    const internalProductId = rowInternalProductId(row);
    return internalProductId === entry.internalProductId || (!!entry.platformProductId && row.platformProductId === entry.platformProductId);
  });
}

function rankRow(entry: LinkRegistryEntry, row: PublicTrafficProductDataRow): RankedProduct {
  const seven = row.periods['7d'];
  const one = row.periods['1d'];
  return {
    internalProductId: entry.internalProductId,
    platformProductId: row.platformProductId,
    productName: row.productName,
    sevenDayShippedOrders: seven.shippedOrders,
    sevenDayAmount: seven.amount,
    sevenDayPublicVisits: seven.publicVisits,
    oneDayShippedOrders: one.shippedOrders,
    oneDayAmount: one.amount,
    oneDayPublicVisits: one.publicVisits,
  };
}

function compareRankedProducts(left: RankedProduct, right: RankedProduct): number {
  return (
    right.sevenDayShippedOrders - left.sevenDayShippedOrders ||
    right.sevenDayAmount - left.sevenDayAmount ||
    right.sevenDayPublicVisits - left.sevenDayPublicVisits ||
    right.oneDayShippedOrders - left.oneDayShippedOrders ||
    right.oneDayAmount - left.oneDayAmount ||
    right.oneDayPublicVisits - left.oneDayPublicVisits ||
    Number(left.internalProductId) - Number(right.internalProductId) ||
    left.internalProductId.localeCompare(right.internalProductId)
  );
}

export function rankBestProductByRegistryQuery(
  context: PublicTrafficDataReportContext,
  registry: LinkRegistryStore,
  query: string,
): ProductRankingResult {
  const resolved = resolveGroup(registry, query);
  if ('status' in resolved) return resolved;

  const excluded: Array<{ internalProductId: string; reason: 'removed' | 'missing_metrics' | 'missing_same_sku_group' }> = [];
  const ranking: RankedProduct[] = [];

  for (const entry of resolved.entries) {
    if (entry.status === 'removed') {
      excluded.push({ internalProductId: entry.internalProductId, reason: 'removed' });
      continue;
    }
    const row = findRow(context, entry);
    if (!row) {
      excluded.push({ internalProductId: entry.internalProductId, reason: 'missing_metrics' });
      continue;
    }
    ranking.push(rankRow(entry, row));
  }

  ranking.sort(compareRankedProducts);
  if (ranking.length === 0) return { status: 'no_metrics', query, sameSkuGroupId: resolved.sameSkuGroupId, excluded };

  return {
    status: 'ranked',
    query,
    matchedBy: resolved.matchedBy,
    sameSkuGroupId: resolved.sameSkuGroupId,
    best: ranking[0],
    ranking,
    excluded,
    rationale: '按 7日发货、7日成交额、7日访问、1日发货、1日成交额、1日访问依次排序，并排除已下架或缺少数据的链接。',
    date: context.date,
  };
}
