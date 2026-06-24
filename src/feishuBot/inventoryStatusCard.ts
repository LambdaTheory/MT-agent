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
  riskGroupCount: number;
  totalExposure1d: number;
  totalVisits7d: number;
  totalAmount1d: number;
  totalAmount7d: number;
  totalAmount30d: number;
}

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

function percent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

function amount(value: number): string {
  return value.toFixed(0);
}

function ratio(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return numerator / denominator;
}

function contributionText(value: number, total: number): string {
  return percent(ratio(value, total));
}

function sumGroups(snapshot: InventoryStatusSnapshot, pick: (group: InventoryStatusGroupSnapshot) => number): number {
  return snapshot.groups.reduce((sum, group) => sum + pick(group), 0);
}

function snapshotTotals(snapshot: InventoryStatusSnapshot): SnapshotTotals {
  return {
    riskGroupCount: snapshot.groups.filter((group) => group.risks.length > 0 || group.missingMetricLinkCount > 0).length,
    totalExposure1d: sumGroups(snapshot, (group) => group.periods['1d'].exposure),
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
      title: { text: '链接结构分布' },
      data: {
        values: [
          { type: 'active', value: snapshot.registryAuditSummary.activeLinks },
          { type: 'removed', value: snapshot.registryAuditSummary.removedLinks },
          { type: 'unknown', value: snapshot.registryAuditSummary.unknownLinks },
        ],
      },
      valueField: 'value',
      categoryField: 'type',
      outerRadius: 0.9,
      innerRadius: 0.35,
      legends: { visible: true, orient: 'right' },
      label: { visible: true },
    },
  };
}

function topAmountShareChart(snapshot: InventoryStatusSnapshot): CardElement {
  const totalAmount7d = sumGroups(snapshot, (group) => group.periods['7d'].amount);
  const values = snapshot.groups
    .filter((group) => group.periods['7d'].amount > 0)
    .slice()
    .sort((left, right) => right.periods['7d'].amount - left.periods['7d'].amount)
    .slice(0, 5)
    .map((group) => ({
      group: group.groupName,
      value: Number((ratio(group.periods['7d'].amount, totalAmount7d) * 100).toFixed(1)),
    }));

  return {
    tag: 'chart',
    element_id: 'inventory_status_top_amount_chart',
    aspect_ratio: '4:3',
    height: '280px',
    chart_spec: {
      type: 'bar',
      title: { text: '同款组 7日金额占比' },
      data: { values },
      direction: 'horizontal',
      xField: 'value',
      yField: 'group',
      label: { visible: true },
      axes: [
        { orient: 'left', label: { visible: true } },
        { orient: 'bottom', title: { visible: true, text: '占全局 7日金额 %' } },
      ],
    },
  };
}

function periodBlock(label: string, period: InventoryStatusPeriodMetrics): string {
  return [
    `**${label}**`,
    `曝光 ${period.exposure} | 访问 ${period.publicVisits} | 金额 ${amount(period.amount)}`,
    `创建 ${period.createdOrders} | 发货 ${period.shippedOrders} | 曝光-访问率 ${percent(period.exposureVisitRate)} | 访问-下单率 ${percent(period.visitCreatedOrderRate)} | 访问-发货率 ${percent(period.visitShipmentRate)}`,
  ].join('\n');
}

function topGroupLines(result: InventoryStatusOverviewResult): string {
  const totalAmount7d = sumGroups(result.snapshot, (group) => group.periods['7d'].amount);
  const lines = result.snapshot.groups
    .slice()
    .sort((left, right) => right.periods['7d'].amount - left.periods['7d'].amount || right.periods['1d'].amount - left.periods['1d'].amount)
    .slice(0, 5)
    .map((group, index) => {
      const share = contributionText(group.periods['7d'].amount, totalAmount7d);
      return `${index + 1}. ${group.groupName} | 7日金额 ${amount(group.periods['7d'].amount)} | 占全局 ${share} | active ${group.activeLinkCount}/${group.totalLinkCount}`;
    });
  return lines.join('\n') || '暂无同款组快照。';
}

function formatRisk(risk: string): string {
  return risk.replace(/(\d+)\s*条链接无日报数据/g, '$1 条缺日报数据链接');
}

