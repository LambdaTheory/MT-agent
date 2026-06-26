import { basename, dirname } from 'node:path';
import { buildAgentToolConfirmCard } from '../agentRuntime/approvalCard.js';
import { buildAgentClarificationCard } from '../agentRuntime/clarificationCard.js';
import { listAgentPlannerTools, validateAgentMultiStepPlannerProposal, validateAgentPlannerClarificationProposal, validateAgentPlannerProposal, type AgentPlannerProvider } from '../agentRuntime/planner.js';
import { validateAgentWorkflowPlannerProposal } from '../agentRuntime/workflowPlanner.js';
import { buildAgentLearningPlannerHints, summarizeAgentLearning } from '../agentLearning/store.js';
import { parseAgentDataIntent } from '../agentData/intent.js';
import { loadClosedOrderRegistryContext, type ClosedOrderRegistryPathsInput } from '../closedOrderFeedback/runtime.js';
import { queryInventoryStatus } from '../inventoryStatus/query.js';
import { readInventorySameSkuSnapshot } from '../inventoryStatus/store.js';
import { createLinkRegistry } from '../linkRegistry/store.js';
import type { LinkRegistryEntry } from '../linkRegistry/types.js';
import {
  buildNewLinkBatchConfirmCard,
  buildNewLinkBatchMultiConfirmCard,
  buildNewLinkBatchPlan,
  formatNewLinkBatchPlan,
  formatNewLinkBatchMultiPlan,
  NEW_LINK_BATCH_WORKFLOW_NAME,
  readNewLinkBatchWorkflowRequest,
  readNewLinkBatchWorkflowRequests,
} from '../newLinkWorkflow/batch.js';
import { startOperationsLearningSession, summarizeOperationsLearningHistory, summarizeOperationsLearningSession } from '../operationsLearningLoop/session.js';
import { buildPublicTrafficPaths } from '../publicTraffic/paths.js';
import {
  buildActivityAutomationCard,
  buildCancelDifferentialPricingCardResult,
  type ActivityAutomationSkillClient,
} from './activityAutomation.js';
import { continueAgentPlannerSteps } from './agentToolContinuation.js';
import { executeAgentToolRequest } from './agentToolExecutor.js';
import {
  buildInventoryStatusDetailCard,
  buildInventoryStatusOverviewCard,
  formatInventoryStatusAmbiguousText,
  formatInventoryStatusDetailText,
  formatInventoryStatusMissingText,
  formatInventoryStatusOverviewText,
} from './inventoryStatusCard.js';
import { formatIdLookupResult, lookupProductId } from './idLookup.js';
import { buildIdLookupCard } from './idLookupCard.js';
import { buildLinkRegistryOverviewCard, formatLinkRegistryOverviewText } from './linkRegistryOverviewCard.js';
import { getSupportedLlmIntentProposals, parseLlmIntentProposal, type LlmIntentProposalProvider } from './llmIntentProposal.js';
import { runReadOnlyToolSelection } from './llmReadOnlyToolAdapter.js';
import { parseLlmToolSelection, type LlmReadOnlyToolName, type LlmToolSelectionProvider } from './llmProvider.js';
import { getRegistryBackedLlmTools } from './llmToolSelector.js';
import { parseExactBotIntent } from './intent.js';
import {
  buildRentalOperationConfirmCard,
  buildRentalPricePreviewCard,
  createRentalPriceSkillClient,
  rentalPriceChangeRequestFromToolArguments,
  type RentalOperationConfirmRequest,
  type RentalPriceSkillClient,
} from './rentalPrice.js';
import { findReadOnlyTool } from './readOnlyToolRegistry.js';
import type { ReadOnlyToolRunOptions } from './readOnlyToolRegistry.js';
import { findLatestReportContext, findReportContextByDate, formatLatestSummary, formatProductRows, parseNumericProductIdList, queryProductRows } from './reportStore.js';
import type { BotIntent, BotResponse } from './types.js';

