import type { ProductQueryMatch, ProductQueryResult } from '../agentData/productQuery.js';
import type { PublicTrafficDataReportContext } from '../publicTraffic/types.js';
import type { FeishuCardPayload } from '../notify/feishuApp.js';

interface ProblemSectionCardInput {
  title: string;
  context: PublicTrafficDataReportContext;
  result: ProductQueryResult;
  actionRows: Array<{ id: string; action: string; reason: string; priority?: string }>;
  total: number;
  queryRef?: string;
}

function markdown(content: string): Record<string, unknown> {
  return { tag: 'markdown', content };
}

function divider(): Record<string, unknown> {
  return { tag: 'hr' };
}

function metricValue(value: number | null): string {
  return value === null ? '暂无数据' : String(value);
}

function identity(match: ProductQueryMatch): string {
  return `端内ID ${match.internalProductId}｜商品ID ${match.platformProductId ?? '未映射'}`;
}

function statusTags(match: ProductQueryMatch): string {
  const tags = [];
  if (match.row.custodyDays !== null) tags.push(`已托管 ${match.row.custodyDays} 天`);
  return tags.join('｜');
}

function productMetricLines(match: ProductQueryMatch): string {
  return match.periods
    .map((period) => `**${period.period.replace('d', '日')}**：曝光 ${metricValue(period.exposure)}｜访问 ${metricValue(period.visits)}｜发货 ${metricValue(period.shippedOrders)}`)
    .join('\n');
}

function footer(context: PublicTrafficDataReportContext): string {
  const updatedAt = context.orderAnalysis?.capturedAt ?? context.orderAnalysis?.runDate ?? context.date;
  return `数据源：公域日报｜报告日期：${context.date}｜更新时间：${updatedAt}`;
}

export function buildProductDetailCard(context: PublicTrafficDataReportContext, result: ProductQueryResult): FeishuCardPayload | undefined {
  if (result.matches.length !== 1 || result.ambiguous.length > 0) return undefined;
  const match = result.matches[0];
  if (!match) return undefined;
  const status = statusTags(match);
  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: '商品查询结果' }, template: 'blue' },
    body: {
      elements: [
        markdown(`**${match.row.productName}**\n${identity(match)}${status ? `\n<text_tag color='blue'>${status}</text_tag>` : ''}`),
        divider(),
        markdown(productMetricLines(match)),
        markdown(`<font color='grey'>${footer(context)}</font>`),
      ],
    },
  };
}

function problemRow(match: ProductQueryMatch, action?: { action: string; reason: string; priority?: string }): string {
  const state = [action?.priority ? `优先级 ${action.priority}` : '', action?.action, action?.reason, statusTags(match)].filter(Boolean).join('｜');
  return `**${identity(match)}**\n${match.row.productName}${state ? `\n${state}` : ''}`;
}

export function buildProblemSectionCard(input: ProblemSectionCardInput): FeishuCardPayload {
  const visibleMatches = input.result.matches.slice(0, 5);
  const hiddenCount = Math.max(0, input.total - visibleMatches.length);
  const elements: Record<string, unknown>[] = [
    markdown(`日报日期：${input.context.date}`),
    ...visibleMatches.flatMap((match, index) => {
      const action = input.actionRows.find((row) => row.id === match.internalProductId);
      return [markdown(problemRow(match, action)), ...(index < visibleMatches.length - 1 ? [divider()] : [])];
    }),
    ...(visibleMatches.length === 0 ? [markdown(`当前日报未发现 ${input.title}。`)] : []),
    ...(hiddenCount > 0 ? [markdown(`<font color='grey'>仅展示前 5 条，剩余 ${hiddenCount} 条可查看完整清单。</font>`)] : []),
    markdown(`<font color='grey'>${footer(input.context)}</font>`),
  ];
  if (hiddenCount > 0 && input.queryRef) {
    elements.push({
      tag: 'action',
      actions: [{
        tag: 'button',
        text: { tag: 'plain_text', content: '查看完整清单' },
        type: 'primary',
        name: 'query_full_list_submit',
        behaviors: [{ type: 'callback', value: { action: 'query_full_list', queryRef: input.queryRef } }],
      }],
    });
  }
  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `${input.title} · ${input.total} 条` },
      template: input.total > 0 ? 'red' : 'blue',
    },
    body: { elements },
  };
}
