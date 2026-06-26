import { parseAgentFirstBotIntent, parseBotIntent } from '../feishuBot/intent.js';
import type { LlmIntentProposalProvider } from '../feishuBot/llmIntentProposal.js';
import type { LlmToolSelectionProvider } from '../feishuBot/llmProvider.js';
import type { RentalPriceSkillClient } from '../feishuBot/rentalPrice.js';
import type { ActivityAutomationSkillClient } from '../feishuBot/activityAutomation.js';
import type { ClosedOrderRegistryPathsInput } from '../closedOrderFeedback/runtime.js';
import { handleBotIntent } from '../feishuBot/tools.js';
import type { BotIntent, BotResponse } from '../feishuBot/types.js';
import type { AgentPlannerProvider } from './planner.js';
import type { AgentRequest, AgentResponse } from './types.js';

export type AgentIntentResolver = (text: string) => BotIntent;

export interface AgentRuntimeConfig {
  outputDir?: string;
  resolveIntent?: AgentIntentResolver;
  handleIntent?: (intent: BotIntent, outputDir?: string) => Promise<BotResponse>;
  llmToolSelector?: LlmToolSelectionProvider;
  llmIntentProposalProvider?: LlmIntentProposalProvider;
  agentPlannerProvider?: AgentPlannerProvider;
  rentalPriceClient?: RentalPriceSkillClient;
  activityAutomationClient?: ActivityAutomationSkillClient;
  closedOrderFetchImpl?: typeof fetch;
  closedOrderRegistryPaths?: ClosedOrderRegistryPathsInput;
}

export interface AgentRuntime {
  handle(request: AgentRequest): Promise<AgentResponse>;
}

export function createAgentRuntime(config: AgentRuntimeConfig = {}): AgentRuntime {
  const resolveIntent = config.resolveIntent ?? (config.agentPlannerProvider ? parseAgentFirstBotIntent : parseBotIntent);
  const handleIntent = config.handleIntent ?? ((intent: BotIntent, outputDir?: string) => handleBotIntent(intent, outputDir, {
    llmToolSelector: config.llmToolSelector,
    llmIntentProposalProvider: config.llmIntentProposalProvider,
    agentPlannerProvider: config.agentPlannerProvider,
    rentalPriceClient: config.rentalPriceClient,
    activityAutomationClient: config.activityAutomationClient,
    closedOrderFetchImpl: config.closedOrderFetchImpl,
    closedOrderRegistryPaths: config.closedOrderRegistryPaths,
  }));

  return {
    async handle(request) {
      const intent = resolveIntent(request.text);
      return handleIntent(intent, config.outputDir);
    },
  };
}
