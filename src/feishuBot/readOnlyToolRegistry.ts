import { getLatestOverview, getNewProductPool, getProblemProducts, getProductPerformance, getRemovedLinks } from '../agentData/publicTrafficQueries.js';
import { buildAgentTaskPool } from '../agentData/taskPool.js';
import type { AgentIntent } from '../agentData/types.js';
import type { PublicTrafficDataReportContext } from '../publicTraffic/types.js';
import type { BotResponse } from './types.js';

type ReadOnlyAgentIntent = Exclude<AgentIntent, { type: 'unknown' }>;

export interface ReadOnlyTool {
  name: ReadOnlyAgentIntent['type'];
  description: string;
  intentType: ReadOnlyAgentIntent['type'];
  run(context: PublicTrafficDataReportContext, intent: AgentIntent): Promise<BotResponse>;
}

function formatTaskLines(items: Array<{ productId: string; suggestedAction: string; reason: string }>): string {
  return items.length > 0 ? items.map((item, index) => `${index + 1}. ${item.productId}：${item.suggestedAction}。原因：${item.reason}`).join('\n') : '暂无待处理任务。';
}

function formatProblemLines(items: Array<{ productId: string; action: string; reason: string }>): string {
  return items.length > 0 ? items.map((item, index) => `${index + 1}. ${item.productId}：${item.action}。原因：${item.reason}`).join('\n') : '暂无匹配问题商品。';
}

function formatRemovedLinkLines(items: Array<{ productId: string; productName: string; removedDate: string; reason: string }>): string {
  return items.length > 0 ? items.map((item, index) => `${index + 1}. ${item.productId}：${item.reason}。下架日期：${item.removedDate}。商品：${item.productName}`).join('\n') : '暂无近7天下架链接。';
}

function formatNewProductPoolLines(items: Array<{ productId: string; productName: string; maintenanceStatus: string }>): string {
  return items.length > 0 ? items.map((item, index) => `${index + 1}. ${item.productId}：${item.productName || '未命名'}。状态：${item.maintenanceStatus}`).join('\n') : '暂无新链接池商品。';
}

function formatOverviewLines(contextDate: string, metrics: ReturnType<typeof getLatestOverview>['metrics']): string {
  const one = metrics.find((metric) => metric.period === '1d');
  if (!one) return `公域日报 ${contextDate}\n暂无 1 日概况。`;
  return `公域日报 ${contextDate}\n曝光 ${one.exposure}，访问 ${one.publicVisits}，发货 ${one.shippedOrders}，金额 ¥${one.amount.toFixed(2)}`;
}

function formatProductAnswer(answer: ReturnType<typeof getProductPerformance>): string {
  if (!answer) return '暂无匹配商品。';
  const one = answer.periods.find((metric) => metric.period === '1d');
  const seven = answer.periods.find((metric) => metric.period === '7d');
  return [
    `${answer.productId} ${answer.productName}`,
    one ? `1日：曝光 ${one.exposure}，访问 ${one.publicVisits}，发货 ${one.shippedOrders}` : '',
    seven ? `7日：曝光 ${seven.exposure}，访问 ${seven.publicVisits}，发货 ${seven.shippedOrders}` : '',
  ].filter(Boolean).join('\n');
}

function getProductPerformanceForBot(context: PublicTrafficDataReportContext, keyword: string): ReturnType<typeof getProductPerformance> {
  return getProductPerformance(context, keyword) ?? (/^\d+$/.test(keyword) ? getProductPerformance(context, `端内ID ${keyword}`) : null);
}

function formatOrderSummary(context: { orderAnalysis?: { pages?: Record<string, { label: string; indicators?: Array<{ label: string; value: string }> }> } }): string {
  const overview = context.orderAnalysis?.pages?.overview;
  const indicators = overview?.indicators ?? [];
  if (indicators.length === 0) return '暂无订单概况。';
  return ['订单情况', ...indicators.slice(0, 8).map((item) => `${item.label}：${item.value}`)].join('\n');
}

export const readOnlyTools: ReadOnlyTool[] = [
  {
    name: 'overview',
    description: '查询最新公域日报概况',
    intentType: 'overview',
    async run(context) {
      const overview = getLatestOverview(context);
      return { text: formatOverviewLines(overview.date, overview.metrics) };
    },
  },
  {
    name: 'product',
    description: '按商品 ID、平台 ID 或商品名查询表现',
    intentType: 'product',
    async run(context, intent) {
      return { text: formatProductAnswer(getProductPerformanceForBot(context, intent.type === 'product' ? intent.keyword : '')) };
    },
  },
  {
    name: 'new_product_pool',
    description: '查询新链接池商品',
    intentType: 'new_product_pool',
    async run(context) {
      return { text: formatNewProductPoolLines(getNewProductPool(context)) };
    },
  },
  {
    name: 'tasks',
    description: '查询待处理任务',
    intentType: 'tasks',
    async run(context) {
      return { text: formatTaskLines(buildAgentTaskPool(context)) };
    },
  },
  {
    name: 'problem_products',
    description: '查询问题商品',
    intentType: 'problem_products',
    async run(context, intent) {
      return { text: formatProblemLines(intent.type === 'problem_products' ? getProblemProducts(context, intent.problemType) : []) };
    },
  },
  {
    name: 'removed_links',
    description: '查询最近下架链接',
    intentType: 'removed_links',
    async run(context) {
      return { text: formatRemovedLinkLines(getRemovedLinks(context)) };
    },
  },
  {
    name: 'order_summary',
    description: '查询订单分析概况',
    intentType: 'order_summary',
    async run(context) {
      return { text: formatOrderSummary(context) };
    },
  },
];

export function findReadOnlyTool(intent: AgentIntent): ReadOnlyTool | undefined {
  if (intent.type === 'unknown') return undefined;
  return readOnlyTools.find((tool) => tool.intentType === intent.type);
}
