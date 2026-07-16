import type { FeishuCardPayload } from '../notify/feishuApp.js';
import type {
  InventoryStatusAmbiguousResult,
  InventoryStatusDetailResult,
  InventoryStatusOverviewResult,
  InventoryStatusQueryResult,
} from '../inventoryStatus/query.js';
import type { InventoryStatusGroupSnapshot, InventoryStatusPeriodMetrics, InventoryStatusSnapshot } from '../inventoryStatus/types.js';

type CardElement = Record<string, unknown>;

interface SnapshotTotals {
  reviewGroupCount: number;
  missingMetricLinkCount: number;
  totalVisits7d: number;
  totalAmount1d: number;
  totalAmount7d: number;
  totalAmount30d: number;
}

const ZH = {
  inventory: '\u5e93\u5b58\u60c5\u51b5',
  overview: '\u94fe\u63a5\u7ef4\u62a4\u6982\u89c8',
  groupedRatio: '\u5df2\u5f52\u7ec4\u94fe\u63a5\u5360\u6bd4',
  metricGroupsRatio: '\u6709\u6570\u636e\u540c\u6b3e\u7ec4\u5360\u6bd4',
  reviewGroupsRatio: '\u5f85\u6838\u67e5\u540c\u6b3e\u7ec4\u5360\u6bd4',
  missingLinks: '\u7f3a\u6570\u636e\u94fe\u63a5',
  focusGroups: '\u91cd\u70b9\u5173\u6ce8\u540c\u6b3e\u7ec4',
  activeLinks: '\u6d3b\u8dc3\u94fe\u63a5',
  amountShare7d: '\u8fd17\u65e5\u91d1\u989d\u5360\u6bd4',
  visitShare7d: '\u8fd17\u65e5\u8bbf\u95ee\u5360\u6bd4',
  category: '\u5206\u7c7b',
  productType: '\u7c7b\u578b',
  explanation: '\u8fd9\u4e9b\u6307\u6807\u53cd\u6620\u7684\u662f\u540c\u6b3e\u7ec4\u7ecf\u8425\u5feb\u7167',
  topLinks: '\u4e3b\u529b\u94fe\u63a5',
  riskTips: '\u98ce\u9669\u63d0\u793a',
  missingExplainTitle: '\u7f3a\u6570\u636e\u94fe\u63a5\u8bf4\u660e',
  ambiguousNeedClarify: '\u9700\u8981\u4f60\u6f84\u6e05',
  notFound: '\u6ca1\u6709\u627e\u5230',
  snapshotMissing: '\u8fd8\u6ca1\u6709\u53ef\u7528\u7684\u5e93\u5b58\u60c5\u51b5\u5feb\u7167\uff0c\u8bf7\u5148\u751f\u6210\u6700\u65b0\u65e5\u62a5/\u5feb\u7167\u3002',
  sameSkuGroup: '\u540c\u6b3e\u7ec4',
  internalId: '\u7aef\u5185 ID',
  periodNote: '\u9ed8\u8ba4\u5c55\u793a active \u53e3\u5f84',
};

function markdown(content: string): CardElement {
  return { tag: 'markdown', content };
}

function metricColumn(label: string, value: string, note?: string): CardElement {
  const content = [label, `**${value}**`, ...(note ? [note] : [])].join('\n');
  return {
    tag: 'column',
    width: 'weighted',
    weight: 1,
    vertical_align: 'top',
    background_style: 'grey',
    padding: '8px',
    elements: [{ tag: 'markdown', content, text_align: 'center' }],
  };
}

function metricRow(metrics: Array<{ label: string; value: string; note?: string }>, elementId: string): CardElement {
  return {
    tag: 'column_set',
    element_id: elementId,
    flex_mode: 'bisect',
    horizontal_spacing: '8px',
    columns: metrics.map((metric) => metricColumn(metric.label, metric.value, metric.note)),
  };
}

function percent(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return '-';
  return `${(value * 100).toFixed(digits)}%`;
}

function amount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '-';
  return value.toFixed(0);
}

function numberText(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '-';
  return String(value);
}

function ratio(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return numerator / denominator;
}

function contributionText(value: number | null, total: number): string {
  if (value === null || !Number.isFinite(value)) return '-';
  return percent(ratio(value, total));
}

function sumGroups(snapshot: InventoryStatusSnapshot, pick: (group: InventoryStatusGroupSnapshot) => number | null): number {
  return snapshot.groups.reduce((sum, group) => {
    const value = pick(group);
    return value === null || !Number.isFinite(value) ? sum : sum + value;
  }, 0);
}

