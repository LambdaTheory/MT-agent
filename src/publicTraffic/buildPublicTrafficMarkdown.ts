import { flattenDiagnosticItems, sortedActions } from './diagnosticItems.js';
import { businessMetricLines, findOrderAnalysisIndicator, shortDataDate } from './orderAnalysis.js';
import type {
  ExposureOverviewMetric,
  PublicTrafficDataReportContext,
  PublicTrafficDataSummary,
  PublicTrafficProductDataRow,
  PublicTrafficReportContext,
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

function overviewLines(summary: PublicTrafficDataSummary): string[] {
  return [
    `曝光 ${summary.exposure}｜公域访问 ${summary.publicVisits}｜公域金额 ¥${summary.amount.toFixed(2)}`,
    `转化率 ${(summary.exposureVisitRate * 100).toFixed(2)}%`,
  ];
}

function oneDayOverviewLines(context: PublicTrafficDataReportContext): string[] {
  const summary = context.summary['1d'];
  const oa = context.orderAnalysis;
  if (!oa) return overviewLines(summary);
  const overview = oa.pages.overview;
  const delivery = oa.pages.delivery;
  const returns = oa.pages.return;
  const customs = oa.pages.customs;
  return [
    `公域（${context.date}）：曝光 ${summary.exposure}｜公域访问 ${summary.publicVisits}｜公域金额 ¥${summary.amount.toFixed(2)}｜转化率 ${(summary.exposureVisitRate * 100).toFixed(2)}%`,
    `订单经营（${shortDataDate(overview?.dataDate)}）：创建订单 ${findOrderAnalysisIndicator(overview, ['创建订单数'])}｜签约订单 ${findOrderAnalysisIndicator(overview, ['签约订单数'])}｜发货订单 ${findOrderAnalysisIndicator(overview, ['发货订单数'])}`,
    `履约（发货${shortDataDate(delivery?.dataDate)}｜归还${shortDataDate(returns?.dataDate)}｜关单${shortDataDate(customs?.dataDate)}）：待发货 ${findOrderAnalysisIndicator(delivery, ['待发货订单数'])}｜归还 ${findOrderAnalysisIndicator(returns, ['归还订单数'])}｜逾期 ${findOrderAnalysisIndicator(returns, ['逾期订单数'])}｜关单 ${findOrderAnalysisIndicator(customs, ['关单数'])}`,
    `经营指标：${businessMetricLines(overview, customs).join('') || '发货率 -｜关单率 -（目标<=35%）｜客单价 -'}`,
  ];
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

function appendMarkdownSection(lines: string[], title: string, items: string[]): void {
  if (items.length === 0) return;
  lines.push('', `## ${title}`, ...items);
}

function tableCell(value: string): string {
  return value.replace(/\|/g, '｜').replace(/[\r\n]+/g, ' ').trim();
}

function appendMarkdownTable(lines: string[], title: string, headers: string[], rows: string[][]): void {
  if (rows.length === 0) return;
  lines.push('', `## ${title}`, `| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`);
  lines.push(...rows.map((row) => `| ${row.map(tableCell).join(' | ')} |`));
}

function diagnosticRows(context: PublicTrafficDataReportContext): string[][] {
  return flattenDiagnosticItems(context).map(({ type, item }) => [type, item.identifier, item.action, item.reason]);
}

export function buildPublicTrafficMarkdown(input: PublicTrafficDataReportContext | PublicTrafficReportContext): string {
  const context = toDataContext(input);
  const lines = [
    `# 公域数据日报 ${context.date}`,
    '',
    '## 经营结论',
    ...context.conclusions.map((item) => `- ${item.label}：${item.text}`),
    '',
    '## 1日总览',
    ...oneDayOverviewLines(context),
  ];
  lines.push('');
  appendMarkdownSection(lines, '今日曝光 Top10', topExposureLines(context.rows));
  appendMarkdownTable(lines, '托管异常', ['商品', '操作', '原因'], (context.custodyAbnormal ?? []).map((item) => [item.identifier, item.action, item.reason]));
  appendMarkdownTable(lines, '诊断问题', ['类型', '商品', '操作', '原因'], diagnosticRows(context));
  appendMarkdownTable(lines, '建议操作', ['操作', '商品', '原因'], sortedActions(context.recommendedActions).map((item) => [item.action, item.identifier, item.reason]));
  appendMarkdownTable(lines, '新品观察', ['商品', '操作', '原因'], context.newProductObservation.map((item) => [item.identifier, item.action, item.reason]));
  return lines.join('\n');
}
