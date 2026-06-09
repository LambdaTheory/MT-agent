import type { ExposureCumulativeProduct } from './types.js';

function normalize(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function findColumn(headers: string[], candidates: string[], excludedFallbacks: string[] = []): number {
  const normalized = headers.map(normalize);
  for (const candidate of candidates) {
    const exactIndex = normalized.findIndex(
      (header) => header === candidate && !excludedFallbacks.some((excluded) => header.includes(excluded)),
    );
    if (exactIndex >= 0) {
      return exactIndex;
    }
  }

  const index = candidates
    .map((candidate) =>
      normalized.findIndex(
        (header) => header.includes(candidate) && !excludedFallbacks.some((excluded) => header.includes(excluded)),
      ),
    )
    .find((candidateIndex) => candidateIndex >= 0) ?? -1;
  if (index < 0) {
    throw new Error(`Missing exposure column: ${candidates.join('/')}. Actual headers: ${headers.join(', ')}`);
  }
  return index;
}

export function parseNumberText(value: unknown): number {
  const cleaned = normalize(value).replace(/[,%，]/g, '').replace(/天$/, '');
  const multiplier = cleaned.includes('亿') ? 100000000 : cleaned.includes('万') ? 10000 : 1;
  const parsed = Number.parseFloat(cleaned.replace(/[万亿]/g, ''));
  return Number.isFinite(parsed) ? parsed * multiplier : 0;
}

export function parseMoney(value: unknown): number {
  return parseNumberText(normalize(value).replace(/[¥￥]/g, ''));
}

export function normalizeExposureProductRows(headers: string[], rows: string[][]): ExposureCumulativeProduct[] {
  const nameIndex = findColumn(headers, ['商品名称', '商品标题', '名称', '标题']);
  const idIndex = findColumn(headers, ['商品ID', '平台商品ID', '平台侧编码']);
  const exposureIndex = findColumn(headers, ['曝光']);
  const visitsIndex = findColumn(headers, ['访问']);
  const amountIndex = findColumn(headers, ['交易金额', '成交金额', '支付金额', 'GMV', '收入', '金额'], [
    '退款',
    '退货',
    'refund',
  ]);
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
