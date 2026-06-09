import XLSX from 'xlsx-js-style';
import type { DailyReportData, PeriodKey, ProductAnalysisRow, RawTableData } from '../domain/types.js';

const RAW_SHEET_NAMES: Record<PeriodKey, string> = {
  '1d': '1天原始数据',
  '7d': '7天原始数据',
  '30d': '30天原始数据',
};

function metricValue(row: ProductAnalysisRow, period: PeriodKey, key: 'visits' | 'createdOrders' | 'shippedOrders'): number {
  return row.metrics[period]?.[key] ?? 0;
}

function shippedRate(row: ProductAnalysisRow, period: PeriodKey): string {
  const metrics = row.metrics[period];

  if (!metrics || metrics.visits <= 0) {
    return '0.00%';
  }

  return `${((metrics.shippedOrders / metrics.visits) * 100).toFixed(2)}%`;
}

function applyHeaderStyle(worksheet: XLSX.WorkSheet, columnCount: number): void {
  for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
    const address = XLSX.utils.encode_cell({ r: 0, c: columnIndex });
    const cell = worksheet[address];
    if (!cell) continue;
    cell.s = {
      fill: { fgColor: { rgb: 'EAF2FF' } },
      font: { bold: true, color: { rgb: '1F2937' } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    };
  }
}

function actionFill(action: string): string {
  if (action === '疑似价格问题') return 'FCE4D6';
  if (action === '高曝光低转化') return 'F4CCCC';
  if (action === '建议补链') return 'D9EAD3';
  if (action === '建议加曝光') return 'DDEBF7';
  if (action === '疑似失活') return 'E6B8B7';
  if (action === '稳定优质') return 'C6E0B4';
  return 'E7E6E6';
}

function levelFill(level: string): string {
  if (level === '高') return 'F4CCCC';
  if (level === '中') return 'FFF2CC';
  return 'D9EAD3';
}

function applyAnalysisStyle(worksheet: XLSX.WorkSheet, rowCount: number): void {
  const columnCount = 21;
  worksheet['!cols'] = [30, 22, 18, 10, 11, 11, 11, 11, 11, 11, 12, 12, 12, 13, 10, 10, 10, 10, 16, 10, 56].map((wch) => ({ wch }));
  worksheet['!autofilter'] = { ref: `A1:U${rowCount}` };
  worksheet['!freeze'] = { xSplit: 0, ySplit: 1 } as never;
  applyHeaderStyle(worksheet, columnCount);

  for (let rowIndex = 1; rowIndex < rowCount; rowIndex += 1) {
    const action = String(worksheet[XLSX.utils.encode_cell({ r: rowIndex, c: 18 })]?.v ?? '');
    const riskLevel = String(worksheet[XLSX.utils.encode_cell({ r: rowIndex, c: 16 })]?.v ?? '');
    const opportunityLevel = String(worksheet[XLSX.utils.encode_cell({ r: rowIndex, c: 17 })]?.v ?? '');
    const rowFill = actionFill(action);

    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
      const cell = worksheet[address];
      if (!cell) continue;
      const isTextColumn = columnIndex === 0 || columnIndex === 20;
      cell.s = {
        ...(cell.s ?? {}),
        fill: { fgColor: { rgb: rowFill } },
        alignment: { horizontal: isTextColumn ? 'left' : 'center', vertical: 'center', wrapText: isTextColumn },
      };
    }

    const riskCell = worksheet[XLSX.utils.encode_cell({ r: rowIndex, c: 16 })];
    if (riskCell) riskCell.s = { ...(riskCell.s ?? {}), fill: { fgColor: { rgb: levelFill(riskLevel) } }, alignment: { horizontal: 'center', vertical: 'center' } };
    const opportunityCell = worksheet[XLSX.utils.encode_cell({ r: rowIndex, c: 17 })];
    if (opportunityCell) opportunityCell.s = { ...(opportunityCell.s ?? {}), fill: { fgColor: { rgb: levelFill(opportunityLevel) } }, alignment: { horizontal: 'center', vertical: 'center' } };
  }
}

function appendRawSheet(workbook: XLSX.WorkBook, table: RawTableData): void {
  const worksheet = XLSX.utils.aoa_to_sheet([table.headers, ...table.rows]);
  worksheet['!cols'] = table.headers.map((header) => ({ wch: header.includes('名称') ? 28 : 14 }));
  worksheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: table.rows.length, c: Math.max(table.headers.length - 1, 0) } }) };
  worksheet['!freeze'] = { xSplit: 0, ySplit: 1 } as never;
  applyHeaderStyle(worksheet, table.headers.length);
  XLSX.utils.book_append_sheet(workbook, worksheet, RAW_SHEET_NAMES[table.period]);
}

function buildAnalysisRows(rows: ProductAnalysisRow[]): Array<Array<string | number>> {
  return [
    ['商品名称', '管理平台商品ID', '平台商品ID', '映射状态', '1天访问', '1天创建', '1天发货', '7天访问', '7天创建', '7天发货', '30天访问', '30天创建', '30天发货', '30天发货率', '风险分', '机会分', '风险等级', '机会等级', '建议动作', '置信度', '判定原因'],
    ...rows.map((row) => [
      row.productName,
      row.internalProductId ?? '',
      row.platformProductId,
      row.mappingStatus === 'mapped' ? '已映射' : '未映射',
      metricValue(row, '1d', 'visits'),
      metricValue(row, '1d', 'createdOrders'),
      metricValue(row, '1d', 'shippedOrders'),
      metricValue(row, '7d', 'visits'),
      metricValue(row, '7d', 'createdOrders'),
      metricValue(row, '7d', 'shippedOrders'),
      metricValue(row, '30d', 'visits'),
      metricValue(row, '30d', 'createdOrders'),
      metricValue(row, '30d', 'shippedOrders'),
      shippedRate(row, '30d'),
      row.riskScore,
      row.opportunityScore,
      row.riskLevel,
      row.opportunityLevel,
      row.action,
      row.confidence,
      row.reason,
    ]),
  ];
}

export function buildWorkbook(data: DailyReportData): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();

  for (const table of data.rawTables) {
    appendRawSheet(workbook, table);
  }

  const analysisWorksheet = XLSX.utils.aoa_to_sheet(buildAnalysisRows(data.analysisRows));
  applyAnalysisStyle(analysisWorksheet, data.analysisRows.length + 1);
  XLSX.utils.book_append_sheet(workbook, analysisWorksheet, '商品综合分析');

  return workbook;
}

export function writeWorkbookBuffer(data: DailyReportData): Buffer {
  return Buffer.from(XLSX.write(buildWorkbook(data), { bookType: 'xlsx', type: 'array' }));
}
