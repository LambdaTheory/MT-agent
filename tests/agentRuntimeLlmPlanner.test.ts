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
    expect(system).toContain('resultMetadataSchema');
    expect(system).toContain('publicTraffic.reportQuery');
    expect(system).toContain('arbitrary read-only questions about saved public traffic report data');
    expect(system).toContain('target productAggregation');
    expect(system).toContain('aggregation count/sum/avg/min/max');
    expect(system).toContain('target sourceCoverage');
    expect(system).toContain('coverageStatus missing');
    expect(system).toContain('target orderDerived');
    expect(system).toContain('orderDerivedMetric closeRateStatus');
    expect(system).toContain('target productDetail');
    expect(system).toContain('target comparison');
    expect(system).toContain('use rental.priceSnapshot');
    expect(system).toContain('linkRegistry.resolveProducts');
    expect(system).toContain('rental.pricePreview');
    expect(system).toContain('use rental.specRemovePlan');
    expect(system).toContain('should normally be the final step');
    expect(system).not.toContain('For composite flows, return selectedWorkflow');
    expect(user.tools.map((tool) => tool.name)).toContain('rental.newLinkBatchPlan');
    expect(user.tools.map((tool) => tool.name)).toContain('publicTraffic.reportQuery');
    expect(user.tools.map((tool) => tool.name)).toContain('linkRegistry.resolveProducts');
    expect(user.tools.map((tool) => tool.name)).toContain('rental.pricePreview');
    expect(user.tools.find((tool) => tool.name === 'product.rankBestSameSku')?.resultMetadataSchema).toMatchObject({
      properties: { bestProductId: { type: 'string' } },
    });
    expect(user.tools.find((tool) => tool.name === 'linkRegistry.resolveProducts')?.resultMetadataSchema).toMatchObject({
      properties: { productIds: { type: 'array' } },
    });
    expect(user.tools.find((tool) => tool.name === 'rental.copy')?.resultMetadataSchema).toMatchObject({
      properties: { newProductId: { type: 'string' } },
    });
    expect(user.workflows).toEqual([]);
  });
});