const UNKNOWN_GUIDANCE = '我现在可以查：今日概况、商品、新链接池、待处理任务、转化差、曝光低、高潜力、下架链接、订单情况。你可以问“新链接池怎么样”或“查一下721”。';
const NEW_LINK_WRITE_INTENT_NEEDS_LLM =
  '这像是新链批量铺设写操作，需要 LLM Agent planner 先理解参数并生成飞书确认卡。当前没有可用计划，所以不会执行，也不会把它当作新链接池查询。请配置 MT_AGENT_LLM_BASE_URL / MT_AGENT_LLM_MODEL 后重启 PM2，或换成明确的只读问题。';
const NEW_LINK_WRITE_INTENT_PLAN_FAILED =
  '这像是新链批量铺设写操作，但 Agent planner 没有生成有效的新链批量铺设计划。为避免误执行或误答只读新链接池，本次不执行；请换个说法或检查 LLM 输出。';

const HELP_TEXT = `📋 查询与分析
  今日概况 — 查看最新公域日报概况
  看 2026-06-22 的日报 / 查昨天日报 — 查看指定日期公域日报
  查询 565 / 查 433,798 — 查询单个或多个端内ID表现
  2026-06-22 查询 733 — 查询指定日期的商品表现
  s23u最好的链接是哪条 — 按链接档案找同款组里数据最好的端内ID
  x200u的定价情况怎么样 — 按同款组汇总SKU平均租金
  查ID 565 / 商品ID互查 — 端内ID与平台商品ID互查
  库存情况 / 库存情况 pocket3 — 查看库存与同款组状态
  新链接池怎么样 / 待处理任务 / 下架链接 / 订单情况 — 查询运营数据池

📊 报表与数据
  跑日报 — 生成公域流量日报
  抓取访问页数据 — 补抓访问页/后链路数据
  重发日报 — 重新发送最新日报
  推送日报到群 — 推送日报到指定群
  同步关单 — 拉取最新关单并写入本地状态
  跑关单观察 — 生成关单观察摘要并回卡片

🤖 复合目标
  数据最好的SQ1是哪条？按这个ID复制5条新链
  数据最好的wide300、wide400分别复制5条新链
  x300u 含手柄的sku都得下掉 — 先按规格项生成删除预览和确认卡
  刷新活跃度 — 先生成近30天零创单链接下架与补链计划，确认后执行

🎓 运营学习
  运营学习 — 开始运营学习测验
  运营学习汇总 / 运营学习历史 — 查看测验反馈汇总或历史统计
  Agent学习汇总 — 查看 Agent 澄清与确认学习记录

💰 改价、审计与回滚
  876 全局改价 0.9 — 生成改价审计预览和确认卡
  改价 761 1天22 10天55 — 指定租期改价
  改价 761 所有价格 *0.9 — 所有价格乘法（含押金、成本等）
  回滚 task_xxxx — 按改价审计任务回滚到该任务执行前

🔧 商品操作
  复制商品 761 / 从端内ID 848复制3条新链 — 复制或铺新链
  下架商品 761 — 下架商品
  设置租期 761 1,10,30 — 设置租期天数
  查看规格 761 — 查看商品规格维度与项目
  添加规格 761 128G — 添加规格项

🛡️ 安全规则
  写操作会先弹确认卡；取消后不会执行
  商品ID、数量、规格层级不明确时会先澄清
  Agent学习汇总 — 查看 Agent 澄清与确认学习记录
  帮助 — 显示此帮助信息`;

export interface HandleBotIntentOptions {
  llmToolSelector?: LlmToolSelectionProvider;
  llmIntentProposalProvider?: LlmIntentProposalProvider;
  agentPlannerProvider?: AgentPlannerProvider;
  rentalPriceClient?: RentalPriceSkillClient;
  activityAutomationClient?: ActivityAutomationSkillClient;
  closedOrderFetchImpl?: typeof fetch;
  closedOrderRegistryPaths?: ClosedOrderRegistryPathsInput;
}

function rentalIntentToConfirmRequest(intent: BotIntent): RentalOperationConfirmRequest | null {
  switch (intent.type) {
    case 'rental_copy':
      return { action: 'copy', productId: intent.productId };
    case 'rental_delist':
      return { action: 'delist', productId: intent.productId };
    case 'rental_tenancy_set':
      return { action: 'tenancy-set', productId: intent.productId, days: intent.days };
    case 'rental_spec_discover':
      return { action: 'spec-discover', productId: intent.productId };
    case 'rental_spec_add':
      return { action: 'spec-add-and-refresh', productId: intent.productId, itemTitle: intent.itemTitle };
    default:
      return null;
  }
}

