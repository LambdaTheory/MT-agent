import type { PeriodKey } from '../domain/types.js';
import type { LinkListingState } from '../linkRegistry/types.js';

export const INVENTORY_STATUS_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export interface InventoryStatusPeriodMetrics {
  exposure: number | null;
  publicVisits: number | null;
  amount: number | null;
  createdOrders: number | null;
  signedOrders: number | null;
  reviewedOrders: number | null;
  shippedOrders: number | null;
  createdOrderAmount: number | null;
  signedOrderAmount: number | null;
  reviewedOrderAmount: number | null;
  shippedOrderAmount: number | null;
  exposureVisitRate: number | null;
  visitCreatedOrderRate: number | null;
  visitShipmentRate: number | null;
}

export interface InventoryStatusTopLink {
  internalProductId: string;
  platformProductId?: string;
  productName: string;
  shortName?: string;
  listingState: LinkListingState;
  oneDayExposure: number | null;
  oneDayPublicVisits: number | null;
  oneDayAmount: number | null;
}

export interface InventoryStatusGroupSnapshot {
  sameSkuGroupId: string;
  groupName: string;
  categoryId?: string;
  categoryName?: string;
  productType?: string;
  activeLinkCount: number;
  totalLinkCount: number;
  mappedRowCount: number;
  missingMetricLinkCount: number;
  periods: Record<PeriodKey, InventoryStatusPeriodMetrics>;
  topLinks: InventoryStatusTopLink[];
  risks: string[];
}

export interface InventoryStatusCoverageSummary {
  groupedLinkCount: number;
  ungroupedLinkCount: number;
  groupsWithMetrics: number;
  groupsWithoutMetrics: number;
}

export interface InventoryStatusRegistryAuditSummary {
  totalLinks: number;
  onSaleLinks: number;
  delistedLinks: number;
  goneLinks: number;
  unknownLinks: number;
  overrideRiskCount: number;
}

export interface InventoryStatusSnapshot {
  schemaVersion: typeof INVENTORY_STATUS_SNAPSHOT_SCHEMA_VERSION;
  generationId: string;
  date: string;
  sourceReportDate: string;
  generatedAt: string;
  warnings: string[];
  summary: {
    sameSkuGroupCount: number;
    activeLinkCount: number;
    totalLinkCount: number;
  };
  coverage: InventoryStatusCoverageSummary;
  registryAuditSummary: InventoryStatusRegistryAuditSummary;
  groups: InventoryStatusGroupSnapshot[];
}
