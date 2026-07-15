import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { buildAgentToolConfirmCard } from '../agentRuntime/approvalCard.js';
import { recordOperationEvent } from '../agentRuntime/operationLedger.js';
import { runPublicTrafficReportCli } from '../cli/publicTrafficReport.js';
import type { AgentToolConfirmRequest } from '../agentRuntime/approvalCard.js';
import { loadConfig } from '../config/loadConfig.js';
import { loadEnv } from '../config/loadEnv.js';
import { loadClosedOrderIngestState } from '../closedOrderFeedback/ingest.js';
import { buildClosedOrderObservationReport, writeClosedOrderObservationReportArtifacts } from '../closedOrderFeedback/observation.js';
import { loadClosedOrderRegistryContext, type ClosedOrderRegistryPathsInput } from '../closedOrderFeedback/runtime.js';
import type { AgentIntent, AgentProblemType } from '../agentData/types.js';
import { rankProductsByCategory, type CategoryRankingMetric } from '../agentData/categoryRanking.js';
import { buildDataHealthReport } from '../agentData/dataHealth.js';
import { explainRefreshCandidates } from '../agentData/refreshCandidateExplain.js';
import { resolveSafeSourceForSameSkuGroup } from '../agentData/safeSource.js';
import { findWindowedProducts, type WindowedPredicate } from '../agentData/windowedFindings.js';
import { aggregateWindowProducts } from '../agentData/windowAggregate.js';
import { openLinkRegistryGovernancePrompt } from '../linkRegistry/governanceSession.js';
import { openLinkRegistryMaintenancePrompt } from '../linkRegistry/maintenanceSession.js';
import { createLinkRegistry } from '../linkRegistry/store.js';
import type { LinkRegistryEntry } from '../linkRegistry/types.js';
import { summarizeAgentLearning } from '../agentLearning/store.js';
import { syncClosedOrderFeedbackFromApi } from '../closedOrderFeedback/sync.js';
import { queryInventoryStatus } from '../inventoryStatus/query.js';
import { readInventorySameSkuSnapshot } from '../inventoryStatus/store.js';
import {
  buildNewLinkBatchConfirmCard,
  buildNewLinkBatchMultiConfirmCard,
  buildNewLinkBatchPlan,
  executeNewLinkBatchConfirmRequest,
  executeNewLinkBatchMultiConfirmRequest,
  explainNewLinkBatchMultiConfirmBlocker,
  formatNewLinkBatchPlan,
  formatNewLinkBatchMultiPlan,
  MAX_NEW_LINK_BATCH_COUNT,
  NEW_LINK_BATCH_CONFIRMATION_VERSION,
  NEW_LINK_BATCH_WORKFLOW_NAME,
  readNewLinkBatchWorkflowRequests,
  type NewLinkBatchConfirmRequest,
} from '../newLinkWorkflow/batch.js';
import { sendFeishuCard } from '../notify/feishu.js';
import { summarizeOperationsLearningHistory, summarizeOperationsLearningSession } from '../operationsLearningLoop/session.js';
import { buildPublicTrafficCard } from '../publicTraffic/buildPublicTrafficCard.js';
import { buildPublicTrafficFeishuText } from '../publicTraffic/buildPublicTrafficFeishu.js';
import { assertDashboardDataDate, previousShanghaiDate } from '../publicTraffic/dashboardCaptureDate.js';
import { runDashboardRefresh } from '../publicTraffic/dashboardRefresh.js';
import { buildPublicTrafficPaths } from '../publicTraffic/paths.js';
import type { PublicTrafficDataReportContext, PublicTrafficProductDataRow } from '../publicTraffic/types.js';
import { startOperationsLearningSession } from '../operationsLearningLoop/session.js';
import type { BotResponse } from './types.js';
import type { FeishuSendTo } from './types.js';
import { buildActivityAutomationCard, buildCancelDifferentialPricingCardResult } from './activityAutomation.js';
import { buildClosedOrderObservationCard } from './closedOrderObservationCard.js';
import { PLANNER_HELP_TEXT } from './help.js';
import { formatIdLookupResult, lookupProductId } from './idLookup.js';
import { buildIdLookupCard } from './idLookupCard.js';
import {
  buildInventoryStatusDetailCard,
  buildInventoryStatusOverviewCard,
  formatInventoryStatusAmbiguousText,
  formatInventoryStatusDetailText,
  formatInventoryStatusMissingText,
  formatInventoryStatusOverviewText,
} from './inventoryStatusCard.js';
import { buildLinkRegistryOverviewCard, formatLinkRegistryOverviewText } from './linkRegistryOverviewCard.js';
import {
  buildRentalOperationConfirmCard,
  buildRentalPricePreviewCard,
  compactAuditReference,
  createRentalPriceSkillClient,
  parseRentPriceFieldsFromText,
  rentalPriceChangeRequestFromToolArguments,
  rentalPriceRollbackRequestFromToolArguments,
  type RentalPriceAuditReference,
  type RentalOperationConfirmRequest,
  type RentalSpecRemoveItemConfirmRequest,
  type RentalPriceChangeRequest,
  type RentalPriceExecutionResult,
  type RentalPriceReadResult,
  type RentalPriceSkillClient,
} from './rentalPrice.js';
import { executeRentalReadOnlyOperationHandler } from './rentalReadOnlyOperationHandlers.js';
import { executeRentalWriteOperationHandler } from './rentalWriteOperationHandlers.js';
import { executeRentalBatchTool } from './rentalBatchHandlers.js';
import { executeRentalMirrorTool } from './rentalMirrorHandlers.js';
import { findReadOnlyTool } from './readOnlyToolRegistry.js';
import { inferPriceAdjustmentAmountFromText, readPriceAdjustmentAmountArgument } from './priceAdjustment.js';
import {
  hasPriceAdjustmentConflict,
  INVALID_DISCOUNT_ARGUMENT_MESSAGE,
  PRICE_ADJUSTMENT_CONFLICT_MESSAGE,
} from './priceChangeContract.js';
import { inferPriceMultiplierFromText, readPriceMultiplierArgument } from './priceMultiplier.js';
import { runPublicTrafficReportDateComparison, runPublicTrafficReportQuery, type PublicTrafficReportQueryArguments } from './reportQuery.js';
import { findLatestReportContext, findReportContextByDate, formatConversionSummary, formatLatestSummary, formatProductRows, parseNumericProductIdList, queryProductRows } from './reportStore.js';
import { saveAgentToolConfirmRequest } from './agentToolConfirmStore.js';
import { refreshActivityPlanConfirmationKey, saveRefreshActivityPlan, type RefreshActivityPlan } from './refreshActivityPlanStore.js';
import type { RentalWriteLedgerContext } from './rentalWriteOperationHandlers.js';
import { rentalPerSpecPriceApplyResponse, rentalPerSpecPricePlanResponse } from './rentalPerSpecPriceHandlers.js';
import { rentalSpecDimApplyResponse, rentalSpecDimPlanResponse } from './rentalSpecDimHandlers.js';
import { buildRefreshActivityStrategyCard } from './refreshActivityCard.js';

export interface AgentToolExecutionOptions {
  rentalPriceClient?: RentalPriceSkillClient;
  closedOrderFetchImpl?: typeof fetch;
  closedOrderRegistryPaths?: ClosedOrderRegistryPathsInput;
  ledgerContext?: RentalWriteLedgerContext;
}

type AgentToolWriteEvent = 'execution_started' | 'execution_succeeded' | 'execution_failed';

let publicTrafficReportRunning = false;

const RENTAL_PRICE_SNAPSHOT_MAX_PRODUCTS = 60;
const RENTAL_PRICE_PREVIEW_MAX_PRODUCTS = 24;
const RENTAL_SPEC_REMOVE_PLAN_BULK_WARNING_PRODUCTS = 12;
const RENTAL_SPEC_REMOVE_PLAN_MAX_PRODUCTS = 60;
const RENTAL_SPEC_REMOVE_PLAN_MAX_ITEMS = 50;
const REFRESH_ACTIVITY_DEFAULT_MAX_CANDIDATES = 20;
const REFRESH_ACTIVITY_MIN_ONLINE_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NON_RENT_PRICE_FIELD_LABELS: Record<string, string[]> = {
  marketPrice: ['marketPrice', '市场价', '市场价格'],
  deposit: ['deposit', '押金'],
  purchasePrice: ['purchasePrice', '采购价', '购买价', '买入价'],
  costPrice: ['costPrice', '成本价'],
  finalPayment: ['finalPayment', '尾款'],
};
const REFRESH_ACTIVITY_EXECUTION_MAX_PRODUCTS = 20;
const RENTAL_DELIST_BATCH_MAX_PRODUCTS = 80;
const RENT_FIELD_ORDER: Array<{ field: string; label: string }> = [
  { field: 'rent1day', label: '1天' },
  { field: 'rent2day', label: '2天' },
  { field: 'rent3day', label: '3天' },
  { field: 'rent4day', label: '4天' },
  { field: 'rent5day', label: '5天' },
  { field: 'rent7day', label: '7天' },
  { field: 'rent10day', label: '10天' },
  { field: 'rent15day', label: '15天' },
  { field: 'rent30day', label: '30天' },
  { field: 'rent60day', label: '60天' },
  { field: 'rent90day', label: '90天' },
  { field: 'rent180day', label: '180天' },
];

