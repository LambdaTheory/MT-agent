import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { buildAgentToolConfirmCard } from '../agentRuntime/approvalCard.js';
import { recordOperationEvent } from '../agentRuntime/operationLedger.js';
import type { FeishuCardPayload } from '../notify/feishuApp.js';
import { runPublicTrafficReportCli } from '../cli/publicTrafficReport.js';
import type { AgentToolConfirmRequest } from '../agentRuntime/approvalCard.js';
import { loadConfig } from '../config/loadConfig.js';
import { loadEnv } from '../config/loadEnv.js';
import { loadClosedOrderIngestState } from '../closedOrderFeedback/ingest.js';
import { buildClosedOrderObservationReport, writeClosedOrderObservationReportArtifacts } from '../closedOrderFeedback/observation.js';
import { loadClosedOrderRegistryContext, type ClosedOrderRegistryPathsInput } from '../closedOrderFeedback/runtime.js';
import type { AgentIntent, AgentProblemType } from '../agentData/types.js';
import { rankProductsByCategory, rankProductsByCategoryWindowed, type CategoryRankingMetric } from '../agentData/categoryRanking.js';
import { buildDataHealthReport } from '../agentData/dataHealth.js';
import { adaptLegacyRefreshCandidateExplainInput, explainRefreshCandidates } from '../agentData/refreshCandidateExplain.js';
import { evaluateMetricThresholdStrategy, formatMetricThresholdCondition, metricSourceLabel, type MetricThresholdCondition, type MetricThresholdStrategyInput, type MetricThresholdStrategyResult } from '../agentData/metricThresholdStrategy.js';
import { resolveSafeSourceForSameSkuGroup } from '../agentData/safeSource.js';
import { findWindowedProducts, type WindowedPredicate } from '../agentData/windowedFindings.js';
import { aggregateWindowProducts, readWindowMetric, type WindowProductAggregate } from '../agentData/windowAggregate.js';
import { queryPublicTrafficWindow, type PublicTrafficWindowQueryResult } from '../agentData/windowQuery.js';
import { getPublicTrafficMetric, publicTrafficMetricKeys, type PublicTrafficMetricKey } from '../agentData/publicTrafficMetricCatalog.js';
import { openLinkRegistryGovernancePrompt } from '../linkRegistry/governanceSession.js';
import { openLinkRegistryMaintenancePrompt } from '../linkRegistry/maintenanceSession.js';
import { createLinkRegistry } from '../linkRegistry/store.js';
import type { LinkRegistryEntry } from '../linkRegistry/types.js';
import { summarizeAgentLearning } from '../agentLearning/store.js';
import { syncClosedOrderFeedbackFromApi } from '../closedOrderFeedback/sync.js';
import { queryInventoryStatus } from '../inventoryStatus/query.js';
import { readInventorySameSkuSnapshotHistory } from '../inventoryStatus/history.js';
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
import { buildDashboardRefreshResultCard, formatDashboardRefreshResultText } from './dashboardRefreshCard.js';
import { buildPublicTrafficPaths } from '../publicTraffic/paths.js';
import type { PublicTrafficDataReportContext, PublicTrafficPeriodMetrics, PublicTrafficProductDataRow } from '../publicTraffic/types.js';
import { startOperationsLearningSession } from '../operationsLearningLoop/session.js';
import { recordPriceChangeObservation } from '../operationObservations/store.js';
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
import { buildQueryTextCard } from './queryCards.js';
import {
  buildRentalOperationConfirmCard,
  compactAuditReference,
  createRentalPriceSkillClient,
  parseRentPriceFieldsFromText,
  rentalPriceChangeRequestFromToolArguments,
  rentalPriceExecutionAuditBlockReason,
  rentalPriceRollbackRequestFromToolArguments,
  type RentalPriceAuditDiff,
  type RentalPriceAuditReference,
  type PriceChangeArtifact,
  type PerSpecPriceFieldMap,
  type RentalOperationConfirmRequest,
  type RentalSpecRemoveItemConfirmRequest,
  type RentalPriceChangeRequest,
  type RentalPriceExecutionResult,
  type RentalPriceReadResult,
  type RentalPriceSkillClient,
} from './rentalPrice.js';
import { executeRentalReadOnlyOperationHandler } from './rentalReadOnlyOperationHandlers.js';
import {
  appendRentalDelistAuditWarnings,
  executeRentalWriteOperationHandler,
  recordSuccessfulRentalDelistEventBestEffort,
  RENTAL_DELIST_MAX_AUDIT_WARNINGS,
} from './rentalWriteOperationHandlers.js';
import { executeRentalBatchTool } from './rentalBatchHandlers.js';
import { executeRentalImageTool } from './rentalImageHandlers.js';
import { executeRentalMirrorTool } from './rentalMirrorHandlers.js';
import { executeRentalVasTool } from './rentalVasHandlers.js';
import { findReadOnlyTool } from './readOnlyToolRegistry.js';
import { hasExplicitRentAdjustmentScope, inferPriceAdjustmentAmountFromText, readPriceAdjustmentAmountArgument } from './priceAdjustment.js';
import {
  hasPriceAdjustmentConflict,
  INVALID_DISCOUNT_ARGUMENT_MESSAGE,
  PRICE_ADJUSTMENT_CONFLICT_MESSAGE,
} from './priceChangeContract.js';
import { inferPriceMultiplierFromText, readPriceMultiplierArgument } from './priceMultiplier.js';
import { runPublicTrafficReportDateComparison, runPublicTrafficReportQuery, type PublicTrafficReportQueryArguments } from './reportQuery.js';
import { runProductLinkQuery, type ProductLinkQueryArguments } from './productLinkQuery.js';
import { findLatestReportContext, findReportContextByDate, formatConversionSummary, formatLatestSummary, formatProductRows, parseNumericProductIdList } from './reportStore.js';
import { saveAgentToolConfirmRequest } from './agentToolConfirmStore.js';
import { loadRentalPriceRollbackAction, saveRentalPriceRollbackAction } from './rentalPriceRollbackActionStore.js';
import { refreshActivityPlanConfirmationKey, saveRefreshActivityPlan, type RefreshActivityPlan } from './refreshActivityPlanStore.js';
import type { RentalWriteLedgerContext } from './rentalWriteOperationHandlers.js';
import { rentalPerSpecPriceApplyResponse, rentalPerSpecPricePlanResponse } from './rentalPerSpecPriceHandlers.js';
import { rentalSpecDimApplyResponse, rentalSpecDimPlanResponse } from './rentalSpecDimHandlers.js';
import { rentalBulkPriceApplyResponse, rentalBulkPricePlanResponse } from './rentalBulkPriceHandlers.js';
import { buildRefreshActivityStrategyCard } from './refreshActivityCard.js';
import { buildInactiveRefreshPlan } from '../operations/inactiveRefresh/planner.js';
import { buildInactiveRefreshPlanCard } from '../operations/inactiveRefresh/card.js';
import { executeInactiveRefreshPlan } from '../operations/inactiveRefresh/execute.js';
import { saveInactiveRefreshPlan } from '../operations/inactiveRefresh/planStore.js';

export interface AgentToolExecutionOptions {
  rentalPriceClient?: RentalPriceSkillClient;
  closedOrderFetchImpl?: typeof fetch;
  closedOrderRegistryPaths?: ClosedOrderRegistryPathsInput;
  ledgerContext?: RentalWriteLedgerContext;
}

type AgentToolWriteEvent = 'execution_started' | 'execution_succeeded' | 'execution_failed';

let publicTrafficReportRunning = false;

const RENTAL_PRICE_SNAPSHOT_MAX_PRODUCTS = 60;
const RENTAL_PRICE_PREVIEW_MAX_PRODUCTS = 60;
const RENTAL_SPEC_REMOVE_PLAN_BULK_WARNING_PRODUCTS = 12;
const RENTAL_SPEC_REMOVE_PLAN_MAX_PRODUCTS = 60;
const RENTAL_SPEC_REMOVE_PLAN_MAX_ITEMS = 50;
const REFRESH_ACTIVITY_DEFAULT_MAX_CANDIDATES = 20;
const REFRESH_ACTIVITY_MIN_ONLINE_DAYS = 30;
const REFRESH_ACTIVITY_DEFAULT_WINDOW_DAYS = 30;
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
const arbitraryWindowDaysPattern = /^(?:[1-9]|[1-8]\d|90)$/;
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

