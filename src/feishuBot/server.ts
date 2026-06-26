import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createActivityCancellationAssistant, type ActivityCancellationAssistant } from '../activityAutomation/cancelAssistance.js';
import { updateActivitySubmitSessionStatus } from '../activityAutomation/submitSession.js';
import { parseAgentToolConfirmRequest } from '../agentRuntime/approvalCard.js';
import { parseAgentClarificationCustomSelection, parseAgentClarificationSelection } from '../agentRuntime/clarificationCard.js';
import type { AgentPlannerProvider } from '../agentRuntime/planner.js';
import { recordAgentLearningEvent } from '../agentLearning/store.js';
import { handleLinkRegistryGovernanceCardAction } from '../linkRegistry/governanceSession.js';
import { handleLinkRegistryMaintenanceCardAction } from '../linkRegistry/maintenanceSession.js';
import { replyFeishuMessageCard, replyFeishuMessageText, type FeishuAppSendResult, type FeishuCardPayload, type FeishuReplyConfig } from '../notify/feishuApp.js';
import { handleOperationsLearningFeedback } from '../operationsLearningLoop/session.js';
import { findLatestReportContext } from './reportStore.js';
import { buildIdLookupCard } from './idLookupCard.js';
import { lookupProductId } from './idLookup.js';
import { createFeishuMessageDispatcher } from './dispatcher.js';
import {
  buildActivityCancelAssistanceCard,
  buildActivityCancelFailureCard,
  buildActivityCancelStatusCard,
  buildCancelDifferentialPricingCard,
  buildActivityPriceCallbackConfirmCard,
  buildActivityPriceCallbackRequest,
  buildActivityPriceCallbackStatusCard,
  createActivityAutomationSkillClient,
  formatActivityAutomationExecutionResult,
  parseActivityAutomationConfirmRequest,
  parseActivityPriceCallbackConfirmRequest,
  type ActivityAutomationSkillClient,
} from './activityAutomation.js';
import { executeAgentToolRequest } from './agentToolExecutor.js';
import { executeNewLinkBatchConfirmRequest, executeNewLinkBatchMultiConfirmRequest, parseNewLinkBatchConfirmRequest, parseNewLinkBatchMultiConfirmRequest } from '../newLinkWorkflow/batch.js';
import { createRentalPriceSkillClient, executeRentalOperationConfirmRequest, parseRentalOperationConfirmRequest, parseRentalPriceConfirmRequest, type RentalPriceSkillClient } from './rentalPrice.js';
import type { LlmIntentProposalProvider } from './llmIntentProposal.js';
import type { BotIntent, BotResponse, FeishuBotDispatchResult, FeishuBotIncomingTextMessage, FeishuMessageEvent } from './types.js';
import { handleUrlVerification } from './verify.js';

export interface FeishuBotServerConfig {
  port: number;
  appId: string;
  appSecret: string;
  botMentionOpenId?: string;
  botMentionName?: string;
  verificationToken?: string;
  encryptKey?: string;
  outputDir?: string;
  handleIntent?: (intent: BotIntent, outputDir?: string) => Promise<BotResponse>;
  dispatchMessage?: (message: FeishuBotIncomingTextMessage) => Promise<FeishuBotDispatchResult>;
  replyText?: (config: FeishuReplyConfig, text: string) => Promise<FeishuAppSendResult>;
  replyCard?: (config: FeishuReplyConfig, card: FeishuCardPayload) => Promise<FeishuAppSendResult>;
  rentalPriceClient?: RentalPriceSkillClient;
  activityAutomationClient?: ActivityAutomationSkillClient;
  activityCancellationAssistant?: ActivityCancellationAssistant;
  llmIntentProposalProvider?: LlmIntentProposalProvider;
  agentPlannerProvider?: AgentPlannerProvider;
}

interface FeishuCardActionEvent {
  header?: { event_type?: string };
  event?: {
    open_message_id?: unknown;
    context?: { open_message_id?: unknown };
    operator?: { open_id?: unknown; user_id?: unknown };
    action?: {
      name?: unknown;
      input_value?: unknown;
      value?: unknown;
      form_value?: unknown;
      formValue?: unknown;
      behaviors?: unknown;
    };
  };
}

type FeishuCardAction = NonNullable<NonNullable<FeishuCardActionEvent['event']>['action']>;

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function writeJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