function formatPublicTrafficReportRunSuccess(result: Awaited<ReturnType<typeof runPublicTrafficReportCli>>): string {
  return [
    '公域日报已生成并发送。',
    `抓取日志：${result.logPath}`,
    '',
    result.dashboardCrawlSummary,
  ].filter((line) => line !== undefined).join('\n');
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readLinkRegistryResolutionMode(value: unknown): 'single' | 'sameSkuGroup' | null {
  if (value === 'single' || value === 'sameSkuGroup') return value;
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRentPriceField(field: string): boolean {
  return /^rent\d+day$/.test(field);
}

function reasonMentionsPriceField(reason: string, field: string): boolean {
  const labels = NON_RENT_PRICE_FIELD_LABELS[field] ?? [];
  const normalizedReason = reason.toLowerCase();
  return labels.some((label) => normalizedReason.includes(label.toLowerCase()));
}

function sanitizeExplicitPriceFields(fields: unknown, reason: string): Record<string, unknown> | unknown {
  if (!isRecord(fields)) return fields;
  const sanitized: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(fields)) {
    if (isRentPriceField(field) || reasonMentionsPriceField(reason, field)) sanitized[field] = value;
  }
  return sanitized;
}

function requireString(value: unknown, fieldName: string): string {
  const parsed = readString(value);
  if (!parsed) throw new Error(`${fieldName} is required`);
  return parsed;
}

function requireProductId(value: unknown, fieldName: string): string {
  const parsed = requireString(value, fieldName);
  if (!/^\d+$/.test(parsed)) throw new Error(`${fieldName} must be numeric`);
  return parsed;
}

function formatLinkRegistryStatus(entry: LinkRegistryEntry): string {
  if (entry.listingState === 'delisted') return '已下架（上架后可操作）';
  if (entry.listingState === 'gone') return '链接不存在（总表缺失）';
  if (entry.status === 'active') return '在架';
  if (entry.status === 'removed') return '已下架';
  return '未知';
}

function formatRegistryProductRows(productIds: string[], entries: LinkRegistryEntry[]): string {
  const entryById = new Map(entries.map((entry) => [entry.internalProductId, entry]));
  return productIds.map((productId) => {
    const entry = entryById.get(productId);
    if (!entry) return `端内ID ${productId}\n未在链接档案中找到`;
    const name = entry.productName ?? entry.shortName ?? '未命名商品';
    const platform = entry.platformProductId ? `平台商品ID ${entry.platformProductId}` : '平台商品ID 未记录';
    return `端内ID ${entry.internalProductId} ${name}\n${platform}，状态 ${formatLinkRegistryStatus(entry)}`;
  }).join('\n\n');
}

async function inventoryStatusToolResponse(
  outputDir: string,
  query: string | undefined,
  options: AgentToolExecutionOptions,
): Promise<BotResponse> {
  const latest = await findLatestReportContext(outputDir);
  if (!latest) return { text: formatInventoryStatusMissingText({ status: 'snapshot_missing' }) };

  const runDate = basename(dirname(latest.path));
  const snapshotPath = buildPublicTrafficPaths(outputDir, runDate).sameSkuSnapshot;
  const [snapshot, registryContext] = await Promise.all([
    readInventorySameSkuSnapshot(snapshotPath),
    loadClosedOrderRegistryContext(options.closedOrderRegistryPaths),
  ]);
  const result = queryInventoryStatus({
    snapshot,
    registryStore: createLinkRegistry(registryContext.registry, registryContext.overrideRisks),
    query: query ?? '',
  });

  if (result.status === 'overview') {
    return { text: formatInventoryStatusOverviewText(result), card: buildInventoryStatusOverviewCard(result) };
  }
  if (result.status === 'detail') {
    return { text: formatInventoryStatusDetailText(result), card: buildInventoryStatusDetailCard(result) };
  }
  if (result.status === 'ambiguous') return { text: formatInventoryStatusAmbiguousText(result) };
  return { text: formatInventoryStatusMissingText(result) };
}

function readProblemType(value: unknown): AgentProblemType {
  if (value === 'low_exposure' || value === 'weak_conversion' || value === 'high_potential' || value === 'new_product_pool' || value === 'recommended_action') return value;
  throw new Error('problemType must be low_exposure, weak_conversion, high_potential, new_product_pool, or recommended_action');
}

function readCategoryRankingMetric(value: unknown): CategoryRankingMetric {
  if (value === 'shippedOrders' || value === 'amount' || value === 'exposure') return value;
  throw new Error('metric must be shippedOrders, amount, or exposure');
}

function readOptionalCategoryRankingMetric(value: unknown): CategoryRankingMetric | undefined {
  if (value === undefined) return undefined;
  return readCategoryRankingMetric(value);
}

function readPeriodDays(value: unknown): 1 | 7 | 30 {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (parsed === 1 || parsed === 7 || parsed === 30) return parsed;
  throw new Error('periodDays must be 1, 7, or 30');
}

function readOptionalPeriodDays(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (Number.isInteger(parsed) && typeof parsed === 'number' && parsed > 0) return parsed;
  throw new Error('periodDays must be a positive integer');
}

function readOptionalLimit(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (Number.isInteger(parsed) && typeof parsed === 'number' && parsed > 0) return parsed;
  throw new Error('limit must be a positive integer');
}

function formatCategoryRankingMetric(metric: CategoryRankingMetric): string {
  if (metric === 'shippedOrders') return '发货';
  if (metric === 'amount') return '金额';
  return '曝光';
}

function formatCategoryRankingResponse(result: ReturnType<typeof rankProductsByCategory>): BotResponse {
  const label = formatCategoryRankingMetric(result.metric);
  const lines = result.items.map((item, index) => `${index + 1}. ${item.productName}（端内ID ${item.internalProductId}，${item.category}）${label} ${item.value}`);
  return {
    text: [
      `品类排名：${result.category ?? '全部'} ${result.period} ${label}`,
      ...lines,
    ].join('\n'),
    metadata: { toolName: 'product.rankByCategory', date: result.date, category: result.category, metric: result.metric, period: result.period, items: result.items },
  };
}

function readWindowedPredicate(value: unknown): WindowedPredicate {
  if (value === 'exposure_without_orders') return value;
  throw new Error('predicate must be exposure_without_orders');
}

function formatWindowedFindingsResponse(result: Awaited<ReturnType<typeof findWindowedProducts>>): BotResponse {
  const lines = result.items.map((item, index) => `${index + 1}. ${item.productName}（端内ID ${item.productId}）命中 ${item.daysMatched} 天，曝光 ${item.exposure}，金额 ${item.amount}`);
  return {
    text: [`窗口发现：${result.startDate} 至 ${result.endDate}`, ...lines].join('\n'),
    metadata: { toolName: 'publicTraffic.windowedFindings', predicate: result.predicate, startDate: result.startDate, endDate: result.endDate, items: result.items },
  };
}

function formatWindowAggregateResponse(result: Awaited<ReturnType<typeof aggregateWindowProducts>>, endDate: string, windowDays: number): BotResponse {
  const lines = result.slice(0, 10).map((item, index) => `${index + 1}. ${item.productName}（端内ID ${item.internalProductId}）覆盖 ${item.daysCovered}/${windowDays} 天，曝光 ${item.exposure}，访问 ${item.publicVisits}，金额 ${item.amount}`);
  const productIds = result.map((item) => item.internalProductId);
  const fullyCoveredProductIds = result.filter((item) => item.daysCovered === windowDays).map((item) => item.internalProductId);
  const partialCoveredProductIds = result.filter((item) => item.daysCovered < windowDays).map((item) => item.internalProductId);
  const missingDatesByProduct = Object.fromEntries(result
    .filter((item) => item.missingDates.length > 0)
    .map((item) => [item.internalProductId, item.missingDates]));
  const status = result.length === 0 ? 'empty' : partialCoveredProductIds.length > 0 ? 'partial' : 'ok';
  return {
    text: [`公域窗口聚合：截至 ${endDate}，近 ${windowDays} 天`, ...lines].join('\n'),
    metadata: { toolName: 'publicTraffic.windowAggregate', status, endDate, windowDays, productCount: result.length, productIds, fullyCoveredProductIds, partialCoveredProductIds, missingDatesByProduct, items: result },
  };
}

function formatDataHealthResponse(result: Awaited<ReturnType<typeof buildDataHealthReport>>): BotResponse {
  return {
    text: [
      `数据健康摘要：${result.date}`,
      `日报上下文：${result.hasReportContext ? '有' : '无'}`,
      `数据质量备注：${result.dataQualityNotes.length ? result.dataQualityNotes.join('；') : '无'}`,
      `曝光无ID样本：${result.missingIdSampleCount} 条`,
      result.orderAnalysisDate ? `订单分析数据日期：${result.orderAnalysisDate}` : undefined,
    ].filter((line): line is string => Boolean(line)).join('\n'),
    metadata: { toolName: 'system.dataHealth', ...result },
  };
}

function readStringArrayArgument(value: unknown, fieldName: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${fieldName} must be an array`);
  return value.map((item) => requireString(item, fieldName));
}

function formatSafeSourceResponse(result: ReturnType<typeof resolveSafeSourceForSameSkuGroup>): BotResponse {
  const text = result.status === 'found'
    ? `同款组 ${result.sameSkuGroupId} 可补链，安全源商品：${result.sourceProductId} ${result.sourceProductName ?? ''}`.trim()
    : `同款组 ${result.sameSkuGroupId} 暂不可补链：${result.reason ?? result.status}`;
  return { text, metadata: { toolName: 'strategy.safeSourceResolve', ...result } };
}

function formatRefreshCandidateExplainResponse(result: ReturnType<typeof explainRefreshCandidates>, zeroMetric: 'created_orders' | 'amount', input: { query?: string; sameSkuGroupId?: string } = {}): BotResponse {
  const status = result.candidateCount > 0 ? 'found' : 'empty';
  return {
    text: [result.scopeLine, ...result.reasonSummary].join('\n'),
    metadata: { toolName: 'strategy.refreshCandidateExplain', status, zeroMetric, ...(input.query ? { query: input.query } : {}), ...(input.sameSkuGroupId ? { sameSkuGroupId: input.sameSkuGroupId } : {}), ...result, skippedReasons: result.reasonSummary },
  };
}

function queryableEntries(entries: LinkRegistryEntry[]): LinkRegistryEntry[] {
  return entries.filter((entry) => entry.status !== 'removed');
}

interface ResolveRentalEntriesOptions {
  expandSingleInternalIdToSameSkuGroup?: boolean;
  allowMultipleInternalIds?: boolean;
}

function parseInternalProductIdsQuery(query: string): string[] | null {
  const normalized = query.trim();
  if (!/^\d+(?:[\s,，、;；]+\d+)*$/.test(normalized)) return null;
  const ids = normalized.split(/[\s,，、;；]+/).filter(Boolean);
  return Array.from(new Set(ids));
}

function parseExplicitInternalProductIdQuery(query: string): string | null {
  const match = /(?:端内\s*id|internal\s*id|^id)\s*[:：#-]?\s*(\d{1,8})$/iu.exec(query.trim());
  return match?.[1] ?? null;
}

function parseExplicitPlatformProductIdQuery(query: string): string | null {
  const match = /(?:平台商品\s*id|平台\s*id|商品\s*id|product\s*id)\s*[:：#-]?\s*([a-z0-9_-]{8,})$/iu.exec(query.trim());
  return match?.[1] ?? null;
}

function isLikelyPlatformProductId(value: string): boolean {
  return /^20\d{10,}$/.test(value.trim());
}

function uniqueRegexGroup(query: string, pattern: RegExp, groupIndex = 1): string | null {
  const values = Array.from(query.matchAll(pattern))
    .map((match) => match[groupIndex]?.trim())
    .filter((value): value is string => Boolean(value));
  const unique = Array.from(new Set(values));
  return unique.length === 1 ? unique[0] : null;
}

function parseExplicitInternalProductIdInText(query: string): string | null {
  return uniqueRegexGroup(query.trim(), /(?:\u7aef\u5185\s*id|internal\s*id|(?:^|[\s#\uFF1A:,-])id)\s*[:\uFF1A#-]?\s*(\d{1,8})(?!\d)/giu);
}

function parseLeadingInternalProductIdActionQuery(query: string): string | null {
  const match = new RegExp('^\\s*(\\d{1,8})(?![\\d.])(?=\\s*(?:$|\\u6574\\u4f53|\\u5168\\u5c40|\\u6539\\u4ef7|\\u8c03\\u4ef7|\\u4ef7\\u683c|\\u79df\\u91d1|\\u94fa|\\u590d\\u5236|\\u8865|\\u67e5|\\u67e5\\u8be2|\\u4e0b\\u67b6|\\u5220\\u9664|\\u89c4\\u683c|\\u540c\\u6b3e|\\u540c\\u7ec4|\\u6574\\u7ec4|\\u6240\\u6709))', 'u').exec(query);
  return match?.[1] ?? null;
}

function parseExplicitPlatformProductIdInText(query: string): string | null {
  return uniqueRegexGroup(query.trim(), /(?:\u5e73\u53f0\u5546\u54c1\s*id|\u5e73\u53f0\s*id|\u5546\u54c1\s*id|product\s*id)\s*[:\uFF1A#-]?\s*([a-z0-9_-]{8,})(?![a-z0-9_-])/giu);
}

function parseLikelyPlatformProductIdInText(query: string): string | null {
  const normalized = query.trim();
  if (isLikelyPlatformProductId(normalized)) return normalized;
  return uniqueRegexGroup(normalized, /(?:^|[^\d])((?:20)\d{10,})(?!\d)/g);
}

function resolveEntriesForSingleEntry(
  entry: LinkRegistryEntry,
  registry: ReturnType<typeof createLinkRegistry>,
  matchText: string,
  expandSingleInternalIdToSameSkuGroup: boolean,
): { ok: true; sameSkuGroupId: string | null; entries: LinkRegistryEntry[]; matchText: string } {
  const sameSkuGroupId = entry.sameSkuGroupId?.trim() ?? null;
  const entries = expandSingleInternalIdToSameSkuGroup && sameSkuGroupId
    ? queryableEntries(registry.listBySameSkuGroup(sameSkuGroupId, { includeUnknown: true }))
    : queryableEntries([entry]);
  return {
    ok: true,
    sameSkuGroupId: expandSingleInternalIdToSameSkuGroup ? sameSkuGroupId : null,
    entries,
    matchText,
  };
}

function resolveRentalPriceSnapshotEntries(
  query: string,
  registry: ReturnType<typeof createLinkRegistry>,
  options: ResolveRentalEntriesOptions = {},
): { ok: true; sameSkuGroupId: string | null; entries: LinkRegistryEntry[]; matchText: string } | { ok: false; text: string } {
  const normalized = query.trim();
  if (!normalized) return { ok: false, text: '请提供要定位的商品、端内ID或同款组。' };

  const expandSingleInternalIdToSameSkuGroup = options.expandSingleInternalIdToSameSkuGroup !== false;
  const platformProductId = parseExplicitPlatformProductIdInText(normalized) ?? parseLikelyPlatformProductIdInText(normalized);
  if (platformProductId) {
    const entry = registry.byPlatformProductId(platformProductId);
    if (!entry) return { ok: false, text: `链接维护档案未找到平台商品ID ${platformProductId}，无法安全定位商品。` };
    return resolveEntriesForSingleEntry(
      entry,
      registry,
      `按平台商品ID ${platformProductId} 精确映射端内ID ${entry.internalProductId}`,
      expandSingleInternalIdToSameSkuGroup,
    );
  }

  const explicitInternalProductId = parseExplicitInternalProductIdInText(normalized) ?? parseLeadingInternalProductIdActionQuery(normalized);
  if (explicitInternalProductId) {
    const entry = registry.getByInternalId(explicitInternalProductId);
    if (!entry) return { ok: false, text: `链接维护档案未找到端内ID ${explicitInternalProductId}，无法安全定位商品。` };
    return resolveEntriesForSingleEntry(
      entry,
      registry,
      expandSingleInternalIdToSameSkuGroup && entry.sameSkuGroupId?.trim()
        ? `按端内ID ${explicitInternalProductId} 命中同款组 ${entry.sameSkuGroupId.trim()}`
        : `按端内ID ${explicitInternalProductId} 查询指定商品`,
      expandSingleInternalIdToSameSkuGroup,
    );
  }

  const explicitIds = parseInternalProductIdsQuery(normalized);
  if (explicitIds && (options.allowMultipleInternalIds || explicitIds.length === 1) && (explicitIds.length > 1 || !expandSingleInternalIdToSameSkuGroup)) {
    const missing: string[] = [];
    const entries = explicitIds
      .map((id) => {
        const entry = registry.getByInternalId(id);
        if (!entry) missing.push(id);
        return entry;
      })
      .filter((entry): entry is LinkRegistryEntry => Boolean(entry));
    if (missing.length) return { ok: false, text: `链接维护档案未找到端内ID ${missing.join('、')}，无法安全定位商品。` };
    const activeEntries = queryableEntries(entries);
    return {
      ok: true,
      sameSkuGroupId: null,
      entries: activeEntries,
      matchText: `按端内ID ${explicitIds.join('、')} 查询指定商品`,
    };
  }

  if (/^\d+$/.test(normalized)) {
    const entry = registry.getByInternalId(normalized);
    if (entry) {
      return resolveEntriesForSingleEntry(
        entry,
        registry,
        expandSingleInternalIdToSameSkuGroup && entry.sameSkuGroupId?.trim()
          ? `按端内ID ${normalized} 命中同款组 ${entry.sameSkuGroupId.trim()}`
          : `按端内ID ${normalized} 查询指定商品`,
        expandSingleInternalIdToSameSkuGroup,
      );
    }
    if (!entry) return { ok: false, text: `链接维护档案未找到端内ID ${normalized}，无法定位商品组。` };
  }

  const directGroupEntries = queryableEntries(registry.listBySameSkuGroup(normalized, { includeUnknown: true }));
  if (directGroupEntries.length > 0) {
    return { ok: true, sameSkuGroupId: normalized, entries: directGroupEntries, matchText: `按同款组 ${normalized} 命中` };
  }

  const alias = registry.resolveAlias(normalized);
  if (alias.status === 'not_found') return { ok: false, text: `链接维护档案未匹配到“${query}”，无法安全判断要处理哪组商品。` };
  if (alias.status === 'multiple') {
    const candidates = alias.candidates
      .slice(0, 5)
      .map((candidate, index) => `${index + 1}. ${candidate.sameSkuGroupId ?? '未分组'}（端内ID ${candidate.candidateInternalProductIds.join('、')}）`)
      .join('\n');
    return { ok: false, text: `“${query}”匹配到多个同款组，请补充更具体的商品名或端内ID：\n${candidates}` };
  }

  const sameSkuGroupId = alias.sameSkuGroupId?.trim() ?? null;
  const entries = sameSkuGroupId ? queryableEntries(registry.listBySameSkuGroup(sameSkuGroupId, { includeUnknown: true })) : queryableEntries(alias.entries);
  return { ok: true, sameSkuGroupId, entries, matchText: alias.reason };
}

async function linkRegistryResolveProductsResponse(
  args: Record<string, unknown>,
  options: AgentToolExecutionOptions,
): Promise<BotResponse> {
  const query = requireString(args.query, 'query');
  const includeUnknown = args.includeUnknown !== false;
  const requestedResolutionMode = readLinkRegistryResolutionMode(args.resolutionMode);
  const explicitIds = parseInternalProductIdsQuery(query);
  const explicitProductIdentifier = Boolean(
    explicitIds ||
    parseExplicitInternalProductIdInText(query) ||
    parseExplicitPlatformProductIdInText(query) ||
    parseLeadingInternalProductIdActionQuery(query) ||
    parseLikelyPlatformProductIdInText(query),
  );
  const effectiveResolutionMode = requestedResolutionMode ?? (explicitProductIdentifier ? 'single' : 'sameSkuGroup');
  const registryContext = await loadClosedOrderRegistryContext(options.closedOrderRegistryPaths);
  const registry = createLinkRegistry(registryContext.registry);
  const resolution = resolveRentalPriceSnapshotEntries(query, registry, {
    expandSingleInternalIdToSameSkuGroup: effectiveResolutionMode === 'sameSkuGroup',
    allowMultipleInternalIds: true,
  });
  if (!resolution.ok) return { text: resolution.text, metadata: { toolName: 'linkRegistry.resolveProducts', status: 'not_found', query, productIds: [], count: 0 } };

  const entries = includeUnknown ? resolution.entries : resolution.entries.filter((entry) => entry.status === 'active');
  const productIds = entries.map((entry) => entry.internalProductId);
  const shown = entries.slice(0, 20).map((entry, index) => {
    const status = formatLinkRegistryStatus(entry);
    return `${index + 1}. 端内ID ${entry.internalProductId} ${compactName(entry)}（${status}）`;
  });
  const hiddenCount = entries.length - shown.length;
  return {
    text: [
      `商品集合解析：${query}`,
      resolution.sameSkuGroupId ? `同款组：${resolution.sameSkuGroupId}` : undefined,
      `匹配依据：${resolution.matchText}`,
      `链接数量：${productIds.length} 条`,
      `可用端内ID：${productIds.join('、') || '无'}`,
      '',
      ...shown,
      hiddenCount > 0 ? `还有 ${hiddenCount} 个未展示。` : undefined,
    ].filter((line): line is string => Boolean(line)).join('\n'),
    metadata: {
      toolName: 'linkRegistry.resolveProducts',
      status: productIds.length ? 'ok' : 'empty',
      query,
      resolutionMode: effectiveResolutionMode,
      sameSkuGroupId: resolution.sameSkuGroupId,
      productIds,
      count: productIds.length,
      matchText: resolution.matchText,
    },
  };
}

function parsePrice(value: string | undefined): number | null {
  if (!value) return null;
  const normalized = value.replace(/[^\d.-]/g, '');
  if (!normalized) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function money(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function normalizeSkuTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim() || '未命名SKU';
}

function formatRentalPriceSnapshot(
  query: string,
  resolution: { sameSkuGroupId: string | null; entries: LinkRegistryEntry[]; matchText: string },
  reads: Array<{ productId: string; result?: RentalPriceReadResult; error?: string }>,
): string {
  const bySku = new Map<string, { displayTitle: string; values: Map<string, number[]>; productIds: Set<string> }>();
  const successReads = reads.filter((item) => item.result?.ok);
  const failedReads = reads.filter((item) => !item.result?.ok);

  for (const read of successReads) {
    const result = read.result!;
    for (const spec of result.specs) {
      const title = normalizeSkuTitle(spec.title);
      const aggregate = bySku.get(title) ?? { displayTitle: title, values: new Map<string, number[]>(), productIds: new Set<string>() };
      const fields = result.values[spec.specId] ?? {};
      let hasPrice = false;
      for (const { field } of RENT_FIELD_ORDER) {
        const price = parsePrice(fields[field]);
        if (price === null) continue;
        const values = aggregate.values.get(field) ?? [];
        values.push(price);
        aggregate.values.set(field, values);
        hasPrice = true;
      }
      if (hasPrice) aggregate.productIds.add(result.productId);
      bySku.set(title, aggregate);
    }
  }

  const header = [
    `定价情况：${query}`,
    resolution.sameSkuGroupId ? `同款组：${resolution.sameSkuGroupId}` : undefined,
    `匹配依据：${resolution.matchText}`,
    `读取商品：成功 ${successReads.length}/${resolution.entries.length}（${successReads.map((item) => item.productId).join('、') || '无'}）`,
  ].filter((line): line is string => Boolean(line));

  if (bySku.size === 0) {
    return [
      ...header,
      '',
      '已读取商品，但没有拿到可聚合的租金字段。',
      ...(failedReads.length ? ['', '失败商品：', ...failedReads.map((item) => `- ${item.productId}: ${item.error ?? item.result?.lines.join('；') ?? '读取失败'}`)] : []),
    ].join('\n');
  }

  const skuLines = [...bySku.values()]
    .sort((left, right) => left.displayTitle.localeCompare(right.displayTitle, 'zh-CN'))
    .slice(0, 20)
    .map((sku) => {
      const prices = RENT_FIELD_ORDER
        .map(({ field, label }) => {
          const values = sku.values.get(field) ?? [];
          return values.length ? `${label} ¥${money(average(values))}（样本${values.length}）` : '';
        })
        .filter(Boolean)
        .join('，');
      return `- ${sku.displayTitle}：${prices || '暂无租金字段'}；覆盖商品 ${sku.productIds.size} 个`;
    });

  const omittedSkuCount = bySku.size - skuLines.length;
  return [
    ...header,
    '',
    '按 SKU 聚合平均租金：',
    ...skuLines,
    ...(omittedSkuCount > 0 ? [`还有 ${omittedSkuCount} 个 SKU 未展示。`] : []),
    ...(failedReads.length ? ['', '失败商品：', ...failedReads.map((item) => `- ${item.productId}: ${item.error ?? item.result?.lines.join('；') ?? '读取失败'}`)] : []),
  ].join('\n');
}

async function rentalPriceSnapshotResponse(
  query: string,
  client: RentalPriceSkillClient,
  options: AgentToolExecutionOptions,
): Promise<BotResponse> {
  if (!client.read) return { text: '当前租赁改价客户端还没有接入只读价格读取能力，无法查询定价情况。' };
  const registryContext = await loadClosedOrderRegistryContext(options.closedOrderRegistryPaths);
  const registry = createLinkRegistry(registryContext.registry);
  const resolution = resolveRentalPriceSnapshotEntries(query, registry);
  if (!resolution.ok) return { text: resolution.text };
  if (resolution.entries.length === 0) return { text: `链接维护档案已匹配到“${query}”，但没有可查询的未下架商品。` };
  if (resolution.entries.length > RENTAL_PRICE_SNAPSHOT_MAX_PRODUCTS) {
    return { text: `“${query}”命中 ${resolution.entries.length} 个未下架商品，超过单次定价快照上限 ${RENTAL_PRICE_SNAPSHOT_MAX_PRODUCTS} 个。请补充更具体的端内ID或子分组。` };
  }

  const reads = await Promise.all(resolution.entries.map(async (entry) => {
    try {
      const result = await client.read!(entry.internalProductId);
      return { productId: entry.internalProductId, result };
    } catch (error) {
      return { productId: entry.internalProductId, error: error instanceof Error ? error.message : String(error) };
    }
  }));

  return { text: formatRentalPriceSnapshot(query, resolution, reads) };
}

function readPriceChangeScope(_value: unknown): 'rent_fields' | 'all_price_fields' {
  return 'rent_fields';
}

function formatDiscountText(discount: number): string {
  return Number.isInteger(discount * 100) ? `${discount * 100}%` : `${(discount * 100).toFixed(2)}%`;
}

function formatAdjustmentAmountText(adjustmentAmount: number): string {
  const prefix = adjustmentAmount > 0 ? '+' : '';
  return `${prefix}${adjustmentAmount.toFixed(2)}`;
}

function compactPreviewLine(productId: string, fields: Record<string, string>): string {
  const fieldCount = Object.keys(fields).length;
  const samples = Object.entries(fields)
    .slice(0, 4)
    .map(([field, value]) => `${field}=${value}`)
    .join('，');
  return `商品 ${productId}：${fieldCount} 个价格字段${samples ? `（${samples}${fieldCount > 4 ? '...' : ''}）` : ''}`;
}

function formatPricePreviewText(input: {
  productIds: string[];
  discount?: number;
  adjustmentAmount?: number;
  scope?: 'rent_fields' | 'all_price_fields';
  readyItems: Array<{ productId: string; fields: Record<string, string>; audit?: RentalPriceAuditReference }>;
  blocked: string[];
}): string {
  const readyLines = input.readyItems.slice(0, 12).map((item, index) => `${index + 1}. ${compactPreviewLine(item.productId, item.fields)}${item.audit?.taskId ? `；审计 ${item.audit.taskId}` : ''}`);
  return [
    `改价预览：${input.productIds.length} 个端内ID`,
    input.discount !== undefined ? `折扣：${formatDiscountText(input.discount)}` : undefined,
    input.adjustmentAmount !== undefined ? `金额调整：${formatAdjustmentAmountText(input.adjustmentAmount)}` : undefined,
    input.scope ? '范围：租金字段' : undefined,
    `端内ID：${input.productIds.join('、')}`,
    '',
    ...readyLines,
    input.readyItems.length > readyLines.length ? `还有 ${input.readyItems.length - readyLines.length} 个商品未展示。` : undefined,
    '',
    '安全边界：确认前不会改价；确认后按上面每个商品的审计预览逐个执行，并保留各自回滚文件。',
    ...(input.blocked.length ? ['', '已阻断，未生成执行确认卡：', ...input.blocked.slice(0, 12)] : []),
  ].filter((line): line is string => Boolean(line)).join('\n');
}

function readProductIdArray(value: unknown, maxItems: number): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxItems) return null;
  const ids = value.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean);
  if (ids.length !== value.length || ids.some((id) => !/^\d+$/.test(id))) return null;
  return [...new Set(ids)];
}

function readDelistProductIds(args: Record<string, unknown>): string[] | null {
  const fromArray = readProductIdArray(args.productIds, RENTAL_DELIST_BATCH_MAX_PRODUCTS);
  const fromString = readString(args.productId);
  const parsedStringIds = fromString ? parseNumericProductIdList(fromString) : [];
  const ids = [...(fromArray ?? []), ...parsedStringIds].filter((id) => /^\d+$/.test(id));
  const unique = [...new Set(ids)];
  if (unique.length === 0 || unique.length > RENTAL_DELIST_BATCH_MAX_PRODUCTS) return null;
  return unique;
}

async function rentalPricePreviewResponse(
  args: Record<string, unknown>,
  reason: string,
  client: RentalPriceSkillClient,
  outputDir: string,
  continuation?: AgentToolConfirmRequest['continuation'],
): Promise<BotResponse> {
  const productIds = readProductIdArray(args.productIds, RENTAL_PRICE_PREVIEW_MAX_PRODUCTS);
  if (!productIds) return { text: `改价预览参数无效：productIds 需要是 1 到 ${RENTAL_PRICE_PREVIEW_MAX_PRODUCTS} 个端内ID。`, metadata: { toolName: 'rental.pricePreview', ok: false } };

  if (hasPriceAdjustmentConflict(args)) {
    return {
      text: PRICE_ADJUSTMENT_CONFLICT_MESSAGE,
      metadata: { toolName: 'rental.pricePreview', ok: false, productIds },
    };
  }

  const inferredFields = isRecord(args.fields) ? undefined : parseRentPriceFieldsFromText(reason);
  const rawFields = isRecord(args.fields) ? args.fields : inferredFields && Object.keys(inferredFields).length ? inferredFields : undefined;
  const priceArgs = rawFields ? { ...args, fields: sanitizeExplicitPriceFields(rawFields, reason) } : args;
  const hasExplicitFields = isRecord(priceArgs.fields);
  const explicitDiscount = !hasExplicitFields && priceArgs.discount !== undefined;
  const parsedDiscount = explicitDiscount ? readPriceMultiplierArgument(priceArgs.discount) : null;
  if (explicitDiscount && parsedDiscount === null) {
    return {
      text: INVALID_DISCOUNT_ARGUMENT_MESSAGE,
      metadata: { toolName: 'rental.pricePreview', ok: false, productIds },
    };
  }
  const adjustmentAmount = hasExplicitFields
    ? undefined
    : (readPriceAdjustmentAmountArgument(priceArgs.adjustmentAmount) ?? inferPriceAdjustmentAmountFromText(reason));
  const discount = hasExplicitFields || adjustmentAmount !== null
    ? undefined
    : (explicitDiscount ? parsedDiscount : inferPriceMultiplierFromText(reason));
  if (!hasExplicitFields && adjustmentAmount === null && discount === null) {
    return { text: '改价预览参数无效：需要提供 fields、discount 折扣倍数，或 adjustmentAmount 金额增减（例如 -1 表示每个租金字段减 1 元）。', metadata: { toolName: 'rental.pricePreview', ok: false, productIds } };
  }
  const scope = hasExplicitFields ? undefined : readPriceChangeScope(priceArgs.scope);

  const blocked: string[] = [];
  const readyItems: Array<{ productId: string; fields: Record<string, string>; audit?: RentalPriceAuditReference }> = [];
  for (const productId of productIds) {
    const requestArgs: Record<string, unknown> = hasExplicitFields
      ? { productId, fields: priceArgs.fields }
      : adjustmentAmount !== null
        ? { productId, adjustmentAmount, scope }
        : { productId, discount, scope };
    const rentalRequest = rentalPriceChangeRequestFromToolArguments(requestArgs);
    if (!rentalRequest) {
      blocked.push(`商品 ${productId}：改价参数无效`);
      continue;
    }
    try {
      const preview = await client.preview(rentalRequest);
      const audit = compactAuditReference(preview.audit);
      if (audit?.hasErrors) {
        blocked.push(`商品 ${productId}：审计错误，已阻断`);
        continue;
      }
      if (Object.keys(preview.fields).length === 0) {
        blocked.push(`商品 ${productId}：没有可改价格字段`);
        continue;
      }
      readyItems.push({
        productId,
        fields: preview.fields,
        ...(audit ? { audit } : {}),
      });
    } catch (error) {
      blocked.push(`商品 ${productId}：预览失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const text = formatPricePreviewText({
    productIds,
    ...(discount !== undefined && discount !== null ? { discount } : {}),
    ...(adjustmentAmount !== undefined && adjustmentAmount !== null ? { adjustmentAmount } : {}),
    ...(scope ? { scope } : {}),
    readyItems,
    blocked,
  });
  if (blocked.length > 0 || readyItems.length !== productIds.length) {
    return {
      text,
      metadata: { toolName: 'rental.pricePreview', ok: false, productIds, previewCount: readyItems.length },
    };
  }

  const confirmRequest: AgentToolConfirmRequest = {
    toolName: 'rental.priceApply',
    arguments: { items: readyItems },
    reason,
    ...(continuation ? { continuation } : {}),
  };
  const requestRef = await saveAgentToolConfirmRequest(outputDir, confirmRequest);
  return {
    text,
    card: buildAgentToolConfirmCard(confirmRequest, { requestRef }),
    metadata: {
      toolName: 'rental.pricePreview',
      ok: true,
      productIds,
      previewCount: readyItems.length,
    },
  };
}

function readPriceApplyItems(value: unknown): Array<{ productId: string; fields: Record<string, string>; audit?: RentalPriceAuditReference }> | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > RENTAL_PRICE_PREVIEW_MAX_PRODUCTS) return null;
  const items: Array<{ productId: string; fields: Record<string, string>; audit?: RentalPriceAuditReference }> = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const productId = readString(item.productId);
    if (!productId) return null;
    const request = rentalPriceChangeRequestFromToolArguments({ productId, fields: item.fields });
    if (!request || request.mode !== 'explicit_fields') return null;
    items.push({
      productId,
      fields: request.fields,
      ...(isRecord(item.audit) ? { audit: item.audit as RentalPriceAuditReference } : {}),
    });
  }
  return items;
}