function abnormalGroupLines(result: InventoryStatusOverviewResult): string {
  const lines = result.snapshot.groups
    .filter((group) => group.risks.length > 0 || group.missingMetricLinkCount > 0)
    .slice()
    .sort((left, right) => right.missingMetricLinkCount - left.missingMetricLinkCount || right.risks.length - left.risks.length)
    .slice(0, 5)
    .map((group) => `- ${group.groupName} | 风险 ${group.risks.length} | 缺日报数据链接 ${group.missingMetricLinkCount}`);
  return lines.join('\n') || '暂无异常组。';
}

function topLinkLines(group: InventoryStatusGroupSnapshot): string {
  const lines = group.topLinks.map((link, index) =>
    `${index + 1}. ${link.internalProductId} ${link.productName} | 1日金额 ${amount(link.oneDayAmount)} | 访问 ${link.oneDayPublicVisits}`,
  );
  return lines.join('\n') || '暂无主力链接。';
}

function riskLines(group: InventoryStatusGroupSnapshot): string {
  return group.risks.length > 0 ? group.risks.map((risk) => `- ${formatRisk(risk)}`).join('\n') : '暂无异常提醒。';
}

function matchedByLabel(result: InventoryStatusDetailResult): string {
  if (result.matchedBy === 'internal_id') return `按端内 ID ${result.query} 命中`;
  if (result.matchedBy === 'same_sku_group') return `按同款组 ${result.sameSkuGroupId} 命中`;
  return `按别名 ${result.query} 命中`;
}

function missingReportExplanation(missingCount: number): string {
  if (missingCount <= 0) return '当前同款组链接已在链接档案中，且本次日报都匹配到了经营数据。';
  return `这表示链接已在链接档案中，但本次日报上下文没有匹配到对应经营数据。当前共有 ${missingCount} 条缺日报数据链接；常见原因是当天没抓到、端内 ID / 平台 ID 没映射上，或链接已是 removed / unknown 状态。`;
}

export function formatInventoryStatusOverviewText(result: InventoryStatusOverviewResult): string {
  const activeRatio = contributionText(result.snapshot.summary.activeLinkCount, result.snapshot.summary.totalLinkCount);
  return `库存情况 ${result.snapshot.date}：同款组 ${result.snapshot.summary.sameSkuGroupCount} 个，active 链接 ${result.snapshot.summary.activeLinkCount}/${result.snapshot.summary.totalLinkCount}（${activeRatio}），有数据组 ${result.snapshot.coverage.groupsWithMetrics}/${result.snapshot.summary.sameSkuGroupCount}。`;
}

export function formatInventoryStatusDetailText(result: InventoryStatusDetailResult): string {
  const totals = snapshotTotals(result.snapshot);
  return `库存情况 ${result.group.groupName}：同款组 ${result.sameSkuGroupId}，1日金额 ${amount(result.group.periods['1d'].amount)}，7日金额 ${amount(result.group.periods['7d'].amount)}（贡献 ${contributionText(result.group.periods['7d'].amount, totals.totalAmount7d)}）。`;
}

export function buildInventoryStatusOverviewCard(result: InventoryStatusOverviewResult): FeishuCardPayload {
  const { snapshot } = result;
  const totals = snapshotTotals(snapshot);
  return {
    schema: '2.0',
    header: {
      title: { tag: 'plain_text', content: '库存情况' },
      template: totals.riskGroupCount > 0 ? 'orange' : 'green',
    },
    body: {
      elements: [
        markdown(`快照日期 ${snapshot.date} | 日报口径 ${snapshot.sourceReportDate}`),
        metricRow([
          {
            label: 'active 占比',
            value: percent(ratio(snapshot.summary.activeLinkCount, snapshot.summary.totalLinkCount)),
            note: `${snapshot.summary.activeLinkCount} / ${snapshot.summary.totalLinkCount}`,
          },
          {
            label: '已归组覆盖率',
            value: percent(ratio(snapshot.coverage.groupedLinkCount, snapshot.summary.totalLinkCount)),
            note: `${snapshot.coverage.groupedLinkCount} / ${snapshot.summary.totalLinkCount}`,
          },
          {
            label: '有数据组占比',
            value: percent(ratio(snapshot.coverage.groupsWithMetrics, snapshot.summary.sameSkuGroupCount)),
            note: `${snapshot.coverage.groupsWithMetrics} / ${snapshot.summary.sameSkuGroupCount}`,
          },
          {
            label: '风险组占比',
            value: percent(ratio(totals.riskGroupCount, snapshot.summary.sameSkuGroupCount)),
            note: `${totals.riskGroupCount} / ${snapshot.summary.sameSkuGroupCount}`,
          },
        ], 'inventory_status_overview_health'),
        metricRow([
          { label: '7日总金额', value: amount(totals.totalAmount7d), note: `1日 ${amount(totals.totalAmount1d)}` },
          { label: '7日总访问', value: String(totals.totalVisits7d), note: `1日曝光 ${totals.totalExposure1d}` },
          { label: 'removed 链接', value: String(snapshot.registryAuditSummary.removedLinks), note: `unknown ${snapshot.registryAuditSummary.unknownLinks}` },
          { label: 'override 风险', value: String(snapshot.registryAuditSummary.overrideRiskCount), note: '人工覆盖待核对' },
        ], 'inventory_status_overview_volume'),
        structureChart(snapshot),
        topAmountShareChart(snapshot),
        markdown('**缺日报数据链接是什么意思？**\n链接已在链接档案中，但这一次日报上下文没有匹配到对应经营数据。它不是缺货，更多是在提示抓取、映射或链接状态需要继续核查。'),
        markdown(`**重点同款组**\n${topGroupLines(result)}`),
        markdown(`**异常提醒**\n${abnormalGroupLines(result)}`),
      ],
    },
  };
}