export function extractTextMessage(payload: FeishuMessageEvent): Omit<FeishuBotIncomingTextMessage, 'source'> | null {
  const message = payload.event?.message;
  if (!message?.message_id || message.message_type !== 'text' || !message.content) return null;
  const content = JSON.parse(message.content) as { text?: string };
  return content.text
    ? {
        messageId: message.message_id,
        text: content.text,
        ...(message.chat_id ? { chatId: message.chat_id } : {}),
        ...(message.chat_type ? { chatType: message.chat_type } : {}),
        ...(payload.event?.sender?.sender_id?.open_id ? { senderOpenId: payload.event.sender.sender_id.open_id } : {}),
        ...(message.mentions ? { mentions: message.mentions } : {}),
      }
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function expectedActionForButtonName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const exact: Record<string, string> = {
    agent_tool_confirm_submit: 'agent_tool_confirm',
    agent_tool_cancel_submit: 'agent_tool_cancel',
    new_link_batch_confirm_submit: 'new_link_batch_confirm',
    new_link_batch_multi_confirm_submit: 'new_link_batch_multi_confirm',
    new_link_batch_cancel_submit: 'new_link_batch_cancel',
    new_link_batch_confirm_form: 'new_link_batch_confirm',
    new_link_batch_multi_confirm_form: 'new_link_batch_multi_confirm',
    new_link_batch_cancel_form: 'new_link_batch_cancel',
    rental_price_confirm_submit: 'rental_price_confirm',
    rental_price_cancel_submit: 'rental_price_cancel',
    rental_operation_confirm_submit: 'rental_operation_confirm',
    rental_operation_cancel_submit: 'rental_operation_cancel',
    activity_price_callback_confirm_submit: 'activity_price_callback_confirm',
    activity_price_callback_cancel_submit: 'activity_price_callback_cancel',
    id_lookup_submit: 'id_lookup',
  };
  if (exact[name]) return exact[name];
  if (name.startsWith('agent_clarify_select_')) return 'agent_clarify_select';
  if (name === 'agent_clarify_custom') return 'agent_clarify_custom';
  if (name === 'agent_clarify_cancel') return 'agent_clarify_cancel';
  if (name === 'activity_cancel_open_submit') return 'activity_cancel_open';
  if (name === 'activity_cancel_done_submit') return 'activity_cancel_done';
  if (name === 'activity_cancel_abort_submit') return 'activity_cancel_abort';
  if (name === 'cancel_differential_pricing_open_submit') return 'cancel_differential_pricing_open';
  if (name === 'cancel_differential_pricing_done_submit') return 'cancel_differential_pricing_done';
  if (name === 'cancel_differential_pricing_abort_submit') return 'cancel_differential_pricing_abort';
  return undefined;
}

function actionValueCandidates(action: FeishuCardAction | undefined): Record<string, unknown>[] {
  const candidates: Record<string, unknown>[] = [];
  if (isRecord(action?.value)) candidates.push(action.value);
  if (Array.isArray(action?.behaviors)) {
    for (const behavior of action.behaviors) {
      if (isRecord(behavior) && isRecord(behavior.value)) candidates.push(behavior.value);
    }
  }
  return candidates;
}

function fallbackCancelValue(expectedAction: string, candidates: Record<string, unknown>[]): Record<string, unknown> | undefined {
  const first = candidates[0];
  const request = isRecord(first?.request) ? first.request : undefined;
  if (expectedAction === 'new_link_batch_cancel') {
    const keyword = readString(first?.keyword) ?? readString(request?.keyword);
    const sourceProductId = readString(first?.sourceProductId) ?? readString(request?.sourceProductId);
    return { action: expectedAction, ...(keyword ? { keyword } : {}), ...(sourceProductId ? { sourceProductId } : {}) };
  }
  if (expectedAction === 'rental_price_cancel' || expectedAction === 'rental_operation_cancel') {
    const productId = readString(first?.productId) ?? readString(request?.productId);
    return { action: expectedAction, ...(productId ? { productId } : {}) };
  }
  if (expectedAction === 'agent_tool_cancel') {
    const toolName = readString(first?.toolName) ?? readString(request?.toolName);
    return { action: expectedAction, ...(toolName ? { toolName } : {}) };
  }
  return undefined;
}

