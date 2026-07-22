import { basename, dirname } from 'node:path';
import { buildAgentToolConfirmCard, buildAgentToolConfirmValue } from '../agentRuntime/approvalCard.js';
import type { AgentAuditDependencies } from '../agentRuntime/types.js';
import type { SelectedAuditToolName } from '../audit/config.js';
import { saveConfirmationContext, type ConfirmationAuditToolName, type SaveConfirmationContextInput } from '../audit/confirmationContextStore.js';
import { classifySelectedToolException, mapSelectedToolDomainOutcome, type SelectedToolDomainFacts } from '../audit/domainMapper.js';
import { pseudonymizeAuditUserId } from '../audit/event.js';
import type { AuditContext } from '../audit/types.js';
import { isAuditSpanWriter, type AuditSpanWriter, type AuditWriter } from '../audit/auditLogger.js';
import { buildAgentClarificationCard } from '../agentRuntime/clarificationCard.js';
import type { AgentClarificationRequest } from '../agentRuntime/clarificationCard.js';
import { decideAgentPolicy } from '../agentRuntime/policy.js';
import { gateByConfidence, isClarifyDepthExceeded } from '../agentRuntime/intentResolution.js';
import { isPreConfirmationPlanningTool } from '../agentRuntime/planningTools.js';
import { listAgentPlannerTools, schemaAllowsArguments, validateAgentMultiStepPlannerProposal, validateAgentPlannerClarificationProposal, validateAgentPlannerProposal, type AgentPlannerProvider } from '../agentRuntime/planner.js';
import { findAgentTool } from '../agentRuntime/toolRegistry.js';
import { buildAgentLearningPlannerHints, summarizeAgentLearning } from '../agentLearning/store.js';
import { parseAgentDataIntent } from '../agentData/intent.js';
import { rankBestProductByRegistryQuery } from '../agentData/productRanking.js';
import { loadClosedOrderRegistryContext, type ClosedOrderRegistryPathsInput } from '../closedOrderFeedback/runtime.js';
import { queryInventoryStatus } from '../inventoryStatus/query.js';
import { readInventorySameSkuSnapshotHistory } from '../inventoryStatus/history.js';
import { readInventorySameSkuSnapshot } from '../inventoryStatus/store.js';
import {
  buildNewLinkBatchConfirmCard,
  buildNewLinkBatchPlan,
  formatNewLinkBatchPlan,
} from '../newLinkWorkflow/batch.js';
import { openLinkRegistryGovernancePrompt } from '../linkRegistry/governanceSession.js';
import { openLinkRegistryMaintenancePrompt } from '../linkRegistry/maintenanceSession.js';
import { refreshLinkRegistryForPrompt } from '../linkRegistry/promptRefresh.js';
import type { fetchDaemonCatalogSnapshot } from '../linkRegistry/daemonCatalog.js';
import { createLinkRegistry } from '../linkRegistry/store.js';
import type { LinkRegistryEntry } from '../linkRegistry/types.js';
import { startOperationsLearningSession, summarizeOperationsLearningHistory, summarizeOperationsLearningSession } from '../operationsLearningLoop/session.js';
import { buildPublicTrafficPaths } from '../publicTraffic/paths.js';
import {
  buildActivityAutomationCard,
  buildCancelDifferentialPricingCardResult,
  type ActivityAutomationSkillClient,
} from './activityAutomation.js';
import { agentExploreResponse } from './agentExploreResponse.js';
import { continueAgentPlannerSteps, reviewAgentToolArguments } from './agentToolContinuation.js';
import { executeAgentToolRequest, type AgentToolExecutionOptions } from './agentToolExecutor.js';
import { clarificationConfirmationKey, saveClarificationContext } from './clarificationStore.js';
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
import type { LlmProvider } from '../llm/provider.js';
import {
  buildRentalOperationConfirmCard,
  createRentalPriceSkillClient,
  parseRentPriceFieldsFromText,
  rentalPriceChangeRequestFromToolArguments,
  type RentalOperationConfirmRequest,
  type RentalPriceChangeRequest,
  type RentalPriceSkillClient,
} from './rentalPrice.js';
import type { ReadOnlyToolRunOptions } from './readOnlyToolRegistry.js';
import { findLatestReportContext, findReportContextByDate, formatConversionSummary, formatLatestSummary, parseNumericProductIdList } from './reportStore.js';
import type { BotIntent, BotResponse } from './types.js';
import type { ResolutionCandidate } from '../agentRuntime/intentResolution.js';

const UNKNOWN_GUIDANCE = '我现在可以查：今日概况、商品、新链接池、待处理任务、转化差、曝光低、高潜力、失活链接、下架链接、订单情况。你可以问“新链接池怎么样”或“查一下721”。';
const NEW_LINK_WRITE_INTENT_NEEDS_LLM =
  '这像是新链批量铺设写操作，需要 LLM Agent planner 先理解参数并生成飞书确认卡。当前没有可用计划，所以不会执行，也不会把它当作新链接池查询。请配置 MT_AGENT_LLM_BASE_URL / MT_AGENT_LLM_MODEL 后重启 PM2，或换成明确的只读问题。';
const NEW_LINK_WRITE_INTENT_PLAN_FAILED =
  '这像是新链批量铺设写操作，但 Agent planner 没有生成有效的新链批量铺设计划。为避免误执行或误答只读新链接池，本次不执行；请换个说法或检查 LLM 输出。';
const LEGACY_WORKFLOW_PLAN_REJECTED =
  'Agent planner 返回了 legacy workflow 格式（selectedWorkflow），但当前飞书路径只接受 registered tool 或 steps 多步骤计划。未执行任何操作；请让 LLM 改为 selectedTool 或 steps。';

function pricePreviewArgumentsFromChangeRequest(request: RentalPriceChangeRequest): Record<string, unknown> {
  if (request.mode === 'explicit_fields') return { productIds: [request.productId], fields: request.fields };
  if (request.mode === 'global_discount') return { productIds: [request.productId], discount: request.discount, scope: request.scope };
  return { productIds: [request.productId], adjustmentAmount: request.adjustmentAmount, scope: request.scope };
}

const AMBIGUOUS_WRITE_ACTION_PATTERN = /(处理|操作|弄|搞|看着办|整一下|整一整)/;
const EXPLICIT_ACTION_PATTERN = /(下架|复制|改价|补链|铺链|新链|租期|规格|查|查询|库存|状态|ID查询|(?<!着)看(?!着办))/;

