import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { queryProducts, parseNumericProductQueryList, productQueryMatch, type ProductQueryMatch, type ProductQueryResult } from '../agentData/productQuery.js';
import { findOrderAnalysisIndicator } from '../publicTraffic/orderAnalysis.js';
import { findPublicTrafficReportByDataDate } from '../publicTraffic/reportContextLocator.js';
import type { PublicTrafficDataReportContext, PublicTrafficProductDataRow } from '../publicTraffic/types.js';

const reportDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function reportContextFileNames(date: string): string[] {
  return [`公域数据上下文_${date}.json`, 'report-context.json'];
}

async function datedOutputDirs(outputDir: string): Promise<string[]> {
  const entries = await readdir(outputDir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && reportDatePattern.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
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
  for (const date of await datedOutputDirs(outputDir)) {
    const found = await readReportContextFromDateDir(outputDir, date);
    if (found) return found;
  }

  return null;
}

export async function findReportContextByDate(outputDir: string, date: string): Promise<{ path: string; context: PublicTrafficDataReportContext } | null> {
  if (!reportDatePattern.test(date)) throw new Error('date must be YYYY-MM-DD');
  const located = await findPublicTrafficReportByDataDate(outputDir, date);
  if (!located) return null;
  return { path: located.contextPath, context: located.context };
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

export function parseNumericProductIdList(keyword: string): string[] {
  return parseNumericProductQueryList(keyword);
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
  return queryProducts(context, keyword).matches.map((match) => match.row);
}

export function queryProductResult(context: PublicTrafficDataReportContext, keyword: string): ProductQueryResult {
  return queryProducts(context, keyword);
}

function formatMetricValue(value: number | null): string {
  return value === null ? '暂无数据' : String(value);
}

function formatProductIdentity(match: ProductQueryMatch): string {
  return `端内ID ${match.internalProductId}｜商品ID ${match.platformProductId ?? '未映射'}`;
}

function formatProductMatch(match: ProductQueryMatch): string {
  return [
    formatProductIdentity(match),
    match.row.productName,
    ...match.periods.map((period) => `${period.period.replace('d', '日')}：曝光 ${formatMetricValue(period.exposure)}，访问 ${formatMetricValue(period.visits)}，发货 ${formatMetricValue(period.shippedOrders)}`),
  ].join('\n');
}

function formatAmbiguous(result: ProductQueryResult): string[] {
  return result.ambiguous.map((item) => [
    `ID ${item.input} 同时命中多个商品，请明确选择端内ID或商品ID：`,
    ...item.candidates.map((candidate, index) => `${index + 1}. ${formatProductIdentity(candidate)} ${candidate.row.productName}`),
  ].join('\n'));
}

function formatMissing(result: ProductQueryResult): string[] {
  if (!result.missing.length) return [];
  return [
    `未找到：${result.missing.map((item) => item.input).join('、')}`,
    '未在最新日报与 ID 映射快照中找到。',
  ];
}

export function formatProductQueryResult(result: ProductQueryResult): string {
  const parts = [
    ...result.matches.map(formatProductMatch),
    ...formatAmbiguous(result),
    ...formatMissing(result),
  ];
  return parts.length ? parts.join('\n\n') : '没有找到匹配商品。';
}

export function formatProductRows(rows: PublicTrafficProductDataRow[]): string {
  if (rows.length === 0) return '没有找到匹配商品。';
  return rows.map((row) => formatProductMatch(productQueryMatch('', row))).join('\n\n');
}
