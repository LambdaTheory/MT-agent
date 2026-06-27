import type { PeriodKey } from '../domain/types.js';
import { ORDER_ANALYSIS_PAGE_LABELS, type OrderAnalysisPageKey } from '../publicTraffic/orderAnalysis.js';
import type { PublicTrafficDataReportContext, PublicTrafficPeriodMetrics, PublicTrafficProductDataRow, PublicTrafficReportSectionItem } from '../publicTraffic/types.js';

const PERIODS: PeriodKey[] = ['1d', '7d', '30d'];
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

export const reportMetricNames = [
  'exposure',
  'publicVisits',
  'dashboardVisits',
  'createdOrders',
  'signedOrders',
  'reviewedOrders',
  'shippedOrders',
  'createdOrderAmount',
  'signedOrderAmount',
  'reviewedOrderAmount',
  'shippedOrderAmount',
  'amount',
  'exposureVisitRate',
  'visitCreatedOrderRate',
  'visitShipmentRate',
  'custodyDays',
] as const;

export type ReportMetricName = typeof reportMetricNames[number];

export const reportSectionNames = [
  'lowExposure',
  'weakClick',
  'weakConversion',
  'highPotential',
  'newProductObservation',
  'lifecycleGovernance',
  'custodyAbnormal',
  'recommendedActions',
  'newProductPool',
  'removedLinks',
] as const;

export type ReportSectionName = typeof reportSectionNames[number];

export type ReportQueryTarget = 'summary' | 'products' | 'section' | 'sectionCounts' | 'orders' | 'dataQuality' | 'conclusions';

export interface ReportQueryFilter {
  field: ReportMetricName | 'productName' | 'productId' | 'platformProductId' | 'action' | 'reason' | 'priority';
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains';
  value: string | number | boolean;
}

export interface PublicTrafficReportQueryArguments {
  target: ReportQueryTarget;
  date?: string;
  period?: PeriodKey;
  periods?: PeriodKey[];
  metrics?: ReportMetricName[];
  productQuery?: string;
  section?: ReportSectionName;
  sortBy?: ReportMetricName | 'productName' | 'productId' | 'platformProductId' | 'action' | 'priority';
  sortDirection?: 'asc' | 'desc';
  limit?: number | string;
  filters?: ReportQueryFilter[];
  orderPage?: OrderAnalysisPageKey | 'all';
  orderIndicator?: string;
}

interface ReportMetricDefinition {
  label: string;
  format?: 'number' | 'money' | 'percent' | 'raw';
  summary?: (metric: PublicTrafficDataReportContext['summary']['1d']) => number | string | undefined;
  product?: (row: PublicTrafficProductDataRow, period: PeriodKey) => number | string | null | undefined;
}

const metricDefinitions: Record<ReportMetricName, ReportMetricDefinition> = {
  exposure: { label: '曝光', summary: (metric) => metric.exposure, product: (row, period) => row.periods[period]?.exposure },
  publicVisits: { label: '公域访问', summary: (metric) => metric.publicVisits, product: (row, period) => row.periods[period]?.publicVisits },
  dashboardVisits: { label: '访问页访问', summary: (metric) => metric.dashboardVisits, product: (row, period) => row.periods[period]?.dashboardVisits },
  createdOrders: { label: '创建订单', summary: (metric) => metric.createdOrders, product: (row, period) => row.periods[period]?.createdOrders },
  signedOrders: { label: '签约订单', product: (row, period) => row.periods[period]?.signedOrders },
  reviewedOrders: { label: '审核订单', product: (row, period) => row.periods[period]?.reviewedOrders },
  shippedOrders: { label: '发货', summary: (metric) => metric.shippedOrders, product: (row, period) => row.periods[period]?.shippedOrders },
  createdOrderAmount: { label: '创建金额', format: 'money', product: (row, period) => row.periods[period]?.createdOrderAmount },
  signedOrderAmount: { label: '签约金额', format: 'money', product: (row, period) => row.periods[period]?.signedOrderAmount },
  reviewedOrderAmount: { label: '审核金额', format: 'money', product: (row, period) => row.periods[period]?.reviewedOrderAmount },
  shippedOrderAmount: { label: '发货金额', format: 'money', product: (row, period) => row.periods[period]?.shippedOrderAmount },
  amount: { label: '金额', format: 'money', summary: (metric) => metric.amount, product: (row, period) => row.periods[period]?.amount },
  exposureVisitRate: { label: '曝光到访问率', format: 'percent', summary: (metric) => metric.exposureVisitRate, product: (row, period) => row.periods[period]?.exposureVisitRate },
  visitCreatedOrderRate: { label: '访问到创建率', format: 'percent', summary: (metric) => metric.visitCreatedOrderRate, product: (row, period) => row.periods[period]?.visitCreatedOrderRate },
  visitShipmentRate: { label: '访问到发货率', format: 'percent', summary: (metric) => metric.visitShipmentRate, product: (row, period) => row.periods[period]?.visitShipmentRate },
  custodyDays: { label: '托管天数', product: (row) => row.custodyDays },
};

