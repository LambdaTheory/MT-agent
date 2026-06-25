import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PublicTrafficDataReportContext, PublicTrafficProductDataRow } from '../publicTraffic/types.js';

export async function findLatestReportContext(outputDir = 'output'): Promise<{ path: string; context: PublicTrafficDataReportContext } | null> {
  const entries = await readdir(outputDir, { withFileTypes: true }).catch(() => []);
  const dates = entries
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();

  for (const date of dates) {
    for (const fileName of [`公域数据上下文_${date}.json`, 'report-context.json']) {
      const path = join(outputDir, date, fileName);
      try {
        return { path, context: JSON.parse(await readFile(path, 'utf8')) as PublicTrafficDataReportContext };
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue;
        throw error;
      }
    }
  }

  return null;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function normalizeProductIdentifier(value: string): string {
  return value.trim().toLowerCase();
}

function extractInternalProductId(displayProductId: string): string | null {
  return /^端内id\s*(\d+)$/i.exec(displayProductId.trim())?.[1] ?? null;
}

function matchesExactNumericProductId(row: PublicTrafficProductDataRow, normalizedKeyword: string): boolean {
  return (
    extractInternalProductId(row.displayProductId) === normalizedKeyword ||
    normalizeProductIdentifier(row.displayProductId) === normalizedKeyword ||
    normalizeProductIdentifier(row.platformProductId) === normalizedKeyword
  );
}

export function parseNumericProductIdList(keyword: string): string[] {
  const tokens = keyword
    .trim()
    .replace(/[;；。]+$/g, '')
    .split(/[,\uFF0C\u3001\s;；]+/)
    .filter(Boolean);
  if (tokens.length < 2 || tokens.some((token) => !/^\d+$/.test(token))) return [];
  return tokens;
}

export function formatLatestSummary(context: PublicTrafficDataReportContext): string {
  const one = context.summary['1d'];
  return [
    `公域日报 ${context.date}`,
    `曝光 ${one.exposure}，公域访问 ${one.publicVisits}，后链路访问 ${one.dashboardVisits}`,
    `创建订单 ${one.createdOrders}，发货 ${one.shippedOrders}，金额 ¥${one.amount.toFixed(2)}`,
    `曝光到访问率 ${percent(one.exposureVisitRate)}，访问到发货率 ${percent(one.visitShipmentRate)}`,
    `建议操作 ${context.recommendedActions.length} 条`,
  ].join('\n');
}

export function queryProductRows(context: PublicTrafficDataReportContext, keyword: string): PublicTrafficProductDataRow[] {
  const normalized = normalizeProductIdentifier(keyword);
  if (!normalized) return [];
  const productIds = parseNumericProductIdList(normalized);
  if (productIds.length > 0) {
    return productIds.flatMap((productId) => context.rows.find((row) => matchesExactNumericProductId(row, productId)) ?? []);
  }
  if (/^\d+$/.test(normalized)) {
    return context.rows.filter((row) => matchesExactNumericProductId(row, normalized)).slice(0, 5);
  }

  return context.rows
    .filter(
      (row) =>
        row.productName.toLowerCase().includes(normalized) ||
        row.platformProductId.toLowerCase().includes(normalized) ||
        row.displayProductId.toLowerCase().includes(normalized),
    )
    .slice(0, 5);
}

export function formatProductRows(rows: PublicTrafficProductDataRow[]): string {
  if (rows.length === 0) return '没有找到匹配商品。';
  return rows
    .map((row) => {
      const one = row.periods['1d'];
      const seven = row.periods['7d'];
      return `${row.displayProductId} ${row.productName}\n1日：曝光 ${one.exposure}，访问 ${one.publicVisits || one.dashboardVisits}，发货 ${one.shippedOrders}\n7日：曝光 ${seven.exposure}，访问 ${seven.publicVisits || seven.dashboardVisits}，发货 ${seven.shippedOrders}`;
    })
    .join('\n\n');
}
