import { aggregateWindowProducts, readWindowMetric, type WindowProductAggregate } from '../../agentData/windowAggregate.js';
import { createLinkRegistry } from '../../linkRegistry/store.js';
import type { LinkRegistryEntry } from '../../linkRegistry/types.js';
import type { InactiveRefreshNewLinkItem, InactiveRefreshPlanResult } from './types.js';

const DAILY_LIMIT = 20;

function positiveDashboardAmount(aggregate: WindowProductAggregate): number | undefined {
  for (const key of ['createdOrderAmount', 'signedOrderAmount', 'reviewedOrderAmount', 'shippedOrderAmount'] as const) {
    const value = readWindowMetric(aggregate, key);
    if (typeof value === 'number' && value > 0) return value;
  }
  return undefined;
}

function groupLimit(activeCount: number): number {
  if (activeCount <= 3) return 1;
  if (activeCount <= 10) return 2;
  return Math.floor(activeCount * 0.2);
}

function classify(aggregate: WindowProductAggregate): 'executable' | 'manual' | 'excluded' {
  const amount = readWindowMetric(aggregate, 'amount');
  const exposure = readWindowMetric(aggregate, 'exposure');
  const visitRate = readWindowMetric(aggregate, 'exposureVisitRate');
  const visits = readWindowMetric(aggregate, 'publicVisits');
  const custodyDays = readWindowMetric(aggregate, 'custodyDays');
  if (custodyDays === undefined) return 'manual';
  if (custodyDays < 14) return 'excluded';
  if (amount === undefined) return 'manual';
  if (amount > 0) return 'excluded';
  if (positiveDashboardAmount(aggregate) !== undefined) return 'manual';
  if ((exposure ?? 0) / 14 >= 1000 && (visitRate ?? 0) > 0.05) return 'excluded';
  if (visits === undefined && aggregate.missingDashboardDates.length > 0) return 'manual';
  return 'executable';
}

function isSafeSourceAggregate(aggregate: WindowProductAggregate | undefined): boolean {
  if (!aggregate) return false;
  const amount = readWindowMetric(aggregate, 'amount');
  const custodyDays = readWindowMetric(aggregate, 'custodyDays');
  return typeof amount === 'number' && amount > 0 && typeof custodyDays === 'number' && custodyDays >= 14;
}

function displayName(entry: LinkRegistryEntry | undefined, aggregate: WindowProductAggregate): string {
  return entry?.shortName ?? entry?.productName ?? aggregate.productName ?? entry?.sameSkuGroupId ?? aggregate.internalProductId;
}

export async function buildInactiveRefreshPlan(input: { outputDir: string; date: string; registryEntries: LinkRegistryEntry[] }): Promise<InactiveRefreshPlanResult> {
  const aggregates = await aggregateWindowProducts({ outputDir: input.outputDir, endDate: input.date, windowDays: 14 });
  const registry = createLinkRegistry(input.registryEntries);
  const entriesByInternalId = new Map(input.registryEntries.map((entry) => [entry.internalProductId, entry]));
  const groups = new Map<string, { entries: LinkRegistryEntry[]; aggregates: WindowProductAggregate[] }>();
  const aggregatesByInternalId = new Map(aggregates.map((aggregate) => [aggregate.internalProductId, aggregate]));
  let manualReview = 0;
  let excluded = 0;

  for (const aggregate of aggregates) {
    const entry = entriesByInternalId.get(aggregate.internalProductId);
    if (entry && entry.status !== 'active') continue;
    const decision = classify(aggregate);
    if (decision === 'manual') {
      manualReview += 1;
      continue;
    }
    if (decision === 'excluded') {
      excluded += 1;
      continue;
    }
    const groupId = entry?.sameSkuGroupId ?? `ungrouped:${aggregate.internalProductId}`;
    const current = groups.get(groupId) ?? { entries: [], aggregates: [] };
    if (entry) current.entries.push(entry);
    current.aggregates.push(aggregate);
    groups.set(groupId, current);
  }

  const delistProductIds: string[] = [];
  const newLinkItems: InactiveRefreshNewLinkItem[] = [];
  const skippedGroups: string[] = [];
  const lines: string[] = [];
  let remaining = DAILY_LIMIT;

  for (const [groupId, group] of [...groups.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
    if (remaining <= 0) break;
    const candidateIds = new Set(group.entries.map((entry) => entry.internalProductId));
    const source = registry
      .listBySameSkuGroup(groupId, { includeRemoved: false })
      .filter((entry) => entry.status === 'active' && !candidateIds.has(entry.internalProductId))
      .find((entry) => isSafeSourceAggregate(aggregatesByInternalId.get(entry.internalProductId)));
    if (!source) {
      skippedGroups.push(`${groupId}: 无安全源`);
      continue;
    }
    const activeCount = registry.listBySameSkuGroup(groupId, { includeRemoved: false }).filter((entry) => entry.status === 'active').length;
    const limit = Math.min(groupLimit(activeCount), remaining, group.entries.length);
    const selected = group.entries.slice(0, limit);
    if (selected.length === 0) continue;
    delistProductIds.push(...selected.map((entry) => entry.internalProductId));
    newLinkItems.push({
      keyword: source.sameSkuGroupId ?? displayName(source, group.aggregates[0]!),
      count: selected.length,
      sourceProductId: source.internalProductId,
      sourceProductName: source.shortName ?? source.productName ?? source.internalProductId,
      ...(source.sameSkuGroupId ? { sameSkuGroupId: source.sameSkuGroupId } : {}),
    });
    lines.push(`- ${source.sameSkuGroupId ?? groupId}：下架 ${selected.map((entry) => entry.internalProductId).join('、')}，补链源 ${source.internalProductId}`);
    remaining -= selected.length;
    excluded += Math.max(0, group.entries.length - selected.length);
  }

  const plan = delistProductIds.length > 0 ? {
    date: input.date,
    delistProductIds,
    newLinkItems,
    skippedGroups,
    executableCount: delistProductIds.length,
  } : null;
  return {
    plan,
    summary: { candidates: manualReview + excluded + delistProductIds.length, executable: delistProductIds.length, manualReview, excluded },
    lines,
  };
}
