import { aggregateWindowProducts, readWindowMetric, type WindowProductAggregate } from './windowAggregate.js';
import { getPublicTrafficMetric, type MetricAvailability, type PublicTrafficMetricKey } from './publicTrafficMetricCatalog.js';
import type { LinkRegistryEntry } from '../linkRegistry/types.js';

export interface PublicTrafficWindowQueryArguments {
  endDate?: string;
  windowDays: number;
  productQuery?: string;
  sameSkuGroupId?: string;
  metrics?: PublicTrafficMetricKey[];
  filters?: Array<{ field: PublicTrafficMetricKey; operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'; value: number }>;
  sortBy?: PublicTrafficMetricKey;
  sortDirection?: 'asc' | 'desc';
  aggregation?: 'count' | 'sum' | 'avg' | 'min' | 'max';
  limit?: number;
}

export interface PublicTrafficWindowQueryResult {
  endDate: string;
  windowDays: number;
  matchedCount: number;
  availableCountByMetric: Partial<Record<PublicTrafficMetricKey, number>>;
  excludedUnavailableCountByMetric: Partial<Record<PublicTrafficMetricKey, number>>;
  aggregation?: {
    metric?: PublicTrafficMetricKey;
    aggregation: NonNullable<PublicTrafficWindowQueryArguments['aggregation']>;
    value: number;
    label: string;
  };
  items: Array<{
    internalProductId: string;
    productName: string;
    values: Partial<Record<PublicTrafficMetricKey, number>>;
    availability: Partial<Record<PublicTrafficMetricKey, MetricAvailability>>;
  }>;
}

function requireWindowDays(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 90) throw new Error('windowDays must be between 1 and 90');
  return value;
}

