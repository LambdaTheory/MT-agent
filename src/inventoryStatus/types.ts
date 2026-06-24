import type { PeriodKey } from '../domain/types.js';

export interface InventoryStatusPeriodMetrics {
  exposure: number;
  publicVisits: number;
  amount: number;
  createdOrders: number;
  signedOrders: number;
  reviewedOrders: number;
  shippedOrders: number;
  createdOrderAmount: number;
  signedOrderAmount: number;
  reviewedOrderAmount: number;
  shippedOrderAmount: number;
  exposureVisitRate: number;
  visitCreatedOrderRate: number;
  visitShipmentRate: number;
}

export interface InventoryStatusTopLink {
  internalProductId: string;
  platformProductId?: string;
  productName: string;
  shortName?: string;
  status: 'active' | 'removed' | 'unknown';
  oneDayExposure: number;
  oneDayPublicVisits: number;
  oneDayAmount: number;
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
  activeLinks: number;
  removedLinks: number;
  unknownLinks: number;
  overrideRiskCount: number;
}

export interface InventoryStatusSnapshot {
  date: string;
  sourceReportDate: string;
  generatedAt: string;
  summary: {
    sameSkuGroupCount: number;
    activeLinkCount: number;
    totalLinkCount: number;
  };
  coverage: InventoryStatusCoverageSummary;
  registryAuditSummary: InventoryStatusRegistryAuditSummary;
  groups: InventoryStatusGroupSnapshot[];
}
