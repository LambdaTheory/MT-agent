import type { DailyReportData, RecommendationAction } from '../domain/types.js';

const ACTIONS: RecommendationAction[] = ['疑似失活', '疑似价格问题', '建议补链', '建议加曝光', '高曝光低转化', '稳定优质', '继续观察'];

function countAction(data: DailyReportData, action: RecommendationAction): number {
  return data.analysisRows.filter((row) => row.action === action).length;
}

function countUnmapped(data: DailyReportData): number {
  return data.analysisRows.filter((row) => row.mappingStatus !== 'mapped').length;
}

function productIdentifier(row: { platformProductId: string; internalProductId?: string; mappingStatus?: string }): string {
  if (row.mappingStatus === 'mapped' && row.internalProductId) {
    return `端内ID ${row.internalProductId}`;
  }

  return `平台商品ID ${row.platformProductId}`;
}

function recommendationLine(index: number, row: { platformProductId: string; internalProductId?: string; mappingStatus?: string; action: string; reason: string }): string {
  return `${index + 1}. ${productIdentifier(row)}：建议动作=${row.action}。原因：${row.reason}`;
}

export function buildMarkdownReport(data: DailyReportData): string {
  const pricingProblems = data.analysisRows.filter((row) => row.action === '疑似价格问题' || row.action === '高曝光低转化').slice(0, 10);
  const opportunities = data.analysisRows.filter((row) => row.action === '建议补链' || row.action === '建议加曝光').slice(0, 10);
  const inactiveRisks = data.analysisRows.filter((row) => row.action === '疑似失活').slice(0, 10);
  const stableProducts = data.analysisRows.filter((row) => row.action === '稳定优质').slice(0, 10);
  const reviewItems = data.analysisRows.filter((row) => row.confidence === '低').slice(0, 10);
  const lines = [
    `# MT每日运营日报 ${data.date}`,
    '',
    '## 今日重点',
    data.incomplete ? '- 抓取状态：存在不完整周期，请先查看抓取状态。' : '- 抓取状态：完整。',
    `- 商品ID未映射：${countUnmapped(data)}`,
    ...ACTIONS.map((action) => `- ${action}：${countAction(data, action)}`),
    '',
    '## 优先处理：价格/转化问题',
    ...(pricingProblems.length > 0
      ? pricingProblems.map((row, index) => recommendationLine(index, row))
      : ['无价格/转化问题商品。']),
    '',
    '## 增长机会：补链/加曝光',
    ...(opportunities.length > 0
      ? opportunities.map((row, index) => recommendationLine(index, row))
      : ['无高机会商品。']),
    '',
    '## 下架观察：疑似失活',
    ...(inactiveRisks.length > 0
      ? inactiveRisks.map((row, index) => recommendationLine(index, row))
      : ['无疑似失活商品。']),
    '',
    '## 稳定优质商品',
    ...(stableProducts.length > 0
      ? stableProducts.map((row, index) => recommendationLine(index, row))
      : ['无稳定优质重点商品。']),
    '',
    '## 需要人工复核',
    ...(reviewItems.length > 0
      ? reviewItems.map((row, index) => recommendationLine(index, row))
      : ['无低置信度重点商品。']),
    '',
    '## 抓取状态',
    ...data.rawTables.map(
      (table) =>
        `- ${table.period}：页数${table.collection.pageCount}，行数${table.collection.rowCount}，去重${table.collection.dedupedRowCount}，完整=${table.collection.complete}，页大小回退=${table.collection.pageSizeFallback}`,
    ),
    '',
  ];

  return lines.join('\n');
}
