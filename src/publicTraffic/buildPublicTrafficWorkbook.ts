import XLSX from 'xlsx-js-style';
import type { PublicTrafficReportContext, PublicTrafficReportSectionItem } from './types.js';

function sectionSheet(items: PublicTrafficReportSectionItem[]): XLSX.WorkSheet {
  const aoa: (string | number)[][] = [['identifier', 'action', 'reason']];
  for (const item of items) {
    aoa.push([item.identifier, item.action, item.reason]);
  }
  return XLSX.utils.aoa_to_sheet(aoa);
}

export function writePublicTrafficWorkbookBuffer(context: PublicTrafficReportContext): Buffer {
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
