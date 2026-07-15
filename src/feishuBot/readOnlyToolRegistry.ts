import { explainRefreshCandidates } from '../agentData/refreshCandidateExplain.js';
import { resolveSafeSourceForSameSkuGroup } from '../agentData/safeSource.js';
import { aggregateWindowProducts, readWindowMetric, type WindowProductAggregate } from '../agentData/windowAggregate.js';
import { getInactiveLinks, getNewProductPool, getProblemProducts, getRemovedLinks } from '../agentData/publicTrafficQueries.js';
import { rankBestProductByRegistryQuery, rankBestProductByRegistryQueryWindowed, type ProductRankingResult, type ProductWindowRankingResult } from '../agentData/productRanking.js';
import { getPublicTrafficMetric, publicTrafficMetricKeys, type PublicTrafficMetricKey } from '../agentData/publicTrafficMetricCatalog.js';
import { buildAgentTaskPool } from '../agentData/taskPool.js';
import type { AgentIntent, AgentProblemType } from '../agentData/types.js';
import { createLinkRegistry } from '../linkRegistry/store.js';
import type { LinkRegistryStore } from '../linkRegistry/store.js';
import type { LinkRegistryEntry } from '../linkRegistry/types.js';
import type { PublicTrafficDataReportContext } from '../publicTraffic/types.js';
import type { LlmReadOnlyToolName } from './llmProvider.js';
import { formatLatestSummary, formatProductQueryResult, queryProductResult } from './reportStore.js';
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
  registryEntries?: LinkRegistryEntry[];
  outputDir?: string;
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
const legacyRankingMetricKeys = publicTrafficMetricKeys.filter((metric): metric is 'shippedOrders' | 'amount' | 'exposure' => metric === 'shippedOrders' || metric === 'amount' || metric === 'exposure');
const productRankingArgumentsSchema = {
  type: 'object',
  properties: {
    query: { type: 'string' },
    metric: { type: 'string', enum: legacyRankingMetricKeys },
    periodDays: { type: ['integer', 'string'], enum: [1, 7, 30, '1', '7', '30'] },
  },
  required: ['query'],
  additionalProperties: false,
};
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

function readRankingMetric(value: unknown): PublicTrafficMetricKey | undefined {
  return typeof value === 'string' && getPublicTrafficMetric(value) ? value as PublicTrafficMetricKey : undefined;
}

function readRankingPeriodDays(value: unknown): number | undefined {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(numeric) && numeric > 0 ? numeric : undefined;
}

