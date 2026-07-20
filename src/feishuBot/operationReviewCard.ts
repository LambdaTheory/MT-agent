import type { FeishuCardPayload } from '../notify/feishuApp.js';
import type { InactiveRefreshAuditGap, OperationReviewSummary } from '../operations/operationReview.js';

function markdown(content: string): Record<string, unknown> {
  return { tag: 'markdown', content };
}

function collapsiblePanel(elementId: string, title: string, elements: Record<string, unknown>[], expanded = false): Record<string, unknown> {
  return {
    tag: 'collapsible_panel',
    element_id: elementId,
    expanded,
    header: {
      title: { tag: 'plain_text', content: title },
      vertical_align: 'center',
      icon: { tag: 'standard_icon', token: 'down-small-ccm_outlined', size: '16px 16px' },
      icon_position: 'right',
      icon_expanded_angle: -180,
    },
    border: { color: 'grey', corner_radius: '5px' },
    padding: '8px 8px 8px 8px',
    elements,
  };
}

function metricColumn(label: string, value: string, note?: string): Record<string, unknown> {
  return {
    tag: 'column',
    width: 'weighted',
    weight: 1,
    vertical_align: 'top',
    elements: [markdown(`**${label}**\n${value}${note ? `\n<font color=grey>${note}</font>` : ''}`)],
  };
}

function metricRow(review: OperationReviewSummary): Record<string, unknown> {
  const gaps = review.inactiveRefreshAuditGaps.reduce((sum, gap) => sum + gap.missingObservationNewProductIds.length, 0);
  return {
    tag: 'column_set',
    element_id: 'operation_review_summary_metrics',
    flex_mode: 'stretch',
    horizontal_spacing: '8px',
    columns: [
      metricColumn('观察中', `${review.observations.observing} 条`, `过期 ${review.observations.expiredObserving}`),
      metricColumn('改价观察', `${review.observations.byType.price_change} 条`),
      metricColumn('失活刷新观察', `${review.observations.byType.inactive_refresh} 条`),
      metricColumn('待补录新链', `${gaps} 条`, `${review.inactiveRefreshAuditGaps.length} 个审计缺口`),
    ],
  };
}

function healthCharts(review: OperationReviewSummary): Record<string, unknown>[] {
  return [observationTypeChart(review), outcomeHealthChart(review), inactiveRefreshGapCoverageChart(review)];
}

function observationTypeChart(review: OperationReviewSummary): Record<string, unknown> {
  const values = [
    { label: '改价观察', value: review.observations.byType.price_change },
    { label: '失活刷新观察', value: review.observations.byType.inactive_refresh },
    { label: '商品总表新链', value: review.observations.byType.goods_table_new_link },
  ];
  return pieChart('operation_review_observation_type_chart', '观察类型分布', values, '暂无观察记录');
}

function outcomeHealthChart(review: OperationReviewSummary): Record<string, unknown> {
  const date = review.observations.outcomeMetricDate ? `（${review.observations.outcomeMetricDate}，${review.observations.outcomeMetricPeriod.replace('d', '日')}）` : '';
  return barChart('operation_review_outcome_health_chart', `表现健康度${date}`, [
    { label: '表现好', value: review.observations.outcomeHealth.positive },
    { label: '有效曝光', value: review.observations.outcomeHealth.neutral },
    { label: '未达标', value: review.observations.outcomeHealth.negative },
    { label: '数据不足', value: review.observations.outcomeHealth.insufficient_data },
  ], '暂无可评估操作');
}