function compareNullableDesc(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right - left;
}

function snapshotTotals(snapshot: InventoryStatusSnapshot): SnapshotTotals {
  return {
    reviewGroupCount: snapshot.groups.filter((group) => group.risks.length > 0 || group.missingMetricLinkCount > 0).length,
    missingMetricLinkCount: sumGroups(snapshot, (group) => group.missingMetricLinkCount),
    totalVisits7d: sumGroups(snapshot, (group) => group.periods['7d'].publicVisits),
    totalAmount1d: sumGroups(snapshot, (group) => group.periods['1d'].amount),
    totalAmount7d: sumGroups(snapshot, (group) => group.periods['7d'].amount),
    totalAmount30d: sumGroups(snapshot, (group) => group.periods['30d'].amount),
  };
}

function structureChart(snapshot: InventoryStatusSnapshot): CardElement {
  return {
    tag: 'chart',
    element_id: 'inventory_status_structure_chart',
    aspect_ratio: '4:3',
    height: '260px',
    chart_spec: {
      type: 'pie',
      title: { text: '\u94fe\u63a5\u6863\u6848\u72b6\u6001\u5206\u5e03' },
      data: {
        values: [
          { label: '\u5728\u552e', value: snapshot.registryAuditSummary.onSaleLinks },
          { label: '\u5df2\u4e0b\u67b6', value: snapshot.registryAuditSummary.delistedLinks },
          { label: '\u94fe\u63a5\u4e0d\u5b58\u5728', value: snapshot.registryAuditSummary.goneLinks },
          { label: '\u5f85\u786e\u8ba4', value: snapshot.registryAuditSummary.unknownLinks },
        ],
      },
      valueField: 'value',
      categoryField: 'label',
      outerRadius: 0.9,
      innerRadius: 0.35,
      legends: { visible: true, orient: 'right' },
      label: { visible: true },
    },
  };
}

function periodBlock(label: string, period: InventoryStatusPeriodMetrics): string {
  return [
    `**${label}**`,
    `\u66dd\u5149 ${numberText(period.exposure)} | \u8bbf\u95ee ${numberText(period.publicVisits)} | \u91d1\u989d ${amount(period.amount)}`,
    `\u521b\u5efa ${numberText(period.createdOrders)} | \u53d1\u8d27 ${numberText(period.shippedOrders)} | \u66dd\u5149-\u8bbf\u95ee\u7387 ${percent(period.exposureVisitRate)} | \u8bbf\u95ee-\u4e0b\u5355\u7387 ${percent(period.visitCreatedOrderRate)} | \u8bbf\u95ee-\u53d1\u8d27\u7387 ${percent(period.visitShipmentRate)}`,
  ].join('\n');
}

function hasMissingOrderMetrics(period: InventoryStatusPeriodMetrics): boolean {
  return period.createdOrders === null || period.shippedOrders === null || period.visitCreatedOrderRate === null || period.visitShipmentRate === null;
}

function sourceExplanation(group: InventoryStatusGroupSnapshot): string | null {
  const hasAmount = Object.values(group.periods).some((period) => period.amount !== null && Number.isFinite(period.amount));
  const missingOrderMetrics = Object.values(group.periods).some(hasMissingOrderMetrics);
  if (!hasAmount || !missingOrderMetrics) return null;
  return '**数据口径**\n金额来自公域曝光侧；商品级创建/发货来自访问页后链路。本次未抓到商品级后链路数据的周期会显示 `-`，不能按 0 单理解。';
}

function focusGroupLines(result: InventoryStatusOverviewResult): string {
  const lines = result.snapshot.groups
    .slice()
    .sort((left, right) =>
      right.missingMetricLinkCount - left.missingMetricLinkCount
      || compareNullableDesc(left.periods['7d'].amount, right.periods['7d'].amount),
    )
    .slice(0, 5)
    .map((group, index) => `${index + 1}. ${group.groupName} | active ${group.activeLinkCount}/${group.totalLinkCount} | ${ZH.missingLinks} ${group.missingMetricLinkCount}`);
  return lines.join('\n') || '\u6682\u65e0\u9700\u8981\u5173\u6ce8\u7684\u540c\u6b3e\u7ec4\u3002';
}

function topLinkLines(group: InventoryStatusGroupSnapshot): string {
  const lines = group.topLinks.map((link, index) =>
    `${index + 1}. ${link.internalProductId} ${link.productName} | 1\u65e5\u91d1\u989d ${amount(link.oneDayAmount)} | \u8bbf\u95ee ${numberText(link.oneDayPublicVisits)}`,
  );
  return lines.join('\n') || '\u6682\u65e0\u4e3b\u529b\u94fe\u63a5\u3002';
}