function cardActionValue(payload: FeishuCardActionEvent): Record<string, unknown> | undefined {
  const action = payload.event?.action;
  const expectedAction = expectedActionForButtonName(readString(action?.name));
  const candidates = actionValueCandidates(action);
  if (expectedAction) {
    const matched = candidates.find((candidate) => readString(candidate.action) === expectedAction);
    if (matched) return matched;
    if (expectedAction.endsWith('_cancel')) return fallbackCancelValue(expectedAction, candidates);
    if (expectedAction === 'id_lookup') return { action: 'id_lookup' };
    return undefined;
  }
  if (candidates[0]) return candidates[0];
  return undefined;
}

type ServerCardActionStatus = 'processing' | 'completed' | 'failed' | 'cancelled';

interface ServerCardActionClaim {
  status: ServerCardActionStatus;
  actionName: string;
}

const serverCardActionClaims = new Map<string, ServerCardActionClaim>();

function claimServerCardAction(messageId: string, family: string, actionName: string): { claimed: true; key: string } | { claimed: false; claim: ServerCardActionClaim } {
  const key = `${messageId}:${family}`;
  const existing = serverCardActionClaims.get(key);
  if (existing) return { claimed: false, claim: existing };
  serverCardActionClaims.set(key, { status: 'processing', actionName });
  return { claimed: true, key };
}

function setServerCardActionStatus(key: string, status: ServerCardActionStatus): void {
  const claim = serverCardActionClaims.get(key);
  if (claim) claim.status = status;
}

function duplicateServerCardActionText(claim: ServerCardActionClaim): string {
  if (claim.status === 'processing') return '该确认卡片已经在执行中，请勿重复点击。';
  if (claim.status === 'completed') return '该确认卡片已经执行完成，请勿重复点击。';
  if (claim.status === 'cancelled') return '该确认卡片已经取消，请勿重复点击。';
  return '该确认卡片已经处理过，请重新发起命令。';
}

function statusCard(title: string, content: string, template: 'blue' | 'green' | 'red' | 'grey' = 'blue'): FeishuCardPayload {
  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: title }, template },
    body: { elements: [{ tag: 'markdown', content }] },
  };
}

function claimStatusCard(title: string, claim: ServerCardActionClaim): FeishuCardPayload {
  const template = claim.status === 'processing' ? 'blue' : claim.status === 'completed' ? 'green' : claim.status === 'failed' ? 'red' : 'grey';
  return statusCard(title, duplicateServerCardActionText(claim), template);
}

function readActionFormValue(action: FeishuCardAction | undefined, name: string): string | undefined {
  if (!isRecord(action)) return undefined;
  const actionRecord = action as Record<string, unknown>;
  for (const key of ['form_value', 'formValue']) {
    const formValue = actionRecord[key];
    if (isRecord(formValue)) {
      const value = readString(formValue[name]);
      if (value) return value;
    }
  }
  return readString(action.input_value);
}

function readActionForm(action: FeishuCardAction | undefined): Record<string, unknown> | undefined {
  if (!isRecord(action)) return undefined;
  const actionRecord = action as Record<string, unknown>;
  for (const key of ['form_value', 'formValue']) {
    const formValue = actionRecord[key];
    if (isRecord(formValue)) return formValue;
  }
  return undefined;
}

function extractCardMessageId(payload: FeishuCardActionEvent): string | undefined {
  return readString(payload.event?.context?.open_message_id) ?? readString(payload.event?.open_message_id);
}

function extractCardReviewerId(payload: FeishuCardActionEvent): string | undefined {
  return readString(payload.event?.operator?.open_id) ?? readString(payload.event?.operator?.user_id);
}

function isCardActionTrigger(payload: unknown): payload is FeishuCardActionEvent {
  if (!isRecord(payload)) return false;
  const header = isRecord(payload.header) ? payload.header : undefined;
  const event = isRecord(payload.event) ? payload.event : undefined;
  return header?.event_type === 'card.action.trigger' || Boolean(event?.action);
}