export function shouldForceClarificationBeforePlanner(text: string): boolean {
  const compact = text.replace(/\s+/g, '');
  const internalIds = compact.match(/(?<!\d)\d{3,6}(?!\d)/g) ?? [];
  return internalIds.length >= 1
    && AMBIGUOUS_WRITE_ACTION_PATTERN.test(compact)
    && !EXPLICIT_ACTION_PATTERN.test(compact);
}

function forcedClarificationProductId(text: string): string | null {
  const compact = text.replace(/\s+/g, '');
  const internalIds = compact.match(/(?<!\d)\d{3,6}(?!\d)/g) ?? [];
  return internalIds.length >= 1 ? internalIds.join('/') : null;
}

function forcedPrePlannerClarification(text: string, outputDir: string, priorDepth = 0): Promise<BotResponse> {
  const productId = forcedClarificationProductId(text) ?? '该商品';
  return clarificationResponse({
    originalMessage: text,
    question: `你想对 ${productId} 做什么？`,
    reason: '用户给了明确商品ID，但动作是模糊高风险操作，需要先澄清，不能由 planner 猜业务工具。',
    options: [
      { label: '下架', message: `把 ${productId} 下架`, description: '进入下架确认流程' },
      { label: '复制', message: `复制 ${productId}`, description: '进入复制确认流程' },
      { label: '改价', message: `修改 ${productId} 价格`, description: '进入改价确认流程' },
      { label: '先查看信息', message: `查 ${productId}`, description: '只读查看商品状态' },
    ],
  }, [
    { toolName: 'agent.clarifiedMessage', arguments: { message: `把 ${productId} 下架` }, label: '下架', description: '进入下架确认流程' },
    { toolName: 'agent.clarifiedMessage', arguments: { message: `复制 ${productId}` }, label: '复制', description: '进入复制确认流程' },
    { toolName: 'agent.clarifiedMessage', arguments: { message: `修改 ${productId} 价格` }, label: '改价', description: '进入改价确认流程' },
    { toolName: 'agent.clarifiedMessage', arguments: { message: `查 ${productId}` }, label: '先查看信息', description: '只读查看商品状态' },
  ], 0.3, outputDir, priorDepth);
}

function declineUnknownIntent(): BotResponse {
  return {
    text: `我没理解你的意图，请换种说法或用精确命令。\n${UNKNOWN_GUIDANCE}`,
    metadata: { ok: false, declined: true },
  };
}

function declineClarificationLoop(depth: number): BotResponse {
  return {
    text: '我还是没法确定你的意图，请直接说明要操作的商品、动作、数量、金额或日期；本次没有执行任何操作。',
    metadata: { ok: false, declined: true, clarificationDepth: depth },
  };
}

function readConfidenceThreshold(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) return value;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : undefined;
}

function confidenceGateOptions(options: HandleBotIntentOptions) {
  return {
    executeThreshold: options.confidenceExecuteThreshold
      ?? readConfidenceThreshold(process.env.MT_AGENT_INTENT_CONFIDENCE_THRESHOLD),
  };
}

function completePlannerPriceArguments(toolName: string, args: Record<string, unknown>, contextText: string): Record<string, unknown> {
  if ((toolName !== 'rental.priceChange' && toolName !== 'rental.pricePreview') || args.fields !== undefined || args.discount !== undefined || args.adjustmentAmount !== undefined) {
    return args;
  }
  const fields = parseRentPriceFieldsFromText(contextText);
  return Object.keys(fields).length > 0 ? { ...args, fields } : args;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requiredFieldsForTool(toolName: string): string[] {
  const schema = findAgentTool(toolName)?.inputSchema;
  if (!isRecord(schema) || !Array.isArray(schema.required)) return [];
  return schema.required.filter((item): item is string => typeof item === 'string');
}

async function clarificationResponse(
  request: AgentClarificationRequest,
  candidates: ResolutionCandidate[],
  confidence: number,
  outputDir: string,
  priorDepth = 0,
): Promise<BotResponse> {
  if (isClarifyDepthExceeded(priorDepth)) return declineClarificationLoop(priorDepth);
  const depth = priorDepth + 1;
  const candidateOptions = candidates.map((candidate) => ({
    label: candidate.label,
    message: request.originalMessage,
    ...(candidate.description ? { description: candidate.description } : {}),
  }));
  const context = {
    originalMessage: request.originalMessage,
    question: request.question,
    reason: request.reason,
    candidates,
    depth,
    confidence,
  };
  const clarificationRef = await saveClarificationContext(outputDir, context);
  return {
    text: request.question,
    card: buildAgentClarificationCard({ ...request, options: candidateOptions }, {
      clarificationRef,
      confirmationKey: clarificationConfirmationKey(context),
    }),
    metadata: { ok: false, needsClarification: true },
  };
}

async function invalidPlannerArgumentsClarification(rawProposal: string, message: string, outputDir: string, options: HandleBotIntentOptions): Promise<BotResponse | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawProposal);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const goal = readNonEmptyString(parsed.goal) ?? '执行用户目标';
  const reason = readNonEmptyString(parsed.reason) ?? 'LLM 返回的工具参数没有通过 schema 校验';
  const selectedTool = readNonEmptyString(parsed.selectedTool);
  const invalidStep = Array.isArray(parsed.steps)
    ? parsed.steps.find((step) => {
      if (!isRecord(step)) return false;
      const toolName = readNonEmptyString(step.toolName);
      const args = isRecord(step.arguments) ? step.arguments : null;
      const tool = toolName ? findAgentTool(toolName) : undefined;
      return Boolean(toolName && tool && (!args || !schemaAllowsArguments(tool.inputSchema, args, { allowPlaceholders: true })));
    })
    : null;
  const fallbackStep = Array.isArray(parsed.steps)
    ? parsed.steps.find((step) => isRecord(step) && readNonEmptyString(step.toolName))
    : null;
  const stepTool = isRecord(invalidStep)
    ? readNonEmptyString(invalidStep.toolName)
    : isRecord(fallbackStep) ? readNonEmptyString(fallbackStep.toolName) : null;
  const toolName = selectedTool ?? stepTool;
  if (!toolName) return null;
  const selected = findAgentTool(toolName);
  if (!selected) return null;
  await options.activateAudit?.(toolName);

  const required = requiredFieldsForTool(toolName);
  const question = selectedTool
    ? `我理解你要调用 ${toolName}，但工具参数不完整或格式不安全，需要你确认。`
    : `我已生成多步骤计划，但 ${toolName} 的参数不完整或格式不安全，需要你确认。`;

  const args = isRecord(parsed.arguments) ? parsed.arguments : {};
  const supplementMessage = `${message}\n补充说明：请补齐 ${toolName} 的必要参数`;
  const supplementDescription = required.length ? `需要：${required.join('、')}` : '补充目标、对象、数量或日期等关键参数';
  return clarificationResponse({
      originalMessage: message,
      question,
      reason: `${goal}；${reason}${required.length ? `；必填参数：${required.join('、')}` : ''}`,
      options: [
        {
          label: '补充参数',
          message: supplementMessage,
          description: supplementDescription,
        },
        {
          label: '重新规划',
          message,
          description: '让 Agent 重新理解并选择工具',
        },
      ],
    }, [
      { toolName, arguments: args, label: '补充参数', description: supplementDescription },
      { toolName: 'agent.clarifiedMessage', arguments: { message }, label: '重新规划', description: '让 Agent 重新理解并选择工具' },
    ], 0.3, outputDir, options.clarificationDepth);
}