function confirmationKey(value: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
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
  if (!latest) return { text: formatInventoryStatusMissingText({ status: 'snapshot_missing', reason: 'missing' }) };

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
    reportGenerationId: latest.context.generationId,
    reportDate: latest.context.date,
    snapshotDate: runDate,
  });

  if (result.status === 'overview') {
    return { text: formatInventoryStatusOverviewText(result), card: buildInventoryStatusOverviewCard(result) };
  }
  if (result.status === 'detail') {
    const historySnapshots = await readInventorySameSkuSnapshotHistory(outputDir, runDate);
    return { text: formatInventoryStatusDetailText(result), card: buildInventoryStatusDetailCard({ ...result, historySnapshots }) };
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

function readPublicTrafficMetric(value: unknown): PublicTrafficMetricKey {
  if (typeof value === 'string' && getPublicTrafficMetric(value)) return value as PublicTrafficMetricKey;
  throw new Error('metric must be a supported public traffic metric');
}

function readMetricThresholdOperator(value: unknown): MetricThresholdStrategyInput['operator'] {
  if (value === 'eq' || value === 'neq' || value === 'gt' || value === 'gte' || value === 'lt' || value === 'lte') return value;
  throw new Error('operator must be eq, neq, gt, gte, lt, or lte');
}

function readRequiredNumber(value: unknown, fieldName: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new Error(`${fieldName} must be a finite number`);
}

function isFixedCategoryMetric(metric: PublicTrafficMetricKey): metric is CategoryRankingMetric {
  return metric === 'shippedOrders' || metric === 'amount' || metric === 'exposure';
}

function readOptionalCategoryRankingMetric(value: unknown): CategoryRankingMetric | undefined {
  if (value === undefined) return undefined;
  return readCategoryRankingMetric(value);
}

function readOptionalPublicTrafficMetric(value: unknown): PublicTrafficMetricKey | undefined {
  if (value === undefined) return undefined;
  return readPublicTrafficMetric(value);
}

function readBoundedDays(value: unknown, fieldName: 'periodDays' | 'windowDays'): number {
  if (typeof value === 'string') {
    if (!arbitraryWindowDaysPattern.test(value)) throw new Error(`${fieldName} must be between 1 and 90`);
    return Number(value);
  }
  if (!Number.isInteger(value) || typeof value !== 'number' || value < 1 || value > 90) throw new Error(`${fieldName} must be between 1 and 90`);
  return value;
}

function readPeriodDays(value: unknown): 1 | 7 | 30 {
  const parsed = typeof value === 'string'
    ? (/^(?:1|7|30)$/.test(value) ? Number(value) : value)
    : value;
  if (parsed === 1 || parsed === 7 || parsed === 30) return parsed;
  throw new Error('periodDays must be 1, 7, or 30');
}

function readOptionalPeriodDays(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  return readBoundedDays(value, 'periodDays');
}

function readOptionalLimit(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (Number.isInteger(parsed) && typeof parsed === 'number' && parsed > 0) return parsed;
  throw new Error('limit must be a positive integer');
}

function readWindowDays(value: unknown): number {
  return readBoundedDays(value, 'windowDays');
}

function readOptionalWindowDays(value: unknown): number | undefined {
  return value === undefined ? undefined : readWindowDays(value);
}

function formatCategoryRankingMetric(metric: CategoryRankingMetric): string {
  if (metric === 'shippedOrders') return '发货';
  if (metric === 'amount') return '金额';
  return '曝光';
}

function formatCategoryRankingResponse(result: ReturnType<typeof rankProductsByCategory>): BotResponse {
  const label = formatCategoryRankingMetric(result.metric);
  const lines = result.items.map((item, index) => `${index + 1}. ${item.productName}（端内ID ${item.internalProductId}，${item.category}）${label} ${item.value}`);
  const windowDays = Number(result.period.replace('d', ''));
  return {
    text: [
      `品类排名：${result.category ?? '全部'} ${result.period} ${label}`,
      ...lines,
    ].join('\n'),
    metadata: { toolName: 'product.rankByCategory', date: result.date, endDate: result.date, category: result.category, metric: result.metric, period: result.period, periodDays: windowDays, windowDays, availability: {}, productIds: result.items.map((item) => item.internalProductId), items: result.items },
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
  const displayMetrics = publicTrafficMetricKeys.filter((metric) => metric !== 'custodyDays');
  const lines = result.slice(0, 10).map((item, index) => {
    const metricText = displayMetrics
      .map((metric) => formatWindowAggregateMetric(item, metric))
      .join('，');
    return `${index + 1}. ${item.productName}（端内ID ${item.internalProductId}）覆盖 ${item.daysCovered}/${windowDays} 天，${metricText}`;
  });
  const productIds = result.map((item) => item.internalProductId);
  const fullyCoveredProductIds = result.filter((item) => item.daysCovered === windowDays).map((item) => item.internalProductId);
  const partialCoveredProductIds = result.filter((item) => item.daysCovered < windowDays).map((item) => item.internalProductId);
  const missingDatesByProduct = Object.fromEntries(result
    .filter((item) => item.missingDates.length > 0)
    .map((item) => [item.internalProductId, item.missingDates]));
  const availability = Object.fromEntries(publicTrafficMetricKeys.map((metric) => [metric, result.filter((item) => item.availability[metric]?.available).length]));
  const status = result.length === 0 ? 'empty' : partialCoveredProductIds.length > 0 ? 'partial' : 'ok';
  return {
    text: [`公域窗口聚合：截至 ${endDate}，近 ${windowDays} 天`, ...lines].join('\n'),
    metadata: { toolName: 'publicTraffic.windowAggregate', status, endDate, windowDays, availability, productCount: result.length, productIds, fullyCoveredProductIds, partialCoveredProductIds, missingDatesByProduct, items: result },
  };
}

function formatWindowAggregateMetric(item: WindowProductAggregate, metric: PublicTrafficMetricKey): string {
  const definition = getPublicTrafficMetric(metric)!;
  const value = readWindowMetric(item, metric);
  if (value === undefined) return `${definition.label} 不可用`;
  if (definition.format === 'money') return `${definition.label} ¥${value.toFixed(2)}`;
  if (definition.format === 'percent') return `${definition.label} ${(value * 100).toFixed(2)}%`;
  return `${definition.label} ${Number.isInteger(value) ? value : value.toFixed(2)}`;
}

function formatWindowQueryResponse(result: PublicTrafficWindowQueryResult): BotResponse {
  const aggregationLine = result.aggregation
    ? `统计：${result.aggregation.metric ? getPublicTrafficMetric(result.aggregation.metric)!.label : ''}${result.aggregation.label} = ${Number.isInteger(result.aggregation.value) ? result.aggregation.value : result.aggregation.value.toFixed(2)}`
    : undefined;
  const lines = result.items.map((item, index) => {
    const metricText = Object.entries(item.values).map(([metric, value]) => {
      const definition = getPublicTrafficMetric(metric)!;
      if (definition.format === 'money') return `${definition.label} ¥${value.toFixed(2)}`;
      if (definition.format === 'percent') return `${definition.label} ${(value * 100).toFixed(2)}%`;
      return `${definition.label} ${Number.isInteger(value) ? value : value.toFixed(2)}`;
    }).join('，');
    return `${index + 1}. ${item.productName}（端内ID ${item.internalProductId}）${metricText ? `：${metricText}` : ''}`;
  });
  const metric = Object.keys(result.availableCountByMetric)[0];
  const productIds = result.items.map((item) => item.internalProductId);
  return {
    text: [`公域窗口查询：截至 ${result.endDate}，近 ${result.windowDays} 天`, `匹配 ${result.matchedCount} 条`, aggregationLine, ...lines].filter((line): line is string => Boolean(line)).join('\n'),
    metadata: { toolName: 'publicTraffic.windowQuery', ...(metric ? { metric } : {}), windowDays: result.windowDays, endDate: result.endDate, availability: result.availableCountByMetric, productIds, ...(result.aggregation ? { aggregation: result.aggregation } : {}), items: result.items },
  };
}

function formatWindowCategoryRankingResponse(result: Awaited<ReturnType<typeof rankProductsByCategoryWindowed>>): BotResponse {
  const definition = getPublicTrafficMetric(result.metric)!;
  const lines = result.items.map((item, index) => {
    const value = definition.format === 'money'
      ? `¥${item.value.toFixed(2)}`
      : definition.format === 'percent'
        ? `${(item.value * 100).toFixed(2)}%`
        : `${Number.isInteger(item.value) ? item.value : item.value.toFixed(2)}`;
    return `${index + 1}. ${item.productName}（端内ID ${item.internalProductId}，${item.category}）${definition.label} ${value}`;
  });
  return {
    text: [`品类排名：${result.category ?? '全部'} 近${result.periodDays}天 ${definition.label}`, ...lines].join('\n'),
    metadata: { toolName: 'product.rankByCategory', date: result.date, endDate: result.date, category: result.category, metric: result.metric, periodDays: result.periodDays, windowDays: result.periodDays, availability: {}, productIds: result.items.map((item) => item.internalProductId), items: result.items },
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

function formatLegacyRefreshCandidateLine(result: MetricThresholdStrategyResult, input: MetricThresholdStrategyInput): string | null {
  if (result.metric !== 'amount' && result.metric !== 'createdOrders') return null;
  const label = result.metric === 'amount' ? `近${input.windowDays}天订单金额为0` : `近${input.windowDays}天创单为0`;
  return result.candidateProductIds.length > 0
    ? `找到 ${result.candidateProductIds.length} 条符合 ${label} 的 active 链接。`
    : `没有找到符合 ${label} 的 active 链接。`;
}

function metricThresholdCompletenessText(conditions: MetricThresholdCondition[]): string {
  const sourceLabels = new Set(conditions.map((condition) => {
    const definition = getPublicTrafficMetric(condition.metric)!;
    return metricSourceLabel(definition.source);
  }));
  return sourceLabels.size === 1 ? `${[...sourceLabels][0]}完整` : '指标数据完整';
}

function metricThresholdDataDescription(conditions: MetricThresholdCondition[]): string {
  if (conditions.length === 1) {
    const definition = getPublicTrafficMetric(conditions[0]!.metric)!;
    const sourceLabel = metricSourceLabel(definition.source);
    return `数据说明：${definition.label}来自${sourceLabel}；缺失的访问页/公域数据不会按0参与筛选。`;
  }
  return '数据说明：复合指标可能来自多个数据源；缺失的访问页/公域数据不会按0参与筛选。';
}

function formatMetricThresholdExplainResponse(
  result: MetricThresholdStrategyResult,
  input: MetricThresholdStrategyInput,
  toolName: 'strategy.metricThresholdExplain' | 'strategy.refreshCandidateExplain',
  resolvedSameSkuGroupId?: string,
): BotResponse {
  const definition = getPublicTrafficMetric(result.metric)!;
  const status = result.candidateProductIds.length > 0 ? 'found' : 'empty';
  const conditions = result.conditions ?? input.conditions ?? [{ metric: input.metric, operator: input.operator, value: input.value }];
  const condition = result.conditionSummary ?? formatMetricThresholdCondition(input);
  const completenessText = metricThresholdCompletenessText(conditions);
  const sameSkuGroupId = input.sameSkuGroupId ?? resolvedSameSkuGroupId;
  const scopeLine = sameSkuGroupId
    ? `筛选范围：${sameSkuGroupId}`
    : input.query ? `筛选范围：${input.query}` : '筛选范围：全部链接档案';
  const legacyLine = toolName === 'strategy.refreshCandidateExplain' ? formatLegacyRefreshCandidateLine(result, input) : null;
  return {
    text: [
      scopeLine,
      `筛选口径：${input.requireActive ? 'active 链接' : '链接档案范围'}，${condition}，${completenessText}${input.requireOnlineDays ? `，上线满${input.requireOnlineDays}天` : ''}。`,
      metricThresholdDataDescription(conditions),
      ...result.reasonSummary,
      result.candidateProductIds.length > 0 ? `候选端内ID：${result.candidateProductIds.join('、')}` : undefined,
      legacyLine,
    ].filter((line): line is string => Boolean(line)).join('\n'),
    metadata: {
      toolName,
      status,
      endDate: input.date,
      availability: { unavailableMetricProductIds: result.unavailableMetricProductIds, unavailableMetricCount: result.skipped.unavailableMetric },
      productIds: result.candidateProductIds,
      metricLabel: definition.label,
      metricSource: definition.source,
      operator: input.operator,
      value: input.value,
      ...(toolName === 'strategy.refreshCandidateExplain' ? { zeroMetric: result.metric === 'createdOrders' ? 'created_orders' : 'amount' } : {}),
      ...(toolName === 'strategy.refreshCandidateExplain' ? { legacyArgumentAdapted: true } : {}),
      ...(input.query ? { query: input.query } : {}),
      ...(sameSkuGroupId ? { sameSkuGroupId } : {}),
      ...result,
      candidateCount: result.candidateProductIds.length,
      skippedReasons: result.reasonSummary,
    },
  };
}

function metricThresholdResultFromRefreshExplain(result: ReturnType<typeof explainRefreshCandidates>): MetricThresholdStrategyResult {
  return {
    metric: result.metric,
    windowDays: result.windowDays,
    candidateProductIds: result.candidateProductIds,
    skipped: {
      inactive: result.skipped.inactive,
      missingRow: result.skipped.missingRow,
      unavailableMetric: result.skipped.missing30dDashboard,
      onlineLessThanRequired: result.skipped.onlineLessThan30d,
      onlineDaysUnknown: result.skipped.onlineDaysUnknown,
    },
    unavailableMetricProductIds: result.missing30dDashboardProductIds,
    reasonSummary: result.reasonSummary,
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
  const resolution = resolveRentalPriceSnapshotEntries(query, registry, { expandSingleInternalIdToSameSkuGroup: !queryHasExplicitProductIdentifier(query), allowMultipleInternalIds: true });
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

function hasAmbiguousBarePriceNumber(text: string): boolean {
  const compact = text.replace(/\s+/g, '');
  if (/[折倍xX%％元块+-]/u.test(compact)) return false;
  return /(?:价格|租金)(?:为|到|成)?\d+(?:\.\d+)?$/u.test(compact);
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
  const auditCount = input.readyItems.filter((item) => item.audit?.taskId).length;
  const safetyLine = auditCount === input.readyItems.length && input.readyItems.length > 0
    ? '安全边界：确认前不会改价；确认后按上面每个商品的审计预览逐个执行，并保留各自回滚文件。'
    : auditCount > 0
      ? `安全边界：确认前不会改价；确认后按上面字段逐个串行执行；其中 ${auditCount} 个商品带审计引用。`
      : '安全边界：确认前不会改价；确认后按上面字段逐个串行执行。';
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
    safetyLine,
    ...(input.blocked.length ? ['', '已阻断，未生成执行确认卡：', ...input.blocked.slice(0, 12)] : []),
  ].filter((line): line is string => Boolean(line)).join('\n');
}

export function buildRentalPricePreviewProgressCard(productIds: string[], reason: string): FeishuCardPayload {
  const scopeText = productIds.length ? `${productIds.length} 个端内ID` : '商品范围解析中';
  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: '租赁改价预览处理中' }, template: 'blue' },
    body: {
      elements: [
        cardMarkdown([
          '**已收到改价预览指令，当前不会写入商品。**',
          '',
          `指令：${reason}`,
          `范围：${scopeText}`,
          '当前阶段：解析指令 -> 解析商品范围 -> 读取 SaaS 价格 -> 生成逐规格计划 -> 运行审计规则 -> 渲染审批卡',
          `进度：0/${productIds.length || '?'}，正在准备读取价格与审计预览`,
        ].join('\n')),
      ],
    },
  };
}

type PriceApplyPreviewItem = { productId: string; fields: Record<string, string>; audit?: RentalPriceAuditReference };

function cardMarkdown(content: string): Record<string, unknown> {
  return { tag: 'markdown', content };
}

function cardMetricColumn(label: string, value: string, note?: string): Record<string, unknown> {
  return {
    tag: 'column',
    width: 'weighted',
    weight: 1,
    elements: [cardMarkdown(`**${label}**\n${value}${note ? `\n<font color=grey>${note}</font>` : ''}`)],
  };
}

function cardTable(elementId: string, columns: Array<{ name: string; display_name: string }>, rows: Array<Record<string, string>>, pageSize = 10): Record<string, unknown> {
  return {
    tag: 'table',
    element_id: elementId,
    page_size: Math.max(1, Math.min(10, pageSize)),
    row_height: 'low',
    row_max_height: '140px',
    freeze_first_column: true,
    header_style: { background_style: 'grey', text_size: 'normal', text_align: 'left' },
    columns: columns.map((column) => ({
      ...column,
      data_type: 'text',
      horizontal_align: 'left',
      width: 'auto',
    })),
    rows,
  };
}

function auditDiffRows(item: PriceApplyPreviewItem): RentalPriceAuditDiff[] {
  return item.audit?.diff ?? [];
}

function fieldDisplayName(field: string): string {
  return field.replace(/^rent/, '').replace(/day$/i, '天') || field;
}

function diffDisplay(diff: RentalPriceAuditDiff): string {
  const issue = diff.issues.some((item) => item.level === 'error' || item.level === 'warn' || item.level === 'warning');
  const change = diff.changePct && diff.changePct !== '-' ? `${diff.change} / ${diff.changePct}` : diff.change;
  const changeText = issue ? `<font color=red>**${change}**</font>` : change;
  return `${diff.old} -> ${diff.new}\n${changeText}`;
}

function fieldOnlyDisplay(value: string): string {
  return `-> ${value}`;
}

function parsePercent(value: string): number | null {
  const match = value.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function parseSignedAmount(value: string): number | null {
  const match = value.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function maxChangeText(diffs: RentalPriceAuditDiff[], fields: Record<string, string>): string {
  if (diffs.length === 0) return Object.keys(fields).length ? '见字段新值' : '-';
  let selected = diffs[0];
  const firstMagnitude = parsePercent(selected.changePct) ?? Number(selected.change);
  let selectedMagnitude = Math.abs(Number.isFinite(firstMagnitude) ? firstMagnitude : 0);
  for (const diff of diffs.slice(1)) {
    const rawMagnitude = parsePercent(diff.changePct) ?? Number(diff.change);
    const magnitude = Math.abs(Number.isFinite(rawMagnitude) ? rawMagnitude : 0);
    if (magnitude > selectedMagnitude) {
      selected = diff;
      selectedMagnitude = magnitude;
    }
  }
  return selected.changePct && selected.changePct !== '-' ? `${selected.change} / ${selected.changePct}` : selected.change;
}

function maxDirectionalChangeText(items: PriceApplyPreviewItem[], direction: 'drop' | 'increase'): string {
  const candidates = items.flatMap((item) => auditDiffRows(item).map((diff) => ({ item, diff, amount: parseSignedAmount(diff.change) })));
  const filtered = candidates.filter((candidate): candidate is { item: PriceApplyPreviewItem; diff: RentalPriceAuditDiff; amount: number } => candidate.amount !== null && (direction === 'drop' ? candidate.amount < 0 : candidate.amount > 0));
  if (!filtered.length) return '无';
  const selected = filtered.reduce((best, candidate) => (direction === 'drop' ? candidate.amount < best.amount : candidate.amount > best.amount) ? candidate : best, filtered[0]);
  const spec = selected.diff.specTitle || selected.diff.specId || '默认规格';
  const pct = selected.diff.changePct && selected.diff.changePct !== '-' ? ` / ${selected.diff.changePct}` : '';
  return `商品 ${selected.item.productId} / ${spec} / ${selected.diff.label || selected.diff.field}: ${selected.diff.change}${pct}`;
}

function pricePreviewSpecCount(items: PriceApplyPreviewItem[]): number {
  let total = 0;
  for (const item of items) {
    const specIds = new Set(auditDiffRows(item).map((diff) => diff.specId || diff.specTitle).filter(Boolean));
    total += Math.max(1, specIds.size);
  }
  return total;
}

function pricePreviewWriteMode(items: PriceApplyPreviewItem[]): string {
  const hasMultiSpec = items.some((item) => {
    const specIds = new Set(auditDiffRows(item).map((diff) => diff.specId || diff.specTitle).filter(Boolean));
    return specIds.size > 1;
  });
  return hasMultiSpec ? '逐规格写入' : '单规格审计写入';
}

function pricePreviewOperationSemantics(items: PriceApplyPreviewItem[]): string {
  const diffs = items.flatMap(auditDiffRows);
  const amounts = [...new Set(diffs.map((diff) => diff.change).filter((value) => value && value !== '-'))];
  if (amounts.length === 1) return `${pricePreviewWriteMode(items)}：每个涉及租金字段 ${amounts[0]} 元`;
  return `${pricePreviewWriteMode(items)}：按审计 diff 写入目标租赁价`;
}

function countRiskThresholds(items: PriceApplyPreviewItem[]): string {
  const percents = items.flatMap((item) => auditDiffRows(item).map((diff) => Math.abs(parsePercent(diff.changePct) ?? 0)));
  return `>20% ${percents.filter((value) => value > 20).length}，>50% ${percents.filter((value) => value > 50).length}，>70% ${percents.filter((value) => value > 70).length}`;
}

function itemStatus(item: PriceApplyPreviewItem): string {
  if (item.audit?.hasErrors) return '阻断';
  if (item.audit?.hasWarnings || auditDiffRows(item).some((diff) => diff.issues.length > 0)) return '风险';
  return '通过';
}

function itemSpecShape(item: PriceApplyPreviewItem): string {
  const titles = new Set(auditDiffRows(item).map((diff) => diff.specTitle?.trim()).filter((value): value is string => Boolean(value)));
  if (titles.size > 1) return '多规格';
  if (titles.size === 1) return titles.values().next().value ?? '单规格';
  return '单规格';
}

function itemRentTerms(item: PriceApplyPreviewItem): string {
  const labels = auditDiffRows(item).map((diff) => diff.label || fieldDisplayName(diff.field));
  const fallback = Object.keys(item.fields).map(fieldDisplayName);
  const terms = [...new Set(labels.length ? labels : fallback)].slice(0, 5);
  return `${terms.join(' / ')}${(labels.length || fallback.length) > terms.length ? ' / ...' : ''}`;
}

function buildPriceApplySummaryRows(items: PriceApplyPreviewItem[]): Array<Record<string, string>> {
  return items.map((item) => {
    const diffs = auditDiffRows(item);
    return {
      productId: item.productId,
      productType: '租赁商品',
      specShape: itemSpecShape(item),
      rentTerms: itemRentTerms(item),
      maxChange: maxChangeText(diffs, item.fields),
      status: itemStatus(item),
    };
  });
}

function detailFieldKeys(items: PriceApplyPreviewItem[]): Array<{ key: string; label: string }> {
  const entries: Array<{ key: string; label: string }> = [];
  const seen = new Set<string>();
  for (const item of items) {
    for (const diff of auditDiffRows(item)) {
      if (seen.has(diff.field)) continue;
      seen.add(diff.field);
      entries.push({ key: diff.field, label: diff.label || fieldDisplayName(diff.field) });
      if (entries.length >= 5) return entries;
    }
    for (const field of Object.keys(item.fields)) {
      if (seen.has(field)) continue;
      seen.add(field);
      entries.push({ key: field, label: fieldDisplayName(field) });
      if (entries.length >= 5) return entries;
    }
  }
  return entries;
}

function buildPriceApplyDetailRows(items: PriceApplyPreviewItem[], fields: Array<{ key: string; label: string }>): Array<Record<string, string>> {
  const rows: Array<Record<string, string>> = [];
  for (const item of items.slice(0, 3)) {
    const diffs = auditDiffRows(item);
    if (diffs.length > 0) {
      const grouped = new Map<string, RentalPriceAuditDiff[]>();
      for (const diff of diffs) {
        const spec = diff.specTitle?.trim() || '默认规格';
        grouped.set(spec, [...(grouped.get(spec) ?? []), diff]);
      }
      for (const [spec, specDiffs] of grouped) {
        const row: Record<string, string> = { productId: item.productId, spec };
        for (const field of fields) {
          const diff = specDiffs.find((entry) => entry.field === field.key);
          row[field.key] = diff ? diffDisplay(diff) : item.fields[field.key] ? fieldOnlyDisplay(item.fields[field.key]) : '-';
        }
        rows.push(row);
      }
    } else {
      const row: Record<string, string> = { productId: item.productId, spec: '默认规格' };
      for (const field of fields) row[field.key] = item.fields[field.key] ? fieldOnlyDisplay(item.fields[field.key]) : '-';
      rows.push(row);
    }
    if (rows.length >= 8) break;
  }
  return rows;
}

function buildPriceApplyConfirmDisplayElements(items: PriceApplyPreviewItem[]): Record<string, unknown>[] {
  const fieldCount = items.reduce((sum, item) => sum + Math.max(auditDiffRows(item).length, Object.keys(item.fields).length), 0);
  const specCount = pricePreviewSpecCount(items);
  const rollbackReadyCount = items.filter((item) => Boolean(item.audit?.rollbackFile)).length;
  const riskyCount = items.filter((item) => itemStatus(item) !== '通过').length;
  const fields = detailFieldKeys(items);
  const detailRows = fields.length ? buildPriceApplyDetailRows(items, fields) : [];
  return [
    cardMarkdown([
      "<text_tag color='orange'>预览已完成，尚未写入</text_tag>",
      `**${pricePreviewOperationSemantics(items)}**`,
      '点击“确认执行”后才会真实写入；执行会按审计 requestRef 串行处理，并在写入后逐商品回读校验。',
      '本卡只展示业务摘要；最终执行范围以已保存的审计请求为准。',
    ].join('\n')),
    {
      tag: 'column_set',
      flex_mode: 'none',
      background_style: 'grey',
      columns: [
        cardMetricColumn('写入模式', pricePreviewWriteMode(items), '禁止 broadcast'),
        cardMetricColumn('范围', `${items.length} 链 / ${specCount} 规格 / ${fieldCount} 字段`),
        cardMetricColumn('风险等级', riskyCount > 0 ? `<font color=orange>warn</font>` : '<font color=green>ok</font>'),
        cardMetricColumn('验证合同', `${fieldCount}/${fieldCount}`, 'expected readback count'),
      ],
    },
    {
      tag: 'column_set',
      flex_mode: 'none',
      background_style: 'grey',
      columns: [
        cardMetricColumn('最大降幅', maxDirectionalChangeText(items, 'drop')),
        cardMetricColumn('最大涨幅', maxDirectionalChangeText(items, 'increase')),
        cardMetricColumn('回滚准备', `${rollbackReadyCount}/${items.length}`, rollbackReadyCount === items.length ? '逐规格回滚已生成' : '部分缺失'),
        cardMetricColumn('风险阈值', countRiskThresholds(items)),
      ],
    },
    cardMarkdown('**本次会写什么（链接汇总表）**'),
    cardTable('rental_price_apply_summary', [
      { name: 'productId', display_name: '商品ID' },
      { name: 'productType', display_name: '商品类型' },
      { name: 'specShape', display_name: '规格结构' },
      { name: 'rentTerms', display_name: '涉及租期' },
      { name: 'maxChange', display_name: '最大变化' },
      { name: 'status', display_name: '状态' },
    ], buildPriceApplySummaryRows(items)),
    ...(detailRows.length ? [
      cardMarkdown(`**价格变化明细：默认展开前 ${Math.min(items.length, 3)} 条链接**`),
      cardTable('rental_price_apply_detail', [
        { name: 'productId', display_name: '商品ID' },
        { name: 'spec', display_name: '规格' },
        ...fields.map((field) => ({ name: field.key, display_name: field.label })),
      ], detailRows),
    ] : []),
    items.length > 3 ? cardMarkdown(`<font color=grey>还有 ${items.length - 3} 条链接未在明细表展开；完整范围见汇总表和审计文件。</font>`) : cardMarkdown('<font color=grey>完整 diff 来自审计预览；当前展示不改变执行范围。</font>'),
  ];
}

function buildRentalPricePreviewTerminalCard(input: { title: string; text: string; template?: 'orange' | 'red' | 'green' }): FeishuCardPayload {
  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: input.title }, template: input.template ?? 'orange' },
    body: {
      elements: [cardMarkdown(input.text)],
    },
  };
}

function ambiguousAmountScopeMessage(productIds: string[], reason: string): string {
  return [
    '改价范围不明确，已阻断，未读取/未写入商品。',
    '',
    `原始指令：${reason}`,
    `端内ID：${productIds.join('、')}`,
    '',
    '请明确你要改哪一类租金：',
    `- 所有租期都减 15 元：${productIds[0]}所有租期改价-15元`,
    `- 只改指定租期：${productIds[0]}改价1天88 2天188`,
    '- 多规格商品请明确规格，避免把同一个价格广播到所有规格。',
  ].join('\n');
}

function executionVerifyStatus(result: RentalPriceExecutionResult): string {
  const joined = result.lines.join('\n').toLowerCase();
  if (/verify:\s*ok|fields:\s*matched/.test(joined)) return '已回读匹配';
  if (/verify/.test(joined)) return '需人工复核';
  return result.ok ? '未返回验证详情' : '未验证';
}

function buildPriceApplyCompletionRows(results: RentalPriceExecutionResult[]): Array<Record<string, string>> {
  return results.map((result) => ({
    productId: result.productId,
    status: result.ok ? '成功' : '失败',
    verify: executionVerifyStatus(result),
    taskId: result.audit?.taskId ?? '-',
    rollback: result.ok && result.audit?.status === 'completed' && result.audit.taskId ? '可生成确认卡' : '不可用',
    details: result.lines.slice(0, 3).join('\n') || '-',
  }));
}

interface RollbackReadyItem {
  productId: string;
  taskId: string;
}

function rollbackReadyItems(results: RentalPriceExecutionResult[]): RollbackReadyItem[] {
  return results
    .filter((result) => result.ok && result.audit?.status === 'completed' && result.audit.taskId)
    .map((result) => ({ productId: result.productId, taskId: result.audit!.taskId! }));
}

function rollbackActionKey(taskIds: string[]): string {
  return confirmationKey({ taskIds } as Record<string, unknown>);
}

function rollbackActionValue(action: string, items: RollbackReadyItem[]): Record<string, unknown> {
  const taskIds = items.map((item) => item.taskId);
  return { action, taskIds, products: items, confirmationKey: rollbackActionKey(taskIds) };
}

function storedRollbackActionValue(action: string, storedAction: { rollbackRef: string; confirmationKey: string }): Record<string, unknown> {
  return { action, rollbackRef: storedAction.rollbackRef, confirmationKey: storedAction.confirmationKey };
}

function completionActionValue(action: string, results: RentalPriceExecutionResult[]): Record<string, unknown> {
  const productIds = results.map((result) => result.productId);
  return { action, productIds, confirmationKey: confirmationKey({ productIds } as Record<string, unknown>) };
}

function legacyRollbackButton(result: RentalPriceExecutionResult, index: number): Record<string, unknown> | null {
  const taskId = result.audit?.taskId;
  if (!result.ok || result.audit?.status !== 'completed' || !taskId) return null;
  return {
    tag: 'button',
    text: { tag: 'plain_text', content: `生成回滚确认卡 ${result.productId}` },
    type: 'default',
    form_action_type: 'submit',
    name: `rental_price_prepare_rollback_${index}`,
    behaviors: [{ type: 'callback', value: { action: 'rental_price_prepare_rollback', taskId } }],
  };
}

async function buildPriceApplyCompletionCard(results: RentalPriceExecutionResult[], outputDir: string): Promise<FeishuCardPayload> {
  const success = results.filter((item) => item.ok);
  const rollbackReady = rollbackReadyItems(results);
  const rollbackAction = rollbackReady.length ? await saveRentalPriceRollbackAction(outputDir, rollbackReady) : null;
  const actionElements: Record<string, unknown>[] = [
    {
      tag: 'button',
      text: { tag: 'plain_text', content: '认可本次操作完成' },
      type: 'primary',
      form_action_type: 'submit',
      name: 'rental_price_acknowledge_completion_submit',
      behaviors: [{ type: 'callback', value: completionActionValue('rental_price_acknowledge_completion', results) }],
    },
  ];
  if (rollbackAction) {
    actionElements.push(
      {
        tag: 'button',
        text: { tag: 'plain_text', content: '选择回滚链接' },
        type: 'default',
        form_action_type: 'submit',
        name: 'rental_price_select_rollback_submit',
        behaviors: [{ type: 'callback', value: storedRollbackActionValue('rental_price_select_rollback', rollbackAction) }],
      },
      {
        tag: 'button',
        text: { tag: 'plain_text', content: '回滚本次全部' },
        type: 'danger',
        form_action_type: 'submit',
        name: 'rental_price_prepare_rollback_all_submit',
        behaviors: [{ type: 'callback', value: storedRollbackActionValue('rental_price_prepare_rollback_all', rollbackAction) }],
      },
    );
  }
  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: success.length === results.length ? '租赁改价执行完成' : 'Agent 操作失败' }, template: success.length === results.length ? 'green' : 'red' },
    body: {
      elements: [
        cardMarkdown([
          success.length === results.length ? "<text_tag color='green'>已写入并完成回读流程</text_tag>" : "<text_tag color='red'>存在失败项，勿重复提交</text_tag>",
          `**成功 ${success.length}/${results.length}，可回滚 ${rollbackReady.length}/${results.length}**`,
          '回滚不是一键执行。选择回滚或全部回滚都只会生成二次确认卡，确认后才按 taskId 校验审计链路并执行。',
        ].join('\n')),
        {
          tag: 'column_set',
          flex_mode: 'none',
          background_style: 'grey',
          columns: [
            cardMetricColumn('执行结果', `${success.length}/${results.length}`, success.length === results.length ? '全部成功' : '存在失败'),
            cardMetricColumn('回读状态', `${results.filter((item) => executionVerifyStatus(item) === '已回读匹配').length}/${results.length}`, 'matched/total'),
            cardMetricColumn('回滚入口', `${rollbackReady.length}/${results.length}`, '生成确认卡，不直接回滚'),
          ],
        },
        cardTable('rental_price_apply_completion', [
          { name: 'productId', display_name: '商品ID' },
          { name: 'status', display_name: '执行' },
          { name: 'verify', display_name: '回读' },
          { name: 'taskId', display_name: '审计任务' },
          { name: 'rollback', display_name: '回滚' },
          { name: 'details', display_name: '执行明细' },
        ], buildPriceApplyCompletionRows(results)),
        {
          tag: 'form',
          name: 'rental_price_completion_actions_form',
          elements: actionElements,
        },
        ...(rollbackReady.length ? [] : [cardMarkdown('<font color=grey>没有可自动生成回滚确认卡的成功任务。</font>')]),
      ],
    },
  };
}

function readTaskIdArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > RENTAL_PRICE_PREVIEW_MAX_PRODUCTS) return null;
  const taskIds = value.map((item) => readString(item)).filter((item): item is string => Boolean(item));
  if (taskIds.length !== value.length || taskIds.some((taskId) => !/^task_\d+_[a-f0-9]+$/i.test(taskId))) return null;
  return [...new Set(taskIds)];
}

function readRollbackProducts(value: unknown): RollbackReadyItem[] {
  if (!Array.isArray(value)) return [];
  const items: RollbackReadyItem[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const productId = readString(item.productId);
    const taskId = readString(item.taskId);
    if (productId && taskId && /^task_\d+_[a-f0-9]+$/i.test(taskId)) items.push({ productId, taskId });
  }
  return items;
}

function readSignedRollbackTaskIds(value: Record<string, unknown>, allowedTaskIds: string[]): string[] | null {
  const taskIds = readTaskIdArray(value.taskIds);
  if (!taskIds || readString(value.confirmationKey) !== rollbackActionKey(taskIds)) return null;
  return taskIds.every((taskId) => allowedTaskIds.includes(taskId)) ? taskIds : null;
}

export async function buildRentalPriceRollbackSelectCard(outputDir: string, value: unknown): Promise<FeishuCardPayload | null> {
  if (!isRecord(value)) return null;
  const products = await loadRentalPriceRollbackAction(outputDir, value);
  if (!products) return null;
  const taskIds = products.map((item) => item.taskId);
  const options = taskIds.map((taskId) => {
    const product = products.find((item) => item.taskId === taskId);
    return {
      text: { tag: 'plain_text', content: product ? `商品 ${product.productId} / ${taskId}` : taskId },
      value: taskId,
    };
  });
  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: '选择要回滚的改价任务' }, template: 'orange' },
    body: {
      elements: [
        cardMarkdown([
          '<text_tag color=orange>选择范围，不会直接回滚</text_tag>',
          `可选回滚任务：${taskIds.length} 个。提交后会生成回滚审计确认卡，确认后才执行。`,
          '如果卡片端不支持多选，请重新点击“回滚本次全部”，或用文字指定要回滚的 taskId。',
        ].join('\n')),
        {
          tag: 'form',
          name: 'rental_price_selected_rollback_form',
          elements: [
            {
              tag: 'multi_select_static',
              name: 'selected_task_ids',
              placeholder: { tag: 'plain_text', content: '选择要回滚的链接/任务' },
              options,
            },
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '生成回滚审计卡' },
              type: 'primary',
              form_action_type: 'submit',
              name: 'rental_price_prepare_selected_rollback_submit',
              behaviors: [{ type: 'callback', value: { action: 'rental_price_prepare_selected_rollback', rollbackRef: value.rollbackRef, confirmationKey: value.confirmationKey } }],
            },
          ],
        },
      ],
    },
  };
}