async function recordAgentToolWriteEvent(
  context: RentalWriteLedgerContext | undefined,
  event: AgentToolWriteEvent,
  toolName: string,
  productId: string,
): Promise<void> {
  if (!context) return;
  await recordOperationEvent(context.outputDir, {
    planId: context.decisionId ?? context.runId ?? 'ad-hoc',
    at: context.missionDate ? `${context.missionDate}T00:00:00.000Z` : new Date().toISOString(),
    event,
    toolName,
    ...(context.runId ? { runId: context.runId } : {}),
    ...(context.decisionId ? { decisionId: context.decisionId } : {}),
    subject: { kind: 'product', id: productId },
    ...(context.missionDate ? { metadata: { missionDate: context.missionDate } } : {}),
  });
}

async function rentalPriceApplyResponse(
  args: Record<string, unknown>,
  client: RentalPriceSkillClient,
  ledgerContext?: RentalWriteLedgerContext,
): Promise<BotResponse> {
  const items = readPriceApplyItems(args.items);
  if (!items) throw new Error('改价执行参数无效，请重新发起预览。');
  const results: RentalPriceExecutionResult[] = [];
  for (const item of items) {
    const request: Extract<RentalPriceChangeRequest, { mode: 'explicit_fields' }> = {
      mode: 'explicit_fields',
      productId: item.productId,
      fields: item.fields,
      ...(item.audit ? { audit: item.audit } : {}),
    };
    try {
      await recordAgentToolWriteEvent(ledgerContext, 'execution_started', 'rental.priceApply', item.productId);
      const result = await client.execute(request);
      await recordAgentToolWriteEvent(ledgerContext, result.ok ? 'execution_succeeded' : 'execution_failed', 'rental.priceApply', item.productId);
      results.push(result);
    } catch (error) {
      await recordAgentToolWriteEvent(ledgerContext, 'execution_failed', 'rental.priceApply', item.productId);
      results.push({ productId: item.productId, ok: false, lines: [error instanceof Error ? error.message : String(error)] });
    }
  }

  const success = results.filter((item) => item.ok);
  const lines = results.flatMap((item, index) => [
    `${index + 1}. 商品 ${item.productId}：${item.ok ? '成功' : '失败'}`,
    ...item.lines.slice(0, 8).map((line) => `   ${line}`),
  ]);
  return {
    text: [
      `改价执行完成：成功 ${success.length}/${results.length}`,
      '',
      ...lines,
    ].join('\n'),
    metadata: {
      toolName: 'rental.priceApply',
      ok: success.length === results.length,
      productIds: results.map((item) => item.productId),
      successProductIds: success.map((item) => item.productId),
      taskIds: results.map((item) => item.audit?.taskId).filter((value): value is string => Boolean(value)),
      rollbackFiles: results.map((item) => item.audit?.rollbackFile).filter((value): value is string => Boolean(value)),
    },
  };
}

function normalizeMatchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '');
}

function itemMatchesKeyword(title: string, keyword: string): boolean {
  const normalizedTitle = normalizeMatchText(title);
  const normalizedKeyword = normalizeMatchText(keyword);
  return Boolean(normalizedKeyword && normalizedTitle.includes(normalizedKeyword));
}

function compactName(entry: LinkRegistryEntry): string {
  return entry.shortName?.trim() || entry.productName?.trim() || entry.internalProductId;
}

function formatSpecRemovePlanLines(
  query: string,
  keyword: string,
  resolution: { sameSkuGroupId: string | null; entries: LinkRegistryEntry[]; matchText: string },
  matches: RentalSpecRemoveItemConfirmRequest[],
  blocked: string[],
  failedReads: string[],
): string {
  const productIds = Array.from(new Set(matches.map((item) => item.productId)));
  const shown = matches.slice(0, 30).map((item, index) => {
    const dimension = item.dimensionTitle ? `${item.dimensionTitle} / ` : '';
    const itemId = item.itemId ? `，itemId ${item.itemId}` : '';
    return `${index + 1}. 商品 ${item.productId}：${dimension}${item.itemTitle}（维度 ${item.specDimId}${itemId}）`;
  });
  return [
    `规格项删除计划：${query} / 关键词「${keyword}」`,
    resolution.sameSkuGroupId ? `同款组：${resolution.sameSkuGroupId}` : undefined,
    `匹配依据：${resolution.matchText}`,
    `涉及商品：${productIds.length} 个（${productIds.join('、')}）`,
    `命中规格项：${matches.length} 个`,
    resolution.entries.length > RENTAL_SPEC_REMOVE_PLAN_BULK_WARNING_PRODUCTS
      ? `大批量提示：本次读取了 ${resolution.entries.length} 个商品；确认后会按下方清单逐个删除命中的规格项。`
      : undefined,
    '',
    ...shown,
    matches.length > shown.length ? `还有 ${matches.length - shown.length} 个命中项未展示。` : undefined,
    '',
    '安全边界：只删除命中的规格项，不删除规格维度；规格维度只剩 1 个 item 时会被阻断。',
    ...(blocked.length ? ['', '已阻断项：', ...blocked.slice(0, 8)] : []),
    ...(failedReads.length ? ['', '读取失败：', ...failedReads.slice(0, 8)] : []),
  ].filter((line): line is string => Boolean(line)).join('\n');
}

async function rentalSpecRemovePlanResponse(
  query: string,
  keyword: string,
  reason: string,
  client: RentalPriceSkillClient,
  options: AgentToolExecutionOptions,
  continuation?: AgentToolConfirmRequest['continuation'],
): Promise<BotResponse> {
  const registryContext = await loadClosedOrderRegistryContext(options.closedOrderRegistryPaths);
  const registry = createLinkRegistry(registryContext.registry);
  const resolution = resolveRentalPriceSnapshotEntries(query, registry, { expandSingleInternalIdToSameSkuGroup: false, allowMultipleInternalIds: true });
  if (!resolution.ok) return { text: resolution.text };
  if (resolution.entries.length === 0) return { text: `链接维护档案已匹配到“${query}”，但没有可处理的未下架商品。` };
  if (resolution.entries.length > RENTAL_SPEC_REMOVE_PLAN_MAX_PRODUCTS) {
    return { text: `“${query}”命中 ${resolution.entries.length} 个未下架商品，超过单次规格删除硬上限 ${RENTAL_SPEC_REMOVE_PLAN_MAX_PRODUCTS} 个。请补充更具体的端内ID或子分组。` };
  }

  const reads = await Promise.all(resolution.entries.map(async (entry) => {
    try {
      const result = await client.specDiscover(entry.internalProductId);
      return { entry, result };
    } catch (error) {
      return { entry, error: error instanceof Error ? error.message : String(error) };
    }
  }));

  const matches: RentalSpecRemoveItemConfirmRequest[] = [];
  const blocked: string[] = [];
  const failedReads: string[] = [];
  for (const read of reads) {
    if (!read.result?.ok) {
      failedReads.push(`- ${read.entry.internalProductId} ${compactName(read.entry)}：${read.error ?? read.result?.lines.join('；') ?? '规格读取失败'}`);
      continue;
    }

    for (const dimension of read.result.dimensions) {
      const matchedItems = dimension.items.filter((item) => itemMatchesKeyword(item.title, keyword));
      if (matchedItems.length === 0 && itemMatchesKeyword(dimension.title, keyword)) {
        blocked.push(`- 商品 ${read.entry.internalProductId}：关键词只命中规格维度「${dimension.title}」，未命中具体规格项，已阻断维度删除。`);
        continue;
      }
      for (const item of matchedItems) {
        if (dimension.items.length <= 1) {
          blocked.push(`- 商品 ${read.entry.internalProductId}：维度「${dimension.title}」只剩 1 个规格项「${item.title}」，删除会清空维度，已阻断。`);
          continue;
        }
        matches.push({
          productId: read.entry.internalProductId,
          specDimId: dimension.specId,
          ...(dimension.title.trim() ? { dimensionTitle: dimension.title.trim() } : {}),
          ...(item.id && item.id !== '?' ? { itemId: item.id } : {}),
          itemTitle: item.title,
          keyword,
        });
      }
    }
  }

  if (matches.length === 0) {
    return {
      text: [
        `没有找到可安全删除的规格项：${query} / 关键词「${keyword}」`,
        resolution.sameSkuGroupId ? `同款组：${resolution.sameSkuGroupId}` : undefined,
        `匹配依据：${resolution.matchText}`,
        ...(blocked.length ? ['', '阻断原因：', ...blocked.slice(0, 8)] : []),
        ...(failedReads.length ? ['', '读取失败：', ...failedReads.slice(0, 8)] : []),
      ].filter((line): line is string => Boolean(line)).join('\n'),
    };
  }

  if (matches.length > RENTAL_SPEC_REMOVE_PLAN_MAX_ITEMS) {
    return {
      text: [
        `“${query}”中关键词「${keyword}」命中 ${matches.length} 个规格项，超过单次确认上限 ${RENTAL_SPEC_REMOVE_PLAN_MAX_ITEMS} 个。`,
        '请缩小到更具体的端内ID、子分组或规格关键词后再执行。',
      ].join('\n'),
    };
  }

  const request: RentalOperationConfirmRequest = {
    action: 'spec-remove-items',
    productId: matches[0]!.productId,
    query,
    keyword,
    ...(resolution.sameSkuGroupId ? { sameSkuGroupId: resolution.sameSkuGroupId } : {}),
    items: matches,
    plannerToolName: 'rental.specRemovePlan',
    plannerArguments: { query, keyword },
    plannerReason: reason,
    ...(continuation ? { continuation } : {}),
  };
  return {
    text: formatSpecRemovePlanLines(query, keyword, resolution, matches, blocked, failedReads),
    card: buildRentalOperationConfirmCard(request, reason),
  };
}

function extractInternalProductId(displayProductId: string): string | null {
  return /^端内ID\s*(\d+)$/i.exec(displayProductId.trim())?.[1] ?? null;
}

function findReportRowForEntry(context: PublicTrafficDataReportContext, entry: LinkRegistryEntry): PublicTrafficProductDataRow | undefined {
  return context.rows.find((row) => {
    const internalProductId = extractInternalProductId(row.displayProductId);
    return internalProductId === entry.internalProductId || (!!entry.platformProductId && row.platformProductId === entry.platformProductId);
  });
}

function readMaxCandidates(value: unknown): number {
  if (value === undefined) return REFRESH_ACTIVITY_DEFAULT_MAX_CANDIDATES;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 1) return REFRESH_ACTIVITY_DEFAULT_MAX_CANDIDATES;
  return Math.min(Math.floor(numeric), 100);
}

function parseDateToUtcDay(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const utc = Date.UTC(year, month - 1, day);
  const parsed = new Date(utc);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return utc;
}

function estimateOnlineDays(row: PublicTrafficProductDataRow, entry: LinkRegistryEntry, reportDate: string): number | null {
  if (typeof row.custodyDays === 'number' && Number.isFinite(row.custodyDays) && row.custodyDays >= 0) {
    return Math.floor(row.custodyDays);
  }
  const reportDay = parseDateToUtcDay(reportDate);
  const firstSeenDay = parseDateToUtcDay(entry.firstSeenDate);
  if (reportDay === null || firstSeenDay === null || firstSeenDay > reportDay) return null;
  return Math.floor((reportDay - firstSeenDay) / MS_PER_DAY) + 1;
}