async function handleCardActionTrigger(
  payload: FeishuCardActionEvent,
  config: FeishuBotServerConfig,
  dispatchMessage: (message: FeishuBotIncomingTextMessage) => Promise<FeishuBotDispatchResult>,
): Promise<FeishuCardPayload | undefined> {
  const messageId = extractCardMessageId(payload);
  const value = cardActionValue(payload);
  const actionName = readString(value?.action);
  if (!messageId || !actionName) return undefined;

  const replyText = config.replyText ?? replyFeishuMessageText;
  const replyCard = config.replyCard ?? replyFeishuMessageCard;
  const activityCancellationAssistant = config.activityCancellationAssistant ?? createActivityCancellationAssistant();
  const replyConfig = { appId: config.appId, appSecret: config.appSecret, messageId };
  const actorId = extractCardReviewerId(payload);
  const outputDir = config.outputDir ?? 'output';

  if (actionName === 'operations_learning_feedback') {
    const productId = readString(value?.productId);
    const feedback = readString(value?.feedback);
    const questionIndex = readNumber(value?.questionIndex);
    if (!productId || !feedback || !questionIndex) {
      await replyText(replyConfig, '运营学习反馈回调缺少必要字段。');
      return;
    }
    const response = await handleOperationsLearningFeedback(config.outputDir ?? 'output', {
      date: readString(value?.date),
      productId,
      feedback,
      questionIndex,
      suggestion: readActionFormValue(payload.event?.action, 'suggested_action'),
      reviewerId: extractCardReviewerId(payload),
    });
    if (response.card) await replyCard(replyConfig, response.card);
    else await replyText(replyConfig, response.text);
    return;
  }

  if (
    actionName === 'link_registry_maintenance_start'
    || actionName === 'link_registry_maintenance_snooze'
    || actionName === 'link_registry_maintenance_ignore'
    || actionName === 'link_registry_maintenance_submit'
  ) {
    const form = readActionForm(payload.event?.action);
    const response = await handleLinkRegistryMaintenanceCardAction(outputDir, {
      date: readString(value?.date) ?? '',
      action:
        actionName === 'link_registry_maintenance_start' ? 'start'
          : actionName === 'link_registry_maintenance_snooze' ? 'snooze'
            : actionName === 'link_registry_maintenance_ignore' ? 'ignore'
              : 'submit',
      internalProductId: readString(value?.internalProductId),
      reviewIndex: readNumber(value?.reviewIndex),
      decision: readString(form?.decision) as 'accept' | 'accept_with_edit' | 'ignore' | undefined,
      sameSkuGroupId: readString(form?.same_sku_group_id_custom) ?? readString(form?.same_sku_group_id),
      categoryId: readString(form?.category_id),
      productType: readString(form?.product_type),
      shortName: readString(form?.short_name),
      reviewerId: extractCardReviewerId(payload),
    });
    if (response.card) return response.card;
    return statusCard('\u94fe\u63a5\u7ef4\u62a4', response.text, 'grey');
  }

  if (
    actionName === 'link_registry_governance_start'
    || actionName === 'link_registry_governance_advance'
    || actionName === 'link_registry_governance_submit'
    || actionName === 'link_registry_governance_snooze'
    || actionName === 'link_registry_governance_ignore'
  ) {
    const form = readActionForm(payload.event?.action);
    const response = await handleLinkRegistryGovernanceCardAction(outputDir, {
      date: readString(value?.date) ?? '',
      action:
        actionName === 'link_registry_governance_start' ? 'start'
          : actionName === 'link_registry_governance_advance' ? 'advance'
            : actionName === 'link_registry_governance_submit' ? 'submit'
            : actionName === 'link_registry_governance_snooze' ? 'snooze'
              : 'ignore',
      reviewIndex: readNumber(value?.reviewIndex),
      decision: readString(form?.decision) as 'resolved' | 'watch' | 'ignored' | undefined,
      note: readString(form?.note),
      reviewerId: extractCardReviewerId(payload),
    });
    if (response.card) return response.card;
    return statusCard('\u7ec4\u7ea7\u6cbb\u7406', response.text, 'grey');
  }

  if (actionName === 'agent_clarify_select') {
    const selection = parseAgentClarificationSelection(value);
    if (!selection) {
      await replyText(replyConfig, 'Agent 澄清选择参数无效，请重新发起。');
      return;
    }
    const claim = claimServerCardAction(messageId, 'agent_clarify', actionName);
    if (!claim.claimed) {
      return claimStatusCard('Agent 澄清已处理', claim.claim);
    }
    await recordAgentLearningEvent(outputDir, {
      type: 'clarification_selected',
      messageId,
      actorId,
      originalMessage: selection.originalMessage,
      selectedMessage: selection.selectedMessage,
      label: selection.label,
    });
    const response = await dispatchMessage({
      messageId: `${messageId}:clarify:${Buffer.from(selection.label).toString('hex').slice(0, 16)}`,
      text: selection.selectedMessage,
      source: 'http',
      chatType: 'p2p',
    });
    setServerCardActionStatus(claim.key, 'completed');
    if (!response.skipped) {
      if (response.card) await replyCard(replyConfig, response.card);
      else await replyText(replyConfig, response.text);
    }
    return;
  }

  if (actionName === 'agent_clarify_custom') {
    const selection = parseAgentClarificationCustomSelection(value, readActionFormValue(payload.event?.action, 'custom_message'));
    if (!selection) {
      await replyText(replyConfig, '请先在澄清输入框里补充你的真实意图。');
      return;
    }
    const claim = claimServerCardAction(messageId, 'agent_clarify', actionName);
    if (!claim.claimed) {
      return claimStatusCard('Agent 澄清已处理', claim.claim);
    }
    await recordAgentLearningEvent(outputDir, {
      type: 'clarification_selected',
      messageId,
      actorId,
      originalMessage: selection.originalMessage,
      selectedMessage: selection.selectedMessage,
      label: selection.label,
    });
    const response = await dispatchMessage({
      messageId: `${messageId}:clarify:${Buffer.from(selection.selectedMessage).toString('hex').slice(0, 16)}`,
      text: selection.selectedMessage,
      source: 'http',
      chatType: 'p2p',
    });
    setServerCardActionStatus(claim.key, 'completed');
    if (!response.skipped) {
      if (response.card) await replyCard(replyConfig, response.card);
      else await replyText(replyConfig, response.text);
    }
    return;
  }

  if (actionName === 'agent_clarify_cancel') {
    const claim = claimServerCardAction(messageId, 'agent_clarify', actionName);
    if (!claim.claimed) {
      return claimStatusCard('Agent 澄清已处理', claim.claim);
    }
    setServerCardActionStatus(claim.key, 'cancelled');
    await recordAgentLearningEvent(outputDir, {
      type: 'clarification_cancelled',
      messageId,
      actorId,
      originalMessage: readString(value?.originalMessage),
    });
    return statusCard('Agent 已取消', `已取消澄清：${readString(value?.originalMessage) ?? '未知指令'}`, 'grey');
  }

  if (actionName === 'agent_tool_confirm') {
    const request = parseAgentToolConfirmRequest(value);
    if (!request) {
      await replyText(replyConfig, 'Agent 操作确认参数无效，请重新发起。');
      return;
    }
    const claim = claimServerCardAction(messageId, 'agent_tool', actionName);
    if (!claim.claimed) {
      return claimStatusCard('Agent 操作已处理', claim.claim);
    }
    await recordAgentLearningEvent(outputDir, {
      type: 'tool_confirmed',
      messageId,
      actorId,
      toolName: request.toolName,
      arguments: request.arguments,
      reason: request.reason,
    });
    const response = await executeAgentToolRequest(request, config.outputDir ?? 'output', {
      rentalPriceClient: config.rentalPriceClient,
    });
    setServerCardActionStatus(claim.key, 'completed');
    await recordAgentLearningEvent(outputDir, {
      type: 'tool_completed',
      messageId,
      actorId,
      toolName: request.toolName,
      arguments: request.arguments,
      reason: request.reason,
      resultSummary: response.text,
    });
    if (response.card) await replyCard(replyConfig, response.card);
    else await replyText(replyConfig, response.text);
    return;
  }

  if (actionName === 'agent_tool_cancel') {
    const toolName = readString(value?.toolName) ?? '未知工具';
    const claim = claimServerCardAction(messageId, 'agent_tool', actionName);
    if (!claim.claimed) {
      return claimStatusCard('Agent 操作已处理', claim.claim);
    }
    setServerCardActionStatus(claim.key, 'cancelled');
    await recordAgentLearningEvent(outputDir, {
      type: 'tool_cancelled',
      messageId,
      actorId,
      toolName,
    });
    return statusCard('Agent 操作已取消', `工具 ${toolName} 操作已取消。`, 'grey');
  }

  if (actionName === 'new_link_batch_confirm') {
    const request = parseNewLinkBatchConfirmRequest(value);
    if (!request) {
      await replyText(replyConfig, '新链批量复制确认参数无效，请重新发起。');
      return;
    }
    const claim = claimServerCardAction(messageId, 'new_link_batch', actionName);
    if (!claim.claimed) {
      return claimStatusCard('新链批量复制已处理', claim.claim);
    }
    await recordAgentLearningEvent(outputDir, {
      type: 'workflow_confirmed',
      messageId,
      actorId,
      workflowName: request.workflowName,
      originalMessage: request.reason,
      selectedMessage: `从商品 ${request.sourceProductId} 复制 ${request.count} 条「${request.keyword}」新链`,
      label: '新链批量复制',
      arguments: { keyword: request.keyword, count: request.count, sourceProductId: request.sourceProductId },
      reason: request.reason,
    });
    const result = await executeNewLinkBatchConfirmRequest(config.rentalPriceClient ?? createRentalPriceSkillClient(), request);
    setServerCardActionStatus(claim.key, result.ok ? 'completed' : 'failed');
    await recordAgentLearningEvent(outputDir, {
      type: result.ok ? 'workflow_completed' : 'workflow_failed',
      messageId,
      actorId,
      workflowName: request.workflowName,
      arguments: { keyword: request.keyword, count: request.count, sourceProductId: request.sourceProductId },
      reason: request.reason,
      resultSummary: result.text,
    });
    await replyText(replyConfig, result.text);
    return;
  }

  if (actionName === 'new_link_batch_multi_confirm') {
    const request = parseNewLinkBatchMultiConfirmRequest(value);
    if (!request) {
      await replyText(replyConfig, '多商品新链批量复制确认参数无效，请重新发起。');
      return;
    }
    const claim = claimServerCardAction(messageId, 'new_link_batch', actionName);
    if (!claim.claimed) {
      return claimStatusCard('新链批量复制已处理', claim.claim);
    }
    await recordAgentLearningEvent(outputDir, {
      type: 'workflow_confirmed',
      messageId,
      actorId,
      workflowName: request.workflowName,
      originalMessage: request.reason,
      selectedMessage: request.items.map((item) => `从商品 ${item.sourceProductId} 复制 ${item.count} 条「${item.keyword}」新链`).join('；'),
      label: '多商品新链批量复制',
      arguments: { items: request.items.map((item) => ({ keyword: item.keyword, count: item.count, sourceProductId: item.sourceProductId })) },
      reason: request.reason,
    });
    const result = await executeNewLinkBatchMultiConfirmRequest(config.rentalPriceClient ?? createRentalPriceSkillClient(), request);
    setServerCardActionStatus(claim.key, result.ok ? 'completed' : 'failed');
    await recordAgentLearningEvent(outputDir, {
      type: result.ok ? 'workflow_completed' : 'workflow_failed',
      messageId,
      actorId,
      workflowName: request.workflowName,
      arguments: { items: request.items.map((item) => ({ keyword: item.keyword, count: item.count, sourceProductId: item.sourceProductId })) },
      reason: request.reason,
      resultSummary: result.text,
    });
    await replyText(replyConfig, result.text);
    return;
  }

  if (actionName === 'new_link_batch_cancel') {
    const keyword = readString(value?.keyword) ?? '未知';
    const claim = claimServerCardAction(messageId, 'new_link_batch', actionName);
    if (!claim.claimed) {
      return claimStatusCard('新链批量复制已处理', claim.claim);
    }
    setServerCardActionStatus(claim.key, 'cancelled');
    await recordAgentLearningEvent(outputDir, {
      type: 'workflow_cancelled',
      messageId,
      actorId,
      workflowName: 'rental.newLinkBatch',
      label: '新链批量复制',
      arguments: { keyword },
    });
    return statusCard('新链批量复制已取消', `「${keyword}」新链批量复制已取消。`, 'grey');
  }

  if (actionName === 'rental_price_confirm') {
    const request = parseRentalPriceConfirmRequest(value);
    if (!request) {
      await replyText(replyConfig, '改价确认参数无效，请重新发起改价。');
      return;
    }
    const claim = claimServerCardAction(messageId, 'rental_price', actionName);
    if (!claim.claimed) {
      return claimStatusCard('租赁商品改价已处理', claim.claim);
    }
    const result = await (config.rentalPriceClient ?? createRentalPriceSkillClient()).execute(request);
    setServerCardActionStatus(claim.key, result.ok ? 'completed' : 'failed');
    await replyText(replyConfig, `${result.ok ? '改价执行成功' : '改价执行失败'}：商品 ${result.productId}\n${result.lines.join('\n')}`);
    return;
  }

  if (actionName === 'activity_automation_confirm') {
    const actionForm = readActionForm(payload.event?.action);
    const request = parseActivityAutomationConfirmRequest(actionForm);
    if (!request) {
      console.error('差异化定价参数解析失败', { messageId, actionValue: value, actionForm, action: payload.event?.action });
      await replyText(replyConfig, '差异化定价参数无效，请重新填写卡片后再试。');
      return;
    }
    const claim = claimServerCardAction(messageId, 'activity_automation', actionName);
    if (!claim.claimed) {
      return claimStatusCard('差异化定价已处理', claim.claim);
    }
    const result = await (config.activityAutomationClient ?? createActivityAutomationSkillClient()).execute(request);
    setServerCardActionStatus(claim.key, result.ok ? 'completed' : 'failed');
    const callbackRequest = buildActivityPriceCallbackRequest(result);
    if (callbackRequest) {
      await replyCard(replyConfig, buildActivityPriceCallbackConfirmCard(callbackRequest));
      return;
    }
    await replyText(replyConfig, formatActivityAutomationExecutionResult(result));
    return;
  }

  if (actionName === 'activity_automation_cancel') {
    const claim = claimServerCardAction(messageId, 'activity_automation', actionName);
    if (!claim.claimed) {
      return claimStatusCard('差异化定价已处理', claim.claim);
    }
    setServerCardActionStatus(claim.key, 'cancelled');
    return statusCard('差异化定价已取消', '已取消本次差异化定价。', 'grey');
  }

  if (actionName === 'activity_price_callback_confirm') {
    const request = parseActivityPriceCallbackConfirmRequest(value);
    if (!request) {
      await replyText(replyConfig, '价格回调确认参数无效，请重新发起。');
      return;
    }
    return buildActivityPriceCallbackStatusCard(request, { confirmed: true });
  }

  if (actionName === 'activity_price_callback_cancel') {
    const request = parseActivityPriceCallbackConfirmRequest(value);
    if (!request) {
      await replyText(replyConfig, '价格回调取消参数无效，请重新发起。');
      return;
    }
    const claim = claimServerCardAction(messageId, 'activity_price_callback', actionName);
    if (!claim.claimed) {
      return claimStatusCard('价格回调已处理', claim.claim);
    }
    setServerCardActionStatus(claim.key, 'cancelled');
    return buildActivityPriceCallbackStatusCard(request, { confirmed: false });
  }

  if (actionName === 'activity_cancel_open' || actionName === 'cancel_differential_pricing_open') {
    const request = parseActivityPriceCallbackConfirmRequest(value);
    if (!request) {
      await replyText(replyConfig, '活动取消辅助参数无效，请重新发起。');
      return;
    }
    const claim = claimServerCardAction(messageId, 'cancel_differential_pricing_open', actionName);
    if (!claim.claimed) {
      await replyText(replyConfig, duplicateServerCardActionText(claim.claim));
      return;
    }
    try {
      const assistance = await activityCancellationAssistant.open(request);
      await updateActivitySubmitSessionStatus(request.submitSessionPath, assistance.cancelled ? 'cancelled' : 'cancel_assistance_opened');
      setServerCardActionStatus(claim.key, 'completed');
      return assistance.cancelled
        ? buildActivityCancelStatusCard(request, { cancelled: true })
        : buildActivityCancelAssistanceCard(request, assistance);
    } catch (error) {
      setServerCardActionStatus(claim.key, 'failed');
      return buildActivityCancelFailureCard(request, error instanceof Error ? error.message : String(error));
    }
  }

  if (actionName === 'activity_cancel_done' || actionName === 'cancel_differential_pricing_done') {
    const request = parseActivityPriceCallbackConfirmRequest(value);
    if (!request) {
      await replyText(replyConfig, '活动取消确认参数无效，请重新发起。');
      return;
    }
    const claim = claimServerCardAction(messageId, 'cancel_differential_pricing_resolution', actionName);
    if (!claim.claimed) {
      await replyText(replyConfig, duplicateServerCardActionText(claim.claim));
      return;
    }
    await updateActivitySubmitSessionStatus(request.submitSessionPath, 'cancelled');
    setServerCardActionStatus(claim.key, 'completed');
    return buildActivityCancelStatusCard(request, { cancelled: true });
  }

  if (actionName === 'activity_cancel_abort' || actionName === 'cancel_differential_pricing_abort') {
    const request = parseActivityPriceCallbackConfirmRequest(value);
    if (!request) {
      await replyText(replyConfig, '活动取消保留参数无效，请重新发起。');
      return;
    }
    const claim = claimServerCardAction(messageId, 'cancel_differential_pricing_resolution', actionName);
    if (!claim.claimed) {
      await replyText(replyConfig, duplicateServerCardActionText(claim.claim));
      return;
    }
    await updateActivitySubmitSessionStatus(request.submitSessionPath, 'price_callback_pending');
    setServerCardActionStatus(claim.key, 'completed');
    return buildCancelDifferentialPricingCard(request);
  }

  if (actionName === 'rental_price_cancel') {
    const productId = readString(value?.productId) ?? '未知';
    const claim = claimServerCardAction(messageId, 'rental_price', actionName);
    if (!claim.claimed) {
      return claimStatusCard('租赁商品改价已处理', claim.claim);
    }
    setServerCardActionStatus(claim.key, 'cancelled');
    return statusCard('租赁商品改价已取消', `商品 ${productId} 改价已取消。`, 'grey');
  }

  if (actionName === 'rental_operation_confirm') {
    const request = parseRentalOperationConfirmRequest(value);
    if (!request) {
      await replyText(replyConfig, '租赁商品操作确认参数无效，请重新发起。');
      return;
    }
    const claim = claimServerCardAction(messageId, 'rental_operation', actionName);
    if (!claim.claimed) {
      return claimStatusCard('租赁商品操作已处理', claim.claim);
    }
    const result = await executeRentalOperationConfirmRequest(config.rentalPriceClient ?? createRentalPriceSkillClient(), request);
    setServerCardActionStatus(claim.key, result.ok ? 'completed' : 'failed');
    await replyText(replyConfig, result.text);
    return;
  }

  if (actionName === 'rental_operation_cancel') {
    const productId = readString(value?.productId) ?? '未知';
    const claim = claimServerCardAction(messageId, 'rental_operation', actionName);
    if (!claim.claimed) {
      return claimStatusCard('租赁商品操作已处理', claim.claim);
    }
    setServerCardActionStatus(claim.key, 'cancelled');
    return statusCard('租赁商品操作已取消', `商品 ${productId} 操作已取消。`, 'grey');
  }

  if (actionName === 'id_lookup') {
    const query = readActionFormValue(payload.event?.action, 'lookup_query') ?? readString(value?.query);
    if (!query) {
      return buildIdLookupCard({ resultText: '请输入端内ID或平台商品ID后再查询。' });
    }
    const latest = await findLatestReportContext(config.outputDir);
    return latest
      ? buildIdLookupCard({ defaultValue: query, lookupResult: lookupProductId(latest.context, query) })
      : buildIdLookupCard({ defaultValue: query, resultText: '还没有找到公域日报上下文。' });
  }
  return undefined;
}

