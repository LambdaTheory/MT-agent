import { flattenDiagnosticItems, sortedActions } from './diagnosticItems.js';
import { businessMetricLines, findOrderAnalysisIndicator } from './orderAnalysis.js';
import type {
  ExposureOverviewMetric,
  PublicTrafficDataReportContext,
  PublicTrafficDataSummary,
  PublicTrafficProductDataRow,
  PublicTrafficReportContext,
  PublicTrafficReportPaths,
  PublicTrafficReportSectionItem,
} from './types.js';

function summaryFromOverview(overview: ExposureOverviewMetric[], period: ExposureOverviewMetric['period']): PublicTrafficDataSummary {
  const metric = overview.find((item) => item.period === period);
  return {
    exposure: metric?.exposure ?? 0,
    publicVisits: metric?.visits ?? 0,
    dashboardVisits: metric?.visits ?? 0,
    createdOrders: 0,
    shippedOrders: 0,
    amount: metric?.amount ?? 0,
    exposureVisitRate: metric ? metric.conversionRate / 100 : 0,
    visitCreatedOrderRate: 0,
    visitShipmentRate: 0,
  };
}

function toDataContext(context: PublicTrafficDataReportContext | PublicTrafficReportContext): PublicTrafficDataReportContext {
  if ('summary' in context) return context;
  const summary = {
    '1d': summaryFromOverview(context.overview, '1d'),
    '7d': summaryFromOverview(context.overview, '7d'),
    '30d': summaryFromOverview(context.overview, '30d'),
  };
  return {
    date: context.date,
    generationId: `legacy-report-context:${context.date}`,
    summary,
    conclusions: [{ label: '基准', text: `暂无昨日公域数据上下文，今日仅展示基准值：曝光 ${summary['1d'].exposure}。` }],
    dataQualityNotes: [],
    rows: [],
    lowExposure: context.exposureOptimization,
    weakClick: [],
    weakConversion: context.conversionOptimization,
    highPotential: [],
    newProductObservation: context.newProductObservation,
    lifecycleGovernance: context.lifecycleGovernance,
    custodyAbnormal: [],
    recommendedActions: [],
    emptySectionNotes: { lowExposure: '', weakClick: '', weakConversion: '', highPotential: '', newProductObservation: '', lifecycleGovernance: '', custodyAbnormal: '', recommendedActions: '' },
  };
}

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function itemLines<T>(items: T[], formatter: (item: T) => string): string[] {
  return items.map((item, index) => `${index + 1}. ${formatter(item)}`);
}

function newProductPoolCount(context: PublicTrafficDataReportContext): number {
  return context.newProductPoolItems?.length ? context.newProductPoolItems.length : context.newProductPoolIds?.length ?? 0;
}

function newProductPoolLines(context: PublicTrafficDataReportContext): string[] {
  if (context.newProductPoolItems?.length) {
    return itemLines(context.newProductPoolItems.slice(0, 10), (item) => `商品ID ${item.productId} ${item.productName}：${item.maintenanceStatus}`);
  }
  return itemLines(context.newProductPoolIds?.slice(0, 10) ?? [], (id) => `商品ID ${id}｜待维护`);
}

function productLine(row: PublicTrafficProductDataRow, index: number): string {
  const one = row.periods['1d'];
  return `${index + 1}. ${row.displayProductId}｜${row.productName || 'Unknown'}｜曝光 ${one.exposure}｜公域访问 ${one.publicVisits}｜公域金额 ¥${one.amount.toFixed(2)}`;
}

function topExposureLines(rows: PublicTrafficProductDataRow[]): string[] {
  const score = (row: PublicTrafficProductDataRow) => row.periods['1d'].exposure || row.periods['1d'].publicVisits;
  const items = [...rows].sort((a, b) => score(b) - score(a)).slice(0, 10);
  return items.map(productLine);
}

function orderBusinessLine(context: PublicTrafficDataReportContext): string[] {
  const orderAnalysis = context.orderAnalysis;
  if (!orderAnalysis) return [];
  const overview = orderAnalysis.pages.overview;
  const customs = orderAnalysis.pages.customs;
  return [
    `订单经营：创建订单 ${findOrderAnalysisIndicator(overview, ['创建订单数'])}｜签约订单 ${findOrderAnalysisIndicator(overview, ['签约订单数'])}｜发货订单 ${findOrderAnalysisIndicator(overview, ['发货订单数'])}｜关单 ${findOrderAnalysisIndicator(customs, ['关单数'])}`,
  ];
}

function funnelLines(context: PublicTrafficDataReportContext): string[] {
  const summary = context.summary['1d'];
  const business = businessMetricLines(context.orderAnalysis?.pages.overview, context.orderAnalysis?.pages.customs);
  return [
    `曝光 ${summary.exposure}｜公域访问 ${summary.publicVisits}｜公域金额 ¥${summary.amount.toFixed(2)}｜转化率 ${percent(summary.exposureVisitRate)}`,
    ...orderBusinessLine(context),
    ...(business.length ? business : []),
  ];
}

function moduleCountLine(context: PublicTrafficDataReportContext): string | null {
  const counts = [
    ['曝光不足', context.lowExposure.length],
    ['点击弱', context.weakClick.length],
    ['转化弱', context.weakConversion.length],
    ['高潜力', context.highPotential.length],
    ['新品观察', context.newProductObservation.length],
    ['新品池维护', newProductPoolCount(context)],
    ['生命周期治理', context.lifecycleGovernance.length],
    ['托管异常', context.custodyAbnormal?.length ?? 0],
    ['建议操作', context.recommendedActions.length],
  ].filter(([, count]) => Number(count) > 0);
  return counts.length > 0 ? counts.map(([label, count]) => `${label} ${count}`).join('｜') : null;
}

function appendSection(lines: string[], title: string, items: string[]): void {
  if (items.length === 0) return;
  lines.push('', title, ...items);
}

export function buildPublicTrafficFeishuText(input: PublicTrafficDataReportContext | PublicTrafficReportContext, _paths: PublicTrafficReportPaths): string {
  const context = toDataContext(input);
  const lines = [
    `公域数据日报 ${context.date}`,
    '',
    '经营结论',
    ...context.conclusions.map((item) => `${item.label}：${item.text}`),
    '',
    '今日漏斗',
    ...funnelLines(context),
  ];
  const moduleLine = moduleCountLine(context);
  if (moduleLine) lines.push('', '模块数量', moduleLine);
  appendSection(lines, '今日曝光 Top10', topExposureLines(context.rows));
  appendSection(lines, '托管异常', itemLines(context.custodyAbnormal ?? [], (item) => `${item.identifier}｜${item.action}｜${item.reason}`));
  appendSection(lines, '诊断问题', itemLines(flattenDiagnosticItems(context), (diag) => `${diag.type}｜${diag.item.identifier}｜${diag.item.action}｜${diag.item.reason}`));
  appendSection(lines, '建议操作', itemLines(sortedActions(context.recommendedActions), (item) => `${item.action}｜${item.identifier}｜${item.reason}`));
  appendSection(lines, '新品池维护', newProductPoolLines(context));
  appendSection(lines, '新品观察', itemLines(context.newProductObservation, (item) => `${item.identifier}｜${item.action}｜${item.reason}`));
  return lines.join('\n');
}
