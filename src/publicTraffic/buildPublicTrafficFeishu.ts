import type {
  ExposureOverviewMetric,
  PublicTrafficDataReportContext,
  PublicTrafficDataSummary,
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

function topLines(items: PublicTrafficReportSectionItem[], emptyNote: string, limit = 5): string[] {
  return items.length > 0 ? items.slice(0, limit).map((item, index) => `${index + 1}. ${item.identifier}｜${item.action}｜${item.reason}`) : [emptyNote];
}

export function buildPublicTrafficFeishuText(input: PublicTrafficDataReportContext | PublicTrafficReportContext, paths: PublicTrafficReportPaths): string {
  const context = toDataContext(input);
  const one = context.summary['1d'];
  return [
    `公域数据日报 ${context.date}`,
    '',
    '经营结论',
    ...context.conclusions.map((item) => `${item.label}：${item.text}`),
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
    '建议操作',
    ...topLines(context.recommendedActions, context.emptySectionNotes.recommendedActions, 8),
    '',
    '曝光不足 Top5',
    ...topLines(context.lowExposure, context.emptySectionNotes.lowExposure),
    '',
    '点击弱 Top5',
    ...topLines(context.weakClick, context.emptySectionNotes.weakClick),
    '',
    '转化弱 Top5',
    ...topLines(context.weakConversion, context.emptySectionNotes.weakConversion),
    '',
    '高潜力 Top5',
    ...topLines(context.highPotential, context.emptySectionNotes.highPotential),
    '',
    '新品观察 Top5',
    ...topLines(context.newProductObservation, context.emptySectionNotes.newProductObservation),
    '',
    '生命周期治理 Top5',
    ...topLines(context.lifecycleGovernance, context.emptySectionNotes.lifecycleGovernance),
    '',
    `Markdown：${paths.markdownPath}`,
    `XLSX：${paths.workbookPath}`,
  ].join('\n');
}
