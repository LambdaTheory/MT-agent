import type { PeriodKey } from '../domain/types.js';
import type { PublicTrafficDataReportContext, PublicTrafficReportSectionItem } from '../publicTraffic/types.js';
import type {
  AgentNewProductPoolItem,
  AgentOverviewAnswer,
  AgentOverviewMetric,
  AgentProblemProduct,
  AgentProblemType,
  AgentProductAnswer,
  AgentProductPeriodMetric,
  AgentRemovedLinkItem,
} from './types.js';

type PublicTrafficContextWithNewProductPool = PublicTrafficDataReportContext & {
  newProductPoolItems?: Array<{
    productId: string;
    productName: string;
    maintenanceStatus?: string;
  } & Record<string, unknown>>;
  newProductPoolIds?: string[];
};

const PERIODS: PeriodKey[] = ['1d', '7d', '30d'];

export function getLatestOverview(context: PublicTrafficDataReportContext): AgentOverviewAnswer {
  return {
    date: context.date,
    metrics: PERIODS.map((period): AgentOverviewMetric => {
      const metric = context.summary[period];

      return {
        period,
        exposure: metric.exposure,
        publicVisits: metric.publicVisits,
        createdOrders: metric.createdOrders,
        shippedOrders: metric.shippedOrders,
        amount: metric.amount,
        exposureVisitRate: metric.exposureVisitRate,
        visitShipmentRate: metric.visitShipmentRate,
      };
    }),
    dataQualityNotes: context.dataQualityNotes ?? [],
  };
}

export function getProductPerformance(context: PublicTrafficDataReportContext, keyword: string): AgentProductAnswer | null {
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (!normalizedKeyword) {
    return null;
  }

  const row = context.rows.find((item) => {
    return (
      item.displayProductId.toLowerCase() === normalizedKeyword ||
      item.platformProductId.toLowerCase() === normalizedKeyword ||
      item.productName.toLowerCase().includes(normalizedKeyword)
    );
  });

  if (!row) {
    return null;
  }

  return {
    productId: row.displayProductId,
    productName: row.productName,
    platformProductId: row.platformProductId,
    custodyDays: row.custodyDays,
    periods: PERIODS.map((period): AgentProductPeriodMetric => {
      const metric = row.periods[period];

      return {
        period,
        exposure: metric.exposure,
        publicVisits: metric.publicVisits,
        createdOrders: metric.createdOrders,
        shippedOrders: metric.shippedOrders,
        amount: metric.amount,
        exposureVisitRate: metric.exposureVisitRate,
        visitShipmentRate: metric.visitShipmentRate,
      };
    }),
  };
}

export function getProblemProducts(
  context: PublicTrafficDataReportContext,
  type: AgentProblemType,
): AgentProblemProduct[] {
  if (type === 'new_product_pool') {
    return getNewProductPool(context).map((item) => ({
      type,
      productId: item.productId,
      action: item.maintenanceStatus,
      reason: item.productName,
    }));
  }

  return getProblemSource(context, type).map((item) => ({
    type,
    productId: item.identifier,
    action: item.action,
    reason: item.reason,
  }));
}

export function getNewProductPool(context: PublicTrafficDataReportContext): AgentNewProductPoolItem[] {
  const extended = context as PublicTrafficContextWithNewProductPool;
  if (extended.newProductPoolItems?.length) {
    return extended.newProductPoolItems.map((item) => ({
      productId: item.productId,
      productName: item.productName,
      maintenanceStatus: item.maintenanceStatus ?? '待维护',
    }));
  }

  return (extended.newProductPoolIds ?? []).map((productId) => ({
    productId,
    productName: '',
    maintenanceStatus: '待维护',
  }));
}

export function getRemovedLinks(context: PublicTrafficDataReportContext): AgentRemovedLinkItem[] {
  return (context.agentData?.removedLinks ?? []).map((item) => ({
    productId: item.productId,
    platformProductId: item.platformProductId,
    productName: item.productName,
    removedDate: item.removedDate,
    reason: item.reason,
    source: item.source,
  }));
}

function getProblemSource(
  context: PublicTrafficDataReportContext,
  type: Exclude<AgentProblemType, 'new_product_pool'>,
): PublicTrafficReportSectionItem[] {
  switch (type) {
    case 'low_exposure':
      return context.lowExposure;
    case 'weak_conversion':
      return context.weakConversion;
    case 'high_potential':
      return context.highPotential;
    case 'recommended_action':
      return context.recommendedActions;
  }
}
