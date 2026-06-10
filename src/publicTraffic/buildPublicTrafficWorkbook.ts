import XLSX from 'xlsx-js-style';
import type { PeriodKey } from '../domain/types.js';
import type {
  ExposureOverviewMetric,
  PublicTrafficDataReportContext,
  PublicTrafficDataSummary,
  PublicTrafficProductDataRow,
  PublicTrafficReportContext,
  PublicTrafficReportSectionItem,
} from './types.js';

function summaryFromOverview(overview: ExposureOverviewMetric[], period: ExposureOverviewMetric['period']): PublicTrafficDataSummary {
  const metric = overview.find((item) => item.period === period);
  return {
    exposure: metric?.exposure ?? 0,
    publicVisits: metric?.visits ?? 0,
    dashboardVisits: metric?.visits ?? 0,
    createdOrders: 0,
    shippedOrders: 0,
    amount: metric?.amount ?? 0,
    exposureVisitRate: metric ? metric.conversionRate / 100 : 0,
    visitCreatedOrderRate: 0,
    visitShipmentRate: 0,
  };
}

function toDataContext(context: PublicTrafficDataReportContext | PublicTrafficReportContext): PublicTrafficDataReportContext {
  if ('summary' in context) return context;
  return {
    date: context.date,
    summary: {
      '1d': summaryFromOverview(context.overview, '1d'),
      '7d': summaryFromOverview(context.overview, '7d'),
      '30d': summaryFromOverview(context.overview, '30d'),
    },
    rows: [],
    lowExposure: context.exposureOptimization,
    weakClick: [],
    weakConversion: context.conversionOptimization,
    highPotential: [],
    newProductObservation: context.newProductObservation,
    lifecycleGovernance: context.lifecycleGovernance,
  };
}

function sectionSheet(items: PublicTrafficReportSectionItem[]): XLSX.WorkSheet {
  const aoa: (string | number)[][] = [['identifier', 'action', 'reason']];
  for (const item of items) {
    aoa.push([item.identifier, item.action, item.reason]);
  }
  return XLSX.utils.aoa_to_sheet(aoa);
}

function detailSheet(rows: PublicTrafficProductDataRow[]): XLSX.WorkSheet {
  const aoa: (string | number | null)[][] = [
    [
      'platformProductId',
      'displayProductId',
      'productName',
      'custodyDays',
      '1d_exposure',
      '1d_publicVisits',
      '1d_dashboardVisits',
      '1d_shippedOrders',
      '7d_exposure',
      '30d_exposure',
    ],
  ];
  for (const row of rows) {
    aoa.push([
      row.platformProductId,
      row.displayProductId,
      row.productName,
      row.custodyDays,
      row.periods['1d'].exposure,
      row.periods['1d'].publicVisits,
      row.periods['1d'].dashboardVisits,
      row.periods['1d'].shippedOrders,
      row.periods['7d'].exposure,
      row.periods['30d'].exposure,
    ]);
  }
  return XLSX.utils.aoa_to_sheet(aoa);
}

export function writePublicTrafficWorkbookBuffer(input: PublicTrafficDataReportContext | PublicTrafficReportContext): Buffer {
  const context = toDataContext(input);
  const workbook = XLSX.utils.book_new();

  const overviewAoa: (string | number)[][] = [['period', 'exposure', 'publicVisits', 'dashboardVisits', 'createdOrders', 'shippedOrders', 'amount', 'exposureVisitRate', 'visitCreatedOrderRate', 'visitShipmentRate']];
  for (const period of ['1d', '7d', '30d'] as PeriodKey[]) {
    const summary = context.summary[period];
    overviewAoa.push([period, summary.exposure, summary.publicVisits, summary.dashboardVisits, summary.createdOrders, summary.shippedOrders, summary.amount, summary.exposureVisitRate, summary.visitCreatedOrderRate, summary.visitShipmentRate]);
  }
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(overviewAoa), '总览');
  XLSX.utils.book_append_sheet(workbook, detailSheet(context.rows), '商品明细');
  XLSX.utils.book_append_sheet(workbook, sectionSheet(context.lowExposure), '曝光不足');
  XLSX.utils.book_append_sheet(workbook, sectionSheet(context.weakClick), '点击弱');
  XLSX.utils.book_append_sheet(workbook, sectionSheet(context.weakConversion), '转化弱');
  XLSX.utils.book_append_sheet(workbook, sectionSheet(context.highPotential), '高潜力');
  XLSX.utils.book_append_sheet(workbook, sectionSheet(context.newProductObservation), '新品观察');
  XLSX.utils.book_append_sheet(workbook, sectionSheet(context.lifecycleGovernance), '生命周期治理');

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
