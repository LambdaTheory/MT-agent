import type {
  ExposureOverviewMetric,
  PublicTrafficDataReportContext,
  PublicTrafficDataSummary,
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
  return {
    date: context.date,
    summary: {
      '1d': summaryFromOverview(context.overview, '1d'),
      '7d': summaryFromOverview(context.overview, '7d'),
      '30d': summaryFromOverview(context.overview, '30d'),
    },
    rows: [],
    lowExposure: context.exposureOptimization,
    weakClick: [],
    weakConversion: context.conversionOptimization,
    highPotential: [],
    newProductObservation: context.newProductObservation,
    lifecycleGovernance: context.lifecycleGovernance,
  };
}

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function topLines(items: PublicTrafficReportSectionItem[], limit = 5): string[] {
  return items.length > 0 ? items.slice(0, limit).map((item, index) => `${index + 1}. ${item.identifier}｜${item.reason}`) : ['无'];
}

export function buildPublicTrafficFeishuText(input: PublicTrafficDataReportContext | PublicTrafficReportContext, paths: PublicTrafficReportPaths): string {
  const context = toDataContext(input);
  const one = context.summary['1d'];
  return [
    `公域数据日报 ${context.date}`,
    '',
    '今日漏斗',
    `曝光：${one.exposure}`,
    `公域访问：${one.publicVisits}`,
    `后链路访问：${one.dashboardVisits}`,
    `订单：${one.createdOrders}`,
    `发货：${one.shippedOrders}`,
    `金额：¥${one.amount.toFixed(2)}`,
    `曝光到访问率：${percent(one.exposureVisitRate)}`,
    `访问到发货率：${percent(one.visitShipmentRate)}`,
    '',
    '模块数量',
    `曝光不足：${context.lowExposure.length}个`,
    `点击弱：${context.weakClick.length}个`,
    `转化弱：${context.weakConversion.length}个`,
    `高潜力：${context.highPotential.length}个`,
    '',
    '曝光不足 Top5',
    ...topLines(context.lowExposure),
    '',
    '点击弱 Top5',
    ...topLines(context.weakClick),
    '',
    '转化弱 Top5',
    ...topLines(context.weakConversion),
    '',
    `Markdown：${paths.markdownPath}`,
    `XLSX：${paths.workbookPath}`,
  ].join('\n');
}
