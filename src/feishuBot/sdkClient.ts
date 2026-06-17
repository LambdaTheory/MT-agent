import * as lark from '@larksuiteoapi/node-sdk';
import { handleOperationsLearningFeedback } from '../operationsLearningLoop/session.js';
import { findLatestReportContext } from './reportStore.js';
import { createFeishuMessageDispatcher } from './dispatcher.js';
import { buildIdLookupCard } from './idLookupCard.js';
import { formatIdLookupResult, lookupProductId } from './idLookup.js';
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
  if (isRecord(action?.value)) return action.value;
  if (Array.isArray(action?.behaviors)) {
    for (const behavior of action.behaviors) {
      if (isRecord(behavior) && isRecord(behavior.value)) return behavior.value;
    }
  }
  if (readString(action?.name) === 'id_lookup_submit') return { action: 'id_lookup' };
  return undefined;
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
  const dispatchMessage = config.dispatchMessage ?? createFeishuMessageDispatcher({ outputDir: config.outputDir, botMentionOpenId: config.botMentionOpenId, botMentionName: config.botMentionName, llmToolSelector: config.llmToolSelector, llmIntentProposalProvider: config.llmIntentProposalProvider, rentalPriceClient: config.rentalPriceClient }).dispatch;
  const logError = config.logError ?? ((error: unknown, context: { messageId: string; phase: 'reply' | 'dispatch' }) => console.error(`飞书SDK消息处理失败 ${context.phase} ${context.messageId}:`, error));
  const rentalPriceClient = config.rentalPriceClient ?? createRentalPriceSkillClient();

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
      if (!messageId || !actionName) return;

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

        if (actionName === 'rental_price_confirm') {
          const request = parseRentalPriceConfirmRequest(value);
          if (!request) {
            await replyText(client, messageId, '改价确认参数无效，请重新发起改价。');
            return;
          }
          const result = await rentalPriceClient.execute(request);
          await replyText(client, messageId, `${result.ok ? '改价执行成功' : '改价执行失败'}：商品 ${result.productId}\n${result.lines.join('\n')}`);
          return;
        }

        if (actionName === 'rental_price_cancel') {
          const productId = readString(value?.productId) ?? '未知';
          await replyText(client, messageId, `已取消改价：商品 ${productId}`);
          return;
        }

        if (actionName === 'rental_operation_confirm') {
          const request = parseRentalOperationConfirmRequest(value);
          if (!request) {
            await replyText(client, messageId, '租赁商品操作确认参数无效，请重新发起。');
            return;
          }
          const result = await executeRentalOperationConfirmRequest(rentalPriceClient, request);
          await replyText(client, messageId, result.text);
          return;
        }

        if (actionName === 'rental_operation_cancel') {
          const productId = readString(value?.productId) ?? '未知';
          await replyText(client, messageId, `已取消租赁商品操作：商品 ${productId}`);
          return;
        }

        if (actionName === 'id_lookup') {
          const query = readActionFormValue(action, 'lookup_query') ?? readString(value?.query);
          let card: FeishuCardPayload;
          if (!query) {
            card = buildIdLookupCard({ resultText: '请输入端内ID或平台商品ID后再查询。' });
          } else {
            const latest = await findLatestReportContext(config.outputDir);
            card = buildIdLookupCard({ defaultValue: query, resultText: latest ? formatIdLookupResult(lookupProductId(latest.context, query)) : '还没有找到公域日报上下文。' });
          }
          await replyCard(client, messageId, card);
          return;
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
