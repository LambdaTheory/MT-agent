import * as lark from '@larksuiteoapi/node-sdk';
import { createHash } from 'node:crypto';
import { parseAgentToolConfirmRequest } from '../agentRuntime/approvalCard.js';
import { parseAgentClarificationCustomSelection, parseAgentClarificationSelection } from '../agentRuntime/clarificationCard.js';
import type { AgentPlannerProvider } from '../agentRuntime/planner.js';
import { recordAgentLearningEvent, type AgentLearningEventInput } from '../agentLearning/store.js';
import { handleOperationsLearningFeedback } from '../operationsLearningLoop/session.js';
import { findLatestReportContext } from './reportStore.js';
import { createFeishuMessageDispatcher } from './dispatcher.js';
import { executeAgentToolRequest } from './agentToolExecutor.js';
import { buildIdLookupCard } from './idLookupCard.js';
import { lookupProductId } from './idLookup.js';
import { executeNewLinkBatchConfirmRequest, parseNewLinkBatchConfirmRequest } from '../newLinkWorkflow/batch.js';
import { createRentalPriceSkillClient, executeRentalOperationConfirmRequest, parseRentalOperationConfirmRequest, parseRentalPriceConfirmRequest, type RentalPriceSkillClient } from './rentalPrice.js';
import type { LlmToolSelectionProvider } from './llmProvider.js';
import type { LlmIntentProposalProvider } from './llmIntentProposal.js';
import type { FeishuCardPayload } from '../notify/feishuApp.js';
import type { FeishuBotDispatchResult, FeishuBotIncomingTextMessage } from './types.js';

interface SdkMessageData {
  message?: {
    message_id?: unknown;
    chat_id?: unknown;
    chat_type?: unknown;
    message_type?: unknown;
    content?: unknown;
    mentions?: unknown;
  };
  sender?: {
    sender_id?: { open_id?: unknown };
  };
}

interface SdkCardAction {
  tag?: unknown;
  name?: unknown;
  input_value?: unknown;
  value?: unknown;
  form_value?: unknown;
  formValue?: unknown;
  behaviors?: unknown;
}

interface SdkCardActionData {
  open_message_id?: unknown;
  context?: { open_message_id?: unknown };
  action?: SdkCardAction;
  event?: {
    open_message_id?: unknown;
    context?: { open_message_id?: unknown };
    operator?: { open_id?: unknown; user_id?: unknown };
    action?: SdkCardAction;
  };
}

interface FeishuSdkReplyRequest {
  path: { message_id: string };
  data: { content: string; msg_type: 'text' | 'interactive' };
}

interface FeishuSdkPatchRequest {
  path: { message_id: string };
  data: { content: string };
}

interface FeishuSdkClient {
  im: { v1: { message: { reply(request: FeishuSdkReplyRequest): Promise<unknown> | unknown; patch?: (request: FeishuSdkPatchRequest) => Promise<unknown> | unknown } } };
}

type RentalActionStatus = 'processing' | 'completed' | 'failed' | 'cancelled';

interface FeishuCardActionResponse {
  toast?: { type: 'info' | 'success' | 'warning' | 'error'; content: string };
  card?: { type: 'raw'; data: FeishuCardPayload };
}

interface RentalActionClaim {
  status: RentalActionStatus;
  actionName: string;
  messageId: string;
}

interface FeishuSdkEventDispatcher {
  register(handlers: Record<string, (data: unknown) => Promise<unknown>>): FeishuSdkEventDispatcher;
}

interface FeishuSdkWsClient {
  start(config: { eventDispatcher: FeishuSdkEventDispatcher }): Promise<void> | void;
}

interface FeishuSdkModule {
  Client: new (params: { appId: string; appSecret: string }) => FeishuSdkClient;
  WSClient: new (params: { appId: string; appSecret: string }) => FeishuSdkWsClient;
  EventDispatcher: new (params: Record<string, never>) => FeishuSdkEventDispatcher;
}

