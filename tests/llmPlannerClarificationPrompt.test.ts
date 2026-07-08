import { describe, expect, it } from 'vitest';
import { createAgentPlannerProvider } from '../src/agentRuntime/llmPlanner.js';
import type { AgentPlannerRequest } from '../src/agentRuntime/planner.js';
import type { LlmGenerateJsonInput, LlmProvider } from '../src/llm/provider.js';

describe('LLM planner clarification prompt', () => {
  it('asks clarification options to bind concrete tools and arguments when possible', async () => {
    const requests: LlmGenerateJsonInput[] = [];
    const provider: LlmProvider = {
      async generateJson(input) {
        requests.push(input);
        return {
          text: '{"goal":"clarify","needsClarification":true,"originalMessage":"帮我处理 648","question":"怎么处理？","options":[],"confidence":0.4,"reason":"ambiguous"}',
          json: {},
        };
      },
    };
    const planner = createAgentPlannerProvider(provider);

    await planner.proposePlan({
      message: '帮我处理 648',
      tools: [],
      workflows: [],
    } satisfies AgentPlannerRequest);

    const system = requests[0]?.messages.find((message) => message.role === 'system')?.content ?? '';
    const clarificationPrompt = system.slice(system.indexOf('If the goal, tool, or required arguments are unclear'));

    expect(clarificationPrompt).toContain('toolName');
    expect(clarificationPrompt).toContain('arguments');
    expect(clarificationPrompt).toContain('registered tools');
    expect(clarificationPrompt).toContain('concrete tool');
    expect(clarificationPrompt).toContain('message');
  });
});