const defaultMetricsByTarget: Record<'summary' | 'products', ReportMetricName[]> = {
  summary: ['exposure', 'publicVisits', 'createdOrders', 'shippedOrders', 'amount', 'exposureVisitRate', 'visitShipmentRate'],
  products: ['exposure', 'publicVisits', 'createdOrders', 'shippedOrders', 'amount', 'exposureVisitRate'],
};

const sectionLabels: Record<ReportSectionName, string> = {
  lowExposure: '曝光低',
  weakClick: '点击弱',
  weakConversion: '转化弱',
  highPotential: '高潜力',
  newProductObservation: '新品观察',
  lifecycleGovernance: '生命周期治理',
  custodyAbnormal: '托管异常',
  recommendedActions: '建议操作',
  newProductPool: '新链接池',
  removedLinks: '下架链接',
};

function clampLimit(value: unknown): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : DEFAULT_LIMIT;
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(parsed)));
}

function normalizeText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function internalProductId(row: PublicTrafficProductDataRow): string {
  return /^端内id\s*(\d+)$/i.exec(row.displayProductId.trim())?.[1] ?? row.displayProductId;
}

function periodsFromArgs(args: PublicTrafficReportQueryArguments): PeriodKey[] {
  const periods: PeriodKey[] = args.periods?.length ? args.periods : args.period ? [args.period] : ['1d'];
  return periods.filter((period): period is PeriodKey => PERIODS.includes(period));
}

function metricList(args: PublicTrafficReportQueryArguments, target: 'summary' | 'products'): ReportMetricName[] {
  const metrics = args.metrics?.filter((metric): metric is ReportMetricName => reportMetricNames.includes(metric)) ?? [];
  return metrics.length ? metrics : defaultMetricsByTarget[target];
}

