import type { LinkRegistryAliasResolutionCandidate, LinkRegistryStore } from '../linkRegistry/store.js';
import { createLinkRegistry } from '../linkRegistry/store.js';
import type { LinkRegistryEntry } from '../linkRegistry/types.js';
import type { PeriodKey } from '../domain/types.js';
import type { PublicTrafficDataReportContext, PublicTrafficProductDataRow } from '../publicTraffic/types.js';
import { queryPublicTrafficWindow } from './windowQuery.js';
import type { PublicTrafficMetricKey } from './publicTrafficMetricCatalog.js';

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
  sevenDayExposure: number;
  oneDayShippedOrders: number;
  oneDayAmount: number;
  oneDayPublicVisits: number;
  oneDayExposure: number;
  thirtyDayShippedOrders: number;
  thirtyDayAmount: number;
  thirtyDayPublicVisits: number;
  thirtyDayExposure: number;
}

export type ProductRankingMetric = 'shippedOrders' | 'amount' | 'exposure';

export interface ProductRankingOptions {
  periodDays?: 1 | 7 | 30;
  metric?: ProductRankingMetric;
}

export interface ProductWindowRankingOptions {
  metric: PublicTrafficMetricKey;
  periodDays: number;
  endDate?: string;
  limit?: number;
}

export type ProductWindowRankingResult =
  | { status: 'ranked'; query: string; sameSkuGroupId: string | null; metric: PublicTrafficMetricKey; periodDays: number; date: string; best: { internalProductId: string; productName: string; value: number }; ranking: Array<{ internalProductId: string; productName: string; value: number }> }
  | { status: 'ambiguous'; query: string; candidates: ProductRankingCandidate[] }
  | { status: 'not_found'; query: string }
  | { status: 'no_metrics'; query: string; sameSkuGroupId: string | null; excluded: Array<{ internalProductId: string; reason: 'removed' | 'missing_metrics' | 'missing_same_sku_group' }> };

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

type ResolveGroupFailure = Extract<ProductRankingResult, { status: 'ambiguous' | 'not_found' | 'no_metrics' }>;

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

function resolveGroup(registry: LinkRegistryStore, query: string): ResolvedGroup | ResolveGroupFailure {
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
  const thirty = row.periods['30d'];
  return {
    internalProductId: entry.internalProductId,
    platformProductId: row.platformProductId,
    productName: row.productName,
    sevenDayShippedOrders: seven.shippedOrders,
    sevenDayAmount: seven.amount,
    sevenDayPublicVisits: seven.publicVisits,
    sevenDayExposure: seven.exposure,
    oneDayShippedOrders: one.shippedOrders,
    oneDayAmount: one.amount,
    oneDayPublicVisits: one.publicVisits,
    oneDayExposure: one.exposure,
    thirtyDayShippedOrders: thirty.shippedOrders,
    thirtyDayAmount: thirty.amount,
    thirtyDayPublicVisits: thirty.publicVisits,
    thirtyDayExposure: thirty.exposure,
  };
}

function periodKey(days: 1 | 7 | 30): PeriodKey {
  return `${days}d` as PeriodKey;
}

function rankingMetricValue(row: RankedProduct, periodDays: 1 | 7 | 30, metric: ProductRankingMetric): number {
  if (periodDays === 30) {
    if (metric === 'shippedOrders') return row.thirtyDayShippedOrders;
    if (metric === 'amount') return row.thirtyDayAmount;
    return row.thirtyDayExposure;
  }
  if (periodDays === 7) {
    if (metric === 'shippedOrders') return row.sevenDayShippedOrders;
    if (metric === 'amount') return row.sevenDayAmount;
    return row.sevenDayExposure;
  }
  if (metric === 'shippedOrders') return row.oneDayShippedOrders;
  if (metric === 'amount') return row.oneDayAmount;
  return row.oneDayExposure;
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

function compareByExplicitMetric(left: RankedProduct, right: RankedProduct, options: Required<ProductRankingOptions>): number {
  return rankingMetricValue(right, options.periodDays, options.metric) - rankingMetricValue(left, options.periodDays, options.metric) || compareRankedProducts(left, right);
}

function metricLabel(metric: ProductRankingMetric): string {
  if (metric === 'shippedOrders') return '发货';
  if (metric === 'amount') return '成交额';
  return '曝光';
}

export function rankBestProductByRegistryQuery(
  context: PublicTrafficDataReportContext,
  registry: LinkRegistryStore,
  query: string,
  options: ProductRankingOptions = {},
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

  ranking.sort(options.periodDays && options.metric ? (left, right) => compareByExplicitMetric(left, right, { periodDays: options.periodDays!, metric: options.metric! }) : compareRankedProducts);
  if (ranking.length === 0) return { status: 'no_metrics', query, sameSkuGroupId: resolved.sameSkuGroupId, excluded };

  const rationale = options.periodDays && options.metric
    ? `按 ${periodKey(options.periodDays)} ${metricLabel(options.metric)} 排序，并排除已下架或缺少数据的链接；并列时沿用默认多指标排序。`
    : '按 7日发货、7日成交额、7日访问、1日发货、1日成交额、1日访问依次排序，并排除已下架或缺少数据的链接。';

  return {
    status: 'ranked',
    query,
    matchedBy: resolved.matchedBy,
    sameSkuGroupId: resolved.sameSkuGroupId,
    best: ranking[0],
    ranking,
    excluded,
    rationale,
    date: context.date,
  };
}

export async function rankBestProductByRegistryQueryWindowed(
  outputDir: string,
  registryEntries: LinkRegistryEntry[],
  query: string,
  options: ProductWindowRankingOptions,
): Promise<ProductWindowRankingResult> {
  const resolved = resolveGroup(createLinkRegistry(registryEntries), query);
  if ('status' in resolved) {
    if (resolved.status === 'ambiguous') return { status: 'ambiguous', query: resolved.query, candidates: resolved.candidates };
    if (resolved.status === 'not_found') return { status: 'not_found', query: resolved.query };
    if (resolved.status === 'no_metrics') return { status: 'no_metrics', query: resolved.query, sameSkuGroupId: resolved.sameSkuGroupId, excluded: resolved.excluded };
  }
  const activeIds = new Set(resolved.entries.filter((entry) => entry.status === 'active').map((entry) => entry.internalProductId));
  const result = await queryPublicTrafficWindow(outputDir, {
    endDate: options.endDate,
    windowDays: options.periodDays,
    sameSkuGroupId: resolved.sameSkuGroupId ?? undefined,
    metrics: [options.metric],
    sortBy: options.metric,
    sortDirection: 'desc',
    limit: options.limit ?? 50,
  }, registryEntries);
  const ranking = result.items
    .filter((item) => activeIds.has(item.internalProductId))
    .map((item) => ({ internalProductId: item.internalProductId, productName: item.productName, value: item.values[options.metric] ?? 0 }))
    .filter((item) => Number.isFinite(item.value));
  const best = ranking[0];
  if (!best) return { status: 'no_metrics', query, sameSkuGroupId: resolved.sameSkuGroupId, excluded: [] };
  return { status: 'ranked', query, sameSkuGroupId: resolved.sameSkuGroupId, metric: options.metric, periodDays: options.periodDays, date: result.endDate, best, ranking };
}
