import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { replyFeishuMessageText, type FeishuAppSendResult, type FeishuReplyConfig } from '../notify/feishuApp.js';
import { parseBotIntent } from './intent.js';
import { handleBotIntent } from './tools.js';
import type { BotIntent, BotResponse, FeishuMessageEvent } from './types.js';
import { handleUrlVerification } from './verify.js';

export interface FeishuBotServerConfig {
  port: number;
  appId: string;
  appSecret: string;
  verificationToken?: string;
  encryptKey?: string;
  outputDir?: string;
  handleIntent?: (intent: BotIntent, outputDir?: string) => Promise<BotResponse>;
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

export function extractTextMessage(payload: FeishuMessageEvent): { messageId: string; text: string } | null {
  const message = payload.event?.message;
  if (!message?.message_id || message.message_type !== 'text' || !message.content) return null;
  const content = JSON.parse(message.content) as { text?: string };
  return content.text ? { messageId: message.message_id, text: content.text } : null;
}

export function startFeishuBotServer(config: FeishuBotServerConfig) {
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST') return writeJson(res, 404, { error: 'not found' });

    const body = await readBody(req);

    const payload = JSON.parse(body) as FeishuMessageEvent & { type?: string; challenge?: string; token?: string };
    const verification = handleUrlVerification(payload, config.verificationToken);
    if (verification) return writeJson(res, 200, verification);

    const textMessage = extractTextMessage(payload);
    if (!textMessage) return writeJson(res, 200, { ok: true });

    writeJson(res, 200, { ok: true });

    const response = await (config.handleIntent ?? handleBotIntent)(parseBotIntent(textMessage.text), config.outputDir);
    await (config.replyText ?? replyFeishuMessageText)({ appId: config.appId, appSecret: config.appSecret, messageId: textMessage.messageId }, response.text);
  });

  server.listen(config.port);
  return server;
}
