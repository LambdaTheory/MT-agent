import XLSX from 'xlsx-js-style';
import type { PeriodKey } from '../domain/types.js';
import type { PublicTrafficDataReportContext, PublicTrafficProductDataRow, PublicTrafficReportContext, PublicTrafficReportSectionItem } from './types.js';

function sectionSheet(items: PublicTrafficReportSectionItem[]): XLSX.WorkSheet {
  const aoa: (string | number)[][] = [['identifier', 'action', 'reason']];
  for (const item of items) {
    aoa.push([item.identifier, item.action, item.reason]);
  }
  return XLSX.utils.aoa_to_sheet(aoa);
}

function detailSheet(rows: PublicTrafficProductDataRow[]): XLSX.WorkSheet {
  const periods: PeriodKey[] = ['1d', '7d', '30d'];
  const aoa: (string | number | null)[][] = [
    [
      'platformProductId',
      'displayProductId',
      'productName',
      'custodyDays',
      ...periods.flatMap((period) => [
        `${period}_exposure`,
        `${period}_publicVisits`,
        `${period}_dashboardVisits`,
        `${period}_createdOrders`,
        `${period}_shippedOrders`,
        `${period}_amount`,
        `${period}_exposureVisitRate`,
        `${period}_visitCreatedOrderRate`,
        `${period}_visitShipmentRate`,
      ]),
    ],
  ];
  for (const row of rows) {
    aoa.push([
      row.platformProductId,
      row.displayProductId,
      row.productName,
      row.custodyDays,
      ...periods.flatMap((period) => {
        const metric = row.periods[period];
        return [
          metric.exposure,
          metric.publicVisits,
          metric.dashboardVisits,
          metric.createdOrders,
          metric.shippedOrders,
          metric.amount,
          metric.exposureVisitRate,
          metric.visitCreatedOrderRate,
          metric.visitShipmentRate,
        ];
      }),
    ]);
  }
  return XLSX.utils.aoa_to_sheet(aoa);
}

function writeLegacyWorkbookBuffer(context: PublicTrafficReportContext): Buffer {
  const workbook = XLSX.utils.book_new();
  const overviewAoa: (string | number)[][] = [['period', 'exposure', 'visits', 'conversionRate', 'amount']];
  for (const row of context.overview) {
    overviewAoa.push([row.period, row.exposure, row.visits, row.conversionRate, row.amount]);
  }
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(overviewAoa), '总览');
  XLSX.utils.book_append_sheet(workbook, sectionSheet(context.exposureOptimization), '曝光优化');
  XLSX.utils.book_append_sheet(workbook, sectionSheet(context.conversionOptimization), '转化优化');
  XLSX.utils.book_append_sheet(workbook, sectionSheet(context.newProductObservation), '新品观察');
  XLSX.utils.book_append_sheet(workbook, sectionSheet(context.lifecycleGovernance), '生命周期治理');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function writePublicTrafficWorkbookBuffer(context: PublicTrafficDataReportContext | PublicTrafficReportContext): Buffer {
  if (!('summary' in context)) return writeLegacyWorkbookBuffer(context);

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
