import type { PeriodKey, PeriodProductMetrics } from '../domain/types.js';
import type { ProductIdMapping } from '../mapping/productIdMapping.js';
import { buildDisplayProductId } from './displayProductId.js';
import type {
  ExposureCumulativeProduct,
  ExposureProductSummary,
  PublicTrafficDataContext,
  PublicTrafficPeriodMetrics,
} from './types.js';

const PERIODS: PeriodKey[] = ['1d', '7d', '30d'];

export interface MergePublicTrafficDataInput {
  dashboardRows: PeriodProductMetrics[];
  exposureByPeriod: Record<PeriodKey, ExposureProductSummary[]>;
  cumulativeProducts: ExposureCumulativeProduct[];
  mapping: ProductIdMapping;
}

function emptyPeriod(): PublicTrafficPeriodMetrics {
  return {
    exposure: 0,
    publicVisits: 0,
    dashboardVisits: 0,
    createdOrders: 0,
    signedOrders: 0,
    reviewedOrders: 0,
    shippedOrders: 0,
    amount: 0,
    exposureVisitRate: 0,
    visitCreatedOrderRate: 0,
    visitShipmentRate: 0,
    hasExposureData: false,
    hasDashboardData: false,
  };
}

function emptyPeriods(): Record<PeriodKey, PublicTrafficPeriodMetrics> {
  return { '1d': emptyPeriod(), '7d': emptyPeriod(), '30d': emptyPeriod() };
}

function canonicalPlatformProductId(platformProductId: string, mapping: ProductIdMapping): string {
  if (Object.prototype.hasOwnProperty.call(mapping, platformProductId)) return platformProductId;
  const withoutTrailingPriceDigit = platformProductId.slice(0, -1);
  return Object.prototype.hasOwnProperty.call(mapping, withoutTrailingPriceDigit) ? withoutTrailingPriceDigit : platformProductId;
}

export function mergePublicTrafficData(input: MergePublicTrafficDataInput): PublicTrafficDataContext {
  const productNames = new Map<string, string>();
  const custodyDays = new Map<string, number | null>();
  const periodRows = new Map<string, Record<PeriodKey, PublicTrafficPeriodMetrics>>();

  function ensure(platformProductId: string): Record<PeriodKey, PublicTrafficPeriodMetrics> {
    const existing = periodRows.get(platformProductId);
    if (existing) return existing;
    const created = emptyPeriods();
    periodRows.set(platformProductId, created);
    return created;
  }

  for (const row of input.cumulativeProducts) {
    const platformProductId = canonicalPlatformProductId(row.platformProductId, input.mapping);
    productNames.set(platformProductId, row.productName);
    custodyDays.set(platformProductId, row.custodyDays);
    ensure(platformProductId);
  }

  for (const period of PERIODS) {
    for (const row of input.exposureByPeriod[period] ?? []) {
      const platformProductId = canonicalPlatformProductId(row.platformProductId, input.mapping);
      productNames.set(platformProductId, productNames.get(platformProductId) || row.productName);
      const metrics = ensure(platformProductId)[period];
      metrics.exposure = row.exposure;
      metrics.publicVisits = row.visits;
      metrics.amount = row.amount;
      metrics.exposureVisitRate = row.exposure > 0 ? row.visits / row.exposure : 0;
      metrics.hasExposureData = true;
    }
  }

  for (const row of input.dashboardRows) {
    const platformProductId = canonicalPlatformProductId(row.platformProductId, input.mapping);
    productNames.set(platformProductId, productNames.get(platformProductId) || row.productName);
    const metrics = ensure(platformProductId)[row.period];
    metrics.dashboardVisits = row.visits;
    metrics.createdOrders = row.createdOrders;
    metrics.signedOrders = row.signedOrders;
    metrics.reviewedOrders = row.reviewedOrders;
    metrics.shippedOrders = row.shippedOrders;
    metrics.createdOrderAmount = row.createdOrderAmount;
    metrics.signedOrderAmount = row.signedOrderAmount;
    metrics.reviewedOrderAmount = row.reviewedOrderAmount;
    metrics.shippedOrderAmount = row.shippedOrderAmount;
    metrics.visitCreatedOrderRate = row.visits > 0 ? row.createdOrders / row.visits : 0;
    metrics.visitShipmentRate = row.visits > 0 ? row.shippedOrders / row.visits : 0;
    metrics.hasDashboardData = true;
  }

  return {
    rows: Array.from(periodRows.entries())
      .map(([platformProductId, periods]) => ({
        productName: productNames.get(platformProductId) ?? '',
        platformProductId,
        displayProductId: buildDisplayProductId(platformProductId, input.mapping),
        custodyDays: custodyDays.get(platformProductId) ?? null,
        periods,
      }))
      .sort((a, b) => b.periods['1d'].exposure - a.periods['1d'].exposure || b.periods['7d'].exposure - a.periods['7d'].exposure),
  };
}
