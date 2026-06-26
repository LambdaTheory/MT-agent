import { getLatestOverview, getNewProductPool, getProblemProducts, getProductPerformance, getRemovedLinks } from '../agentData/publicTrafficQueries.js';
import { rankBestProductByRegistryQuery, type ProductRankingResult } from '../agentData/productRanking.js';
import { buildAgentTaskPool } from '../agentData/taskPool.js';
import type { AgentIntent, AgentProblemType } from '../agentData/types.js';
import type { LinkRegistryStore } from '../linkRegistry/store.js';
import type { PublicTrafficDataReportContext } from '../publicTraffic/types.js';
import type { LlmReadOnlyToolName } from './llmProvider.js';
import type { BotResponse } from './types.js';

type ReadOnlyAgentIntent = Exclude<AgentIntent, { type: 'unknown' }>;
export type RegistryBackedLlmToolName = Exclude<LlmReadOnlyToolName, 'none' | 'get_supported_questions'>;

export interface ReadOnlyToolLlmMetadata {
  name: RegistryBackedLlmToolName;
  description: string;
  argumentsSchema: Record<string, unknown>;
  toIntent(argumentsRecord: Record<string, unknown>): ReadOnlyAgentIntent | undefined;
}

export interface ReadOnlyToolRunOptions {
  linkRegistryStore?: LinkRegistryStore;
}

export interface ReadOnlyTool {
  name: ReadOnlyAgentIntent['type'];
  description: string;
  intentType: ReadOnlyAgentIntent['type'];
  llm?: ReadOnlyToolLlmMetadata;
  run(context: PublicTrafficDataReportContext, intent: AgentIntent, options?: ReadOnlyToolRunOptions): Promise<BotResponse>;
}

export type LlmBackedReadOnlyTool = ReadOnlyTool & { llm: ReadOnlyToolLlmMetadata };

const noArgumentsSchema = { type: 'object', additionalProperties: false };
const productArgumentsSchema = { type: 'object', properties: { keyword: { type: 'string' } }, required: ['keyword'], additionalProperties: false };
const productRankingArgumentsSchema = { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false };
const problemProductsArgumentsSchema = {
  type: 'object',
  properties: { problemType: { enum: ['low_exposure', 'weak_conversion', 'high_potential', 'new_product_pool', 'recommended_action'] } },
  required: ['problemType'],
  additionalProperties: false,
};