function rentalOperationConfirmResponse(request: RentalOperationConfirmRequest, reason: string): BotResponse {
  return { text: `请确认租赁商品操作：${request.productId}`, card: buildRentalOperationConfirmCard(request, reason) };
}

function agentToolConfirmResponse(toolName: string, args: Record<string, unknown>, reason: string): BotResponse {
  const request = { toolName, arguments: args, reason };
  return {
    text: `请确认 Agent 操作：${toolName}`,
    card: buildAgentToolConfirmCard(request),
  };
}

async function findReportContextForIntent(outputDir: string, date?: string) {
  return date ? findReportContextByDate(outputDir, date) : findLatestReportContext(outputDir);
}

function missingReportContextText(date?: string): string {
  return date ? `没有找到 ${date} 的公域日报上下文。` : '还没有找到公域日报上下文。';
}

function rollbackTaskConfirmResponse(text: string): BotResponse | null {
  if (!/回滚|rollback/i.test(text)) return null;
  const taskId = /\btask_\d+_[a-f0-9]+\b/i.exec(text)?.[0];
  const productId = /(?:商品|端内ID|productId)\s*(\d+)/i.exec(text)?.[1];
  const rollbackFile = /[A-Za-z]:[\\/][^\s"'，。；;]+rollback_[^\s"'，。；;]+\.json/i.exec(text)?.[0];
  if (!taskId && !rollbackFile) return null;
  return agentToolConfirmResponse(
    'rental.priceRollback',
    {
      ...(productId ? { productId } : {}),
      ...(taskId ? { taskId } : {}),
      ...(rollbackFile ? { rollbackFile } : {}),
    },
    '识别到租赁改价回滚请求；回滚属于高风险写操作，需要二次确认。',
  );
}

function looksLikeNewLinkWriteIntent(text: string): boolean {
  const compact = text.toLowerCase().replace(/\s+/g, '');
  const hasNewLink = /新链|新链接|(?:条|个|款)新(?=$|[?？。!！；;,，、])/.test(compact);
  const hasWriteVerb = /铺|补|新建|创建|生成|新增|复制|批量/.test(compact);
  return hasNewLink && hasWriteVerb;
}

function extractExplicitNewLinkSourceProductId(text: string): string | undefined {
  const compact = text.replace(/\s+/g, '');
  if (!/(新链|新链接)/.test(compact)) return undefined;
  const verb = '(?:复制|铺|铺设|新增|补|新建|创建|生成)';
  const id = '(?:端内(?:ID)?|商品(?:ID)?|链接)?(\\d{2,})';
  const patterns = [
    new RegExp(`(?:从|用|以|基于)${id}.*${verb}`),
    new RegExp(`${id}.*${verb}.*(?:新链|新链接)`),
    new RegExp(`${verb}.*${id}.*(?:新链|新链接)`),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(compact);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

function applyExplicitNewLinkSource(
  message: string,
  request: ReturnType<typeof readNewLinkBatchWorkflowRequest>,
): ReturnType<typeof readNewLinkBatchWorkflowRequest> {
  if (!request) return null;
  const sourceProductId = extractExplicitNewLinkSourceProductId(message);
  return sourceProductId ? { ...request, sourceProductId } : request;
}

function applyExplicitNewLinkSourceToRequests(
  message: string,
  requests: ReturnType<typeof readNewLinkBatchWorkflowRequests>,
): ReturnType<typeof readNewLinkBatchWorkflowRequests> {
  if (!requests) return null;
  if (requests.length !== 1) return requests;
  const request = applyExplicitNewLinkSource(message, requests[0] ?? null);
  return request ? [request] : null;
}

function readOnlyIntentNeedsLinkRegistry(intent: ReturnType<typeof parseAgentDataIntent>): boolean {
  return intent.type === 'best_product_by_same_sku';
}

function formatLinkRegistryStatus(status: LinkRegistryEntry['status']): string {
  if (status === 'active') return '在架';
  if (status === 'removed') return '已下架';
  return '未知';
}

function formatRegistryProductRows(productIds: string[], entries: LinkRegistryEntry[]): string {
  const entryById = new Map(entries.map((entry) => [entry.internalProductId, entry]));
  const lines = productIds.map((productId) => {
    const entry = entryById.get(productId);
    if (!entry) return `端内ID ${productId}\n未在链接档案中找到`;
    const name = entry.productName ?? entry.shortName ?? '未命名商品';
    const platform = entry.platformProductId ? `平台商品ID ${entry.platformProductId}` : '平台商品ID 未记录';
    return `端内ID ${entry.internalProductId} ${name}\n${platform}，状态 ${formatLinkRegistryStatus(entry.status)}`;
  });
  return lines.join('\n\n');
}

function llmReadOnlyToolNeedsLinkRegistry(tool: LlmReadOnlyToolName): boolean {
  return tool === 'rank_best_same_sku_product';
}

async function buildReadOnlyToolRunOptions(
  options: HandleBotIntentOptions,
  needsLinkRegistry: boolean,
): Promise<ReadOnlyToolRunOptions> {
  if (!needsLinkRegistry) return {};
  const registryContext = await loadClosedOrderRegistryContext(options.closedOrderRegistryPaths);
  return { linkRegistryStore: createLinkRegistry(registryContext.registry) };
}

async function handleInventoryStatusIntent(
  intent: Extract<BotIntent, { type: 'inventory_status_overview' | 'inventory_status_query' }>,
  outputDir: string,
  options: HandleBotIntentOptions,
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
    query: intent.type === 'inventory_status_query' ? intent.query : '',
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

async function executeAgentMultiStepPlannerResponse(
  rawProposal: string,
  outputDir: string,
  options: HandleBotIntentOptions,
): Promise<BotResponse | null> {
  const parsed = validateAgentMultiStepPlannerProposal(rawProposal);
  if (!parsed.ok) return null;

  const textParts = [
    `Agent 多步骤计划：${parsed.proposal.goal}`,
    `判断原因：${parsed.proposal.reason}`,
  ];

  return continueAgentPlannerSteps({
    goal: parsed.proposal.goal,
    reason: parsed.proposal.reason,
    steps: parsed.proposal.steps,
    baseIndex: 0,
    totalSteps: parsed.proposal.steps.length,
    metadataStore: {},
    textParts,
    outputDir,
    options: {
      rentalPriceClient: options.rentalPriceClient,
      closedOrderFetchImpl: options.closedOrderFetchImpl,
      closedOrderRegistryPaths: options.closedOrderRegistryPaths,
    },
  });
}

async function agentPlannerResponse(
  message: string,
  outputDir: string,
  options: HandleBotIntentOptions,
): Promise<BotResponse | null> {
  if (!options.agentPlannerProvider) return null;
  const learningHints = await buildAgentLearningPlannerHints(outputDir, message);
  const rawProposal = await options.agentPlannerProvider.proposePlan({
    message,
    tools: listAgentPlannerTools(),
    workflows: [],
    ...(learningHints.length ? { learningHints } : {}),
  });
  const parsed = validateAgentPlannerProposal(rawProposal);
  if (!parsed.ok) {
    const workflowParsed = validateAgentWorkflowPlannerProposal(rawProposal);
    if (!workflowParsed.ok) {
      const multiStepResponse = await executeAgentMultiStepPlannerResponse(rawProposal, outputDir, options);
      if (multiStepResponse) return multiStepResponse;
      const clarificationParsed = validateAgentPlannerClarificationProposal(rawProposal);
      return clarificationParsed.ok
        ? { text: clarificationParsed.proposal.question, card: buildAgentClarificationCard(clarificationParsed.proposal) }
        : null;
    }
    if (workflowParsed.proposal.selectedWorkflow !== NEW_LINK_BATCH_WORKFLOW_NAME) return null;
    const workflowRequests = applyExplicitNewLinkSourceToRequests(message, readNewLinkBatchWorkflowRequests(workflowParsed.proposal.arguments));
    if (!workflowRequests) return { text: '新链批量铺设参数无效：需要 keyword 和 count，或 items 数组。' };

    const [latest, registryContext] = await Promise.all([
      findLatestReportContext(outputDir),
      loadClosedOrderRegistryContext(options.closedOrderRegistryPaths),
    ]);
    if (!latest) return { text: '还没有找到公域日报上下文，无法选择新链复制源商品。' };

    const plans = workflowRequests.map((request) => buildNewLinkBatchPlan(request, latest.context, registryContext.registry));
    if (plans.length > 1) {
      const text = formatNewLinkBatchMultiPlan(plans);
      return {
        text,
        ...(plans.every((plan) => plan.status === 'ready') ? { card: buildNewLinkBatchMultiConfirmCard(plans, workflowParsed.proposal.reason) } : {}),
      };
    }

    const plan = plans[0]!;
    return {
      text: formatNewLinkBatchPlan(plan),
      ...(plan.status === 'ready' ? { card: buildNewLinkBatchConfirmCard(plan, workflowParsed.proposal.reason) } : {}),
    };
  }

  const request = {
    toolName: parsed.proposal.selectedTool,
    arguments: parsed.proposal.arguments,
    reason: parsed.proposal.reason,
  };
  if (parsed.proposal.selectedTool === 'rental.priceChange') {
    const rentalRequest = rentalPriceChangeRequestFromToolArguments(parsed.proposal.arguments);
    if (!rentalRequest) return { text: '租赁商品改价参数无效：需要 productId，并提供 fields 或 discount。' };
    const rentalPriceClient = options.rentalPriceClient ?? createRentalPriceSkillClient();
    const preview = await rentalPriceClient.preview(rentalRequest);
    return { text: `请确认商品 ${rentalRequest.productId} 改价`, card: buildRentalPricePreviewCard(preview) };
  }
  if (parsed.proposal.selectedTool === 'rental.specRemovePlan' || parsed.proposal.selectedTool === 'rental.newLinkBatchPlan') {
    return executeAgentToolRequest(request, outputDir, {
      rentalPriceClient: options.rentalPriceClient,
      closedOrderFetchImpl: options.closedOrderFetchImpl,
      closedOrderRegistryPaths: options.closedOrderRegistryPaths,
    });
  }
  if (parsed.policy.decision === 'allow') {
    return executeAgentToolRequest(request, outputDir, {
      rentalPriceClient: options.rentalPriceClient,
      closedOrderFetchImpl: options.closedOrderFetchImpl,
      closedOrderRegistryPaths: options.closedOrderRegistryPaths,
    });
  }
  return {
    text: `请确认 Agent 操作：${parsed.proposal.selectedTool}`,
    card: buildAgentToolConfirmCard(request),
  };
}

export async function handleBotIntent(intent: BotIntent, outputDir = 'output', options: HandleBotIntentOptions = {}): Promise<BotResponse> {
  if (intent.type === 'help') {
    return { text: HELP_TEXT };
  }

  if (intent.type === 'differential_pricing_card') {
    return {
      text: '差异化定价卡片已打开，请在卡片中填写日期和折扣后确认执行。',
      card: buildActivityAutomationCard(),
    };
  }

  if (intent.type === 'cancel_differential_pricing_card') {
    return buildCancelDifferentialPricingCardResult(outputDir);
  }

  if (intent.type === 'sync_closed_order_feedback') {
    return agentToolConfirmResponse('closedOrder.syncFeedback', {}, '明确飞书命令需要二次确认后才能同步关单反馈。');
  }

  if (intent.type === 'run_closed_order_observation_report') {
    return agentToolConfirmResponse('closedOrder.runObservationReport', {}, '明确飞书命令需要二次确认后才能生成关单观察报告。');
  }

  if (intent.type === 'latest_summary') {
    const latest = await findReportContextForIntent(outputDir, intent.date);
    return { text: latest ? formatLatestSummary(latest.context) : missingReportContextText(intent.date) };
  }

  if (intent.type === 'inventory_status_overview' || intent.type === 'inventory_status_query') {
    return handleInventoryStatusIntent(intent, outputDir, options);
  }

  if (intent.type === 'query_product') {
    const productIds = parseNumericProductIdList(intent.keyword);
    const latest = await findReportContextForIntent(outputDir, intent.date);
    if (latest) {
      const rows = queryProductRows(latest.context, intent.keyword);
      if (rows.length > 0) return { text: formatProductRows(rows) };
    }
    if (!latest && intent.date) return { text: missingReportContextText(intent.date) };
    if (productIds.length > 0) {
      const registryContext = await loadClosedOrderRegistryContext(options.closedOrderRegistryPaths);
      return { text: formatRegistryProductRows(productIds, registryContext.registry) };
    }
    if (!latest) return { text: missingReportContextText() };

    return { text: formatProductRows([]) };
  }

  if (intent.type === 'lookup_product_id') {
    const latest = await findReportContextForIntent(outputDir, intent.date);
    return { text: latest ? formatIdLookupResult(lookupProductId(latest.context, intent.query)) : missingReportContextText(intent.date) };
  }

  if (intent.type === 'lookup_product_id_card') {
    return { text: '已打开常驻商品ID互查卡，可保留在会话里反复查询。', card: buildIdLookupCard() };
  }

  if (intent.type === 'link_registry_overview') {
    const registryContext = await loadClosedOrderRegistryContext(options.closedOrderRegistryPaths);
    const audit = createLinkRegistry(registryContext.registry, registryContext.overrideRisks).audit();
    return { text: formatLinkRegistryOverviewText(audit), card: buildLinkRegistryOverviewCard(audit) };
  }

  if (intent.type === 'rental_price_change') {
    const rentalPriceClient = options.rentalPriceClient ?? createRentalPriceSkillClient();
    const preview = await rentalPriceClient.preview(intent.request);
    return { text: `请确认商品 ${intent.productId} 改价`, card: buildRentalPricePreviewCard(preview) };
  }

  if (intent.type === 'rental_copy') {
    return rentalOperationConfirmResponse({ action: 'copy', productId: intent.productId }, '明确飞书命令需要二次确认后才能复制商品。');
  }

  if (intent.type === 'rental_delist') {
    return rentalOperationConfirmResponse({ action: 'delist', productId: intent.productId }, '明确飞书命令需要二次确认后才能下架商品。');
  }

  if (intent.type === 'rental_tenancy_set') {
    return rentalOperationConfirmResponse({ action: 'tenancy-set', productId: intent.productId, days: intent.days }, '明确飞书命令需要二次确认后才能设置租期。');
  }

  if (intent.type === 'rental_spec_discover') {
    const rentalPriceClient = options.rentalPriceClient ?? createRentalPriceSkillClient();
    const result = await rentalPriceClient.specDiscover(intent.productId);
    if (result.ok) {
      const dims = result.dimensions.map(d => `  ${d.title}（${d.items.map(i => i.title).join('、')}）`).join('\n');
      return { text: `规格查看成功：商品 ${result.productId}\n${dims || '（无规格维度）'}` };
    }
    return { text: `规格查看失败：商品 ${result.productId}\n${result.lines.join('\n')}` };
  }

  if (intent.type === 'rental_spec_add') {
    return rentalOperationConfirmResponse({ action: 'spec-add-and-refresh', productId: intent.productId, itemTitle: intent.itemTitle }, '明确飞书命令需要二次确认后才能添加规格。');
  }

  if (intent.type === 'operations_learning_quiz') {
    const latest = await findLatestReportContext(outputDir);
    if (!latest) return { text: '还没有找到公域日报上下文。' };
    return startOperationsLearningSession(outputDir, latest.context);
  }

  if (intent.type === 'operations_learning_summary') {
    const latest = await findLatestReportContext(outputDir);
    if (!latest) return { text: '还没有找到公域日报上下文。' };
    return { text: await summarizeOperationsLearningSession(outputDir, latest.context.date) };
  }

  if (intent.type === 'operations_learning_history') {
    return { text: await summarizeOperationsLearningHistory(outputDir) };
  }

  if (intent.type === 'agent_learning_summary') {
    return { text: await summarizeAgentLearning(outputDir) };
  }

  if (intent.type === 'run_public_traffic_report') {
    return agentToolConfirmResponse('publicTraffic.runReport', {}, '明确飞书命令需要二次确认后才能生成并发送公域日报。');
  }

  if (intent.type === 'refresh_public_traffic_dashboard') {
    return agentToolConfirmResponse(
      'publicTraffic.refreshDashboard',
      intent.sendTo ? { sendTo: intent.sendTo } : {},
      '明确飞书命令需要二次确认后才能补抓访问页数据；若补抓后数据完整，可能重建并重发日报。',
    );
  }

  if (intent.type === 'push_latest_report_to_group') {
    return agentToolConfirmResponse('publicTraffic.pushLatestReportToGroup', {}, '明确飞书命令需要二次确认后才能把日报推送到群。');
  }

  if (intent.type === 'resend_latest_report') {
    return agentToolConfirmResponse(
      'publicTraffic.resendLatestReport',
      intent.sendTo ? { sendTo: intent.sendTo } : {},
      '明确飞书命令需要二次确认后才能重发公域日报。',
    );
  }

  if (intent.type === 'unknown') {
    const plannedResponse = await agentPlannerResponse(intent.text, outputDir, options);
    if (plannedResponse) return plannedResponse;

    if (options.agentPlannerProvider) {
      if (looksLikeNewLinkWriteIntent(intent.text)) return { text: NEW_LINK_WRITE_INTENT_PLAN_FAILED };
      return { text: 'Agent planner did not return a valid plan. No legacy deterministic route or operation was executed. Please rephrase the command or check the LLM output/config.' };
    }

    const rollbackResponse = rollbackTaskConfirmResponse(intent.text);
    if (rollbackResponse) return rollbackResponse;

    const exactFallback = parseExactBotIntent(intent.text);
    if (exactFallback.type !== 'unknown') {
      return handleBotIntent(exactFallback, outputDir, { ...options, agentPlannerProvider: undefined });
    }

    if (options.llmIntentProposalProvider) {
      const rawProposal = await options.llmIntentProposalProvider.proposeIntent({ message: intent.text, intents: getSupportedLlmIntentProposals() });
      const parsedProposal = parseLlmIntentProposal(rawProposal);
      if (parsedProposal.ok && parsedProposal.proposal.intent.type !== 'unknown') {
        const proposedIntent = parsedProposal.proposal.intent;
        const rentalPriceClient = options.rentalPriceClient ?? createRentalPriceSkillClient();
        if (proposedIntent.type === 'rental_price_change') {
          const preview = await rentalPriceClient.preview(proposedIntent.request);
          return { text: `请确认商品 ${proposedIntent.productId} 改价`, card: buildRentalPricePreviewCard(preview) };
        }
        const request = rentalIntentToConfirmRequest(proposedIntent);
        if (request) {
          return rentalOperationConfirmResponse(request, parsedProposal.proposal.reason);
        }
      }
    }

    if (looksLikeNewLinkWriteIntent(intent.text)) {
      return { text: NEW_LINK_WRITE_INTENT_NEEDS_LLM };
    }

    const latest = await findLatestReportContext(outputDir);
    const hasLlmRouting = Boolean(options.agentPlannerProvider || options.llmIntentProposalProvider || options.llmToolSelector);
    if (options.llmToolSelector) {
      if (!latest) return { text: '还没有找到公域日报上下文。' };
      const rawSelection = await options.llmToolSelector.selectTool({ message: intent.text, tools: getRegistryBackedLlmTools() });
      const parsed = parseLlmToolSelection(rawSelection);
      if (parsed.ok && parsed.selection.tool !== 'none' && parsed.selection.tool !== 'get_supported_questions') {
        const result = await runReadOnlyToolSelection(
          latest.context,
          parsed.selection,
          await buildReadOnlyToolRunOptions(options, llmReadOnlyToolNeedsLinkRegistry(parsed.selection.tool)),
        );
        return result.ok ? result.response : { text: UNKNOWN_GUIDANCE };
      }
      return { text: UNKNOWN_GUIDANCE };
    }

    if (hasLlmRouting) return { text: UNKNOWN_GUIDANCE };

    const deterministicDataIntent = parseAgentDataIntent(intent.text);
    const tool = findReadOnlyTool(deterministicDataIntent);
    if (tool) {
      const latest = await findLatestReportContext(outputDir);
      if (latest) return tool.run(latest.context, deterministicDataIntent, await buildReadOnlyToolRunOptions(options, readOnlyIntentNeedsLinkRegistry(deterministicDataIntent)));
      return { text: '还没有找到公域日报上下文。' };
    }
    return { text: UNKNOWN_GUIDANCE };
  }

  return { text: UNKNOWN_GUIDANCE };
}
