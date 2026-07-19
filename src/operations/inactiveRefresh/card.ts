import type { FeishuCardPayload } from '../../notify/feishuApp.js';
import { inactiveRefreshPlanConfirmationKey } from './planStore.js';
import type { InactiveRefreshLinkEvidence, InactiveRefreshMetricEvidence, InactiveRefreshNewLinkItem, InactiveRefreshPlan, InactiveRefreshPlanSummary } from './types.js';

function markdown(content: string): Record<string, unknown> {
  return { tag: 'markdown', content };
}

function collapsiblePanel(elementId: string, title: string, elements: Record<string, unknown>[]): Record<string, unknown> {
  return {
    tag: 'collapsible_panel',
    element_id: elementId,
    expanded: false,
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

function groupKey(item: InactiveRefreshNewLinkItem): string {
  return item.sameSkuGroupId ?? item.keyword;
}

function groupChartValues(items: InactiveRefreshNewLinkItem[]): Array<{ label: string; value: number }> {
  const groups = new Map<string, number>();
  for (const item of items) groups.set(groupKey(item), (groups.get(groupKey(item)) ?? 0) + item.count);
  return [...groups.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
}

function groupModificationRatioChart(plan: InactiveRefreshPlan): Record<string, unknown> {
  const values = groupChartValues(plan.newLinkItems);
  return {
    tag: 'chart',
    element_id: 'inactive_refresh_group_modification_ratio_chart',
    aspect_ratio: '4:3',
    height: '240px',
    chart_spec: {
      type: 'pie',
      title: { text: `本次下架补链商品占比（共 ${plan.executableCount} 条）` },
      data: { values: values.length > 0 ? values : [{ label: '无可执行项', value: 1 }] },
      valueField: 'value',
      categoryField: 'label',
      outerRadius: 0.9,
      innerRadius: 0.35,
      legends: { visible: true, orient: 'right' },
      label: { visible: true },
    },
  };
}

function compactSummary(plan: InactiveRefreshPlan, summary: InactiveRefreshPlanSummary): string {
  const executableGroupCount = groupChartValues(plan.newLinkItems).filter((group) => group.value > 0).length;
  return [
    `**审批摘要**：本次只审批下架补链 **${summary.executable}** 条`,
    `涉及商品组 ${executableGroupCount}`,
    `人工复核 ${summary.manualReview}`,
    `排除 ${summary.excluded}`,
  ].join('｜');
}

function groupLines(plan: InactiveRefreshPlan): string {
  const values = groupChartValues(plan.newLinkItems);
  if (values.length === 0) return '本次没有需要下架补链的商品组。';
  return values.map((group) => `- **${group.label}**：本次补链 ${group.value} 条`).join('\n');
}

function sourceLines(plan: InactiveRefreshPlan): string {
  const evidenceSources = plan.evidence?.groups.flatMap((group) => group.source ? [group.source] : []) ?? [];
  if (evidenceSources.length > 0) {
    return evidenceSources.map((source) => `- ${source.groupId}｜安全源 ${source.productId} ${source.productName}｜${metricSummary(source.metrics)}｜${source.reason}`).join('\n');
  }
  if (plan.newLinkItems.length === 0) return '本次没有可执行补链来源。';
  return plan.newLinkItems
    .map((item) => `- ${groupKey(item)}｜复制 ${item.count} 条｜安全源 ${item.sourceProductId} ${item.sourceProductName}`)
    .join('\n');
}

function formatMetric(value: number | undefined, suffix = ''): string {
  if (value === undefined) return '缺失';
  const text = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return `${text}${suffix}`;
}

function formatRate(value: number | undefined): string {
  return value === undefined ? '缺失' : `${(value * 100).toFixed(2)}%`;
}

function metricSummary(metrics: InactiveRefreshMetricEvidence): string {
  return [
    `上线 ${formatMetric(metrics.custodyDays, '天')}`,
    `覆盖 ${metrics.daysCovered}/14天`,
    `曝光 ${formatMetric(metrics.exposure14d)}`,
    `日均曝光 ${formatMetric(metrics.avgExposure14d)}`,
    `访问 ${formatMetric(metrics.visits14d)}`,
    `访问率 ${formatRate(metrics.visitRate)}`,
    `金额 ${formatMetric(metrics.amount14d)}`,
    `订单金额 ${formatMetric(metrics.dashboardAmount14d)}`,
    `访问缺失 ${metrics.missingDashboardDays}天`,
  ].join('｜');
}

function linkEvidenceLines(links: InactiveRefreshLinkEvidence[]): string {
  if (links.length === 0) return '无。';
  return links.map((link) => `- ${link.productId} ${link.productName}｜${link.groupId}｜${link.decision}｜${metricSummary(link.metrics)}｜${link.reason}`).join('\n');
}

function executableEvidenceLines(plan: InactiveRefreshPlan): string {
  const links = plan.evidence?.executableLinks ?? [];
  if (links.length > 0) return linkEvidenceLines(links);
  return plan.delistProductIds.length > 0 ? plan.delistProductIds.map((productId) => `- ${productId}｜可执行｜历史计划未保存指标证据，请重新生成计划查看完整证据。`).join('\n') : '无。';
}

function groupLimitLines(plan: InactiveRefreshPlan): string {
  const groups = plan.evidence?.groups ?? [];
  if (groups.length === 0) return '历史计划未保存同款组上限证据，请重新生成计划查看完整证据。';
  return groups.map((group) => [
    `- ${group.groupId}｜active ${group.activeCount}｜本组上限 ${group.limit}｜本次执行 ${group.selectedProductIds.join('、')}`,
    group.limitExcludedProductIds.length > 0 ? `｜超上限候补 ${group.limitExcludedProductIds.join('、')}` : '',
  ].join('')).join('\n');
}

function exceptionLines(plan: InactiveRefreshPlan, summary: InactiveRefreshPlanSummary): string {
  const lines = [
    summary.manualReview > 0 ? `- 人工复核 ${summary.manualReview} 条：数据缺失、口径冲突或安全源不足，不随本次执行。` : undefined,
    summary.excluded > 0 ? `- 排除 ${summary.excluded} 条：新链保护、转化异常或不满足失活刷新条件。` : undefined,
    plan.skippedGroups.length > 0 ? `- 跳过同款组：${plan.skippedGroups.join('、')}` : undefined,
  ].filter((line): line is string => line !== undefined);
  const manual = plan.evidence?.manualReviewLinks.length ? `\n**人工复核样例**\n${linkEvidenceLines(plan.evidence.manualReviewLinks)}` : '';
  const excluded = plan.evidence?.excludedLinks.length ? `\n**排除样例**\n${linkEvidenceLines(plan.evidence.excludedLinks)}` : '';
  return lines.length > 0 ? `${lines.join('\n')}${manual}${excluded}` : '本次没有需要单独说明的数据异常或未执行原因。';
}

function fixedRules(): string {
  return [
    '**固定规则**',
    '- 链接级负责发现问题，同款组级负责防误伤。',
    '- 新链接上线不足 14 天只观察，不进入失活刷新。',
    '- 高曝光高访问但金额为 0 归为转化异常，不进刷新。',
    '- 上线天数缺失、金额缺失或金额口径冲突进入人工复核。',
    '- 每日全局上限 20 条；同款组 1-3 条最多 1 条，4-10 条最多 2 条，10 条以上最多处理 20%。',
  ].join('\n');
}

function diffSummary(plan: InactiveRefreshPlan): string {
  const refillCount = plan.newLinkItems.reduce((sum, item) => sum + item.count, 0);
  return [
    '**修改 Diff 摘要**',
    `- 预计复制 ${refillCount} 条新链，下架 ${plan.delistProductIds.length} 条原链。`,
    '- 可执行组 active 容量整体保持不下降。',
    '- 人工复核和排除项不进入本次执行。',
  ].join('\n');
}

function actionForm(confirmValue: Record<string, string>, cancelValue: Record<string, string>): Record<string, unknown> {
  return {
    tag: 'column_set',
    element_id: 'inactive_refresh_execute_actions',
    flex_mode: 'stretch',
    horizontal_spacing: '8px',
    columns: [
      {
        tag: 'column',
        width: 'weighted',
        weight: 1,
        vertical_align: 'top',
        elements: [{
          tag: 'button',
          text: { tag: 'plain_text', content: '确认执行失活刷新' },
          type: 'primary',
          name: 'inactive_refresh_execute_submit',
          behaviors: [{ type: 'callback', value: confirmValue }],
        }],
      },
      {
        tag: 'column',
        width: 'weighted',
        weight: 1,
        vertical_align: 'top',
        elements: [{
          tag: 'button',
          text: { tag: 'plain_text', content: '取消' },
          type: 'default',
          name: 'inactive_refresh_execute_cancel_submit',
          behaviors: [{ type: 'callback', value: cancelValue }],
        }],
      },
    ],
  };
}

function detailPanels(plan: InactiveRefreshPlan, summary: InactiveRefreshPlanSummary, lines: string[]): Record<string, unknown>[] {
  return [
    collapsiblePanel('inactive_refresh_groups_summary_standard', '展开：补链商品组', [markdown(groupLines(plan))]),
    collapsiblePanel('inactive_refresh_evidence_summary_standard', '展开：判定证据（核心指标）', [
      markdown(`**候选结构**\n候选 ${summary.candidates} 条｜可执行 ${summary.executable} 条｜人工复核 ${summary.manualReview} 条｜排除 ${summary.excluded} 条`),
      markdown(`**可执行链接判定**\n${executableEvidenceLines(plan)}`),
      markdown(`**补链来源**\n${sourceLines(plan)}`),
      markdown(`**同款组上限**\n${groupLimitLines(plan)}`),
      markdown(`**执行明细**\n${lines.length ? lines.join('\n') : '没有可执行失活刷新项。'}`),
    ]),
    collapsiblePanel('inactive_refresh_exceptions_summary_standard', '展开：数据异常/未执行原因', [markdown(exceptionLines(plan, summary))]),
    collapsiblePanel('inactive_refresh_rules_summary_standard', '展开：固定规则与审计口径', [markdown(fixedRules())]),
  ];
}

export function buildInactiveRefreshPlanCard(input: { plan: InactiveRefreshPlan; planRef: string; summary: InactiveRefreshPlanSummary; lines: string[] }): FeishuCardPayload {
  const confirmationKey = inactiveRefreshPlanConfirmationKey(input.plan);
  const value = {
    action: 'inactive_refresh_execute_select',
    planRef: input.planRef,
    confirmationKey,
  };
  const cancelValue = {
    action: 'inactive_refresh_execute_cancel',
    planRef: input.planRef,
    confirmationKey,
  };
  const elements = [
    markdown(`**失活刷新执行计划**\n日期 ${input.plan.date}\n本卡只审批本次可执行的下架补链；人工复核和排除项不随本次执行。`),
    markdown(compactSummary(input.plan, input.summary)),
    groupModificationRatioChart(input.plan),
    markdown(diffSummary(input.plan)),
    actionForm(value, cancelValue),
    ...detailPanels(input.plan, input.summary, input.lines),
  ];
  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: '失活刷新执行计划' }, template: 'orange' },
    body: { elements },
  };
}