function compare(value: number, expected: number, operator: NonNullable<PublicTrafficWindowQueryArguments['filters']>[number]['operator']): boolean {
  if (operator === 'eq') return value === expected;
  if (operator === 'neq') return value !== expected;
  if (operator === 'gt') return value > expected;
  if (operator === 'gte') return value >= expected;
  if (operator === 'lt') return value < expected;
  return value <= expected;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function inProductScope(item: WindowProductAggregate, query: string | undefined): boolean {
  if (!query?.trim()) return true;
  const normalized = normalize(query);
  return normalize(item.internalProductId) === normalized
    || normalize(item.platformProductId ?? '') === normalized
    || normalize(item.productName).includes(normalized);
}

function registryScopedIds(registry: LinkRegistryEntry[] | undefined, sameSkuGroupId: string | undefined): Set<string> | null {
  if (!sameSkuGroupId) return null;
  const ids = (registry ?? [])
    .filter((entry) => entry.sameSkuGroupId?.trim() === sameSkuGroupId.trim())
    .map((entry) => entry.internalProductId);
  if (ids.length === 0) throw new Error(`Unrecognized sameSkuGroupId: ${sameSkuGroupId}`);
  return new Set(ids);
}

function requiredMetrics(args: PublicTrafficWindowQueryArguments): PublicTrafficMetricKey[] {
  return Array.from(new Set([
    ...(args.metrics ?? []),
    ...(args.filters ?? []).map((filter) => filter.field),
    ...(args.sortBy ? [args.sortBy] : []),
  ]));
}

function unavailableError(metric: PublicTrafficMetricKey, windowDays: number): Error {
  const label = getPublicTrafficMetric(metric)?.label ?? metric;
  return new Error(`${label}在近${windowDays}天窗口内不可用`);
}

const aggregationLabels: Record<NonNullable<PublicTrafficWindowQueryArguments['aggregation']>, string> = {
  count: '窗口计数',
  sum: '窗口求和',
  avg: '窗口平均',
  min: '窗口最小',
  max: '窗口最大',
};

function aggregateItems(
  items: WindowProductAggregate[],
  metrics: PublicTrafficMetricKey[],
  aggregation: NonNullable<PublicTrafficWindowQueryArguments['aggregation']> | undefined,
  windowDays: number,
): PublicTrafficWindowQueryResult['aggregation'] {
  if (!aggregation) return undefined;
  if (aggregation === 'count') return { aggregation, value: items.length, label: aggregationLabels.count };
  const metric = metrics[0];
  if (!metric) throw new Error('metrics is required when aggregation is specified');
  const definition = getPublicTrafficMetric(metric)!;
  if (aggregation === 'sum' && definition.format === 'percent') throw new Error('率指标不支持 sum 聚合');

  const values = items.flatMap((item) => {
    const value = readWindowMetric(item, metric);
    return value === undefined ? [] : [value];
  });
  if (values.length === 0) throw unavailableError(metric, windowDays);
  if (aggregation === 'sum') return { metric, aggregation, value: values.reduce((total, value) => total + value, 0), label: aggregationLabels.sum };
  if (aggregation === 'avg') return { metric, aggregation, value: values.reduce((total, value) => total + value, 0) / values.length, label: aggregationLabels.avg };
  if (aggregation === 'min') return { metric, aggregation, value: Math.min(...values), label: aggregationLabels.min };
  return { metric, aggregation, value: Math.max(...values), label: aggregationLabels.max };
}

export async function queryPublicTrafficWindow(
  outputDir: string,
  args: PublicTrafficWindowQueryArguments,
  registry?: LinkRegistryEntry[],
): Promise<PublicTrafficWindowQueryResult> {
  const windowDays = requireWindowDays(args.windowDays);
  const endDate = args.endDate ?? new Date().toISOString().slice(0, 10);
  if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 50)) throw new Error('limit must be between 1 and 50');
  if ((args.filters?.length ?? 0) > 6) throw new Error('filters must contain at most 6 items');

  const scopedIds = registryScopedIds(registry, args.sameSkuGroupId);
  const aggregates = (await aggregateWindowProducts({ outputDir, endDate, windowDays }))
    .filter((item) => inProductScope(item, args.productQuery))
    .filter((item) => !scopedIds || scopedIds.has(item.internalProductId));

  const availabilityMetrics = requiredMetrics(args);
  const availableCountByMetric: Partial<Record<PublicTrafficMetricKey, number>> = {};
  const excludedUnavailableCountByMetric: Partial<Record<PublicTrafficMetricKey, number>> = {};
  for (const metric of availabilityMetrics) {
    const available = aggregates.filter((item) => item.availability[metric]?.available).length;
    availableCountByMetric[metric] = available;
    excludedUnavailableCountByMetric[metric] = aggregates.length - available;
  }

  for (const filter of args.filters ?? []) {
    if ((availableCountByMetric[filter.field] ?? 0) === 0) throw unavailableError(filter.field, windowDays);
  }
  if (args.sortBy && (availableCountByMetric[args.sortBy] ?? 0) === 0) throw unavailableError(args.sortBy, windowDays);

  let items = aggregates.filter((item) => (args.filters ?? []).every((filter) => {
    const value = readWindowMetric(item, filter.field);
    return value !== undefined && compare(value, filter.value, filter.operator);
  }));

  if (args.sortBy) {
    items = items
      .filter((item) => item.availability[args.sortBy!]?.available)
      .sort((left, right) => {
        const leftValue = readWindowMetric(left, args.sortBy!) ?? 0;
        const rightValue = readWindowMetric(right, args.sortBy!) ?? 0;
        return args.sortDirection === 'asc' ? leftValue - rightValue : rightValue - leftValue;
      });
  }

  const requestedMetrics = args.metrics?.length ? args.metrics : availabilityMetrics;
  const aggregation = aggregateItems(items, requestedMetrics, args.aggregation, windowDays);
  const limited = items.slice(0, args.limit ?? 50);
  return {
    endDate,
    windowDays,
    matchedCount: items.length,
    availableCountByMetric,
    excludedUnavailableCountByMetric,
    ...(aggregation ? { aggregation } : {}),
    items: limited.map((item) => ({
      internalProductId: item.internalProductId,
      productName: item.productName,
      values: Object.fromEntries(requestedMetrics.flatMap((metric) => {
        const value = readWindowMetric(item, metric);
        return value === undefined ? [] : [[metric, value]];
      })) as Partial<Record<PublicTrafficMetricKey, number>>,
      availability: Object.fromEntries(requestedMetrics.map((metric) => [metric, item.availability[metric]])) as Partial<Record<PublicTrafficMetricKey, MetricAvailability>>,
    })),
  };
}
