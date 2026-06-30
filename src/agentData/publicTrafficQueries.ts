import type { PeriodKey } from '../domain/types.js';
import type { PublicTrafficDataReportContext, PublicTrafficReportSectionItem } from '../publicTraffic/types.js';
import type {
  AgentNewProductPoolItem,
  AgentOverviewAnswer,
  AgentOverviewMetric,
  AgentInactiveLinkItem,
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

function normalizeProductIdentifier(value: string): string {
  return value.trim().toLowerCase();
}

function extractInternalProductId(displayProductId: string): string | null {
  return /^端内id\s*(\d+)$/i.exec(displayProductId.trim())?.[1] ?? null;
}

function normalizeSectionProductId(identifier: string): string {
  return extractInternalProductId(identifier) ?? identifier.trim();
}

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
  const normalizedKeyword = normalizeProductIdentifier(keyword);
  if (!normalizedKeyword) {
    return null;
  }

  const isNumericKeyword = /^\d+$/.test(normalizedKeyword);
  if (isNumericKeyword) {
    const numericRow = context.rows.find((item) => (
      extractInternalProductId(item.displayProductId) === normalizedKeyword ||
      normalizeProductIdentifier(item.displayProductId) === normalizedKeyword ||
      normalizeProductIdentifier(item.platformProductId) === normalizedKeyword
    ));
    return numericRow ? formatProductAnswerRow(numericRow) : null;
  }

  const row = context.rows.find((item) => {
    return (
      normalizeProductIdentifier(item.displayProductId) === normalizedKeyword ||
      normalizeProductIdentifier(item.platformProductId) === normalizedKeyword ||
      item.productName.toLowerCase().includes(normalizedKeyword)
    );
  });

  return row ? formatProductAnswerRow(row) : null;
}

function formatProductAnswerRow(row: PublicTrafficDataReportContext['rows'][number]): AgentProductAnswer {
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

export function getInactiveLinks(context: PublicTrafficDataReportContext): AgentInactiveLinkItem[] {
  return context.lifecycleGovernance.map((item) => ({
    productId: normalizeSectionProductId(item.identifier),
    identifier: item.identifier,
    action: item.action,
    reason: item.reason,
    ...(item.priority ? { priority: item.priority } : {}),
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