function riskLines(group: InventoryStatusGroupSnapshot): string {
  return group.risks.length > 0 ? group.risks.map((risk) => `- ${risk}`).join('\n') : '\u6682\u65e0\u5f02\u5e38\u63d0\u9192\u3002';
}

function matchedByLabel(result: InventoryStatusDetailResult): string {
  if (result.matchedBy === 'internal_id') return `\u6309${ZH.internalId} ${result.query} \u547d\u4e2d`;
  if (result.matchedBy === 'same_sku_group') return `\u6309${ZH.sameSkuGroup} ${result.sameSkuGroupId} \u547d\u4e2d`;
  return `\u6309\u522b\u540d ${result.query} \u547d\u4e2d`;
}

function missingReportExplanation(missingCount: number): string {
  if (missingCount <= 0) return '\u5f53\u524d\u540c\u6b3e\u7ec4\u91cc\u7684\u94fe\u63a5\u90fd\u5df2\u7ecf\u5339\u914d\u5230\u672c\u6b21\u65e5\u62a5\u5feb\u7167\uff0c\u6ca1\u6709\u7f3a\u6570\u636e\u94fe\u63a5\u3002';
  return `\u5f53\u524d\u5171\u6709 ${missingCount} \u6761${ZH.missingLinks}\uff0c\u8868\u793a\u94fe\u63a5\u5df2\u5728\u6863\u6848\u91cc\uff0c\u4f46\u8fd9\u6b21\u65e5\u62a5\u4e0a\u4e0b\u6587\u6ca1\u6709\u5339\u914d\u5230\u5bf9\u5e94\u7ecf\u8425\u6570\u636e\uff0c\u901a\u5e38\u9700\u8981\u7ee7\u7eed\u6838\u5bf9\u6293\u53d6\u3001\u6620\u5c04\u6216\u94fe\u63a5\u72b6\u6001\u3002`;
}

export function formatInventoryStatusOverviewText(result: InventoryStatusOverviewResult): string {
  const totals = snapshotTotals(result.snapshot);
  return `${ZH.inventory} ${result.snapshot.date}\uff1a${ZH.sameSkuGroup} ${result.snapshot.summary.sameSkuGroupCount} \u4e2a\uff0c${ZH.groupedRatio} ${result.snapshot.coverage.groupedLinkCount}/${result.snapshot.summary.totalLinkCount}\uff0c${ZH.reviewGroupsRatio} ${totals.reviewGroupCount}/${result.snapshot.summary.sameSkuGroupCount}\u3002`;
}

export function formatInventoryStatusDetailText(result: InventoryStatusDetailResult): string {
  const totals = snapshotTotals(result.snapshot);
  return `${ZH.inventory} ${result.group.groupName}\uff1a${ZH.sameSkuGroup} ${result.sameSkuGroupId}\uff0c${ZH.amountShare7d} ${contributionText(result.group.periods['7d'].amount, totals.totalAmount7d)}\uff0c${ZH.missingLinks} ${result.group.missingMetricLinkCount}\u3002`;
}

