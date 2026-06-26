import type { PeriodKey } from '../domain/types.js';
import type { LinkRegistryOverrideRisk } from '../linkRegistry/overrides.js';
import type { LinkRegistryEntry } from '../linkRegistry/types.js';
import type { PublicTrafficDataReportContext, PublicTrafficPeriodMetrics, PublicTrafficProductDataRow } from '../publicTraffic/types.js';
import type { InventoryStatusGroupSnapshot, InventoryStatusPeriodMetrics, InventoryStatusSnapshot, InventoryStatusTopLink } from './types.js';

const PERIODS: PeriodKey[] = ['1d', '7d', '30d'];

export interface BuildInventorySameSkuSnapshotInput {
  date: string;
  reportDate: string;
  context: PublicTrafficDataReportContext;
  registry: LinkRegistryEntry[];
  overrideRisks: LinkRegistryOverrideRisk[];
}

interface GroupAccumulator {
  seed: LinkRegistryEntry;
  entries: LinkRegistryEntry[];
  rows: Array<{ entry: LinkRegistryEntry; row: PublicTrafficProductDataRow }>;
  missingMetricEntries: LinkRegistryEntry[];
  periods: Record<PeriodKey, InventoryStatusPeriodMetrics>;
}

function emptyPeriodMetrics(): InventoryStatusPeriodMetrics {
  return {
    exposure: 0,
    publicVisits: 0,
    amount: 0,
    createdOrders: 0,
    signedOrders: 0,
    reviewedOrders: 0,
    shippedOrders: 0,
    createdOrderAmount: 0,
    signedOrderAmount: 0,
    reviewedOrderAmount: 0,
    shippedOrderAmount: 0,
    exposureVisitRate: 0,
    visitCreatedOrderRate: 0,
    visitShipmentRate: 0,
  };
}

function createAccumulator(seed: LinkRegistryEntry): GroupAccumulator {
  return {
    seed,
    entries: [],
    rows: [],
    missingMetricEntries: [],
    periods: {
      '1d': emptyPeriodMetrics(),
      '7d': emptyPeriodMetrics(),
      '30d': emptyPeriodMetrics(),
    },
  };
}

function extractInternalProductId(displayProductId: string): string | null {
  return /^端内ID\s*(\d+)$/i.exec(displayProductId.trim())?.[1] ?? null;
}

function findRow(context: PublicTrafficDataReportContext, entry: LinkRegistryEntry): PublicTrafficProductDataRow | undefined {
  return context.rows.find((row) => {
    const internalProductId = extractInternalProductId(row.displayProductId);
    return internalProductId === entry.internalProductId || (!!entry.platformProductId && row.platformProductId === entry.platformProductId);
  });
}

function mergePeriodMetric(target: InventoryStatusPeriodMetrics, source: PublicTrafficPeriodMetrics): void {
  target.exposure += source.exposure;
  target.publicVisits += source.publicVisits;
  target.amount += source.amount;
  target.createdOrders += source.createdOrders;
  target.signedOrders += source.signedOrders;
  target.reviewedOrders += source.reviewedOrders;
  target.shippedOrders += source.shippedOrders;
  target.createdOrderAmount += source.createdOrderAmount ?? 0;
  target.signedOrderAmount += source.signedOrderAmount ?? 0;
  target.reviewedOrderAmount += source.reviewedOrderAmount ?? 0;
  target.shippedOrderAmount += source.shippedOrderAmount ?? 0;
}

function recomputeRates(metric: InventoryStatusPeriodMetrics): InventoryStatusPeriodMetrics {
  return {
    ...metric,
    exposureVisitRate: metric.exposure > 0 ? metric.publicVisits / metric.exposure : 0,
    visitCreatedOrderRate: metric.publicVisits > 0 ? metric.createdOrders / metric.publicVisits : 0,
    visitShipmentRate: metric.publicVisits > 0 ? metric.shippedOrders / metric.publicVisits : 0,
  };
}

function mergeRow(group: GroupAccumulator, row: PublicTrafficProductDataRow, entry: LinkRegistryEntry): void {
  group.rows.push({ entry, row });
  for (const period of PERIODS) mergePeriodMetric(group.periods[period], row.periods[period]);
}

function groupName(entry: LinkRegistryEntry): string {
  return entry.shortName?.trim() || entry.productName?.trim() || entry.sameSkuGroupId?.trim() || entry.internalProductId;
}

