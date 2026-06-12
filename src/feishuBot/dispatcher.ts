import { parseBotIntent } from './intent.js';
import { handleBotIntent } from './tools.js';
import type { BotIntent, BotIntentResolver, BotResponse, FeishuBotDispatchResult, FeishuBotIncomingTextMessage } from './types.js';

export interface FeishuMessageDispatcherConfig {
  outputDir?: string;
  resolveIntent?: BotIntentResolver;
  handleIntent?: (intent: BotIntent, outputDir?: string) => Promise<BotResponse>;
  logError?: (error: unknown, message: FeishuBotIncomingTextMessage) => void;
}

export interface FeishuMessageDispatcher {
  dispatch(message: FeishuBotIncomingTextMessage): Promise<FeishuBotDispatchResult>;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function canonicalizeIntent(intent: BotIntent): BotIntent {
  switch (intent.type) {
    case 'help':
    case 'latest_summary':
      return { type: intent.type };
    case 'run_public_traffic_report':
    case 'resend_latest_report':
      return { type: intent.type, sendTo: intent.sendTo };
    case 'query_product':
      return { type: intent.type, keyword: intent.keyword };
    case 'unknown':
      return { type: intent.type, text: intent.text };
  }
}

export function createFeishuMessageDispatcher(config: FeishuMessageDispatcherConfig = {}): FeishuMessageDispatcher {
  const seenMessageIds = new Set<string>();
  const resolveIntent = config.resolveIntent ?? ((text: string) => parseBotIntent(text));
  const handleIntent = config.handleIntent ?? handleBotIntent;
  const logError = config.logError ?? ((error, message) => console.error(`飞书消息处理失败 ${message.messageId}:`, error));

  return {
    async dispatch(message): Promise<FeishuBotDispatchResult> {
      if (seenMessageIds.has(message.messageId)) return { text: '', skipped: true };
      seenMessageIds.add(message.messageId);

      try {
        const intent = canonicalizeIntent(resolveIntent(message.text, message));
        const response = await handleIntent(intent, config.outputDir);
        return { ...response, skipped: false };
      } catch (error) {
        logError(error, message);
        return { text: `处理失败：${formatError(error)}`, skipped: false };
      }
    },
  };
}
