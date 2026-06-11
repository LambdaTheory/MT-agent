import type {
  ExposureOverviewMetric,
  PublicTrafficDataReportContext,
  PublicTrafficDataSummary,
  PublicTrafficProductDataRow,
  PublicTrafficReportContext,
  PublicTrafficReportSectionItem,
} from './types.js';

const emptySectionNotes = {
  lowExposure: '暂无达到阈值的曝光不足商品。',
  weakClick: '暂无达到阈值的高曝光低点击商品。',
  weakConversion: '暂无达到阈值的高访问低转化商品。',
  highPotential: '暂无达到放量阈值的高潜力商品。',
  newProductObservation: '暂无可识别的新进入公域商品，或今日缺少上一日快照。',
  lifecycleGovernance: '暂无达到长期弱表现阈值的托管商品。',
  recommendedActions: '暂无需要立即处理的建议操作。',
};

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
    recommendedActions: [],
    emptySectionNotes,
  };
}

function linesFor(items: PublicTrafficReportSectionItem[]): string[] {
  return items.map((item, index) => `${index + 1}. ${item.identifier}：${item.action}。原因：${item.reason}`);
}

function overviewLines(summary: PublicTrafficDataSummary): string[] {
  return [
    `曝光 ${summary.exposure}｜公域访问 ${summary.publicVisits}｜后链路访问 ${summary.dashboardVisits}｜订单 ${summary.createdOrders}｜发货 ${summary.shippedOrders}｜金额 ¥${summary.amount.toFixed(2)}`,
    `曝光到访问率 ${(summary.exposureVisitRate * 100).toFixed(2)}%｜访问到下单率 ${(summary.visitCreatedOrderRate * 100).toFixed(2)}%｜访问到发货率 ${(summary.visitShipmentRate * 100).toFixed(2)}%`,
  ];
}

function productLine(row: PublicTrafficProductDataRow, index: number): string {
  const one = row.periods['1d'];
  const visits = one.publicVisits || one.dashboardVisits;
  return `${index + 1}. ${row.displayProductId}｜${row.productName || 'Unknown'}｜曝光 ${one.exposure}｜访问 ${visits}｜金额 ¥${one.amount.toFixed(2)}`;
}

function topExposureLines(rows: PublicTrafficProductDataRow[]): string[] {
  const score = (row: PublicTrafficProductDataRow) => row.periods['1d'].exposure || row.periods['1d'].publicVisits || row.periods['1d'].dashboardVisits;
  const items = [...rows].sort((a, b) => score(b) - score(a)).slice(0, 10);
  return items.map(productLine);
}

function warningProductLines(rows: PublicTrafficProductDataRow[]): string[] {
  const items = rows
    .filter((row) => typeof row.custodyDays === 'number' && row.custodyDays > 5 && row.periods['1d'].exposure < 100)
    .sort((a, b) => a.periods['1d'].exposure - b.periods['1d'].exposure || (b.custodyDays ?? 0) - (a.custodyDays ?? 0));
  return items.slice(0, 15).map((row, index) => `${productLine(row, index)}｜托管 ${row.custodyDays}天`);
}

function appendMarkdownSection(lines: string[], title: string, items: string[]): void {
  if (items.length === 0) return;
  lines.push('', `## ${title}`, ...items);
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
    ...overviewLines(context.summary['1d']),
  ];
  if (context.dataQualityNotes?.length) {
    lines.push('', '## 数据提示', ...context.dataQualityNotes);
  }
  lines.push(
    '',
    '## 7日总览',
    ...overviewLines(context.summary['7d']),
    '',
    '## 30日总览',
    ...overviewLines(context.summary['30d']),
    '',
  );
  appendMarkdownSection(lines, '今日曝光 Top10', topExposureLines(context.rows));
  appendMarkdownSection(lines, '预警商品（托管>5天 且 曝光<100）', warningProductLines(context.rows));
  appendMarkdownSection(lines, '建议操作', linesFor(context.recommendedActions));
  appendMarkdownSection(lines, '曝光不足', linesFor(context.lowExposure));
  appendMarkdownSection(lines, '曝光有但点击弱', linesFor(context.weakClick));
  appendMarkdownSection(lines, '点击有但转化弱', linesFor(context.weakConversion));
  appendMarkdownSection(lines, '高潜力商品', linesFor(context.highPotential));
  appendMarkdownSection(lines, '新品观察', linesFor(context.newProductObservation));
  appendMarkdownSection(lines, '生命周期治理', linesFor(context.lifecycleGovernance));
  return lines.join('\n');
}
