import type { PeriodProductMetrics, RawTableData } from '../domain/types.js';

interface HeaderIndexes {
  productName: number;
  platformProductId: number;
  spuName: number;
  spuId: number;
  visits: number;
  createdOrders: number;
  signedOrders: number;
  reviewedOrders: number;
  shippedOrders: number;
}

const OPTIONAL_HEADERS = new Set<keyof HeaderIndexes>(['spuName', 'spuId']);

function findHeaderIndex(headers: string[], matchers: string[]): number {
  return headers.findIndex((header) => matchers.some((matcher) => header.includes(matcher)));
}

function parseCount(value: string | undefined): number {
  const numeric = Number((value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(numeric) ? numeric : 0;
}

function findHeaderIndexes(headers: string[]): HeaderIndexes {
  return {
    productName: findHeaderIndex(headers, ['商品名称', '商品信息', '商品', '标题']),
    platformProductId: findHeaderIndex(headers, ['商品ID']),
    spuName: findHeaderIndex(headers, ['SPU名称', 'SPU信息']),
    spuId: findHeaderIndex(headers, ['SPUID']),
    visits: findHeaderIndex(headers, ['频道访问次数', '访问次数', '访问']),
    createdOrders: findHeaderIndex(headers, ['创建订单数']),
    signedOrders: findHeaderIndex(headers, ['签约订单数']),
    reviewedOrders: findHeaderIndex(headers, ['审出订单数']),
    shippedOrders: findHeaderIndex(headers, ['发货订单数']),
  };
}

export function normalizeRowsForPeriod(table: RawTableData): PeriodProductMetrics[] {
  const indexes = findHeaderIndexes(table.headers);
  const missing = Object.entries(indexes)
    .filter(([key, value]) => !OPTIONAL_HEADERS.has(key as keyof HeaderIndexes) && value < 0)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`Missing required headers for ${table.period}: ${missing.join(', ')}. Actual headers: ${table.headers.join(', ')}`);
  }

  return table.rows.map((row) => ({
    period: table.period,
    productName: row[indexes.productName] ?? '',
    platformProductId: row[indexes.platformProductId] ?? '',
    spuName: indexes.spuName >= 0 ? row[indexes.spuName] : undefined,
    spuId: indexes.spuId >= 0 ? row[indexes.spuId] : undefined,
    visits: parseCount(row[indexes.visits]),
    createdOrders: parseCount(row[indexes.createdOrders]),
    signedOrders: parseCount(row[indexes.signedOrders]),
    reviewedOrders: parseCount(row[indexes.reviewedOrders]),
    shippedOrders: parseCount(row[indexes.shippedOrders]),
  }));
}