const HELP_TEXT = `📋 查询与分析
  今日概况 — 查看最新公域日报概况
  看 2026-06-22 的日报 / 查昨天日报 — 查看指定日期公域日报
  2026-06-22 的转化率多少 — 查看指定日期转化率漏斗
  2026-06-22 访问最高的前20个商品 — 查询日报商品排行
  733 的所有日报数据 / 2026-06-22 较前日变化多少 — 查询商品全量明细或较前日变化
  托管异常有哪些 / 各问题池分别多少条 / 订单签约发货率 / 关单率 / 客单价 — 查询日报问题池和订单分析
  查询 565 / 查 433,798 — 查询单个或多个端内ID表现
  2026-06-22 查询 733 — 查询指定日期的商品表现
  s23u最好的链接是哪条 — 按链接档案找同款组里数据最好的端内ID
  x200u的定价情况怎么样 — 按同款组汇总SKU平均租金
  查ID 565 / 商品ID互查 — 端内ID与平台商品ID互查
  库存情况 / 库存情况 pocket3 — 查看库存与同款组状态
  链接维护 / 组级治理 / 链接档案维护 — 主动呼出链接维护或组级治理卡片
  新链接池怎么样 / 待处理任务 / 失活链接 / 下架链接 / 订单情况 — 查询运营数据池

📊 报表与数据
  跑日报 — 生成公域流量日报
  抓取访问页数据 — 补抓访问页/后链路数据
  重发日报 — 重新发送最新日报
  重发 2026-06-22 日报 / 推送 2026-06-22 日报到群 — 发送指定日期已有日报
  2026-06-22 访问最高的前20个商品 / Pocket 3 的7日访问总和是多少 / 访问页缺失哪些商品 — 查询已保存日报数据
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
  876 全局改价 0.9 — 仅对租金字段生成改价审计预览和确认卡
  改价 761 1天22 10天55 — 指定租期改价
  改价 761 押金300 — 非租金字段必须精准点名，确认后才会执行
  回滚 task_xxxx — 按改价审计任务回滚到该任务执行前

🔧 商品操作
  复制商品 761 / 从端内ID 848复制3条新链 — 复制或铺新链
  下架商品 761 — 下架商品
  设置租期 761 1,10,30 — 设置租期天数
  查看规格 761 — 查看商品规格维度与项目
  添加规格 761 1355 128G — 添加规格项

🛡️ 安全规则
  涉及商品修改的操作会先弹确认卡；取消后不会执行
  跑日报、补抓访问页也会先弹确认卡
  重发日报、推群、关单同步等非商品修改操作会直接执行
  商品ID、数量、规格层级不明确时会先澄清
  Agent学习汇总 — 查看 Agent 澄清与确认学习记录
  帮助 — 显示此帮助信息`;

export interface HandleBotIntentOptions {
  llmToolSelector?: LlmToolSelectionProvider;
  llmIntentProposalProvider?: LlmIntentProposalProvider;
  agentPlannerProvider?: AgentPlannerProvider;
  agentExploreProvider?: LlmProvider;
  rentalPriceClient?: RentalPriceSkillClient;
  activityAutomationClient?: ActivityAutomationSkillClient;
  closedOrderFetchImpl?: typeof fetch;
  closedOrderRegistryPaths?: ClosedOrderRegistryPathsInput;
  daemonCatalogFetcher?: typeof fetchDaemonCatalogSnapshot;
  clarificationDepth?: number;
  confidenceExecuteThreshold?: number;
  auditContext?: AuditContext;
  auditLogger?: AuditWriter;
  activateAudit?: AgentAuditDependencies['activateAudit'];
  confirmationContextStore?: ConfirmationContextStore;
}

export interface ConfirmationContextStore {
  save(input: SaveConfirmationContextInput): Promise<unknown>;
}

function auditExecutionOptions(options: HandleBotIntentOptions): Pick<AgentToolExecutionOptions, 'auditContext' | 'auditLogger' | 'activateAudit'> {
  return {
    ...(options.auditContext ? { auditContext: options.auditContext } : {}),
    ...(options.auditLogger ? { auditLogger: options.auditLogger } : {}),
    ...(options.activateAudit ? { activateAudit: options.activateAudit } : {}),
  };
}

type DirectAuditToolName = Extract<SelectedAuditToolName, 'publicTraffic.latestSummary' | 'publicTraffic.conversionSummary'>;
type DirectAuditOutcomeCapture = (facts: SelectedToolDomainFacts) => void;

function activateAuditBestEffort(options: HandleBotIntentOptions, toolName: DirectAuditToolName): Promise<AuditContext | undefined> {
  try {
    const activated = options.activateAudit?.(toolName);
    return activated === undefined ? Promise.resolve(undefined) : activated.catch((_error) => undefined);
  } catch (_error) {
    return Promise.resolve(undefined);
  }
}

