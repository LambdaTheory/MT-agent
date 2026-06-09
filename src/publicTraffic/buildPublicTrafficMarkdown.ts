type SectionItem = { identifier: string; action: string; reason: string };
type Context = { date: string; exposureOptimization: SectionItem[]; conversionOptimization: SectionItem[]; newProductObservation: SectionItem[]; lifecycleGovernance: SectionItem[] };

function linesFor(items: SectionItem[]): string[] {
  return items.length > 0 ? items.map((item, index) => `${index + 1}. ${item.identifier}：${item.action}。原因：${item.reason}`) : ['无'];
}

export function buildPublicTrafficMarkdown(context: Context): string {
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
