import { join } from 'node:path';
import { buildAgentToolConfirmCard } from '../agentRuntime/approvalCard.js';
import { listAgentPlannerTools, validateAgentPlannerProposal, type AgentPlannerProvider } from '../agentRuntime/planner.js';
import { validateAgentWorkflowPlannerProposal } from '../agentRuntime/workflowPlanner.js';
import { listAgentWorkflows } from '../agentRuntime/workflowRegistry.js';
import { parseAgentDataIntent } from '../agentData/intent.js';
import { runPublicTrafficReportCli } from '../cli/publicTrafficReport.js';
import { loadClosedOrderIngestState } from '../closedOrderFeedback/ingest.js';
import { buildClosedOrderObservationReport, writeClosedOrderObservationReportArtifacts } from '../closedOrderFeedback/observation.js';
import { loadClosedOrderRegistryContext, type ClosedOrderRegistryPathsInput } from '../closedOrderFeedback/runtime.js';
import { syncClosedOrderFeedbackFromApi } from '../closedOrderFeedback/sync.js';
import {
  buildNewLinkBatchConfirmCard,
  buildNewLinkBatchPlan,
  formatNewLinkBatchPlan,
  NEW_LINK_BATCH_WORKFLOW_NAME,
  readNewLinkBatchWorkflowRequest,
} from '../newLinkWorkflow/batch.js';
import { sendFeishuCard } from '../notify/feishu.js';
import { startOperationsLearningSession, summarizeOperationsLearningHistory, summarizeOperationsLearningSession } from '../operationsLearningLoop/session.js';
import { buildPublicTrafficCard } from '../publicTraffic/buildPublicTrafficCard.js';
import { buildPublicTrafficFeishuText } from '../publicTraffic/buildPublicTrafficFeishu.js';
import { executeAgentToolRequest } from './agentToolExecutor.js';
import { buildClosedOrderObservationCard } from './closedOrderObservationCard.js';
import { formatIdLookupResult, lookupProductId } from './idLookup.js';
import { buildIdLookupCard } from './idLookupCard.js';
import { getSupportedLlmIntentProposals, parseLlmIntentProposal, type LlmIntentProposalProvider } from './llmIntentProposal.js';
import { runReadOnlyToolSelection } from './llmReadOnlyToolAdapter.js';
import { parseLlmToolSelection, type LlmToolSelectionProvider } from './llmProvider.js';
import { getRegistryBackedLlmTools } from './llmToolSelector.js';
import {
  buildRentalOperationConfirmCard,
  buildRentalPricePreviewCard,
  createRentalPriceSkillClient,
  type RentalOperationConfirmRequest,
  type RentalPriceSkillClient,
} from './rentalPrice.js';
import { findReadOnlyTool } from './readOnlyToolRegistry.js';
import { findLatestReportContext, formatLatestSummary, formatProductRows, queryProductRows } from './reportStore.js';
import type { BotIntent, BotResponse } from './types.js';

let running = false;

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