function inactiveRefreshGapCoverageChart(review: OperationReviewSummary): Record<string, unknown> {
  const copied = review.inactiveRefreshAuditGaps.reduce((sum, gap) => sum + gap.copiedNewProductIds.length, 0);
  const observed = review.inactiveRefreshAuditGaps.reduce((sum, gap) => sum + gap.observedNewProductIds.length, 0);
  const missing = review.inactiveRefreshAuditGaps.reduce((sum, gap) => sum + gap.missingObservationNewProductIds.length, 0);
  return barChart('operation_review_inactive_refresh_gap_chart', '失活刷新补链观察覆盖', [
    { label: '已复制新链', value: copied },
    { label: '已纳入观察', value: observed },
    { label: '待补录观察', value: missing },
  ], '暂无失活刷新补链缺口');
}

function pieChart(elementId: string, title: string, values: Array<{ label: string; value: number }>, emptyLabel: string): Record<string, unknown> {
  const data = values.some((item) => item.value > 0) ? values : [{ label: emptyLabel, value: 1 }];
  return {
    tag: 'chart',
    element_id: elementId,
    aspect_ratio: '4:3',
    height: '220px',
    chart_spec: {
      type: 'pie',
      title: { text: title },
      data: { values: data },
      valueField: 'value',
      categoryField: 'label',
      outerRadius: 0.86,
      innerRadius: 0.38,
      legends: { visible: true, orient: 'right' },
      label: { visible: true },
    },
  };
}

function barChart(elementId: string, title: string, values: Array<{ label: string; value: number }>, emptyLabel: string): Record<string, unknown> {
  const data = values.some((item) => item.value > 0) ? values : [{ label: emptyLabel, value: 0 }];
  return {
    tag: 'chart',
    element_id: elementId,
    aspect_ratio: '4:3',
    height: '220px',
    chart_spec: {
      type: 'bar',
      title: { text: title },
      data: { values: data },
      xField: 'value',
      yField: 'label',
      direction: 'horizontal',
      axes: [{ orient: 'bottom', title: { visible: false } }, { orient: 'left', title: { visible: false } }],
      label: { visible: true },
    },
  };
}

function firstScreen(review: OperationReviewSummary): string {
  const missingCount = review.inactiveRefreshAuditGaps.reduce((sum, gap) => sum + gap.missingObservationNewProductIds.length, 0);
  const status = missingCount > 0 ? `发现 **${missingCount}** 个已复制但未纳入观察的新链。` : '没有发现失活刷新补链观察缺口。';
  return [
    '**运营操作复盘**',
    status,
    '本卡只读取本地 observation 和审计文件，不会复制、下架或改价。',
  ].join('\n');
}

function observationLines(review: OperationReviewSummary): string {
  return [
    `- 总 observation：${review.observations.total}`,
    `- price_change：${review.observations.byType.price_change}`,
    `- inactive_refresh：${review.observations.byType.inactive_refresh}`,
    `- goods_table_new_link：${review.observations.byType.goods_table_new_link}`,
    `- observing：${review.observations.observing}；已到观察期：${review.observations.expiredObserving}`,
    `- 表现健康度：表现好 ${review.observations.outcomeHealth.positive}；有效曝光 ${review.observations.outcomeHealth.neutral}；未达标 ${review.observations.outcomeHealth.negative}；数据不足 ${review.observations.outcomeHealth.insufficient_data}`,
  ].join('\n');
}

function gapSummaryLine(gap: InactiveRefreshAuditGap): string {
  const copied = compactIds(gap.copiedNewProductIds);
  const missing = compactIds(gap.missingObservationNewProductIds);
  const failed = compactIds(gap.failedDelistProductIds);
  return [
    `- ${gap.date ?? gap.planRef}：copy 成功 ${gap.copiedNewProductIds.length} 条，待补录 ${gap.missingObservationNewProductIds.length} 条`,
    `  - 新链：${missing || copied || '无'}`,
    `  - 下架失败：${failed || '无记录'}${gap.firstFailureReason ? `｜${gap.firstFailureReason}` : ''}`,
  ].join('\n');
}

