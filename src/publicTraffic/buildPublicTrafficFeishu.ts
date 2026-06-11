import type {
  ExposureOverviewMetric,
  PublicTrafficDataReportContext,
  PublicTrafficDataSummary,
  PublicTrafficProductDataRow,
  PublicTrafficReportContext,
  PublicTrafficReportPaths,
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

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function topLines(items: PublicTrafficReportSectionItem[], limit = 5): string[] {
  return items.slice(0, limit).map((item, index) => `${index + 1}. ${item.identifier}｜${item.action}｜${item.reason}`);
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
    .sort((a, b) => a.periods['1d'].exposure - b.periods['1d'].exposure || (b.custodyDays ?? 0) - (a.custodyDays ?? 0))
    .slice(0, 15);
  return items.map((row, index) => `${productLine(row, index)}｜托管 ${row.custodyDays}天`);
}

function funnelLines(summary: PublicTrafficDataSummary): string[] {
  return [
    `曝光 ${summary.exposure}｜公域访问 ${summary.publicVisits}｜后链路访问 ${summary.dashboardVisits}｜订单 ${summary.createdOrders}｜发货 ${summary.shippedOrders}｜金额 ¥${summary.amount.toFixed(2)}`,
    `曝光到访问率 ${percent(summary.exposureVisitRate)}｜访问到发货率 ${percent(summary.visitShipmentRate)}`,
  ];
}

function moduleCountLine(context: PublicTrafficDataReportContext): string | null {
  const counts = [
    ['曝光不足', context.lowExposure.length],
    ['点击弱', context.weakClick.length],
    ['转化弱', context.weakConversion.length],
    ['高潜力', context.highPotential.length],
    ['新品观察', context.newProductObservation.length],
    ['生命周期治理', context.lifecycleGovernance.length],
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
  const one = context.summary['1d'];
  const lines = [
    `公域数据日报 ${context.date}`,
    '',
    '经营结论',
    ...context.conclusions.map((item) => `${item.label}：${item.text}`),
    '',
    '今日漏斗',
    ...funnelLines(one),
  ];
  const moduleLine = moduleCountLine(context);
  if (context.dataQualityNotes?.length) lines.push('', '数据提示', ...context.dataQualityNotes);
  if (moduleLine) lines.push('', '模块数量', moduleLine);
  appendSection(lines, '今日曝光 Top10', topExposureLines(context.rows));
  appendSection(lines, '预警商品（托管>5天 且 曝光<100）', warningProductLines(context.rows));
  appendSection(lines, '建议操作', topLines(context.recommendedActions, 8));
  appendSection(lines, '曝光不足 Top5', topLines(context.lowExposure));
  appendSection(lines, '点击弱 Top5', topLines(context.weakClick));
  appendSection(lines, '转化弱 Top5', topLines(context.weakConversion));
  appendSection(lines, '高潜力 Top5', topLines(context.highPotential));
  appendSection(lines, '新品观察 Top5', topLines(context.newProductObservation));
  appendSection(lines, '生命周期治理 Top5', topLines(context.lifecycleGovernance));
  return lines.join('\n');
}
