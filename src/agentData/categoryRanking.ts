import type { LinkRegistryEntry } from '../linkRegistry/types.js';
import type { PeriodKey } from '../domain/types.js';
import type { PublicTrafficDataReportContext, PublicTrafficProductDataRow } from '../publicTraffic/types.js';
import { aggregateWindowProducts, readWindowMetric, type WindowProductAggregate } from './windowAggregate.js';
import type { PublicTrafficMetricKey } from './publicTrafficMetricCatalog.js';

export type CategoryRankingMetric = 'shippedOrders' | 'amount' | 'exposure';

export interface CategoryRankingArgs {
  category?: string;
  metric: CategoryRankingMetric;
  periodDays: 1 | 7 | 30;
  limit?: number;
}

export interface CategoryWindowRankingArgs {
  category?: string;
  metric: PublicTrafficMetricKey;
  periodDays: number;
  endDate?: string;
  limit?: number;
}

export interface CategoryRankedProduct {
  internalProductId: string;
  platformProductId: string;
  productName: string;
  category: string;
  metric: CategoryRankingMetric;
  period: PeriodKey;
  value: number;
}

export interface CategoryRankingResult {
  date: string;
  category: string | null;
  metric: CategoryRankingMetric;
  period: PeriodKey;
  items: CategoryRankedProduct[];
}

export interface CategoryWindowRankingResult {
  date: string;
  category: string | null;
  metric: PublicTrafficMetricKey;
  periodDays: number;
  items: Array<{ internalProductId: string; productName: string; category: string; value: number }>;
}

function periodKey(days: 1 | 7 | 30): PeriodKey {
  return `${days}d` as PeriodKey;
}

function extractInternalProductId(row: PublicTrafficProductDataRow): string | null {
  return /^端内id\s*(\d+)$/i.exec(row.displayProductId.trim())?.[1] ?? null;
}

function categoryOf(entry: LinkRegistryEntry | undefined): string {
  return entry?.categoryName?.trim() || entry?.categoryId?.trim() || entry?.productType?.trim() || '未分类';
}

function buildRegistryIndex(registry: LinkRegistryEntry[]): Map<string, LinkRegistryEntry> {
  const index = new Map<string, LinkRegistryEntry>();
  for (const entry of registry) {
    index.set(`internal:${entry.internalProductId}`, entry);
    if (entry.platformProductId) index.set(`platform:${entry.platformProductId}`, entry);
  }
  return index;
}

function findEntry(row: PublicTrafficProductDataRow, index: Map<string, LinkRegistryEntry>): LinkRegistryEntry | undefined {
  const internalProductId = extractInternalProductId(row);
  return (internalProductId ? index.get(`internal:${internalProductId}`) : undefined) ?? index.get(`platform:${row.platformProductId}`);
}

function findAggregateEntry(item: WindowProductAggregate, index: Map<string, LinkRegistryEntry>): LinkRegistryEntry | undefined {
  return index.get(`internal:${item.internalProductId}`) ?? (item.platformProductId ? index.get(`platform:${item.platformProductId}`) : undefined);
}

function metricValue(row: PublicTrafficProductDataRow, period: PeriodKey, metric: CategoryRankingMetric): number {
  const metrics = row.periods[period];
  if (!metrics) return 0;
  return metrics[metric];
}

export function rankProductsByCategory(
  context: PublicTrafficDataReportContext,
  registry: LinkRegistryEntry[],
  args: CategoryRankingArgs,
): CategoryRankingResult {
  const period = periodKey(args.periodDays);
  const limit = Math.max(1, Math.min(args.limit ?? 10, 50));
  const requestedCategory = args.category?.trim() || null;
  const registryIndex = buildRegistryIndex(registry);
  const items = context.rows
    .map((row) => {
      const entry = findEntry(row, registryIndex);
      const category = categoryOf(entry);
      const internalProductId = entry?.internalProductId ?? extractInternalProductId(row) ?? row.displayProductId;
      return {
        internalProductId,
        platformProductId: row.platformProductId,
        productName: row.productName,
        category,
        metric: args.metric,
        period,
        value: metricValue(row, period, args.metric),
      } satisfies CategoryRankedProduct;
    })
    .filter((item) => !requestedCategory || item.category === requestedCategory)
    .sort((left, right) => right.value - left.value || left.internalProductId.localeCompare(right.internalProductId))
    .slice(0, limit);

  return { date: context.date, category: requestedCategory, metric: args.metric, period, items };
}

export async function rankProductsByCategoryWindowed(
  outputDir: string,
  registry: LinkRegistryEntry[],
  args: CategoryWindowRankingArgs,
): Promise<CategoryWindowRankingResult> {
  const endDate = args.endDate ?? new Date().toISOString().slice(0, 10);
  const requestedCategory = args.category?.trim() || null;
  const registryIndex = buildRegistryIndex(registry);
  const items = (await aggregateWindowProducts({ outputDir, endDate, windowDays: args.periodDays }))
    .flatMap((item) => {
      const value = readWindowMetric(item, args.metric);
      if (value === undefined) return [];
      const entry = findAggregateEntry(item, registryIndex);
      return [{ internalProductId: item.internalProductId, productName: item.productName, category: categoryOf(entry), value }];
    })
    .filter((item) => !requestedCategory || item.category === requestedCategory)
    .sort((left, right) => right.value - left.value || left.internalProductId.localeCompare(right.internalProductId))
    .slice(0, Math.max(1, Math.min(args.limit ?? 10, 50)));
  return { date: endDate, category: requestedCategory, metric: args.metric, periodDays: args.periodDays, items };
}
