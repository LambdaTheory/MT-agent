import { createAgentRuntime, type AgentRuntime } from '../agentRuntime/runtime.js';
import type { AgentRequest, AgentResponse } from '../agentRuntime/types.js';
import { parseAgentFirstBotIntent, parseBotIntent } from './intent.js';
import { handleBotIntent } from './tools.js';
import type { LlmToolSelectionProvider } from './llmProvider.js';
import type { LlmIntentProposalProvider } from './llmIntentProposal.js';
import type { RentalPriceSkillClient } from './rentalPrice.js';
import type { ActivityAutomationSkillClient } from './activityAutomation.js';
import type { BotIntent, BotIntentResolver, BotResponse, FeishuBotDispatchResult, FeishuBotIncomingTextMessage } from './types.js';
import type { AgentPlannerProvider } from '../agentRuntime/planner.js';
import type { ClosedOrderRegistryPathsInput } from '../closedOrderFeedback/runtime.js';
import type { LlmProvider } from '../llm/provider.js';

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
  agentExploreProvider?: LlmProvider;
  rentalPriceClient?: RentalPriceSkillClient;
  activityAutomationClient?: ActivityAutomationSkillClient;
  closedOrderFetchImpl?: typeof fetch;
  closedOrderRegistryPaths?: ClosedOrderRegistryPathsInput;
  logError?: (error: unknown, message: FeishuBotIncomingTextMessage) => void;
}

export interface FeishuMessageDispatcher {
  dispatch(message: FeishuBotIncomingTextMessage): Promise<FeishuBotDispatchResult>;
}

export const MAX_SEEN_MESSAGE_IDS = 1000;
const seenMessageIds = new Set<string>();
export const MESSAGE_ID_CLAIMED_METADATA_KEY = 'messageIdClaimed';

function rememberMessageId(messageId: string): void {
  seenMessageIds.add(messageId);
  if (seenMessageIds.size <= MAX_SEEN_MESSAGE_IDS) return;

  const oldestMessageId = seenMessageIds.values().next().value;
  if (oldestMessageId !== undefined) seenMessageIds.delete(oldestMessageId);
}

export function claimFeishuMessageId(messageId: string): boolean {
  if (seenMessageIds.has(messageId)) return false;
  rememberMessageId(messageId);
  return true;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalized(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
    const names = [mention.name, config.botMentionName]
      .map(normalized)
      .filter((value, index, items): value is string => Boolean(value && items.indexOf(value) === index));
    for (const name of names) {
      const escapedName = escapeRegExp(name);
      text = text
        .replace(new RegExp(`<at\\b[^>]*>\\s*${escapedName}\\s*<\\/at>`, 'giu'), ' ')
        .replace(new RegExp(`(^|\\s)@\\s*${escapedName}(?=\\s|$)`, 'giu'), '$1 ')
        .replace(new RegExp(`(^|\\s)${escapedName}(?=\\s|$)`, 'giu'), '$1 ');
    }
  }
  return text.replace(/\s+/g, ' ').trim();
}

function canonicalizeIntent(intent: BotIntent): BotIntent {
  switch (intent.type) {
    case 'help':
    case 'differential_pricing_card':
    case 'cancel_differential_pricing_card':
    case 'operations_learning_quiz':
    case 'operations_learning_summary':
    case 'operations_learning_history':
    case 'agent_learning_summary':
    case 'lookup_product_id_card':
    case 'link_registry_overview':
    case 'link_registry_governance_prompt':
    case 'link_registry_maintenance_hub':
    case 'inventory_status_overview':
    case 'sync_closed_order_feedback':
    case 'run_closed_order_observation_report':
      return { type: intent.type };
    case 'link_registry_maintenance_prompt':
      return { type: intent.type, ...(intent.sourceMode ? { sourceMode: intent.sourceMode } : {}) };
    case 'latest_summary':
    case 'conversion_summary':
      return { type: intent.type, ...(intent.date ? { date: intent.date } : {}) };
    case 'push_latest_report_to_group':
      return { type: intent.type, ...(intent.date ? { date: intent.date } : {}) };
    case 'run_public_traffic_report':
      return { type: intent.type, sendTo: intent.sendTo };
    case 'run_inactive_refresh':
      return { type: intent.type, ...(intent.date ? { date: intent.date } : {}) };
    case 'refresh_public_traffic_dashboard':
      return { type: intent.type, ...(intent.date ? { date: intent.date } : {}), sendTo: intent.sendTo };
    case 'resend_latest_report':
      return { type: intent.type, sendTo: intent.sendTo, ...(intent.date ? { date: intent.date } : {}) };
    case 'query_product':
      return { type: intent.type, keyword: intent.keyword, ...(intent.date ? { date: intent.date } : {}) };
    case 'lookup_product_id':
      return { type: intent.type, query: intent.query, ...(intent.date ? { date: intent.date } : {}) };
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
      return { type: intent.type, productId: intent.productId, specDimId: intent.specDimId, itemTitle: intent.itemTitle };
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

function readClarificationDepth(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function toBotResponse(response: AgentResponse): BotResponse {
  const base = response.metadata ? { text: response.text, metadata: response.metadata } : { text: response.text };
  const withProgress = isRecord(response.progressCard) ? { ...base, progressCard: response.progressCard } : base;
  if (response.card === undefined) return withProgress;
  if (isRecord(response.card)) return { ...withProgress, card: response.card };
  return withProgress;
}

export function createFeishuMessageDispatcher(config: FeishuMessageDispatcherConfig = {}): FeishuMessageDispatcher {
  const resolveIntent = config.resolveIntent ?? ((text: string) => (config.agentPlannerProvider ? parseAgentFirstBotIntent(text) : parseBotIntent(text)));
  const logError = config.logError ?? ((error, message) => console.error(`飞书消息处理失败 ${message.messageId}:`, error));

  return {
    async dispatch(message): Promise<FeishuBotDispatchResult> {
      if (message.metadata?.[MESSAGE_ID_CLAIMED_METADATA_KEY] !== true && !claimFeishuMessageId(message.messageId)) return { text: '', skipped: true };
      if (shouldSkipGroupMessage(message, config)) return { text: '', skipped: true };

      try {
        const text = textWithoutMentionKeys(message, config);
        const handleIntent = config.handleIntent ?? ((intent, outputDir) => handleBotIntent(intent, outputDir, {
          llmToolSelector: config.llmToolSelector,
          llmIntentProposalProvider: config.llmIntentProposalProvider,
          agentPlannerProvider: config.agentPlannerProvider,
          agentExploreProvider: config.agentExploreProvider,
          rentalPriceClient: config.rentalPriceClient,
          activityAutomationClient: config.activityAutomationClient,
          closedOrderFetchImpl: config.closedOrderFetchImpl,
          closedOrderRegistryPaths: config.closedOrderRegistryPaths,
          clarificationDepth: readClarificationDepth(message.metadata?.clarificationDepth),
        }));
        const runtime = config.runtime ?? createAgentRuntime({
          outputDir: config.outputDir,
          resolveIntent: (input) => canonicalizeIntent(resolveIntent(input, message)),
          handleIntent,
          llmToolSelector: config.llmToolSelector,
          llmIntentProposalProvider: config.llmIntentProposalProvider,
          agentPlannerProvider: config.agentPlannerProvider,
          agentExploreProvider: config.agentExploreProvider,
          rentalPriceClient: config.rentalPriceClient,
          activityAutomationClient: config.activityAutomationClient,
          closedOrderFetchImpl: config.closedOrderFetchImpl,
          closedOrderRegistryPaths: config.closedOrderRegistryPaths,
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