export function buildRentalPriceCompletionAcknowledgedCard(value: unknown, reviewerId?: string): FeishuCardPayload | null {
  if (!isRecord(value)) return null;
  const productIds = readTaskIdArray(value.productIds) ?? (Array.isArray(value.productIds) ? value.productIds.map((item) => readString(item)).filter((item): item is string => Boolean(item)) : null);
  if (!productIds || readString(value.confirmationKey) !== confirmationKey({ productIds } as Record<string, unknown>)) return null;
  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: '租赁改价已认可完成' }, template: 'green' },
    body: {
      elements: [cardMarkdown([
        '<text_tag color=green>已认可完成</text_tag>',
        `商品：${productIds.join('、')}`,
        reviewerId ? `认可人：${reviewerId}` : undefined,
        '本卡已收口；如后续仍需回滚，请重新发起回滚指令并走审计确认。',
      ].filter((line): line is string => Boolean(line)).join('\n'))],
    },
  };
}

export async function buildRentalPriceRollbackConfirmCard(outputDir: string, value: unknown): Promise<FeishuCardPayload | null> {
  if (!isRecord(value)) return null;
  const allowedItems = await loadRentalPriceRollbackAction(outputDir, value);
  const allowedTaskIds = allowedItems?.map((item) => item.taskId) ?? [];
  const signedTaskIds = allowedItems ? (readSignedRollbackTaskIds(value, allowedTaskIds) ?? allowedTaskIds) : null;
  if (signedTaskIds) {
    const request: AgentToolConfirmRequest = {
      toolName: 'rental.priceRollbackBatch',
      arguments: { taskIds: signedTaskIds },
      reason: `用户要求回滚 ${signedTaskIds.length} 个已完成的租赁改价任务`,
    };
    const requestRef = await saveAgentToolConfirmRequest(outputDir, request);
    return buildAgentToolConfirmCard(request, {
      requestRef,
      summaryLines: [
        '这是回滚二次确认卡；点击确认后才会执行回滚。',
        `回滚范围：${signedTaskIds.length} 个审计任务。`,
        `审计任务：${signedTaskIds.join('、')}`,
        '每个任务都会重新校验审计哈希、原执行状态和回读证据。',
      ],
    });
  }
  return null;
}

export async function selectedRollbackValue(outputDir: string, value: unknown, formValue: unknown): Promise<Record<string, unknown> | null> {
  if (!isRecord(value)) return null;
  const allowedItems = await loadRentalPriceRollbackAction(outputDir, value);
  const allowedTaskIds = allowedItems?.map((item) => item.taskId) ?? null;
  if (!allowedTaskIds || !isRecord(formValue)) return null;
  const rawSelected = formValue.selected_task_ids;
  const selected = readTaskIdArray(Array.isArray(rawSelected) ? rawSelected : typeof rawSelected === 'string' ? rawSelected.split(/[\s,，、;；]+/).filter(Boolean) : rawSelected);
  if (!selected || selected.some((taskId) => !allowedTaskIds.includes(taskId))) return null;
  return { action: 'rental_price_prepare_selected_rollback', rollbackRef: value.rollbackRef, contextConfirmationKey: value.confirmationKey, taskIds: selected, confirmationKey: rollbackActionKey(selected) };
}

function moneyFixed(value: number): string {
  return value.toFixed(2);
}

function batchReadPricePreviewFields(
  values: unknown,
  input: { discount?: number; adjustmentAmount?: number },
): Record<string, string> {
  if (!isRecord(values)) return {};
  const firstSpec = Object.values(values).find(isRecord) as Record<string, unknown> | undefined;
  const source = firstSpec ?? values;
  const fields: Record<string, string> = {};
  for (const [field, raw] of Object.entries(source)) {
    if (!isRentPriceField(field)) continue;
    const current = Number(raw);
    if (!Number.isFinite(current)) continue;
    fields[field] = moneyFixed(input.discount !== undefined
      ? current * input.discount
      : current + (input.adjustmentAmount ?? 0));
  }
  return fields;
}

function batchReadPricePreviewArtifact(
  values: unknown,
  input: { discount?: number; adjustmentAmount?: number },
  displayFields: Record<string, string>,
): PriceChangeArtifact {
  if (!isRecord(values)) return displayFields;
  const specFields: PerSpecPriceFieldMap = {};
  for (const [specId, rawFields] of Object.entries(values)) {
    if (!isRecord(rawFields)) continue;
    const fields: Record<string, string> = {};
    for (const [field, raw] of Object.entries(rawFields)) {
      if (!isRentPriceField(field)) continue;
      const current = Number(raw);
      if (!Number.isFinite(current)) continue;
      fields[field] = moneyFixed(input.discount !== undefined
        ? current * input.discount
        : current + (input.adjustmentAmount ?? 0));
    }
    if (Object.keys(fields).length) specFields[specId] = fields;
  }
  return Object.keys(specFields).length > 1 ? specFields : displayFields;
}

const BATCH_READ_AUDIT_CONCURRENCY = 12;

async function mapConcurrent<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

type BatchReadPricePreviewOutcome =
  | { status: 'ready'; item: { productId: string; fields: Record<string, string>; audit?: RentalPriceAuditReference } }
  | { status: 'blocked'; message: string };

async function batchReadPricePreviewItems(
  productIds: string[],
  client: RentalPriceSkillClient,
  input: { discount?: number; adjustmentAmount?: number },
): Promise<{ readyItems: Array<{ productId: string; fields: Record<string, string>; audit?: RentalPriceAuditReference }>; blocked: string[] } | null> {
  if (!client.batchRead || !client.auditPreviewFromRead || productIds.length < 2) return null;
  const auditPreviewFromRead = client.auditPreviewFromRead;
  let batchRead;
  try {
    batchRead = await client.batchRead(productIds);
  } catch {
    return null;
  }
  const results = isRecord(batchRead.results) ? batchRead.results : {};
  const readyItems: Array<{ productId: string; fields: Record<string, string>; audit?: RentalPriceAuditReference }> = [];
  const blocked: string[] = [];
  const outcomes = await mapConcurrent(productIds, BATCH_READ_AUDIT_CONCURRENCY, async (productId): Promise<BatchReadPricePreviewOutcome> => {
    const result = results[productId];
    if (!isRecord(result)) {
      return { status: 'blocked', message: `商品 ${productId}：批量读取失败` };
    }
    const status = readString(result.status);
    const fields = batchReadPricePreviewFields(result.values, input);
    if (Object.keys(fields).length === 0) {
      return { status: 'blocked', message: `商品 ${productId}：批量读取${status ? ` ${status}` : ''}，没有可改租金字段` };
    }
    let audit: RentalPriceAuditReference | undefined;
    try {
      const auditPreview = await auditPreviewFromRead(productId, result, fields, batchReadPricePreviewArtifact(result.values, input, fields));
      audit = compactAuditReference(auditPreview ?? undefined);
    } catch (error) {
      return { status: 'blocked', message: `商品 ${productId}：审计预览失败（${error instanceof Error ? error.message : String(error)}）` };
    }
    const auditBlockReason = rentalPriceExecutionAuditBlockReason(audit);
    if (auditBlockReason) {
      return { status: 'blocked', message: `商品 ${productId}：${auditBlockReason}` };
    }
    return { status: 'ready', item: { productId, fields, ...(audit ? { audit } : {}) } };
  });
  for (const outcome of outcomes) {
    if (outcome.status === 'ready') readyItems.push(outcome.item);
    else blocked.push(outcome.message);
  }
  return { readyItems, blocked };
}