function formatValue(value: unknown, definition?: ReportMetricDefinition): string {
  if (value === undefined || value === null || value === '') return '-';
  if (typeof value === 'number') {
    if (definition?.format === 'percent') return `${(value * 100).toFixed(2)}%`;
    if (definition?.format === 'money') return `¥${value.toFixed(2)}`;
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  return String(value);
}

function productMetricValue(row: PublicTrafficProductDataRow, metric: ReportMetricName, period: PeriodKey): unknown {
  return metricDefinitions[metric]?.product?.(row, period);
}

function productFieldValue(row: PublicTrafficProductDataRow, field: ReportQueryFilter['field'], period: PeriodKey): unknown {
  if (field === 'productName') return row.productName;
  if (field === 'productId') return internalProductId(row);
  if (field === 'platformProductId') return row.platformProductId;
  if (reportMetricNames.includes(field as ReportMetricName)) return productMetricValue(row, field as ReportMetricName, period);
  return undefined;
}

function compareValues(left: unknown, right: unknown, operator: ReportQueryFilter['operator']): boolean {
  if (operator === 'contains') return normalizeText(left).includes(normalizeText(right));
  const leftNumber = typeof left === 'number' ? left : Number(left);
  const rightNumber = typeof right === 'number' ? right : Number(right);
  const numeric = Number.isFinite(leftNumber) && Number.isFinite(rightNumber);
  if (numeric) {
    switch (operator) {
      case 'eq': return leftNumber === rightNumber;
      case 'neq': return leftNumber !== rightNumber;
      case 'gt': return leftNumber > rightNumber;
      case 'gte': return leftNumber >= rightNumber;
      case 'lt': return leftNumber < rightNumber;
      case 'lte': return leftNumber <= rightNumber;
    }
  }
  const leftText = normalizeText(left);
  const rightText = normalizeText(right);
  return operator === 'eq' ? leftText === rightText : operator === 'neq' ? leftText !== rightText : false;
}

function productMatchesFilters(row: PublicTrafficProductDataRow, filters: ReportQueryFilter[] | undefined, period: PeriodKey): boolean {
  if (!filters?.length) return true;
  return filters.every((filter) => compareValues(productFieldValue(row, filter.field, period), filter.value, filter.operator));
}

function productMatchesQuery(row: PublicTrafficProductDataRow, query: string | undefined): boolean {
  if (!query?.trim()) return true;
  const normalized = normalizeText(query);
  return normalizeText(row.productName).includes(normalized) ||
    normalizeText(row.displayProductId).includes(normalized) ||
    normalizeText(internalProductId(row)) === normalized ||
    normalizeText(row.platformProductId).includes(normalized);
}

function compareSortableValues(left: unknown, right: unknown): number {
  const leftNumber = typeof left === 'number' ? left : Number(left);
  const rightNumber = typeof right === 'number' ? right : Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
  return normalizeText(left).localeCompare(normalizeText(right), 'zh-Hans-CN');
}

function sortableProductValue(row: PublicTrafficProductDataRow, sortBy: PublicTrafficReportQueryArguments['sortBy'], period: PeriodKey): unknown {
  if (!sortBy) return productMetricValue(row, 'publicVisits', period);
  if (sortBy === 'productName') return row.productName;
  if (sortBy === 'productId') return internalProductId(row);
  if (sortBy === 'platformProductId') return row.platformProductId;
  if (sortBy === 'action' || sortBy === 'priority') return undefined;
  return productMetricValue(row, sortBy, period);
}

function formatProductLine(row: PublicTrafficProductDataRow, period: PeriodKey, metrics: ReportMetricName[], index: number): string {
  const metricText = metrics
    .map((metric) => `${metricDefinitions[metric].label} ${formatValue(productMetricValue(row, metric, period), metricDefinitions[metric])}`)
    .join('，');
  return `${index + 1}. 端内ID ${internalProductId(row)} ${row.productName}：${period} ${metricText}`;
}

function formatSummary(context: PublicTrafficDataReportContext, args: PublicTrafficReportQueryArguments): string {
  const periods = periodsFromArgs(args);
  const metrics = metricList(args, 'summary').filter((metric) => metricDefinitions[metric].summary);
  const lines = periods.map((period) => {
    const summary = context.summary[period];
    const metricText = metrics
      .map((metric) => `${metricDefinitions[metric].label} ${formatValue(metricDefinitions[metric].summary?.(summary), metricDefinitions[metric])}`)
      .join('，');
    return `${period}：${metricText}`;
  });
  return [`公域日报汇总 ${context.date}`, ...lines].join('\n');
}

function formatProducts(context: PublicTrafficDataReportContext, args: PublicTrafficReportQueryArguments): string {
  const period = periodsFromArgs(args)[0] ?? '1d';
  const metrics = metricList(args, 'products');
  const sortDirection = args.sortDirection ?? 'desc';
  const limit = clampLimit(args.limit);
  const sortBy = args.sortBy && reportMetricNames.includes(args.sortBy as ReportMetricName)
    ? args.sortBy
    : args.sortBy ?? metrics[0] ?? 'publicVisits';

  const rows = context.rows
    .filter((row) => productMatchesQuery(row, args.productQuery))
    .filter((row) => productMatchesFilters(row, args.filters, period))
    .sort((left, right) => {
      const compared = compareSortableValues(sortableProductValue(left, sortBy, period), sortableProductValue(right, sortBy, period));
      return sortDirection === 'asc' ? compared : -compared;
    })
    .slice(0, limit);

  if (rows.length === 0) return `公域日报商品查询 ${context.date}\n暂无匹配商品。`;
  return [
    `公域日报商品查询 ${context.date}`,
    `${period}，按 ${metricDefinitions[sortBy as ReportMetricName]?.label ?? sortBy} ${sortDirection === 'asc' ? '升序' : '降序'}，前 ${rows.length} 条`,
    ...rows.map((row, index) => formatProductLine(row, period, metrics, index)),
  ].join('\n');
}

function sectionItems(context: PublicTrafficDataReportContext, section: ReportSectionName): Array<Record<string, unknown>> {
  if (section === 'newProductPool') return context.newProductPoolItems ?? (context.newProductPoolIds ?? []).map((productId) => ({ productId }));
  if (section === 'removedLinks') return (context.agentData?.removedLinks ?? []).map((item) => ({ ...item }));
  return ((context[section] ?? []) as PublicTrafficReportSectionItem[]).map((item) => ({ ...item }));
}

function sectionFieldValue(item: Record<string, unknown>, field: ReportQueryFilter['field']): unknown {
  if (field === 'productId') return item.identifier ?? item.productId;
  return item[field];
}

function itemMatchesSectionFilters(item: Record<string, unknown>, filters: ReportQueryFilter[] | undefined): boolean {
  if (!filters?.length) return true;
  return filters.every((filter) => compareValues(sectionFieldValue(item, filter.field), filter.value, filter.operator));
}

function formatSectionItem(item: Record<string, unknown>, index: number): string {
  const id = item.identifier ?? item.productId ?? '-';
  const action = item.action ?? item.maintenanceStatus ?? item.reason ?? '-';
  const reason = item.reason ?? item.productName ?? item.note ?? '';
  const priority = item.priority ? `，优先级 ${item.priority}` : '';
  return `${index + 1}. ${id}：${action}${priority}${reason ? `。${reason}` : ''}`;
}

function formatSection(context: PublicTrafficDataReportContext, args: PublicTrafficReportQueryArguments): string {
  const section = args.section ?? 'recommendedActions';
  const limit = clampLimit(args.limit);
  const sortDirection = args.sortDirection ?? 'asc';
  const items = sectionItems(context, section)
    .filter((item) => itemMatchesSectionFilters(item, args.filters))
    .sort((left, right) => {
      if (!args.sortBy) return 0;
      const compared = compareSortableValues(sectionFieldValue(left, args.sortBy as ReportQueryFilter['field']), sectionFieldValue(right, args.sortBy as ReportQueryFilter['field']));
      return sortDirection === 'asc' ? compared : -compared;
    })
    .slice(0, limit);
  return [
    `公域日报${sectionLabels[section]} ${context.date}`,
    `共 ${sectionItems(context, section).length} 条，展示 ${items.length} 条`,
    ...(items.length ? items.map(formatSectionItem) : ['暂无数据。']),
  ].join('\n');
}

function formatSectionCounts(context: PublicTrafficDataReportContext): string {
  return [
    `公域日报问题池数量 ${context.date}`,
    ...reportSectionNames.map((section) => `${sectionLabels[section]}：${sectionItems(context, section).length} 条`),
  ].join('\n');
}

function formatOrders(context: PublicTrafficDataReportContext, args: PublicTrafficReportQueryArguments): string {
  const pages = context.orderAnalysis?.pages;
  if (!pages) return `订单分析 ${context.date}\n暂无订单分析数据。`;
  const keys = args.orderPage && args.orderPage !== 'all' ? [args.orderPage] : (Object.keys(pages) as OrderAnalysisPageKey[]);
  const indicatorQuery = normalizeText(args.orderIndicator);
  const lines = [`订单分析 ${context.date}`];
  for (const key of keys) {
    const page = pages[key];
    if (!page) continue;
    const indicators = indicatorQuery
      ? page.indicators.filter((item) => normalizeText(item.label).includes(indicatorQuery))
      : page.indicators;
    lines.push(`${ORDER_ANALYSIS_PAGE_LABELS[key] ?? page.label}${page.dataDate ? `（${page.dataDate}）` : ''}`);
    lines.push(...(indicators.length ? indicators.slice(0, clampLimit(args.limit)).map((item) => `${item.label}：${item.value}${item.delta ? `（${item.delta}）` : ''}`) : ['暂无匹配指标。']));
  }
  return lines.join('\n');
}

function formatDataQuality(context: PublicTrafficDataReportContext): string {
  const oneDayHasExposure = context.rows.some((row) => row.periods['1d']?.hasExposureData);
  const oneDayHasDashboard = context.rows.some((row) => row.periods['1d']?.hasDashboardData);
  const notes = context.dataQualityNotes?.length ? context.dataQualityNotes : ['暂无额外质量备注。'];
  return [
    `日报数据源状态 ${context.date}`,
    `曝光页：${oneDayHasExposure ? '已抓取' : '未更新/异常'}`,
    `访问页：${oneDayHasDashboard ? '已抓取' : '未更新/异常'}`,
    `订单情况：${context.orderAnalysis?.pages?.overview?.indicators?.length ? '已抓取' : '未更新/异常'}`,
    ...notes.map((note) => `- ${note}`),
  ].join('\n');
}

function formatConclusions(context: PublicTrafficDataReportContext): string {
  const conclusions = context.conclusions.length
    ? context.conclusions.map((item, index) => `${index + 1}. ${item.label}：${item.text}`)
    : ['暂无结论。'];
  const emptyNotes = Object.entries(context.emptySectionNotes ?? {})
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}：${value}`);
  return [
    `日报结论 ${context.date}`,
    ...conclusions,
    ...(emptyNotes.length ? ['', '空分区说明', ...emptyNotes] : []),
  ].join('\n');
}

export function runPublicTrafficReportQuery(context: PublicTrafficDataReportContext, args: PublicTrafficReportQueryArguments): string {
  switch (args.target) {
    case 'summary':
      return formatSummary(context, args);
    case 'products':
      return formatProducts(context, args);
    case 'section':
      return formatSection(context, args);
    case 'sectionCounts':
      return formatSectionCounts(context);
    case 'orders':
      return formatOrders(context, args);
    case 'dataQuality':
      return formatDataQuality(context);
    case 'conclusions':
      return formatConclusions(context);
  }
}