function activateToolAuditBestEffort(options: HandleBotIntentOptions, toolName: string): Promise<AuditContext | undefined> {
  try {
    const activated = options.activateAudit?.(toolName);
    return activated === undefined ? Promise.resolve(undefined) : activated.catch((_error) => undefined);
  } catch (_error) {
    return Promise.resolve(undefined);
  }
}

function startDirectToolSpan(
  writer: AuditSpanWriter,
  toolName: DirectAuditToolName,
  context: AuditContext,
): Promise<Awaited<ReturnType<AuditSpanWriter['start']>> | undefined> {
  try {
    return writer.start({
      traceId: context.traceId,
      toolName,
      context,
      resultSummary: 'selected_tool_started',
      tags: ['selected_tool'],
    }).then((handle) => handle.startRecordResult?.ok === false ? undefined : handle, (_error) => undefined);
  } catch (_error) {
    return Promise.resolve(undefined);
  }
}

async function endDirectToolSpan(
  writer: AuditSpanWriter,
  handle: Awaited<ReturnType<typeof startDirectToolSpan>>,
  facts: SelectedToolDomainFacts | undefined,
): Promise<void> {
  if (handle === undefined) return;
  let mapping;
  try {
    mapping = mapSelectedToolDomainOutcome(facts ?? { toolName: handle.toolName as DirectAuditToolName, kind: 'unknown_fallback' });
  } catch (_error) {
    mapping = mapSelectedToolDomainOutcome({ toolName: handle.toolName as DirectAuditToolName, kind: 'unknown_fallback' });
  }
  try {
    await writer.end(handle, mapping);
  } catch (_error) {
    return;
  }
}

async function errorDirectToolSpan(
  writer: AuditSpanWriter,
  handle: Awaited<ReturnType<typeof startDirectToolSpan>>,
  error: unknown,
): Promise<void> {
  if (handle === undefined) return;
  try {
    const mapping = classifySelectedToolException(error);
    await writer.error(handle, { ...mapping, error });
  } catch (_error) {
    return;
  }
}

async function withAuditedDirectIntent(
  toolName: DirectAuditToolName,
  options: HandleBotIntentOptions,
  run: (capture: DirectAuditOutcomeCapture) => Promise<BotResponse>,
): Promise<BotResponse> {
  const activatedContext = await activateAuditBestEffort(options, toolName);
  const auditContext = options.activateAudit === undefined ? options.auditContext : activatedContext;
  if (auditContext === undefined || !isAuditSpanWriter(options.auditLogger)) {
    return run(() => undefined);
  }

  const writer = options.auditLogger;
  const handle = await startDirectToolSpan(writer, toolName, auditContext);
  let outcomeFacts: SelectedToolDomainFacts | undefined;
  try {
    const response = await run((facts) => {
      outcomeFacts = facts;
    });
    await endDirectToolSpan(writer, handle, outcomeFacts);
    return response;
  } catch (error) {
    await errorDirectToolSpan(writer, handle, error);
    throw error;
  }
}

function directReportOutcome(toolName: DirectAuditToolName, reportDate: string | undefined, found: boolean): SelectedToolDomainFacts {
  if (found && reportDate !== undefined) return { toolName, kind: 'report_success', reportDate };
  return { toolName, kind: 'report_missing', ...(reportDate !== undefined ? { reportDate } : {}) };
}

function parseAgentExploreInstruction(text: string): string | null {
  const match = /^(?:探索|分析)\s+(.+)$/.exec(text.trim());
  return match?.[1]?.trim() || null;
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
      return { action: 'spec-add-and-refresh', productId: intent.productId, specDimId: intent.specDimId, itemTitle: intent.itemTitle };
    default:
      return null;
  }
}

function rentalOperationConfirmResponse(request: RentalOperationConfirmRequest, reason: string): BotResponse {
  return { text: `请确认租赁商品操作：${request.productId}`, card: buildRentalOperationConfirmCard(request, reason) };
}

const defaultConfirmationContextStore: ConfirmationContextStore = Object.freeze({
  save: (input: SaveConfirmationContextInput) => saveConfirmationContext(input),
});

function isConfirmationAuditToolName(toolName: string): toolName is ConfirmationAuditToolName {
  return toolName === 'publicTraffic.runReport' || toolName === 'publicTraffic.refreshDashboard';
}

function confirmationEntityFor(toolName: ConfirmationAuditToolName, args: Record<string, unknown>): SaveConfirmationContextInput['entity'] | undefined {
  if (toolName !== 'publicTraffic.refreshDashboard') return undefined;
  return typeof args.date === 'string' ? { type: 'report', id: args.date } : undefined;
}

function agentToolConfirmResponse(toolName: string, args: Record<string, unknown>, reason: string): BotResponse {
  const request = { toolName, arguments: args, reason };
  return {
    text: `请确认 Agent 操作：${toolName}`,
    card: buildAgentToolConfirmCard(request),
  };
}

async function saveInitialConfirmationContextBestEffort(input: {
  toolName: ConfirmationAuditToolName;
  args: Record<string, unknown>;
  reason: string;
  auditContext: AuditContext | undefined;
  options: HandleBotIntentOptions;
  entity?: SaveConfirmationContextInput['entity'];
}): Promise<BotResponse> {
  const request = { toolName: input.toolName, arguments: input.args, reason: input.reason };
  const response: BotResponse = {
    text: `请确认 Agent 操作：${input.toolName}`,
    card: buildAgentToolConfirmCard(request),
  };
  if (input.auditContext === undefined) return response;
  try {
    const initiatorUserId = pseudonymizeAuditUserId(input.auditContext);
    await (input.options.confirmationContextStore ?? defaultConfirmationContextStore).save({
      confirmationKey: buildAgentToolConfirmValue(request).confirmationKey,
      traceId: input.auditContext.traceId,
      toolName: input.toolName,
      source: input.auditContext.source,
      ...(input.entity !== undefined ? { entity: input.entity } : {}),
      ...(initiatorUserId !== undefined ? { initiatorUserId } : {}),
    });
  } catch (_error) {
    return response;
  }
  return response;
}

