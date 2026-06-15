import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { replyFeishuMessageText, type FeishuAppSendResult, type FeishuReplyConfig } from '../notify/feishuApp.js';
import { createFeishuMessageDispatcher } from './dispatcher.js';
import type { BotIntent, BotResponse, FeishuBotDispatchResult, FeishuBotIncomingTextMessage, FeishuMessageEvent } from './types.js';
import { handleUrlVerification } from './verify.js';

export interface FeishuBotServerConfig {
  port: number;
  appId: string;
  appSecret: string;
  verificationToken?: string;
  encryptKey?: string;
  outputDir?: string;
  handleIntent?: (intent: BotIntent, outputDir?: string) => Promise<BotResponse>;
  dispatchMessage?: (message: FeishuBotIncomingTextMessage) => Promise<FeishuBotDispatchResult>;
  replyText?: (config: FeishuReplyConfig, text: string) => Promise<FeishuAppSendResult>;
}

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

export function startFeishuBotServer(config: FeishuBotServerConfig) {
  const dispatcher = createFeishuMessageDispatcher({ outputDir: config.outputDir, handleIntent: config.handleIntent });
  const dispatchMessage = config.dispatchMessage ?? dispatcher.dispatch;

  const server = createServer(async (req, res) => {
    if (req.method !== 'POST') return writeJson(res, 404, { error: 'not found' });

    const body = await readBody(req);

    const payload = JSON.parse(body) as FeishuMessageEvent & { type?: string; challenge?: string; token?: string };
    const verification = handleUrlVerification(payload, config.verificationToken);
    if (verification) return writeJson(res, 200, verification);

    const textMessage = extractTextMessage(payload);
    if (!textMessage) return writeJson(res, 200, { ok: true });

    writeJson(res, 200, { ok: true });

    const response = await dispatchMessage({ ...textMessage, source: 'http' });
    if (!response.skipped) await (config.replyText ?? replyFeishuMessageText)({ appId: config.appId, appSecret: config.appSecret, messageId: textMessage.messageId }, response.text);
  });

  server.listen(config.port);
  return server;
}