function topLinks(rows: Array<{ entry: LinkRegistryEntry; row: PublicTrafficProductDataRow }>): InventoryStatusTopLink[] {
  return rows
    .map(({ entry, row }) => ({
      internalProductId: entry.internalProductId,
      ...(entry.platformProductId ? { platformProductId: entry.platformProductId } : {}),
      productName: row.productName || entry.productName || entry.shortName || entry.internalProductId,
      ...(entry.shortName ? { shortName: entry.shortName } : {}),
      status: entry.status,
      oneDayExposure: row.periods['1d'].exposure,
      oneDayPublicVisits: row.periods['1d'].publicVisits,
      oneDayAmount: row.periods['1d'].amount,
    }))
    .sort((left, right) =>
      right.oneDayAmount - left.oneDayAmount
      || right.oneDayPublicVisits - left.oneDayPublicVisits
      || right.oneDayExposure - left.oneDayExposure
      || Number(left.internalProductId) - Number(right.internalProductId)
      || left.internalProductId.localeCompare(right.internalProductId))
    .slice(0, 5);
}

function risks(group: GroupAccumulator, activeLinkCount: number): string[] {
  const items: string[] = [];
  if (activeLinkCount <= 1) items.push('仅 1 条 active 链接');
  if (group.entries.some((entry) => entry.status !== 'active')) items.push('组内存在 removed/unknown 链接');
  if (group.missingMetricEntries.length > 0) items.push(`组内 ${group.missingMetricEntries.length} 条链接无日报数据`);
  return items;
}

function finalizeGroup(sameSkuGroupId: string, group: GroupAccumulator): InventoryStatusGroupSnapshot {
  const activeLinkCount = group.entries.filter((entry) => entry.status === 'active').length;
  return {
    sameSkuGroupId,
    groupName: groupName(group.seed),
    ...(group.seed.categoryId ? { categoryId: group.seed.categoryId } : {}),
    ...(group.seed.categoryName ? { categoryName: group.seed.categoryName } : {}),
    ...(group.seed.productType ? { productType: group.seed.productType } : {}),
    activeLinkCount,
    totalLinkCount: group.entries.length,
    mappedRowCount: group.rows.length,
    missingMetricLinkCount: group.missingMetricEntries.length,
    periods: {
      '1d': recomputeRates(group.periods['1d']),
      '7d': recomputeRates(group.periods['7d']),
      '30d': recomputeRates(group.periods['30d']),
    },
    topLinks: topLinks(group.rows),
    risks: risks(group, activeLinkCount),
  };
}

export function buildInventorySameSkuSnapshot(input: BuildInventorySameSkuSnapshotInput): InventoryStatusSnapshot {
  const groupedLinkCount = input.registry.filter((entry) => entry.sameSkuGroupId?.trim()).length;
  const groups = new Map<string, GroupAccumulator>();

  for (const entry of input.registry) {
    const sameSkuGroupId = entry.sameSkuGroupId?.trim();
    if (!sameSkuGroupId) continue;
    const current = groups.get(sameSkuGroupId) ?? createAccumulator(entry);
    current.entries.push(entry);
    const row = findRow(input.context, entry);
    if (row) mergeRow(current, row, entry);
    else current.missingMetricEntries.push(entry);
    groups.set(sameSkuGroupId, current);
  }

  const snapshots = [...groups.entries()]
    .map(([sameSkuGroupId, group]) => finalizeGroup(sameSkuGroupId, group))
    .sort((left, right) =>
      right.periods['1d'].amount - left.periods['1d'].amount
      || right.periods['1d'].publicVisits - left.periods['1d'].publicVisits
      || left.sameSkuGroupId.localeCompare(right.sameSkuGroupId));

  return {
    date: input.date,
    sourceReportDate: input.reportDate,
    generatedAt: `${input.date}T00:00:00.000Z`,
    summary: {
      sameSkuGroupCount: snapshots.length,
      activeLinkCount: input.registry.filter((entry) => entry.status === 'active').length,
      totalLinkCount: input.registry.length,
    },
    coverage: {
      groupedLinkCount,
      ungroupedLinkCount: input.registry.length - groupedLinkCount,
      groupsWithMetrics: snapshots.filter((group) => group.mappedRowCount > 0).length,
      groupsWithoutMetrics: snapshots.filter((group) => group.mappedRowCount === 0).length,
    },
    registryAuditSummary: {
      totalLinks: input.registry.length,
      activeLinks: input.registry.filter((entry) => entry.status === 'active').length,
      removedLinks: input.registry.filter((entry) => entry.status === 'removed').length,
      unknownLinks: input.registry.filter((entry) => entry.status === 'unknown').length,
      overrideRiskCount: input.overrideRisks.length,
    },
    groups: snapshots,
  };
}