export interface FeishuSdkBotConfig {
  appId: string;
  appSecret: string;
  botMentionOpenId?: string;
  botMentionName?: string;
  outputDir?: string;
  llmToolSelector?: LlmToolSelectionProvider;
  llmIntentProposalProvider?: LlmIntentProposalProvider;
  agentPlannerProvider?: AgentPlannerProvider;
  dispatchMessage?: (message: FeishuBotIncomingTextMessage) => Promise<FeishuBotDispatchResult>;
  logError?: (error: unknown, context: { messageId: string; phase: 'reply' | 'dispatch' }) => void;
  rentalPriceClient?: RentalPriceSkillClient;
  sdk?: FeishuSdkModule;
}

export interface FeishuSdkBot {
  start(): Promise<void> | void;
}

function isSdkMessageData(data: unknown): data is SdkMessageData {
  return typeof data === 'object' && data !== null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSdkCardActionData(data: unknown): data is SdkCardActionData {
  return isRecord(data);
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
    new_link_batch_cancel_submit: 'new_link_batch_cancel',
    new_link_batch_confirm_form: 'new_link_batch_confirm',
    new_link_batch_cancel_form: 'new_link_batch_cancel',
    rental_price_confirm_submit: 'rental_price_confirm',
    rental_price_cancel_submit: 'rental_price_cancel',
    rental_operation_confirm_submit: 'rental_operation_confirm',
    rental_operation_cancel_submit: 'rental_operation_cancel',
    id_lookup_submit: 'id_lookup',
  };
  if (exact[name]) return exact[name];
  if (name.startsWith('agent_clarify_select_')) return 'agent_clarify_select';
  if (name === 'agent_clarify_custom') return 'agent_clarify_custom';
  if (name === 'agent_clarify_cancel') return 'agent_clarify_cancel';
  return undefined;
}

