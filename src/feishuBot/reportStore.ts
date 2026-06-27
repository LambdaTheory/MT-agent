import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findOrderAnalysisIndicator } from '../publicTraffic/orderAnalysis.js';
import type { PublicTrafficDataReportContext, PublicTrafficProductDataRow } from '../publicTraffic/types.js';

const reportDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function reportContextFileNames(date: string): string[] {
  return [`公域数据上下文_${date}.json`, 'report-context.json'];
}

async function readReportContextFromDateDir(outputDir: string, date: string): Promise<{ path: string; context: PublicTrafficDataReportContext } | null> {
  for (const fileName of reportContextFileNames(date)) {
    const path = join(outputDir, date, fileName);
    try {
      return { path, context: JSON.parse(await readFile(path, 'utf8')) as PublicTrafficDataReportContext };
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue;
      throw error;
    }
  }
  return null;
}

export async function findLatestReportContext(outputDir = 'output'): Promise<{ path: string; context: PublicTrafficDataReportContext } | null> {
  const entries = await readdir(outputDir, { withFileTypes: true }).catch(() => []);
  const dates = entries
    .filter((entry) => entry.isDirectory() && reportDatePattern.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();

  for (const date of dates) {
    const found = await readReportContextFromDateDir(outputDir, date);
    if (found) return found;
  }

  return null;
}

export async function findReportContextByDate(outputDir: string, date: string): Promise<{ path: string; context: PublicTrafficDataReportContext } | null> {
  if (!reportDatePattern.test(date)) throw new Error('date must be YYYY-MM-DD');
  return readReportContextFromDateDir(outputDir, date);
}

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function hasOneDaySourceData(context: PublicTrafficDataReportContext, source: 'hasExposureData' | 'hasDashboardData'): boolean {
  return context.rows.some((row) => row.periods['1d']?.[source] === true);
}

function formatLatestSummarySourceStatus(context: PublicTrafficDataReportContext): string {
  const exposureText = hasOneDaySourceData(context, 'hasExposureData') ? '曝光页已抓取' : '曝光页未更新/异常';
  const dashboardText = hasOneDaySourceData(context, 'hasDashboardData') ? '访问页已抓取' : '访问页未更新/异常';
  const orderText = context.orderAnalysis?.pages?.overview?.indicators?.length ? '订单情况已抓取' : '订单情况未更新/异常';
  return `数据源：${exposureText}；${dashboardText}；${orderText}`;
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
  const orderOverview = context.orderAnalysis?.pages?.overview;
  return [
    `公域日报 ${context.date}`,
    '',
    '公域曝光页：',
    `曝光 ${one.exposure}，访问 ${one.publicVisits}，金额 ¥${one.amount.toFixed(2)}，转化率 ${percent(one.exposureVisitRate)}`,
    '',
    '订单情况：',
    [
      `创建订单 ${findOrderAnalysisIndicator(orderOverview, ['创建订单数', '创建订单'])}`,
      `签约订单 ${findOrderAnalysisIndicator(orderOverview, ['签约订单数', '签约订单'])}`,
      `发货订单 ${findOrderAnalysisIndicator(orderOverview, ['发货订单数', '发货订单'])}`,
      `签约发货率 ${findOrderAnalysisIndicator(orderOverview, ['签约发货率'])}`,
    ].join('，'),
    '',
    formatLatestSummarySourceStatus(context),
    `建议操作：${context.recommendedActions.length} 条`,
  ].join('\n');
}

function formatPeriodConversion(label: string, metric: PublicTrafficDataReportContext['summary']['1d']): string {
  return [
    `${label}：曝光到访问率 ${percent(metric.exposureVisitRate)}`,
    `访问到创建率 ${percent(metric.visitCreatedOrderRate)}`,
    `访问到发货率 ${percent(metric.visitShipmentRate)}`,
    `曝光 ${metric.exposure}`,
    `访问 ${metric.publicVisits}`,
    `创建订单 ${metric.createdOrders}`,
    `发货 ${metric.shippedOrders}`,
    `金额 ¥${metric.amount.toFixed(2)}`,
  ].join('，');
}

export function formatConversionSummary(context: PublicTrafficDataReportContext): string {
  return [
    `公域转化率 ${context.date}`,
    formatPeriodConversion('1日', context.summary['1d']),
    formatPeriodConversion('7日', context.summary['7d']),
    formatPeriodConversion('30日', context.summary['30d']),
    '',
    formatLatestSummarySourceStatus(context),
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
