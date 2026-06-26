import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { buildAgentToolConfirmCard } from '../agentRuntime/approvalCard.js';
import { runPublicTrafficReportCli } from '../cli/publicTrafficReport.js';
import type { AgentToolConfirmRequest } from '../agentRuntime/approvalCard.js';
import { loadConfig } from '../config/loadConfig.js';
import { loadEnv } from '../config/loadEnv.js';
import { loadClosedOrderIngestState } from '../closedOrderFeedback/ingest.js';
import { buildClosedOrderObservationReport, writeClosedOrderObservationReportArtifacts } from '../closedOrderFeedback/observation.js';
import { loadClosedOrderRegistryContext, type ClosedOrderRegistryPathsInput } from '../closedOrderFeedback/runtime.js';
import type { AgentIntent, AgentProblemType } from '../agentData/types.js';
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
  createRentalPriceSkillClient,
  executeRentalOperationConfirmRequest,
  parseRentalOperationConfirmRequest,
  rentalPriceChangeRequestFromToolArguments,
  rentalPriceRollbackRequestFromToolArguments,
  type RentalOperationConfirmRequest,
  type RentalSpecRemoveItemConfirmRequest,
  type RentalPriceReadResult,
  type RentalPriceSkillClient,
} from './rentalPrice.js';
import { findReadOnlyTool } from './readOnlyToolRegistry.js';
import { findLatestReportContext, findReportContextByDate, formatLatestSummary, formatProductRows, parseNumericProductIdList, queryProductRows } from './reportStore.js';

export interface AgentToolExecutionOptions {
  rentalPriceClient?: RentalPriceSkillClient;
  closedOrderFetchImpl?: typeof fetch;
  closedOrderRegistryPaths?: ClosedOrderRegistryPathsInput;
}

let publicTrafficReportRunning = false;

const RENTAL_PRICE_SNAPSHOT_MAX_PRODUCTS = 20;
const RENTAL_SPEC_REMOVE_PLAN_MAX_PRODUCTS = 12;
const RENTAL_SPEC_REMOVE_PLAN_MAX_ITEMS = 20;
const REFRESH_ACTIVITY_DEFAULT_MAX_CANDIDATES = 20;
const REFRESH_ACTIVITY_EXECUTION_MAX_PRODUCTS = 20;
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

function formatLinkRegistryStatus(status: LinkRegistryEntry['status']): string {
  if (status === 'active') return '在架';
  if (status === 'removed') return '已下架';
  return '未知';
}

