import type { FeishuCardPayload } from '../notify/feishuApp.js';

type PreviewKind = 'summary_standard';

export interface CandidateGroup {
  name: string;
  activeBefore: number;
  executable: number;
  manualReview: number;
  excluded: number;
  activeAfter: number;
  limit: string;
  reason: string;
}

export interface CandidateLink {
  productId: string;
  groupName: string;
  ageDays: number;
  avgExposure14d?: number;
  visits14d?: number;
  visitRate?: number;
  exposureAmount14d?: number;
  visitOrderAmount14d?: number;
  decision: string;
  reason: string;
}

export interface PreviewPlan {
  date: string;
  runId: string;
  totals: {
    candidates: number;
    executable: number;
    lowRisk: number;
    manualReview: number;
    excluded: number;
    groups: number;
  };
  reasonBuckets: Array<{ label: string; count: number }>;
  groups: CandidateGroup[];
  links: CandidateLink[];
  exceptions: Array<{ label: string; count: number; action: string; examples: string[] }>;
}

export interface InactiveRefreshPreviewDeck {
  date: string;
  cards: FeishuCardPayload[];
  fallbackTexts: string[];
}

function markdown(content: string): Record<string, unknown> {
  return { tag: 'markdown', content };
}

function money(value: number | undefined): string {
  return value === undefined ? '缺失' : `¥${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;
}

function rate(value: number | undefined): string {
  return value === undefined ? '缺失' : `${(value * 100).toFixed(2)}%`;
}

function noopButton(label: string, kind: PreviewKind, action: string, type: 'primary' | 'default' = 'default'): Record<string, unknown> {
  return {
    tag: 'button',
    text: { tag: 'plain_text', content: label },
    type,
    name: `daily_mission_inactive_refresh_preview_${kind}_${action}`,
    disabled: true,
    disabled_tips: { tag: 'plain_text', content: '预览卡按钮不可执行真实操作' },
    behaviors: [{ type: 'callback', value: { action: 'daily_mission_inactive_refresh_preview_noop', preview: true, kind, intent: action } }],
  };
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

function actionForm(kind: PreviewKind): Record<string, unknown> {
  const buttons = [
    noopButton('批准可执行项', kind, 'approve_executable', 'primary'),
    noopButton('仅低风险', kind, 'approve_low_risk'),
    noopButton('转人工复核', kind, 'manual_review'),
    noopButton('拒绝本次计划', kind, 'reject'),
  ];
  return {
    tag: 'column_set',
    element_id: `daily_mission_inactive_refresh_preview_actions_${kind}`,
    flex_mode: 'stretch',
    horizontal_spacing: '8px',
    columns: buttons.map((button) => ({
      tag: 'column',
      width: 'weighted',
      weight: 1,
      vertical_align: 'top',
      elements: [button],
    })),
  };
}

function compactSummary(plan: PreviewPlan): string {
  const executableGroupCount = plan.groups.filter((group) => group.executable > 0).length;
  return [
    `**审批摘要**：本次只审批下架补链 **${plan.totals.executable}** 条`,
    `涉及商品组 ${executableGroupCount}`,
    '按钮为预览禁用',
  ].join('｜');
}

function reasonChart(plan: PreviewPlan): string {
  return plan.reasonBuckets.map((item) => `${item.label} ${item.count}`).join('｜');
}

function groupModificationRatioChart(plan: PreviewPlan): Record<string, unknown> {
  const values = plan.groups
    .filter((group) => group.executable > 0)
    .sort((left, right) => right.executable - left.executable || left.name.localeCompare(right.name))
    .map((group) => ({ label: group.name, value: group.executable }));
  return {
    tag: 'chart',
    element_id: 'inactive_refresh_group_modification_ratio_chart',
    aspect_ratio: '4:3',
    height: '240px',
    chart_spec: {
      type: 'pie',
      title: { text: `本次下架补链商品占比（共 ${plan.totals.executable} 条）` },
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

function groupLines(plan: PreviewPlan): string {
  const executableGroups = plan.groups.filter((group) => group.executable > 0);
  if (executableGroups.length === 0) return '本次没有需要下架补链的商品组。';
  return executableGroups.map((group) => `- **${group.name}**：本次补链 ${group.executable} 条`).join('\n');
}

function linkJudgmentLines(plan: PreviewPlan, mode: 'minimal' | 'standard' | 'audit'): string {
  return plan.links.map((link) => {
    if (mode === 'minimal') return `- ${link.productId}｜${link.groupName}｜${link.decision}：${link.reason}`;
    const core = `- ${link.productId}｜${link.groupName}｜曝光日均 ${link.avgExposure14d ?? '缺失'}｜访问 ${link.visits14d ?? '缺失'}｜访问率 ${rate(link.visitRate)}｜曝光金额 ${money(link.exposureAmount14d)}｜访问订单金额 ${money(link.visitOrderAmount14d)}｜${link.decision}`;
    if (mode === 'standard') return core;
    return `${core}\n  链接年龄 ${link.ageDays} 天｜数据/规则：${link.reason}`;
  }).join('\n');
}

function fixedRules(): string {
  return [
    '**固定规则**',
    '- 链接级负责发现问题，同款组级负责防误伤。',
    '- 新链接上线不足 14 天只观察，不进入失活刷新。',
    '- 高曝光高访问但金额为 0 归为转化异常，不进刷新。',
    '- 曝光缺失可用访问判断；访问补抓失败进入人工复核。',
    '- 每日全局上限 20 条；同款组 10 条以上最多处理 20%；执行后冷却 14 天。',
  ].join('\n');
}

function diffSummary(plan: PreviewPlan): string {
  return [
    `**修改 Diff 摘要**`,
    `- 预计复制 ${plan.totals.executable} 条新链，下架 ${plan.totals.executable} 条原链。`,
    '- 可执行组 active 容量整体保持不下降。',
    '- 异常项不进入本次执行，保留到异常卡/详情 JSON。',
  ].join('\n');
}

function detailPanels(plan: PreviewPlan): Record<string, unknown>[] {
  const exceptionLines = plan.exceptions
    .filter((item) => item.count > 0)
    .map((item) => `- **${item.label}** ${item.count} 条｜${item.action}｜示例：${item.examples.join('、')}`)
    .join('\n') || '本次没有需要单独说明的数据异常。';
  return [
    collapsiblePanel('inactive_refresh_groups_summary_standard', '展开：补链商品组', [markdown(groupLines(plan))]),
    collapsiblePanel('inactive_refresh_evidence_summary_standard', '展开：判定证据（核心指标）', [
      markdown(`**候选结构**\n${reasonChart(plan)}`),
      markdown(`**候选链接判定**\n${linkJudgmentLines(plan, 'standard')}`),
    ]),
    collapsiblePanel('inactive_refresh_exceptions_summary_standard', '展开：数据异常/未执行原因', [markdown(exceptionLines)]),
    collapsiblePanel('inactive_refresh_rules_summary_standard', '展开：固定规则与审计口径', [markdown(fixedRules())]),
  ];
}

function buildTotalCard(plan: PreviewPlan): FeishuCardPayload {
  const variant = '方案 B｜标准指标';
  const elements: Record<string, unknown>[] = [
    markdown(`**${variant}**\n日期 ${plan.date}｜Run ${plan.runId}\n本卡只审批本次可执行的下架补链；人工复核和排除项不随本次执行。`),
    markdown(compactSummary(plan)),
    groupModificationRatioChart(plan),
    markdown(diffSummary(plan)),
    actionForm('summary_standard'),
    ...detailPanels(plan),
  ];
  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: `Daily Mission｜今日失活刷新审批｜${variant}` }, template: 'orange' },
    body: { elements },
  };
}

function samplePlan(date = new Date().toISOString().slice(0, 10)): PreviewPlan {
  return {
    date,
    runId: `preview-${date}`,
    totals: { candidates: 18, executable: 12, lowRisk: 9, manualReview: 4, excluded: 2, groups: 6 },
    reasonBuckets: [
      { label: '双金额为0且访问弱', count: 12 },
      { label: '曝光缺失用访问判断', count: 2 },
      { label: '访问补抓失败', count: 2 },
      { label: '转化异常/新链保护', count: 2 },
    ],
    groups: [
      { name: 'Pocket 3', activeBefore: 12, executable: 6, manualReview: 0, excluded: 0, activeAfter: 12, limit: '20%=2', reason: '双金额为 0，访问率低，组内未超限。' },
      { name: 'R50', activeBefore: 6, executable: 2, manualReview: 1, excluded: 0, activeAfter: 6, limit: '最多2', reason: '1 条可执行，1 条曝光缺失需复核。' },
      { name: 'Canon R50', activeBefore: 15, executable: 4, manualReview: 0, excluded: 0, activeAfter: 15, limit: '20%=3', reason: '触发组内上限，2 条进入候补。' },
      { name: 'Wide300', activeBefore: 5, executable: 0, manualReview: 0, excluded: 1, activeAfter: 5, limit: '最多2', reason: '高曝光高访问零单，转化异常排除。' },
    ],
    links: [
      { productId: '683', groupName: 'Pocket 3', ageDays: 42, avgExposure14d: 89, visits14d: 11, visitRate: 0.0089, exposureAmount14d: 0, visitOrderAmount14d: 0, decision: '可执行', reason: '金额为 0，访问弱，不属于转化异常。' },
      { productId: '686', groupName: 'Pocket 3', ageDays: 39, avgExposure14d: 52, visits14d: 3, visitRate: 0.0041, exposureAmount14d: 0, visitOrderAmount14d: 0, decision: '低风险', reason: '双金额为 0，组内安全。' },
      { productId: '901', groupName: 'R50', ageDays: 31, visits14d: 0, exposureAmount14d: undefined, visitOrderAmount14d: 0, decision: '人工复核', reason: '曝光缺失不可补，允许用访问判断但置信度低。' },
      { productId: '777', groupName: 'Wide300', ageDays: 45, avgExposure14d: 1200, visits14d: 1260, visitRate: 0.075, exposureAmount14d: 0, visitOrderAmount14d: 0, decision: '排除', reason: '高曝光高访问零单，转化异常。' },
      { productId: '990', groupName: 'Pocket 3', ageDays: 7, avgExposure14d: 26, visits14d: 3, visitRate: 0.0083, exposureAmount14d: 0, visitOrderAmount14d: 0, decision: '排除', reason: '新链未满 14 天，仅观察。' },
    ],
    exceptions: [
      { label: '金额口径冲突', count: 1, action: '人工核对金额来源', examples: ['A7M4 875'] },
      { label: '访问补抓失败', count: 2, action: '补抓失败原因复核', examples: ['Instax 712', 'R50 901'] },
      { label: '排除刷新', count: 2, action: '转化异常/新链观察', examples: ['Wide300 777', 'Pocket 3 990'] },
    ],
  };
}

export function buildInactiveRefreshPreviewDeckFromPlan(plan: PreviewPlan): InactiveRefreshPreviewDeck {
  const cards = [buildTotalCard(plan)];
  return {
    date: plan.date,
    cards,
    fallbackTexts: ['Daily Mission 失活刷新总卡方案 B 标准指标'],
  };
}

export function buildInactiveRefreshPreviewDeck(date?: string): InactiveRefreshPreviewDeck {
  return buildInactiveRefreshPreviewDeckFromPlan(samplePlan(date));
}
