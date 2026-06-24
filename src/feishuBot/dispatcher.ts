import { createAgentRuntime, type AgentRuntime } from '../agentRuntime/runtime.js';
import type { AgentRequest, AgentResponse } from '../agentRuntime/types.js';
import { parseBotIntent } from './intent.js';
import { handleBotIntent } from './tools.js';
import type { LlmToolSelectionProvider } from './llmProvider.js';
import type { LlmIntentProposalProvider } from './llmIntentProposal.js';
import type { RentalPriceSkillClient } from './rentalPrice.js';
import type { ActivityAutomationSkillClient } from './activityAutomation.js';
import type { BotIntent, BotIntentResolver, BotResponse, FeishuBotDispatchResult, FeishuBotIncomingTextMessage } from './types.js';
import type { AgentPlannerProvider } from '../agentRuntime/planner.js';

export interface FeishuMessageDispatcherConfig {
  outputDir?: string;
  botMentionOpenId?: string;
  botMentionName?: string;
  runtime?: AgentRuntime;
  resolveIntent?: BotIntentResolver;
  handleIntent?: (intent: BotIntent, outputDir?: string) => Promise<BotResponse>;
  llmToolSelector?: LlmToolSelectionProvider;
  llmIntentProposalProvider?: LlmIntentProposalProvider;
  agentPlannerProvider?: AgentPlannerProvider;
  rentalPriceClient?: RentalPriceSkillClient;
  activityAutomationClient?: ActivityAutomationSkillClient;
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
    case 'differential_pricing_card':
    case 'latest_summary':
    case 'operations_learning_quiz':
    case 'operations_learning_summary':
    case 'operations_learning_history':
    case 'agent_learning_summary':
    case 'lookup_product_id_card':
    case 'link_registry_overview':
    case 'inventory_status_overview':
    case 'push_latest_report_to_group':
    case 'sync_closed_order_feedback':
    case 'run_closed_order_observation_report':
      return { type: intent.type };
    case 'run_public_traffic_report':
    case 'resend_latest_report':
      return { type: intent.type, sendTo: intent.sendTo };
    case 'query_product':
      return { type: intent.type, keyword: intent.keyword };
    case 'lookup_product_id':
      return { type: intent.type, query: intent.query };
    case 'inventory_status_query':
      return { type: intent.type, query: intent.query };
    case 'rental_price_change':
      return { type: intent.type, productId: intent.productId, request: intent.request };
    case 'rental_copy':
      return { type: intent.type, productId: intent.productId };
    case 'rental_delist':
      return { type: intent.type, productId: intent.productId };
    case 'rental_tenancy_set':
      return { type: intent.type, productId: intent.productId, days: intent.days };
    case 'rental_spec_discover':
      return { type: intent.type, productId: intent.productId };
    case 'rental_spec_add':
      return { type: intent.type, productId: intent.productId, itemTitle: intent.itemTitle };
    case 'unknown':
      return { type: intent.type, text: intent.text };
  }
}

function toAgentRequest(message: FeishuBotIncomingTextMessage, text: string): AgentRequest {
  return {
    source: 'feishu',
    text,
    actor: message.senderOpenId ? { id: message.senderOpenId } : undefined,
    channel: {
      id: message.chatId,
      type: message.chatType === 'group' ? 'group' : message.chatType === 'p2p' ? 'direct' : 'unknown',
    },
    metadata: { messageId: message.messageId, transport: message.source },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toBotResponse(response: AgentResponse): BotResponse {
  if (response.card === undefined) return { text: response.text };
  if (isRecord(response.card)) return { text: response.text, card: response.card };
  return { text: response.text };
}

export function createFeishuMessageDispatcher(config: FeishuMessageDispatcherConfig = {}): FeishuMessageDispatcher {
  const resolveIntent = config.resolveIntent ?? ((text: string) => parseBotIntent(text));
  const handleIntent = config.handleIntent ?? ((intent, outputDir) => handleBotIntent(intent, outputDir, {
    llmToolSelector: config.llmToolSelector,
    llmIntentProposalProvider: config.llmIntentProposalProvider,
    agentPlannerProvider: config.agentPlannerProvider,
    rentalPriceClient: config.rentalPriceClient,
    activityAutomationClient: config.activityAutomationClient,
  }));
  const logError = config.logError ?? ((error, message) => console.error(`飞书消息处理失败 ${message.messageId}:`, error));

  return {
    async dispatch(message): Promise<FeishuBotDispatchResult> {
      if (seenMessageIds.has(message.messageId)) return { text: '', skipped: true };
      rememberMessageId(message.messageId);
      if (shouldSkipGroupMessage(message, config)) return { text: '', skipped: true };

      try {
        const text = textWithoutMentionKeys(message, config);
        const runtime = config.runtime ?? createAgentRuntime({
          outputDir: config.outputDir,
          resolveIntent: (input) => canonicalizeIntent(resolveIntent(input, message)),
          handleIntent,
          llmToolSelector: config.llmToolSelector,
          llmIntentProposalProvider: config.llmIntentProposalProvider,
          agentPlannerProvider: config.agentPlannerProvider,
          rentalPriceClient: config.rentalPriceClient,
          activityAutomationClient: config.activityAutomationClient,
        });
        const response = toBotResponse(await runtime.handle(toAgentRequest(message, text)));
        return { ...response, skipped: false };
      } catch (error) {
        logError(error, message);
        return { text: `处理失败：${formatError(error)}`, skipped: false };
      }
    },
  };
}
