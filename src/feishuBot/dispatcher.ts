import { parseBotIntent } from './intent.js';
import { handleBotIntent } from './tools.js';
import type { LlmToolSelectionProvider } from './llmProvider.js';
import type { BotIntent, BotIntentResolver, BotResponse, FeishuBotDispatchResult, FeishuBotIncomingTextMessage } from './types.js';

export interface FeishuMessageDispatcherConfig {
  outputDir?: string;
  botMentionOpenId?: string;
  botMentionName?: string;
  resolveIntent?: BotIntentResolver;
  handleIntent?: (intent: BotIntent, outputDir?: string) => Promise<BotResponse>;
  llmToolSelector?: LlmToolSelectionProvider;
  logError?: (error: unknown, message: FeishuBotIncomingTextMessage) => void;
}

export interface FeishuMessageDispatcher {
  dispatch(message: FeishuBotIncomingTextMessage): Promise<FeishuBotDispatchResult>;
}

export const MAX_SEEN_MESSAGE_IDS = 1000;
const seenMessageIds = new Set<string>();

function rememberMessageId(messageId: string): void {
  seenMessageIds.add(messageId);
  if (seenMessageIds.size <= MAX_SEEN_MESSAGE_IDS) return;

  const oldestMessageId = seenMessageIds.values().next().value;
  if (oldestMessageId !== undefined) seenMessageIds.delete(oldestMessageId);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalized(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function hasBotMentionIdentity(config: FeishuMessageDispatcherConfig): boolean {
  return Boolean(normalized(config.botMentionOpenId) || normalized(config.botMentionName));
}

function mentionMatchesConfiguredBot(mention: NonNullable<FeishuBotIncomingTextMessage['mentions']>[number], config: FeishuMessageDispatcherConfig): boolean {
  const botOpenId = normalized(config.botMentionOpenId);
  const botName = normalized(config.botMentionName);
  return Boolean((botOpenId && mention.id?.open_id === botOpenId) || (botName && mention.name === botName));
}

function botMentions(message: FeishuBotIncomingTextMessage, config: FeishuMessageDispatcherConfig): NonNullable<FeishuBotIncomingTextMessage['mentions']> {
  const mentions = message.mentions ?? [];
  return hasBotMentionIdentity(config) ? mentions.filter((mention) => mentionMatchesConfiguredBot(mention, config)) : [];
}

function shouldSkipGroupMessage(message: FeishuBotIncomingTextMessage, config: FeishuMessageDispatcherConfig): boolean {
  return message.chatType === 'group' && botMentions(message, config).length === 0;
}

function textWithoutMentionKeys(message: FeishuBotIncomingTextMessage, config: FeishuMessageDispatcherConfig): string {
  let text = message.text;
  for (const mention of botMentions(message, config)) {
    if (mention.key) text = text.replaceAll(mention.key, ' ');
  }
  return text.replace(/\s+/g, ' ').trim();
}

function canonicalizeIntent(intent: BotIntent): BotIntent {
  switch (intent.type) {
    case 'help':
    case 'latest_summary':
    case 'operations_learning_quiz':
    case 'lookup_product_id_card':
    case 'push_latest_report_to_group':
      return { type: intent.type };
    case 'run_public_traffic_report':
    case 'resend_latest_report':
      return { type: intent.type, sendTo: intent.sendTo };
    case 'query_product':
      return { type: intent.type, keyword: intent.keyword };
    case 'lookup_product_id':
      return { type: intent.type, query: intent.query };
    case 'unknown':
      return { type: intent.type, text: intent.text };
  }
}

export function createFeishuMessageDispatcher(config: FeishuMessageDispatcherConfig = {}): FeishuMessageDispatcher {
  const resolveIntent = config.resolveIntent ?? ((text: string) => parseBotIntent(text));
  const handleIntent = config.handleIntent ?? ((intent, outputDir) => handleBotIntent(intent, outputDir, { llmToolSelector: config.llmToolSelector }));
  const logError = config.logError ?? ((error, message) => console.error(`飞书消息处理失败 ${message.messageId}:`, error));

  return {
    async dispatch(message): Promise<FeishuBotDispatchResult> {
      if (seenMessageIds.has(message.messageId)) return { text: '', skipped: true };
      rememberMessageId(message.messageId);
      if (shouldSkipGroupMessage(message, config)) return { text: '', skipped: true };

      try {
        const intent = canonicalizeIntent(resolveIntent(textWithoutMentionKeys(message, config), message));
        const response = await handleIntent(intent, config.outputDir);
        return { ...response, skipped: false };
      } catch (error) {
        logError(error, message);
        return { text: `处理失败：${formatError(error)}`, skipped: false };
      }
    },
  };
}
