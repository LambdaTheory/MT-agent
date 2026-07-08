import { describe, expect, it } from 'vitest';
import { createDecisionBuilder, resolveLlmProviderFromEnv } from '../src/agentRuntime/decisionBuilderFactory.js';
import { LlmDecisionBuilder, RuleBasedDecisionBuilder } from '../src/agentRuntime/decisionBuilder.js';
import { FakeLlmProvider } from '../src/llm/fakeProvider.js';

describe('createDecisionBuilder', () => {
  it('returns RuleBased when no provider is present', () => {
    expect(createDecisionBuilder({})).toBeInstanceOf(RuleBasedDecisionBuilder);
  });

  it('returns Llm when provider is present', () => {
    expect(createDecisionBuilder({ provider: new FakeLlmProvider('{"decisions":[]}') })).toBeInstanceOf(LlmDecisionBuilder);
  });

  it('resolves undefined when LLM env is not configured', () => {
    expect(resolveLlmProviderFromEnv({})).toBeUndefined();
  });
});