function executeDirectAgentToolResponse(
  toolName: string,
  args: Record<string, unknown>,
  reason: string,
  outputDir: string,
  options: HandleBotIntentOptions,
): Promise<BotResponse> {
  return executeAgentToolRequest(
    { toolName, arguments: args, reason },
    outputDir,
    {
      rentalPriceClient: options.rentalPriceClient,
      closedOrderFetchImpl: options.closedOrderFetchImpl,
      closedOrderRegistryPaths: options.closedOrderRegistryPaths,
      agentExploreProvider: options.agentExploreProvider,
      daemonCatalogFetcher: options.daemonCatalogFetcher,
      ...auditExecutionOptions(options),
    },
  );
}

export async function executeOrConfirmAgentToolRequest(
  request: { toolName: string; arguments: Record<string, unknown>; reason: string },
  outputDir: string,
  options: HandleBotIntentOptions = {},
): Promise<BotResponse> {
  const tool = findAgentTool(request.toolName);
  if (!tool) return { text: `Agent 工具不存在：${request.toolName}`, metadata: { toolName: request.toolName, ok: false } };
  const activatedAuditContext = await activateToolAuditBestEffort(options, request.toolName);

  const reviewed = await reviewAgentToolArguments({
    toolName: request.toolName,
    args: request.arguments,
    contextText: request.reason,
    sourceText: request.reason,
    reason: request.reason,
    outputDir,
    clarificationDepth: options.clarificationDepth,
  });
  if (!reviewed.ok) return reviewed.response;
  const completedArguments = reviewed.args;
  const completedRequest = { ...request, arguments: completedArguments };

  if (request.toolName === 'rental.priceChange') {
    const rentalRequest = rentalPriceChangeRequestFromToolArguments(completedArguments);
    if (!rentalRequest) return { text: '租赁商品改价参数无效：需要 productId，并提供 fields 或 discount。' };
    return executeAgentToolRequest(
      { toolName: 'rental.pricePreview', arguments: pricePreviewArgumentsFromChangeRequest(rentalRequest), reason: request.reason },
      outputDir,
      { rentalPriceClient: options.rentalPriceClient, closedOrderFetchImpl: options.closedOrderFetchImpl, closedOrderRegistryPaths: options.closedOrderRegistryPaths, agentExploreProvider: options.agentExploreProvider, ...auditExecutionOptions(options) },
    );
  }
  if (isPreConfirmationPlanningTool(request.toolName)) {
    return executeAgentToolRequest(completedRequest, outputDir, {
      rentalPriceClient: options.rentalPriceClient,
      closedOrderFetchImpl: options.closedOrderFetchImpl,
      closedOrderRegistryPaths: options.closedOrderRegistryPaths,
      agentExploreProvider: options.agentExploreProvider,
      daemonCatalogFetcher: options.daemonCatalogFetcher,
      ...auditExecutionOptions(options),
    });
  }
  const policy = decideAgentPolicy({ tool, input: completedArguments, reason: request.reason });
  if (policy.decision === 'allow') {
    return executeAgentToolRequest(completedRequest, outputDir, {
      rentalPriceClient: options.rentalPriceClient,
      closedOrderFetchImpl: options.closedOrderFetchImpl,
      closedOrderRegistryPaths: options.closedOrderRegistryPaths,
      agentExploreProvider: options.agentExploreProvider,
      daemonCatalogFetcher: options.daemonCatalogFetcher,
      ...auditExecutionOptions(options),
    });
  }
  if (isConfirmationAuditToolName(request.toolName)) {
    return saveInitialConfirmationContextBestEffort({
      toolName: request.toolName,
      args: completedArguments,
      reason: request.reason,
      auditContext: activatedAuditContext,
      options,
      ...(confirmationEntityFor(request.toolName, completedArguments) !== undefined ? { entity: confirmationEntityFor(request.toolName, completedArguments) } : {}),
    });
  }
  return {
    text: `请确认 Agent 操作：${request.toolName}`,
    card: buildAgentToolConfirmCard(completedRequest),
  };
}

async function findReportContextForIntent(outputDir: string, date?: string) {
  return date ? findReportContextByDate(outputDir, date) : findLatestReportContext(outputDir);
}

function missingReportContextText(date?: string): string {
  return date ? `没有找到 ${date} 的公域日报上下文。` : '还没有找到公域日报上下文。';
}

