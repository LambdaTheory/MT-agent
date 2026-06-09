import type { ExposureCumulativeProduct } from './types.js';

function normalize(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function findColumn(headers: string[], candidates: string[]): number {
  const normalized = headers.map(normalize);
  const index = normalized.findIndex((header) => candidates.some((candidate) => header.includes(candidate)));
  if (index < 0) {
    throw new Error(`Missing exposure column: ${candidates.join('/')}. Actual headers: ${headers.join(', ')}`);
  }
  return index;
}

export function parseNumberText(value: unknown): number {
  const cleaned = normalize(value).replace(/[,%，]/g, '').replace(/天$/, '');
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseMoney(value: unknown): number {
  return parseNumberText(normalize(value).replace(/[¥￥]/g, ''));
}

export function normalizeExposureProductRows(headers: string[], rows: string[][]): ExposureCumulativeProduct[] {
  const nameIndex = findColumn(headers, ['商品名称', '商品']);
  const idIndex = findColumn(headers, ['商品ID', '平台商品ID', '平台侧编码']);
  const exposureIndex = findColumn(headers, ['曝光']);
  const visitsIndex = findColumn(headers, ['访问']);
  const amountIndex = findColumn(headers, ['金额', '收入', '交易']);
  const custodyIndex = headers.findIndex((header) => normalize(header).includes('托管'));

  return rows
    .map((row) => {
      const raw: Record<string, string> = {};
      headers.forEach((header, index) => {
        raw[normalize(header)] = normalize(row[index]);
      });

      return {
        productName: normalize(row[nameIndex]),
        platformProductId: normalize(row[idIndex]),
        exposure: parseNumberText(row[exposureIndex]),
        visits: parseNumberText(row[visitsIndex]),
        amount: parseMoney(row[amountIndex]),
        custodyDays: custodyIndex >= 0 ? parseNumberText(row[custodyIndex]) : null,
        raw,
      };
    })
    .filter((row) => row.platformProductId);
}