function isLegacyRankingMetric(metric: PublicTrafficMetricKey | undefined): metric is 'shippedOrders' | 'amount' | 'exposure' {
  return metric === 'shippedOrders' || metric === 'amount' || metric === 'exposure';
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

function formatInactiveLinkLines(items: Array<{ productId: string; identifier: string; action: string; reason: string; priority?: string }>): string {
  if (items.length === 0) return '暂无失活候选链接。';
  const ids = Array.from(new Set(items.map((item) => item.productId))).join('、');
  return [
    `失活候选链接ID集合：${ids}`,
    ...items.map((item, index) => {
      const priority = item.priority ? `，优先级：${item.priority}` : '';
      const identifier = item.identifier === item.productId ? item.productId : `${item.identifier}（ID ${item.productId}）`;
      return `${index + 1}. ${identifier}：${item.action}${priority}。原因：${item.reason}`;
    }),
  ].join('\n');
}

function formatNewProductPoolLines(items: Array<{ productId: string; productName: string; maintenanceStatus: string }>): string {
  return items.length > 0 ? items.map((item, index) => `${index + 1}. ${item.productId}：${item.productName || '未命名'}。状态：${item.maintenanceStatus}`).join('\n') : '暂无新链接池商品。';
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

function formatWindowRankingAnswer(result: ProductWindowRankingResult): string {
  switch (result.status) {
    case 'ranked': {
      const definition = getPublicTrafficMetric(result.metric)!;
      const value = definition.format === 'money'
        ? `¥${formatMoney(result.best.value)}`
        : definition.format === 'percent'
          ? `${(result.best.value * 100).toFixed(2)}%`
          : formatMoney(result.best.value);
      return [
        `近 ${result.periodDays} 天数据最好的 ${result.query} 是：端内ID ${result.best.internalProductId}（${result.best.productName}）`,
        `数据日期：${result.date}`,
        `依据：同款组 ${result.sameSkuGroupId ?? '未知'}，按 ${definition.label} 排序。`,
        `近 ${result.periodDays} 天：${definition.label} ${value}`,
      ].join('\n');
    }
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

function rankingAggregateMetricValue(item: WindowProductAggregate, metric: 'shippedOrders' | 'amount' | 'exposure'): number {
  return readWindowMetric(item, metric) ?? 0;
}

function resolveSameSkuGroupEntries(registry: LinkRegistryStore, query: string): LinkRegistryEntry[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  if (/^\d+$/.test(trimmed)) {
    const entry = registry.getByInternalId(trimmed);
    const groupId = entry?.sameSkuGroupId?.trim();
    return groupId ? registry.listBySameSkuGroup(groupId, { includeRemoved: true, includeUnknown: true }) : entry ? [entry] : [];
  }

  const directGroup = registry.listBySameSkuGroup(trimmed, { includeRemoved: true, includeUnknown: true });
  if (directGroup.length > 0) return directGroup;

  const alias = registry.resolveAlias(trimmed);
  if (alias.status !== 'unique') return [];
  return alias.sameSkuGroupId ? registry.listBySameSkuGroup(alias.sameSkuGroupId, { includeRemoved: true, includeUnknown: true }) : alias.entries;
}

async function rankWindowAggregateAnswer(
  context: PublicTrafficDataReportContext,
  intent: Extract<AgentIntent, { type: 'best_product_by_same_sku' }>,
  registry: LinkRegistryStore,
  options: ReadOnlyToolRunOptions,
): Promise<BotResponse | null> {
  const periodDays = intent.periodDays;
  const metric = intent.metric;
  if (!periodDays || periodDays === 1 || periodDays === 7 || periodDays === 30 || !isLegacyRankingMetric(metric)) return null;
  if (!options.outputDir) return { text: '需要 outputDir 才能按逐日数据聚合任意窗口。' };

  const groupEntries = resolveSameSkuGroupEntries(registry, intent.query).filter((entry) => entry.status !== 'removed');
  if (groupEntries.length === 0) return { text: `链接维护档案未匹配到“${intent.query}”，我不会猜测端内ID。` };
  const allowedIds = new Set(groupEntries.map((entry) => entry.internalProductId));
  const aggregates = (await aggregateWindowProducts({ outputDir: options.outputDir, endDate: context.date, windowDays: periodDays }))
    .filter((item) => allowedIds.has(item.internalProductId))
    .sort((left, right) => rankingAggregateMetricValue(right, metric) - rankingAggregateMetricValue(left, metric) || Number(left.internalProductId) - Number(right.internalProductId));
  const best = aggregates[0];
  if (!best) return { text: `已找到“${intent.query}”的链接维护档案，但近 ${periodDays} 天没有可用于排名的逐日公域数据。` };
  const metricLabel = metric === 'shippedOrders' ? '发货' : metric === 'amount' ? '成交额' : '曝光';
  const productIds = aggregates.map((item) => item.internalProductId);
  const sameSkuGroupId = groupEntries.find((entry) => entry.sameSkuGroupId?.trim())?.sameSkuGroupId?.trim();
  return {
    text: [
      `近 ${periodDays} 天数据最好的 ${intent.query} 是：端内ID ${best.internalProductId}（${best.productName}）`,
      `数据日期：${context.date}`,
      `依据：逐日 1d 聚合，按 ${metricLabel} 排序；覆盖 ${best.daysCovered}/${periodDays} 天。`,
      `近 ${periodDays} 天：发货 ${readWindowMetric(best, 'shippedOrders') ?? 0}，成交额 ¥${formatMoney(readWindowMetric(best, 'amount') ?? 0)}，访问 ${readWindowMetric(best, 'publicVisits') ?? 0}，曝光 ${readWindowMetric(best, 'exposure') ?? 0}`,
    ].join('\n'),
    metadata: { toolName: 'product.rankBestSameSku', status: 'ranked', query: intent.query, bestProductId: best.internalProductId, best, ranking: aggregates, productIds, ...(sameSkuGroupId ? { sameSkuGroupId } : {}), rankingCount: aggregates.length, date: context.date, endDate: context.date, periodDays, windowDays: periodDays, metric, availability: best.availability },
  };
}

function resolveSameSkuGroupIdForIntent(intent: Extract<AgentIntent, { type: 'safe_source_resolve' }>, registry: LinkRegistryStore): string | undefined {
  const explicit = intent.sameSkuGroupId?.trim();
  if (explicit) return explicit;
  const query = intent.query?.trim();
  if (!query) return undefined;
  if (/^\d+$/.test(query)) return registry.getByInternalId(query)?.sameSkuGroupId?.trim();
  const direct = registry.listBySameSkuGroup(query, { includeRemoved: true, includeUnknown: true });
  if (direct.length > 0) return query;
  const alias = registry.resolveAlias(query);
  return alias.status === 'unique' ? alias.sameSkuGroupId?.trim() : undefined;
}

function formatSafeSourceGroups(context: PublicTrafficDataReportContext, registryEntries: LinkRegistryEntry[]): string {
  const groupIds = [...new Set(registryEntries.map((entry) => entry.sameSkuGroupId?.trim()).filter((value): value is string => Boolean(value)))].sort();
  const blocked = groupIds
    .map((groupId) => resolveSafeSourceForSameSkuGroup(registryEntries, context, groupId, new Set()))
    .filter((result) => result.status !== 'found');
  return blocked.length > 0
    ? ['没有安全源商品的同款组：', ...blocked.map((item, index) => `${index + 1}. ${item.sameSkuGroupId}：${item.reason ?? item.status}`)].join('\n')
    : '所有已知同款组都有可用安全源商品。';
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
      return { text: formatLatestSummary(context) };
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
      return { text: formatProductQueryResult(queryProductResult(context, intent.type === 'product' ? intent.keyword : '')) };
    },
  },
  {
    name: 'best_product_by_same_sku',
    description: '按链接维护档案解析商品/同款组，并返回固定 1/7/30 日公域核心指标表现最好的端内ID。',
    intentType: 'best_product_by_same_sku',
    llm: {
      name: 'rank_best_same_sku_product',
      description: '查询某个商品或同款组中固定 1/7/30 日核心指标表现最好的端内ID。仅支持 shippedOrders、amount、exposure；任意窗口、筛选、排序、排名或其它指标请求应交给数据查询工具。',
      argumentsSchema: productRankingArgumentsSchema,
      toIntent: (argumentsRecord) => {
        const query = readStringArgument(argumentsRecord, 'query');
        const periodDays = readRankingPeriodDays(argumentsRecord.periodDays);
        const metric = readRankingMetric(argumentsRecord.metric);
        if (!query) return undefined;
        if (argumentsRecord.metric !== undefined && !metric) return undefined;
        if (argumentsRecord.periodDays !== undefined && (!periodDays || (periodDays !== 1 && periodDays !== 7 && periodDays !== 30))) return undefined;
        return { type: 'best_product_by_same_sku', query, ...(periodDays ? { periodDays } : {}), ...(metric ? { metric } : {}) };
      },
    },
    async run(context, intent, options = {}) {
      if (intent.type !== 'best_product_by_same_sku') return { text: '暂无匹配商品。' };
      const registry = options.linkRegistryStore;
      if (!registry) return { text: '需要先读取链接维护档案，才能安全判断同款组里哪个端内ID数据最好。' };
      if (intent.metric && intent.periodDays && options.registryEntries && options.outputDir) {
        const result = await rankBestProductByRegistryQueryWindowed(options.outputDir, options.registryEntries, intent.query, { metric: intent.metric, periodDays: intent.periodDays, endDate: context.date });
        return {
          text: formatWindowRankingAnswer(result),
          metadata: {
            toolName: 'product.rankBestSameSku',
            status: result.status,
            query: intent.query,
            ...(result.status === 'ranked'
              ? { bestProductId: result.best.internalProductId, best: result.best, ranking: result.ranking, productIds: result.ranking.map((item) => item.internalProductId), rankingCount: result.ranking.length, sameSkuGroupId: result.sameSkuGroupId, date: result.date, endDate: result.date, periodDays: result.periodDays, windowDays: result.periodDays, metric: result.metric, availability: {} }
              : {}),
            result,
          },
        };
      }
      const windowResponse = await rankWindowAggregateAnswer(context, intent, registry, options);
      if (windowResponse) return windowResponse;
      const periodDays = intent.periodDays === 1 || intent.periodDays === 7 || intent.periodDays === 30 ? intent.periodDays : undefined;
      const result = rankBestProductByRegistryQuery(context, registry, intent.query, { periodDays, metric: isLegacyRankingMetric(intent.metric) ? intent.metric : undefined });
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
                productIds: result.ranking.map((item) => item.internalProductId),
                rankingCount: result.ranking.length,
                sameSkuGroupId: result.sameSkuGroupId,
                date: result.date,
                endDate: result.date,
                periodDays: intent.periodDays,
                windowDays: intent.periodDays,
                metric: intent.metric,
                availability: {},
              }
            : {}),
          result,
        },
      };
    },
  },
  {
    name: 'refresh_candidate_explain',
    description: '解释某查询或同款组为什么活跃度刷新候选为 0',
    intentType: 'refresh_candidate_explain',
    async run(context, intent, options = {}) {
      if (intent.type !== 'refresh_candidate_explain') return { text: '暂无匹配工具。' };
      const registryEntries = options.registryEntries;
      if (!registryEntries) return { text: '需要先读取链接维护档案，才能解释活跃度刷新候选。' };
      const result = explainRefreshCandidates(registryEntries, context, 'metric' in intent
        ? { ...(intent.query ? { query: intent.query } : {}), ...(intent.sameSkuGroupId ? { sameSkuGroupId: intent.sameSkuGroupId } : {}), metric: intent.metric, operator: intent.operator, value: intent.value, date: context.date, ...(intent.windowDays ? { windowDays: intent.windowDays } : {}) }
        : { ...(intent.query ? { query: intent.query } : {}), ...(intent.sameSkuGroupId ? { sameSkuGroupId: intent.sameSkuGroupId } : {}), zeroMetric: intent.zeroMetric, date: context.date, ...(intent.windowDays ? { windowDays: intent.windowDays } : {}) });
      const status = result.candidateCount > 0 ? 'found' : 'empty';
      const conditionMetadata = 'metric' in intent
        ? { metric: intent.metric, operator: intent.operator, value: intent.value }
        : { zeroMetric: intent.zeroMetric };
      return { text: [result.scopeLine, ...result.reasonSummary].join('\n'), metadata: { toolName: 'strategy.refreshCandidateExplain', status, endDate: context.date, productIds: result.candidateProductIds, availability: { unavailableMetricProductIds: result.missing30dDashboardProductIds, unavailableMetricCount: result.skipped.missing30dDashboard }, ...conditionMetadata, ...('metric' in intent ? {} : { legacyArgumentAdapted: true }), ...(intent.query ? { query: intent.query } : {}), ...(intent.sameSkuGroupId ? { sameSkuGroupId: intent.sameSkuGroupId } : {}), ...result, skippedReasons: result.reasonSummary } };
    },
  },
  {
    name: 'safe_source_resolve',
    description: '解析某同款组是否有可补链安全源商品',
    intentType: 'safe_source_resolve',
    async run(context, intent, options = {}) {
      if (intent.type !== 'safe_source_resolve') return { text: '暂无匹配工具。' };
      const registryEntries = options.registryEntries;
      const registry = options.linkRegistryStore ?? (registryEntries ? createLinkRegistry(registryEntries) : undefined);
      if (!registryEntries || !registry) return { text: '需要先读取链接维护档案，才能解析安全源商品。' };
      const sameSkuGroupId = resolveSameSkuGroupIdForIntent(intent, registry);
      if (!sameSkuGroupId) return { text: `链接维护档案未匹配到“${intent.query ?? intent.sameSkuGroupId ?? ''}”，无法判断安全源。` };
      const result = resolveSafeSourceForSameSkuGroup(registryEntries, context, sameSkuGroupId, new Set());
      const text = result.status === 'found'
        ? `同款组 ${result.sameSkuGroupId} 可补链，安全源商品：${result.sourceProductId} ${result.sourceProductName ?? ''}`.trim()
        : `同款组 ${result.sameSkuGroupId} 暂不可补链：${result.reason ?? result.status}`;
      return { text, metadata: { toolName: 'strategy.safeSourceResolve', ...result } };
    },
  },
  {
    name: 'safe_source_groups',
    description: '列出没有可用安全源商品的同款组',
    intentType: 'safe_source_groups',
    async run(context, _intent, options = {}) {
      return { text: options.registryEntries ? formatSafeSourceGroups(context, options.registryEntries) : '需要先读取链接维护档案，才能解析安全源商品。' };
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
    name: 'inactive_links',
    description: '查询疑似失活或生命周期治理候选链接',
    intentType: 'inactive_links',
    llm: {
      name: 'get_inactive_links',
      description: '查询疑似失活、低活跃、长期弱表现、生命周期治理候选链接的端内ID集合。不要用于已下架/已移除/已消失链接，后者应使用 get_removed_links。',
      argumentsSchema: noArgumentsSchema,
      toIntent: () => ({ type: 'inactive_links' }),
    },
    async run(context) {
      return { text: formatInactiveLinkLines(getInactiveLinks(context)) };
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