function currentLocalDate(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

type LinkRegistryPromptMode = 'maintenance' | 'governance' | 'hub';

async function handleLinkRegistryPromptIntent(
  mode: LinkRegistryPromptMode,
  outputDir: string,
  options: HandleBotIntentOptions,
  maintenanceSourceMode?: 'daemon_only',
): Promise<BotResponse> {
  const date = currentLocalDate();
  let registryContext = await loadClosedOrderRegistryContext(options.closedOrderRegistryPaths);
  let promptSummary: Awaited<ReturnType<typeof refreshLinkRegistryForPrompt>>['summary'] | undefined;

  if (!options.closedOrderRegistryPaths && (mode === 'maintenance' || mode === 'hub')) {
    try {
      const refreshed = await refreshLinkRegistryForPrompt(outputDir, date, {
        mode: maintenanceSourceMode === 'daemon_only' ? 'daemon_only' : 'default',
      });
      registryContext = refreshed.registryContext;
      promptSummary = refreshed.summary;
    } catch {
      // Fall back to the current local registry when on-demand refresh is unavailable.
    }
  }

  const maintenance = async () => openLinkRegistryMaintenancePrompt(outputDir, {
    date,
    registry: registryContext.registry,
    referenceDate: date,
    overridesPath: registryContext.resolvedPaths.overridesPath,
    force: true,
    ...(promptSummary ? { promptSummary } : {}),
    ...(options.agentExploreProvider ? { llmProvider: options.agentExploreProvider } : {}),
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

function rollbackTaskConfirmResponse(text: string): BotResponse | null {
  if (!/回滚|rollback/i.test(text)) return null;
  const taskId = /\btask_\d+_[a-f0-9]+\b/i.exec(text)?.[0];
  const productId = /(?:商品|端内ID|productId)\s*(\d+)/i.exec(text)?.[1];
  if (!taskId) return null;
  return agentToolConfirmResponse(
    'rental.priceRollback',
    {
      ...(productId ? { productId } : {}),
      taskId,
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

function formatLinkRegistryStatus(entry: LinkRegistryEntry): string {
  if (entry.listingState === 'delisted') return '已下架（上架后可操作）';
  if (entry.listingState === 'gone') return '链接不存在（总表缺失）';
  if (entry.status === 'active') return '在架';
  if (entry.status === 'removed') return '已下架';
  return '未知';
}

function formatRegistryProductRows(productIds: string[], entries: LinkRegistryEntry[]): string {
  const entryById = new Map(entries.map((entry) => [entry.internalProductId, entry]));
  const lines = productIds.map((productId) => {
    const entry = entryById.get(productId);
    if (!entry) return `端内ID ${productId}\n未在链接档案中找到`;
    const name = entry.productName ?? entry.shortName ?? '未命名商品';
    const platform = entry.platformProductId ? `平台商品ID ${entry.platformProductId}` : '平台商品ID 未记录';
    return `端内ID ${entry.internalProductId} ${name}\n${platform}，状态 ${formatLinkRegistryStatus(entry)}`;
  });
  return lines.join('\n\n');
}

interface BestLinkNewLinkComboRequest {
  keyword: string;
  count: number;
}

function readSmallChineseCount(value: string): number | null {
  const normalized = value.trim().replace(/两/g, '二');
  const digits: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (normalized === '十') return 10;
  const teen = /^十([一二三四五六七八九])$/.exec(normalized);
  if (teen) return 10 + digits[teen[1]!];
  const tens = /^([一二三四五六七八九])十([一二三四五六七八九])?$/.exec(normalized);
  if (tens) return digits[tens[1]!] * 10 + (tens[2] ? digits[tens[2]] : 0);
  return digits[normalized] ?? null;
}

function extractNewLinkBatchCount(text: string): number | null {
  const patterns = [
    /(?:复制|铺设|铺|新增|新建|创建|生成)\s*(\d{1,3})\s*条/u,
    /(\d{1,3})\s*条\s*(?:新链|链接)?/u,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return Number(match[1]);
  }

  const chinesePatterns = [
    /(?:复制|铺设|铺|新增|新建|创建|生成)\s*([一二两三四五六七八九十]{1,3})\s*条/u,
    /([一二两三四五六七八九十]{1,3})\s*条\s*(?:新链|链接)?/u,
  ];
  for (const pattern of chinesePatterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return readSmallChineseCount(match[1]);
  }
  return null;
}

function cleanBestLinkKeyword(value: string): string | null {
  const keyword = value
    .replace(/^[\s，,。；;?？!！]*(?:按|根据|基于|用|以)\s*/u, '')
    .replace(/\s*(?:的)?\s*(?:端内\s*id|id|链接|商品)\s*(?:是多少|是哪个|是哪条|哪个|哪条)?\s*$/iu, '')
    .replace(/\s*(?:新链|链接)\s*$/u, '')
    .trim();
  return keyword ? keyword : null;
}

function parseBestLinkKeywordFromSegment(segment: string): string | null {
  const cleanedSegment = segment
    .replace(/^[\s，,。；;?？!！]*(?:按|根据|基于|用|以)\s*/u, '')
    .replace(/\s*(?:链接|商品)\s*$/u, '')
    .trim();
  if (!cleanedSegment) return null;

  const dataIntent = parseAgentDataIntent(cleanedSegment);
  if (dataIntent.type === 'best_product_by_same_sku') return cleanBestLinkKeyword(dataIntent.query);

  const match = /(?:数据|表现)\s*(?:最好|最佳|最优|最强)\s*的?\s*(.+?)(?:\s*的?\s*(?:端内\s*id|id|链接|商品)|[?？,，。；;!！]|按|根据|基于|用|以|给我|帮我|复制|铺设|铺|新增|新建|创建|生成|$)/iu.exec(cleanedSegment);
  return match?.[1] ? cleanBestLinkKeyword(match[1]) : null;
}

function parseBestLinkNewLinkComboRequest(text: string): BestLinkNewLinkComboRequest | null {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!/(数据|表现|同款).*(最好|最佳|最优|最强)|(?:最好|最佳|最优|最强).*(?:链接|端内\s*id|同款)/iu.test(normalized)) return null;
  if (!/(复制|铺设|铺|新增|新建|创建|生成)/u.test(normalized) || !/(条|新链|链接)/u.test(normalized)) return null;

  const count = extractNewLinkBatchCount(normalized);
  if (!count) return null;

  const writeMatch = /(复制|铺设|铺|新增|新建|创建|生成)/u.exec(normalized);
  const prefix = writeMatch?.index !== undefined ? normalized.slice(0, writeMatch.index) : normalized;
  const beforeBestReference = normalized.split(/按\s*(?:最好|最佳|最优|最强)|根据\s*(?:最好|最佳|最优|最强)|基于\s*(?:最好|最佳|最优|最强)/u)[0] ?? normalized;
  const segments = [
    ...prefix.split(/[?？。；;!！]/u),
    beforeBestReference,
    normalized,
  ];

  for (const segment of segments) {
    const keyword = parseBestLinkKeywordFromSegment(segment);
    if (keyword && /[,，、]/u.test(keyword)) return null;
    if (keyword) return { keyword, count };
  }
  return null;
}

async function bestLinkNewLinkComboResponse(
  message: string,
  outputDir: string,
  options: HandleBotIntentOptions,
): Promise<BotResponse | null> {
  const request = parseBestLinkNewLinkComboRequest(message);
  if (!request) return null;

  const [latest, registryContext] = await Promise.all([
    findLatestReportContext(outputDir),
    loadClosedOrderRegistryContext(options.closedOrderRegistryPaths),
  ]);
  if (!latest) return { text: '还没有找到公域日报上下文，无法选择新链复制源商品。' };

  const registry = createLinkRegistry(registryContext.registry);
  const ranking = rankBestProductByRegistryQuery(latest.context, registry, request.keyword);
  if (ranking.status !== 'ranked') {
    return { text: `没有安全定位到「${request.keyword}」的数据最佳源商品，本次不会生成复制确认卡。可以换成更完整的商品名或直接给端内ID。` };
  }

  const plan = buildNewLinkBatchPlan(
    { keyword: request.keyword, count: request.count, sourceProductId: ranking.best.internalProductId },
    latest.context,
    registryContext.registry,
  );
  const reason = `用户要求先找「${request.keyword}」同款组数据最好的链接，再按该端内ID复制 ${request.count} 条新链。`;
  const text = [
    `已识别数据最佳源商品：端内ID ${ranking.best.internalProductId} ${ranking.best.productName}`,
    formatNewLinkBatchPlan(plan),
  ].join('\n\n');
  return {
    text,
    ...(plan.status === 'ready' ? { card: buildNewLinkBatchConfirmCard(plan, reason) } : {}),
  };
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
    query: intent.type === 'inventory_status_query' ? intent.query : '',
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

async function executeAgentMultiStepPlannerResponse(
  rawProposal: string,
  message: string,
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
    sourceText: message,
    clarificationDepth: options.clarificationDepth,
    options: {
      rentalPriceClient: options.rentalPriceClient,
      closedOrderFetchImpl: options.closedOrderFetchImpl,
      closedOrderRegistryPaths: options.closedOrderRegistryPaths,
      agentExploreProvider: options.agentExploreProvider,
      daemonCatalogFetcher: options.daemonCatalogFetcher,
      ...auditExecutionOptions(options),
    },
  });
}

function isAgentPlannerJsonFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /^(Invalid LLM JSON output|LLM output is empty|LLM output must be a bare JSON object|LLM JSON output must be an object)/.test(error.message);
}

async function agentPlannerResponse(
  message: string,
  outputDir: string,
  options: HandleBotIntentOptions,
): Promise<BotResponse | null> {
  if (!options.agentPlannerProvider) return null;
  const learningHints = await buildAgentLearningPlannerHints(outputDir, message);
  let rawProposal: string;
  try {
    rawProposal = await options.agentPlannerProvider.proposePlan({
      message,
      tools: listAgentPlannerTools(),
      workflows: [],
      ...(learningHints.length ? { learningHints } : {}),
    });
  } catch (error) {
    if (isAgentPlannerJsonFailure(error)) {
      return {
        text: 'Agent 暂时没有把这次指令或补充解析成可执行计划。请换一种说法，直接说明：商品/同款组、动作、金额或比例；本次没有执行任何写操作。',
        metadata: { toolName: 'agentPlanner', ok: false, errorType: 'llm_json_parse_failed' },
      };
    }
    throw error;
  }
  const parsed = validateAgentPlannerProposal(rawProposal);
  if (!parsed.ok) {
    if (/"selectedWorkflow"\s*:/.test(rawProposal)) return { text: LEGACY_WORKFLOW_PLAN_REJECTED };
    const multiStepResponse = await executeAgentMultiStepPlannerResponse(rawProposal, message, outputDir, options);
    if (multiStepResponse) return multiStepResponse;
    const clarificationParsed = validateAgentPlannerClarificationProposal(rawProposal);
    if (clarificationParsed.ok) {
      return clarificationResponse(clarificationParsed.proposal, clarificationParsed.proposal.candidates, clarificationParsed.proposal.confidence, outputDir, options.clarificationDepth);
    }
    return invalidPlannerArgumentsClarification(rawProposal, message, outputDir, options);
  }

  const plannerContextText = [message, parsed.proposal.reason].filter(Boolean).join('\n');
  const completedArguments = completePlannerPriceArguments(
    parsed.proposal.selectedTool,
    parsed.proposal.arguments,
    plannerContextText,
  );
  if (gateByConfidence(parsed.proposal.confidence, confidenceGateOptions(options)) === 'clarify') {
    await options.activateAudit?.(parsed.proposal.selectedTool);
    const candidate = {
      toolName: parsed.proposal.selectedTool,
      arguments: completedArguments,
      label: `执行 ${parsed.proposal.selectedTool}`,
      description: parsed.proposal.reason,
    };
    const question = `我理解你可能要调用 ${parsed.proposal.selectedTool}，但置信度不足，需要你确认。`;
    return clarificationResponse({
      originalMessage: message,
      question,
      reason: parsed.proposal.reason,
      options: [{ label: candidate.label, message, description: candidate.description }],
    }, [candidate], parsed.proposal.confidence, outputDir, options.clarificationDepth);
  }
  return executeOrConfirmAgentToolRequest({
    toolName: parsed.proposal.selectedTool,
    arguments: completedArguments,
    reason: parsed.proposal.reason,
  }, outputDir, options);
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
    return executeDirectAgentToolResponse('closedOrder.syncFeedback', {}, '明确飞书命令要求同步关单反馈；该操作不修改商品。', outputDir, options);
  }

  if (intent.type === 'run_closed_order_observation_report') {
    return executeDirectAgentToolResponse('closedOrder.runObservationReport', {}, '明确飞书命令要求生成关单观察报告；该操作不修改商品。', outputDir, options);
  }

  if (intent.type === 'latest_summary') {
    return withAuditedDirectIntent('publicTraffic.latestSummary', options, async (capture) => {
      const latest = await findReportContextForIntent(outputDir, intent.date);
      capture(directReportOutcome('publicTraffic.latestSummary', latest?.context.date ?? intent.date, Boolean(latest)));
      return { text: latest ? formatLatestSummary(latest.context) : missingReportContextText(intent.date) };
    });
  }

  if (intent.type === 'conversion_summary') {
    return withAuditedDirectIntent('publicTraffic.conversionSummary', options, async (capture) => {
      const latest = await findReportContextForIntent(outputDir, intent.date);
      capture(directReportOutcome('publicTraffic.conversionSummary', latest?.context.date ?? intent.date, Boolean(latest)));
      return { text: latest ? formatConversionSummary(latest.context) : missingReportContextText(intent.date) };
    });
  }

  if (intent.type === 'inventory_status_overview' || intent.type === 'inventory_status_query') {
    return handleInventoryStatusIntent(intent, outputDir, options);
  }

  if (intent.type === 'query_product') {
    const productIds = parseNumericProductIdList(intent.keyword);
    const response = await executeDirectAgentToolResponse('productLink.query', {
      queryType: productIds.length > 1 ? 'productList' : 'productDetail',
      productQuery: intent.keyword,
      ...(intent.date ? { date: intent.date } : {}),
    }, '本地精确商品查询统一委托商品/链接查询入口。', outputDir, options);
    if (response.metadata && typeof response.metadata === 'object' && 'count' in response.metadata && response.metadata.count !== 0) return response;

    if (intent.date) return response;
    if (productIds.length > 0) {
      const registryContext = await loadClosedOrderRegistryContext(options.closedOrderRegistryPaths);
      return { text: formatRegistryProductRows(productIds, registryContext.registry) };
    }
    return response;
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

  if (intent.type === 'link_registry_maintenance_prompt') {
    return handleLinkRegistryPromptIntent('maintenance', outputDir, options, intent.sourceMode);
  }

  if (intent.type === 'link_registry_governance_prompt') {
    return handleLinkRegistryPromptIntent('governance', outputDir, options);
  }

  if (intent.type === 'link_registry_maintenance_hub') {
    return handleLinkRegistryPromptIntent('hub', outputDir, options);
  }

  if (intent.type === 'rental_price_change') {
    return executeAgentToolRequest(
      { toolName: 'rental.pricePreview', arguments: pricePreviewArgumentsFromChangeRequest(intent.request), reason: `明确飞书命令请求商品 ${intent.productId} 改价。` },
      outputDir,
      { rentalPriceClient: options.rentalPriceClient, closedOrderFetchImpl: options.closedOrderFetchImpl, closedOrderRegistryPaths: options.closedOrderRegistryPaths, ...auditExecutionOptions(options) },
    );
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
    return rentalOperationConfirmResponse({ action: 'spec-add-and-refresh', productId: intent.productId, specDimId: intent.specDimId, itemTitle: intent.itemTitle }, '明确飞书命令需要二次确认后才能添加规格。');
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

  if (intent.type === 'operation_review') {
    return executeDirectAgentToolResponse(
      'operations.operationReview',
      {},
      '明确飞书命令要求查看运营操作复盘；该操作只读取本地观察记录和审计文件。',
      outputDir,
      options,
    );
  }

  if (intent.type === 'agent_learning_summary') {
    return { text: await summarizeAgentLearning(outputDir) };
  }

  if (intent.type === 'run_public_traffic_report') {
    const auditContext = await options.activateAudit?.('publicTraffic.runReport');
    return saveInitialConfirmationContextBestEffort({
      toolName: 'publicTraffic.runReport',
      args: {},
      reason: '明确飞书命令需要二次确认后才能生成并发送公域日报。',
      auditContext,
      options,
    });
  }

  if (intent.type === 'run_inactive_refresh') {
    return executeDirectAgentToolResponse(
      'operations.inactiveRefreshPlan',
      intent.date ? { date: intent.date } : {},
      '明确飞书命令要求生成失活刷新执行计划；确认前不会复制或下架商品。',
      outputDir,
      options,
    );
  }

  if (intent.type === 'refresh_public_traffic_dashboard') {
    const auditContext = await options.activateAudit?.('publicTraffic.refreshDashboard');
    const args = {
      ...(intent.date ? { date: intent.date } : {}),
      ...(intent.sendTo ? { sendTo: intent.sendTo } : {}),
    };
    return saveInitialConfirmationContextBestEffort({
      toolName: 'publicTraffic.refreshDashboard',
      args,
      reason: '明确飞书命令需要二次确认后才能补抓目标业务数据日的访问页 1日、7日、30日数据；若补抓后数据完整，可能重建并重发对应日报。',
      auditContext,
      options,
      ...(intent.date ? { entity: { type: 'report', id: intent.date } } : {}),
    });
  }

  if (intent.type === 'push_latest_report_to_group') {
    return executeDirectAgentToolResponse(
      'publicTraffic.pushLatestReportToGroup',
      intent.date ? { date: intent.date } : {},
      '明确飞书命令要求把日报推送到群；该操作不修改商品。',
      outputDir,
      options,
    );
  }

  if (intent.type === 'resend_latest_report') {
    return executeDirectAgentToolResponse(
      'publicTraffic.resendLatestReport',
      {
        ...(intent.sendTo ? { sendTo: intent.sendTo } : {}),
        ...(intent.date ? { date: intent.date } : {}),
      },
      '明确飞书命令要求重发公域日报；该操作不修改商品。',
      outputDir,
      options,
    );
  }

  if (intent.type === 'unknown') {
    const exploreInstruction = parseAgentExploreInstruction(intent.text);
    if (exploreInstruction) {
      return agentExploreResponse(exploreInstruction, outputDir, {
        provider: options.agentExploreProvider,
        executionOptions: {
          rentalPriceClient: options.rentalPriceClient,
          closedOrderFetchImpl: options.closedOrderFetchImpl,
          closedOrderRegistryPaths: options.closedOrderRegistryPaths,
          ...auditExecutionOptions(options),
        },
      });
    }

    if (shouldForceClarificationBeforePlanner(intent.text)) {
      return forcedPrePlannerClarification(intent.text, outputDir, options.clarificationDepth);
    }

    const bestLinkCopyResponse = await bestLinkNewLinkComboResponse(intent.text, outputDir, options);
    if (bestLinkCopyResponse) return bestLinkCopyResponse;

    const plannedResponse = await agentPlannerResponse(intent.text, outputDir, options);
    if (plannedResponse) return plannedResponse;

    if (options.agentPlannerProvider) {
      if (looksLikeNewLinkWriteIntent(intent.text)) return { text: NEW_LINK_WRITE_INTENT_PLAN_FAILED };
      return declineUnknownIntent();
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
        if (gateByConfidence(parsedProposal.proposal.confidence, confidenceGateOptions(options)) === 'clarify') return declineUnknownIntent();
        const proposedIntent = parsedProposal.proposal.intent;
        if (proposedIntent.type === 'rental_price_change') {
          return executeAgentToolRequest(
            { toolName: 'rental.pricePreview', arguments: pricePreviewArgumentsFromChangeRequest(proposedIntent.request), reason: parsedProposal.proposal.reason },
            outputDir,
            { rentalPriceClient: options.rentalPriceClient, closedOrderFetchImpl: options.closedOrderFetchImpl, closedOrderRegistryPaths: options.closedOrderRegistryPaths, ...auditExecutionOptions(options) },
          );
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
        if (gateByConfidence(parsed.selection.confidence, confidenceGateOptions(options)) === 'clarify') return declineUnknownIntent();
        const result = await runReadOnlyToolSelection(
          latest.context,
          parsed.selection,
          await buildReadOnlyToolRunOptions(options, llmReadOnlyToolNeedsLinkRegistry(parsed.selection.tool)),
        );
        return result.ok ? result.response : { text: UNKNOWN_GUIDANCE };
      }
      return declineUnknownIntent();
    }

    if (hasLlmRouting) return declineUnknownIntent();

    return declineUnknownIntent();
  }

  return declineUnknownIntent();
}
