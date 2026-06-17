import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { replyFeishuMessageCard, replyFeishuMessageText, type FeishuAppSendResult, type FeishuCardPayload, type FeishuReplyConfig } from '../notify/feishuApp.js';
import { handleOperationsLearningFeedback } from '../operationsLearningLoop/session.js';
import { findLatestReportContext } from './reportStore.js';
import { formatIdLookupResult, lookupProductId } from './idLookup.js';
import { createFeishuMessageDispatcher } from './dispatcher.js';
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
}

interface FeishuCardActionEvent {
  header?: { event_type?: string };
  event?: {
    open_message_id?: unknown;
    context?: { open_message_id?: unknown };
    operator?: { open_id?: unknown; user_id?: unknown };
    action?: {
      input_value?: unknown;
      value?: unknown;
      form_value?: unknown;
      formValue?: unknown;
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

function cardActionValue(payload: FeishuCardActionEvent): Record<string, unknown> | undefined {
  return isRecord(payload.event?.action?.value) ? payload.event.action.value : undefined;
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

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

async function handleCardActionTrigger(payload: FeishuCardActionEvent, config: FeishuBotServerConfig): Promise<void> {
  const messageId = extractCardMessageId(payload);
  const value = cardActionValue(payload);
  const actionName = readString(value?.action);
  if (!messageId || !actionName) return;

  const replyText = config.replyText ?? replyFeishuMessageText;
  const replyCard = config.replyCard ?? replyFeishuMessageCard;
  const replyConfig = { appId: config.appId, appSecret: config.appSecret, messageId };

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

  if (actionName === 'id_lookup') {
    const query = readActionFormValue(payload.event?.action, 'lookup_query') ?? readString(value?.query);
    if (!query) {
      await replyText(replyConfig, '请输入端内ID或平台商品ID后再查询。');
      return;
    }
    const latest = await findLatestReportContext(config.outputDir);
    await replyText(replyConfig, latest ? formatIdLookupResult(lookupProductId(latest.context, query)) : '还没有找到公域日报上下文。');
  }
}

export function startFeishuBotServer(config: FeishuBotServerConfig) {
  const dispatcher = createFeishuMessageDispatcher({ outputDir: config.outputDir, botMentionOpenId: config.botMentionOpenId, botMentionName: config.botMentionName, handleIntent: config.handleIntent });
  const dispatchMessage = config.dispatchMessage ?? dispatcher.dispatch;

  const server = createServer(async (req, res) => {
    if (req.method !== 'POST') return writeJson(res, 404, { error: 'not found' });

    const body = await readBody(req);

    const payload = JSON.parse(body) as FeishuMessageEvent & { type?: string; challenge?: string; token?: string };
    const verification = handleUrlVerification(payload, config.verificationToken);
    if (verification) return writeJson(res, 200, verification);

    if (isCardActionTrigger(payload)) {
      writeJson(res, 200, { ok: true });
      await handleCardActionTrigger(payload, config);
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
