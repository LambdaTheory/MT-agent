import { describe, expect, it } from 'vitest';
import { createAgentPlannerProvider } from '../src/agentRuntime/llmPlanner.js';
import type { AgentPlannerRequest } from '../src/agentRuntime/planner.js';
import type { LlmGenerateJsonInput, LlmProvider } from '../src/llm/provider.js';

describe('agent runtime LLM planner', () => {
  it('exposes tools and multi-step planning to the LLM without encouraging workflow selection', async () => {
    const requests: LlmGenerateJsonInput[] = [];
    const provider: LlmProvider = {
      async generateJson(input) {
        requests.push(input);
        return {
          text: '{"goal":"help","selectedTool":"system.help","arguments":{},"confidence":0.9,"reason":"test"}',
          json: { goal: 'help' },
        };
      },
    };
    const planner = createAgentPlannerProvider(provider);

    await planner.proposePlan({
      message: '帮我铺十条 pocket3 的新链',
      tools: [],
      workflows: [
        {
          name: 'legacy.workflow',
          description: 'legacy workflow should not be exposed',
          triggerExamples: ['legacy'],
          requiredCapabilities: [],
          risk: 'high',
          requiresConfirmation: true,
          argumentsSchema: {},
        },
      ],
    } satisfies AgentPlannerRequest);

    expect(requests).toHaveLength(1);
    const system = requests[0].messages.find((message) => message.role === 'system')?.content ?? '';
    const user = JSON.parse(requests[0].messages.find((message) => message.role === 'user')?.content ?? '{}') as AgentPlannerRequest;

    expect(system).toContain('multi-step plan composed only of registered tools');
    expect(system).toContain('Do not return selectedWorkflow');
    expect(system).not.toContain('For composite flows, return selectedWorkflow');
    expect(user.tools.map((tool) => tool.name)).toContain('rental.newLinkBatchPlan');
    expect(user.workflows).toEqual([]);
  });
});
