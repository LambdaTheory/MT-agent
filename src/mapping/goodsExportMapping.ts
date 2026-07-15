import XLSX from 'xlsx-js-style';
import { parseListingStateFromText } from '../linkRegistry/listingState.js';
import type { GoodsSnapshotItem, PlatformRestrictionObservation } from '../publicTraffic/types.js';
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

export interface GoodsExportWorkbookResult extends GoodsExportMappingResult {
  snapshot: GoodsSnapshotItem[];
}

function normalize(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function internalIdFromMerchantCode(code: string): string | null {
  const parts = code.split('-').map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 3 && /^\d+$/.test(parts[1] ?? '')) return parts[1] ?? null;
  if (parts.length > 0 && /^\d+$/.test(parts[0] ?? '')) return parts[0] ?? null;
  return null;
}

function findColumn(headers: string[], name: string): number {
  const index = headers.findIndex((header) => normalize(header) === name);
  if (index < 0) {
    throw new Error(`Goods export is missing required column: ${name}`);
  }

  return index;
}

function findOptionalColumn(headers: string[], names: string[]): number | null {
  const index = headers.findIndex((header) => names.includes(normalize(header)));
  return index >= 0 ? index : null;
}

function goodsSnapshotItem(input: {
  platformProductId: string;
  internalProductId: string;
  productName: string;
  listingStatusText?: string;
  platformRestriction?: PlatformRestrictionObservation;
}): GoodsSnapshotItem {
  const listingStatusText = input.listingStatusText?.trim();
  return {
    platformProductId: input.platformProductId,
    internalProductId: input.internalProductId,
    productName: input.productName,
    ...(listingStatusText ? { listingState: parseListingStateFromText(listingStatusText), listingStatusText } : {}),
    ...(input.platformRestriction ? { platformRestriction: input.platformRestriction } : {}),
  };
}

function parseWorkbookRows(path: string): { rows: unknown[][]; headers: string[] } {
  const workbook = XLSX.readFile(path);
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error('Goods export workbook has no sheets');
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: '' });
  const headers = (rows[0] ?? []).map(normalize);
  return { rows, headers };
}

export function parseGoodsExportWorkbook(path: string): GoodsExportWorkbookResult {
  const { rows, headers } = parseWorkbookRows(path);
  const productNameIndex = findColumn(headers, '商品名称');
  const merchantCodeIndex = findColumn(headers, '商家侧编码');
  const platformProductIdIndex = findColumn(headers, '平台侧编码');
  const listingStatusIndex = findOptionalColumn(headers, ['商品状态', '上架状态']);
  const reviewRejectionReasonIndex = findOptionalColumn(headers, ['审核不通过原因']);
  const freezeReasonIndex = findOptionalColumn(headers, ['冻结原因']);
  const mapping: ProductIdMapping = {};
  const skippedRows: GoodsExportSkippedRow[] = [];
  const snapshotByInternalId = new Map<string, GoodsSnapshotItem>();

  for (const [zeroBasedIndex, row] of rows.slice(1).entries()) {
    const rowNumber = zeroBasedIndex + 2;
    const productName = normalize(row[productNameIndex]);
    const merchantCode = normalize(row[merchantCodeIndex]);
    const platformProductId = normalize(row[platformProductIdIndex]);
    const listingStatusText = listingStatusIndex === null ? undefined : normalize(row[listingStatusIndex]);
    const reviewRejectionReason = reviewRejectionReasonIndex === null ? '' : normalize(row[reviewRejectionReasonIndex]);
    const freezeReason = freezeReasonIndex === null ? '' : normalize(row[freezeReasonIndex]);
    const platformRestriction: PlatformRestrictionObservation | undefined = freezeReason
      ? { kind: 'frozen', reasonText: freezeReason }
      : reviewRejectionReason
        ? { kind: 'review_rejected', reasonText: reviewRejectionReason }
        : undefined;

    if (!productName && !platformProductId && !merchantCode) {
      continue;
    }

    const internalProductId = internalIdFromMerchantCode(merchantCode);
    if (!platformProductId || !internalProductId) {
      skippedRows.push({ rowNumber, platformProductId, merchantCode, reason: 'invalid merchant code' });
      continue;
    }

    mapping[platformProductId] = internalProductId;
    if (!snapshotByInternalId.has(internalProductId)) {
      snapshotByInternalId.set(internalProductId, goodsSnapshotItem({
        platformProductId,
        internalProductId,
        productName,
        listingStatusText,
        platformRestriction,
      }));
      continue;
    }

    const current = snapshotByInternalId.get(internalProductId)!;
    snapshotByInternalId.set(internalProductId, goodsSnapshotItem({
      platformProductId: current.platformProductId || platformProductId,
      internalProductId,
      productName: current.productName || productName,
      listingStatusText: current.listingStatusText || listingStatusText,
      platformRestriction: current.platformRestriction ?? platformRestriction,
    }));
  }

  const snapshot = [...snapshotByInternalId.values()]
    .sort((left, right) => Number(left.internalProductId) - Number(right.internalProductId) || left.internalProductId.localeCompare(right.internalProductId));
  return { mapping, skippedRows, snapshot };
}

export function parseGoodsExportMapping(path: string): GoodsExportMappingResult {
  const { mapping, skippedRows } = parseGoodsExportWorkbook(path);
  return { mapping, skippedRows };
}

export function parseGoodsExportSnapshot(path: string): GoodsSnapshotItem[] {
  return parseGoodsExportWorkbook(path).snapshot;
}