function readProductIdArray(value: unknown, maxItems: number): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxItems) return null;
  const ids = value.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean);
  if (ids.length !== value.length || ids.some((id) => !/^\d+$/.test(id))) return null;
  return [...new Set(ids)];
}

function readRollbackTaskIdsArgument(value: unknown): string[] | null {
  return readTaskIdArray(value);
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
  const progressCard = buildRentalPricePreviewProgressCard(productIds, reason);

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
  if (!hasExplicitFields && explicitDiscount && parsedDiscount !== null && hasAmbiguousBarePriceNumber(reason)) {
    return {
      text: `${INVALID_DISCOUNT_ARGUMENT_MESSAGE}\n请明确写成“8折 / 0.8倍 / +8元 / -8元 / 价格改为8元”。`,
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
  if (!hasExplicitFields && adjustmentAmount !== null && productIds.length === 1 && !hasExplicitRentAdjustmentScope(reason)) {
    const text = ambiguousAmountScopeMessage(productIds, reason);
    return {
      text,
      progressCard,
      card: buildRentalPricePreviewTerminalCard({ title: '租赁改价需要确认范围', text }),
      metadata: { toolName: 'rental.pricePreview', ok: false, productIds, needsClarification: true },
    };
  }
  const scope = hasExplicitFields ? undefined : readPriceChangeScope(priceArgs.scope);

  const blocked: string[] = [];
  const readyItems: Array<{ productId: string; fields: Record<string, string>; audit?: RentalPriceAuditReference }> = [];
  const batchReadInput: { discount?: number; adjustmentAmount?: number } = {
    ...(discount !== undefined && discount !== null ? { discount } : {}),
    ...(adjustmentAmount !== undefined && adjustmentAmount !== null ? { adjustmentAmount } : {}),
  };
  const batchReadItems = !hasExplicitFields && (batchReadInput.discount !== undefined || batchReadInput.adjustmentAmount !== undefined)
    ? await batchReadPricePreviewItems(productIds, client, batchReadInput)
    : null;
  if (batchReadItems) {
    readyItems.push(...batchReadItems.readyItems);
    blocked.push(...batchReadItems.blocked);
  }

  for (const productId of batchReadItems ? [] : productIds) {
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
      const auditBlockReason = rentalPriceExecutionAuditBlockReason(audit);
      if (auditBlockReason) {
        blocked.push(`商品 ${productId}：${auditBlockReason}`);
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
      progressCard,
      card: buildRentalPricePreviewTerminalCard({ title: '租赁改价预览已阻断', text }),
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
    progressCard,
    card: buildAgentToolConfirmCard(confirmRequest, { requestRef, displayElements: buildPriceApplyConfirmDisplayElements(readyItems) }),
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
    at: new Date().toISOString(),
    ...(context.missionDate ? { partitionDate: context.missionDate } : {}),
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
  outputDir: string,
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
      const auditBlockReason = rentalPriceExecutionAuditBlockReason(item.audit);
      if (auditBlockReason) {
        results.push({ productId: item.productId, ok: false, lines: [auditBlockReason], audit: item.audit?.taskId || item.audit?.rollbackFile ? { ...(item.audit.taskId ? { taskId: item.audit.taskId } : {}), status: 'failed', ...(item.audit.rollbackFile ? { rollbackFile: item.audit.rollbackFile } : {}) } : undefined });
        continue;
      }
      await recordAgentToolWriteEvent(ledgerContext, 'execution_started', 'rental.priceApply', item.productId);
      const result = await client.execute(request);
      await recordAgentToolWriteEvent(ledgerContext, result.ok ? 'execution_succeeded' : 'execution_failed', 'rental.priceApply', item.productId);
      if (result.ok) {
        await recordPriceChangeObservationBestEffort(outputDir, item, result);
      }
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
    card: await buildPriceApplyCompletionCard(results, outputDir),
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

async function recordPriceChangeObservationBestEffort(
  outputDir: string,
  item: { productId: string; fields: Record<string, string>; audit?: RentalPriceAuditReference },
  result: RentalPriceExecutionResult,
): Promise<void> {
  try {
    await recordPriceChangeObservation(outputDir, {
      productId: item.productId,
      fields: item.fields,
      audit: {
        ...(result.audit?.taskId ? { taskId: result.audit.taskId } : item.audit?.taskId ? { taskId: item.audit.taskId } : {}),
        ...(item.audit?.changesFile ? { changesFile: item.audit.changesFile } : {}),
        ...(result.audit?.rollbackFile ? { rollbackFile: result.audit.rollbackFile } : item.audit?.rollbackFile ? { rollbackFile: item.audit.rollbackFile } : {}),
        ...(item.audit?.currentValuesFile ? { currentValuesFile: item.audit.currentValuesFile } : {}),
        ...(item.audit?.planHash ? { planHash: item.audit.planHash } : {}),
      },
    });
  } catch (error) {
    console.warn(`操作观察写入失败：rental.priceApply 商品 ${item.productId}：${error instanceof Error ? error.message : String(error)}`);
  }
}

function normalizeMatchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '');
}

function itemMatchesKeyword(title: string, keyword: string): boolean {
  const normalizedTitle = normalizeMatchText(title);
  const normalizedKeyword = normalizeMatchText(keyword);
  return Boolean(normalizedKeyword && normalizedTitle.includes(normalizedKeyword));
}

function queryHasExplicitProductIdentifier(query: string): boolean {
  return Boolean(
    parseInternalProductIdsQuery(query) ||
    parseExplicitInternalProductIdInText(query) ||
    parseExplicitPlatformProductIdInText(query) ||
    parseLeadingInternalProductIdActionQuery(query) ||
    parseLikelyPlatformProductIdInText(query),
  );
}

function readAbsoluteRentFields(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const fields: Record<string, string> = {};
  for (const [field, raw] of Object.entries(value)) {
    if (!isRentPriceField(field)) return null;
    if (typeof raw !== 'string' && typeof raw !== 'number') return null;
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return null;
    fields[field] = numeric.toFixed(2);
  }
  return Object.keys(fields).length ? fields : null;
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

async function rentalSpecKeywordPricePlanResponse(
  args: Record<string, unknown>,
  reason: string,
  client: RentalPriceSkillClient,
  outputDir: string,
  options: AgentToolExecutionOptions,
  continuation?: AgentToolConfirmRequest['continuation'],
): Promise<BotResponse> {
  const query = requireString(args.query, 'query');
  const keyword = requireString(args.keyword, 'keyword');
  const fields = readAbsoluteRentFields(args.fields);
  if (!fields) return { text: '按规格关键词改价参数无效：fields 只支持 rent*day 绝对租金字段。', metadata: { toolName: 'rental.specKeywordPricePlan', ok: false } };
  if (!client.read) return { text: '当前租赁改价客户端还没有接入只读价格读取能力，无法生成按规格关键词改价预览。', metadata: { toolName: 'rental.specKeywordPricePlan', ok: false } };
  if (!client.auditPreviewFromRead) return { text: '当前租赁改价客户端缺少审计预览能力，无法生成按规格关键词改价确认卡。', metadata: { toolName: 'rental.specKeywordPricePlan', ok: false } };

  const registryContext = await loadClosedOrderRegistryContext(options.closedOrderRegistryPaths);
  const registry = createLinkRegistry(registryContext.registry);
  const requestedResolutionMode = readLinkRegistryResolutionMode(args.resolutionMode);
  if (args.resolutionMode !== undefined && !requestedResolutionMode) {
    return { text: '按规格关键词改价参数无效：resolutionMode 只能是 single 或 sameSkuGroup。', metadata: { toolName: 'rental.specKeywordPricePlan', ok: false } };
  }
  const effectiveResolutionMode = requestedResolutionMode ?? (queryHasExplicitProductIdentifier(query) ? 'single' : 'sameSkuGroup');
  const resolution = resolveRentalPriceSnapshotEntries(query, registry, { expandSingleInternalIdToSameSkuGroup: effectiveResolutionMode === 'sameSkuGroup', allowMultipleInternalIds: true });
  if (!resolution.ok) return { text: resolution.text, metadata: { toolName: 'rental.specKeywordPricePlan', ok: false } };
  if (resolution.entries.length === 0) return { text: `链接维护档案已匹配到“${query}”，但没有可处理的未下架商品。`, metadata: { toolName: 'rental.specKeywordPricePlan', ok: false, productIds: [] } };
  if (resolution.entries.length > RENTAL_PRICE_PREVIEW_MAX_PRODUCTS) return { text: `“${query}”命中 ${resolution.entries.length} 个未下架商品，超过单次按规格关键词改价上限 ${RENTAL_PRICE_PREVIEW_MAX_PRODUCTS} 个。请缩小范围。`, metadata: { toolName: 'rental.specKeywordPricePlan', ok: false } };

  const readyItems: Array<{ productId: string; fields: Record<string, string>; audit?: RentalPriceAuditReference }> = [];
  const matchLines: string[] = [];
  const blocked: string[] = [];
  const unmatched: string[] = [];
  let matchedSpecCount = 0;

  for (const entry of resolution.entries) {
    const productId = entry.internalProductId;
    let current: RentalPriceReadResult;
    try {
      current = await client.read(productId);
    } catch (error) {
      blocked.push(`商品 ${productId}：读取失败，请检查本地租赁价服务日志。`);
      continue;
    }
    if (!current.ok) {
      blocked.push(`商品 ${productId}：读取失败，请检查本地租赁价服务日志。`);
      continue;
    }
    const matchedSpecs = current.specs.filter((spec) => itemMatchesKeyword(spec.title, keyword));
    if (matchedSpecs.length === 0) {
      unmatched.push(`商品 ${productId}：未命中包含「${keyword}」的规格项`);
      continue;
    }
    const specFields: PerSpecPriceFieldMap = {};
    for (const spec of matchedSpecs) specFields[spec.specId] = fields;
    let audit: RentalPriceAuditReference | undefined;
    try {
      audit = compactAuditReference(await client.auditPreviewFromRead(productId, { ...current }, fields, specFields) ?? undefined);
    } catch (error) {
      blocked.push(`商品 ${productId}：审计预览失败，请检查本地审计日志。`);
      continue;
    }
    const auditBlockReason = rentalPriceExecutionAuditBlockReason(audit);
    if (auditBlockReason) {
      blocked.push(`商品 ${productId}：${auditBlockReason}`);
      continue;
    }
    readyItems.push({ productId, fields, ...(audit ? { audit } : {}) });
    matchedSpecCount += matchedSpecs.length;
    matchLines.push(`- 商品 ${productId} ${compactName(entry)}：${matchedSpecs.map((spec) => `${spec.specId} ${spec.title}`).join('、')}`);
  }

  const header = [
    `按规格关键词改价预览：${query}`,
    resolution.sameSkuGroupId ? `同款组：${resolution.sameSkuGroupId}` : undefined,
    `匹配依据：${resolution.matchText}`,
    `关键词：${keyword}`,
    `目标价格：${Object.entries(fields).map(([field, value]) => `${field}=${value}`).join('，')}`,
    `命中规格：${matchedSpecCount} 个`,
  ].filter((line): line is string => Boolean(line));
  const text = [
    ...header,
    ...(matchLines.length ? ['', '命中明细：', ...matchLines] : []),
    ...(unmatched.length ? ['', '未命中链接：', ...unmatched.slice(0, 12)] : []),
    ...(blocked.length ? ['', '阻断项：', ...blocked.slice(0, 12)] : []),
  ].join('\n');
  if (blocked.length > 0 || readyItems.length === 0) {
    return { text, metadata: { toolName: 'rental.specKeywordPricePlan', ok: false, productIds: resolution.entries.map((entry) => entry.internalProductId), previewCount: readyItems.length } };
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
    card: buildAgentToolConfirmCard(confirmRequest, { requestRef, summaryLines: header, displayElements: buildPriceApplyConfirmDisplayElements(readyItems) }),
    metadata: { toolName: 'rental.specKeywordPricePlan', ok: true, productIds: resolution.entries.map((entry) => entry.internalProductId), previewCount: readyItems.length, matchedSpecCount },
  };
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

function readRefreshActivityWindowDays(value: unknown): number {
  if (value === undefined) return REFRESH_ACTIVITY_DEFAULT_WINDOW_DAYS;
  return readWindowDays(value);
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

function refreshActivityWindowSourceScore(metric: PublicTrafficPeriodMetrics): number {
  return (
    metric.shippedOrders * 1000
    + metric.amount * 2
    + metric.publicVisits * 5
    + metric.createdOrders * 50
    + Math.min(metric.exposure, 5000) * 0.1
  );
}

function adaptRefreshActivityLegacyZeroMetric(value: unknown): MetricThresholdCondition | null {
  if (value === undefined) return null;
  if (value === 'created_orders') return { metric: 'createdOrders', operator: 'eq', value: 0 };
  if (value === 'amount') return { metric: 'amount', operator: 'eq', value: 0 };
  throw new Error('zeroMetric must be created_orders or amount');
}

function readMetricThresholdCondition(value: unknown, fieldName: string): MetricThresholdCondition {
  if (!isRecord(value)) throw new Error(`${fieldName} item must be an object`);
  return {
    metric: readPublicTrafficMetric(value.metric),
    operator: readMetricThresholdOperator(value.operator),
    value: readRequiredNumber(value.value, `${fieldName}.value`),
  };
}

function readMetricThresholdConditions(value: unknown): MetricThresholdCondition[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 6) throw new Error('conditions must contain 1 to 6 conditions');
  return value.map((item) => readMetricThresholdCondition(item, 'conditions'));
}

function refreshActivityMetricFromWindowAggregate(aggregate: WindowProductAggregate, windowDays: number): PublicTrafficPeriodMetrics {
  const exposure = readWindowMetric(aggregate, 'exposure') ?? 0;
  const publicVisits = readWindowMetric(aggregate, 'publicVisits') ?? 0;
  const amount = readWindowMetric(aggregate, 'amount') ?? 0;
  const dashboardVisits = readWindowMetric(aggregate, 'dashboardVisits') ?? 0;
  const createdOrders = readWindowMetric(aggregate, 'createdOrders') ?? 0;
  const signedOrders = readWindowMetric(aggregate, 'signedOrders') ?? 0;
  const reviewedOrders = readWindowMetric(aggregate, 'reviewedOrders') ?? 0;
  const shippedOrders = readWindowMetric(aggregate, 'shippedOrders') ?? 0;
  const hasFullWindow = aggregate.availability.exposure.available && aggregate.availability.publicVisits.available && aggregate.availability.amount.available;
  const hasFullDashboardWindow = aggregate.availability.dashboardVisits.available && aggregate.availability.createdOrders.available && aggregate.availability.shippedOrders.available;
  return {
    exposure,
    publicVisits,
    dashboardVisits,
    createdOrders,
    signedOrders,
    reviewedOrders,
    shippedOrders,
    amount,
    exposureVisitRate: exposure > 0 ? publicVisits / exposure : 0,
    visitCreatedOrderRate: dashboardVisits > 0 ? createdOrders / dashboardVisits : 0,
    visitShipmentRate: dashboardVisits > 0 ? shippedOrders / dashboardVisits : 0,
    hasExposureData: hasFullWindow,
    hasDashboardData: hasFullDashboardWindow,
  };
}

function rowWithRefreshActivityWindowMetric(row: PublicTrafficProductDataRow, aggregate: WindowProductAggregate, windowDays: number): PublicTrafficProductDataRow {
  return {
    ...row,
    periods: {
      ...row.periods,
      '30d': refreshActivityMetricFromWindowAggregate(aggregate, windowDays),
    },
  };
}

interface RefreshActivityWindowAggregateIndex {
  byInternalProductId: Map<string, WindowProductAggregate>;
  byPlatformProductId: Map<string, WindowProductAggregate>;
}

function buildRefreshActivityWindowAggregateIndex(aggregates: WindowProductAggregate[]): RefreshActivityWindowAggregateIndex {
  const byInternalProductId = new Map<string, WindowProductAggregate>();
  const byPlatformProductId = new Map<string, WindowProductAggregate>();
  for (const aggregate of aggregates) {
    byInternalProductId.set(aggregate.internalProductId, aggregate);
    if (aggregate.platformProductId) byPlatformProductId.set(aggregate.platformProductId, aggregate);
  }
  return { byInternalProductId, byPlatformProductId };
}

function findRefreshActivityEntryByProductId(entries: LinkRegistryEntry[], productId: string): LinkRegistryEntry | undefined {
  return entries.find((entry) => entry.internalProductId === productId);
}

function formatRefreshActivitySkipLine(skipped: MetricThresholdStrategyResult['skipped'], conditions: MetricThresholdCondition[], windowDays: number): string {
  const sourceLabels = new Set(conditions.map((condition) => {
    const definition = getPublicTrafficMetric(condition.metric)!;
    return metricSourceLabel(definition.source);
  }));
  const missingLabel = sourceLabels.size === 1 ? `${[...sourceLabels][0]}缺失` : '指标数据缺失';
  return `跳过：非 active ${skipped.inactive} 条，无日报行 ${skipped.missingRow} 条，${windowDays}日${missingLabel} ${skipped.unavailableMetric} 条，上线不足 ${windowDays} 天 ${skipped.onlineLessThanRequired} 条，上线天数未知 ${skipped.onlineDaysUnknown} 条。`;
}

function metricThresholdInputFromRefreshActivityArgs(args: Record<string, unknown>, date: string, windowDays: number): MetricThresholdStrategyInput {
  const conditions = args.conditions === undefined
    ? (() => {
      const legacy = adaptRefreshActivityLegacyZeroMetric(args.zeroMetric);
      if (!legacy) throw new Error('conditions are required');
      return [legacy];
    })()
    : readMetricThresholdConditions(args.conditions);
  const firstCondition = conditions[0]!;
  return {
    ...(readString(args.query) ? { query: readString(args.query)! } : {}),
    ...(readString(args.sameSkuGroupId) ? { sameSkuGroupId: readString(args.sameSkuGroupId)! } : {}),
    metric: firstCondition.metric,
    operator: firstCondition.operator,
    value: firstCondition.value,
    conditions,
    date,
    windowDays,
    requireActive: true,
    requireOnlineDays: windowDays,
  };
}

function metricThresholdInputFromExplainArgs(args: Record<string, unknown>, date: string): MetricThresholdStrategyInput {
  const conditions = args.conditions === undefined ? null : readMetricThresholdConditions(args.conditions);
  const legacyMetric = args.metric;
  const legacyOperator = args.operator;
  const legacyValue = args.value;
  const hasLegacyTriple = legacyMetric !== undefined && legacyOperator !== undefined && legacyValue !== undefined;
  if (!conditions && !hasLegacyTriple) throw new Error('conditions or metric/operator/value are required');
  const resolvedConditions = conditions ?? [{
    metric: readPublicTrafficMetric(legacyMetric),
    operator: readMetricThresholdOperator(legacyOperator),
    value: readRequiredNumber(legacyValue, 'value'),
  }];
  const firstCondition = resolvedConditions[0]!;
  return {
    ...(readString(args.query) ? { query: readString(args.query)! } : {}),
    ...(readString(args.sameSkuGroupId) ? { sameSkuGroupId: readString(args.sameSkuGroupId)! } : {}),
    metric: firstCondition.metric,
    operator: firstCondition.operator,
    value: firstCondition.value,
    conditions: resolvedConditions,
    date,
    windowDays: readOptionalWindowDays(args.windowDays) ?? REFRESH_ACTIVITY_DEFAULT_WINDOW_DAYS,
    ...(args.requireActive !== undefined ? { requireActive: args.requireActive === true } : {}),
    ...(args.requireOnlineDays !== undefined ? { requireOnlineDays: readOptionalLimit(args.requireOnlineDays) ?? REFRESH_ACTIVITY_DEFAULT_WINDOW_DAYS } : {}),
  };
}

function buildRefreshActivityGroupPlans(
  groups: ReturnType<typeof groupRefreshActivityCandidates>,
  refillExecution: ReturnType<typeof buildRefreshActivityExecuteRequest>,
): NonNullable<RefreshActivityPlan['groupPlans']> {
  return groups.map((group) => {
    const newLinkItem = refillExecution.request?.newLinkItems.find((item) => item.sameSkuGroupId === group.sameSkuGroupId);
    const skippedGroup = `${group.label}｜${group.sameSkuGroupId}`;
    const blockers = refillExecution.skippedBlockers.filter((blocker, index) =>
      refillExecution.skippedGroups[index] === skippedGroup || refillExecution.skippedGroups[index] === group.label);
    return {
      sameSkuGroupId: group.sameSkuGroupId,
      label: group.label,
      delistProductIds: group.items.map((item) => item.entry.internalProductId),
      delistCount: group.items.length,
      refillCount: newLinkItem?.count ?? 0,
      ...(newLinkItem ? { sourceProductId: newLinkItem.sourceProductId, sourceProductName: newLinkItem.sourceProductName } : {}),
      blockers,
    };
  });
}

function findRefreshActivityWindowAggregate(index: RefreshActivityWindowAggregateIndex, entry: LinkRegistryEntry): WindowProductAggregate | undefined {
  return index.byInternalProductId.get(entry.internalProductId)
    ?? (entry.platformProductId ? index.byPlatformProductId.get(entry.platformProductId) : undefined);
}

function findRefreshActivityWindowAggregateForRow(index: RefreshActivityWindowAggregateIndex, row: PublicTrafficProductDataRow): WindowProductAggregate | undefined {
  const internalProductId = extractInternalProductId(row.displayProductId);
  return (internalProductId ? index.byInternalProductId.get(internalProductId) : undefined)
    ?? index.byPlatformProductId.get(row.platformProductId);
}

function contextWithRefreshActivityWindowMetrics(context: PublicTrafficDataReportContext, index: RefreshActivityWindowAggregateIndex, windowDays: number): PublicTrafficDataReportContext {
  return {
    ...context,
    rows: context.rows.map((row) => {
      const aggregate = findRefreshActivityWindowAggregateForRow(index, row);
      if (aggregate) return rowWithRefreshActivityWindowMetric(row, aggregate, windowDays);
      return {
        ...row,
        periods: {
          ...row.periods,
          '30d': { ...row.periods['30d'], hasDashboardData: false },
        },
      };
    }),
  };
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
  windowMetrics?: RefreshActivityWindowAggregateIndex,
  windowDays = REFRESH_ACTIVITY_DEFAULT_WINDOW_DAYS,
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
        if (!row) return null;
        const aggregate = windowMetrics ? findRefreshActivityWindowAggregate(windowMetrics, entry) : undefined;
        if (windowMetrics && !aggregate) return null;
        const scoreRow = aggregate ? rowWithRefreshActivityWindowMetric(row, aggregate, windowDays) : row;
        const score = aggregate ? refreshActivityWindowSourceScore(scoreRow.periods['30d']) : refreshActivitySourceScore(scoreRow);
        return { entry, row: scoreRow, score };
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
  windowMetrics?: RefreshActivityWindowAggregateIndex,
  windowDays = REFRESH_ACTIVITY_DEFAULT_WINDOW_DAYS,
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

  const newLinks = buildRefreshActivityNewLinkItems(groups, context, registryEntries, new Set(delistProductIds), windowMetrics, windowDays);
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
  ledgerContext?: RentalWriteLedgerContext,
): Promise<BotResponse> {
  const productIds = readDelistProductIds(args);
  if (!productIds) {
    return {
      text: `批量下架参数无效：请提供 1 到 ${RENTAL_DELIST_BATCH_MAX_PRODUCTS} 个端内ID。`,
      metadata: { toolName, ok: false },
    };
  }

  const results: Awaited<ReturnType<RentalPriceSkillClient['delist']>>[] = [];
  const auditWarnings: string[] = [];
  for (const productId of productIds) {
    try {
      const result = await client.delist(productId);
      results.push(result);
      if (result.ok) {
        const warning = await recordSuccessfulRentalDelistEventBestEffort(ledgerContext, toolName, result.productId);
        if (warning && auditWarnings.length < RENTAL_DELIST_MAX_AUDIT_WARNINGS) auditWarnings.push(warning);
      }
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
      auditWarnings.length ? `审计警告：${auditWarnings.join('；')}` : undefined,
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
      ...(auditWarnings.length ? { auditWarnings } : {}),
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
  const windowDays = readRefreshActivityWindowDays(args.windowDays);
  const input = metricThresholdInputFromRefreshActivityArgs(args, report.context.date, windowDays);
  const definition = getPublicTrafficMetric(input.metric)!;
  const unauthorizedCondition = input.conditions?.find((condition) => !getPublicTrafficMetric(condition.metric)?.executableDelistAllowed);
  const unauthorizedDefinition = unauthorizedCondition ? getPublicTrafficMetric(unauthorizedCondition.metric)! : undefined;
  const conditions = input.conditions ?? [{ metric: input.metric, operator: input.operator, value: input.value }];
  const completenessText = metricThresholdCompletenessText(conditions);
  const scoped = scopedRefreshActivityEntries(args, registryContext.registry);
  if ('text' in scoped) return { text: scoped.text, metadata: { toolName: 'operations.refreshActivityPlan', ok: false } };

  const [strategyResult, aggregates] = await Promise.all([
    evaluateMetricThresholdStrategy(outputDir, registryContext.registry, input),
    aggregateWindowProducts({ outputDir, endDate: report.context.date, windowDays }),
  ]);
  const windowMetrics = buildRefreshActivityWindowAggregateIndex(aggregates);
  const candidates = strategyResult.candidateProductIds
    .map((productId) => {
      const entry = findRefreshActivityEntryByProductId(scoped.entries, productId);
      if (!entry) return null;
      const row = findReportRowForEntry(report.context, entry);
      const aggregate = findRefreshActivityWindowAggregate(windowMetrics, entry);
      if (!row || !aggregate) return null;
      return { entry, row: rowWithRefreshActivityWindowMetric(row, aggregate, windowDays) };
    })
    .filter((item): item is { entry: LinkRegistryEntry; row: PublicTrafficProductDataRow } => Boolean(item));
  const conditionSummary = strategyResult.conditionSummary ?? formatMetricThresholdCondition(input);

  if (unauthorizedCondition && unauthorizedDefinition) {
    return {
      text: [
        `活跃度刷新计划：${report.context.date}`,
        scoped.scopeLine,
        `筛选口径：active 链接，${conditionSummary}，${completenessText}，上线满 ${windowDays} 天（上线满${windowDays}天）。`,
        `${unauthorizedDefinition.label}可以查询和分析，但暂未授权作为自动下架条件。请改为人工复核，或选择已授权的下架指标。`,
        ...strategyResult.reasonSummary,
        formatRefreshActivitySkipLine(strategyResult.skipped, conditions, windowDays),
      ].filter((line): line is string => Boolean(line)).join('\n'),
      metadata: {
        toolName: 'operations.refreshActivityPlan',
        status: 'explanation_only',
        date: report.context.date,
        metric: unauthorizedCondition.metric,
        metricLabel: unauthorizedDefinition.label,
        operator: unauthorizedCondition.operator,
        value: unauthorizedCondition.value,
        conditions: strategyResult.conditions,
        conditionSummary,
        availability: strategyResult.availability,
        windowDays,
        candidateCount: strategyResult.candidateProductIds.length,
        skipped: {
          inactive: strategyResult.skipped.inactive,
          missingRow: strategyResult.skipped.missingRow,
          missing30dDashboard: strategyResult.skipped.unavailableMetric,
          onlineLessThan30d: strategyResult.skipped.onlineLessThanRequired,
          onlineDaysUnknown: strategyResult.skipped.onlineDaysUnknown,
        },
        scope: scoped.scopeLine ?? null,
        candidateProductIds: strategyResult.candidateProductIds,
        skippedReasons: strategyResult.reasonSummary,
      },
    };
  }

  const groups = groupRefreshActivityCandidates(candidates);
  const zeroCandidateExplanation = candidates.length === 0
    ? [
      '0 候选解释：',
      ...strategyResult.reasonSummary.map((line) => `- 策略说明：${line}`),
      `- 数据健康：${(await buildDataHealthReport(outputDir, report.context.date)).dataQualityNotes.join('；') || '无额外质量备注'}`,
    ]
    : [];
  const shownCandidates = candidates
    .sort((left, right) =>
      left.row.periods['30d'].publicVisits - right.row.periods['30d'].publicVisits
      || left.row.periods['30d'].exposure - right.row.periods['30d'].exposure
      || Number(left.entry.internalProductId) - Number(right.entry.internalProductId))
    .slice(0, maxCandidates);
  const shownGroups = groupRefreshActivityCandidates(shownCandidates);
  const delistOnlyExecution = buildRefreshActivityExecuteRequest(report.context.date, shownGroups, report.context, registryContext.registry, 'delist_only', windowMetrics, windowDays);
  const refillExecution = buildRefreshActivityExecuteRequest(report.context.date, shownGroups, report.context, registryContext.registry, 'delist_and_refill', windowMetrics, windowDays);
  const groupPlans = buildRefreshActivityGroupPlans(shownGroups, refillExecution);
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
    conditions: strategyResult.conditions ?? input.conditions,
    conditionSummary,
    groupPlans,
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
      `筛选口径：active 链接，${conditionSummary}，${completenessText}，上线满 ${windowDays} 天（上线满${windowDays}天）。`,
      `待下架候选：${candidates.length} 条；涉及种类/同款组 ${groups.length} 个。`,
      `本次展示：${shownCandidates.length}/${candidates.length} 条。`,
      '',
      ...(groupLines.length ? groupLines : [`没有找到符合条件的${conditionSummary} active 链接。`]),
      ...strategyResult.reasonSummary,
      ...(zeroCandidateExplanation.length ? ['', ...zeroCandidateExplanation] : []),
      '',
      formatRefreshActivitySkipLine(strategyResult.skipped, conditions, windowDays),
      delistOnlyExecution.request
        ? `计划已生成，请在策略卡选择执行策略（待下架 ${delistOnlyExecution.request.delistProductIds.length} 条：端内ID ${delistOnlyExecution.request.delistProductIds.join('、')}）。`
        : '未能生成执行计划；请先处理以下阻断项。',
      ...(refillExecution.skippedBlockers.length ? [`已跳过 blocker：${refillExecution.skippedGroups.join('、')}`] : []),
      ...(!delistOnlyExecution.request && delistOnlyExecution.blockers.length ? ['', ...delistOnlyExecution.blockers.map((blocker) => `- ${blocker}`)] : []),
    ].join('\n'),
    metadata: {
      toolName: 'operations.refreshActivityPlan',
      date: report.context.date,
      endDate: report.context.date,
      candidateCount: candidates.length,
      shownCandidateCount: shownCandidates.length,
      productIds: candidates.map((candidate) => candidate.entry.internalProductId),
      availability: strategyResult.availability ?? { unavailableMetricProductIds: strategyResult.unavailableMetricProductIds, unavailableMetricCount: strategyResult.skipped.unavailableMetric },
      skipped: {
        inactive: strategyResult.skipped.inactive,
        missingRow: strategyResult.skipped.missingRow,
        missing30dDashboard: strategyResult.skipped.unavailableMetric,
        onlineLessThan30d: strategyResult.skipped.onlineLessThanRequired,
        onlineDaysUnknown: strategyResult.skipped.onlineDaysUnknown,
      },
      scope: scoped.scopeLine ?? null,
      metric: input.metric,
      metricLabel: definition.label,
      operator: input.operator,
      value: input.value,
      conditions: strategyResult.conditions,
      conditionSummary,
      windowDays,
      executeRequest: null,
      strategyRequests: { delistOnly: delistOnlyExecution.request ?? null, delistAndRefill: refillExecution.request ?? null },
      blockers: [...delistOnlyExecution.blockers, ...refillExecution.blockers],
      skippedGroups: refillExecution.skippedGroups,
      groupPlans,
      zeroCandidateExplanation,
      ...(args.zeroMetric !== undefined ? { legacyArgumentAdapted: true } : {}),
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
  const auditWarnings: string[] = [];
  for (const productId of request.delistProductIds) {
    await recordAgentToolWriteEvent(ledgerContext, 'execution_started', 'operations.refreshActivityExecute', productId);
    let result;
    try {
      result = await client.delist(productId);
    } catch (error) {
      try {
        await recordAgentToolWriteEvent(ledgerContext, 'execution_failed', 'operations.refreshActivityExecute', productId);
      } catch (ledgerError) {
        console.warn('Failed to record refresh activity delist failure event.', ledgerError);
      }
      throw error;
    }
    if (result.ok) {
      const warning = await recordSuccessfulRentalDelistEventBestEffort(ledgerContext, 'operations.refreshActivityExecute', result.productId);
      if (warning && auditWarnings.length < RENTAL_DELIST_MAX_AUDIT_WARNINGS) auditWarnings.push(warning);
    } else {
      try {
        await recordAgentToolWriteEvent(ledgerContext, 'execution_failed', 'operations.refreshActivityExecute', result.productId);
      } catch (ledgerError) {
        console.warn('Failed to record refresh activity delist failure event.', ledgerError);
      }
    }
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

  let auditPath: string | null = null;
  try {
    auditPath = await writeRefreshActivityAudit(outputDir, {
      request,
      delistResults,
      skippedMissingDelistProductIds: skippedMissingDelist.map((result) => result.productId),
      blockingDelistFailureProductIds: blockingDelistFailures.map((result) => result.productId),
      newLinkResult,
      ok: overallOk,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    if (auditWarnings.length < RENTAL_DELIST_MAX_AUDIT_WARNINGS) {
      auditWarnings.push(`活跃度刷新审计文件写入失败（${error instanceof Error ? error.message : String(error)}）`);
    }
  }

  const typeLines = request.newLinkItems.map((item, index) =>
    `${index + 1}. ${item.keyword}${item.sameSkuGroupId ? `｜${item.sameSkuGroupId}` : ''}：下架/补链 ${item.count} 条，补链源 ${item.sourceProductId} ${item.sourceProductName}`);
  const delistLines = delistResults.map((result) => `- ${result.ok ? '成功' : '失败'}：商品 ${result.productId}${result.lines.length ? `｜${result.lines.join('；')}` : ''}`);
  return appendRentalDelistAuditWarnings({
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
      ...(auditPath ? [`审计文件：${auditPath}`] : []),
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
  }, auditWarnings);
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

function readInactiveRefreshExecuteArgs(args: Record<string, unknown>): { planRef: string; confirmationKey: string } {
  const { planRef, confirmationKey } = args;
  if (typeof planRef !== 'string' || !planRef) throw new Error('planRef is required');
  if (typeof confirmationKey !== 'string' || !confirmationKey) throw new Error('confirmationKey is required');
  return { planRef, confirmationKey };
}

async function inactiveRefreshPlanResponse(outputDir: string, args: Record<string, unknown>, options: AgentToolExecutionOptions): Promise<BotResponse> {
  const date = typeof args.date === 'string' ? args.date : (await findLatestReportContext(outputDir))?.context.date;
  if (!date) return { text: '还没有找到公域日报上下文。', metadata: { toolName: 'operations.inactiveRefreshPlan', ok: false } };
  const registryContext = await loadClosedOrderRegistryContext(options.closedOrderRegistryPaths);
  const result = await buildInactiveRefreshPlan({ outputDir, date, registryEntries: registryContext.registry });
  if (!result.plan) {
    return {
      text: [`失活刷新计划：${date}`, '没有可执行失活刷新项。', ...result.lines].join('\n'),
      metadata: { toolName: 'operations.inactiveRefreshPlan', ok: true, executableCount: 0, summary: result.summary },
    };
  }
  const planRef = await saveInactiveRefreshPlan(outputDir, result.plan);
  return {
    text: `失活刷新计划已生成：${date}，可执行 ${result.plan.executableCount} 条。`,
    card: buildInactiveRefreshPlanCard({ plan: result.plan, planRef, summary: result.summary, lines: result.lines }),
    metadata: { toolName: 'operations.inactiveRefreshPlan', ok: true, executableCount: result.plan.executableCount, planRef, summary: result.summary },
  };
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
      if (!report) return { text: missingReportContextText(date) };
      const text = formatLatestSummary(report.context);
      return { text, card: buildQueryTextCard(report.context, text, { template: 'blue' }), metadata: { cardMode: 'nonBlocking' } };
    }
    case 'publicTraffic.conversionSummary': {
      const date = readOptionalDate(request.arguments.date);
      const report = await findReportContextForTool(outputDir, date);
      if (!report) return { text: missingReportContextText(date) };
      const text = formatConversionSummary(report.context);
      return { text, card: buildQueryTextCard(report.context, text, { template: 'blue' }), metadata: { cardMode: 'nonBlocking' } };
    }
    case 'publicTraffic.reportQuery': {
      const date = readOptionalDate(request.arguments.date);
      const report = await findReportContextForTool(outputDir, date);
      if (request.arguments.target === 'dateComparison') {
        if (!report) return { text: missingReportContextText(date) };
        const compareDate = comparisonReportDate(report.context.date, request.arguments);
        const compareReport = await findReportContextForTool(outputDir, compareDate);
        if (compareReport) {
          const text = runPublicTrafficReportDateComparison(report.context, compareReport.context, { ...request.arguments, ...(date ? { date } : {}), compareDate } as PublicTrafficReportQueryArguments);
          return { text, card: buildQueryTextCard(report.context, text, { template: 'blue' }), metadata: { cardMode: 'nonBlocking' } };
        }
        return {
          text: missingReportContextText(compareDate),
        };
      }
      const text = report
        ? runPublicTrafficReportQuery(report.context, { ...request.arguments, ...(date ? { date } : {}) } as PublicTrafficReportQueryArguments)
        : missingReportContextText(date);
      const cardTargets = new Set(['summary', 'comparison', 'productAggregation', 'orders', 'orderDerived', 'dataQuality', 'conclusions']);
      return report && cardTargets.has(String(request.arguments.target)) ? { text, card: buildQueryTextCard(report.context, text, { template: 'blue' }), metadata: { cardMode: 'nonBlocking' } } : { text };
    }
    case 'productLink.query': {
      const date = readOptionalDate(request.arguments.date);
      const report = await findReportContextForTool(outputDir, date);
      if (!report) return { text: missingReportContextText(date) };
      return runProductLinkQuery(report.context, { ...request.arguments, ...(date ? { date } : {}) } as ProductLinkQueryArguments).response;
    }
    case 'product.query': {
      const date = readOptionalDate(request.arguments.date);
      const report = await findReportContextForTool(outputDir, date);
      const keyword = requireString(request.arguments.keyword, 'keyword');
      if (report) {
        const unified = runProductLinkQuery(report.context, {
          queryType: parseNumericProductIdList(keyword).length > 1 ? 'productList' : 'productDetail',
          productQuery: keyword,
          ...(date ? { date } : {}),
        });
        if (unified.result && (unified.result.matches.length > 0 || unified.result.ambiguous.length > 0)) return unified.response;
      }
      if (!report && date) return { text: missingReportContextText(date) };
      const productIds = parseNumericProductIdList(keyword);
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
        metric: readOptionalPublicTrafficMetric(request.arguments.metric),
      }, options);
    }
    case 'product.rankByCategory': {
      const periodDays = readBoundedDays(request.arguments.periodDays, 'periodDays');
      const metric = readPublicTrafficMetric(request.arguments.metric);
      const registryContext = await loadClosedOrderRegistryContext(options.closedOrderRegistryPaths);
      if ((periodDays === 1 || periodDays === 7 || periodDays === 30) && isFixedCategoryMetric(metric)) {
        const report = await findReportContextForTool(outputDir, readOptionalDate(request.arguments.date));
        if (!report) return { text: missingReportContextText(readOptionalDate(request.arguments.date)) };
        const result = rankProductsByCategory(report.context, registryContext.registry, {
          ...(typeof request.arguments.category === 'string' ? { category: request.arguments.category } : {}),
          metric,
          periodDays: readPeriodDays(request.arguments.periodDays),
          limit: readOptionalLimit(request.arguments.limit),
        });
        return formatCategoryRankingResponse(result);
      }
      const explicitEndDate = readOptionalDate(request.arguments.endDate ?? request.arguments.date);
      const latest = explicitEndDate ? null : await findLatestReportContext(outputDir);
      const endDate = explicitEndDate ?? latest?.context.date;
      if (!endDate) return { text: '还没有找到公域日报上下文。' };
      const result = await rankProductsByCategoryWindowed(outputDir, registryContext.registry, {
        ...(typeof request.arguments.category === 'string' ? { category: request.arguments.category } : {}),
        metric,
        periodDays,
        endDate,
        limit: readOptionalLimit(request.arguments.limit),
      });
      return formatWindowCategoryRankingResponse(result);
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
      const windowDays = readOptionalWindowDays(request.arguments.windowDays);
      if (!windowDays) throw new Error('windowDays is required');
      const explicitEndDate = readOptionalDate(request.arguments.endDate ?? request.arguments.date);
      const latest = explicitEndDate ? null : await findLatestReportContext(outputDir);
      const endDate = explicitEndDate ?? latest?.context.date;
      if (!endDate) return { text: '还没有找到公域日报上下文。' };
      const result = await aggregateWindowProducts({ outputDir, endDate, windowDays });
      return formatWindowAggregateResponse(result, endDate, windowDays);
    }
    case 'publicTraffic.windowQuery': {
      const windowDays = readWindowDays(request.arguments.windowDays);
      const explicitEndDate = readOptionalDate(request.arguments.endDate ?? request.arguments.date);
      const latest = explicitEndDate ? null : await findLatestReportContext(outputDir);
      const endDate = explicitEndDate ?? latest?.context.date;
      if (!endDate) return { text: '还没有找到公域日报上下文。' };
      const registryContext = await loadClosedOrderRegistryContext(options.closedOrderRegistryPaths);
      return formatWindowQueryResponse(await queryPublicTrafficWindow(outputDir, { ...request.arguments, endDate, windowDays }, registryContext.registry));
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
    case 'strategy.metricThresholdExplain': {
      const explicitDate = readOptionalDate(request.arguments.date);
      const latest = explicitDate ? null : await findLatestReportContext(outputDir);
      const endDate = explicitDate ?? latest?.context.date;
      if (!endDate) return { text: '还没有找到公域日报上下文。' };
      const registryContext = await loadClosedOrderRegistryContext(options.closedOrderRegistryPaths);
      const input = metricThresholdInputFromExplainArgs(request.arguments, endDate);
      return formatMetricThresholdExplainResponse(await evaluateMetricThresholdStrategy(outputDir, registryContext.registry, input), input, 'strategy.metricThresholdExplain');
    }
    case 'strategy.refreshCandidateExplain': {
      const explicitDate = readOptionalDate(request.arguments.date);
      const latest = explicitDate ? null : await findLatestReportContext(outputDir);
      const endDate = explicitDate ?? latest?.context.date;
      if (!endDate) return { text: '还没有找到公域日报上下文。' };
      const registryContext = await loadClosedOrderRegistryContext(options.closedOrderRegistryPaths);
      const legacyInput = adaptLegacyRefreshCandidateExplainInput({
        ...(readString(request.arguments.query) ? { query: readString(request.arguments.query)! } : {}),
        ...(readString(request.arguments.sameSkuGroupId) ? { sameSkuGroupId: readString(request.arguments.sameSkuGroupId)! } : {}),
        zeroMetric: request.arguments.zeroMetric === 'created_orders' || request.arguments.zeroMetric === 'amount' ? request.arguments.zeroMetric : undefined,
        date: endDate,
        ...(request.arguments.windowDays !== undefined ? { windowDays: readRefreshActivityWindowDays(request.arguments.windowDays) } : {}),
      });
      const input: MetricThresholdStrategyInput = {
        ...legacyInput,
        windowDays: legacyInput.windowDays ?? REFRESH_ACTIVITY_DEFAULT_WINDOW_DAYS,
        requireActive: true,
        requireOnlineDays: legacyInput.windowDays ?? REFRESH_ACTIVITY_DEFAULT_WINDOW_DAYS,
      };
      if (request.arguments.windowDays === undefined) {
        const report = await findReportContextForTool(outputDir, explicitDate);
        if (!report) return { text: missingReportContextText(explicitDate) };
        const result = explainRefreshCandidates(registryContext.registry, report.context, legacyInput);
        return formatMetricThresholdExplainResponse(metricThresholdResultFromRefreshExplain(result), input, 'strategy.refreshCandidateExplain', result.sameSkuGroupId);
      }
      return formatMetricThresholdExplainResponse(await evaluateMetricThresholdStrategy(outputDir, registryContext.registry, input), input, 'strategy.refreshCandidateExplain');
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
        text: formatDashboardRefreshResultText(result),
        card: buildDashboardRefreshResultCard(result),
        metadata: {
          toolName: 'publicTraffic.refreshDashboard',
          ok: true,
          status: result.status,
          dataDate: result.dataDate,
          actualPageDate: result.actualPageDate,
          rawLocation: result.rawLocation,
          rebuild: result.rebuild,
          resend: result.resend,
        },
      };
    }
    case 'operations.refreshActivityPlan':
      return refreshActivityPlanResponse(outputDir, request.arguments, options, request.continuation);
    case 'operations.refreshActivityExecute':
      return refreshActivityExecuteResponse(outputDir, request.arguments, options.rentalPriceClient ?? createRentalPriceSkillClient(), options.ledgerContext);
    case 'operations.inactiveRefreshPlan':
      return inactiveRefreshPlanResponse(outputDir, request.arguments, options);
    case 'operations.inactiveRefreshExecute': {
      const { planRef, confirmationKey } = readInactiveRefreshExecuteArgs(request.arguments);
      return executeInactiveRefreshPlan({ outputDir, planRef, confirmationKey, client: options.rentalPriceClient ?? createRentalPriceSkillClient(), ledgerContext: options.ledgerContext });
    }
    case 'rental.daemonStatus':
    case 'rental.platformSearch':
    case 'rental.platformSearchAll':
    case 'rental.batchRead':
    case 'rental.specDiscoverFull':
    case 'rental.readRaw':
      return executeRentalReadOnlyOperationHandler(request, options.rentalPriceClient ?? createRentalPriceSkillClient());
    case 'rental.imageRead':
    case 'rental.imageUpload':
    case 'rental.imagePick':
    case 'rental.imageOrder':
    case 'rental.whiteImageSet':
    case 'rental.imageVerify':
      return executeRentalImageTool(request, options.rentalPriceClient);
    case 'rental.vasRead':
    case 'rental.vasCatalogRead':
    case 'rental.vasApply':
    case 'rental.vasVerify':
      return executeRentalVasTool(request, options.rentalPriceClient);
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
        return rentalDelistBatchResponse(request.arguments, options.rentalPriceClient ?? createRentalPriceSkillClient(), request.toolName, options.ledgerContext);
      }
      return executeRentalWriteOperationHandler(request, options.rentalPriceClient ?? createRentalPriceSkillClient(), options.ledgerContext);
    }
    case 'rental.delistBatch':
      return rentalDelistBatchResponse(request.arguments, options.rentalPriceClient ?? createRentalPriceSkillClient(), request.toolName, options.ledgerContext);
    case 'rental.specRemovePlan': {
      const query = requireString(request.arguments.query, 'query');
      const keyword = requireString(request.arguments.keyword, 'keyword');
      return rentalSpecRemovePlanResponse(query, keyword, request.reason, options.rentalPriceClient ?? createRentalPriceSkillClient(), options, request.continuation);
    }
    case 'rental.specKeywordPricePlan':
      return rentalSpecKeywordPricePlanResponse(request.arguments, request.reason, options.rentalPriceClient ?? createRentalPriceSkillClient(), outputDir, options, request.continuation);
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
      const previewArguments = rentalRequest.mode === 'explicit_fields'
        ? { productIds: [rentalRequest.productId], fields: rentalRequest.fields }
        : rentalRequest.mode === 'global_discount'
          ? { productIds: [rentalRequest.productId], discount: rentalRequest.discount, scope: rentalRequest.scope }
          : { productIds: [rentalRequest.productId], adjustmentAmount: rentalRequest.adjustmentAmount, scope: rentalRequest.scope };
      return rentalPricePreviewResponse(previewArguments, request.reason, options.rentalPriceClient ?? createRentalPriceSkillClient(), outputDir, request.continuation);
    }
    case 'rental.pricePreview':
      return rentalPricePreviewResponse(request.arguments, request.reason, options.rentalPriceClient ?? createRentalPriceSkillClient(), outputDir, request.continuation);
    case 'rental.priceApply':
      return rentalPriceApplyResponse(request.arguments, options.rentalPriceClient ?? createRentalPriceSkillClient(), outputDir, options.ledgerContext);
    case 'rental.bulkPricePlan':
      return rentalBulkPricePlanResponse(request.arguments, request.reason, options.rentalPriceClient ?? createRentalPriceSkillClient(), outputDir, request.continuation);
    case 'rental.bulkPriceApply':
      return rentalBulkPriceApplyResponse(request.arguments, options.rentalPriceClient ?? createRentalPriceSkillClient(), outputDir, options.ledgerContext);
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
      if (!rollbackRequest?.taskId) throw new Error('租赁商品改价回滚参数无效，请提供带完整审计记录的 taskId；productId 可选。');
      const client = options.rentalPriceClient ?? createRentalPriceSkillClient();
      if (!client.rollback) throw new Error('当前租赁改价客户端不支持回滚。');
      const result = await client.rollback(rollbackRequest);
      return { text: `${result.ok ? '改价回滚成功' : '改价回滚失败'}：商品 ${result.productId}\n${result.lines.join('\n')}`, metadata: { toolName: 'rental.priceRollback', ok: result.ok, productId: result.productId, taskId: result.audit?.taskId, rollbackFile: result.audit?.rollbackFile } };
    }
    case 'rental.priceRollbackBatch': {
      const taskIds = readRollbackTaskIdsArgument(request.arguments.taskIds);
      if (!taskIds) throw new Error('批量改价回滚参数无效，请提供 1 到 60 个 taskId。');
      const client = options.rentalPriceClient ?? createRentalPriceSkillClient();
      if (!client.rollback) throw new Error('当前租赁改价客户端不支持回滚。');
      const results = [];
      for (const taskId of taskIds) {
        try {
          results.push(await client.rollback({ taskId }));
        } catch (error) {
          results.push({ productId: 'unknown', ok: false, lines: [error instanceof Error ? error.message : String(error)], audit: { taskId, status: 'rollback_failed' as const } });
        }
      }
      const success = results.filter((result) => result.ok);
      const lines = results.flatMap((result, index) => [
        `${index + 1}. 任务 ${taskIds[index]} / 商品 ${result.productId}：${result.ok ? '成功' : '失败'}`,
        ...result.lines.slice(0, 8).map((line) => `   ${line}`),
      ]);
      return {
        text: [`批量改价回滚完成：成功 ${success.length}/${results.length}`, '', ...lines].join('\n'),
        metadata: {
          toolName: 'rental.priceRollbackBatch',
          ok: success.length === results.length,
          taskIds,
          productIds: results.map((result) => result.productId),
        },
      };
    }
    case 'rental.batchPreview':
    case 'rental.batchExecute':
    case 'rental.batchStatus':
    case 'rental.batchResume':
    case 'rental.batchReport':
    case 'rental.batchRollback':
    case 'rental.batchDelayedVerify':
      return executeRentalBatchTool(request.toolName, request.arguments, options.ledgerContext);
    case 'rental.mirrorSearch':
    case 'rental.mirrorBatchSpec':
    case 'rental.mirrorWritebackState':
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
