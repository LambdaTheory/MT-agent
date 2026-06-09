import type { PublicTrafficReportContext, PublicTrafficReportSectionItem } from './types.js';

function linesFor(items: PublicTrafficReportSectionItem[]): string[] {
  return items.length > 0 ? items.map((item, index) => `${index + 1}. ${item.identifier}：${item.action}。原因：${item.reason}`) : ['无'];
}

export function buildPublicTrafficMarkdown(context: PublicTrafficReportContext): string {
  return [
    `# 公域流量日报 ${context.date}`,
    '',
    '## 曝光优化',
    ...linesFor(context.exposureOptimization),
    '',
    '## 转化优化',
    ...linesFor(context.conversionOptimization),
    '',
    '## 新品观察',
    ...linesFor(context.newProductObservation),
    '',
    '## 生命周期治理',
    ...linesFor(context.lifecycleGovernance),
    '',
  ].join('\n');
}
