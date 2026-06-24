import { basename, dirname } from 'node:path';
import { buildAgentToolConfirmCard } from '../agentRuntime/approvalCard.js';
import { buildAgentClarificationCard } from '../agentRuntime/clarificationCard.js';
import { listAgentPlannerTools, validateAgentPlannerClarificationProposal, validateAgentPlannerProposal, type AgentPlannerProvider } from '../agentRuntime/planner.js';
import { validateAgentWorkflowPlannerProposal } from '../agentRuntime/workflowPlanner.js';
import { listAgentWorkflows } from '../agentRuntime/workflowRegistry.js';
import { buildAgentLearningPlannerHints, summarizeAgentLearning } from '../agentLearning/store.js';
import { parseAgentDataIntent } from '../agentData/intent.js';
import { loadClosedOrderRegistryContext, type ClosedOrderRegistryPathsInput } from '../closedOrderFeedback/runtime.js';
import { queryInventoryStatus } from '../inventoryStatus/query.js';
import { readInventorySameSkuSnapshot } from '../inventoryStatus/store.js';
import { createLinkRegistry } from '../linkRegistry/store.js';
import {
  buildNewLinkBatchConfirmCard,
  buildNewLinkBatchPlan,
  formatNewLinkBatchPlan,
  NEW_LINK_BATCH_WORKFLOW_NAME,
  readNewLinkBatchWorkflowRequest,
} from '../newLinkWorkflow/batch.js';
import { startOperationsLearningSession, summarizeOperationsLearningHistory, summarizeOperationsLearningSession } from '../operationsLearningLoop/session.js';
import { buildPublicTrafficPaths } from '../publicTraffic/paths.js';
import {
  buildActivityAutomationCard,
  type ActivityAutomationSkillClient,
} from './activityAutomation.js';
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
import {
  buildRentalOperationConfirmCard,
  buildRentalPricePreviewCard,
  createRentalPriceSkillClient,
  type RentalOperationConfirmRequest,
  type RentalPriceSkillClient,
} from './rentalPrice.js';
import { findReadOnlyTool } from './readOnlyToolRegistry.js';
import type { ReadOnlyToolRunOptions } from './readOnlyToolRegistry.js';
import { findLatestReportContext, formatLatestSummary, formatProductRows, queryProductRows } from './reportStore.js';
import type { BotIntent, BotResponse } from './types.js';

const UNKNOWN_GUIDANCE = '我现在可以查：今日概况、商品、新链接池、待处理任务、转化差、曝光低、高潜力、下架链接、订单情况。你可以问“新链接池怎么样”或“查一下721”。';
const NEW_LINK_WRITE_INTENT_NEEDS_LLM =
  '这像是新链批量铺设写操作，需要 LLM Agent planner 先理解参数并生成飞书确认卡。当前没有可用计划，所以不会执行，也不会把它当作新链接池查询。请配置 MT_AGENT_LLM_BASE_URL / MT_AGENT_LLM_MODEL 后重启 PM2，或换成明确的只读问题。';
const NEW_LINK_WRITE_INTENT_PLAN_FAILED =
  '这像是新链批量铺设写操作，但 Agent planner 没有生成有效的新链批量铺设计划。为避免误执行或误答只读新链接池，本次不执行；请换个说法或检查 LLM 输出。';

