import type { FeishuCardPayload } from '../notify/feishuApp.js';
import { findOrderAnalysisIndicator, fulfillmentRateLines, shortDataDate } from './orderAnalysis.js';
import type { PublicTrafficDataReportContext, PublicTrafficProductDataRow, PublicTrafficReportPaths } from './types.js';

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function dataQualityText(context: PublicTrafficDataReportContext): string | null {
  return context.dataQualityNotes?.length ? `**数据提示**\n${context.dataQualityNotes.join('\n')}` : null;
}

function rateText(one: PublicTrafficDataReportContext['summary']['1d']): string {
  return `**转化率**\n曝光到访问率 ${percent(one.exposureVisitRate)}｜访问到发货率 ${percent(one.visitShipmentRate)}`;
}

function shortId(row: PublicTrafficProductDataRow): string {
  return row.displayProductId.replace(/^端内ID\s*/, '') || row.displayProductId;
}

function fulfillmentRateText(context: PublicTrafficDataReportContext): string | null {
  const lines = fulfillmentRateLines(context.orderAnalysis?.pages.overview);
  return lines.length > 0 ? ['**履约比率**', ...lines].join('\n') : null;
}

function moduleCounts(context: PublicTrafficDataReportContext): Array<[string, number]> {
  const counts: Array<[string, number]> = [
    ['曝光不足', context.lowExposure.length],
    ['点击弱', context.weakClick.length],
    ['转化弱', context.weakConversion.length],
    ['高潜力', context.highPotential.length],
    ['新品观察', context.newProductObservation.length],
    ['生命周期治理', context.lifecycleGovernance.length],
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

function nestedMetricColumn(title: string, metrics: FunnelMetric[]): Record<string, unknown> {
  return {
    tag: 'column',
    width: 'weighted',
    weight: 1,
    vertical_align: 'top',
    elements: [{ tag: 'markdown', content: `**${title}**` }, ...chunkMetrics(metrics).map((chunk) => metricCardRow(chunk))],
  };
}

function orderMetric(page: Parameters<typeof findOrderAnalysisIndicator>[0], label: string, names: string[]): FunnelMetric {
  const value = findOrderAnalysisIndicator(page, names);
  const indicator = page?.indicators.find((item) => names.includes(item.label));
  const delta = indicator?.delta && indicator.delta !== '较前日-' ? indicator.delta : undefined;
  return [label, value, delta];
}

function nestedFunnelColumnSet(groups: Array<{ title: string; metrics: FunnelMetric[] }>, elementId = 'funnel_summary'): Record<string, unknown> {
  return {
    tag: 'column_set',
    element_id: elementId,
    flex_mode: 'stretch',
    horizontal_spacing: '8px',
    columns: groups.map((group) => nestedMetricColumn(group.title, group.metrics)),
  };
}

function optionalElement(element: Record<string, unknown> | null): Record<string, unknown>[] {
  return element ? [element] : [];
}

function conclusionMarkdown(context: PublicTrafficDataReportContext): Record<string, unknown> {
  const lines = context.conclusions.map((item) => `**${item.label}**\n${item.text}`);
  return { tag: 'markdown', content: ['**经营结论**', ...lines].join('\n') };
}

function funnelColumnSet(one: PublicTrafficDataReportContext['summary']['1d']): Record<string, unknown> {
  return { tag: 'column_set', element_id: 'funnel_summary', flex_mode: 'stretch', horizontal_spacing: '8px', columns: [
    nestedMetricColumn('公域', [['曝光', String(one.exposure)], ['访问', String(one.publicVisits)], ['金额', `¥${one.amount.toFixed(2)}`]]),
    nestedMetricColumn('订单', [['创建', String(one.createdOrders)], ['发货', String(one.shippedOrders)]]),
  ] };
}

function funnelElements(context: PublicTrafficDataReportContext): Record<string, unknown>[] {
  const one = context.summary['1d'];
  const oa = context.orderAnalysis;
  if (!oa) {
    return [funnelColumnSet(one)];
  }
  const overview = oa.pages.overview;
  const delivery = oa.pages.delivery;
  const returns = oa.pages.return;
  const customs = oa.pages.customs;
  return [
    nestedFunnelColumnSet([
      { title: `公域（${context.date}）`, metrics: [['曝光', String(one.exposure)], ['公域访问', String(one.publicVisits)], ['商品页访问', String(one.dashboardVisits)]] },
    ], 'funnel_public'),
    nestedFunnelColumnSet([
      { title: `订单（${shortDataDate(overview?.dataDate)}）`, metrics: [orderMetric(overview, '创建订单', ['创建订单数']), orderMetric(overview, '签约订单', ['签约订单数']), orderMetric(overview, '审出订单', ['审出订单数'])] },
      { title: '订单补充', metrics: [orderMetric(overview, '发货订单', ['发货订单数']), orderMetric(overview, '签约金额', ['签约完成金额（元）', '签约完成金额']), ['公域金额', `¥${one.amount.toFixed(2)}`]] },
    ], 'funnel_order'),
    nestedFunnelColumnSet([
      { title: `履约（发货${shortDataDate(delivery?.dataDate)}｜归还${shortDataDate(returns?.dataDate)}｜关单${shortDataDate(customs?.dataDate)}）`, metrics: [orderMetric(delivery, '待发货', ['待发货订单数']), orderMetric(returns, '归还', ['归还订单数']), orderMetric(returns, '逾期', ['逾期订单数']), orderMetric(customs, '关单', ['关单数'])] },
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

type TableColumnKey = 'product' | 'id' | 'exposure' | 'visits' | 'deals' | 'custodyDays' | 'rate';

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
  const one = row.periods['1d'];
  return one.publicVisits || one.dashboardVisits;
}

function shortProductName(row: PublicTrafficProductDataRow): string {
  const name = row.productName || 'Unknown';
  return name.length > 18 ? `${name.slice(0, 18)}...` : name;
}

function findRowByIdentifier(context: PublicTrafficDataReportContext, identifier: string): PublicTrafficProductDataRow | undefined {
  const id = identifier.replace(/^端内ID\s*/, '');
  return context.rows.find((row) => row.displayProductId === identifier || shortId(row) === id);
}

function exposureTopRows(context: PublicTrafficDataReportContext): FeishuTableRow[] {
  return [...context.rows].sort((a, b) => rowScore(b) - rowScore(a)).slice(0, 10).map((row) => {
    const one = row.periods['1d'];
    return { product: shortProductName(row), id: shortId(row), exposure: one.exposure, visits: visits(row), deals: one.shippedOrders };
  });
}

function exposureBoostRows(context: PublicTrafficDataReportContext): FeishuTableRow[] {
  return context.rows
    .filter((row) => row.periods['1d'].hasExposureData && row.periods['1d'].exposure >= 0 && row.periods['1d'].exposure <= 50 && typeof row.custodyDays === 'number' && row.custodyDays > 7)
    .sort((a, b) => a.periods['1d'].exposure - b.periods['1d'].exposure || (b.custodyDays ?? 0) - (a.custodyDays ?? 0) || visits(a) - visits(b))
    .map((row) => ({ product: shortProductName(row), id: shortId(row), exposure: row.periods['1d'].exposure, visits: visits(row), custodyDays: row.custodyDays ?? '-' }));
}

function conversionRows(context: PublicTrafficDataReportContext): FeishuTableRow[] {
  return context.weakConversion
    .map((item) => findRowByIdentifier(context, item.identifier))
    .filter((row): row is PublicTrafficProductDataRow => Boolean(row))
    .map((row) => ({ product: shortProductName(row), id: shortId(row), visits: visits(row), deals: row.periods['1d'].shippedOrders, rate: percent(row.periods['1d'].visitShipmentRate) }));
}

function scaleRows(context: PublicTrafficDataReportContext): FeishuTableRow[] {
  return context.highPotential
    .map((item) => findRowByIdentifier(context, item.identifier))
    .filter((row): row is PublicTrafficProductDataRow => Boolean(row))
    .map((row) => ({ product: shortProductName(row), id: shortId(row), exposure: row.periods['1d'].exposure, visits: visits(row), deals: row.periods['1d'].shippedOrders }));
}

function analysisSummary(context: PublicTrafficDataReportContext, boostRows: FeishuTableRow[], conversionRowsData: FeishuTableRow[], scaleRowsData: FeishuTableRow[]): Record<string, unknown> {
  const conclusionLines = context.conclusions.slice(0, 4).map((item) => `- **${item.label}**：${item.text}`);
  const lines = [
    '**分析与建议**',
    ...conclusionLines,
    `- **动作聚焦**：补曝光 ${boostRows.length} 个；提转化 ${conversionRowsData.length} 个；继续放量 ${scaleRowsData.length} 个。`,
    `- **建议**：优先排查成交/转化弱商品，再处理托管超过 7 天且曝光 0-50 的商品；新品 ${context.newProductObservation.length} 个先进入维护池观察。`,
  ];
  return { tag: 'markdown', content: lines.join('\n') };
}

function newProductPoolPanel(context: PublicTrafficDataReportContext): Record<string, unknown> {
  const preview = context.newProductObservation.slice(0, 10).map((item) => `- ${item.identifier}：${item.reason}`).join('\n');
  return {
    tag: 'collapsible_panel',
    element_id: 'new_product_pool',
    expanded: false,
    header: { title: { tag: 'plain_text', content: `新品维护池（${context.newProductObservation.length}）` }, vertical_align: 'center', icon: { tag: 'standard_icon', token: 'down-small-ccm_outlined', size: '16px 16px' }, icon_position: 'right', icon_expanded_angle: -180 },
    border: { color: 'grey', corner_radius: '5px' },
    padding: '8px 8px 8px 8px',
    elements: [{ tag: 'markdown', content: [`当前新品观察 ${context.newProductObservation.length} 个。后续需要单独设计新品维护池：进入、观察、转动作、冷却、退出。`, preview].filter(Boolean).join('\n') }],
  };
}

function metricTables(context: PublicTrafficDataReportContext): Record<string, unknown>[] {
  const boostRows = exposureBoostRows(context);
  const conversionRowsData = conversionRows(context);
  const scaleRowsData = scaleRows(context);
  return [
    analysisSummary(context, boostRows, conversionRowsData, scaleRowsData),
    { tag: 'hr' },
    { tag: 'markdown', content: '**曝光 Top10**' },
    tableElement('exposure_top_table', [tableColumn('product', '商品'), tableColumn('id', 'ID'), tableColumn('exposure', '曝光', 'number'), tableColumn('visits', '访问', 'number'), tableColumn('deals', '成交', 'number')], exposureTopRows(context)),
    { tag: 'hr' },
    { tag: 'markdown', content: '**待优化**' },
    tableElement('boost_table', [tableColumn('product', `补曝光（${boostRows.length}）`), tableColumn('id', 'ID'), tableColumn('exposure', '曝光', 'number'), tableColumn('visits', '访问', 'number'), tableColumn('custodyDays', '托管天')], boostRows),
    tableElement('conversion_table', [tableColumn('product', `提转化（${conversionRowsData.length}）`), tableColumn('id', 'ID'), tableColumn('visits', '访问', 'number'), tableColumn('deals', '成交', 'number'), tableColumn('rate', '转化率')], conversionRowsData),
    tableElement('scale_table', [tableColumn('product', `继续放量（${scaleRowsData.length}）`), tableColumn('id', 'ID'), tableColumn('exposure', '曝光', 'number'), tableColumn('visits', '访问', 'number'), tableColumn('deals', '成交', 'number')], scaleRowsData),
    { tag: 'hr' },
    newProductPoolPanel(context),
  ];
}

export function buildPublicTrafficCard(context: PublicTrafficDataReportContext, _paths: PublicTrafficReportPaths): FeishuCardPayload {
  const one = context.summary['1d'];
  return {
    schema: '2.0',
    config: { update_multi: true },
    header: {
      title: { tag: 'plain_text', content: `公域数据日报 ${context.date}` },
      template: 'blue',
    },
    body: {
      elements: [
        conclusionMarkdown(context),
        { tag: 'hr' },
        { tag: 'markdown', content: '**今日漏斗**' },
        ...funnelElements(context),
        { tag: 'markdown', content: rateText(one) },
        ...markdownElement(fulfillmentRateText(context)),
        ...markdownElement(dataQualityText(context)),
        ...optionalElement(moduleColumnSet(context)),
        { tag: 'hr' },
        ...metricTables(context),
      ],
    },
  };
}
