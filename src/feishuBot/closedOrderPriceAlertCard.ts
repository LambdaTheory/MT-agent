import type { ClosedOrderConfidenceFeedback } from '../closedOrderFeedback/types.js';
import type { LinkRegistryEntry } from '../linkRegistry/types.js';
import type { FeishuCardPayload } from '../notify/feishuApp.js';

export interface ClosedOrderPriceAlertItem {
  feedback: ClosedOrderConfidenceFeedback;
  entry: LinkRegistryEntry | null;
}

function markdown(content: string): Record<string, unknown> {
  return { tag: 'markdown', content };
}

function text(value: string): Record<string, unknown> {
  return { tag: 'plain_text', content: value };
}

function safeName(item: ClosedOrderPriceAlertItem): string {
  return item.entry?.shortName?.trim()
    || item.entry?.productName?.trim()
    || `端内ID ${item.feedback.internalProductId}`;
}

function shortTime(value: string | undefined): string {
  if (!value?.trim()) return '未知';
  return value.replace('T', ' ').replace(/(?:\.\d+)?Z$/, 'Z');
}

function compactRemark(value: string, maxLength = 80): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function itemMarkdown(item: ClosedOrderPriceAlertItem, index: number): string {
  const confidence = `${Math.round(item.feedback.confidence * 100)}%`;
  const sameSkuGroupId = item.feedback.sameSkuGroupId ?? '未分组';
  const platformProductId = item.entry?.platformProductId?.trim() || '未记录';
  const orderNo = item.feedback.orderNo?.trim() || '未知';
  return [
    `**${index + 1}. ${safeName(item)}**`,
    `端内ID：${item.feedback.internalProductId}｜同款组：${sameSkuGroupId}｜置信度：${confidence}`,
    `平台商品ID：${platformProductId}｜订单号：${orderNo}｜关单时间：${shortTime(item.feedback.closedAt)}`,
    `备注：${compactRemark(item.feedback.rawRemark)}`,
  ].join('\n');
}

export function formatClosedOrderPriceAlertText(items: readonly ClosedOrderPriceAlertItem[]): string {
  if (items.length === 0) return '本次轮询没有发现新的价格相关关单备注。';
  return [
    `关单价格提醒：本次发现 ${items.length} 条新的价格相关关单备注。`,
    ...items.slice(0, 5).map((item, index) => `${index + 1}. ${safeName(item)}（端内ID ${item.feedback.internalProductId}）`),
  ].join('\n');
}

export function buildClosedOrderPriceAlertCard(items: readonly ClosedOrderPriceAlertItem[]): FeishuCardPayload {
  const shownItems = items.slice(0, 6);
  const hiddenCount = Math.max(0, items.length - shownItems.length);

  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: {
      title: text(`关单价格提醒 · ${items.length} 条新备注`),
      template: items.length >= 3 ? 'red' : 'orange',
    },
    body: {
      elements: [
        markdown('检测到新的“价格相关”关单备注，建议优先核查定价是否偏高、偏低，或与商家预期不一致。'),
        ...shownItems.map((item, index) => markdown(itemMarkdown(item, index))),
        ...(hiddenCount > 0 ? [markdown(`其余 ${hiddenCount} 条已省略，可稍后继续在“跑关单观察”中查看全量聚合结果。`)] : []),
      ],
    },
  };
}