export function startFeishuBotServer(config: FeishuBotServerConfig) {
  const dispatcher = createFeishuMessageDispatcher({
    outputDir: config.outputDir,
    botMentionOpenId: config.botMentionOpenId,
    botMentionName: config.botMentionName,
    handleIntent: config.handleIntent,
    rentalPriceClient: config.rentalPriceClient,
    activityAutomationClient: config.activityAutomationClient,
    llmIntentProposalProvider: config.llmIntentProposalProvider,
    agentPlannerProvider: config.agentPlannerProvider,
  });
  const dispatchMessage = config.dispatchMessage ?? dispatcher.dispatch;

  const server = createServer(async (req, res) => {
    if (req.method !== 'POST') return writeJson(res, 404, { error: 'not found' });

    const body = await readBody(req);

    const payload = JSON.parse(body) as FeishuMessageEvent & { type?: string; challenge?: string; token?: string };
    const verification = handleUrlVerification(payload, config.verificationToken);
    if (verification) return writeJson(res, 200, verification);

    if (isCardActionTrigger(payload)) {
      const card = await handleCardActionTrigger(payload, config, dispatchMessage);
      writeJson(res, 200, card ?? { ok: true });
      return;
    }

    const textMessage = extractTextMessage(payload);
    if (!textMessage) return writeJson(res, 200, { ok: true });

    writeJson(res, 200, { ok: true });

    const response = await dispatchMessage({ ...textMessage, source: 'http' });
    if (!response.skipped) {
      const replyConfig = { appId: config.appId, appSecret: config.appSecret, messageId: textMessage.messageId };
      if (response.card) await (config.replyCard ?? replyFeishuMessageCard)(replyConfig, response.card);
      else await (config.replyText ?? replyFeishuMessageText)(replyConfig, response.text);
    }
  });

  server.listen(config.port);
  return server;
}