function looksLikeNewLinkWriteIntent(text: string): boolean {
  const compact = text.toLowerCase().replace(/\s+/g, '');
  const hasNewLink = /新链|新链接/.test(compact);
  const hasWriteVerb = /铺|补|新建|创建|生成|新增|复制|批量/.test(compact);
  return hasNewLink && hasWriteVerb;
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

async function agentPlannerResponse(
  message: string,
  outputDir: string,
  options: HandleBotIntentOptions,
): Promise<BotResponse | null> {
  if (!options.agentPlannerProvider) return null;
  const rawProposal = await options.agentPlannerProvider.proposePlan({
    message,
    tools: listAgentPlannerTools(),
    workflows: listAgentWorkflows(),
  });
  const parsed = validateAgentPlannerProposal(rawProposal);
  if (!parsed.ok) {
    const workflowParsed = validateAgentWorkflowPlannerProposal(rawProposal);
    if (!workflowParsed.ok) return null;
    if (workflowParsed.proposal.selectedWorkflow !== NEW_LINK_BATCH_WORKFLOW_NAME) return null;
    const workflowRequest = readNewLinkBatchWorkflowRequest(workflowParsed.proposal.arguments);
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
    return executeAgentToolRequest(request, outputDir, { rentalPriceClient: options.rentalPriceClient });
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

  if (intent.type === 'sync_closed_order_feedback') {
    const result = await syncClosedOrderFeedbackFromApi(
      closedOrderIngestStatePath(outputDir),
      process.env,
      20,
      options.closedOrderFetchImpl ?? fetch,
    );
    return { text: formatClosedOrderSyncSummary(result) };
  }

  if (intent.type === 'run_closed_order_observation_report') {
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

  if (intent.type === 'latest_summary') {
    const latest = await findLatestReportContext(outputDir);
    return { text: latest ? formatLatestSummary(latest.context) : '还没有找到公域日报上下文。' };
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

  if (intent.type === 'run_public_traffic_report') {
    if (running) return { text: '公域日报正在运行中，请稍后再试。' };
    running = true;
    try {
      await runPublicTrafficReportCli();
      return { text: '公域日报已生成并发送。' };
    } finally {
      running = false;
    }
  }

  if (intent.type === 'push_latest_report_to_group') {
    const latest = await findLatestReportContext(outputDir);
    if (!latest) return { text: '还没有找到可推送的公域日报。' };
    const card = buildPublicTrafficCard(latest.context, { markdownPath: '', workbookPath: '' });
    const fallbackText = buildPublicTrafficFeishuText(latest.context, { markdownPath: '', workbookPath: '' });
    const result = await sendFeishuCard({ ...process.env, FEISHU_SEND_TO: 'group' }, card, fallbackText);
    return { text: result.sent ? '最新公域日报已推送到群。' : `公域日报推送到群失败：${result.reason}` };
  }

  if (intent.type === 'resend_latest_report') {
    const latest = await findLatestReportContext(outputDir);
    if (!latest) return { text: '还没有找到可重发的公域日报。' };
    const card = buildPublicTrafficCard(latest.context, { markdownPath: '', workbookPath: '' });
    const fallbackText = buildPublicTrafficFeishuText(latest.context, { markdownPath: '', workbookPath: '' });
    const env = intent.sendTo ? { ...process.env, FEISHU_SEND_TO: intent.sendTo } : process.env;
    const result = await sendFeishuCard(env, card, fallbackText);
    return { text: result.sent ? '最新公域日报已重发。' : `公域日报重发失败：${result.reason}` };
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

    const plannedResponse = await agentPlannerResponse(intent.text, outputDir, options);
    if (plannedResponse) return plannedResponse;
    if (looksLikeNewLinkWriteIntent(intent.text)) {
      return { text: options.agentPlannerProvider ? NEW_LINK_WRITE_INTENT_PLAN_FAILED : NEW_LINK_WRITE_INTENT_NEEDS_LLM };
    }

    const dataIntent = parseAgentDataIntent(intent.text);
    const tool = findReadOnlyTool(dataIntent);
    const latest = await findLatestReportContext(outputDir);
    if (tool && latest) return tool.run(latest.context, dataIntent);

    if (tool) return { text: '还没有找到公域日报上下文。' };
    if (!options.llmToolSelector) return { text: UNKNOWN_GUIDANCE };
    if (!latest) return { text: '还没有找到公域日报上下文。' };

    const rawSelection = await options.llmToolSelector.selectTool({ message: intent.text, tools: getRegistryBackedLlmTools() });
    const parsed = parseLlmToolSelection(rawSelection);
    if (!parsed.ok || parsed.selection.tool === 'none' || parsed.selection.tool === 'get_supported_questions') return { text: UNKNOWN_GUIDANCE };
    const result = await runReadOnlyToolSelection(latest.context, parsed.selection);
    return result.ok ? result.response : { text: UNKNOWN_GUIDANCE };
  }

  return { text: UNKNOWN_GUIDANCE };
}