function gapDetailLines(gap: InactiveRefreshAuditGap): string {
  return [
    `**${gap.date ?? gap.planRef}**`,
    `- 审计文件：${gap.auditPath}`,
    `- 已复制新链：${compactIds(gap.copiedNewProductIds, 40) || '无'}`,
    `- 未进入操作观察：${compactIds(gap.missingObservationNewProductIds, 40) || '无'}`,
    `- 已在 observation 中：${compactIds(gap.observedNewProductIds, 40) || '无'}`,
    `- 补链源：${compactIds(gap.sourceProductIds, 20) || '无'}`,
    `- 计划下架旧链：${compactIds(gap.plannedDelistProductIds, 40) || '无'}`,
    `- 已尝试下架：${compactIds(gap.attemptedDelistProductIds, 20) || '无'}`,
    `- 下架失败：${compactIds(gap.failedDelistProductIds, 20) || '无'}`,
    gap.firstFailureReason ? `- 首个失败原因：${gap.firstFailureReason}` : undefined,
  ].filter((line): line is string => Boolean(line)).join('\n');
}

function gapSection(review: OperationReviewSummary): Record<string, unknown> {
  if (review.inactiveRefreshAuditGaps.length === 0) {
    return markdown('**失活刷新审计缺口**\n未发现已复制但未纳入操作观察的新链。');
  }
  const summary = review.inactiveRefreshAuditGaps.slice(0, 5).map(gapSummaryLine).join('\n');
  const details = review.inactiveRefreshAuditGaps.slice(0, 10).map((gap) => markdown(gapDetailLines(gap)));
  return collapsiblePanel('operation_review_inactive_refresh_gaps', '展开：失活刷新补链观察缺口', [markdown(summary), ...details], true);
}

function warningsPanel(review: OperationReviewSummary): Record<string, unknown> | null {
  if (review.warnings.length === 0) return null;
  return collapsiblePanel('operation_review_warnings', '展开：读取告警', [markdown(review.warnings.map((warning) => `- ${warning}`).join('\n'))]);
}

function compactIds(ids: string[], limit = 20): string {
  if (ids.length === 0) return '';
  const shown = ids.slice(0, limit).join('、');
  return ids.length > limit ? `${shown} 等 ${ids.length} 个` : shown;
}

export function buildOperationReviewCard(review: OperationReviewSummary): FeishuCardPayload {
  const hasGaps = review.inactiveRefreshAuditGaps.length > 0;
  const elements = [
    markdown(firstScreen(review)),
    metricRow(review),
    ...healthCharts(review),
    gapSection(review),
    collapsiblePanel('operation_review_observation_counts', '展开：观察记录统计', [markdown(observationLines(review))]),
    markdown(`<font color=grey>生成时间：${review.generatedAt}</font>`),
  ];
  const warnings = warningsPanel(review);
  if (warnings) elements.splice(elements.length - 1, 0, warnings);
  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: '运营操作复盘' }, template: hasGaps ? 'orange' : 'blue' },
    body: { elements },
  };
}

export function formatOperationReviewText(review: OperationReviewSummary): string {
  const missingCount = review.inactiveRefreshAuditGaps.reduce((sum, gap) => sum + gap.missingObservationNewProductIds.length, 0);
  return [
    '运营操作复盘',
    `观察记录：${review.observations.total} 条（改价 ${review.observations.byType.price_change}，失活刷新 ${review.observations.byType.inactive_refresh}，商品总表新链 ${review.observations.byType.goods_table_new_link}）`,
    `表现健康度：表现好 ${review.observations.outcomeHealth.positive} 条，有效曝光 ${review.observations.outcomeHealth.neutral} 条，未达标 ${review.observations.outcomeHealth.negative} 条，数据不足 ${review.observations.outcomeHealth.insufficient_data} 条`,
    `观察中：${review.observations.observing} 条；已到观察期：${review.observations.expiredObserving} 条`,
    missingCount > 0 ? `失活刷新补链观察缺口：${missingCount} 条（见卡片详情）` : '失活刷新补链观察缺口：0 条',
  ].join('\n');
}
