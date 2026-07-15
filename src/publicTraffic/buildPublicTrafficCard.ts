import type { FeishuCardPayload } from '../notify/feishuApp.js';
import { resolveProductDisplayName, type ProductNameMap } from './productDisplayName.js';
import type { PublicTrafficDataReportContext, PublicTrafficProductDataRow, PublicTrafficReportPaths, PublicTrafficReportSectionItem } from './types.js';

export interface PublicTrafficCardOptions {
  productNameMap?: ProductNameMap;
}

type DataSourceHeaderTemplate = 'green' | 'blue' | 'orange' | 'red';
type ColdStartStatus = '强跑通' | '优秀链接' | '访问达标' | '有苗头' | '未启动' | '危险' | '待观察';

type TableColumnKey = 'priority' | 'product' | 'id' | 'action' | 'reason' | 'exposure' | 'visits' | 'amount';

type TableRow = Partial<Record<TableColumnKey, string | number>>;

interface DataSourceStatus {
  template: DataSourceHeaderTemplate;
  text: string;
  label?: string;
}

interface NewLinkColdStartRow {
  product: string;
  id: string;
  submittedTime: number;
  liveDays: string;
  dailyVisits: number;
  visits: number;
  amount: number;
  status: ColdStartStatus;
}

const COLD_START_STATUS_META: Array<{ status: ColdStartStatus; criteria: string; action: string }> = [
  { status: '强跑通', criteria: '7天金额 >0', action: '继续放量' },
  { status: '优秀链接', criteria: '日均访问 >=10', action: '放量观察' },
  { status: '访问达标', criteria: '日均访问 >=6', action: '看转化' },
  { status: '有苗头', criteria: '日均访问 3-5.9', action: '优化图/价/标题' },
  { status: '未启动', criteria: '日均访问 <3', action: '补曝光' },
  { status: '危险', criteria: '72h 0访问 / 日均<1', action: '优先重做' },
  { status: '待观察', criteria: '日报未匹配', action: '确认链接同步' },
];

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function trunc(value: unknown, max = 42): string {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function priorityLabel(priority: PublicTrafficReportSectionItem['priority'] | undefined): string {
  return priority === 'high' ? '高' : priority === 'medium' ? '中' : '低';
}

function shortId(row: PublicTrafficProductDataRow): string {
  return row.displayProductId.replace(/^端内ID\s*/, '') || row.displayProductId;
}

function markdown(content: string): Record<string, unknown> {
  return { tag: 'markdown', content };
}

function tableElement(elementId: string, columns: Array<{ name: TableColumnKey; display_name: string; data_type?: 'text' | 'number' }>, rows: TableRow[]): Record<string, unknown> {
  return {
    tag: 'table',
    element_id: elementId,
    page_size: 10,
    row_height: 'low',
    row_max_height: '124px',
    freeze_first_column: true,
    header_style: { background_style: 'grey', text_size: 'normal', text_align: 'left' },
    columns: columns.map((column) => ({
      name: column.name,
      display_name: column.display_name,
      data_type: column.data_type ?? 'text',
      horizontal_align: 'left',
      width: 'auto',
    })),
    rows,
  };
}

function hasOneDaySourceData(context: PublicTrafficDataReportContext, source: 'hasExposureData' | 'hasDashboardData'): boolean {
  return context.rows.some((row) => row.periods['1d']?.[source] === true);
}

function dataSourceStatus(context: PublicTrafficDataReportContext): DataSourceStatus {
  const exposureReady = hasOneDaySourceData(context, 'hasExposureData');
  const dashboardReady = hasOneDaySourceData(context, 'hasDashboardData');
  if (exposureReady && dashboardReady) {
    return { template: 'green', text: '数据源状态：曝光页已抓取；访问页已抓取', label: '数据完整' };
  }
  if (exposureReady) {
    return { template: 'blue', text: '数据源状态：曝光页已抓取；访问页未更新/异常' };
  }
  if (dashboardReady) {
    return { template: 'orange', text: '数据源状态：曝光页未更新/异常；访问页已抓取' };
  }
  return { template: 'red', text: '数据源状态：曝光页未更新/异常；访问页未更新/异常' };
}

function sourceStatusLine(status: DataSourceStatus): Record<string, unknown> {
  const prefix = status.label ? `<text_tag color='green'>${status.label}</text_tag> ` : '';
  return markdown(`${prefix}${status.text}`);
}

function metricColumn(label: string, value: string, color: 'blue' | 'red'): Record<string, unknown> {
  return {
    tag: 'column',
    width: 'weighted',
    weight: 1,
    vertical_align: 'top',
    background_style: 'grey',
    padding: '10px',
    elements: [markdown(`<text_tag color='${color}'>${label}</text_tag>\n**${value}**`)],
  };
}

function metricBand(context: PublicTrafficDataReportContext): Record<string, unknown> {
  const one = context.summary['1d'];
  return {
    tag: 'column_set',
    flex_mode: 'stretch',
    horizontal_spacing: '8px',
    columns: [
      metricColumn('今日金额', `¥${one.amount.toFixed(2)}`, 'red'),
      metricColumn('今日转化率', percent(one.exposureVisitRate), 'red'),
      metricColumn('今日曝光', String(one.exposure), 'blue'),
      metricColumn('今日访问', String(one.publicVisits), 'blue'),
    ],
  };
}

function issueSummary(context: PublicTrafficDataReportContext): Record<string, unknown> {
  const lowExposure = context.lowExposure.length;
  const weakClick = context.weakClick.length;
  const highPotential = context.highPotential.length;
  const custodyAbnormal = context.custodyAbnormal?.length ?? 0;
  return markdown(
    `<text_tag color='grey'>今日问题结构</text_tag>\n<text_tag color='orange'>低曝光 ${lowExposure}</text_tag>｜<text_tag color='orange'>点击弱 ${weakClick}</text_tag>｜<text_tag color='green'>高潜 ${highPotential}</text_tag>｜<text_tag color='orange'>托管异常 ${custodyAbnormal}</text_tag>`,
  );
}

function compareColor(diff: number, metric: 'exposure' | 'visits' | 'amount' | 'rate'): string {
  if (metric === 'rate') {
    if (diff > 0) return 'green';
    if (diff < 0) return 'red';
    return 'grey';
  }
  if (diff > 0) return 'green';
  if (diff < 0) return 'red';
  return 'grey';
}

function historyCompareBlock(context: PublicTrafficDataReportContext): Record<string, unknown> {
  const latest = context.summary['1d'];
  const previous = context.previousSummary;
  if (!previous) {
    return markdown('**与历史对比**\n- 暂无昨日上下文，当前无法形成较昨日对比。');
  }
  const rows = [
    { label: '曝光', yesterday: String(previous.exposure), diff: latest.exposure - previous.exposure, metric: 'exposure' as const },
    { label: '访问', yesterday: String(previous.publicVisits), diff: latest.publicVisits - previous.publicVisits, metric: 'visits' as const },
    { label: '金额', yesterday: `¥${previous.amount.toFixed(0)}`, diff: latest.amount - previous.amount, metric: 'amount' as const },
    { label: '转化率', yesterday: percent(previous.exposureVisitRate), diff: latest.exposureVisitRate * 100 - previous.exposureVisitRate * 100, metric: 'rate' as const },
  ];
  return markdown(
    [
      '**与历史对比**',
      ...rows.map((row) => {
        const color = compareColor(row.diff, row.metric);
        const diffText = row.metric === 'amount'
          ? `${row.diff >= 0 ? '+' : ''}¥${row.diff.toFixed(0)}`
          : row.metric === 'rate'
            ? `${row.diff >= 0 ? '+' : ''}${row.diff.toFixed(2)}pct`
            : `${row.diff >= 0 ? '+' : ''}${Number.isInteger(row.diff) ? row.diff : row.diff.toFixed(2)}`;
        return `- **${row.label}**｜昨日 ${row.yesterday}｜<text_tag color='${color}'>较昨日 ${diffText}</text_tag>`;
      }),
    ].join('\n'),
  );
}

function causeEvidencePanel(context: PublicTrafficDataReportContext): Record<string, unknown> {
  const evidence: string[] = [];
  if (context.lowExposure.length > 0) evidence.push(`长尾低曝光商品 ${context.lowExposure.length} 个，说明“曝光不足的旧链接存量”是真实存在的。`);
  if (context.weakClick.length > 0 && context.weakClick[0]) evidence.push(`点击弱样本 ${context.weakClick.length} 个，至少有 ${context.weakClick[0].identifier} 出现“高曝光但点击承接弱”。`);
  if ((context.custodyAbnormal?.length ?? 0) > 0) evidence.push(`托管异常商品 ${context.custodyAbnormal?.length ?? 0} 个，说明部分异常可能与状态问题有关。`);
  if (context.highPotential.length > 0 && context.highPotential[0]) evidence.push(`高潜商品 ${context.highPotential.length} 个，其中 ${context.highPotential[0].identifier} 已有成交，说明需求并未整体消失。`);
  return {
    tag: 'collapsible_panel',
    element_id: 'cause_evidence_panel',
    expanded: false,
    header: {
      title: { tag: 'plain_text', content: '原因证据与当前未知（展开查看）' },
      vertical_align: 'center',
      icon: { tag: 'standard_icon', token: 'down-small-ccm_outlined', size: '16px 16px' },
      icon_position: 'right',
      icon_expanded_angle: -180,
    },
    border: { color: 'grey', corner_radius: '5px' },
    padding: '8px 8px 8px 8px',
    elements: [
      markdown(
        [
          '**已有证据支持的方向**',
          ...(evidence.length ? evidence.map((item) => `- ${item}`) : ['- 当前没有足够强的结构证据支撑具体原因判断。']),
          '',
          '**当前看不出的原因**',
          '- 当前无法仅凭这张表判断：是价格变化、库存变化、排序变化、上下架变化，还是流量入口变化导致。',
          '- 如果访问页/后链路数据缺失，则更不能把“结果变化”直接解释成“原因已经明确”。',
        ].join('\n'),
      ),
    ],
  };
}

function pickSuggestionItems(context: PublicTrafficDataReportContext): Array<{ priority: string; product: string; action: string; reason: string }> {
  const items = [
    ...context.recommendedActions.slice(0, 2),
    ...(context.custodyAbnormal ?? []).slice(0, 2),
    ...context.highPotential.slice(0, 2),
  ].slice(0, 5);
  return items.map((item) => ({
    priority: priorityLabel(item.priority),
    product: item.identifier,
    action: trunc(item.action, 26),
    reason: trunc(item.reason, 42),
  }));
}

function suggestionTable(context: PublicTrafficDataReportContext): Record<string, unknown> {
  return tableElement('today_action_table', [
    { name: 'priority', display_name: '优先级' },
    { name: 'product', display_name: '商品' },
    { name: 'action', display_name: '操作动作' },
    { name: 'reason', display_name: '针对该链接的依据' },
  ], pickSuggestionItems(context));
}

function overallAdvicePanel(context: PublicTrafficDataReportContext): Record<string, unknown> {
  const weakClickExample = context.weakClick[0]?.identifier ? `例如 ${context.weakClick[0].identifier} 出现高曝光低点击，优先看主图、标题、价格露出。` : '当前点击弱样本不多，但仍应优先看高曝光低点击链接。';
  const highPotentialExample = context.highPotential[0]?.identifier ? `例如 ${context.highPotential[0].identifier} 已产生金额，适合复制有效结构。` : '若当日已有成交链接，应优先复用有效结构，而不是盲目补量。';
  return {
    tag: 'collapsible_panel',
    element_id: 'overall_advice_panel',
    expanded: false,
    header: {
      title: { tag: 'plain_text', content: '整体运营建议（展开查看）' },
      vertical_align: 'center',
      icon: { tag: 'standard_icon', token: 'down-small-ccm_outlined', size: '16px 16px' },
      icon_position: 'right',
      icon_expanded_angle: -180,
    },
    border: { color: 'grey', corner_radius: '5px' },
    padding: '8px 8px 8px 8px',
    elements: [
      markdown(
        [
          `**提高曝光**：当前低曝光商品 ${context.lowExposure.length} 个，建议把低曝光旧链接归入统一治理池，优先处理连续低曝光、托管较久、近几日无恢复迹象的旧链接。`,
          '',
          `**提高点击**：当前点击弱商品 ${context.weakClick.length} 个，建议优先检查高曝光低点击链接的主图、标题、价格露出与首屏卖点。${weakClickExample}`,
          '',
          `**异常单独处理**：当前托管异常商品 ${context.custodyAbnormal?.length ?? 0} 个，建议先核查托管状态是否影响承接，再决定是否继续投放。`,
          '',
          `**放量复制**：当前高潜商品 ${context.highPotential.length} 个，建议优先放量已出金额的链接，再复用其标题/图片/价格结构到相似商品。${highPotentialExample}`,
          '',
          `**首页收口**：当前推荐动作总量 ${context.recommendedActions.length} 项，首页只保留本日重点动作，完整问题池后置。`,
        ].join('\n'),
      ),
    ],
  };
}

function structureChart(context: PublicTrafficDataReportContext): Record<string, unknown> {
  return {
    tag: 'chart',
    element_id: 'today_issue_structure_chart',
    aspect_ratio: '16:9',
    color_theme: 'primary',
    preview: true,
    height: '220px',
    chart_spec: {
      type: 'bar',
      title: { text: '今日问题结构' },
      data: {
        values: [
          { name: '低曝光', value: context.lowExposure.length },
          { name: '点击弱', value: context.weakClick.length },
          { name: '高潜', value: context.highPotential.length },
          { name: '托管异常', value: context.custodyAbnormal?.length ?? 0 },
        ],
      },
      direction: 'horizontal',
      xField: 'value',
      yField: 'name',
      label: { visible: true },
      axes: [
        { orient: 'left', label: { visible: true } },
        { orient: 'bottom', label: { visible: true } },
      ],
      media: [],
    },
  };
}

function topExposureRows(context: PublicTrafficDataReportContext, productNameMap: ProductNameMap): TableRow[] {
  return [...context.rows]
    .sort((a, b) => b.periods['1d'].exposure - a.periods['1d'].exposure || b.periods['1d'].publicVisits - a.periods['1d'].publicVisits)
    .slice(0, 10)
    .map((row) => ({
      product: resolveProductDisplayName(row, productNameMap),
      id: shortId(row),
      exposure: row.periods['1d'].exposure,
      visits: row.periods['1d'].publicVisits,
      amount: Number(row.periods['1d'].amount.toFixed(2)),
    }));
}

function parseSubmittedAt(value: string): Date | null {
  if (!value.trim()) return null;
  const date = new Date(value.trim().replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? null : date;
}

function reportEnd(date: string): Date {
  return new Date(`${date}T23:59:59.999`);
}

function coldStartLiveDays(submittedAt: string, reportDate: string): { label: string; days: number; hours: number; afterReportDate: boolean } {
  const submitted = parseSubmittedAt(submittedAt);
  if (!submitted) return { label: '-', days: 7, hours: 168, afterReportDate: false };
  const reportEndTime = reportEnd(reportDate).getTime();
  const hours = Math.max(0, (reportEndTime - submitted.getTime()) / 36e5);
  const days = Math.max(hours / 24, 0.25);
  return { label: `${days.toFixed(1)}天`, days, hours, afterReportDate: submitted.getTime() > reportEndTime };
}

function classifyColdStart(dailyVisits: number, visits: number, amount: number, liveHours: number, matched: boolean, afterReportDate = false): ColdStartStatus {
  if (!matched || afterReportDate) return '待观察';
  if (amount > 0) return '强跑通';
  if ((liveHours >= 72 && visits === 0) || dailyVisits < 1) return '危险';
  if (dailyVisits >= 10) return '优秀链接';
  if (dailyVisits >= 6) return '访问达标';
  if (dailyVisits >= 3) return '有苗头';
  return '未启动';
}

function coldStartStatusOrder(status: ColdStartStatus): number {
  return ['危险', '未启动', '有苗头', '访问达标', '优秀链接', '强跑通', '待观察'].indexOf(status);
}

function submittedTime(value: string): number {
  return parseSubmittedAt(value)?.getTime() ?? Number.NEGATIVE_INFINITY;
}

function compareProductIds(a: string, b: string): number {
  const aNumber = /^\d+$/.test(a) ? Number(a) : null;
  const bNumber = /^\d+$/.test(b) ? Number(b) : null;
  if (aNumber !== null && bNumber !== null) return aNumber - bNumber;
  if (aNumber !== null) return -1;
  if (bNumber !== null) return 1;
  return a.localeCompare(b);
}

function shortNewProductName(name: string): string {
  return name.length > 18 ? `${name.slice(0, 18)}...` : name;
}

function findRowByIdentifier(context: PublicTrafficDataReportContext, identifier: string): PublicTrafficProductDataRow | undefined {
  const id = identifier.replace(/^端内ID\s*/, '').trim();
  return context.rows.find((row) => row.displayProductId === identifier || shortId(row) === id || row.platformProductId === identifier);
}

function sortNewProductPoolItems(items: NonNullable<PublicTrafficDataReportContext['newProductPoolItems']>): NonNullable<PublicTrafficDataReportContext['newProductPoolItems']> {
  return [...items].sort((a, b) => submittedTime(b.submittedAt) - submittedTime(a.submittedAt) || compareProductIds(a.productId, b.productId));
}

function newLinkColdStartRows(context: PublicTrafficDataReportContext): NewLinkColdStartRow[] {
  return sortNewProductPoolItems(context.newProductPoolItems ?? []).map((item) => {
    const row = findRowByIdentifier(context, item.productId);
    const seven = row?.periods['7d'];
    const live = coldStartLiveDays(item.submittedAt, context.date);
    const totalVisits = seven?.publicVisits ?? 0;
    const amount = seven?.amount ?? 0;
    const dailyVisits = Number((totalVisits / live.days).toFixed(1));
    return {
      product: `商品ID ${item.productId} ${shortNewProductName(item.productName)}`.trim(),
      id: item.productId,
      submittedTime: submittedTime(item.submittedAt),
      liveDays: live.label,
      dailyVisits,
      visits: totalVisits,
      amount,
      status: classifyColdStart(dailyVisits, totalVisits, amount, live.hours, Boolean(row), live.afterReportDate),
    };
  }).sort((a, b) => b.submittedTime - a.submittedTime || coldStartStatusOrder(a.status) - coldStartStatusOrder(b.status) || a.dailyVisits - b.dailyVisits || compareProductIds(a.id, b.id));
}

function averageDailyVisits(rows: NewLinkColdStartRow[]): string {
  if (rows.length === 0) return '0.0';
  return (rows.reduce((sum, row) => sum + row.dailyVisits, 0) / rows.length).toFixed(1);
}

function coldStartMarkdown(rows: NewLinkColdStartRow[], count: number, fallbackPreview: string): string {
  const statusCounts = (status: ColdStartStatus): number => rows.filter((row) => row.status === status).length;
  const statusLines = COLD_START_STATUS_META
    .map((meta) => ({ ...meta, count: statusCounts(meta.status) }))
    .filter((item) => item.count > 0)
    .map((item) => `- ${item.status} ${item.count} 条｜${item.criteria}｜${item.action}`);
  const detailLines = rows.slice(0, 10).map((row, index) => `${index + 1}. ${row.product}｜上线 ${row.liveDays}｜日均公域访问 ${row.dailyVisits}/天｜公域访问 ${row.visits}｜金额 ¥${row.amount.toFixed(2)}｜${row.status}`);
  return [
    `近7天链接 ${count} 条`,
    `强跑通 ${statusCounts('强跑通')}｜优秀 ${statusCounts('优秀链接')}｜访问达标 ${statusCounts('访问达标')}｜有苗头 ${statusCounts('有苗头')}｜未启动 ${statusCounts('未启动')}｜危险 ${statusCounts('危险')}`,
    `平均访问 ${averageDailyVisits(rows)}/天｜认可线 >=6/天｜优秀线 >=10/天`,
    '',
    '**分层状态**',
    ...statusLines,
    '',
    '**优先处理链接**',
    ...detailLines,
    ...(rows.some((row) => row.status === '待观察') && fallbackPreview ? ['', '**待观察链接**', fallbackPreview] : []),
  ].join('\n');
}

function newProductPoolCount(context: PublicTrafficDataReportContext): number {
  return context.newProductPoolItems?.length ? context.newProductPoolItems.length : context.newProductPoolIds?.length ?? context.newProductObservation.length;
}

function newProductPoolPanel(context: PublicTrafficDataReportContext): Record<string, unknown> {
  const count = newProductPoolCount(context);
  const coldStartRows = newLinkColdStartRows(context);
  const fallbackPreview = context.newProductPoolItems?.length
    ? sortNewProductPoolItems(context.newProductPoolItems).slice(0, 10).map((item) => `- 商品ID ${item.productId} ${shortNewProductName(item.productName)}：待观察`).join('\n')
    : context.newProductPoolIds?.length
      ? context.newProductPoolIds.slice(0, 10).map((id) => `- 商品ID ${id}：待观察`).join('\n')
      : context.newProductObservation.slice(0, 10).map((item) => `- ${item.identifier}：${item.reason}`).join('\n');
  const elements: Record<string, unknown>[] = coldStartRows.length > 0
    ? [markdown(coldStartMarkdown(coldStartRows, count, fallbackPreview))]
    : [markdown([`近7天链接 ${count} 条。`, fallbackPreview].filter(Boolean).join('\n'))];
  return {
    tag: 'collapsible_panel',
    element_id: 'new_product_pool',
    expanded: false,
    header: {
      title: { tag: 'plain_text', content: `新链接冷启动（${count}）` },
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

function detailSections(context: PublicTrafficDataReportContext, productNameMap: ProductNameMap): Record<string, unknown>[] {
  return [
    { tag: 'hr' },
    markdown('**曝光 Top10**'),
    tableElement('exposure_top_table', [
      { name: 'product', display_name: '商品' },
      { name: 'id', display_name: 'ID' },
      { name: 'exposure', display_name: '曝光', data_type: 'number' },
      { name: 'visits', display_name: '公域访问', data_type: 'number' },
      { name: 'amount', display_name: '公域金额', data_type: 'number' },
    ], topExposureRows(context, productNameMap)),
    { tag: 'hr' },
    newProductPoolPanel(context),
  ];
}

export function buildPublicTrafficCard(context: PublicTrafficDataReportContext, _paths: PublicTrafficReportPaths, options: PublicTrafficCardOptions = {}): FeishuCardPayload {
  const sourceStatus = dataSourceStatus(context);
  const productNameMap = options.productNameMap ?? {};
  return {
    schema: '2.0',
    config: { update_multi: true },
    header: {
      title: { tag: 'plain_text', content: `公域数据日报 ${context.date}` },
      template: sourceStatus.template,
    },
    body: {
      elements: [
        sourceStatusLine(sourceStatus),
        metricBand(context),
        issueSummary(context),
        { tag: 'hr' },
        historyCompareBlock(context),
        causeEvidencePanel(context),
        { tag: 'hr' },
        markdown('**今日运营操作建议（针对链接）**'),
        suggestionTable(context),
        overallAdvicePanel(context),
        { tag: 'hr' },
        markdown('**今日问题结构柱状图**'),
        structureChart(context),
        ...detailSections(context, productNameMap),
      ],
    },
  };
}
