import XLSX from 'xlsx-js-style';
import type { ProductIdMapping } from './productIdMapping.js';

export interface GoodsExportSkippedRow {
  rowNumber: number;
  platformProductId: string;
  merchantCode: string;
  reason: string;
}

export interface GoodsExportMappingResult {
  mapping: ProductIdMapping;
  skippedRows: GoodsExportSkippedRow[];
}

function normalize(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function internalIdFromMerchantCode(code: string): string | null {
  const parts = code.split('-').map((part) => part.trim()).filter(Boolean);
  return parts.length >= 3 ? parts[1] ?? null : null;
}

function findColumn(headers: string[], name: string): number {
  const index = headers.findIndex((header) => normalize(header) === name);
  if (index < 0) {
    throw new Error(`Goods export is missing required column: ${name}`);
  }

  return index;
}

export function parseGoodsExportMapping(path: string): GoodsExportMappingResult {
  const workbook = XLSX.readFile(path);
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error('Goods export workbook has no sheets');
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: '' });
  const headers = (rows[0] ?? []).map(normalize);
  const merchantCodeIndex = findColumn(headers, '商家侧编码');
  const platformProductIdIndex = findColumn(headers, '平台侧编码');
  const mapping: ProductIdMapping = {};
  const skippedRows: GoodsExportSkippedRow[] = [];

  for (const [zeroBasedIndex, row] of rows.slice(1).entries()) {
    const rowNumber = zeroBasedIndex + 2;
    const merchantCode = normalize(row[merchantCodeIndex]);
    const platformProductId = normalize(row[platformProductIdIndex]);

    if (!platformProductId && !merchantCode) {
      continue;
    }

    const internalProductId = internalIdFromMerchantCode(merchantCode);
    if (!platformProductId || !internalProductId) {
      skippedRows.push({ rowNumber, platformProductId, merchantCode, reason: 'invalid merchant code' });
      continue;
    }

    mapping[platformProductId] = internalProductId;
  }

  return { mapping, skippedRows };
}
