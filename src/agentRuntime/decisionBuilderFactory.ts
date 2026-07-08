import { createLlmProviderFromEnv, type OpenAiCompatibleLlmEnv } from '../llm/openAiCompatibleProvider.js';
import type { LlmProvider } from '../llm/provider.js';
import { LlmDecisionBuilder, RuleBasedDecisionBuilder, type DecisionBuilder } from './decisionBuilder.js';

export function createDecisionBuilder(options: { provider?: LlmProvider }): DecisionBuilder {
  return options.provider ? new LlmDecisionBuilder({ provider: options.provider }) : new RuleBasedDecisionBuilder();
}

export function resolveLlmProviderFromEnv(env: OpenAiCompatibleLlmEnv = process.env): LlmProvider | undefined {
  return createLlmProviderFromEnv(env) ?? undefined;
}