function groupRefreshActivityCandidates(candidates: Array<{ entry: LinkRegistryEntry; row: PublicTrafficProductDataRow }>) {
  const groups = new Map<string, { label: string; category: string; sameSkuGroupId: string; items: Array<{ entry: LinkRegistryEntry; row: PublicTrafficProductDataRow }> }>();
  for (const candidate of candidates) {
    const sameSkuGroupId = candidate.entry.sameSkuGroupId?.trim() || '未分组';
    const category = candidate.entry.categoryName?.trim() || candidate.entry.productType?.trim() || '未分类';
    const label = candidate.entry.shortName?.trim() || candidate.entry.productName?.trim() || sameSkuGroupId;
    const key = `${category}::${sameSkuGroupId}`;
    const group = groups.get(key) ?? { label, category, sameSkuGroupId, items: [] };
    group.items.push(candidate);
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => right.items.length - left.items.length || left.label.localeCompare(right.label, 'zh-CN'));
}

interface RefreshActivityNewLinkItem {
  keyword: string;
  count: number;
  sourceProductId: string;
  sourceProductName: string;
  sameSkuGroupId?: string;
}

type RefreshActivityZeroMetric = 'created_orders' | 'amount';

interface RefreshActivityExecuteRequest {
  date: string;
  delistProductIds: string[];
  newLinkItems: RefreshActivityNewLinkItem[];
  strategy: RefreshActivityExecutionStrategy;
}

type RefreshActivityExecutionStrategy = 'delist_only' | 'delist_and_refill';

function refreshActivitySourceScore(row: PublicTrafficProductDataRow): number {
  const one = row.periods['1d'];
  const seven = row.periods['7d'];
  const thirty = row.periods['30d'];
  return (
    seven.shippedOrders * 1000
    + seven.amount * 2
    + seven.publicVisits * 5
    + one.shippedOrders * 300
    + one.amount * 3
    + thirty.shippedOrders * 100
    + thirty.createdOrders * 50
    + Math.min(seven.exposure, 5000) * 0.1
  );
}

function readRefreshActivityZeroMetric(value: unknown): RefreshActivityZeroMetric {
  if (value === undefined) return 'created_orders';
  if (value === 'created_orders' || value === 'amount') return value;
  throw new Error('zeroMetric must be created_orders or amount');
}

function refreshActivityZeroMetricLabel(zeroMetric: RefreshActivityZeroMetric): string {
  return zeroMetric === 'amount' ? '近30天订单金额为0' : '近 30 天创单为 0';
}

function isRefreshActivityZeroMetricMatch(thirty: PublicTrafficProductDataRow['periods']['30d'], zeroMetric: RefreshActivityZeroMetric): boolean {
  return zeroMetric === 'amount' ? thirty.amount === 0 : thirty.createdOrders === 0;
}

function scopedRefreshActivityEntries(
  args: Record<string, unknown>,
  registryEntries: LinkRegistryEntry[],
): { entries: LinkRegistryEntry[]; scopeLine?: string } | { text: string } {
  const query = readString(args.query);
  const sameSkuGroupId = readString(args.sameSkuGroupId);
  if (!query && !sameSkuGroupId) return { entries: registryEntries };

  const registry = createLinkRegistry(registryEntries);
  if (sameSkuGroupId) {
    const entries = registry.listBySameSkuGroup(sameSkuGroupId, { includeUnknown: true });
    if (entries.length === 0) return { text: `没有找到该商品对应的同款组/链接档案：${sameSkuGroupId}` };
    const label = entries.find((entry) => entry.shortName?.trim())?.shortName?.trim() || sameSkuGroupId;
    return { entries, scopeLine: `筛选范围：${label} / ${sameSkuGroupId}` };
  }

  const resolution = resolveRentalPriceSnapshotEntries(query!, registry, { expandSingleInternalIdToSameSkuGroup: true });
  if (!resolution.ok) return { text: '没有找到该商品对应的同款组/链接档案' };
  const label = resolution.entries.find((entry) => entry.shortName?.trim())?.shortName?.trim() || query!;
  return { entries: resolution.entries, scopeLine: `筛选范围：${label} / ${resolution.sameSkuGroupId ?? '未分组'}` };
}

function buildRefreshActivityNewLinkItems(
  groups: ReturnType<typeof groupRefreshActivityCandidates>,
  context: PublicTrafficDataReportContext,
  registryEntries: LinkRegistryEntry[],
  delistProductIds: Set<string>,
): { items: RefreshActivityNewLinkItem[]; blockers: string[]; skippedGroups: string[]; skippedBlockers: string[] } {
  const items: RefreshActivityNewLinkItem[] = [];
  const blockers: string[] = [];
  const skippedGroups: string[] = [];
  const skippedBlockers: string[] = [];

  for (const group of groups) {
    if (group.sameSkuGroupId === '未分组') {
      const blocker = `${group.label} 没有同款组，无法安全选择补链源商品。`;
      skippedGroups.push(group.label);
      skippedBlockers.push(blocker);
      continue;
    }

    const source = registryEntries
      .filter((entry) =>
        entry.status === 'active'
        && entry.sameSkuGroupId?.trim() === group.sameSkuGroupId
        && !delistProductIds.has(entry.internalProductId))
      .map((entry) => {
        const row = findReportRowForEntry(context, entry);
        return row ? { entry, row, score: refreshActivitySourceScore(row) } : null;
      })
      .filter((candidate): candidate is { entry: LinkRegistryEntry; row: PublicTrafficProductDataRow; score: number } => Boolean(candidate && candidate.score > 0))
      .sort((left, right) => right.score - left.score || Number(left.entry.internalProductId) - Number(right.entry.internalProductId))[0];

    if (!source) {
      const skippedGroup = `${group.label}｜${group.sameSkuGroupId}`;
      const blocker = `${skippedGroup} 没有可用的安全源商品；不会从即将下架的链接复制新链。`;
      skippedGroups.push(skippedGroup);
      skippedBlockers.push(blocker);
      continue;
    }

    items.push({
      keyword: group.label,
      count: group.items.length,
      sourceProductId: source.entry.internalProductId,
      sourceProductName: source.row.productName || source.entry.productName || source.entry.shortName || source.entry.internalProductId,
      sameSkuGroupId: group.sameSkuGroupId,
    });
  }

  const totalNewLinks = items.reduce((sum, item) => sum + item.count, 0);
  if (totalNewLinks > MAX_NEW_LINK_BATCH_COUNT) {
    blockers.push(`补链总数 ${totalNewLinks} 条超过单次复制上限 ${MAX_NEW_LINK_BATCH_COUNT} 条，请缩小候选数量后再执行。`);
  }

  return { items, blockers, skippedGroups, skippedBlockers };
}

function buildRefreshActivityExecuteRequest(
  date: string,
  groups: ReturnType<typeof groupRefreshActivityCandidates>,
  context: PublicTrafficDataReportContext,
  registryEntries: LinkRegistryEntry[],
  strategy: RefreshActivityExecutionStrategy,
): { request?: RefreshActivityExecuteRequest; blockers: string[]; skippedGroups: string[]; skippedBlockers: string[] } {
  const delistProductIds = groups.flatMap((group) => group.items.map((item) => item.entry.internalProductId));
  const blockers: string[] = [];
  if (delistProductIds.length === 0) blockers.push('没有待下架候选。');
  if (delistProductIds.length > REFRESH_ACTIVITY_EXECUTION_MAX_PRODUCTS) {
    blockers.push(`待下架候选 ${delistProductIds.length} 条超过单次执行上限 ${REFRESH_ACTIVITY_EXECUTION_MAX_PRODUCTS} 条，请缩小候选数量后再执行。`);
  }

  if (blockers.length > 0) return { blockers, skippedGroups: [], skippedBlockers: [] };

  if (strategy === 'delist_only') {
    return { request: { date, delistProductIds, newLinkItems: [], strategy }, blockers, skippedGroups: [], skippedBlockers: [] };
  }

  const newLinks = buildRefreshActivityNewLinkItems(groups, context, registryEntries, new Set(delistProductIds));
  blockers.push(...newLinks.blockers);
  if (blockers.length > 0) return { blockers, skippedGroups: newLinks.skippedGroups, skippedBlockers: newLinks.skippedBlockers };
  const executableGroupIds = new Set(newLinks.items.map((item) => item.sameSkuGroupId).filter((value): value is string => Boolean(value)));
  const executableDelistProductIds = groups
    .filter((group) => executableGroupIds.has(group.sameSkuGroupId))
    .flatMap((group) => group.items.map((item) => item.entry.internalProductId));
  if (executableDelistProductIds.length === 0 || newLinks.items.length === 0) return { blockers: ['没有可执行的下架+补链候选。'], skippedGroups: newLinks.skippedGroups, skippedBlockers: newLinks.skippedBlockers };
  return {
    request: { date, delistProductIds: executableDelistProductIds, newLinkItems: newLinks.items, strategy },
    blockers,
    skippedGroups: newLinks.skippedGroups,
    skippedBlockers: newLinks.skippedBlockers,
  };
}

function readRefreshActivityExecutionStrategy(value: unknown): RefreshActivityExecutionStrategy {
  if (value === undefined) return 'delist_and_refill';
  if (value === 'delist_only' || value === 'delist_and_refill') return value;
  throw new Error('strategy must be delist_only or delist_and_refill');
}

function readStringArray(value: unknown, fieldName: string, maxItems: number): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maxItems) {
    throw new Error(`${fieldName} must be a non-empty array up to ${maxItems} items`);
  }
  const values = value.map((item) => requireProductId(item, fieldName));
  if (new Set(values).size !== values.length) throw new Error(`${fieldName} contains duplicate product ids`);
  return values;
}

function readRefreshActivityNewLinkItems(value: unknown): RefreshActivityNewLinkItem[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > REFRESH_ACTIVITY_EXECUTION_MAX_PRODUCTS) {
    throw new Error(`newLinkItems must be a non-empty array up to ${REFRESH_ACTIVITY_EXECUTION_MAX_PRODUCTS} items`);
  }
  const items = value.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new Error('newLinkItems item must be an object');
    const record = item as Record<string, unknown>;
    const keyword = requireString(record.keyword, 'keyword');
    const sourceProductId = requireProductId(record.sourceProductId, 'sourceProductId');
    const sourceProductName = requireString(record.sourceProductName, 'sourceProductName');
    const count = typeof record.count === 'number' ? record.count : Number(record.count);
    if (!Number.isInteger(count) || count < 1 || count > MAX_NEW_LINK_BATCH_COUNT) throw new Error('newLinkItems count must be a positive integer within copy limit');
    const sameSkuGroupId = readString(record.sameSkuGroupId) ?? undefined;
    return { keyword, count, sourceProductId, sourceProductName, ...(sameSkuGroupId ? { sameSkuGroupId } : {}) };
  });
  const totalCount = items.reduce((sum, item) => sum + item.count, 0);
  if (totalCount > MAX_NEW_LINK_BATCH_COUNT) throw new Error(`new link total count must be <= ${MAX_NEW_LINK_BATCH_COUNT}`);
  return items;
}