const HELP_TEXT = `📋 数据查询
  今日概况 — 查看今日公域流量概况
  查询 565 — 按关键词查询商品
  查ID 565 — 端内ID与平台商品ID互查
  商品ID互查 — 打开常驻ID互查卡片
  查看规格 761 — 查看商品规格维度与项目

📊 报表操作
  跑日报 — 生成公域流量日报
  重发日报 — 重新发送最新日报
  推送日报到群 — 推送日报到指定群
  同步关单 — 拉取最新关单并写入本地状态
  跑关单观察 — 生成关单观察摘要并回卡片

🎓 运营学习
  运营学习 — 开始运营学习测验
  Agent学习汇总 — 查看 Agent 澄清与确认学习记录

💰 租赁改价
  改价 761 1天22 10天55 — 指定租期改价（格式：改价 ID 租期1价格1 租期2价格2 ...）
  改价 761 全局改价 0.9 — 全局折扣（所有租金字段 ×0.9）
  改价 761 全部租金九折 — 全部租金九折
  改价 761 所有价格 *0.9 — 所有价格乘法（含押金、成本等）

🔧 商品操作
  复制商品 761 — 复制商品
  下架商品 761 — 下架商品
  设置租期 761 1,10,30 — 设置租期天数
  添加规格 761 128G — 添加规格项

❓ 帮助
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

function looksLikeNewLinkWriteIntent(text: string): boolean {
  const compact = text.toLowerCase().replace(/\s+/g, '');
  const hasNewLink = /新链|新链接/.test(compact);
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

function readOnlyIntentNeedsLinkRegistry(intent: ReturnType<typeof parseAgentDataIntent>): boolean {
  return intent.type === 'best_product_by_same_sku';
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
    workflows: listAgentWorkflows(),
    ...(learningHints.length ? { learningHints } : {}),
  });
  const parsed = validateAgentPlannerProposal(rawProposal);
  if (!parsed.ok) {
    const workflowParsed = validateAgentWorkflowPlannerProposal(rawProposal);
    if (!workflowParsed.ok) {
      const clarificationParsed = validateAgentPlannerClarificationProposal(rawProposal);
      return clarificationParsed.ok
        ? { text: clarificationParsed.proposal.question, card: buildAgentClarificationCard(clarificationParsed.proposal) }
        : null;
    }
    if (workflowParsed.proposal.selectedWorkflow !== NEW_LINK_BATCH_WORKFLOW_NAME) return null;
    const workflowRequest = applyExplicitNewLinkSource(message, readNewLinkBatchWorkflowRequest(workflowParsed.proposal.arguments));
    if (!workflowRequest) return { text: '新链批量铺设参数无效：需要 keyword 和 count。' };

    const [latest, registryContext] = await Promise.all([
      findLatestReportContext(outputDir),
      loadClosedOrderRegistryContext(options.closedOrderRegistryPaths),
    ]);
    if (!latest) return { text: '还没有找到公域日报上下文，无法选择新链复制源商品。' };

    const plan = buildNewLinkBatchPlan(workflowRequest, latest.context, registryContext.registry);
    const text = formatNewLinkBatchPlan(plan);
    return {
      text,
      ...(plan.status === 'ready' ? { card: buildNewLinkBatchConfirmCard(plan, workflowParsed.proposal.reason) } : {}),
    };
  }

  const request = {
    toolName: parsed.proposal.selectedTool,
    arguments: parsed.proposal.arguments,
    reason: parsed.proposal.reason,
  };
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

  if (intent.type === 'sync_closed_order_feedback') {
    return agentToolConfirmResponse('closedOrder.syncFeedback', {}, '明确飞书命令需要二次确认后才能同步关单反馈。');
  }

  if (intent.type === 'run_closed_order_observation_report') {
    return agentToolConfirmResponse('closedOrder.runObservationReport', {}, '明确飞书命令需要二次确认后才能生成关单观察报告。');
  }

  if (intent.type === 'latest_summary') {
    const latest = await findLatestReportContext(outputDir);
    return { text: latest ? formatLatestSummary(latest.context) : '还没有找到公域日报上下文。' };
  }

  if (intent.type === 'inventory_status_overview' || intent.type === 'inventory_status_query') {
    return handleInventoryStatusIntent(intent, outputDir, options);
  }

  if (intent.type === 'query_product') {
    const latest = await findLatestReportContext(outputDir);
    return { text: latest ? formatProductRows(queryProductRows(latest.context, intent.keyword)) : '还没有找到公域日报上下文。' };
  }

  if (intent.type === 'lookup_product_id') {
    const latest = await findLatestReportContext(outputDir);
    return { text: latest ? formatIdLookupResult(lookupProductId(latest.context, intent.query)) : '还没有找到公域日报上下文。' };
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

    const deterministicDataIntent = parseAgentDataIntent(intent.text);
    if (deterministicDataIntent.type === 'best_product_by_same_sku') {
      const tool = findReadOnlyTool(deterministicDataIntent);
      const latest = await findLatestReportContext(outputDir);
      if (tool && latest) return tool.run(latest.context, deterministicDataIntent, await buildReadOnlyToolRunOptions(options, true));
      if (tool) return { text: '还没有找到公域日报上下文。' };
    }

    const plannedResponse = await agentPlannerResponse(intent.text, outputDir, options);
    if (plannedResponse) return plannedResponse;
    if (looksLikeNewLinkWriteIntent(intent.text)) {
      return { text: options.agentPlannerProvider ? NEW_LINK_WRITE_INTENT_PLAN_FAILED : NEW_LINK_WRITE_INTENT_NEEDS_LLM };
    }

    const dataIntent = deterministicDataIntent;
    const tool = findReadOnlyTool(dataIntent);
    const latest = await findLatestReportContext(outputDir);
    if (tool && latest) return tool.run(latest.context, dataIntent, await buildReadOnlyToolRunOptions(options, readOnlyIntentNeedsLinkRegistry(dataIntent)));

    if (tool) return { text: '还没有找到公域日报上下文。' };
    if (!options.llmToolSelector) return { text: UNKNOWN_GUIDANCE };
    if (!latest) return { text: '还没有找到公域日报上下文。' };

    const rawSelection = await options.llmToolSelector.selectTool({ message: intent.text, tools: getRegistryBackedLlmTools() });
    const parsed = parseLlmToolSelection(rawSelection);
    if (!parsed.ok || parsed.selection.tool === 'none' || parsed.selection.tool === 'get_supported_questions') return { text: UNKNOWN_GUIDANCE };
    const result = await runReadOnlyToolSelection(
      latest.context,
      parsed.selection,
      await buildReadOnlyToolRunOptions(options, llmReadOnlyToolNeedsLinkRegistry(parsed.selection.tool)),
    );
    return result.ok ? result.response : { text: UNKNOWN_GUIDANCE };
  }

  return { text: UNKNOWN_GUIDANCE };
}
