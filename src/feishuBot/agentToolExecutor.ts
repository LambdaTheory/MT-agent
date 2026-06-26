import { join } from 'node:path';
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
import { syncClosedOrderFeedbackFromApi } from '../closedOrderFeedback/sync.js';
import { sendFeishuCard } from '../notify/feishu.js';
import { buildPublicTrafficCard } from '../publicTraffic/buildPublicTrafficCard.js';
import { buildPublicTrafficFeishuText } from '../publicTraffic/buildPublicTrafficFeishu.js';
import { runDashboardRefresh } from '../publicTraffic/dashboardRefresh.js';
import { startOperationsLearningSession } from '../operationsLearningLoop/session.js';
import type { BotResponse } from './types.js';
import type { FeishuSendTo } from './types.js';
import { buildClosedOrderObservationCard } from './closedOrderObservationCard.js';
import { formatIdLookupResult, lookupProductId } from './idLookup.js';
import {
  buildRentalPricePreviewCard,
  createRentalPriceSkillClient,
  executeRentalOperationConfirmRequest,
  parseRentalOperationConfirmRequest,
  rentalPriceChangeRequestFromToolArguments,
  rentalPriceRollbackRequestFromToolArguments,
  type RentalOperationConfirmRequest,
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
  if (!normalized) return { ok: false, text: '请提供要查询定价情况的商品、端内ID或同款组。' };

  if (/^\d+$/.test(normalized)) {
    const entry = registry.getByInternalId(normalized);
    if (!entry) return { ok: false, text: `链接维护档案未找到端内ID ${normalized}，无法查询定价情况。` };
    const sameSkuGroupId = entry.sameSkuGroupId?.trim() ?? null;
    const entries = sameSkuGroupId ? queryableEntries(registry.listBySameSkuGroup(sameSkuGroupId, { includeUnknown: true })) : queryableEntries([entry]);
    return { ok: true, sameSkuGroupId, entries: entries.length ? entries : [entry], matchText: sameSkuGroupId ? `按端内ID ${normalized} 命中同款组 ${sameSkuGroupId}` : `按端内ID ${normalized} 查询单商品` };
  }

  const directGroupEntries = queryableEntries(registry.listBySameSkuGroup(normalized, { includeUnknown: true }));
  if (directGroupEntries.length > 0) {
    return { ok: true, sameSkuGroupId: normalized, entries: directGroupEntries, matchText: `按同款组 ${normalized} 命中` };
  }

  const alias = registry.resolveAlias(normalized);
  if (alias.status === 'not_found') return { ok: false, text: `链接维护档案未匹配到“${query}”，无法安全判断要查询哪组定价。` };
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
    case 'operationsLearning.startQuiz': {
      const latest = await findLatestReportContext(outputDir);
      return latest ? startOperationsLearningSession(outputDir, latest.context) : { text: '还没有找到公域日报上下文。' };
    }
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
    case 'rental.copy':
    case 'rental.delist':
    case 'rental.tenancySet':
    case 'rental.specDiscover':
    case 'rental.specAddAndRefresh': {
      const rentalRequest = rentalAgentToolRequest(request.toolName, request.arguments);
      if (!rentalRequest) throw new Error('租赁商品操作参数无效，请重新发起。');
      const result = await executeRentalOperationConfirmRequest(options.rentalPriceClient ?? createRentalPriceSkillClient(), rentalRequest);
      return { text: result.text };
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
      return { text: `请确认商品 ${rentalRequest.productId} 改价`, card: buildRentalPricePreviewCard(preview) };
    }
    case 'rental.priceSnapshot': {
      const query = requireString(request.arguments.query, 'query');
      return rentalPriceSnapshotResponse(query, options.rentalPriceClient ?? createRentalPriceSkillClient(), options);
    }
    case 'rental.priceRollback': {
      const rollbackRequest = rentalPriceRollbackRequestFromToolArguments(request.arguments);
      if (!rollbackRequest) throw new Error('租赁商品改价回滚参数无效，请提供 taskId 或 rollbackFile；productId 可选。');
      const client = options.rentalPriceClient ?? createRentalPriceSkillClient();
      if (!client.rollback) throw new Error('当前租赁改价客户端不支持回滚。');
      const result = await client.rollback(rollbackRequest);
      return { text: `${result.ok ? '改价回滚成功' : '改价回滚失败'}：商品 ${result.productId}\n${result.lines.join('\n')}` };
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
    case 'publicTraffic.crawlSources':
      throw new Error('publicTraffic.crawlSources 当前需要 CLI AgentConfig，尚未接入飞书审批执行。');
    default:
      throw new Error(`Unsupported agent tool: ${request.toolName}`);
  }
}