function readRefreshActivityExecuteRequest(args: Record<string, unknown>): RefreshActivityExecuteRequest {
  const date = requireString(args.date, 'date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('date must be YYYY-MM-DD');
  const strategy = readRefreshActivityExecutionStrategy(args.strategy);
  return {
    date,
    delistProductIds: readStringArray(args.delistProductIds, 'delistProductIds', REFRESH_ACTIVITY_EXECUTION_MAX_PRODUCTS),
    newLinkItems: args.newLinkItems === undefined && strategy === 'delist_only' ? [] : readRefreshActivityNewLinkItems(args.newLinkItems),
    strategy,
  };
}

function timestampToken(): string {
  return new Date().toISOString().replace(/[-:.TZ]/g, '');
}

async function writeRefreshActivityAudit(outputDir: string, value: unknown): Promise<string> {
  const dir = join(outputDir, 'agent-audit', 'refresh-activity');
  await mkdir(dir, { recursive: true });
  const path = join(dir, `refresh-activity-${timestampToken()}.json`);
  await writeFile(path, JSON.stringify(value, null, 2), 'utf8');
  return path;
}

function isSafeMissingDelistResult(result: Awaited<ReturnType<RentalPriceSkillClient['delist']>>): boolean {
  if (result.ok) return false;
  return /Product not found/i.test(result.lines.join('\n'));
}

async function rentalDelistBatchResponse(
  args: Record<string, unknown>,
  client: RentalPriceSkillClient,
  toolName: 'rental.delist' | 'rental.delistBatch' = 'rental.delistBatch',
): Promise<BotResponse> {
  const productIds = readDelistProductIds(args);
  if (!productIds) {
    return {
      text: `批量下架参数无效：请提供 1 到 ${RENTAL_DELIST_BATCH_MAX_PRODUCTS} 个端内ID。`,
      metadata: { toolName, ok: false },
    };
  }

  const results: Awaited<ReturnType<RentalPriceSkillClient['delist']>>[] = [];
  for (const productId of productIds) {
    try {
      const result = await client.delist(productId);
      results.push(result);
    } catch (error) {
      results.push({ productId, ok: false, lines: [error instanceof Error ? error.message : String(error)] });
      break;
    }
  }

  const success = results.filter((result) => result.ok);
  const skippedMissing = results.filter((result) => isSafeMissingDelistResult(result));
  const failed = results.filter((result) => !result.ok && !isSafeMissingDelistResult(result));
  const pending = productIds.slice(results.length);
  const allAttempted = pending.length === 0;
  const ok = allAttempted && failed.length === 0 && skippedMissing.length === 0;
  const title = ok ? '批量下架完成' : allAttempted ? '批量下架部分完成' : '批量下架中断';
  const detailLines = results.map((result, index) => {
    const status = result.ok ? '成功' : isSafeMissingDelistResult(result) ? '跳过' : '失败';
    const detail = result.lines.length ? `｜${result.lines.slice(0, 4).join('；')}` : '';
    return `${index + 1}. ${status}：商品 ${result.productId}${detail}`;
  });

  return {
    text: [
      `${title}：成功 ${success.length}/${productIds.length}`,
      skippedMissing.length ? `跳过：${skippedMissing.length} 个商品不存在（${skippedMissing.map((result) => result.productId).join('、')}）` : undefined,
      failed.length ? `失败：${failed.length} 个（${failed.map((result) => result.productId).join('、')}）` : undefined,
      pending.length ? `未执行：${pending.length} 个（${pending.join('、')}）` : undefined,
      '',
      '下架明细：',
      ...detailLines,
    ].filter((line): line is string => Boolean(line)).join('\n'),
    metadata: {
      toolName,
      ok,
      productIds,
      delistedProductIds: success.map((result) => result.productId),
      skippedMissingProductIds: skippedMissing.map((result) => result.productId),
      failedProductIds: failed.map((result) => result.productId),
      pendingProductIds: pending,
      completedCount: success.length,
    },
  };
}

async function refreshActivityPlanResponse(
  outputDir: string,
  args: Record<string, unknown>,
  options: AgentToolExecutionOptions,
  continuation?: AgentToolConfirmRequest['continuation'],
): Promise<BotResponse> {
  const date = readOptionalDate(args.date);
  const report = await findReportContextForTool(outputDir, date);
  if (!report) return { text: missingReportContextText(date) };
  const registryContext = await loadClosedOrderRegistryContext(options.closedOrderRegistryPaths);
  const maxCandidates = readMaxCandidates(args.maxCandidates);
  const zeroMetric = readRefreshActivityZeroMetric(args.zeroMetric);
  const scoped = scopedRefreshActivityEntries(args, registryContext.registry);
  if ('text' in scoped) return { text: scoped.text, metadata: { toolName: 'operations.refreshActivityPlan', ok: false } };

  const candidates: Array<{ entry: LinkRegistryEntry; row: PublicTrafficProductDataRow }> = [];
  const skipped = { missingRow: 0, missing30dDashboard: 0, inactive: 0, onlineLessThan30d: 0, onlineDaysUnknown: 0 };
  for (const entry of scoped.entries) {
    if (entry.status !== 'active') {
      skipped.inactive += 1;
      continue;
    }
    const row = findReportRowForEntry(report.context, entry);
    if (!row) {
      skipped.missingRow += 1;
      continue;
    }
    const thirty = row.periods['30d'];
    if (!thirty.hasDashboardData) {
      skipped.missing30dDashboard += 1;
      continue;
    }
    const onlineDays = estimateOnlineDays(row, entry, report.context.date);
    if (onlineDays === null) {
      skipped.onlineDaysUnknown += 1;
      continue;
    }
    if (onlineDays < REFRESH_ACTIVITY_MIN_ONLINE_DAYS) {
      skipped.onlineLessThan30d += 1;
      continue;
    }
    if (isRefreshActivityZeroMetricMatch(thirty, zeroMetric)) candidates.push({ entry, row });
  }

  const groups = groupRefreshActivityCandidates(candidates);
  const shownCandidates = candidates
    .sort((left, right) =>
      left.row.periods['30d'].publicVisits - right.row.periods['30d'].publicVisits
      || left.row.periods['30d'].exposure - right.row.periods['30d'].exposure
      || Number(left.entry.internalProductId) - Number(right.entry.internalProductId))
    .slice(0, maxCandidates);
  const shownGroups = groupRefreshActivityCandidates(shownCandidates);
  const delistOnlyExecution = buildRefreshActivityExecuteRequest(report.context.date, shownGroups, report.context, registryContext.registry, 'delist_only');
  const refillExecution = buildRefreshActivityExecuteRequest(report.context.date, shownGroups, report.context, registryContext.registry, 'delist_and_refill');
  const groupLines = shownGroups.slice(0, 12).map((group, index) => {
    const ids = group.items.map((item) => item.entry.internalProductId).join('、');
    const newLinkItem = refillExecution.request?.newLinkItems.find((item) => item.sameSkuGroupId === group.sameSkuGroupId);
    const source = newLinkItem ? `；补链源 ${newLinkItem.sourceProductId} ${newLinkItem.sourceProductName}` : '';
    return `${index + 1}. ${group.label}｜${group.category}｜${group.sameSkuGroupId}：待下架 ${group.items.length} 条，建议补回 ${group.items.length} 条新链；端内ID ${ids}${source}`;
  });

  const refreshPlan: RefreshActivityPlan | null = delistOnlyExecution.request ? {
    date: report.context.date,
    delistProductIds: delistOnlyExecution.request.delistProductIds,
    ...(refillExecution.request ? { delistProductIdsForRefill: refillExecution.request.delistProductIds } : {}),
    newLinkItemsForRefill: refillExecution.request?.newLinkItems ?? [],
    skippedGroups: refillExecution.skippedGroups,
    canRefill: Boolean(refillExecution.request),
    ...(continuation ? { continuation } : {}),
  } : null;
  const planRef = refreshPlan ? await saveRefreshActivityPlan(outputDir, refreshPlan) : null;
  const strategyCard = refreshPlan && planRef ? buildRefreshActivityStrategyCard({
    date: report.context.date,
    planRef,
    confirmationKeyDelistOnly: refreshActivityPlanConfirmationKey(refreshPlan, 'delist_only'),
    ...(refreshPlan.canRefill ? { confirmationKeyDelistAndRefill: refreshActivityPlanConfirmationKey(refreshPlan, 'delist_and_refill') } : {}),
    delistCount: refreshPlan.delistProductIds.length,
    newLinkCount: refreshPlan.newLinkItemsForRefill.reduce((sum, item) => sum + item.count, 0),
    skippedGroups: refreshPlan.skippedGroups,
  }) : undefined;

  return {
    text: [
      `活跃度刷新计划：${report.context.date}`,
      scoped.scopeLine,
      `筛选口径：active 链接，30日访问页数据已抓取，上线满 ${REFRESH_ACTIVITY_MIN_ONLINE_DAYS} 天，${refreshActivityZeroMetricLabel(zeroMetric)}。`,
      `待下架候选：${candidates.length} 条；涉及种类/同款组 ${groups.length} 个。`,
      `本次展示：${shownCandidates.length}/${candidates.length} 条。`,
      '',
      ...(groupLines.length ? groupLines : ['没有找到符合条件的零创单 active 链接。']),
      '',
      `跳过：非 active ${skipped.inactive} 条，无日报行 ${skipped.missingRow} 条，30日访问页缺失 ${skipped.missing30dDashboard} 条，上线不足 ${REFRESH_ACTIVITY_MIN_ONLINE_DAYS} 天 ${skipped.onlineLessThan30d} 条，上线天数未知 ${skipped.onlineDaysUnknown} 条。`,
      delistOnlyExecution.request
        ? `计划已生成，请在策略卡选择执行策略（待下架 ${delistOnlyExecution.request.delistProductIds.length} 条：端内ID ${delistOnlyExecution.request.delistProductIds.join('、')}）。`
        : '未能生成执行计划；请先处理以下阻断项。',
      ...(refillExecution.skippedBlockers.length ? [`已跳过 blocker：${refillExecution.skippedGroups.join('、')}`] : []),
      ...(!delistOnlyExecution.request && delistOnlyExecution.blockers.length ? ['', ...delistOnlyExecution.blockers.map((blocker) => `- ${blocker}`)] : []),
    ].join('\n'),
    metadata: {
      toolName: 'operations.refreshActivityPlan',
      date: report.context.date,
      candidateCount: candidates.length,
      shownCandidateCount: shownCandidates.length,
      skipped,
      scope: scoped.scopeLine ?? null,
      zeroMetric,
      executeRequest: null,
      strategyRequests: { delistOnly: delistOnlyExecution.request ?? null, delistAndRefill: refillExecution.request ?? null },
      blockers: [...delistOnlyExecution.blockers, ...refillExecution.blockers],
      skippedGroups: refillExecution.skippedGroups,
    },
    ...(strategyCard ? { card: strategyCard } : {}),
  };
}

async function refreshActivityExecuteResponse(
  outputDir: string,
  args: Record<string, unknown>,
  client: RentalPriceSkillClient,
  ledgerContext?: RentalWriteLedgerContext,
): Promise<BotResponse> {
  const request = readRefreshActivityExecuteRequest(args);
  const delistResults = [];
  for (const productId of request.delistProductIds) {
    await recordAgentToolWriteEvent(ledgerContext, 'execution_started', 'operations.refreshActivityExecute', productId);
    let result;
    try {
      result = await client.delist(productId);
    } catch (error) {
      await recordAgentToolWriteEvent(ledgerContext, 'execution_failed', 'operations.refreshActivityExecute', productId);
      throw error;
    }
    await recordAgentToolWriteEvent(ledgerContext, result.ok ? 'execution_succeeded' : 'execution_failed', 'operations.refreshActivityExecute', productId);
    delistResults.push(result);
    if (!result.ok && !isSafeMissingDelistResult(result)) break;
  }

  const delistSuccess = delistResults.filter((result) => result.ok);
  const skippedMissingDelist = delistResults.filter((result) => isSafeMissingDelistResult(result));
  const blockingDelistFailures = delistResults.filter((result) => !result.ok && !isSafeMissingDelistResult(result));
  const delistFinished = delistResults.length === request.delistProductIds.length && blockingDelistFailures.length === 0;
  const allDelisted = delistFinished && skippedMissingDelist.length === 0;

  let newLinkResult: Awaited<ReturnType<typeof executeNewLinkBatchConfirmRequest>> | Awaited<ReturnType<typeof executeNewLinkBatchMultiConfirmRequest>> | null = null;
  if (delistFinished && request.newLinkItems.length > 0) {
    const items: NewLinkBatchConfirmRequest[] = request.newLinkItems.map((item) => ({
      safetyVersion: NEW_LINK_BATCH_CONFIRMATION_VERSION,
      workflowName: NEW_LINK_BATCH_WORKFLOW_NAME,
      keyword: item.keyword,
      count: item.count,
      sourceProductId: item.sourceProductId,
      sourceProductName: item.sourceProductName,
      dataDate: request.date,
      reason: '活跃度刷新计划确认执行',
    }));
    for (const item of items) {
      await recordAgentToolWriteEvent(ledgerContext, 'execution_started', 'operations.refreshActivityExecute', item.sourceProductId);
    }
    newLinkResult = items.length === 1
      ? await executeNewLinkBatchConfirmRequest(client, items[0]!)
      : await executeNewLinkBatchMultiConfirmRequest(client, {
        safetyVersion: NEW_LINK_BATCH_CONFIRMATION_VERSION,
        workflowName: NEW_LINK_BATCH_WORKFLOW_NAME,
        mode: 'multi-source',
        items,
        dataDate: request.date,
        reason: '活跃度刷新计划确认执行',
      });
    for (const item of items) {
      await recordAgentToolWriteEvent(ledgerContext, newLinkResult.ok ? 'execution_succeeded' : 'execution_failed', 'operations.refreshActivityExecute', item.sourceProductId);
    }
  }
  const overallOk = request.strategy === 'delist_only' ? allDelisted : allDelisted && Boolean(newLinkResult?.ok);

  const auditPath = await writeRefreshActivityAudit(outputDir, {
    request,
    delistResults,
    skippedMissingDelistProductIds: skippedMissingDelist.map((result) => result.productId),
    blockingDelistFailureProductIds: blockingDelistFailures.map((result) => result.productId),
    newLinkResult,
    ok: overallOk,
    createdAt: new Date().toISOString(),
  });

  const typeLines = request.newLinkItems.map((item, index) =>
    `${index + 1}. ${item.keyword}${item.sameSkuGroupId ? `｜${item.sameSkuGroupId}` : ''}：下架/补链 ${item.count} 条，补链源 ${item.sourceProductId} ${item.sourceProductName}`);
  const delistLines = delistResults.map((result) => `- ${result.ok ? '成功' : '失败'}：商品 ${result.productId}${result.lines.length ? `｜${result.lines.join('；')}` : ''}`);
  return {
    text: [
      `${overallOk ? '活跃度刷新执行完成' : delistFinished && skippedMissingDelist.length ? '活跃度刷新部分完成' : '活跃度刷新执行中断'}：${request.date}`,
      `下架：成功 ${delistSuccess.length}/${request.delistProductIds.length}`,
      ...(skippedMissingDelist.length ? [`跳过：${skippedMissingDelist.length} 个商品不存在（${skippedMissingDelist.map((result) => result.productId).join('、')}）`] : []),
      `补链：${request.strategy === 'delist_only' ? '策略为只下架，未补链' : newLinkResult ? `${newLinkResult.ok ? '成功' : '失败'}，完成 ${newLinkResult.completedCount}/${request.newLinkItems.reduce((sum, item) => sum + item.count, 0)} 条` : '因下架未全部成功，已跳过'}`,
      '',
      '处理种类：',
      ...typeLines,
      '',
      '下架明细：',
      ...delistLines,
      ...(newLinkResult ? ['', '补链明细：', newLinkResult.text] : []),
      '',
      `审计文件：${auditPath}`,
    ].join('\n'),
    metadata: {
      toolName: 'operations.refreshActivityExecute',
      auditPath,
      delistedProductIds: delistSuccess.map((result) => result.productId),
      skippedMissingDelistProductIds: skippedMissingDelist.map((result) => result.productId),
      blockingDelistFailureProductIds: blockingDelistFailures.map((result) => result.productId),
      newProductIds: newLinkResult?.newProductIds ?? [],
      ok: overallOk,
    },
  };
}

async function runReadOnlyAgentIntent(
  outputDir: string,
  intent: Exclude<AgentIntent, { type: 'unknown' }>,
  options: AgentToolExecutionOptions,
): Promise<BotResponse> {
  const latest = await findLatestReportContext(outputDir);
  if (!latest) return { text: '还没有找到公域日报上下文。' };
  const tool = findReadOnlyTool(intent);
  if (!tool) return { text: '暂无匹配工具。' };
  if (intent.type !== 'best_product_by_same_sku' && intent.type !== 'safe_source_resolve' && intent.type !== 'safe_source_groups' && intent.type !== 'refresh_candidate_explain') return tool.run(latest.context, intent);

  const registryContext = await loadClosedOrderRegistryContext(options.closedOrderRegistryPaths);
  return tool.run(latest.context, intent, { linkRegistryStore: createLinkRegistry(registryContext.registry), registryEntries: registryContext.registry, outputDir });
}

function closedOrderIngestStatePath(outputDir: string): string {
  return join(outputDir, 'state', 'closed-order-feedback-ingest.json');
}

function closedOrderObservationArtifactPaths(outputDir: string, reportDate: string): { jsonPath: string; markdownPath: string } {
  const baseDir = join(outputDir, 'closed-order-observation');
  const baseName = `closed-order-observation-${reportDate}`;
  return {
    jsonPath: join(baseDir, `${baseName}.json`),
    markdownPath: join(baseDir, `${baseName}.md`),
  };
}

function formatClosedOrderSyncSummary(result: Awaited<ReturnType<typeof syncClosedOrderFeedbackFromApi>>): string {
  return `关单同步完成：拉取 ${result.fetchedCount} 条，新增 ${result.addedCount} 条，更新 ${result.updatedCount} 条，累计 ${result.totalCount} 条。`;
}

function formatClosedOrderObservationSummary(
  report: Awaited<ReturnType<typeof buildClosedOrderObservationReport>>,
  artifactMarkdownPath?: string,
): string {
  const base = `关单观察 ${report.date}：近 ${report.windowDays} 天 ${report.summary.recordCount} 条，今日 ${report.summary.todayRecordCount} 条，重点分组 ${report.summary.groupCount} 个，需人工复核 ${report.summary.manualReviewGroupCount} 个。`;
  return artifactMarkdownPath ? `${base}\n报告已写入：${artifactMarkdownPath}` : base;
}

function readSendTo(value: unknown): FeishuSendTo | undefined {
  if (value === 'personal' || value === 'group' || value === 'both') return value;
  if (value === undefined) return undefined;
  throw new Error('sendTo must be personal, group, or both');
}

function currentShanghaiYear(): number {
  const year = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric' }).format(new Date());
  return Number(year);
}

function padDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

function normalizeReportDate(value: string): string | null {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const monthDay = /^(\d{1,2})月(\d{1,2})日$/.exec(trimmed);
  if (monthDay) {
    const month = Number(monthDay[1]);
    const day = Number(monthDay[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return `${currentShanghaiYear()}-${padDatePart(month)}-${padDatePart(day)}`;
    return null;
  }

  const parts = trimmed.split(/[./-]/).filter(Boolean);
  if (parts.length !== 2 && parts.length !== 3) return null;
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((item) => !Number.isInteger(item))) return null;

  const [first, second, third] = numbers;
  const year = parts.length === 3
    ? first < 100 ? 2000 + first : first
    : currentShanghaiYear();
  const month = parts.length === 3 ? second : first;
  const day = parts.length === 3 ? third : second;
  if (!year || !month || !day || year < 2000 || year > 2099 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${padDatePart(month)}-${padDatePart(day)}`;
}

function readOptionalDate(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const parsed = readString(value);
  const normalized = parsed ? normalizeReportDate(parsed) : null;
  if (!normalized) throw new Error('date must be YYYY-MM-DD or a supported short date like 26.6.18');
  return normalized;
}

async function findReportContextForTool(outputDir: string, date?: string) {
  return date ? findReportContextByDate(outputDir, date) : findLatestReportContext(outputDir);
}

function reportPeriodDays(period: unknown): number {
  if (period === '30d') return 30;
  if (period === '7d') return 7;
  return 1;
}

function shiftReportDate(date: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match?.[1] || !match[2] || !match[3]) return date;
  const value = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function comparisonReportDate(currentDate: string, args: Record<string, unknown>): string {
  const explicit = readOptionalDate(args.compareDate);
  if (explicit) return explicit;
  const compareWith = readString(args.compareWith) ?? 'previousPeriod';
  const offsetDays = compareWith === 'previousDay' ? 1 : reportPeriodDays(args.period);
  return shiftReportDate(currentDate, -offsetDays);
}

function missingReportContextText(date?: string): string {
  return date ? `没有找到 ${date} 的公域日报上下文。` : '还没有找到公域日报上下文。';
}

function reportSendLabel(date?: string): string {
  return date ? `${date} ` : '最新';
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

type LinkRegistryPromptMode = 'maintenance' | 'governance' | 'hub';

async function linkRegistryPromptResponse(
  mode: LinkRegistryPromptMode,
  outputDir: string,
  options: AgentToolExecutionOptions,
): Promise<BotResponse> {
  const registryContext = await loadClosedOrderRegistryContext(options.closedOrderRegistryPaths);
  const date = today();
  const maintenance = async () => openLinkRegistryMaintenancePrompt(outputDir, {
    date,
    registry: registryContext.registry,
    referenceDate: date,
    overridesPath: registryContext.resolvedPaths.overridesPath,
    force: true,
  });
  const governance = async () => openLinkRegistryGovernancePrompt(outputDir, {
    date,
    registry: registryContext.registry,
    overrideRisks: registryContext.overrideRisks,
    referenceDate: date,
    force: true,
  });

  if (mode === 'maintenance') {
    const response = await maintenance();
    return response ?? { text: '当前没有需要主动维护的链接条目。' };
  }
  if (mode === 'governance') {
    const response = await governance();
    return response ?? { text: '当前没有需要主动处理的组级治理问题。' };
  }
  const maintenanceResponse = await maintenance();
  if (maintenanceResponse?.card) {
    return {
      text: `${maintenanceResponse.text}\n如需处理组级治理问题，可以再发“组级治理”。`,
      card: maintenanceResponse.card,
    };
  }
  const governanceResponse = await governance();
  if (governanceResponse) return governanceResponse;
  return { text: '当前没有需要主动维护的链接条目，也没有需要主动处理的组级治理问题。' };
}

export async function executeAgentToolRequest(
  request: AgentToolConfirmRequest,
  outputDir = 'output',
  options: AgentToolExecutionOptions = {},
): Promise<BotResponse> {
  switch (request.toolName) {
    case 'system.help':
      return { text: PLANNER_HELP_TEXT };
    case 'publicTraffic.latestSummary': {
      const date = readOptionalDate(request.arguments.date);
      const report = await findReportContextForTool(outputDir, date);
      return { text: report ? formatLatestSummary(report.context) : missingReportContextText(date) };
    }
    case 'publicTraffic.conversionSummary': {
      const date = readOptionalDate(request.arguments.date);
      const report = await findReportContextForTool(outputDir, date);
      return { text: report ? formatConversionSummary(report.context) : missingReportContextText(date) };
    }
    case 'publicTraffic.reportQuery': {
      const date = readOptionalDate(request.arguments.date);
      const report = await findReportContextForTool(outputDir, date);
      if (request.arguments.target === 'dateComparison') {
        if (!report) return { text: missingReportContextText(date) };
        const compareDate = comparisonReportDate(report.context.date, request.arguments);
        const compareReport = await findReportContextForTool(outputDir, compareDate);
        return {
          text: compareReport
            ? runPublicTrafficReportDateComparison(report.context, compareReport.context, { ...request.arguments, ...(date ? { date } : {}), compareDate } as PublicTrafficReportQueryArguments)
            : missingReportContextText(compareDate),
        };
      }
      return {
        text: report
          ? runPublicTrafficReportQuery(report.context, { ...request.arguments, ...(date ? { date } : {}) } as PublicTrafficReportQueryArguments)
          : missingReportContextText(date),
      };
    }
    case 'product.query': {
      const date = readOptionalDate(request.arguments.date);
      const report = await findReportContextForTool(outputDir, date);
      const keyword = requireString(request.arguments.keyword, 'keyword');
      const productIds = parseNumericProductIdList(keyword);
      if (report) {
        const rows = queryProductRows(report.context, keyword);
        if (rows.length > 0) return { text: formatProductRows(rows) };
      }
      if (!report && date) return { text: missingReportContextText(date) };
      if (productIds.length > 0) {
        const registryContext = await loadClosedOrderRegistryContext(options.closedOrderRegistryPaths);
        return { text: formatRegistryProductRows(productIds, registryContext.registry) };
      }
      return { text: report ? formatProductRows([]) : missingReportContextText() };
    }
    case 'product.rankBestSameSku': {
      const query = requireString(request.arguments.query, 'query');
      return runReadOnlyAgentIntent(outputDir, {
        type: 'best_product_by_same_sku',
        query,
        periodDays: readOptionalPeriodDays(request.arguments.periodDays),
        metric: readOptionalCategoryRankingMetric(request.arguments.metric),
      }, options);
    }
    case 'product.rankByCategory': {
      const report = await findReportContextForTool(outputDir, readOptionalDate(request.arguments.date));
      if (!report) return { text: missingReportContextText(readOptionalDate(request.arguments.date)) };
      const registryContext = await loadClosedOrderRegistryContext(options.closedOrderRegistryPaths);
      const result = rankProductsByCategory(report.context, registryContext.registry, {
        ...(typeof request.arguments.category === 'string' ? { category: request.arguments.category } : {}),
        metric: readCategoryRankingMetric(request.arguments.metric),
        periodDays: readPeriodDays(request.arguments.periodDays),
        limit: readOptionalLimit(request.arguments.limit),
      });
      return formatCategoryRankingResponse(result);
    }
    case 'productId.lookup': {
      const date = readOptionalDate(request.arguments.date);
      const report = await findReportContextForTool(outputDir, date);
      const query = requireString(request.arguments.keyword, 'keyword');
      return { text: report ? formatIdLookupResult(lookupProductId(report.context, query)) : missingReportContextText(date) };
    }
    case 'productId.lookupCard':
      return { text: '已打开常驻商品ID互查卡，可保留在会话里反复查询。', card: buildIdLookupCard() };
    case 'inventory.statusOverview':
      return inventoryStatusToolResponse(outputDir, undefined, options);
    case 'inventory.statusQuery':
      return inventoryStatusToolResponse(outputDir, requireString(request.arguments.query, 'query'), options);
    case 'linkRegistry.overview': {
      const registryContext = await loadClosedOrderRegistryContext(options.closedOrderRegistryPaths);
      const audit = createLinkRegistry(registryContext.registry, registryContext.overrideRisks).audit();
      return { text: formatLinkRegistryOverviewText(audit), card: buildLinkRegistryOverviewCard(audit) };
    }
    case 'linkRegistry.maintenancePrompt':
      return linkRegistryPromptResponse('maintenance', outputDir, options);
    case 'linkRegistry.governancePrompt':
      return linkRegistryPromptResponse('governance', outputDir, options);
    case 'linkRegistry.maintenanceHub':
      return linkRegistryPromptResponse('hub', outputDir, options);
    case 'linkRegistry.resolveProducts':
      return linkRegistryResolveProductsResponse(request.arguments, options);
    case 'operationsLearning.startQuiz': {
      const latest = await findLatestReportContext(outputDir);
      return latest ? startOperationsLearningSession(outputDir, latest.context) : { text: '还没有找到公域日报上下文。' };
    }
    case 'operationsLearning.summary': {
      const latest = await findLatestReportContext(outputDir);
      return latest ? { text: await summarizeOperationsLearningSession(outputDir, latest.context.date) } : { text: '还没有找到公域日报上下文。' };
    }
    case 'operationsLearning.history':
      return { text: await summarizeOperationsLearningHistory(outputDir) };
    case 'agentLearning.summary':
      return { text: await summarizeAgentLearning(outputDir) };
    case 'activity.differentialPricingCard':
      return {
        text: '差异化定价卡片已打开，请在卡片中填写日期和折扣后确认执行。',
        card: buildActivityAutomationCard(),
      };
    case 'activity.cancelDifferentialPricingCard':
      return buildCancelDifferentialPricingCardResult(outputDir);
    case 'publicTraffic.newLinkPool':
      return runReadOnlyAgentIntent(outputDir, { type: 'new_product_pool' }, options);
    case 'publicTraffic.taskPool':
      return runReadOnlyAgentIntent(outputDir, { type: 'tasks' }, options);
    case 'publicTraffic.problemProducts':
      return runReadOnlyAgentIntent(outputDir, { type: 'problem_products', problemType: readProblemType(request.arguments.problemType) }, options);
    case 'publicTraffic.inactiveLinks':
      return runReadOnlyAgentIntent(outputDir, { type: 'inactive_links' }, options);
    case 'publicTraffic.removedLinks':
      return runReadOnlyAgentIntent(outputDir, { type: 'removed_links' }, options);
    case 'publicTraffic.orderSummary':
      return runReadOnlyAgentIntent(outputDir, { type: 'order_summary' }, options);
    case 'publicTraffic.windowedFindings': {
      const result = await findWindowedProducts(outputDir, {
        lookbackDays: readOptionalLimit(request.arguments.lookbackDays) ?? 1,
        predicate: readWindowedPredicate(request.arguments.predicate),
        ...(typeof request.arguments.endDate === 'string' ? { endDate: request.arguments.endDate } : {}),
      });
      return formatWindowedFindingsResponse(result);
    }
    case 'publicTraffic.windowAggregate': {
      const windowDays = readOptionalLimit(request.arguments.windowDays);
      if (!windowDays) throw new Error('windowDays is required');
      const explicitEndDate = readOptionalDate(request.arguments.endDate ?? request.arguments.date);
      const latest = explicitEndDate ? null : await findLatestReportContext(outputDir);
      const endDate = explicitEndDate ?? latest?.context.date;
      if (!endDate) return { text: '还没有找到公域日报上下文。' };
      const result = await aggregateWindowProducts({ outputDir, endDate, windowDays });
      return formatWindowAggregateResponse(result, endDate, windowDays);
    }
    case 'system.dataHealth': {
      const explicitDate = readOptionalDate(request.arguments.date);
      const latest = explicitDate ? null : await findLatestReportContext(outputDir);
      const date = explicitDate ?? latest?.context.date ?? today();
      return formatDataHealthResponse(await buildDataHealthReport(outputDir, date));
    }
    case 'strategy.safeSourceResolve': {
      const date = readOptionalDate(request.arguments.date);
      const report = await findReportContextForTool(outputDir, date);
      if (!report) return { text: missingReportContextText(date) };
      const registryContext = await loadClosedOrderRegistryContext(options.closedOrderRegistryPaths);
      const sameSkuGroupId = requireString(request.arguments.sameSkuGroupId, 'sameSkuGroupId');
      const excludedProductIds = new Set(readStringArrayArgument(request.arguments.excludedProductIds, 'excludedProductIds'));
      return formatSafeSourceResponse(resolveSafeSourceForSameSkuGroup(registryContext.registry, report.context, sameSkuGroupId, excludedProductIds));
    }
    case 'strategy.refreshCandidateExplain': {
      const date = readOptionalDate(request.arguments.date);
      const report = await findReportContextForTool(outputDir, date);
      if (!report) return { text: missingReportContextText(date) };
      const registryContext = await loadClosedOrderRegistryContext(options.closedOrderRegistryPaths);
      const zeroMetric = readRefreshActivityZeroMetric(request.arguments.zeroMetric);
      const query = readString(request.arguments.query) ?? undefined;
      const sameSkuGroupId = readString(request.arguments.sameSkuGroupId) ?? undefined;
      const result = explainRefreshCandidates(registryContext.registry, report.context, { ...(query ? { query } : {}), ...(sameSkuGroupId ? { sameSkuGroupId } : {}), zeroMetric, date: report.context.date });
      return formatRefreshCandidateExplainResponse(result, zeroMetric, { ...(query ? { query } : {}), ...(sameSkuGroupId ? { sameSkuGroupId } : {}) });
    }
    case 'publicTraffic.runReport':
      if (publicTrafficReportRunning) return { text: '公域日报正在运行中，请稍后再试。' };
      publicTrafficReportRunning = true;
      try {
        const result = await runPublicTrafficReportCli();
        return { text: formatPublicTrafficReportRunSuccess(result) };
      } finally {
        publicTrafficReportRunning = false;
      }
    case 'publicTraffic.resendLatestReport': {
      const date = readOptionalDate(request.arguments.date);
      const report = await findReportContextForTool(outputDir, date);
      if (!report) return { text: date ? `没有找到 ${date} 的可重发公域日报。` : '还没有找到可重发的公域日报。' };
      const card = buildPublicTrafficCard(report.context, { markdownPath: '', workbookPath: '' });
      const fallbackText = buildPublicTrafficFeishuText(report.context, { markdownPath: '', workbookPath: '' });
      const sendTo = readSendTo(request.arguments.sendTo);
      const env = sendTo ? { ...process.env, FEISHU_SEND_TO: sendTo } : process.env;
      const result = await sendFeishuCard(env, card, fallbackText);
      const label = reportSendLabel(date);
      return { text: result.sent ? `${label}公域日报已重发。` : `${label}公域日报重发失败：${result.reason}` };
    }
    case 'publicTraffic.pushLatestReportToGroup': {
      const date = readOptionalDate(request.arguments.date);
      const report = await findReportContextForTool(outputDir, date);
      if (!report) return { text: date ? `没有找到 ${date} 的可推送公域日报。` : '还没有找到可推送的公域日报。' };
      const card = buildPublicTrafficCard(report.context, { markdownPath: '', workbookPath: '' });
      const fallbackText = buildPublicTrafficFeishuText(report.context, { markdownPath: '', workbookPath: '' });
      const result = await sendFeishuCard({ ...process.env, FEISHU_SEND_TO: 'group' }, card, fallbackText);
      const label = reportSendLabel(date);
      return { text: result.sent ? `${label}公域日报已推送到群。` : `${label}公域日报推送到群失败：${result.reason}` };
    }
    case 'publicTraffic.refreshDashboard': {
      await loadEnv();
      const config = await loadConfig();
      const sendTo = readSendTo(request.arguments.sendTo);
      const parsedDate = readOptionalDate(request.arguments.date);
      const dataDate = parsedDate ? assertDashboardDataDate(parsedDate) : previousShanghaiDate();
      const result = await runDashboardRefresh({ config, dataDate, sendTo });
      return {
        text: [
          `访问页补抓完成：${result.message}`,
          `业务数据日：${result.dataDate}`,
          `页面回读：${result.actualPageDate}`,
          '',
          `补抓结果：${result.refreshQualityText}`,
          '',
          `首版状态：${result.firstQualityText ?? '无既有日报上下文'}`,
        ].join('\n'),
      };
    }
    case 'operations.refreshActivityPlan':
      return refreshActivityPlanResponse(outputDir, request.arguments, options, request.continuation);
    case 'operations.refreshActivityExecute':
      return refreshActivityExecuteResponse(outputDir, request.arguments, options.rentalPriceClient ?? createRentalPriceSkillClient(), options.ledgerContext);
    case 'rental.daemonStatus':
    case 'rental.platformSearch':
    case 'rental.platformSearchAll':
    case 'rental.batchRead':
    case 'rental.specDiscoverFull':
    case 'rental.readRaw':
      return executeRentalReadOnlyOperationHandler(request, options.rentalPriceClient ?? createRentalPriceSkillClient());
    case 'rental.copy':
    case 'rental.tenancySet':
    case 'rental.specDiscover':
    case 'rental.specAddAndRefresh':
    case 'rental.specAddItem':
    case 'rental.specRefresh':
    case 'rental.applyCurrent':
    case 'rental.submitCurrent':
      return executeRentalWriteOperationHandler(request, options.rentalPriceClient ?? createRentalPriceSkillClient(), options.ledgerContext);
    case 'rental.delist': {
      const productIds = readDelistProductIds(request.arguments);
      if (request.arguments.productIds !== undefined || (productIds && productIds.length > 1)) {
        return rentalDelistBatchResponse(request.arguments, options.rentalPriceClient ?? createRentalPriceSkillClient(), request.toolName);
      }
      return executeRentalWriteOperationHandler(request, options.rentalPriceClient ?? createRentalPriceSkillClient(), options.ledgerContext);
    }
    case 'rental.delistBatch':
      return rentalDelistBatchResponse(request.arguments, options.rentalPriceClient ?? createRentalPriceSkillClient(), request.toolName);
    case 'rental.specRemovePlan': {
      const query = requireString(request.arguments.query, 'query');
      const keyword = requireString(request.arguments.keyword, 'keyword');
      return rentalSpecRemovePlanResponse(query, keyword, request.reason, options.rentalPriceClient ?? createRentalPriceSkillClient(), options, request.continuation);
    }
    case 'rental.operationConfirmRequest':
      return executeRentalWriteOperationHandler(request, options.rentalPriceClient ?? createRentalPriceSkillClient(), options.ledgerContext);
    case 'rental.priceChange': {
      const inferredFields = isRecord(request.arguments.fields) ? undefined : parseRentPriceFieldsFromText(request.reason);
      const rawFields = isRecord(request.arguments.fields)
        ? request.arguments.fields
        : inferredFields && Object.keys(inferredFields).length
          ? inferredFields
          : undefined;
      const priceArguments = rawFields
        ? { ...request.arguments, fields: sanitizeExplicitPriceFields(rawFields, request.reason) }
        : request.arguments;
      const rentalRequest = rentalPriceChangeRequestFromToolArguments(priceArguments);
      if (!rentalRequest) throw new Error('租赁商品改价参数无效，请重新发起。');
      const client = options.rentalPriceClient ?? createRentalPriceSkillClient();
      const preview = await client.preview(rentalRequest);
      return { text: `请确认商品 ${rentalRequest.productId} 改价`, card: buildRentalPricePreviewCard(preview, { reason: request.reason, continuation: request.continuation }) };
    }
    case 'rental.pricePreview':
      return rentalPricePreviewResponse(request.arguments, request.reason, options.rentalPriceClient ?? createRentalPriceSkillClient(), outputDir, request.continuation);
    case 'rental.priceApply':
      return rentalPriceApplyResponse(request.arguments, options.rentalPriceClient ?? createRentalPriceSkillClient(), options.ledgerContext);
    case 'rental.perSpecPricePlan':
      return rentalPerSpecPricePlanResponse(request.arguments, request.reason, options.rentalPriceClient ?? createRentalPriceSkillClient(), outputDir, request.continuation);
    case 'rental.perSpecPriceApply':
      return rentalPerSpecPriceApplyResponse(request.arguments, options.rentalPriceClient ?? createRentalPriceSkillClient(), options.ledgerContext);
    case 'rental.specDimPlan':
      return rentalSpecDimPlanResponse(request.arguments, request.reason, options.rentalPriceClient ?? createRentalPriceSkillClient(), outputDir, request.continuation);
    case 'rental.specDimApply':
      return rentalSpecDimApplyResponse(request.arguments, options.rentalPriceClient ?? createRentalPriceSkillClient(), options.ledgerContext);
    case 'rental.priceSnapshot': {
      const query = requireString(request.arguments.query, 'query');
      return rentalPriceSnapshotResponse(query, options.rentalPriceClient ?? createRentalPriceSkillClient(), options);
    }
    case 'rental.newLinkBatchPlan': {
      const workflowRequests = readNewLinkBatchWorkflowRequests(request.arguments);
      if (!workflowRequests) {
        return {
          text: '补链需要：关键词 + 数量，例如「给<关键词>补3条」；也可以提供 items 数组。若你其实想对该商品做别的（下架/改价/查看），请直接说明。',
          metadata: { toolName: 'rental.newLinkBatchPlan', ok: false, needsMoreInput: true },
        };
      }
      const [latest, registryContext] = await Promise.all([
        findLatestReportContext(outputDir),
        loadClosedOrderRegistryContext(options.closedOrderRegistryPaths),
      ]);
      if (!latest) return { text: '还没有找到公域日报上下文，无法选择新链复制源商品。' };

      const plans = workflowRequests.map((item) => buildNewLinkBatchPlan(item, latest.context, registryContext.registry));
      if (plans.length > 1) {
        const ready = plans.every((plan) => plan.status === 'ready');
        const card = ready ? buildNewLinkBatchMultiConfirmCard(plans, request.reason, request.continuation) : undefined;
        const confirmBlocker = card ? null : explainNewLinkBatchMultiConfirmBlocker(plans);
        const text = formatNewLinkBatchMultiPlan(plans, { confirmable: Boolean(card), confirmBlocker });
        return {
          text,
          ...(card ? { card } : {}),
          metadata: { toolName: 'rental.newLinkBatchPlan', plans, ready, confirmable: Boolean(card) },
        };
      }

      const plan = plans[0]!;
      return {
        text: formatNewLinkBatchPlan(plan),
        ...(plan.status === 'ready' ? { card: buildNewLinkBatchConfirmCard(plan, request.reason, request.continuation) } : {}),
        metadata: {
          toolName: 'rental.newLinkBatchPlan',
          status: plan.status,
          sourceProductId: plan.selectedSource?.productId,
          keyword: plan.request.keyword,
          count: plan.request.count,
          plan,
        },
      };
    }
    case 'rental.priceRollback': {
      const rollbackRequest = rentalPriceRollbackRequestFromToolArguments(request.arguments);
      if (!rollbackRequest) throw new Error('租赁商品改价回滚参数无效，请提供 taskId 或 rollbackFile；productId 可选。');
      const client = options.rentalPriceClient ?? createRentalPriceSkillClient();
      if (!client.rollback) throw new Error('当前租赁改价客户端不支持回滚。');
      const result = await client.rollback(rollbackRequest);
      return { text: `${result.ok ? '改价回滚成功' : '改价回滚失败'}：商品 ${result.productId}\n${result.lines.join('\n')}`, metadata: { toolName: 'rental.priceRollback', ok: result.ok, productId: result.productId, taskId: result.audit?.taskId, rollbackFile: result.audit?.rollbackFile } };
    }
    case 'rental.batchPreview':
    case 'rental.batchExecute':
    case 'rental.batchStatus':
    case 'rental.batchResume':
    case 'rental.batchReport':
    case 'rental.batchRollback':
      return executeRentalBatchTool(request.toolName, request.arguments, options.ledgerContext);
    case 'rental.mirrorSearch':
    case 'rental.mirrorBatchSpec':
      return executeRentalMirrorTool(request.toolName, request.arguments);
    case 'closedOrder.syncFeedback': {
      const result = await syncClosedOrderFeedbackFromApi(
        closedOrderIngestStatePath(outputDir),
        process.env,
        20,
        options.closedOrderFetchImpl ?? fetch,
      );
      return { text: formatClosedOrderSyncSummary(result) };
    }
    case 'closedOrder.runObservationReport': {
      const [state, registryContext] = await Promise.all([
        loadClosedOrderIngestState(closedOrderIngestStatePath(outputDir)),
        loadClosedOrderRegistryContext(options.closedOrderRegistryPaths),
      ]);
      const report = await buildClosedOrderObservationReport(state.items, registryContext.query);
      const artifactPaths = closedOrderObservationArtifactPaths(outputDir, report.date);
      await writeClosedOrderObservationReportArtifacts(artifactPaths.jsonPath, artifactPaths.markdownPath, report);
      return {
        text: formatClosedOrderObservationSummary(report, artifactPaths.markdownPath),
        card: buildClosedOrderObservationCard(report),
      };
    }
    default:
      throw new Error(`Unsupported agent tool: ${request.toolName}`);
  }
}
