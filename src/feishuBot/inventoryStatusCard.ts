import type { FeishuCardPayload } from '../notify/feishuApp.js';
import type {
  InventoryStatusAmbiguousResult,
  InventoryStatusDetailResult,
  InventoryStatusOverviewResult,
  InventoryStatusQueryResult,
} from '../inventoryStatus/query.js';
import type { InventoryStatusGroupSnapshot, InventoryStatusPeriodMetrics } from '../inventoryStatus/types.js';

function markdown(content: string): Record<string, unknown> {
  return { tag: 'markdown', content };
}

function metricColumn(label: string, value: string): Record<string, unknown> {
  return {
    tag: 'column',
    width: 'weighted',
    weight: 1,
    vertical_align: 'top',
    background_style: 'grey',
    padding: '8px',
    elements: [{ tag: 'markdown', content: `${label}\n**${value}**`, text_align: 'center' }],
  };
}

function metricRow(metrics: Array<[string, string]>, elementId: string): Record<string, unknown> {
  return {
    tag: 'column_set',
    element_id: elementId,
    flex_mode: 'bisect',
    horizontal_spacing: '8px',
    columns: metrics.map(([label, value]) => metricColumn(label, value)),
  };
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function amount(value: number): string {
  return value.toFixed(0);
}

function periodBlock(label: string, period: InventoryStatusPeriodMetrics): string {
  return [
    `**${label}**`,
    `曝光 ${period.exposure} | 访问 ${period.publicVisits} | 金额 ${amount(period.amount)}`,
    `创建 ${period.createdOrders} | 发货 ${period.shippedOrders} | 曝光访率 ${percent(period.exposureVisitRate)}`,
  ].join('\n');
}

function topGroupLines(result: InventoryStatusOverviewResult): string {
  return result.snapshot.groups
    .slice()
    .sort((left, right) => right.periods['7d'].amount - left.periods['7d'].amount || right.periods['1d'].amount - left.periods['1d'].amount)
    .slice(0, 5)
    .map((group, index) => `${index + 1}. ${group.groupName} | 7日金额 ${amount(group.periods['7d'].amount)} | active ${group.activeLinkCount}/${group.totalLinkCount}`)
    .join('\n') || '暂无同款组快照';
}

function abnormalGroupLines(result: InventoryStatusOverviewResult): string {
  return result.snapshot.groups
    .filter((group) => group.risks.length > 0 || group.missingMetricLinkCount > 0)
    .slice()
    .sort((left, right) => right.missingMetricLinkCount - left.missingMetricLinkCount || right.risks.length - left.risks.length)
    .slice(0, 5)
    .map((group) => `- ${group.groupName} | 风险 ${group.risks.length} | 缺数据链接 ${group.missingMetricLinkCount}`)
    .join('\n') || '暂无异常组';
}

function topLinkLines(group: InventoryStatusGroupSnapshot): string {
  return group.topLinks
    .map((link, index) => `${index + 1}. ${link.internalProductId} ${link.productName} | 1日金额 ${amount(link.oneDayAmount)} | 访问 ${link.oneDayPublicVisits}`)
    .join('\n') || '暂无主力链接';
}

function riskLines(group: InventoryStatusGroupSnapshot): string {
  return group.risks.length > 0 ? group.risks.map((risk) => `- ${risk}`).join('\n') : '暂无异常提醒';
}

function matchedByLabel(result: InventoryStatusDetailResult): string {
  if (result.matchedBy === 'internal_id') return `按端内 ID ${result.query} 命中`;
  if (result.matchedBy === 'same_sku_group') return `按同款组 ${result.sameSkuGroupId} 命中`;
  return `按别名 ${result.query} 命中`;
}

export function formatInventoryStatusOverviewText(result: InventoryStatusOverviewResult): string {
  return `库存情况 ${result.snapshot.date}：同款组 ${result.snapshot.summary.sameSkuGroupCount} 个，active 链接 ${result.snapshot.summary.activeLinkCount}/${result.snapshot.summary.totalLinkCount}，有数据组 ${result.snapshot.coverage.groupsWithMetrics} 个。`;
}

export function formatInventoryStatusDetailText(result: InventoryStatusDetailResult): string {
  return `库存情况 ${result.group.groupName}：同款组 ${result.sameSkuGroupId}，1日金额 ${amount(result.group.periods['1d'].amount)}，7日金额 ${amount(result.group.periods['7d'].amount)}。`;
}

export function buildInventoryStatusOverviewCard(result: InventoryStatusOverviewResult): FeishuCardPayload {
  return {
    schema: '2.0',
    header: {
      title: { tag: 'plain_text', content: '库存情况' },
      template: result.snapshot.groups.some((group) => group.risks.length > 0) ? 'orange' : 'green',
    },
    body: {
      elements: [
        markdown(`快照日期 ${result.snapshot.date} | 日报口径 ${result.snapshot.sourceReportDate}`),
        metricRow([
          ['同款组', String(result.snapshot.summary.sameSkuGroupCount)],
          ['active 链接', String(result.snapshot.summary.activeLinkCount)],
          ['总链接', String(result.snapshot.summary.totalLinkCount)],
          ['有数据组', String(result.snapshot.coverage.groupsWithMetrics)],
        ], 'inventory_status_overview_summary'),
        metricRow([
          ['已归组', String(result.snapshot.coverage.groupedLinkCount)],
          ['未归组', String(result.snapshot.coverage.ungroupedLinkCount)],
          ['removed', String(result.snapshot.registryAuditSummary.removedLinks)],
          ['override 风险', String(result.snapshot.registryAuditSummary.overrideRiskCount)],
        ], 'inventory_status_overview_coverage'),
        markdown(`**重点同款组**\n${topGroupLines(result)}`),
        markdown(`**异常提醒**\n${abnormalGroupLines(result)}`),
      ],
    },
  };
}

export function buildInventoryStatusDetailCard(result: InventoryStatusDetailResult): FeishuCardPayload {
  const group = result.group;
  return {
    schema: '2.0',
    header: {
      title: { tag: 'plain_text', content: `库存情况 · ${group.groupName}` },
      template: group.risks.length > 0 ? 'orange' : 'blue',
    },
    body: {
      elements: [
        markdown(`${matchedByLabel(result)} | 同款组 ${result.sameSkuGroupId}`),
        markdown([
          group.categoryName ? `分类 ${group.categoryName}` : null,
          group.productType ? `类型 ${group.productType}` : null,
          `active ${group.activeLinkCount}/${group.totalLinkCount}`,
        ].filter(Boolean).join(' | ')),
        metricRow([
          ['1日金额', amount(group.periods['1d'].amount)],
          ['7日金额', amount(group.periods['7d'].amount)],
          ['30日金额', amount(group.periods['30d'].amount)],
          ['缺数据链接', String(group.missingMetricLinkCount)],
        ], 'inventory_status_detail_summary'),
        markdown(`${periodBlock('1日', group.periods['1d'])}\n\n${periodBlock('7日', group.periods['7d'])}\n\n${periodBlock('30日', group.periods['30d'])}`),
        markdown(`**主力链接**\n${topLinkLines(group)}`),
        markdown(`**风险提示**\n${riskLines(group)}`),
      ],
    },
  };
}

export function formatInventoryStatusAmbiguousText(result: InventoryStatusAmbiguousResult): string {
  const lines = result.candidates
    .map((candidate, index) => `${index + 1}. ${candidate.shortName ?? candidate.sameSkuGroupId ?? '未命名同款组'} | 同款组 ${candidate.sameSkuGroupId ?? '未分组'} | 端内ID ${candidate.internalProductIds.join(', ')}`);
  return [`库存情况需要你澄清：${result.query}`, ...lines].join('\n');
}

export function formatInventoryStatusMissingText(result: Extract<InventoryStatusQueryResult, { status: 'not_found' | 'snapshot_missing' }>): string {
  if (result.status === 'snapshot_missing') return '还没有可用的库存情况快照，请先生成最新日报/快照。';
  return `没有找到 ${result.query} 对应的同款组，请换个叫法或提供端内 ID。`;
}
