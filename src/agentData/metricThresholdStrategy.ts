import { aggregateWindowProducts, readWindowMetric, type WindowProductAggregate } from './windowAggregate.js';
import { getPublicTrafficMetric, type PublicTrafficMetricKey, type PublicTrafficMetricSource } from './publicTrafficMetricCatalog.js';
import { createLinkRegistry } from '../linkRegistry/store.js';
import type { LinkRegistryEntry } from '../linkRegistry/types.js';

export type MetricThresholdOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';

export interface MetricThresholdCondition {
  metric: PublicTrafficMetricKey;
  operator: MetricThresholdOperator;
  value: number;
}

export interface MetricThresholdStrategyInput extends MetricThresholdCondition {
  query?: string;
  sameSkuGroupId?: string;
  conditions?: MetricThresholdCondition[];
  date: string;
  windowDays: number;
  requireActive?: boolean;
  requireOnlineDays?: number;
}

export interface MetricThresholdStrategyResult {
  metric: PublicTrafficMetricKey;
  windowDays: number;
  conditions?: MetricThresholdCondition[];
  conditionSummary?: string;
  candidateProductIds: string[];
  skipped: {
    inactive: number;
    missingRow: number;
    unavailableMetric: number;
    onlineLessThanRequired: number;
    onlineDaysUnknown: number;
  };
  unavailableMetricProductIds: string[];
  availability?: {
    unavailableMetricCount: number;
    unavailableMetricProductIds: string[];
    conditions: Array<{
      metric: PublicTrafficMetricKey;
      unavailableMetricCount: number;
      unavailableMetricProductIds: string[];
    }>;
  };
  reasonSummary: string[];
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function metricSourceLabel(source: PublicTrafficMetricSource): string {
  if (source === 'exposure') return '公域曝光页数据';
  if (source === 'dashboard') return '访问页数据';
  if (source === 'derived_exposure') return '公域曝光页派生数据';
  if (source === 'derived_dashboard') return '访问页派生数据';
  return '链接状态数据';
}

function compareMetric(value: number, expected: number, operator: MetricThresholdOperator): boolean {
  if (operator === 'eq') return value === expected;
  if (operator === 'neq') return value !== expected;
  if (operator === 'gt') return value > expected;
  if (operator === 'gte') return value >= expected;
  if (operator === 'lt') return value < expected;
  return value <= expected;
}

function operatorLabel(operator: MetricThresholdOperator): string {
  if (operator === 'eq') return '=';
  if (operator === 'neq') return '!=';
  if (operator === 'gt') return '>';
  if (operator === 'gte') return '>=';
  if (operator === 'lt') return '<';
  return '<=';
}

export function formatMetricThresholdCondition(input: MetricThresholdCondition & { windowDays: number }): string {
  const definition = getPublicTrafficMetric(input.metric);
  return `近${input.windowDays}天${definition?.label ?? input.metric} ${operatorLabel(input.operator)} ${input.value}`;
}

function strategyConditions(input: MetricThresholdStrategyInput): MetricThresholdCondition[] {
  if (input.conditions === undefined) return [{ metric: input.metric, operator: input.operator, value: input.value }];
  if (input.conditions.length === 0) throw new Error('conditions must contain at least one condition');
  return input.conditions;
}

function parseDateToUtcDay(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match?.[1] || !match[2] || !match[3]) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const utc = Date.UTC(year, month - 1, day);
  const parsed = new Date(utc);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return utc;
}

function estimateOnlineDays(aggregate: WindowProductAggregate, entry: LinkRegistryEntry, reportDate: string): number | null {
  const custodyDays = readWindowMetric(aggregate, 'custodyDays');
  if (typeof custodyDays === 'number' && Number.isFinite(custodyDays) && custodyDays >= 0) return Math.floor(custodyDays);
  const reportDay = parseDateToUtcDay(reportDate);
  const firstSeenDay = parseDateToUtcDay(entry.firstSeenDate);
  if (reportDay === null || firstSeenDay === null || firstSeenDay > reportDay) return null;
  return Math.floor((reportDay - firstSeenDay) / MS_PER_DAY) + 1;
}

function scopedEntries(registryEntries: LinkRegistryEntry[], input: MetricThresholdStrategyInput): LinkRegistryEntry[] {
  const sameSkuGroupId = input.sameSkuGroupId?.trim();
  if (sameSkuGroupId) return registryEntries.filter((entry) => entry.sameSkuGroupId?.trim() === sameSkuGroupId);

  const query = input.query?.trim();
  if (!query) return registryEntries;
  const registry = createLinkRegistry(registryEntries);

  if (/^\d+$/.test(query)) {
    const entry = registry.getByInternalId(query);
    const groupId = entry?.sameSkuGroupId?.trim();
    if (groupId) return registry.listBySameSkuGroup(groupId, { includeRemoved: true, includeUnknown: true });
    return entry ? [entry] : [];
  }

  const directGroup = registry.listBySameSkuGroup(query, { includeRemoved: true, includeUnknown: true });
  if (directGroup.length > 0) return directGroup;

  const alias = registry.resolveAlias(query);
  if (alias.status === 'unique') {
    return alias.sameSkuGroupId ? registry.listBySameSkuGroup(alias.sameSkuGroupId, { includeRemoved: true, includeUnknown: true }) : alias.entries;
  }
  return [];
}

