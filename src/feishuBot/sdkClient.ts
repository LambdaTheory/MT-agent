import * as lark from '@larksuiteoapi/node-sdk';
import { findLatestReportContext } from './reportStore.js';
import { createFeishuMessageDispatcher } from './dispatcher.js';
import { formatIdLookupResult, lookupProductId } from './idLookup.js';
import type { LlmToolSelectionProvider } from './llmProvider.js';
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
}

interface SdkCardActionData {
  event?: {
    open_message_id?: unknown;
    context?: { open_message_id?: unknown };
    action?: SdkCardAction;
  };
}

interface FeishuSdkReplyRequest {
  path: { message_id: string };
  data: { content: string; msg_type: 'text' | 'interactive' };
}

interface FeishuSdkClient {
  im: { v1: { message: { reply(request: FeishuSdkReplyRequest): Promise<unknown> | unknown } } };
}

interface FeishuSdkEventDispatcher {
  register(handlers: Record<string, (data: unknown) => Promise<void>>): FeishuSdkEventDispatcher;
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
  dispatchMessage?: (message: FeishuBotIncomingTextMessage) => Promise<FeishuBotDispatchResult>;
  logError?: (error: unknown, context: { messageId: string; phase: 'reply' | 'dispatch' }) => void;
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
  return readString(data.event?.context?.open_message_id) ?? readString(data.event?.open_message_id);
}

function cardActionValue(data: unknown): Record<string, unknown> | undefined {
  if (!isSdkCardActionData(data)) return undefined;
  return isRecord(data.event?.action?.value) ? data.event.action.value : undefined;
}

function formatOperationsLearningFeedback(value: Record<string, unknown>, suggestion: string | undefined): string {
  const productId = readString(value.productId) ?? '未知商品';
  const feedback = readString(value.feedback) ?? 'unknown';
  return `已收到运营学习反馈：${productId} ${feedback}${suggestion ? `。建议：${suggestion}` : ''}`;
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
  const dispatchMessage = config.dispatchMessage ?? createFeishuMessageDispatcher({ outputDir: config.outputDir, botMentionOpenId: config.botMentionOpenId, botMentionName: config.botMentionName, llmToolSelector: config.llmToolSelector }).dispatch;
  const logError = config.logError ?? ((error: unknown, context: { messageId: string; phase: 'reply' | 'dispatch' }) => console.error(`飞书SDK消息处理失败 ${context.phase} ${context.messageId}:`, error));

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
      const action = isSdkCardActionData(data) ? data.event?.action : undefined;
      const value = cardActionValue(data);
      const actionName = readString(value?.action);
      if (!messageId || !actionName) return;

      try {
        if (actionName === 'operations_learning_feedback') {
          await replyText(client, messageId, formatOperationsLearningFeedback(value ?? {}, readActionFormValue(action, 'suggested_action')));
          return;
        }

        if (actionName === 'id_lookup') {
          const query = readActionFormValue(action, 'lookup_query') ?? readString(value?.query);
          if (!query) {
            await replyText(client, messageId, '请输入端内ID或平台商品ID后再查询。');
            return;
          }
          const latest = await findLatestReportContext(config.outputDir);
          await replyText(client, messageId, latest ? formatIdLookupResult(lookupProductId(latest.context, query)) : '还没有找到公域日报上下文。');
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
