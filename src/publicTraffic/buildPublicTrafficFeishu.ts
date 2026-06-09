import type { ExposureOverviewMetric, PublicTrafficReportContext, PublicTrafficReportPaths, PublicTrafficReportSectionItem } from './types.js';

function topLines(items: PublicTrafficReportSectionItem[], limit = 5): string[] {
  return items.length > 0 ? items.slice(0, limit).map((item, index) => `${index + 1}. ${item.identifier}｜${item.reason}`) : ['无'];
}

export function buildPublicTrafficFeishuText(context: PublicTrafficReportContext, paths: PublicTrafficReportPaths): string {
  const fallback: Omit<ExposureOverviewMetric, 'period'> = { exposure: 0, visits: 0, conversionRate: 0, amount: 0 };
  const one = context.overview.find((item) => item.period === '1d') ?? fallback;
  return [
    `公域流量日报 ${context.date}`,
    '',
    '今日总览',
    `曝光：${one.exposure}`,
    `访问：${one.visits}`,
    `转化率：${one.conversionRate}%`,
    `金额：¥${one.amount.toFixed(2)}`,
    '',
    '模块数量',
    `曝光优化：${context.exposureOptimization.length}个`,
    `转化优化：${context.conversionOptimization.length}个`,
    `新品观察：${context.newProductObservation.length}个`,
    `生命周期治理：${context.lifecycleGovernance.length}个`,
    '',
    '曝光优化 Top5',
    ...topLines(context.exposureOptimization),
    '',
    '转化优化 Top5',
    ...topLines(context.conversionOptimization),
    '',
    `Markdown：${paths.markdownPath}`,
    `XLSX：${paths.workbookPath}`,
  ].join('\n');
}
