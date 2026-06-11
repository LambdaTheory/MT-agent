import type { FeishuCardPayload } from '../notify/feishuApp.js';
import { findOrderAnalysisIndicator, shortDataDate } from './orderAnalysis.js';
import type { OrderAnalysisPageData } from './orderAnalysis.js';
import type { PublicTrafficDataReportContext, PublicTrafficProductDataRow, PublicTrafficReportPaths, PublicTrafficReportSectionItem } from './types.js';

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

function parseOrderAnalysisNumber(value: string): number | null {
  const normalized = value.replace(/,/g, '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function orderAnalysisNumber(page: OrderAnalysisPageData | undefined, labels: string[]): number | null {
  return parseOrderAnalysisNumber(findOrderAnalysisIndicator(page, labels));
}

function fulfillmentRate(numerator: number | null, denominator: number | null): string {
  if (numerator === null || denominator === null || denominator === 0) return '-';
  return percent(numerator / denominator);
}

function fulfillmentRateText(overview: OrderAnalysisPageData | undefined): string | null {
  if (!overview) return null;
  const created = orderAnalysisNumber(overview, ['创建订单数']);
  const signed = orderAnalysisNumber(overview, ['签约订单数']);
  const reviewed = orderAnalysisNumber(overview, ['审出订单数']);
  const shipped = orderAnalysisNumber(overview, ['发货订单数']);
  return [
    `**履约比率**`,
    `签约/创建 ${fulfillmentRate(signed, created)}｜审出/签约 ${fulfillmentRate(reviewed, signed)}｜发货/审出 ${fulfillmentRate(shipped, reviewed)}`,
    '暂无昨日履约率对比',
  ].join('\n');
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
    elements: [{ tag: 'markdown', content }],
  };
}

function columnSet(columns: string[]): Record<string, unknown> {
  return { tag: 'column_set', columns: columns.map(markdownColumn) };
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
    `曝光\n**${one.exposure}**`,
    `公域访问\n**${one.publicVisits}**`,
    `后链路访问\n**${one.dashboardVisits}**`,
    `订单\n**${one.createdOrders}**`,
    `发货\n**${one.shippedOrders}**`,
    `金额\n**¥${one.amount.toFixed(2)}**`,
  ]);
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
    { tag: 'markdown', content: `公域（${context.date}）` },
    columnSet([
      `曝光\n**${one.exposure}**`,
      `公域访问\n**${one.publicVisits}**`,
      `后链路访问\n**${one.dashboardVisits}**`,
      `金额\n**¥${one.amount.toFixed(2)}**`,
    ]),
    { tag: 'markdown', content: `订单（${shortDataDate(overview?.dataDate)}）` },
    columnSet([
      `创建订单\n**${findOrderAnalysisIndicator(overview, ['创建订单数'])}**`,
      `签约订单\n**${findOrderAnalysisIndicator(overview, ['签约订单数'])}**`,
      `审出订单\n**${findOrderAnalysisIndicator(overview, ['审出订单数'])}**`,
      `发货订单\n**${findOrderAnalysisIndicator(overview, ['发货订单数'])}**`,
      `签约金额\n**${findOrderAnalysisIndicator(overview, ['签约完成金额（元）', '签约完成金额'])}**`,
    ]),
    { tag: 'markdown', content: `履约（发货${shortDataDate(delivery?.dataDate)}｜归还${shortDataDate(returns?.dataDate)}｜关单${shortDataDate(customs?.dataDate)}）` },
    columnSet([
      `待发货\n**${findOrderAnalysisIndicator(delivery, ['待发货订单数'])}**`,
      `归还\n**${findOrderAnalysisIndicator(returns, ['归还订单数'])}**`,
      `逾期\n**${findOrderAnalysisIndicator(returns, ['逾期订单数'])}**`,
      `关单\n**${findOrderAnalysisIndicator(customs, ['关单数'])}**`,
    ]),
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

type TableColumnKey = 'type' | 'product' | 'action' | 'reason';

interface FeishuTableColumn {
  name: TableColumnKey;
  display_name: string;
  data_type: 'text';
  horizontal_align: 'left';
  width: 'auto';
}

