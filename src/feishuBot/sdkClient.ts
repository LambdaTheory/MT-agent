import * as lark from '@larksuiteoapi/node-sdk';
import { createFeishuMessageDispatcher } from './dispatcher.js';
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

interface FeishuSdkReplyRequest {
  path: { message_id: string };
  data: { content: string; msg_type: 'text' };
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
  outputDir?: string;
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

async function replyText(client: FeishuSdkClient, messageId: string, text: string): Promise<void> {
  await client.im.v1.message.reply({
    path: { message_id: messageId },
    data: { content: JSON.stringify({ text }), msg_type: 'text' },
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
  const dispatchMessage = config.dispatchMessage ?? createFeishuMessageDispatcher({ outputDir: config.outputDir }).dispatch;
  const logError = config.logError ?? ((error: unknown, context: { messageId: string; phase: 'reply' | 'dispatch' }) => console.error(`飞书SDK消息处理失败 ${context.phase} ${context.messageId}:`, error));

  eventDispatcher.register({
    'im.message.receive_v1': async (data: unknown) => {
      const message = extractSdkTextMessage(data);
      if (!message) return;

      const response = await dispatchMessage(message);
      if (response.skipped) return;

      try {
        await replyText(client, message.messageId, response.text);
      } catch (error) {
        logError(error, { messageId: message.messageId, phase: 'reply' });
      }
    },
  });

  return {
    start() {
      return wsClient.start({ eventDispatcher });
    },
  };
}
