import type { PeriodKey } from '../domain/types.js';
import type {
  PublicTrafficDataContext,
  PublicTrafficDataReportContext,
  PublicTrafficDataSummary,
  PublicTrafficProductDataRow,
  PublicTrafficReportSectionItem,
} from './types.js';

const PERIODS: PeriodKey[] = ['1d', '7d', '30d'];
const TOP_N = 5;

function emptySummary(): PublicTrafficDataSummary {
  return {
    exposure: 0,
    publicVisits: 0,
    dashboardVisits: 0,
    createdOrders: 0,
    shippedOrders: 0,
    amount: 0,
    exposureVisitRate: 0,
    visitCreatedOrderRate: 0,
    visitShipmentRate: 0,
  };
}

function summarize(rows: PublicTrafficProductDataRow[], period: PeriodKey): PublicTrafficDataSummary {
  const summary = rows.reduce((acc, row) => {
    const metrics = row.periods[period];
    acc.exposure += metrics.exposure;
    acc.publicVisits += metrics.publicVisits;
    acc.dashboardVisits += metrics.dashboardVisits;
    acc.createdOrders += metrics.createdOrders;
    acc.shippedOrders += metrics.shippedOrders;
    acc.amount += metrics.amount;
    return acc;
  }, emptySummary());
  summary.exposureVisitRate = summary.exposure > 0 ? summary.publicVisits / summary.exposure : 0;
  summary.visitCreatedOrderRate = summary.dashboardVisits > 0 ? summary.createdOrders / summary.dashboardVisits : 0;
  summary.visitShipmentRate = summary.dashboardVisits > 0 ? summary.shippedOrders / summary.dashboardVisits : 0;
  return summary;
}

function item(row: PublicTrafficProductDataRow, action: string, reason: string): PublicTrafficReportSectionItem {
  return { identifier: row.displayProductId, action, reason };
}

export function analyzePublicTrafficData(input: PublicTrafficDataContext & { date: string }): PublicTrafficDataReportContext {
  const rows = input.rows;
  const one = (row: PublicTrafficProductDataRow) => row.periods['1d'];
  const summary = Object.fromEntries(PERIODS.map((period) => [period, summarize(rows, period)])) as Record<
    PeriodKey,
    PublicTrafficDataSummary
  >;

  const lowExposure = rows
    .filter(
      (row) =>
        one(row).hasExposureData &&
        one(row).hasDashboardData &&
        one(row).exposure <= 50 &&
        one(row).dashboardVisits <= 5 &&
        one(row).shippedOrders === 0,
    )
    .sort((a, b) => one(a).exposure - one(b).exposure)
    .slice(0, TOP_N)
    .map((row) =>
      item(row, '曝光不足', `1日曝光 ${one(row).exposure}，后链路访问 ${one(row).dashboardVisits}，发货 ${one(row).shippedOrders}`),
    );

  const weakClick = rows
    .filter((row) => one(row).hasExposureData && one(row).exposure >= 1000 && one(row).exposureVisitRate < 0.01)
    .sort((a, b) => one(a).exposureVisitRate - one(b).exposureVisitRate || one(b).exposure - one(a).exposure)
    .slice(0, TOP_N)
    .map((row) => item(row, '曝光有但点击弱', `1日曝光 ${one(row).exposure}，公域访问率 ${(one(row).exposureVisitRate * 100).toFixed(2)}%`));

  const weakConversion = rows
    .filter((row) => one(row).hasDashboardData && one(row).dashboardVisits >= 50 && one(row).shippedOrders === 0)
    .sort((a, b) => one(b).dashboardVisits - one(a).dashboardVisits)
    .slice(0, TOP_N)
    .map((row) => item(row, '点击有但转化弱', `1日后链路访问 ${one(row).dashboardVisits}，发货 ${one(row).shippedOrders}`));

  const highPotential = rows
    .filter(
      (row) =>
        one(row).hasExposureData &&
        one(row).hasDashboardData &&
        one(row).exposure >= 1000 &&
        one(row).publicVisits >= 100 &&
        one(row).shippedOrders > 0,
    )
    .sort((a, b) => one(b).shippedOrders - one(a).shippedOrders || one(b).publicVisits - one(a).publicVisits)
    .slice(0, TOP_N)
    .map((row) => item(row, '高潜力商品', `1日曝光 ${one(row).exposure}，公域访问 ${one(row).publicVisits}，发货 ${one(row).shippedOrders}`));

  return {
    date: input.date,
    summary,
    rows,
    lowExposure,
    weakClick,
    weakConversion,
    highPotential,
    newProductObservation: [],
    lifecycleGovernance: [],
  };
}