type FeishuTableRow = Partial<Record<TableColumnKey, string>>;

interface FeishuTableElement extends Record<string, unknown> {
  tag: 'table';
  element_id: string;
  page_size: 10;
  row_height: 'auto';
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

function tableColumn(name: TableColumnKey, displayName: string): FeishuTableColumn {
  return { name, display_name: displayName, data_type: 'text', horizontal_align: 'left', width: 'auto' };
}

function tableElement(elementId: string, columns: FeishuTableColumn[], rows: FeishuTableRow[]): FeishuTableElement | null {
  if (rows.length === 0) return null;
  return {
    tag: 'table',
    element_id: elementId,
    page_size: 10,
    row_height: 'auto',
    row_max_height: '124px',
    freeze_first_column: true,
    header_style: { background_style: 'grey', text_size: 'normal', text_align: 'left' },
    columns,
    rows,
  };
}

function diagnosticRows(context: PublicTrafficDataReportContext): FeishuTableRow[] {
  const sections: Array<[string, PublicTrafficReportSectionItem[]]> = [
    ['曝光不足', context.lowExposure],
    ['点击弱', context.weakClick],
    ['转化弱', context.weakConversion],
    ['高潜力', context.highPotential],
    ['生命周期治理', context.lifecycleGovernance],
  ];
  return sections.flatMap(([type, items]) => items.map((item) => ({ type, product: item.identifier, action: item.action, reason: item.reason })));
}

function sectionTypeKey(item: PublicTrafficReportSectionItem): string {
  return `${item.identifier}\u0000${item.action}\u0000${item.reason}`;
}

function sectionTypeByItem(context: PublicTrafficDataReportContext): Map<string, string> {
  const sections: Array<[string, PublicTrafficReportSectionItem[]]> = [
    ['曝光不足', context.lowExposure],
    ['点击弱', context.weakClick],
    ['转化弱', context.weakConversion],
    ['高潜力', context.highPotential],
    ['新品观察', context.newProductObservation],
    ['生命周期治理', context.lifecycleGovernance],
  ];
  const map = new Map<string, string>();
  for (const [type, items] of sections) {
    for (const item of items) {
      const key = sectionTypeKey(item);
      if (!map.has(key)) map.set(key, type);
    }
  }
  return map;
}

function actionRows(context: PublicTrafficDataReportContext): FeishuTableRow[] {
  const typeByItem = sectionTypeByItem(context);
  return [...context.recommendedActions]
    .sort((a, b) => a.action.localeCompare(b.action, 'zh-Hans-CN') || a.identifier.localeCompare(b.identifier, 'zh-Hans-CN'))
    .map((item) => ({ action: item.action, type: typeByItem.get(sectionTypeKey(item)) ?? '', product: item.identifier, reason: item.reason }));
}

function newProductRows(context: PublicTrafficDataReportContext): FeishuTableRow[] {
  return context.newProductObservation.map((item) => ({ product: item.identifier, action: item.action, reason: item.reason }));
}

function diagnosticTables(context: PublicTrafficDataReportContext): Record<string, unknown>[] {
  return [
    tableElement('diag_table', [tableColumn('type', '类型'), tableColumn('product', '商品'), tableColumn('action', '动作'), tableColumn('reason', '原因')], diagnosticRows(context)),
    tableElement('action_table', [tableColumn('action', '动作'), tableColumn('type', '类型'), tableColumn('product', '商品'), tableColumn('reason', '原因')], actionRows(context)),
    tableElement('new_table', [tableColumn('product', '商品'), tableColumn('action', '动作'), tableColumn('reason', '原因')], newProductRows(context)),
  ].filter((element): element is FeishuTableElement => element !== null);
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
        ...markdownElement(fulfillmentRateText(context.orderAnalysis?.pages.overview)),
        ...markdownElement(dataQualityText(context)),
        ...optionalElement(moduleColumnSet(context)),
        { tag: 'hr' },
        { tag: 'markdown', content: topExposureText(context.rows) },
        ...markdownElement(warningText),
        { tag: 'hr' },
        ...diagnosticTables(context),
      ],
    },
  };
}