function readStringArgument(argumentsRecord: Record<string, unknown>, key: string): string | undefined {
  const value = argumentsRecord[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function isAgentProblemType(value: unknown): value is AgentProblemType {
  return value === 'low_exposure' || value === 'weak_conversion' || value === 'high_potential' || value === 'new_product_pool' || value === 'recommended_action';
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

function formatMoney(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatRankingAnswer(result: ProductRankingResult): string {
  switch (result.status) {
    case 'ranked':
      return [
        `数据最好的 ${result.query} 是：端内ID ${result.best.internalProductId}（${result.best.productName}）`,
        `数据日期：${result.date}`,
        `依据：同款组 ${result.sameSkuGroupId ?? '未知'}，${result.rationale}`,
        `7日：发货 ${result.best.sevenDayShippedOrders}，成交额 ¥${formatMoney(result.best.sevenDayAmount)}，访问 ${result.best.sevenDayPublicVisits}`,
        `1日：发货 ${result.best.oneDayShippedOrders}，成交额 ¥${formatMoney(result.best.oneDayAmount)}，访问 ${result.best.oneDayPublicVisits}`,
      ].join('\n');
    case 'ambiguous':
      return [
        `“${result.query}”匹配到多个可能的同款组，需要你补充具体商品或端内ID：`,
        ...result.candidates.slice(0, 5).map((candidate, index) => `${index + 1}. ${candidate.shortName ?? candidate.sameSkuGroupId}（${candidate.sameSkuGroupId}，端内ID ${candidate.internalProductIds.join('、')}）`),
      ].join('\n');
    case 'not_found':
      return `链接维护档案未匹配到“${result.query}”，我不会猜测端内ID。可以换成更完整的商品名或直接给端内ID。`;
    case 'no_metrics':
      return `已找到“${result.query}”的链接维护档案，但同款组 ${result.sameSkuGroupId || '未知'} 没有可用于排名的公域数据。`;
  }
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
    llm: {
      name: 'get_latest_summary',
      description: '查询最新公域日报概况',
      argumentsSchema: noArgumentsSchema,
      toIntent: () => ({ type: 'overview' }),
    },
    async run(context) {
      const overview = getLatestOverview(context);
      return { text: formatOverviewLines(overview.date, overview.metrics) };
    },
  },
  {
    name: 'product',
    description: '按商品 ID、平台 ID 或商品名查询表现',
    intentType: 'product',
    llm: {
      name: 'query_product_performance',
      description: '按商品 ID、平台 ID 或商品名查询表现',
      argumentsSchema: productArgumentsSchema,
      toIntent: (argumentsRecord) => {
        const keyword = readStringArgument(argumentsRecord, 'keyword');
        return keyword ? { type: 'product', keyword } : undefined;
      },
    },
    async run(context, intent) {
      return { text: formatProductAnswer(getProductPerformanceForBot(context, intent.type === 'product' ? intent.keyword : '')) };
    },
  },
  {
    name: 'best_product_by_same_sku',
    description: '按链接维护档案解析商品/同款组，并返回公域数据表现最好的端内ID',
    intentType: 'best_product_by_same_sku',
    llm: {
      name: 'rank_best_same_sku_product',
      description: '查询某个商品或同款组中公域数据表现最好的端内ID。只适用于“数据最好的 X 是哪个端内ID”“表现最好的同款链接”等只读问题。',
      argumentsSchema: productRankingArgumentsSchema,
      toIntent: (argumentsRecord) => {
        const query = readStringArgument(argumentsRecord, 'query');
        return query ? { type: 'best_product_by_same_sku', query } : undefined;
      },
    },
    async run(context, intent, options = {}) {
      if (intent.type !== 'best_product_by_same_sku') return { text: '暂无匹配商品。' };
      const registry = options.linkRegistryStore;
      if (!registry) return { text: '需要先读取链接维护档案，才能安全判断同款组里哪个端内ID数据最好。' };
      const result = rankBestProductByRegistryQuery(context, registry, intent.query);
      return {
        text: formatRankingAnswer(result),
        metadata: {
          toolName: 'product.rankBestSameSku',
          status: result.status,
          query: intent.query,
          ...(result.status === 'ranked'
            ? {
                bestProductId: result.best.internalProductId,
                best: result.best,
                ranking: result.ranking,
                sameSkuGroupId: result.sameSkuGroupId,
                date: result.date,
              }
            : {}),
          result,
        },
      };
    },
  },
  {
    name: 'new_product_pool',
    description: '查询新链接池商品',
    intentType: 'new_product_pool',
    llm: {
      name: 'get_new_link_pool',
      description: '查询新链接池商品',
      argumentsSchema: noArgumentsSchema,
      toIntent: () => ({ type: 'new_product_pool' }),
    },
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
    llm: {
      name: 'get_problem_products',
      description: '按问题类型查询问题商品',
      argumentsSchema: problemProductsArgumentsSchema,
      toIntent: (argumentsRecord) => (isAgentProblemType(argumentsRecord.problemType) ? { type: 'problem_products', problemType: argumentsRecord.problemType } : undefined),
    },
    async run(context, intent) {
      return { text: formatProblemLines(intent.type === 'problem_products' ? getProblemProducts(context, intent.problemType) : []) };
    },
  },
  {
    name: 'removed_links',
    description: '查询最近下架链接',
    intentType: 'removed_links',
    llm: {
      name: 'get_removed_links',
      description: '查询最近下架链接',
      argumentsSchema: noArgumentsSchema,
      toIntent: () => ({ type: 'removed_links' }),
    },
    async run(context) {
      return { text: formatRemovedLinkLines(getRemovedLinks(context)) };
    },
  },
  {
    name: 'order_summary',
    description: '查询订单分析概况',
    intentType: 'order_summary',
    llm: {
      name: 'get_order_fulfillment',
      description: '查询订单分析和履约概况',
      argumentsSchema: noArgumentsSchema,
      toIntent: () => ({ type: 'order_summary' }),
    },
    async run(context) {
      return { text: formatOrderSummary(context) };
    },
  },
];

export function findReadOnlyTool(intent: AgentIntent): ReadOnlyTool | undefined {
  if (intent.type === 'unknown') return undefined;
  return readOnlyTools.find((tool) => tool.intentType === intent.type);
}

export function findReadOnlyToolByLlmName(name: LlmReadOnlyToolName): LlmBackedReadOnlyTool | undefined {
  return readOnlyTools.find((tool): tool is LlmBackedReadOnlyTool => tool.llm?.name === name);
}