export function buildInventoryStatusOverviewCard(result: InventoryStatusOverviewResult): FeishuCardPayload {
  const { snapshot } = result;
  const totals = snapshotTotals(snapshot);
  return {
    schema: '2.0',
    header: {
      title: { tag: 'plain_text', content: ZH.inventory },
      template: totals.reviewGroupCount > 0 ? 'orange' : 'green',
    },
    body: {
      elements: [
        markdown(`\u5feb\u7167\u65e5\u671f ${snapshot.date} | \u65e5\u62a5\u53e3\u5f84 ${snapshot.sourceReportDate}`),
        markdown(`**${ZH.overview}**`),
        metricRow([
          {
            label: ZH.groupedRatio,
            value: percent(ratio(snapshot.coverage.groupedLinkCount, snapshot.summary.totalLinkCount)),
            note: `${snapshot.coverage.groupedLinkCount} / ${snapshot.summary.totalLinkCount}`,
          },
          {
            label: ZH.metricGroupsRatio,
            value: percent(ratio(snapshot.coverage.groupsWithMetrics, snapshot.summary.sameSkuGroupCount)),
            note: `${snapshot.coverage.groupsWithMetrics} / ${snapshot.summary.sameSkuGroupCount}`,
          },
          {
            label: ZH.reviewGroupsRatio,
            value: percent(ratio(totals.reviewGroupCount, snapshot.summary.sameSkuGroupCount)),
            note: `${totals.reviewGroupCount} / ${snapshot.summary.sameSkuGroupCount}`,
          },
          {
            label: ZH.missingLinks,
            value: String(totals.missingMetricLinkCount),
            note: totals.missingMetricLinkCount > 0 ? '\u9700\u7ee7\u7eed\u6838\u5bf9\u65e5\u62a5\u6620\u5c04' : '\u672c\u6b21\u5df2\u5339\u914d\u9f50',
          },
        ], 'inventory_status_overview_maintenance'),
        metricRow([
          {
            label: '\u5728\u552e\u94fe\u63a5',
            value: String(snapshot.registryAuditSummary.onSaleLinks),
            note: `\u603b\u94fe\u63a5 ${snapshot.registryAuditSummary.totalLinks}`,
          },
          {
            label: '\u5df2\u4e0b\u67b6\u94fe\u63a5',
            value: String(snapshot.registryAuditSummary.delistedLinks),
            note: '\u4e0a\u67b6\u540e\u53ef\u6062\u590d\u64cd\u4f5c',
          },
          {
            label: '\u94fe\u63a5\u4e0d\u5b58\u5728',
            value: String(snapshot.registryAuditSummary.goneLinks),
            note: '\u5546\u54c1\u603b\u8868\u5df2\u7f3a\u5931',
          },
          {
            label: '\u5f85\u786e\u8ba4\u94fe\u63a5',
            value: String(snapshot.registryAuditSummary.unknownLinks),
            note: `\u9700\u786e\u8ba4\uff0c\u8986\u76d6\u89c4\u5219\u98ce\u9669 ${snapshot.registryAuditSummary.overrideRiskCount}`,
          },
        ], 'inventory_status_overview_registry'),
        structureChart(snapshot),
        markdown(`**\u6709\u6570\u636e${ZH.sameSkuGroup}\u662f\u4ec0\u4e48\u610f\u601d\uff1f**\n\u8868\u793a\u8fd9\u4e2a${ZH.sameSkuGroup}\u81f3\u5c11\u6709\u4e00\u6761\u94fe\u63a5\u6210\u529f\u547d\u4e2d\u4e86\u672c\u6b21\u65e5\u62a5\u5feb\u7167\uff0c\u6240\u4ee5\u540e\u7eed\u53ef\u4ee5\u7ee7\u7eed\u770b\u7ec4\u7ea7\u7ecf\u8425\u6570\u636e\u3002`),
        markdown(`**${ZH.missingLinks}\u662f\u4ec0\u4e48\u610f\u601d\uff1f**\n\u8868\u793a\u94fe\u63a5\u5df2\u7ecf\u5728\u94fe\u63a5\u6863\u6848\u91cc\uff0c\u4f46\u8fd9\u6b21\u65e5\u62a5\u5feb\u7167\u6ca1\u6709\u5339\u914d\u5230\u5bf9\u5e94\u7ecf\u8425\u6570\u636e\u3002\u5b83\u4e0d\u662f\u201c\u7f3a\u8d27\u201d\uff0c\u800c\u662f\u63d0\u793a\u6211\u4eec\u7ee7\u7eed\u6838\u5bf9\u6293\u53d6\u3001\u6620\u5c04\u6216\u94fe\u63a5\u72b6\u6001\u3002`),
        markdown(`**${ZH.focusGroups}**\n${focusGroupLines(result)}`),
      ],
    },
  };
}

