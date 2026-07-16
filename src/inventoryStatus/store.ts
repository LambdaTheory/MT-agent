import { readFile } from 'node:fs/promises';
import { writeJsonAtomic } from '../linkRegistry/persistence.js';
import {
  INVENTORY_STATUS_SNAPSHOT_SCHEMA_VERSION,
  type InventoryStatusPeriodMetrics,
  type InventoryStatusSnapshot,
  type InventoryStatusTopLink,
} from './types.js';

const periodKeys = ['1d', '7d', '30d'] as const;
const periodMetricFields = [
  'exposure',
  'publicVisits',
  'amount',
  'createdOrders',
  'signedOrders',
  'reviewedOrders',
  'shippedOrders',
  'createdOrderAmount',
  'signedOrderAmount',
  'reviewedOrderAmount',
  'shippedOrderAmount',
  'exposureVisitRate',
  'visitCreatedOrderRate',
  'visitShipmentRate',
] satisfies readonly (keyof InventoryStatusPeriodMetrics)[];
const listingStates = ['on_sale', 'delisted', 'gone', 'unknown'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isListingState(value: unknown): value is (typeof listingStates)[number] {
  return value === 'on_sale' || value === 'delisted' || value === 'gone' || value === 'unknown';
}

function isNonNegativeFiniteNumberOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}

function hasStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function hasCounts(value: unknown, fields: readonly string[]): boolean {
  return isRecord(value) && fields.every((field) => isNonNegativeInteger(value[field]));
}

function isInventoryStatusPeriodMetrics(value: unknown): value is InventoryStatusPeriodMetrics {
  return isRecord(value) && periodMetricFields.every((field) => isNonNegativeFiniteNumberOrNull(value[field]));
}

function hasExactPeriods(value: unknown): value is Record<(typeof periodKeys)[number], InventoryStatusPeriodMetrics> {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === periodKeys.length &&
    periodKeys.every((periodKey) => Object.prototype.hasOwnProperty.call(value, periodKey)) &&
    periodKeys.every((periodKey) => isInventoryStatusPeriodMetrics(value[periodKey]))
  );
}

function isInventoryStatusTopLink(value: unknown): value is InventoryStatusTopLink {
  return (
    isRecord(value) &&
    isNonEmptyString(value.internalProductId) &&
    isNonEmptyString(value.productName) &&
    isOptionalString(value.platformProductId) &&
    isOptionalString(value.shortName) &&
    isListingState(value.listingState) &&
    isNonNegativeFiniteNumberOrNull(value.oneDayExposure) &&
    isNonNegativeFiniteNumberOrNull(value.oneDayPublicVisits) &&
    isNonNegativeFiniteNumberOrNull(value.oneDayAmount)
  );
}

function isInventoryStatusGroupSnapshot(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonEmptyString(value.sameSkuGroupId) &&
    isNonEmptyString(value.groupName) &&
    isOptionalString(value.categoryId) &&
    isOptionalString(value.categoryName) &&
    isOptionalString(value.productType) &&
    hasCounts(value, ['activeLinkCount', 'totalLinkCount', 'mappedRowCount', 'missingMetricLinkCount']) &&
    hasExactPeriods(value.periods) &&
    Array.isArray(value.topLinks) &&
    value.topLinks.every(isInventoryStatusTopLink) &&
    hasStringArray(value.risks)
  );
}

function isInventoryStatusSnapshot(value: unknown): value is InventoryStatusSnapshot {
  return (
    isRecord(value) &&
    value.schemaVersion === INVENTORY_STATUS_SNAPSHOT_SCHEMA_VERSION &&
    isNonEmptyString(value.generationId) &&
    isNonEmptyString(value.date) &&
    isNonEmptyString(value.sourceReportDate) &&
    isNonEmptyString(value.generatedAt) &&
    hasStringArray(value.warnings) &&
    hasCounts(value.summary, ['sameSkuGroupCount', 'activeLinkCount', 'totalLinkCount']) &&
    hasCounts(value.coverage, ['groupedLinkCount', 'ungroupedLinkCount', 'groupsWithMetrics', 'groupsWithoutMetrics']) &&
    hasCounts(value.registryAuditSummary, [
      'totalLinks',
      'onSaleLinks',
      'delistedLinks',
      'goneLinks',
      'unknownLinks',
      'overrideRiskCount',
    ]) &&
    Array.isArray(value.groups) &&
    value.groups.every(isInventoryStatusGroupSnapshot)
  );
}

function isEnoent(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
}

export async function writeInventorySameSkuSnapshot(snapshot: InventoryStatusSnapshot, path: string): Promise<void> {
  await writeJsonAtomic(path, snapshot);
}

export async function readInventorySameSkuSnapshot(path: string): Promise<InventoryStatusSnapshot | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    return isInventoryStatusSnapshot(parsed) ? parsed : null;
  } catch (error) {
    if (isEnoent(error)) return null;
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}