export function buildInventoryStatusDetailCard(result: InventoryStatusDetailResult): FeishuCardPayload {
  const group = result.group;
  const totals = snapshotTotals(result.snapshot);
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
          {
            label: '1日金额',
            value: amount(group.periods['1d'].amount),
            note: `贡献 ${contributionText(group.periods['1d'].amount, totals.totalAmount1d)}`,
          },
          {
            label: '7日金额',
            value: amount(group.periods['7d'].amount),
            note: `贡献 ${contributionText(group.periods['7d'].amount, totals.totalAmount7d)}`,
          },
          {
            label: '30日金额',
            value: amount(group.periods['30d'].amount),
            note: `贡献 ${contributionText(group.periods['30d'].amount, totals.totalAmount30d)}`,
          },
          {
            label: '缺日报数据链接',
            value: String(group.missingMetricLinkCount),
            note: group.missingMetricLinkCount > 0 ? '需检查日报映射' : '本次已匹配',
          },
        ], 'inventory_status_detail_summary'),
        metricRow([
          {
            label: '7日访问贡献',
            value: contributionText(group.periods['7d'].publicVisits, totals.totalVisits7d),
            note: `${group.periods['7d'].publicVisits} / ${totals.totalVisits7d}`,
          },
          {
            label: '7日金额贡献',
            value: contributionText(group.periods['7d'].amount, totals.totalAmount7d),
            note: `${amount(group.periods['7d'].amount)} / ${amount(totals.totalAmount7d)}`,
          },
          {
            label: '7日访问-下单率',
            value: percent(group.periods['7d'].visitCreatedOrderRate),
            note: `创建 ${group.periods['7d'].createdOrders}`,
          },
          {
            label: '7日访问-发货率',
            value: percent(group.periods['7d'].visitShipmentRate),
            note: `发货 ${group.periods['7d'].shippedOrders}`,
          },
        ], 'inventory_status_detail_contribution'),
        markdown(`${periodBlock('1日', group.periods['1d'])}\n\n${periodBlock('7日', group.periods['7d'])}\n\n${periodBlock('30日', group.periods['30d'])}`),
        markdown(`**缺日报数据链接说明**\n${missingReportExplanation(group.missingMetricLinkCount)}`),
        markdown(`**主力链接**\n${topLinkLines(group)}`),
        markdown(`**风险提示**\n${riskLines(group)}`),
      ],
    },
  };
}

export function formatInventoryStatusAmbiguousText(result: InventoryStatusAmbiguousResult): string {
  const lines = result.candidates.map((candidate, index) =>
    `${index + 1}. ${candidate.shortName ?? candidate.sameSkuGroupId ?? '未命名同款组'} | 同款组 ${candidate.sameSkuGroupId ?? '未分组'} | 端内ID ${candidate.internalProductIds.join(', ')}`,
  );
  return [`库存情况需要你澄清：${result.query}`, ...lines].join('\n');
}

export function formatInventoryStatusMissingText(result: Extract<InventoryStatusQueryResult, { status: 'not_found' | 'snapshot_missing' }>): string {
  if (result.status === 'snapshot_missing') return '还没有可用的库存情况快照，请先生成最新日报/快照。';
  return `没有找到 ${result.query} 对应的同款组，请换个叫法或提供端内 ID。`;
}
