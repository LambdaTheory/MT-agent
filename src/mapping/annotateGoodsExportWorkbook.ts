import XLSX from 'xlsx-js-style';
import { internalIdFromMerchantCode } from './goodsExportMapping.js';

function normalize(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function annotateGoodsExportWorkbookWithInternalId(path: string): number {
  const workbook = XLSX.readFile(path);
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error('Goods export workbook has no sheets');
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: '' });
  const headers = (rows[0] ?? []).map(normalize);
  if (headers.includes('端内ID')) {
    return 0;
  }
  const merchantCodeIndex = headers.findIndex((header) => header === '商家侧编码');
  if (merchantCodeIndex < 0) {
    throw new Error('Goods export is missing required column: 商家侧编码');
  }

  const insertAt = merchantCodeIndex + 1;
  let annotated = 0;
  const nextRows = rows.map((row, rowIndex) => {
    const cells = [...row];
    if (rowIndex === 0) {
      cells.splice(insertAt, 0, '端内ID');
      return cells;
    }
    const internalId = internalIdFromMerchantCode(normalize(row[merchantCodeIndex])) ?? '';
    if (internalId) annotated += 1;
    cells.splice(insertAt, 0, internalId);
    return cells;
  });

  workbook.Sheets[sheetName] = XLSX.utils.aoa_to_sheet(nextRows);
  XLSX.writeFile(workbook, path);
  return annotated;
}
