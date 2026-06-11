import type { FeishuCardPayload } from '../notify/feishuApp.js';
import { findOrderAnalysisIndicator, shortDataDate } from './orderAnalysis.js';
import type { PublicTrafficDataReportContext, PublicTrafficProductDataRow, PublicTrafficReportPaths, PublicTrafficReportSectionItem } from './types.js';

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function optionalTopText(title: string, items: PublicTrafficReportSectionItem[], limit = 5): string | null {
  if (items.length === 0) return null;
  return `**${title}**\n${items.slice(0, limit).map((item, index) => `${index + 1}. ${item.identifier}｜${item.action}｜${item.reason}`).join('\n')}`;
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

function conclusionColumnSet(context: PublicTrafficDataReportContext): Record<string, unknown> {
  const lines = context.conclusions.map((item) => `**${item.label}**\n${item.text}`);
  return columnSet(['**经营结论**', ...lines].slice(0, 3));
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
        conclusionColumnSet(context),
        { tag: 'hr' },
        { tag: 'markdown', content: '**今日漏斗**' },
        ...funnelElements(context),
        { tag: 'markdown', content: rateText(one) },
        ...markdownElement(dataQualityText(context)),
        ...optionalElement(moduleColumnSet(context)),
        { tag: 'hr' },
        { tag: 'markdown', content: topExposureText(context.rows) },
        ...markdownElement(warningText),
        { tag: 'hr' },
        ...markdownElement(optionalTopText('建议操作', context.recommendedActions, 8)),
        { tag: 'hr' },
        ...markdownElement(optionalTopText('曝光不足 Top5', context.lowExposure)),
        ...markdownElement(optionalTopText('点击弱 Top5', context.weakClick)),
        ...markdownElement(optionalTopText('转化弱 Top5', context.weakConversion)),
        ...markdownElement(optionalTopText('高潜力 Top5', context.highPotential)),
        ...markdownElement(optionalTopText('新品观察 Top5', context.newProductObservation)),
        ...markdownElement(optionalTopText('生命周期治理 Top5', context.lifecycleGovernance)),
      ],
    },
  };
}