function formatRegistryProductRows(productIds: string[], entries: LinkRegistryEntry[]): string {
  const entryById = new Map(entries.map((entry) => [entry.internalProductId, entry]));
  return productIds.map((productId) => {
    const entry = entryById.get(productId);
    if (!entry) return `端内ID ${productId}\n未在链接档案中找到`;
    const name = entry.productName ?? entry.shortName ?? '未命名商品';
    const platform = entry.platformProductId ? `平台商品ID ${entry.platformProductId}` : '平台商品ID 未记录';
    return `端内ID ${entry.internalProductId} ${name}\n${platform}，状态 ${formatLinkRegistryStatus(entry.status)}`;
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

function queryableEntries(entries: LinkRegistryEntry[]): LinkRegistryEntry[] {
  return entries.filter((entry) => entry.status !== 'removed');
}

function resolveRentalPriceSnapshotEntries(
  query: string,
  registry: ReturnType<typeof createLinkRegistry>,
): { ok: true; sameSkuGroupId: string | null; entries: LinkRegistryEntry[]; matchText: string } | { ok: false; text: string } {
  const normalized = query.trim();
  if (!normalized) return { ok: false, text: '请提供要定位的商品、端内ID或同款组。' };

  if (/^\d+$/.test(normalized)) {
    const entry = registry.getByInternalId(normalized);
    if (!entry) return { ok: false, text: `链接维护档案未找到端内ID ${normalized}，无法定位商品组。` };
    const sameSkuGroupId = entry.sameSkuGroupId?.trim() ?? null;
    const entries = sameSkuGroupId ? queryableEntries(registry.listBySameSkuGroup(sameSkuGroupId, { includeUnknown: true })) : queryableEntries([entry]);
    return { ok: true, sameSkuGroupId, entries: entries.length ? entries : [entry], matchText: sameSkuGroupId ? `按端内ID ${normalized} 命中同款组 ${sameSkuGroupId}` : `按端内ID ${normalized} 查询单商品` };
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
  const shown = matches.slice(0, 12).map((item, index) => {
    const dimension = item.dimensionTitle ? `${item.dimensionTitle} / ` : '';
    const itemId = item.itemId ? `，itemId ${item.itemId}` : '';
    return `${index + 1}. 商品 ${item.productId}：${dimension}${item.itemTitle}（维度 ${item.specDimId}${itemId}）`;
  });
  return [
    `规格项删除计划：${query} / 关键词「${keyword}」`,
    resolution.sameSkuGroupId ? `同款组：${resolution.sameSkuGroupId}` : undefined,
    `匹配依据：${resolution.matchText}`,
    `命中规格项：${matches.length} 个`,
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
  const resolution = resolveRentalPriceSnapshotEntries(query, registry);
  if (!resolution.ok) return { text: resolution.text };
  if (resolution.entries.length === 0) return { text: `链接维护档案已匹配到“${query}”，但没有可处理的未下架商品。` };
  if (resolution.entries.length > RENTAL_SPEC_REMOVE_PLAN_MAX_PRODUCTS) {
    return { text: `“${query}”命中 ${resolution.entries.length} 个未下架商品，超过单次规格删除预览上限 ${RENTAL_SPEC_REMOVE_PLAN_MAX_PRODUCTS} 个。请补充更具体的端内ID或子分组。` };
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
}

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

function buildRefreshActivityNewLinkItems(
  groups: ReturnType<typeof groupRefreshActivityCandidates>,
  context: PublicTrafficDataReportContext,
  registryEntries: LinkRegistryEntry[],
  delistProductIds: Set<string>,
): { items: RefreshActivityNewLinkItem[]; blockers: string[] } {
  const items: RefreshActivityNewLinkItem[] = [];
  const blockers: string[] = [];

  for (const group of groups) {
    if (group.sameSkuGroupId === '未分组') {
      blockers.push(`${group.label} 没有同款组，无法安全选择补链源商品。`);
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
      blockers.push(`${group.label}｜${group.sameSkuGroupId} 没有可用的安全源商品；不会从即将下架的链接复制新链。`);
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

  return { items, blockers };
}

function buildRefreshActivityExecuteRequest(
  date: string,
  groups: ReturnType<typeof groupRefreshActivityCandidates>,
  context: PublicTrafficDataReportContext,
  registryEntries: LinkRegistryEntry[],
): { request?: RefreshActivityExecuteRequest; blockers: string[] } {
  const delistProductIds = groups.flatMap((group) => group.items.map((item) => item.entry.internalProductId));
  const blockers: string[] = [];
  if (delistProductIds.length === 0) blockers.push('没有待下架候选。');
  if (delistProductIds.length > REFRESH_ACTIVITY_EXECUTION_MAX_PRODUCTS) {
    blockers.push(`待下架候选 ${delistProductIds.length} 条超过单次执行上限 ${REFRESH_ACTIVITY_EXECUTION_MAX_PRODUCTS} 条，请缩小候选数量后再执行。`);
  }

  const newLinks = buildRefreshActivityNewLinkItems(groups, context, registryEntries, new Set(delistProductIds));
  blockers.push(...newLinks.blockers);

  if (blockers.length > 0) return { blockers };
  return {
    request: { date, delistProductIds, newLinkItems: newLinks.items },
    blockers,
  };
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
  return {
    date,
    delistProductIds: readStringArray(args.delistProductIds, 'delistProductIds', REFRESH_ACTIVITY_EXECUTION_MAX_PRODUCTS),
    newLinkItems: readRefreshActivityNewLinkItems(args.newLinkItems),
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

async function refreshActivityPlanResponse(outputDir: string, args: Record<string, unknown>, options: AgentToolExecutionOptions): Promise<BotResponse> {
  const date = readOptionalDate(args.date);
  const report = await findReportContextForTool(outputDir, date);
  if (!report) return { text: missingReportContextText(date) };
  const registryContext = await loadClosedOrderRegistryContext(options.closedOrderRegistryPaths);
  const maxCandidates = readMaxCandidates(args.maxCandidates);

  const candidates: Array<{ entry: LinkRegistryEntry; row: PublicTrafficProductDataRow }> = [];
  const skipped = { missingRow: 0, missing30dDashboard: 0, inactive: 0 };
  for (const entry of registryContext.registry) {
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
    if (thirty.createdOrders === 0) candidates.push({ entry, row });
  }

  const groups = groupRefreshActivityCandidates(candidates);
  const shownCandidates = candidates
    .sort((left, right) =>
      left.row.periods['30d'].publicVisits - right.row.periods['30d'].publicVisits
      || left.row.periods['30d'].exposure - right.row.periods['30d'].exposure
      || Number(left.entry.internalProductId) - Number(right.entry.internalProductId))
    .slice(0, maxCandidates);
  const shownGroups = groupRefreshActivityCandidates(shownCandidates);
  const execution = buildRefreshActivityExecuteRequest(report.context.date, shownGroups, report.context, registryContext.registry);
  const groupLines = shownGroups.slice(0, 12).map((group, index) => {
    const ids = group.items.map((item) => item.entry.internalProductId).join('、');
    const newLinkItem = execution.request?.newLinkItems.find((item) => item.sameSkuGroupId === group.sameSkuGroupId);
    const source = newLinkItem ? `；补链源 ${newLinkItem.sourceProductId} ${newLinkItem.sourceProductName}` : '';
    return `${index + 1}. ${group.label}｜${group.category}｜${group.sameSkuGroupId}：待下架 ${group.items.length} 条，建议补回 ${group.items.length} 条新链；端内ID ${ids}${source}`;
  });

  const confirmRequest = execution.request ? {
    toolName: 'operations.refreshActivityExecute',
    arguments: {
      date: execution.request.date,
      delistProductIds: execution.request.delistProductIds,
      newLinkItems: execution.request.newLinkItems,
    },
    reason: '用户要求刷新活跃度：先下架近30天零创单链接，再按同款组补回新链。',
  } : null;

  return {
    text: [
      `活跃度刷新计划：${report.context.date}`,
      '筛选口径：active 链接，30日访问页数据已抓取，近 30 天创单为 0。',
      `待下架候选：${candidates.length} 条；涉及种类/同款组 ${groups.length} 个。`,
      `本次展示：${shownCandidates.length}/${candidates.length} 条。`,
      '',
      ...(groupLines.length ? groupLines : ['没有找到符合条件的零创单 active 链接。']),
      '',
      `跳过：非 active ${skipped.inactive} 条，无日报行 ${skipped.missingRow} 条，30日访问页缺失 ${skipped.missing30dDashboard} 条。`,
      execution.request ? '已生成执行确认卡；确认前不会下架或补链。' : '未生成执行确认卡；请先处理以下阻断项。',
      ...(!execution.request && execution.blockers.length ? ['', ...execution.blockers.map((blocker) => `- ${blocker}`)] : []),
    ].join('\n'),
    ...(confirmRequest ? { card: buildAgentToolConfirmCard(confirmRequest) } : {}),
    metadata: {
      toolName: 'operations.refreshActivityPlan',
      date: report.context.date,
      candidateCount: candidates.length,
      shownCandidateCount: shownCandidates.length,
      executeRequest: execution.request ?? null,
      blockers: execution.blockers,
    },
  };
}

async function refreshActivityExecuteResponse(
  outputDir: string,
  args: Record<string, unknown>,
  client: RentalPriceSkillClient,
): Promise<BotResponse> {
  const request = readRefreshActivityExecuteRequest(args);
  const delistResults = [];
  for (const productId of request.delistProductIds) {
    const result = await client.delist(productId);
    delistResults.push(result);
    if (!result.ok) break;
  }

  const delistSuccess = delistResults.filter((result) => result.ok);
  const allDelisted = delistResults.length === request.delistProductIds.length && delistSuccess.length === request.delistProductIds.length;

  let newLinkResult: Awaited<ReturnType<typeof executeNewLinkBatchConfirmRequest>> | Awaited<ReturnType<typeof executeNewLinkBatchMultiConfirmRequest>> | null = null;
  if (allDelisted) {
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
  }

  const auditPath = await writeRefreshActivityAudit(outputDir, {
    request,
    delistResults,
    newLinkResult,
    ok: allDelisted && Boolean(newLinkResult?.ok),
    createdAt: new Date().toISOString(),
  });

  const typeLines = request.newLinkItems.map((item, index) =>
    `${index + 1}. ${item.keyword}${item.sameSkuGroupId ? `｜${item.sameSkuGroupId}` : ''}：下架/补链 ${item.count} 条，补链源 ${item.sourceProductId} ${item.sourceProductName}`);
  const delistLines = delistResults.map((result) => `- ${result.ok ? '成功' : '失败'}：商品 ${result.productId}${result.lines.length ? `｜${result.lines.join('；')}` : ''}`);
  return {
    text: [
      `${allDelisted && newLinkResult?.ok ? '活跃度刷新执行完成' : '活跃度刷新执行中断'}：${request.date}`,
      `下架：成功 ${delistSuccess.length}/${request.delistProductIds.length}`,
      `补链：${newLinkResult ? `${newLinkResult.ok ? '成功' : '失败'}，完成 ${newLinkResult.completedCount}/${request.newLinkItems.reduce((sum, item) => sum + item.count, 0)} 条` : '因下架未全部成功，已跳过'}`,
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
      newProductIds: newLinkResult?.newProductIds ?? [],
      ok: allDelisted && Boolean(newLinkResult?.ok),
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
  if (intent.type !== 'best_product_by_same_sku') return tool.run(latest.context, intent);

  const registryContext = await loadClosedOrderRegistryContext(options.closedOrderRegistryPaths);
  return tool.run(latest.context, intent, { linkRegistryStore: createLinkRegistry(registryContext.registry) });
}

function requireTenancyDays(value: unknown, fieldName: string): string {
  const parsed = requireString(value, fieldName);
  if (!/^\d+(?:,\d+)*$/.test(parsed)) throw new Error(`${fieldName} must be comma-separated day numbers`);
  return parsed;
}

function rentalAgentToolRequest(toolName: string, args: Record<string, unknown>): RentalOperationConfirmRequest | null {
  switch (toolName) {
    case 'rental.copy':
      return { action: 'copy', productId: requireProductId(args.productId, 'productId') };
    case 'rental.delist':
      return { action: 'delist', productId: requireProductId(args.productId, 'productId') };
    case 'rental.tenancySet':
      return {
        action: 'tenancy-set',
        productId: requireProductId(args.productId, 'productId'),
        days: requireTenancyDays(args.days, 'days'),
      };
    case 'rental.specDiscover':
      return { action: 'spec-discover', productId: requireProductId(args.productId, 'productId') };
    case 'rental.specAddAndRefresh':
      return {
        action: 'spec-add-and-refresh',
        productId: requireProductId(args.productId, 'productId'),
        itemTitle: requireString(args.itemTitle, 'itemTitle'),
      };
    case 'rental.specRemovePlan':
      return null;
    default:
      return null;
  }
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

function readOptionalDate(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const parsed = readString(value);
  if (!parsed || !/^\d{4}-\d{2}-\d{2}$/.test(parsed)) throw new Error('date must be YYYY-MM-DD');
  return parsed;
}

async function findReportContextForTool(outputDir: string, date?: string) {
  return date ? findReportContextByDate(outputDir, date) : findLatestReportContext(outputDir);
}

function missingReportContextText(date?: string): string {
  return date ? `没有找到 ${date} 的公域日报上下文。` : '还没有找到公域日报上下文。';
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
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
      return runReadOnlyAgentIntent(outputDir, { type: 'best_product_by_same_sku', query }, options);
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
    case 'publicTraffic.removedLinks':
      return runReadOnlyAgentIntent(outputDir, { type: 'removed_links' }, options);
    case 'publicTraffic.orderSummary':
      return runReadOnlyAgentIntent(outputDir, { type: 'order_summary' }, options);
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
      const latest = await findLatestReportContext(outputDir);
      if (!latest) return { text: '还没有找到可重发的公域日报。' };
      const card = buildPublicTrafficCard(latest.context, { markdownPath: '', workbookPath: '' });
      const fallbackText = buildPublicTrafficFeishuText(latest.context, { markdownPath: '', workbookPath: '' });
      const sendTo = readSendTo(request.arguments.sendTo);
      const env = sendTo ? { ...process.env, FEISHU_SEND_TO: sendTo } : process.env;
      const result = await sendFeishuCard(env, card, fallbackText);
      return { text: result.sent ? '最新公域日报已重发。' : `公域日报重发失败：${result.reason}` };
    }
    case 'publicTraffic.pushLatestReportToGroup': {
      const latest = await findLatestReportContext(outputDir);
      if (!latest) return { text: '还没有找到可推送的公域日报。' };
      const card = buildPublicTrafficCard(latest.context, { markdownPath: '', workbookPath: '' });
      const fallbackText = buildPublicTrafficFeishuText(latest.context, { markdownPath: '', workbookPath: '' });
      const result = await sendFeishuCard({ ...process.env, FEISHU_SEND_TO: 'group' }, card, fallbackText);
      return { text: result.sent ? '最新公域日报已推送到群。' : `公域日报推送到群失败：${result.reason}` };
    }
    case 'publicTraffic.refreshDashboard': {
      await loadEnv();
      const config = await loadConfig();
      const sendTo = readSendTo(request.arguments.sendTo);
      const date = readOptionalDate(request.arguments.date) ?? today();
      const result = await runDashboardRefresh({ config, date, sendTo });
      return {
        text: [
          `访问页补抓完成：${result.message}`,
          `日期：${date}`,
          '',
          `补抓结果：${result.refreshQualityText}`,
          '',
          `首版状态：${result.firstQualityText}`,
        ].join('\n'),
      };
    }
    case 'operations.refreshActivityPlan':
      return refreshActivityPlanResponse(outputDir, request.arguments, options);
    case 'operations.refreshActivityExecute':
      return refreshActivityExecuteResponse(outputDir, request.arguments, options.rentalPriceClient ?? createRentalPriceSkillClient());
    case 'rental.copy':
    case 'rental.delist':
    case 'rental.tenancySet':
    case 'rental.specDiscover':
    case 'rental.specAddAndRefresh': {
      const rentalRequest = rentalAgentToolRequest(request.toolName, request.arguments);
      if (!rentalRequest) throw new Error('租赁商品操作参数无效，请重新发起。');
      const result = await executeRentalOperationConfirmRequest(options.rentalPriceClient ?? createRentalPriceSkillClient(), rentalRequest);
      return { text: result.text, metadata: { toolName: request.toolName, ok: result.ok, productId: rentalRequest.productId } };
    }
    case 'rental.specRemovePlan': {
      const query = requireString(request.arguments.query, 'query');
      const keyword = requireString(request.arguments.keyword, 'keyword');
      return rentalSpecRemovePlanResponse(query, keyword, request.reason, options.rentalPriceClient ?? createRentalPriceSkillClient(), options, request.continuation);
    }
    case 'rental.operationConfirmRequest': {
      const rentalRequest = parseRentalOperationConfirmRequest({ request: request.arguments });
      if (!rentalRequest) throw new Error('租赁商品操作参数无效，请重新发起。');
      const result = await executeRentalOperationConfirmRequest(options.rentalPriceClient ?? createRentalPriceSkillClient(), rentalRequest);
      return { text: result.text };
    }
    case 'rental.priceChange': {
      const rentalRequest = rentalPriceChangeRequestFromToolArguments(request.arguments);
      if (!rentalRequest) throw new Error('租赁商品改价参数无效，请重新发起。');
      const client = options.rentalPriceClient ?? createRentalPriceSkillClient();
      const preview = await client.preview(rentalRequest);
      return { text: `请确认商品 ${rentalRequest.productId} 改价`, card: buildRentalPricePreviewCard(preview, { reason: request.reason, continuation: request.continuation }) };
    }
    case 'rental.priceSnapshot': {
      const query = requireString(request.arguments.query, 'query');
      return rentalPriceSnapshotResponse(query, options.rentalPriceClient ?? createRentalPriceSkillClient(), options);
    }
    case 'rental.newLinkBatchPlan': {
      const workflowRequests = readNewLinkBatchWorkflowRequests(request.arguments);
      if (!workflowRequests) return { text: '新链批量铺设参数无效：需要 keyword 和 count，或 items 数组。' };
      const [latest, registryContext] = await Promise.all([
        findLatestReportContext(outputDir),
        loadClosedOrderRegistryContext(options.closedOrderRegistryPaths),
      ]);
      if (!latest) return { text: '还没有找到公域日报上下文，无法选择新链复制源商品。' };

      const plans = workflowRequests.map((item) => buildNewLinkBatchPlan(item, latest.context, registryContext.registry));
      if (plans.length > 1) {
        const text = formatNewLinkBatchMultiPlan(plans);
        return {
          text,
          ...(plans.every((plan) => plan.status === 'ready') ? { card: buildNewLinkBatchMultiConfirmCard(plans, request.reason, request.continuation) } : {}),
          metadata: { toolName: 'rental.newLinkBatchPlan', plans, ready: plans.every((plan) => plan.status === 'ready') },
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
