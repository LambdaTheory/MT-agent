import type { FeishuCardPayload } from '../notify/feishuApp.js';
import type { PeriodKey } from '../domain/types.js';
import { resolveProductDisplayName, type ProductNameMap } from '../publicTraffic/productDisplayName.js';
import type { PublicTrafficDataReportContext, PublicTrafficPeriodMetrics, PublicTrafficProductDataRow, PublicTrafficReportSectionItem } from '../publicTraffic/types.js';

export type OperationsLearningFeedbackOption = 'reasonable' | 'unreasonable' | 'suggested_action' | 'not_representative';

export interface OperationsLearningQuizItem {
  productId: string;
  productName: string;
  platformProductId: string;
  score: number;
  sourceModules: string[];
  reasons: string[];
  recommendedOperation: string;
  metrics: Record<PeriodKey, Pick<PublicTrafficPeriodMetrics, 'exposure' | 'publicVisits' | 'dashboardVisits' | 'createdOrders' | 'shippedOrders' | 'amount' | 'exposureVisitRate' | 'visitShipmentRate'>>;
  feedbackOptions: OperationsLearningFeedbackOption[];
}

export interface OperationsLearningQuizCardPayload extends FeishuCardPayload {
  header: { title: { tag: 'plain_text'; content: string }; template: string };
  elements: Record<string, unknown>[];
}

export interface OperationsLearningQuestionCardPayload extends FeishuCardPayload {
  schema: '2.0';
  header: { title: { tag: 'plain_text'; content: string }; template: string };
  body: { elements: Record<string, unknown>[] };
}

const FEEDBACK_OPTIONS: OperationsLearningFeedbackOption[] = ['reasonable', 'unreasonable', 'suggested_action', 'not_representative'];
const PRIORITY_SCORE: Record<NonNullable<PublicTrafficReportSectionItem['priority']>, number> = { high: 110, medium: 80, low: 55 };

function shortId(row: PublicTrafficProductDataRow): string {
  return row.displayProductId.replace(/^端内ID\s*/, '') || row.displayProductId;
}

function findRowByIdentifier(context: PublicTrafficDataReportContext, identifier: string): PublicTrafficProductDataRow | undefined {
  const id = identifier.replace(/^端内ID\s*/, '').trim();
  return context.rows.find((row) => row.displayProductId === identifier || shortId(row) === id || row.platformProductId === identifier);
}

function compactMetric(metric: PublicTrafficPeriodMetrics): OperationsLearningQuizItem['metrics'][PeriodKey] {
  return {
    exposure: metric.exposure,
    publicVisits: metric.publicVisits,
    dashboardVisits: metric.dashboardVisits,
    createdOrders: metric.createdOrders,
    shippedOrders: metric.shippedOrders,
    amount: metric.amount,
    exposureVisitRate: metric.exposureVisitRate,
    visitShipmentRate: metric.visitShipmentRate,
  };
}

function mergeCandidate(candidates: Map<string, OperationsLearningQuizItem>, row: PublicTrafficProductDataRow, moduleName: string, item: PublicTrafficReportSectionItem, moduleScore: number, productNameMap: ProductNameMap): void {
  const productId = shortId(row);
  const existing = candidates.get(productId);
  const base = existing ?? {
    productId,
    productName: resolveProductDisplayName(row, productNameMap),
    platformProductId: row.platformProductId,
    score: 0,
    sourceModules: [],
    reasons: [],
    recommendedOperation: item.action,
    metrics: {
      '1d': compactMetric(row.periods['1d']),
      '7d': compactMetric(row.periods['7d']),
      '30d': compactMetric(row.periods['30d']),
    },
    feedbackOptions: FEEDBACK_OPTIONS,
  };

  if (!base.sourceModules.includes(moduleName)) base.sourceModules.push(moduleName);
  if (!base.reasons.includes(item.reason)) base.reasons.push(item.reason);
  base.score += moduleScore + Math.min(row.periods['7d'].publicVisits + row.periods['7d'].dashboardVisits, 200) / 10;
  if (moduleScore >= 100) base.recommendedOperation = item.action;
  candidates.set(productId, base);
}

function addSection(candidates: Map<string, OperationsLearningQuizItem>, context: PublicTrafficDataReportContext, moduleName: string, items: PublicTrafficReportSectionItem[], score: number, productNameMap: ProductNameMap): void {
  for (const item of items) {
    const row = findRowByIdentifier(context, item.identifier);
    if (row) mergeCandidate(candidates, row, moduleName, item, score, productNameMap);
  }
}

