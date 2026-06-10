import type {
  ExposureOverviewMetric,
  PublicTrafficDataReportContext,
  PublicTrafficDataSummary,
  PublicTrafficReportContext,
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
  return {
    date: context.date,
    summary: {
      '1d': summaryFromOverview(context.overview, '1d'),
      '7d': summaryFromOverview(context.overview, '7d'),
      '30d': summaryFromOverview(context.overview, '30d'),
    },
    conclusions: [],
    rows: [],
    lowExposure: context.exposureOptimization,
    weakClick: [],
    weakConversion: context.conversionOptimization,
    highPotential: [],
    newProductObservation: context.newProductObservation,
    lifecycleGovernance: context.lifecycleGovernance,
    recommendedActions: [],
    emptySectionNotes: {
      lowExposure: '暂无达到阈值的曝光不足商品。',
      weakClick: '暂无达到阈值的高曝光低点击商品。',
      weakConversion: '暂无达到阈值的高访问低转化商品。',
      highPotential: '暂无达到放量阈值的高潜力商品。',
      newProductObservation: '暂无可识别的新进入公域商品，或今日缺少上一日快照。',
      lifecycleGovernance: '暂无达到长期弱表现阈值的托管商品。',
      recommendedActions: '暂无需要立即处理的建议操作。',
    },
  };
}

function linesFor(items: PublicTrafficReportSectionItem[]): string[] {
  return items.length > 0 ? items.map((item, index) => `${index + 1}. ${item.identifier}：${item.action}。原因：${item.reason}`) : ['无'];
}

function overviewLines(summary: PublicTrafficDataSummary): string[] {
  return [
    `曝光：${summary.exposure}`,
    `公域访问：${summary.publicVisits}`,
    `后链路访问：${summary.dashboardVisits}`,
    `订单：${summary.createdOrders}`,
    `发货：${summary.shippedOrders}`,
    `金额：¥${summary.amount.toFixed(2)}`,
    `曝光到访问率：${(summary.exposureVisitRate * 100).toFixed(2)}%`,
    `访问到下单率：${(summary.visitCreatedOrderRate * 100).toFixed(2)}%`,
    `访问到发货率：${(summary.visitShipmentRate * 100).toFixed(2)}%`,
  ];
}

export function buildPublicTrafficMarkdown(input: PublicTrafficDataReportContext | PublicTrafficReportContext): string {
  const context = toDataContext(input);
  return [
    `# 公域数据日报 ${context.date}`,
    '',
    '## 1日总览',
    ...overviewLines(context.summary['1d']),
    '',
    '## 7日总览',
    ...overviewLines(context.summary['7d']),
    '',
    '## 30日总览',
    ...overviewLines(context.summary['30d']),
    '',
    '## 曝光不足',
    ...linesFor(context.lowExposure),
    '',
    '## 曝光有但点击弱',
    ...linesFor(context.weakClick),
    '',
    '## 点击有但转化弱',
    ...linesFor(context.weakConversion),
    '',
    '## 高潜力商品',
    ...linesFor(context.highPotential),
    '',
    '## 新品观察',
    ...linesFor(context.newProductObservation),
    '',
    '## 生命周期治理',
    ...linesFor(context.lifecycleGovernance),
    '',
  ].join('\n');
}
