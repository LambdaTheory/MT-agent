import type { LinkRegistryEntry } from '../linkRegistry/types.js';
import type { PublicTrafficDataReportContext, PublicTrafficProductDataRow } from '../publicTraffic/types.js';

export type ProductRankingMatchMethod = 'internal_id' | 'same_sku_group' | 'short_name';

export interface ProductRankingCandidate {
  sameSkuGroupId: string;
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
      sameSkuGroupId: string;
      best: RankedProduct;
      ranking: RankedProduct[];
      excluded: Array<{ internalProductId: string; reason: 'removed' | 'missing_metrics' | 'missing_same_sku_group' }>;
      rationale: string;
      date: string;
    }
  | { status: 'ambiguous'; query: string; candidates: ProductRankingCandidate[] }
  | { status: 'not_found'; query: string }
  | { status: 'no_metrics'; query: string; sameSkuGroupId: string; excluded: Array<{ internalProductId: string; reason: 'removed' | 'missing_metrics' | 'missing_same_sku_group' }> };

interface ResolvedGroup {
  matchedBy: ProductRankingMatchMethod;
  sameSkuGroupId: string;
  entries: LinkRegistryEntry[];
}

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[（）()]/g, ' ')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactText(value: string): string {
  return normalizeText(value).replace(/\s+/g, '');
}

function normalizeId(value: string): string {
  return value.trim();
}

function extractInternalProductId(displayProductId: string): string | null {
  return /^端内id\s*(\d+)$/i.exec(displayProductId.trim())?.[1] ?? null;
}

function groupEntriesBySameSku(entries: LinkRegistryEntry[]): Map<string, LinkRegistryEntry[]> {
  const groups = new Map<string, LinkRegistryEntry[]>();
  for (const entry of entries) {
    const sameSkuGroupId = entry.sameSkuGroupId?.trim();
    if (!sameSkuGroupId) continue;
    const group = groups.get(sameSkuGroupId) ?? [];
    group.push(entry);
    groups.set(sameSkuGroupId, group);
  }
  return groups;
}

function candidateForGroup(sameSkuGroupId: string, entries: LinkRegistryEntry[]): ProductRankingCandidate {
  const shortName = entries.find((entry) => entry.shortName?.trim())?.shortName?.trim();
  return {
    sameSkuGroupId,
    ...(shortName ? { shortName } : {}),
    internalProductIds: entries.map((entry) => entry.internalProductId).sort((left, right) => Number(left) - Number(right) || left.localeCompare(right)),
  };
}

function textMatchesQuery(text: string | undefined, query: string): boolean {
  if (!text?.trim()) return false;
  const normalized = normalizeText(text);
  const normalizedQuery = normalizeText(query);
  if (!normalized || !normalizedQuery) return false;
  if (normalized.includes(normalizedQuery)) return true;
  return compactText(normalized).includes(compactText(normalizedQuery));
}

function resolveGroup(registry: LinkRegistryEntry[], query: string): ResolvedGroup | ProductRankingResult {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return { status: 'not_found', query };

  const groups = groupEntriesBySameSku(registry);
  if (/^\d+$/.test(trimmedQuery)) {
    const entry = registry.find((candidate) => normalizeId(candidate.internalProductId) === trimmedQuery);
    if (!entry) return { status: 'not_found', query };
    const sameSkuGroupId = entry.sameSkuGroupId?.trim();
    if (!sameSkuGroupId) {
      return { status: 'no_metrics', query, sameSkuGroupId: '', excluded: [{ internalProductId: entry.internalProductId, reason: 'missing_same_sku_group' }] };
    }
    return { matchedBy: 'internal_id', sameSkuGroupId, entries: groups.get(sameSkuGroupId) ?? [entry] };
  }

  const directGroup = groups.get(trimmedQuery);
  if (directGroup) return { matchedBy: 'same_sku_group', sameSkuGroupId: trimmedQuery, entries: directGroup };

  const matches = [...groups.entries()]
    .filter(([sameSkuGroupId, entries]) => textMatchesQuery(sameSkuGroupId, trimmedQuery) || entries.some((entry) => textMatchesQuery(entry.shortName, trimmedQuery)))
    .sort(([left], [right]) => left.localeCompare(right));

  if (matches.length === 0) return { status: 'not_found', query };
  if (matches.length > 1) return { status: 'ambiguous', query, candidates: matches.map(([sameSkuGroupId, entries]) => candidateForGroup(sameSkuGroupId, entries)) };
  const [[sameSkuGroupId, entries]] = matches;
  return { matchedBy: 'short_name', sameSkuGroupId, entries };
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
  registry: LinkRegistryEntry[],
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