function addNewProductPool(candidates: Map<string, OperationsLearningQuizItem>, context: PublicTrafficDataReportContext, productNameMap: ProductNameMap): void {
  for (const item of context.newProductPoolItems ?? []) {
    const row = findRowByIdentifier(context, item.productId) ?? findRowByIdentifier(context, `端内ID ${item.productId}`);
    if (!row) continue;
    mergeCandidate(candidates, row, '新链接池', { identifier: row.displayProductId, action: item.maintenanceStatus || '新品池维护', reason: item.productName || '新链接池商品' }, 70, productNameMap);
  }
}

export function selectOperationsLearningQuizItems(context: PublicTrafficDataReportContext, limit = 10, productNameMap: ProductNameMap = {}): OperationsLearningQuizItem[] {
  const candidates = new Map<string, OperationsLearningQuizItem>();
  for (const item of context.recommendedActions) {
    addSection(candidates, context, '建议操作', [item], PRIORITY_SCORE[item.priority ?? 'low'], productNameMap);
  }
  addNewProductPool(candidates, context, productNameMap);

  return Array.from(candidates.values())
    .sort((a, b) => b.score - a.score || b.metrics['7d'].publicVisits - a.metrics['7d'].publicVisits || a.productId.localeCompare(b.productId))
    .slice(0, limit);
}

function metricLine(item: OperationsLearningQuizItem): string {
  const one = item.metrics['1d'];
  const seven = item.metrics['7d'];
  return `1日曝光 ${one.exposure}，访问 ${one.publicVisits || one.dashboardVisits}，发货 ${one.shippedOrders}，金额 ${one.amount.toFixed(2)}；7日曝光 ${seven.exposure}，访问 ${seven.publicVisits || seven.dashboardVisits}，发货 ${seven.shippedOrders}`;
}

function ratePercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function shippedColor(metric: OperationsLearningQuizItem['metrics'][PeriodKey]): string {
  if (metric.shippedOrders > 0) return 'green';
  if ((metric.publicVisits || metric.dashboardVisits) > 0) return 'red';
  return 'grey';
}

export function buildOperationsLearningQuizMarkdown(date: string, items: OperationsLearningQuizItem[]): string {
  return [
    `# 运营学习 loop 测验 ${date}`,
    '',
    '请评审 Agent 给出的运营操作是否合理；如果候选链接不具代表性，也请标记为 not_representative。',
    '',
    ...items.map((item, index) => [`## ${index + 1}. 端内ID ${item.productId} ${item.productName}`, `- 数据：${metricLine(item)}`, `- Agent 建议：${item.recommendedOperation}`, `- 原因：${item.reasons.join('；')}`, `- 反馈选项：${item.feedbackOptions.join(' / ')}`].join('\n')),
  ].join('\n');
}