function aggregateIndex(aggregates: WindowProductAggregate[]): { byInternalProductId: Map<string, WindowProductAggregate>; byPlatformProductId: Map<string, WindowProductAggregate> } {
  const byInternalProductId = new Map<string, WindowProductAggregate>();
  const byPlatformProductId = new Map<string, WindowProductAggregate>();
  for (const aggregate of aggregates) {
    byInternalProductId.set(aggregate.internalProductId, aggregate);
    if (aggregate.platformProductId) byPlatformProductId.set(aggregate.platformProductId, aggregate);
  }
  return { byInternalProductId, byPlatformProductId };
}

function findAggregate(index: ReturnType<typeof aggregateIndex>, entry: LinkRegistryEntry): WindowProductAggregate | undefined {
  return index.byInternalProductId.get(entry.internalProductId)
    ?? (entry.platformProductId ? index.byPlatformProductId.get(entry.platformProductId) : undefined);
}

function availabilityReasonText(metric: PublicTrafficMetricKey, unavailableMetricCount: number): string | null {
  if (unavailableMetricCount === 0) return null;
  const definition = getPublicTrafficMetric(metric);
  const source = metricSourceLabel(definition?.source ?? 'dashboard');
  return `${definition?.label ?? metric}在窗口内不可用：${unavailableMetricCount} 条${source}缺失或不完整；未将缺失值按0筛选。`;
}

export async function evaluateMetricThresholdStrategy(
  outputDir: string,
  registryEntries: LinkRegistryEntry[],
  input: MetricThresholdStrategyInput,
): Promise<MetricThresholdStrategyResult> {
  const aggregates = await aggregateWindowProducts({ outputDir, endDate: input.date, windowDays: input.windowDays });
  const index = aggregateIndex(aggregates);
  const conditions = strategyConditions(input);
  const skipped = { inactive: 0, missingRow: 0, unavailableMetric: 0, onlineLessThanRequired: 0, onlineDaysUnknown: 0 };
  const candidateProductIds: string[] = [];
  const unavailableMetricProductIds: string[] = [];
  const conditionAvailability = conditions.map((condition) => ({
    metric: condition.metric,
    unavailableMetricCount: 0,
    unavailableMetricProductIds: [] as string[],
  }));

  for (const entry of scopedEntries(registryEntries, input)) {
    if (input.requireActive && entry.status !== 'active') {
      skipped.inactive += 1;
      continue;
    }

    const aggregate = findAggregate(index, entry);
    if (!aggregate) {
      skipped.missingRow += 1;
      continue;
    }

    if (input.requireOnlineDays !== undefined) {
      const onlineDays = estimateOnlineDays(aggregate, entry, input.date);
      if (onlineDays === null) {
        skipped.onlineDaysUnknown += 1;
        continue;
      }
      if (onlineDays < input.requireOnlineDays) {
        skipped.onlineLessThanRequired += 1;
        continue;
      }
    }

    let hasUnavailableCondition = false;
    let matchesEveryCondition = true;
    for (const [conditionIndex, condition] of conditions.entries()) {
      const availability = aggregate.availability[condition.metric];
      const metricValue = readWindowMetric(aggregate, condition.metric);
      if (!availability?.available || metricValue === undefined) {
        hasUnavailableCondition = true;
        conditionAvailability[conditionIndex].unavailableMetricCount += 1;
        conditionAvailability[conditionIndex].unavailableMetricProductIds.push(entry.internalProductId);
        continue;
      }
      if (!compareMetric(metricValue, condition.value, condition.operator)) matchesEveryCondition = false;
    }
    if (hasUnavailableCondition) {
      skipped.unavailableMetric += 1;
      unavailableMetricProductIds.push(entry.internalProductId);
      continue;
    }
    if (matchesEveryCondition) candidateProductIds.push(entry.internalProductId);
  }

  const conditionSummary = conditions
    .map((condition) => formatMetricThresholdCondition({ ...condition, windowDays: input.windowDays }))
    .join(' 且 ');
  const unavailableReasons = conditionAvailability
    .map((item) => availabilityReasonText(item.metric, item.unavailableMetricCount))
    .filter((item): item is string => Boolean(item));
  return {
    metric: conditions[0].metric,
    windowDays: input.windowDays,
    conditions,
    conditionSummary,
    candidateProductIds,
    skipped,
    unavailableMetricProductIds,
    availability: {
      unavailableMetricCount: skipped.unavailableMetric,
      unavailableMetricProductIds,
      conditions: conditionAvailability,
    },
    reasonSummary: [
      candidateProductIds.length > 0 ? `找到 ${candidateProductIds.length} 条符合 ${conditionSummary} 的链接。` : `没有找到符合 ${conditionSummary} 的链接。`,
      ...unavailableReasons,
    ],
  };
}
