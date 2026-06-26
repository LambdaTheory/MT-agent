import type { FeishuCardPayload } from '../notify/feishuApp.js';
import { derivedOrderBusinessMetrics, findOrderAnalysisIndicator, findOrderAnalysisNumber, shortDataDate } from './orderAnalysis.js';
import { resolveProductDisplayName, type ProductNameMap } from './productDisplayName.js';
import type { PublicTrafficDataReportContext, PublicTrafficProductDataRow, PublicTrafficReportPaths } from './types.js';

export interface PublicTrafficCardOptions {
  productNameMap?: ProductNameMap;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function rateText(one: PublicTrafficDataReportContext['summary']['1d']): string {
  return percent(one.exposureVisitRate);
}

function percentDelta(current: number, previous: number | undefined): string | undefined {
  if (previous === undefined || previous <= 0 || !Number.isFinite(current) || !Number.isFinite(previous)) return undefined;
  const change = ((current - previous) / previous) * 100;
  const prefix = change > 0 ? '+' : '';
  return `较前日${prefix}${change.toFixed(2)}%`;
}

function publicFunnelMetrics(context: PublicTrafficDataReportContext): FunnelMetric[] {
  const one = context.summary['1d'];
  const previous = context.previousSummary;
  return [
    ['曝光', String(one.exposure), percentDelta(one.exposure, previous?.exposure)],
    ['公域访问', String(one.publicVisits), percentDelta(one.publicVisits, previous?.publicVisits)],
    ['公域金额', `¥${one.amount.toFixed(2)}`, percentDelta(one.amount, previous?.amount)],
    ['转化率', rateText(one), percentDelta(one.exposureVisitRate, previous?.exposureVisitRate)],
  ];
}

function shortId(row: PublicTrafficProductDataRow): string {
  return row.displayProductId.replace(/^端内ID\s*/, '') || row.displayProductId;
}

function moduleCounts(context: PublicTrafficDataReportContext): Array<[string, number]> {
  const counts: Array<[string, number]> = [
    ['曝光不足', context.lowExposure.length],
    ['点击弱', context.weakClick.length],
    ['转化弱', context.weakConversion.length],
    ['高潜力', context.highPotential.length],
    ['新品观察', context.newProductObservation.length],
    ['新品池维护', context.newProductPoolItems?.length ? context.newProductPoolItems.length : context.newProductPoolIds?.length ?? 0],
    ['生命周期治理', context.lifecycleGovernance.length],
    ['托管异常', context.custodyAbnormal?.length ?? 0],
    ['建议操作', context.recommendedActions.length],
  ];
  return counts.filter(([, count]) => count > 0);
}

function markdownColumn(content: string): Record<string, unknown> {
  return {
    tag: 'column',
    width: 'weighted',
    weight: 1,
    vertical_align: 'top',
    elements: [{ tag: 'markdown', content }],
  };
}

function columnSet(columns: string[], elementId?: string): Record<string, unknown> {
  return { tag: 'column_set', ...(elementId ? { element_id: elementId } : {}), flex_mode: 'bisect', horizontal_spacing: '8px', columns: columns.map(markdownColumn) };
}

type FunnelMetric = [string, string, string?];

function deltaColor(delta: string): string {
  if (delta.includes('+')) return 'red';
  if (delta.includes('-')) return 'green';
  return 'grey';
}

function metricCard(label: string, value: string, delta?: string): Record<string, unknown> {
  const elements: Record<string, unknown>[] = [{ tag: 'markdown', content: `${label}\n**${value}**`, text_align: 'center' }];
  if (delta) {
    elements.push({ tag: 'markdown', content: `<text_tag color='${deltaColor(delta)}'>${delta}</text_tag>`, text_align: 'center', text_size: 'notation' });
  }
  return {
    tag: 'column',
    width: 'weighted',
    weight: 1,
    vertical_align: 'top',
    background_style: 'grey',
    padding: '8px',
    elements,
  };
}

function metricCardRow(metrics: FunnelMetric[]): Record<string, unknown> {
  return { tag: 'column_set', flex_mode: 'bisect', horizontal_spacing: '8px', columns: metrics.map(([label, value, delta]) => metricCard(label, value, delta)) };
}

function chunkMetrics(metrics: FunnelMetric[], size = 3): FunnelMetric[][] {
  const chunks: FunnelMetric[][] = [];
  for (let index = 0; index < metrics.length; index += size) chunks.push(metrics.slice(index, index + size));
  return chunks;
}

function nestedMetricColumn(title: string | null, metrics: FunnelMetric[], chunkSize = 3): Record<string, unknown> {
  return {
    tag: 'column',
    width: 'weighted',
    weight: 1,
    vertical_align: 'top',
    elements: [...(title ? [{ tag: 'markdown', content: `**${title}**` }] : []), ...chunkMetrics(metrics, chunkSize).map((chunk) => metricCardRow(chunk))],
  };
}

function orderMetric(page: Parameters<typeof findOrderAnalysisIndicator>[0], label: string, names: string[]): FunnelMetric {
  const value = findOrderAnalysisIndicator(page, names);
  const indicator = page?.indicators.find((item) => names.includes(item.label));
  const delta = indicator?.delta && indicator.delta !== '较前日-' ? indicator.delta : undefined;
  return [label, value, delta];
}

function parseOrderDeltaRate(delta: string | undefined): number | null {
  if (!delta) return null;
  const matched = delta.match(/较前日([+-]?\d+(?:\.\d+)?)%/);
  if (!matched) return null;
  const parsed = Number(matched[1]);
  return Number.isFinite(parsed) ? parsed / 100 : null;
}

function previousValueFromDelta(current: number | null, delta: string | undefined): number | null {
  const rate = parseOrderDeltaRate(delta);
  if (current === null || rate === null || rate <= -1) return null;
  const previous = current / (1 + rate);
  return Number.isFinite(previous) ? previous : null;
}

function orderIndicatorDelta(page: Parameters<typeof findOrderAnalysisIndicator>[0], names: string[]): string | undefined {
  return page?.indicators.find((item) => names.includes(item.label))?.delta;
}

function shipmentRateDelta(overview: Parameters<typeof findOrderAnalysisIndicator>[0]): string | undefined {
  const created = findOrderAnalysisNumber(overview, ['创建订单数']);
  const shipped = findOrderAnalysisNumber(overview, ['发货订单数']);
  if (created === null || created <= 0 || shipped === null) return undefined;
  const previousCreated = previousValueFromDelta(created, orderIndicatorDelta(overview, ['创建订单数']));
  const previousShipped = previousValueFromDelta(shipped, orderIndicatorDelta(overview, ['发货订单数']));
  if (previousCreated === null || previousCreated <= 0 || previousShipped === null) return undefined;
  return percentDelta(shipped / created, previousShipped / previousCreated);
}

function nestedFunnelColumnSet(groups: Array<{ title: string | null; metrics: FunnelMetric[]; chunkSize?: number }>, elementId = 'funnel_summary'): Record<string, unknown> {
  return {
    tag: 'column_set',
    element_id: elementId,
    flex_mode: 'stretch',
    horizontal_spacing: '8px',
    columns: groups.map((group) => nestedMetricColumn(group.title, group.metrics, group.chunkSize)),
  };
}

function optionalElement(element: Record<string, unknown> | null): Record<string, unknown>[] {
  return element ? [element] : [];
}

type DataSourceHeaderTemplate = 'green' | 'blue' | 'orange' | 'red';

interface DataSourceStatus {
  template: DataSourceHeaderTemplate;
  text: string;
}

function hasOneDaySourceData(context: PublicTrafficDataReportContext, source: 'hasExposureData' | 'hasDashboardData'): boolean {
  return context.rows.some((row) => row.periods['1d']?.[source] === true);
}

function dataSourceStatus(context: PublicTrafficDataReportContext): DataSourceStatus {
  const exposureReady = hasOneDaySourceData(context, 'hasExposureData');
  const dashboardReady = hasOneDaySourceData(context, 'hasDashboardData');
  const template: DataSourceHeaderTemplate = exposureReady && dashboardReady
    ? 'green'
    : exposureReady
      ? 'blue'
      : dashboardReady
        ? 'orange'
        : 'red';
  const exposureText = exposureReady ? '曝光页已抓取' : '曝光页未更新/异常';
  const dashboardText = dashboardReady ? '访问页已抓取' : '访问页未更新/异常';
  return { template, text: `数据源状态：${exposureText}；${dashboardText}` };
}

function funnelColumnSet(context: PublicTrafficDataReportContext): Record<string, unknown> {
  return { tag: 'column_set', element_id: 'funnel_summary', flex_mode: 'stretch', horizontal_spacing: '8px', columns: [
    nestedMetricColumn(`公域（${shortDataDate(context.date)}）`, publicFunnelMetrics(context), 4),
  ] };
}

function funnelElements(context: PublicTrafficDataReportContext): Record<string, unknown>[] {
  const oa = context.orderAnalysis;
  if (!oa) {
    return [funnelColumnSet(context)];
  }
  const overview = oa.pages.overview;
  const delivery = oa.pages.delivery;
  const returns = oa.pages.return;
  const customs = oa.pages.customs;
  const business = derivedOrderBusinessMetrics(overview, customs);
  return [
    nestedFunnelColumnSet([
      { title: `公域（${shortDataDate(context.date)}）`, metrics: publicFunnelMetrics(context), chunkSize: 4 },
    ], 'funnel_public'),
    nestedFunnelColumnSet([
      { title: `订单经营（${shortDataDate(overview?.dataDate)}）`, metrics: [orderMetric(overview, '创建订单', ['创建订单数']), orderMetric(overview, '签约订单', ['签约订单数']), orderMetric(overview, '发货订单', ['发货订单数']), ['发货率', business.shipmentRate, shipmentRateDelta(overview)]], chunkSize: 4 },
    ], 'funnel_order'),
    nestedFunnelColumnSet([
      { title: `履约（发货${shortDataDate(delivery?.dataDate)}｜归还${shortDataDate(returns?.dataDate)}｜关单${shortDataDate(customs?.dataDate)}）`, metrics: [orderMetric(delivery, '待发货', ['待发货订单数']), orderMetric(returns, '归还', ['归还订单数']), orderMetric(returns, '逾期', ['逾期订单数']), orderMetric(customs, '关单', ['关单数'])], chunkSize: 4 },
    ], 'funnel_fulfillment'),
  ];
}

function moduleColumnSet(context: PublicTrafficDataReportContext): Record<string, unknown> | null {
  const counts = moduleCounts(context);
  if (counts.length === 0) return null;
  return columnSet(['**模块数量**', ...counts.map(([label, count]) => `${label} ${count}`)]);
}

function markdownElement(content: string | null): { tag: 'markdown'; content: string }[] {
  return content ? [{ tag: 'markdown', content }] : [];
}

type TableColumnKey = 'product' | 'id' | 'exposure' | 'visits' | 'amount' | 'deals' | 'custodyDays' | 'rate' | 'status' | 'criteria' | 'action' | 'liveDays' | 'dailyVisits';

interface FeishuTableColumn {
  name: TableColumnKey;
  display_name: string;
  data_type: 'text' | 'number';
  horizontal_align: 'left';
  width: 'auto';
}

type FeishuTableRow = Partial<Record<TableColumnKey, string | number>>;

interface FeishuTableElement extends Record<string, unknown> {
  tag: 'table';
  element_id: string;
  page_size: 10;
  row_height: 'low';
  row_max_height: '124px';
  freeze_first_column: true;
  header_style: {
    background_style: 'grey';
    text_size: 'normal';
    text_align: 'left';
  };
  columns: FeishuTableColumn[];
  rows: FeishuTableRow[];
}

function tableColumn(name: TableColumnKey, displayName: string, dataType: 'text' | 'number' = 'text'): FeishuTableColumn {
  return { name, display_name: displayName, data_type: dataType, horizontal_align: 'left', width: 'auto' };
}

function tableElement(elementId: string, columns: FeishuTableColumn[], rows: FeishuTableRow[]): FeishuTableElement {
  return {
    tag: 'table',
    element_id: elementId,
    page_size: 10,
    row_height: 'low',
    row_max_height: '124px',
    freeze_first_column: true,
    header_style: { background_style: 'grey', text_size: 'normal', text_align: 'left' },
    columns,
    rows,
  };
}

function rowScore(row: PublicTrafficProductDataRow): number {
  return row.periods['1d'].exposure;
}

function visits(row: PublicTrafficProductDataRow): number {
  return row.periods['1d'].publicVisits;
}

function shortProductName(row: PublicTrafficProductDataRow, productNameMap: ProductNameMap = {}): string {
  return resolveProductDisplayName(row, productNameMap);
}

function shortNewProductName(name: string): string {
  return name.length > 18 ? `${name.slice(0, 18)}...` : name;
}

function findRowByIdentifier(context: PublicTrafficDataReportContext, identifier: string): PublicTrafficProductDataRow | undefined {
  const id = identifier.replace(/^端内ID\s*/, '');
  return context.rows.find((row) => row.displayProductId === identifier || shortId(row) === id);
}

function exposureTopRows(context: PublicTrafficDataReportContext, productNameMap: ProductNameMap): FeishuTableRow[] {
  return [...context.rows].sort((a, b) => rowScore(b) - rowScore(a)).slice(0, 10).map((row) => {
    const one = row.periods['1d'];
    return { product: shortProductName(row, productNameMap), id: shortId(row), exposure: one.exposure, visits: visits(row), amount: Number(one.amount.toFixed(2)) };
  });
}

function exposureBoostRows(context: PublicTrafficDataReportContext, productNameMap: ProductNameMap): FeishuTableRow[] {
  return context.rows
    .filter((row) => row.periods['1d'].hasExposureData && row.periods['1d'].exposure >= 0 && row.periods['1d'].exposure <= 50 && typeof row.custodyDays === 'number' && row.custodyDays > 7)
    .sort((a, b) => a.periods['1d'].exposure - b.periods['1d'].exposure || (b.custodyDays ?? 0) - (a.custodyDays ?? 0) || visits(a) - visits(b))
    .map((row) => ({ product: shortProductName(row, productNameMap), id: shortId(row), exposure: row.periods['1d'].exposure, visits: visits(row), custodyDays: row.custodyDays ?? '-' }));
}

function conversionRows(context: PublicTrafficDataReportContext, productNameMap: ProductNameMap): FeishuTableRow[] {
  return context.weakConversion
    .map((item) => findRowByIdentifier(context, item.identifier))
    .filter((row): row is PublicTrafficProductDataRow => Boolean(row))
    .map((row) => ({ product: shortProductName(row, productNameMap), id: shortId(row), visits: visits(row), amount: Number(row.periods['1d'].amount.toFixed(2)), rate: percent(row.periods['1d'].exposureVisitRate) }));
}

function scaleRows(context: PublicTrafficDataReportContext, productNameMap: ProductNameMap): FeishuTableRow[] {
  return context.highPotential
    .map((item) => findRowByIdentifier(context, item.identifier))
    .filter((row): row is PublicTrafficProductDataRow => Boolean(row))
    .map((row) => ({ product: shortProductName(row, productNameMap), id: shortId(row), exposure: row.periods['1d'].exposure, visits: visits(row), amount: Number(row.periods['1d'].amount.toFixed(2)) }));
}

function newProductPoolCount(context: PublicTrafficDataReportContext): number {
  return context.newProductPoolItems?.length ? context.newProductPoolItems.length : context.newProductPoolIds?.length ?? context.newProductObservation.length;
}

type ColdStartStatus = '强跑通' | '优秀链接' | '访问达标' | '有苗头' | '未启动' | '危险' | '待观察';

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

const coldStartStatusMeta: Array<{ status: ColdStartStatus; criteria: string; action: string }> = [
  { status: '强跑通', criteria: '7天金额 >0', action: '继续放量' },
  { status: '优秀链接', criteria: '日均访问 >=10', action: '放量观察' },
  { status: '访问达标', criteria: '日均访问 >=6', action: '看转化' },
  { status: '有苗头', criteria: '日均访问 3-5.9', action: '优化图/价/标题' },
  { status: '未启动', criteria: '日均访问 <3', action: '补曝光' },
  { status: '危险', criteria: '72h 0访问 / 日均<1', action: '优先重做' },
  { status: '待观察', criteria: '日报未匹配', action: '确认链接同步' },
];

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
  const statusLines = coldStartStatusMeta
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

function analysisSummary(context: PublicTrafficDataReportContext, boostRows: FeishuTableRow[], conversionRowsData: FeishuTableRow[], scaleRowsData: FeishuTableRow[]): Record<string, unknown> {
  const conclusionLines = context.conclusions.slice(0, 4).map((item) => `- **${item.label}**：${item.text}`);
  const lines = [
    '**分析与建议**',
    ...conclusionLines,
    `- **动作聚焦**：补曝光 ${boostRows.length} 个；提转化 ${conversionRowsData.length} 个；继续放量 ${scaleRowsData.length} 个。`,
    `- **建议**：提转化仅看单品1日有访问无公域金额；继续放量仅看单品1日已产生公域金额；新品 ${newProductPoolCount(context)} 个先进入维护池观察。`,
  ];
  return { tag: 'markdown', content: lines.join('\n') };
}

function newProductPoolPanel(context: PublicTrafficDataReportContext): Record<string, unknown> {
  const count = newProductPoolCount(context);
  const coldStartRows = newLinkColdStartRows(context);
  const fallbackPreview = context.newProductPoolItems?.length
    ? sortNewProductPoolItems(context.newProductPoolItems).slice(0, 10).map((item) => `- 商品ID ${item.productId} ${shortNewProductName(item.productName)}：待观察`).join('\n')
    : context.newProductPoolIds?.length
      ? context.newProductPoolIds.slice(0, 10).map((id) => `- 商品ID ${id}：待观察`).join('\n')
      : context.newProductObservation.slice(0, 10).map((item) => `- ${item.identifier}：${item.reason}`).join('\n');
  const statusCounts = (status: ColdStartStatus): number => coldStartRows.filter((row) => row.status === status).length;
  const elements: Record<string, unknown>[] = coldStartRows.length > 0
    ? [
        { tag: 'markdown', content: coldStartMarkdown(coldStartRows, count, fallbackPreview) },
      ]
    : [{ tag: 'markdown', content: [`近7天链接 ${count} 条。`, fallbackPreview].filter(Boolean).join('\n') }];
  return {
    tag: 'collapsible_panel',
    element_id: 'new_product_pool',
    expanded: false,
    header: { title: { tag: 'plain_text', content: `新链接冷启动（${count}）` }, vertical_align: 'center', icon: { tag: 'standard_icon', token: 'down-small-ccm_outlined', size: '16px 16px' }, icon_position: 'right', icon_expanded_angle: -180 },
    border: { color: 'grey', corner_radius: '5px' },
    padding: '8px 8px 8px 8px',
    elements,
  };
}

function metricTables(context: PublicTrafficDataReportContext, productNameMap: ProductNameMap): Record<string, unknown>[] {
  const boostRows = exposureBoostRows(context, productNameMap);
  const conversionRowsData = conversionRows(context, productNameMap);
  const scaleRowsData = scaleRows(context, productNameMap);
  const custodyAbnormalRows: FeishuTableRow[] = (context.custodyAbnormal ?? []).map((item) => ({ id: item.identifier, status: item.reason, action: item.action }));
  const optimizationTables: Record<string, unknown>[] = [];
  if (boostRows.length > 0) optimizationTables.push(tableElement('boost_table', [tableColumn('product', `补曝光（${boostRows.length}）`), tableColumn('id', 'ID'), tableColumn('exposure', '曝光', 'number'), tableColumn('visits', '访问', 'number'), tableColumn('custodyDays', '托管天')], boostRows));
  if (conversionRowsData.length > 0) optimizationTables.push(tableElement('conversion_table', [tableColumn('product', `提转化（${conversionRowsData.length}）`), tableColumn('id', 'ID'), tableColumn('visits', '公域访问', 'number'), tableColumn('amount', '公域金额', 'number'), tableColumn('rate', '转化率')], conversionRowsData));
  if (scaleRowsData.length > 0) optimizationTables.push(tableElement('scale_table', [tableColumn('product', `继续放量（${scaleRowsData.length}）`), tableColumn('id', 'ID'), tableColumn('exposure', '曝光', 'number'), tableColumn('visits', '公域访问', 'number'), tableColumn('amount', '公域金额', 'number')], scaleRowsData));
  return [
    analysisSummary(context, boostRows, conversionRowsData, scaleRowsData),
    ...(custodyAbnormalRows.length > 0 ? [{ tag: 'hr' }, { tag: 'markdown', content: '**托管异常**' }, tableElement('custody_abnormal_table', [tableColumn('id', 'ID'), tableColumn('status', '商品/状态'), tableColumn('action', '处理建议')], custodyAbnormalRows)] : []),
    { tag: 'hr' },
    { tag: 'markdown', content: '**曝光 Top10**' },
    tableElement('exposure_top_table', [tableColumn('product', '商品'), tableColumn('id', 'ID'), tableColumn('exposure', '曝光', 'number'), tableColumn('visits', '公域访问', 'number'), tableColumn('amount', '公域金额', 'number')], exposureTopRows(context, productNameMap)),
    ...(optimizationTables.length > 0 ? [{ tag: 'hr' }, { tag: 'markdown', content: '**待优化**' }, ...optimizationTables] : []),
    { tag: 'hr' },
    newProductPoolPanel(context),
  ];
}

export function buildPublicTrafficCard(context: PublicTrafficDataReportContext, _paths: PublicTrafficReportPaths, options: PublicTrafficCardOptions = {}): FeishuCardPayload {
  const one = context.summary['1d'];
  const productNameMap = options.productNameMap ?? {};
  const sourceStatus = dataSourceStatus(context);
  return {
    schema: '2.0',
    config: { update_multi: true },
    header: {
      title: { tag: 'plain_text', content: `公域数据日报 ${context.date}` },
      template: sourceStatus.template,
    },
    body: {
      elements: [
        { tag: 'markdown', content: sourceStatus.text },
        ...funnelElements(context),
        { tag: 'hr' },
        ...metricTables(context, productNameMap),
      ],
    },
  };
}