export function buildOperationsLearningQuizCard(date: string, items: OperationsLearningQuizItem[]): OperationsLearningQuizCardPayload {
  return {
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: '运营学习 loop 测验' }, template: 'blue' },
    elements: [
      { tag: 'markdown', content: `**日期** ${date}\n每日仅抽取 10 条最有操作空间的链接，用于评审 Agent 的运营判断。` },
      ...items.map((item, index) => ({
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**${index + 1}. 端内ID ${item.productId}｜${item.productName}**\n${metricLine(item)}\n建议：${item.recommendedOperation}\n反馈：${item.feedbackOptions.join(' / ')}`,
        },
      })),
    ],
  };
}

function feedbackButton(label: string, feedback: OperationsLearningFeedbackOption, date: string, item: OperationsLearningQuizItem, index: number): Record<string, unknown> {
  const value = { action: 'operations_learning_feedback', date, productId: item.productId, feedback, questionIndex: index };
  return {
    tag: 'button',
    text: { tag: 'plain_text', content: label },
    type: feedback === 'reasonable' ? 'primary' : 'default',
    form_action_type: 'submit',
    name: `operations_learning_${feedback}`,
    behaviors: [{ type: 'callback', value }],
  };
}

function stopButton(date: string): Record<string, unknown> {
  return {
    tag: 'button',
    text: { tag: 'plain_text', content: '停止学习' },
    type: 'default',
    form_action_type: 'submit',
    name: 'operations_learning_stop',
    behaviors: [{ type: 'callback', value: { action: 'operations_learning_stop', date } }],
  };
}

function markdown(content: string): Record<string, unknown> {
  return { tag: 'markdown', content };
}

function visits(metric: OperationsLearningQuizItem['metrics'][PeriodKey]): number {
  return metric.publicVisits || metric.dashboardVisits;
}

function periodMetricColumn(title: string, metric: OperationsLearningQuizItem['metrics'][PeriodKey]): Record<string, unknown> {
  return {
    tag: 'column',
    width: 'weighted',
    weight: 1,
    vertical_align: 'top',
    background_style: 'grey',
    padding: '8px',
    elements: [
      markdown(`<text_tag color='blue'>${title}</text_tag>`),
      markdown(`曝光 **${metric.exposure}**\n<text_tag color='orange'>公域访问 ${metric.publicVisits}</text_tag>｜商品页访问 ${metric.dashboardVisits}\n创建单 **${metric.createdOrders}**｜<text_tag color='${shippedColor(metric)}'>发货 ${metric.shippedOrders}</text_tag>\n金额 **¥${metric.amount.toFixed(2)}**\n曝光到访问 ${ratePercent(metric.exposureVisitRate)}\n访问到发货 ${ratePercent(metric.visitShipmentRate)}`),
    ],
  };
}

function periodMetricMatrix(item: OperationsLearningQuizItem): Record<string, unknown> {
  return {
    tag: 'column_set',
    element_id: 'operations_learning_period_metric_matrix',
    flex_mode: 'stretch',
    horizontal_spacing: '8px',
    columns: [periodMetricColumn('1 日', item.metrics['1d']), periodMetricColumn('7 日', item.metrics['7d']), periodMetricColumn('30 日', item.metrics['30d'])],
  };
}

function reasonsPanel(item: OperationsLearningQuizItem): Record<string, unknown> {
  return markdown(`**判断依据**\n${item.reasons.join('；')}`);
}

export function buildOperationsLearningQuestionCard(date: string, item: OperationsLearningQuizItem, options: { index: number; total: number }): OperationsLearningQuestionCardPayload {
  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: `运营学习 loop 测验 ${options.index}/${options.total}` }, template: 'blue' },
    body: {
      elements: [
        {
          tag: 'form',
          name: 'operations_learning_feedback_form',
          elements: [
            markdown(`**请判断：这个运营建议是否值得学习？**\n<text_tag color='blue'>${date}</text_tag> <text_tag color='grey'>每日 10 题中的第 ${options.index} 题</text_tag>`),
            markdown(`**商品**\n${item.productName}\n<text_tag color='grey'>端内ID ${item.productId}｜平台商品ID ${item.platformProductId}</text_tag>`),
            markdown(`**Agent 建议操作**\n<text_tag color='green'>${item.recommendedOperation}</text_tag>`),
            { tag: 'hr' },
            markdown('**1 / 7 / 30 日详细数据**'),
            periodMetricMatrix(item),
            reasonsPanel(item),
            {
              tag: 'input',
              element_id: 'operations_learning_suggested_action',
              name: 'suggested_action',
              label: { tag: 'plain_text', content: '你的改写建议（可选）' },
              label_position: 'top',
              placeholder: { tag: 'plain_text', content: '如果不认可，请输入你建议的运营动作或原因' },
              input_type: 'text',
              max_length: 500,
            },
            feedbackButton('合理', 'reasonable', date, item, options.index),
            feedbackButton('不合理', 'unreasonable', date, item, options.index),
            feedbackButton('提交改写建议', 'suggested_action', date, item, options.index),
            feedbackButton('不具代表性', 'not_representative', date, item, options.index),
            stopButton(date),
          ],
        },
      ],
    },
  };
}

export function buildOperationsLearningQuizPreview(context: PublicTrafficDataReportContext, limit = 10, productNameMap: ProductNameMap = {}): { date: string; items: OperationsLearningQuizItem[]; markdown: string; card: OperationsLearningQuizCardPayload; questionCard: OperationsLearningQuestionCardPayload | null } {
  const items = selectOperationsLearningQuizItems(context, limit, productNameMap);
  return {
    date: context.date,
    items,
    markdown: buildOperationsLearningQuizMarkdown(context.date, items),
    card: buildOperationsLearningQuizCard(context.date, items),
    questionCard: items[0] ? buildOperationsLearningQuestionCard(context.date, items[0], { index: 1, total: items.length }) : null,
  };
}
