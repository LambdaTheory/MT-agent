import type { FeishuCardPayload } from '../notify/feishuApp.js';
import { findOrderAnalysisIndicator, fulfillmentRateLines, shortDataDate } from './orderAnalysis.js';
import type { PublicTrafficDataReportContext, PublicTrafficProductDataRow, PublicTrafficReportPaths } from './types.js';

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function productLine(row: PublicTrafficProductDataRow, index: number): string {
  const one = row.periods['1d'];
  const visits = one.publicVisits || one.dashboardVisits;
  return `${index + 1}. ${row.displayProductId}｜${row.productName || 'Unknown'}｜曝光 ${one.exposure}｜访问 ${visits}｜金额 ¥${one.amount.toFixed(2)}`;
}

function topExposureText(rows: PublicTrafficProductDataRow[]): string {
  const score = (row: PublicTrafficProductDataRow) => row.periods['1d'].exposure || row.periods['1d'].publicVisits || row.periods['1d'].dashboardVisits;
  const items = [...rows].sort((a, b) => score(b) - score(a)).slice(0, 10);
  const lines = items.map(productLine);
  return `**今日曝光 Top10**\n${lines.join('\n')}`;
}

function warningProductsText(rows: PublicTrafficProductDataRow[]): string {
  const items = rows
    .filter((row) => typeof row.custodyDays === 'number' && row.custodyDays > 5 && row.periods['1d'].exposure < 100)
    .sort((a, b) => a.periods['1d'].exposure - b.periods['1d'].exposure || (b.custodyDays ?? 0) - (a.custodyDays ?? 0))
    .slice(0, 15);
  if (items.length === 0) return '';
  const lines = items.map((row, index) => `${productLine(row, index)}｜托管 ${row.custodyDays}天`);
  return `**预警商品（托管>5天 且 曝光<100）**\n${lines.join('\n')}`;
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

function optionalElement(element: Record<string, unknown> | null): Record<string, unknown>[] {
  return element ? [element] : [];
}

function conclusionMarkdown(context: PublicTrafficDataReportContext): Record<string, unknown> {
  const lines = context.conclusions.map((item) => `**${item.label}**\n${item.text}`);
  return { tag: 'markdown', content: ['**经营结论**', ...lines].join('\n') };
}

function funnelColumnSet(one: PublicTrafficDataReportContext['summary']['1d']): Record<string, unknown> {
  return columnSet([
    `**公域**\n曝光 **${one.exposure}**\n公域访问 **${one.publicVisits}**\n后链路访问 **${one.dashboardVisits}**\n金额 **¥${one.amount.toFixed(2)}**`,
    `**订单**\n创建订单 **${one.createdOrders}**\n发货订单 **${one.shippedOrders}**`,
    `**履约**\n访问到发货率 **${percent(one.visitShipmentRate)}**`,
  ], 'funnel_summary');
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
    columnSet([
      `**公域（${context.date}）**\n曝光 **${one.exposure}**\n公域访问 **${one.publicVisits}**\n后链路访问 **${one.dashboardVisits}**\n金额 **¥${one.amount.toFixed(2)}**`,
      `**订单（${shortDataDate(overview?.dataDate)}）**\n创建订单 **${findOrderAnalysisIndicator(overview, ['创建订单数'])}**\n签约订单 **${findOrderAnalysisIndicator(overview, ['签约订单数'])}**\n审出订单 **${findOrderAnalysisIndicator(overview, ['审出订单数'])}**\n发货订单 **${findOrderAnalysisIndicator(overview, ['发货订单数'])}**\n签约金额 **${findOrderAnalysisIndicator(overview, ['签约完成金额（元）', '签约完成金额'])}**`,
      `**履约（发货${shortDataDate(delivery?.dataDate)}｜归还${shortDataDate(returns?.dataDate)}｜关单${shortDataDate(customs?.dataDate)}）**\n待发货 **${findOrderAnalysisIndicator(delivery, ['待发货订单数'])}**\n归还 **${findOrderAnalysisIndicator(returns, ['归还订单数'])}**\n逾期 **${findOrderAnalysisIndicator(returns, ['逾期订单数'])}**\n关单 **${findOrderAnalysisIndicator(customs, ['关单数'])}**`,
    ], 'funnel_summary'),
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

type TableColumnKey = 'product' | 'id' | 'exposure' | 'visits' | 'deals' | 'custodyDays';

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
  const one = row.periods['1d'];
  return one.exposure || one.publicVisits || one.dashboardVisits;
}

function exposureTopRows(context: PublicTrafficDataReportContext): FeishuTableRow[] {
  return [...context.rows].sort((a, b) => rowScore(b) - rowScore(a)).slice(0, 10).map((row) => {
    const one = row.periods['1d'];
    return { product: row.productName || 'Unknown', id: shortId(row), exposure: one.exposure, visits: one.publicVisits || one.dashboardVisits, deals: one.shippedOrders };
  });
}

function exposureBandRows(context: PublicTrafficDataReportContext, min: number, max: number): FeishuTableRow[] {
  return context.rows
    .filter((row) => row.periods['1d'].hasExposureData && row.periods['1d'].exposure >= min && row.periods['1d'].exposure < max)
    .sort((a, b) => a.periods['1d'].exposure - b.periods['1d'].exposure || (b.periods['1d'].publicVisits || b.periods['1d'].dashboardVisits) - (a.periods['1d'].publicVisits || a.periods['1d'].dashboardVisits))
    .map((row) => ({ id: shortId(row), exposure: row.periods['1d'].exposure, visits: row.periods['1d'].publicVisits || row.periods['1d'].dashboardVisits, custodyDays: row.custodyDays ?? '-' }));
}

function analysisPanel(context: PublicTrafficDataReportContext, bands: Array<{ label: string; rows: FeishuTableRow[] }>): Record<string, unknown> {
  const lines = [
    `- **曝光优化**：${bands.map((band) => `${band.label} ${band.rows.length}个`).join('；')}。优先检查托管状态、标题、主图、类目和投放。`,
    `- **转化链路**：转化弱 ${context.weakConversion.length} 个。优先检查价格、押金、库存、风控和履约链路。`,
    `- **新品观察**：当前 ${context.newProductObservation.length} 个，先不展开商品列表，后续单独澄清新品观察口径。`,
  ];
  return {
    tag: 'collapsible_panel',
    element_id: 'analysis_panel',
    expanded: false,
    header: { title: { tag: 'plain_text', content: '分析与建议' }, vertical_align: 'center', icon: { tag: 'standard_icon', token: 'down-small-ccm_outlined', size: '16px 16px' }, icon_position: 'right', icon_expanded_angle: -180 },
    border: { color: 'grey', corner_radius: '5px' },
    padding: '8px 8px 8px 8px',
    elements: [{ tag: 'markdown', content: lines.join('\n') }],
  };
}

function metricTables(context: PublicTrafficDataReportContext): Record<string, unknown>[] {
  const bands = [
    { label: '曝光 0-10', elementId: 'exposure_0_10_table', rows: exposureBandRows(context, 0, 10) },
    { label: '曝光 10-50', elementId: 'exposure_10_50_table', rows: exposureBandRows(context, 10, 50) },
    { label: '曝光 50-100', elementId: 'exposure_50_100_table', rows: exposureBandRows(context, 50, 100) },
  ];
  const bandColumns = [tableColumn('id', 'ID'), tableColumn('exposure', '曝光', 'number'), tableColumn('visits', '访问', 'number'), tableColumn('custodyDays', '托管天')];
  return [
    { tag: 'markdown', content: '**曝光 Top10**' },
    tableElement('exposure_top_table', [tableColumn('product', '商品'), tableColumn('id', 'ID'), tableColumn('exposure', '曝光', 'number'), tableColumn('visits', '访问', 'number'), tableColumn('deals', '成交', 'number')], exposureTopRows(context)),
    { tag: 'hr' },
    { tag: 'markdown', content: '**待优化**' },
    ...bands.flatMap((band) => [{ tag: 'markdown', content: `**${band.label}（${band.rows.length}个）**` }, tableElement(band.elementId, bandColumns, band.rows)]),
    { tag: 'hr' },
    analysisPanel(context, bands),
  ];
}

export function buildPublicTrafficCard(context: PublicTrafficDataReportContext, _paths: PublicTrafficReportPaths): FeishuCardPayload {
  const one = context.summary['1d'];
  const warningText = warningProductsText(context.rows);
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
        ...markdownElement(warningText),
      ],
    },
  };
}