export function buildInventoryStatusDetailCard(result: InventoryStatusDetailResult): FeishuCardPayload {
  const group = result.group;
  const totals = snapshotTotals(result.snapshot);
  const sourceNote = sourceExplanation(group);
  return {
    schema: '2.0',
    header: {
      title: { tag: 'plain_text', content: `${ZH.inventory} ? ${group.groupName}` },
      template: group.risks.length > 0 || group.missingMetricLinkCount > 0 ? 'orange' : 'blue',
    },
    body: {
      elements: [
        markdown(`${matchedByLabel(result)} | ${ZH.sameSkuGroup} ${result.sameSkuGroupId}`),
        markdown([
          group.categoryName ? `${ZH.category} ${group.categoryName}` : null,
          group.productType ? `${ZH.productType} ${group.productType}` : null,
          `active ${group.activeLinkCount}/${group.totalLinkCount}`,
        ].filter(Boolean).join(' | ')),
        metricRow([
          {
            label: ZH.amountShare7d,
            value: contributionText(group.periods['7d'].amount, totals.totalAmount7d),
            note: `${amount(group.periods['7d'].amount)} / ${amount(totals.totalAmount7d)}`,
          },
          {
            label: ZH.visitShare7d,
            value: contributionText(group.periods['7d'].publicVisits, totals.totalVisits7d),
            note: `${numberText(group.periods['7d'].publicVisits)} / ${numberText(totals.totalVisits7d)}`,
          },
          {
            label: ZH.missingLinks,
            value: String(group.missingMetricLinkCount),
            note: group.missingMetricLinkCount > 0 ? '\u5efa\u8bae\u6838\u5bf9\u65e5\u62a5\u6620\u5c04' : '\u672c\u6b21\u5df2\u5339\u914d\u9f50',
          },
          {
            label: ZH.activeLinks,
            value: `${group.activeLinkCount}/${group.totalLinkCount}`,
            note: ZH.periodNote,
          },
        ], 'inventory_status_detail_summary'),
        metricRow([
          {
            label: '1\u65e5\u91d1\u989d',
            value: amount(group.periods['1d'].amount),
            note: `\u8d21\u732e ${contributionText(group.periods['1d'].amount, totals.totalAmount1d)}`,
          },
          {
            label: '7\u65e5\u91d1\u989d',
            value: amount(group.periods['7d'].amount),
            note: `\u8bbf\u95ee-\u4e0b\u5355\u7387 ${percent(group.periods['7d'].visitCreatedOrderRate)}`,
          },
          {
            label: '30\u65e5\u91d1\u989d',
            value: amount(group.periods['30d'].amount),
            note: `\u8d21\u732e ${contributionText(group.periods['30d'].amount, totals.totalAmount30d)}`,
          },
          {
            label: '7\u65e5\u8bbf\u95ee-\u53d1\u8d27\u7387',
            value: percent(group.periods['7d'].visitShipmentRate),
            note: `\u53d1\u8d27 ${numberText(group.periods['7d'].shippedOrders)}`,
          },
        ], 'inventory_status_detail_periods'),
        ...(sourceNote ? [markdown(sourceNote)] : []),
        markdown(`**\u8bf4\u660e**\n${ZH.explanation}\uff0c\u4e0d\u662f\u5355\u6761\u94fe\u63a5\u7ed3\u8bba\uff1b\u5b83\u66f4\u9002\u5408\u5e2e\u52a9\u6211\u4eec\u5224\u65ad\u8fd9\u4e2a\u7ec4\u5f53\u524d\u6709\u6ca1\u6709\u7f3a\u6863\u3001\u7f3a\u6570\u6216\u9700\u8981\u7ee7\u7eed\u62c6\u5206\u7ef4\u62a4\u3002`),
        markdown(`${periodBlock('1\u65e5', group.periods['1d'])}\n\n${periodBlock('7\u65e5', group.periods['7d'])}\n\n${periodBlock('30\u65e5', group.periods['30d'])}`),
        markdown(`**${ZH.missingExplainTitle}**\n${missingReportExplanation(group.missingMetricLinkCount)}`),
        markdown(`**${ZH.topLinks}**\n${topLinkLines(group)}`),
        markdown(`**${ZH.riskTips}**\n${riskLines(group)}`),
      ],
    },
  };
}

export function formatInventoryStatusAmbiguousText(result: InventoryStatusAmbiguousResult): string {
  const lines = result.candidates.map((candidate, index) =>
    `${index + 1}. ${candidate.shortName ?? '\u672a\u547d\u540d\u540c\u6b3e\u7ec4'} | ${ZH.sameSkuGroup} ${candidate.sameSkuGroupId ?? '\u672a\u5206\u7ec4'} | \u7aef\u5185ID ${candidate.internalProductIds.join(', ')}`,
  );
  return [`${ZH.inventory}${ZH.ambiguousNeedClarify}\uff1a${result.query}`, ...lines].join('\n');
}

export function formatInventoryStatusMissingText(result: Extract<InventoryStatusQueryResult, { status: 'not_found' | 'snapshot_missing' }>): string {
  if (result.status === 'snapshot_missing') return ZH.snapshotMissing;
  return `${ZH.notFound} ${result.query} \u5bf9\u5e94\u7684${ZH.sameSkuGroup}\uff0c\u8bf7\u6362\u4e2a\u53eb\u6cd5\u6216\u63d0\u4f9b${ZH.internalId}\u3002`;
}
