import type { PeriodKey } from '../domain/types.js';
import type { LinkRegistryOverrideRisk } from '../linkRegistry/overrides.js';
import type { LinkRegistryEntry } from '../linkRegistry/types.js';
import type { PublicTrafficDataReportContext, PublicTrafficPeriodMetrics, PublicTrafficProductDataRow } from '../publicTraffic/types.js';
import { INVENTORY_STATUS_SNAPSHOT_SCHEMA_VERSION, type InventoryStatusGroupSnapshot, type InventoryStatusPeriodMetrics, type InventoryStatusSnapshot, type InventoryStatusTopLink } from './types.js';

const PERIODS: PeriodKey[] = ['1d', '7d', '30d'];

export interface BuildInventorySameSkuSnapshotInput {
  date: string;
  reportDate: string;
  generationId: string;
  generatedAt?: string;
  context: PublicTrafficDataReportContext;
  registry: LinkRegistryEntry[];
  overrideRisks: LinkRegistryOverrideRisk[];
}

interface GroupAccumulator {
  seed: LinkRegistryEntry;
  entries: LinkRegistryEntry[];
  conflictEntries: LinkRegistryEntry[];
  rows: Array<{ entry: LinkRegistryEntry; row: PublicTrafficProductDataRow }>;
  missingMetricEntries: LinkRegistryEntry[];
  periods: Record<PeriodKey, InventoryStatusPeriodMetrics>;
}

function emptyPeriodMetrics(): InventoryStatusPeriodMetrics {
  return {
    exposure: null,
    publicVisits: null,
    amount: null,
    createdOrders: null,
    signedOrders: null,
    reviewedOrders: null,
    shippedOrders: null,
    createdOrderAmount: null,
    signedOrderAmount: null,
    reviewedOrderAmount: null,
    shippedOrderAmount: null,
    exposureVisitRate: null,
    visitCreatedOrderRate: null,
    visitShipmentRate: null,
  };
}