function actionValueCandidates(action: SdkCardAction | undefined): Record<string, unknown>[] {
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

function readActionFormValue(action: SdkCardAction | undefined, name: string): string | undefined {
  if (!isRecord(action)) return undefined;
  for (const key of ['form_value', 'formValue']) {
    const formValue = action[key];
    if (isRecord(formValue)) {
      const value = readString(formValue[name]);
      if (value) return value;
    }
  }
  return readString(action.input_value);
}

function extractCardMessageId(data: unknown): string | undefined {
  if (!isSdkCardActionData(data)) return undefined;
  return readString(data.event?.context?.open_message_id) ?? readString(data.event?.open_message_id) ?? readString(data.context?.open_message_id) ?? readString(data.open_message_id);
}

function extractCardAction(data: unknown): SdkCardAction | undefined {
  if (!isSdkCardActionData(data)) return undefined;
  return data.event?.action ?? data.action;
}

function extractCardReviewerId(data: unknown): string | undefined {
  if (!isSdkCardActionData(data)) return undefined;
  return readString(data.event?.operator?.open_id) ?? readString(data.event?.operator?.user_id);
}

function cardActionValue(data: unknown): Record<string, unknown> | undefined {
  const action = extractCardAction(data);
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

const rentalActionClaims = new Map<string, RentalActionClaim>();

function actionClaimFamily(actionName: string): string {
  if (actionName.startsWith('agent_tool_')) return 'agent_tool';
  if (actionName.startsWith('new_link_batch_')) return 'new_link_batch';
  if (actionName.startsWith('rental_price_')) return 'rental_price';
  if (actionName.startsWith('rental_operation_')) return 'rental_operation';
  return actionName;
}

function stableActionKey(messageId: string, actionName: string, value: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify({ messageId, family: actionClaimFamily(actionName) })).digest('hex');
}

function claimRentalAction(messageId: string, actionName: string, value: Record<string, unknown>): { claimed: true; key: string } | { claimed: false; claim: RentalActionClaim } {
  const key = stableActionKey(messageId, actionName, value);
  const existing = rentalActionClaims.get(key);
  if (existing) return { claimed: false, claim: existing };
  rentalActionClaims.set(key, { status: 'processing', actionName, messageId });
  return { claimed: true, key };
}

function setRentalActionStatus(key: string, status: RentalActionStatus): void {
  const claim = rentalActionClaims.get(key);
  if (claim) claim.status = status;
}

function duplicateRentalActionText(claim: RentalActionClaim): string {
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

function cardActionUpdateResponse(card: FeishuCardPayload): FeishuCardActionResponse {
  return { card: { type: 'raw', data: card } };
}

async function replyText(client: FeishuSdkClient, messageId: string, text: string): Promise<void> {
  await client.im.v1.message.reply({
    path: { message_id: messageId },
    data: { content: JSON.stringify({ text }), msg_type: 'text' },
  });
}

async function replyCard(client: FeishuSdkClient, messageId: string, card: FeishuCardPayload): Promise<void> {
  await client.im.v1.message.reply({
    path: { message_id: messageId },
    data: { content: JSON.stringify(card), msg_type: 'interactive' },
  });
}

async function updateCard(client: FeishuSdkClient, messageId: string, card: FeishuCardPayload): Promise<boolean> {
  const patch = client.im.v1.message.patch;
  if (!patch) return false;
  await patch({
    path: { message_id: messageId },
    data: { content: JSON.stringify(card) },
  });
  return true;
}

export function extractSdkTextMessage(data: unknown): FeishuBotIncomingTextMessage | null {
  if (!isSdkMessageData(data)) return null;

  const message = data.message;
  if (message?.message_type !== 'text') return null;
  if (typeof message.message_id !== 'string' || typeof message.content !== 'string') return null;

  try {
    const content = JSON.parse(message.content) as { text?: unknown };
    if (typeof content.text !== 'string') return null;

    return {
      messageId: message.message_id,
      text: content.text,
      source: 'sdk',
      ...(typeof message.chat_id === 'string' ? { chatId: message.chat_id } : {}),
      ...(typeof message.chat_type === 'string' ? { chatType: message.chat_type } : {}),
      ...(typeof data.sender?.sender_id?.open_id === 'string' ? { senderOpenId: data.sender.sender_id.open_id } : {}),
      ...(Array.isArray(message.mentions) ? { mentions: message.mentions } : {}),
    };
  } catch {
    return null;
  }
}

export function createFeishuSdkBot(config: FeishuSdkBotConfig): FeishuSdkBot {
  const sdk = config.sdk ?? (lark as unknown as FeishuSdkModule);
  const client = new sdk.Client({ appId: config.appId, appSecret: config.appSecret });
  const wsClient = new sdk.WSClient({ appId: config.appId, appSecret: config.appSecret });
  const eventDispatcher = new sdk.EventDispatcher({});
  const dispatchMessage = config.dispatchMessage ?? createFeishuMessageDispatcher({
    outputDir: config.outputDir,
    botMentionOpenId: config.botMentionOpenId,
    botMentionName: config.botMentionName,
    llmToolSelector: config.llmToolSelector,
    llmIntentProposalProvider: config.llmIntentProposalProvider,
    agentPlannerProvider: config.agentPlannerProvider,
    rentalPriceClient: config.rentalPriceClient,
  }).dispatch;
  const logError = config.logError ?? ((error: unknown, context: { messageId: string; phase: 'reply' | 'dispatch' }) => console.error(`飞书SDK消息处理失败 ${context.phase} ${context.messageId}:`, error));
  const rentalPriceClient = config.rentalPriceClient ?? createRentalPriceSkillClient();
  const outputDir = config.outputDir ?? 'output';

  function recordLearning(input: AgentLearningEventInput, contextMessageId: string): void {
    void recordAgentLearningEvent(outputDir, input).catch((error) => logError(error, { messageId: contextMessageId, phase: 'reply' }));
  }

  eventDispatcher.register({
    'im.message.receive_v1': async (data: unknown) => {
      const message = extractSdkTextMessage(data);
      if (!message) return;

      const response = await dispatchMessage(message);
      if (response.skipped) return;

      try {
        if (response.card) await replyCard(client, message.messageId, response.card);
        else await replyText(client, message.messageId, response.text);
      } catch (error) {
        logError(error, { messageId: message.messageId, phase: 'reply' });
      }
    },
    'card.action.trigger': async (data: unknown) => {
      const messageId = extractCardMessageId(data);
      const action = extractCardAction(data);
      const value = cardActionValue(data);
      const actionName = readString(value?.action);
      if (!messageId || !actionName || !value) return;

      try {
        if (actionName === 'operations_learning_feedback') {
          const productId = readString(value?.productId);
          const feedback = readString(value?.feedback);
          const questionIndex = readNumber(value?.questionIndex);
          if (!productId || !feedback || !questionIndex) {
            await replyText(client, messageId, '运营学习反馈回调缺少必要字段。');
            return;
          }
          const response = await handleOperationsLearningFeedback(config.outputDir ?? 'output', {
            date: readString(value?.date),
            productId,
            feedback,
            questionIndex,
            suggestion: readActionFormValue(action, 'suggested_action'),
            reviewerId: extractCardReviewerId(data),
          });
          if (response.card) await replyCard(client, messageId, response.card);
          else await replyText(client, messageId, response.text);
          return;
        }

        if (actionName === 'agent_clarify_select') {
          const selection = parseAgentClarificationSelection(value);
          if (!selection) {
            await replyText(client, messageId, 'Agent 澄清选择参数无效，请重新发起。');
            return;
          }
          const claim = claimRentalAction(messageId, actionName, value);
          if (!claim.claimed) {
            await replyText(client, messageId, duplicateRentalActionText(claim.claim));
            return;
          }
          recordLearning({
            type: 'clarification_selected',
            messageId,
            actorId: extractCardReviewerId(data),
            originalMessage: selection.originalMessage,
            selectedMessage: selection.selectedMessage,
            label: selection.label,
          }, messageId);
          await updateCard(client, messageId, statusCard('Agent 已收到你的选择', `已选择：${selection.label}\n\n正在按新指令继续理解：${selection.selectedMessage}`, 'blue')).catch(() => false);
          try {
            const response = await dispatchMessage({
              messageId: `${messageId}:clarify:${claim.key.slice(0, 16)}`,
              text: selection.selectedMessage,
              source: 'sdk',
              chatType: 'p2p',
            });
            setRentalActionStatus(claim.key, 'completed');
            if (!response.skipped) {
              if (response.card) await replyCard(client, messageId, response.card);
              else await replyText(client, messageId, response.text);
            }
          } catch (error) {
            setRentalActionStatus(claim.key, 'failed');
            await updateCard(client, messageId, statusCard('Agent 澄清处理失败', error instanceof Error ? error.message : String(error), 'red')).catch(() => false);
            logError(error, { messageId, phase: 'reply' });
          }
          return;
        }

        if (actionName === 'agent_clarify_custom') {
          const customMessage = readActionFormValue(action, 'custom_message');
          const selection = parseAgentClarificationCustomSelection(value, customMessage);
          if (!selection) {
            await replyText(client, messageId, '请先在澄清输入框里补充你的真实意图。');
            return;
          }
          const claimValue = { ...value, selectedMessage: selection.selectedMessage };
          const claim = claimRentalAction(messageId, actionName, claimValue);
          if (!claim.claimed) {
            await replyText(client, messageId, duplicateRentalActionText(claim.claim));
            return;
          }
          recordLearning({
            type: 'clarification_selected',
            messageId,
            actorId: extractCardReviewerId(data),
            originalMessage: selection.originalMessage,
            selectedMessage: selection.selectedMessage,
            label: selection.label,
          }, messageId);
          await updateCard(client, messageId, statusCard('Agent 已收到你的补充', `正在按补充说明继续理解：${selection.selectedMessage}`, 'blue')).catch(() => false);
          try {
            const response = await dispatchMessage({
              messageId: `${messageId}:clarify:${claim.key.slice(0, 16)}`,
              text: selection.selectedMessage,
              source: 'sdk',
              chatType: 'p2p',
            });
            setRentalActionStatus(claim.key, 'completed');
            if (!response.skipped) {
              if (response.card) await replyCard(client, messageId, response.card);
              else await replyText(client, messageId, response.text);
            }
          } catch (error) {
            setRentalActionStatus(claim.key, 'failed');
            await updateCard(client, messageId, statusCard('Agent 澄清处理失败', error instanceof Error ? error.message : String(error), 'red')).catch(() => false);
            logError(error, { messageId, phase: 'reply' });
          }
          return;
        }

        if (actionName === 'agent_clarify_cancel') {
          const originalMessage = readString(value?.originalMessage) ?? '未知指令';
          const claim = claimRentalAction(messageId, actionName, value);
          if (!claim.claimed) {
            await replyText(client, messageId, duplicateRentalActionText(claim.claim));
            return;
          }
          setRentalActionStatus(claim.key, 'cancelled');
          recordLearning({
            type: 'clarification_cancelled',
            messageId,
            actorId: extractCardReviewerId(data),
            originalMessage,
          }, messageId);
          await updateCard(client, messageId, statusCard('Agent 已取消', `已取消澄清：${originalMessage}`, 'grey')).catch(() => false);
          return;
        }

        if (actionName === 'agent_tool_confirm') {
          const request = parseAgentToolConfirmRequest(value);
          if (!request) {
            await replyText(client, messageId, 'Agent 操作确认参数无效，请重新发起。');
            return;
          }
          const claim = claimRentalAction(messageId, actionName, value);
          if (!claim.claimed) {
            await replyText(client, messageId, duplicateRentalActionText(claim.claim));
            return;
          }
          recordLearning({
            type: 'tool_confirmed',
            messageId,
            actorId: extractCardReviewerId(data),
            toolName: request.toolName,
            arguments: request.arguments,
            reason: request.reason,
          }, messageId);
          void (async () => {
            await updateCard(client, messageId, statusCard('Agent 操作处理中', `工具 ${request.toolName} 已收到确认，正在执行。`, 'blue')).catch(() => false);
            try {
              const response = await executeAgentToolRequest(request, config.outputDir ?? 'output', { rentalPriceClient });
              setRentalActionStatus(claim.key, 'completed');
              recordLearning({
                type: 'tool_completed',
                messageId,
                actorId: extractCardReviewerId(data),
                toolName: request.toolName,
                arguments: request.arguments,
                reason: request.reason,
                resultSummary: response.text,
              }, messageId);
              if (response.card) {
                await updateCard(client, messageId, response.card).catch(() => false);
              } else {
                await updateCard(client, messageId, statusCard('Agent 操作已完成', response.text, 'green')).catch(() => false);
              }
            } catch (error) {
              setRentalActionStatus(claim.key, 'failed');
              recordLearning({
                type: 'tool_failed',
                messageId,
                actorId: extractCardReviewerId(data),
                toolName: request.toolName,
                arguments: request.arguments,
                reason: request.reason,
                resultSummary: error instanceof Error ? error.message : String(error),
              }, messageId);
              await updateCard(client, messageId, statusCard('Agent 操作失败', `${request.toolName}\n${error instanceof Error ? error.message : String(error)}`, 'red')).catch(() => false);
              logError(error, { messageId, phase: 'reply' });
            }
          })();
          return;
        }

        if (actionName === 'agent_tool_cancel') {
          const toolName = readString(value?.toolName) ?? '未知工具';
          const claim = claimRentalAction(messageId, actionName, value);
          if (!claim.claimed) {
            await replyText(client, messageId, duplicateRentalActionText(claim.claim));
            return;
          }
          setRentalActionStatus(claim.key, 'cancelled');
          recordLearning({
            type: 'tool_cancelled',
            messageId,
            actorId: extractCardReviewerId(data),
            toolName,
          }, messageId);
          await updateCard(client, messageId, statusCard('Agent 操作已取消', `工具 ${toolName} 操作已取消。`, 'grey')).catch(() => false);
          return;
        }

        if (actionName === 'new_link_batch_confirm') {
          const request = parseNewLinkBatchConfirmRequest(value);
          if (!request) {
            await replyText(client, messageId, '新链批量复制确认参数无效，请重新发起。');
            return;
          }
          const claim = claimRentalAction(messageId, actionName, value);
          if (!claim.claimed) {
            await replyText(client, messageId, duplicateRentalActionText(claim.claim));
            return;
          }
          recordLearning({
            type: 'workflow_confirmed',
            messageId,
            actorId: extractCardReviewerId(data),
            workflowName: request.workflowName,
            originalMessage: request.reason,
            selectedMessage: `从商品 ${request.sourceProductId} 复制 ${request.count} 条「${request.keyword}」新链`,
            label: '新链批量复制',
            arguments: { keyword: request.keyword, count: request.count, sourceProductId: request.sourceProductId },
            reason: request.reason,
          }, messageId);
          void (async () => {
            await updateCard(client, messageId, statusCard('新链批量复制处理中', `源商品 ${request.sourceProductId} 已收到确认，准备复制 ${request.count} 条。`, 'blue')).catch(() => false);
            try {
              const result = await executeNewLinkBatchConfirmRequest(rentalPriceClient, request);
              setRentalActionStatus(claim.key, result.ok ? 'completed' : 'failed');
              recordLearning({
                type: result.ok ? 'workflow_completed' : 'workflow_failed',
                messageId,
                actorId: extractCardReviewerId(data),
                workflowName: request.workflowName,
                arguments: { keyword: request.keyword, count: request.count, sourceProductId: request.sourceProductId },
                reason: request.reason,
                resultSummary: result.text,
              }, messageId);
              await updateCard(client, messageId, statusCard(result.ok ? '新链批量复制已完成' : '新链批量复制失败', result.text, result.ok ? 'green' : 'red')).catch(() => false);
            } catch (error) {
              setRentalActionStatus(claim.key, 'failed');
              recordLearning({
                type: 'workflow_failed',
                messageId,
                actorId: extractCardReviewerId(data),
                workflowName: request.workflowName,
                arguments: { keyword: request.keyword, count: request.count, sourceProductId: request.sourceProductId },
                reason: request.reason,
                resultSummary: error instanceof Error ? error.message : String(error),
              }, messageId);
              await updateCard(client, messageId, statusCard('新链批量复制失败', `源商品 ${request.sourceProductId}\n${error instanceof Error ? error.message : String(error)}`, 'red')).catch(() => false);
              logError(error, { messageId, phase: 'reply' });
            }
          })();
          return;
        }

        if (actionName === 'new_link_batch_cancel') {
          const keyword = readString(value?.keyword) ?? '未知';
          const claim = claimRentalAction(messageId, actionName, value);
          if (!claim.claimed) {
            await replyText(client, messageId, duplicateRentalActionText(claim.claim));
            return;
          }
          setRentalActionStatus(claim.key, 'cancelled');
          recordLearning({
            type: 'workflow_cancelled',
            messageId,
            actorId: extractCardReviewerId(data),
            workflowName: 'rental.newLinkBatch',
            label: '新链批量复制',
            arguments: { keyword },
          }, messageId);
          await updateCard(client, messageId, statusCard('新链批量复制已取消', `「${keyword}」新链批量复制已取消。`, 'grey')).catch(() => false);
          return;
        }

        if (actionName === 'rental_price_confirm') {
          const request = parseRentalPriceConfirmRequest(value);
          if (!request) {
            await replyText(client, messageId, '改价确认参数无效，请重新发起改价。');
            return;
          }
          const claim = claimRentalAction(messageId, actionName, value);
          if (!claim.claimed) {
            await replyText(client, messageId, duplicateRentalActionText(claim.claim));
            return;
          }
          void (async () => {
            await updateCard(client, messageId, statusCard('租赁商品改价处理中', `商品 ${request.productId} 改价已收到确认，正在执行。`, 'blue')).catch(() => false);
            try {
              const result = await rentalPriceClient.execute(request);
              setRentalActionStatus(claim.key, result.ok ? 'completed' : 'failed');
              await updateCard(client, messageId, statusCard(result.ok ? '租赁商品改价已完成' : '租赁商品改价失败', `商品 ${result.productId}\n${result.lines.join('\n')}`, result.ok ? 'green' : 'red')).catch(() => false);
            } catch (error) {
              setRentalActionStatus(claim.key, 'failed');
              await updateCard(client, messageId, statusCard('租赁商品改价失败', `商品 ${request.productId}\n${error instanceof Error ? error.message : String(error)}`, 'red')).catch(() => false);
              logError(error, { messageId, phase: 'reply' });
            }
          })();
          return;
        }

        if (actionName === 'rental_price_cancel') {
          const productId = readString(value?.productId) ?? '未知';
          const claim = claimRentalAction(messageId, actionName, value);
          if (!claim.claimed) {
            await replyText(client, messageId, duplicateRentalActionText(claim.claim));
            return;
          }
          setRentalActionStatus(claim.key, 'cancelled');
          await updateCard(client, messageId, statusCard('租赁商品改价已取消', `商品 ${productId} 改价已取消。`, 'grey')).catch(() => false);
          return;
        }

        if (actionName === 'rental_operation_confirm') {
          const request = parseRentalOperationConfirmRequest(value);
          if (!request) {
            await replyText(client, messageId, '租赁商品操作确认参数无效，请重新发起。');
            return;
          }
          const claim = claimRentalAction(messageId, actionName, value);
          if (!claim.claimed) {
            await replyText(client, messageId, duplicateRentalActionText(claim.claim));
            return;
          }
          void (async () => {
            await updateCard(client, messageId, statusCard('租赁商品操作处理中', `商品 ${request.productId} 操作已收到确认，正在执行。`, 'blue')).catch(() => false);
            try {
              const result = await executeRentalOperationConfirmRequest(rentalPriceClient, request);
              setRentalActionStatus(claim.key, result.ok ? 'completed' : 'failed');
              await updateCard(client, messageId, statusCard(result.ok ? '租赁商品操作已完成' : '租赁商品操作失败', result.text, result.ok ? 'green' : 'red')).catch(() => false);
            } catch (error) {
              setRentalActionStatus(claim.key, 'failed');
              await updateCard(client, messageId, statusCard('租赁商品操作失败', `商品 ${request.productId}\n${error instanceof Error ? error.message : String(error)}`, 'red')).catch(() => false);
              logError(error, { messageId, phase: 'reply' });
            }
          })();
          return;
        }

        if (actionName === 'rental_operation_cancel') {
          const productId = readString(value?.productId) ?? '未知';
          const claim = claimRentalAction(messageId, actionName, value);
          if (!claim.claimed) {
            await replyText(client, messageId, duplicateRentalActionText(claim.claim));
            return;
          }
          setRentalActionStatus(claim.key, 'cancelled');
          await updateCard(client, messageId, statusCard('租赁商品操作已取消', `商品 ${productId} 操作已取消。`, 'grey')).catch(() => false);
          return;
        }

        if (actionName === 'id_lookup') {
          const query = readActionFormValue(action, 'lookup_query') ?? readString(value?.query);
          let card: FeishuCardPayload;
          if (!query) {
            card = buildIdLookupCard({ resultText: '请输入端内ID或平台商品ID后再查询。' });
          } else {
            const latest = await findLatestReportContext(config.outputDir);
            card = latest
              ? buildIdLookupCard({ defaultValue: query, lookupResult: lookupProductId(latest.context, query) })
              : buildIdLookupCard({ defaultValue: query, resultText: '还没有找到公域日报上下文。' });
          }
          return cardActionUpdateResponse(card);
        }
      } catch (error) {
        logError(error, { messageId, phase: 'reply' });
      }
    },
  });

  return {
    start() {
      return wsClient.start({ eventDispatcher });
    },
  };
}