function createAccumulator(seed: LinkRegistryEntry): GroupAccumulator {
  return {
    seed,
    entries: [],
    conflictEntries: [],
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

function listingState(entry: LinkRegistryEntry): NonNullable<LinkRegistryEntry['listingState']> {
  return entry.listingState ?? 'unknown';
}

function addKnown(current: number | null, value: number): number {
  return (current ?? 0) + value;
}

function mergePeriodMetric(target: InventoryStatusPeriodMetrics, source: PublicTrafficPeriodMetrics): void {
  if (source.hasExposureData) {
    target.exposure = addKnown(target.exposure, source.exposure);
    target.publicVisits = addKnown(target.publicVisits, source.publicVisits);
    target.amount = addKnown(target.amount, source.amount);
  }
  if (source.hasDashboardData) {
    target.createdOrders = addKnown(target.createdOrders, source.createdOrders);
    target.signedOrders = addKnown(target.signedOrders, source.signedOrders);
    target.reviewedOrders = addKnown(target.reviewedOrders, source.reviewedOrders);
    target.shippedOrders = addKnown(target.shippedOrders, source.shippedOrders);
    if (typeof source.createdOrderAmount === 'number') target.createdOrderAmount = addKnown(target.createdOrderAmount, source.createdOrderAmount);
    if (typeof source.signedOrderAmount === 'number') target.signedOrderAmount = addKnown(target.signedOrderAmount, source.signedOrderAmount);
    if (typeof source.reviewedOrderAmount === 'number') target.reviewedOrderAmount = addKnown(target.reviewedOrderAmount, source.reviewedOrderAmount);
    if (typeof source.shippedOrderAmount === 'number') target.shippedOrderAmount = addKnown(target.shippedOrderAmount, source.shippedOrderAmount);
  }
}

function recomputeRates(metric: InventoryStatusPeriodMetrics): InventoryStatusPeriodMetrics {
  return {
    ...metric,
    exposureVisitRate: metric.exposure !== null && metric.publicVisits !== null && metric.exposure > 0 ? metric.publicVisits / metric.exposure : null,
    visitCreatedOrderRate: metric.publicVisits !== null && metric.createdOrders !== null && metric.publicVisits > 0 ? metric.createdOrders / metric.publicVisits : null,
    visitShipmentRate: metric.publicVisits !== null && metric.shippedOrders !== null && metric.publicVisits > 0 ? metric.shippedOrders / metric.publicVisits : null,
  };
}

function mergeRow(group: GroupAccumulator, row: PublicTrafficProductDataRow, entry: LinkRegistryEntry): void {
  group.rows.push({ entry, row });
  for (const period of PERIODS) mergePeriodMetric(group.periods[period], row.periods[period]);
}

function groupName(entry: LinkRegistryEntry): string {
  return entry.shortName?.trim() || entry.productName?.trim() || entry.sameSkuGroupId?.trim() || entry.internalProductId;
}

function oneDayExposureMetric(row: PublicTrafficProductDataRow): Pick<InventoryStatusTopLink, 'oneDayExposure' | 'oneDayPublicVisits' | 'oneDayAmount'> {
  const oneDay = row.periods['1d'];
  if (!oneDay.hasExposureData) return { oneDayExposure: null, oneDayPublicVisits: null, oneDayAmount: null };
  return {
    oneDayExposure: oneDay.exposure,
    oneDayPublicVisits: oneDay.publicVisits,
    oneDayAmount: oneDay.amount,
  };
}

function compareNullableDesc(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right - left;
}

function topLinks(rows: Array<{ entry: LinkRegistryEntry; row: PublicTrafficProductDataRow }>): InventoryStatusTopLink[] {
  return rows
    .map(({ entry, row }) => ({
      internalProductId: entry.internalProductId,
      ...(entry.platformProductId ? { platformProductId: entry.platformProductId } : {}),
      productName: row.productName || entry.productName || entry.shortName || entry.internalProductId,
      ...(entry.shortName ? { shortName: entry.shortName } : {}),
      listingState: listingState(entry),
      ...oneDayExposureMetric(row),
    }))
    .sort((left, right) =>
      compareNullableDesc(left.oneDayAmount, right.oneDayAmount)
      || compareNullableDesc(left.oneDayPublicVisits, right.oneDayPublicVisits)
      || compareNullableDesc(left.oneDayExposure, right.oneDayExposure)
      || Number(left.internalProductId) - Number(right.internalProductId)
      || left.internalProductId.localeCompare(right.internalProductId))
    .slice(0, 5);
}

function risks(group: GroupAccumulator, activeLinkCount: number): string[] {
  const items: string[] = [];
  if (activeLinkCount === 0) items.push('无在售链接');
  else if (activeLinkCount === 1) items.push('仅 1 条在售链接');
  if (group.entries.some((entry) => listingState(entry) !== 'on_sale')) items.push('组内存在 delisted/gone/unknown 链接');
  if (group.conflictEntries.length > 0) items.push(`${group.conflictEntries.length} 条映射冲突链接`);
  if (group.missingMetricEntries.length > 0) items.push(`组内 ${group.missingMetricEntries.length} 条链接无日报数据`);
  return items;
}

function finalizeGroup(sameSkuGroupId: string, group: GroupAccumulator): InventoryStatusGroupSnapshot {
  const activeLinkCount = group.entries.filter((entry) => listingState(entry) === 'on_sale').length;
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
  const warnings: string[] = [];

  for (const entry of input.registry) {
    const sameSkuGroupId = entry.sameSkuGroupId?.trim();
    if (!sameSkuGroupId) continue;
    const current = groups.get(sameSkuGroupId) ?? createAccumulator(entry);
    current.entries.push(entry);
    if (entry.platformProductIdConflict) {
      current.conflictEntries.push(entry);
      warnings.push(`跳过映射冲突链接 ${entry.internalProductId}: ${entry.platformProductIdConflict.platformProductIds.join(', ')}`);
    } else {
      const row = findRow(input.context, entry);
      if (row) mergeRow(current, row, entry);
      else current.missingMetricEntries.push(entry);
    }
    groups.set(sameSkuGroupId, current);
  }

  const snapshots = [...groups.entries()]
    .map(([sameSkuGroupId, group]) => finalizeGroup(sameSkuGroupId, group))
    .sort((left, right) =>
      compareNullableDesc(left.periods['1d'].amount, right.periods['1d'].amount)
      || compareNullableDesc(left.periods['1d'].publicVisits, right.periods['1d'].publicVisits)
      || left.sameSkuGroupId.localeCompare(right.sameSkuGroupId));

  return {
    schemaVersion: INVENTORY_STATUS_SNAPSHOT_SCHEMA_VERSION,
    generationId: input.generationId,
    date: input.date,
    sourceReportDate: input.reportDate,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    warnings,
    summary: {
      sameSkuGroupCount: snapshots.length,
      activeLinkCount: input.registry.filter((entry) => listingState(entry) === 'on_sale').length,
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
      onSaleLinks: input.registry.filter((entry) => listingState(entry) === 'on_sale').length,
      delistedLinks: input.registry.filter((entry) => listingState(entry) === 'delisted').length,
      goneLinks: input.registry.filter((entry) => listingState(entry) === 'gone').length,
      unknownLinks: input.registry.filter((entry) => listingState(entry) === 'unknown').length,
      overrideRiskCount: input.overrideRisks.length,
    },
    groups: snapshots,
  };
}
