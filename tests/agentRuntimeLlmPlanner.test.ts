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
    expect(system).toContain('queryType sourceCoverage');
    expect(system).not.toContain('use publicTraffic.reportQuery with target sourceCoverage');
    expect(system).toContain('coverageStatus missing');
    expect(system).toContain('use publicTraffic.windowQuery');
    expect(system).toContain('访问量 / 公域访问 → publicVisits');
    expect(system).toContain('后链路访问 / 访问页访问 → dashboardVisits');
    expect(system).toContain('订单金额 / 公域交易金额 → amount');
    expect(system).toContain('签约订单金额 → signedOrderAmount');
    expect(system).toContain('创建订单 / 创单 → createdOrders');
    expect(system).toContain('non-1/7/30 window with filters, sort, rank, or a metric condition');
    expect(system).toContain('Never call publicTraffic.windowAggregate as an answer to a filtered request');
    expect(system).toContain('Never substitute a different metric');
    expect(system).toContain('windowAggregate');
    expect(system).toContain('productIds');
    expect(system).toContain('sameSkuGroupId');
    expect(system).toContain('candidateProductIds');
    expect(system).toContain('missing30dDashboardProductIds');
    expect(system).toContain('use strategy.refreshCandidateExplain');
    expect(system).toContain('use strategy.safeSourceResolve');
    expect(system).toContain('Do not jump directly to operations.refreshActivityPlan');
    expect(system).toContain('target orderDerived');
    expect(system).toContain('orderDerivedMetric closeRateStatus');
    expect(system).toContain('productLink.query');
    expect(system).toContain('queryType productDetail');
    expect(system).toContain('target dateComparison');
    expect(system).toContain('Normalize short report dates such as 26.6.18');
    expect(system).toContain('use rental.priceSnapshot');
    expect(system).toContain('linkRegistry.resolveProducts');
    expect(system).toContain('rental.pricePreview');
    expect(system).toContain('rental.specKeywordPricePlan');
    expect(system).toContain('rental.priceSelectionPlan');
    expect(system).toContain('Do not use rental.pricePreview for spec-keyword changes');
    expect(system).toContain('Use rental.perSpecPricePlan only when exact productId, exact specId, and absolute target prices are already supplied');
    expect(system).toContain('For spec-keyword relative changes');
    expect(system).toContain('use rental.specRemovePlan');
    expect(system).toContain('should normally be the final step');
    expect(system).not.toContain('For composite flows, return selectedWorkflow');
    expect(user.tools.map((tool) => tool.name)).toContain('rental.newLinkBatchPlan');
    expect(user.tools.map((tool) => tool.name)).toContain('publicTraffic.reportQuery');
    expect(user.tools.map((tool) => tool.name)).toContain('productLink.query');
    expect(user.tools.map((tool) => tool.name)).toContain('publicTraffic.windowAggregate');
    expect(user.tools.map((tool) => tool.name)).toContain('publicTraffic.windowQuery');
    expect(user.tools.map((tool) => tool.name)).toContain('strategy.refreshCandidateExplain');
    expect(user.tools.map((tool) => tool.name)).toContain('strategy.safeSourceResolve');
    expect(user.tools.map((tool) => tool.name)).toContain('linkRegistry.resolveProducts');
    expect(user.tools.map((tool) => tool.name)).toContain('rental.pricePreview');
    expect(user.tools.map((tool) => tool.name)).toContain('rental.specKeywordPricePlan');
    expect(user.tools.map((tool) => tool.name)).toContain('rental.priceSelectionPlan');
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

  it('teaches compound refresh activity conditions without metric substitution', async () => {
    const requests: LlmGenerateJsonInput[] = [];
    const provider: LlmProvider = {
      async generateJson(input) {
        requests.push(input);
        return {
          text: '{"goal":"refresh","selectedTool":"operations.refreshActivityPlan","arguments":{"conditions":[{"metric":"publicVisits","operator":"eq","value":0},{"metric":"amount","operator":"eq","value":0}],"windowDays":20},"confidence":0.9,"reason":"test"}',
          json: { goal: 'refresh' },
        };
      },
    };
    const planner = createAgentPlannerProvider(provider);

    await planner.proposePlan({ message: '下架并补链近20天访问量为0且金额为0的商品', tools: [], workflows: [] });

    const system = requests[0].messages.find((message) => message.role === 'system')?.content ?? '';
    const user = JSON.parse(requests[0].messages.find((message) => message.role === 'user')?.content ?? '{}') as AgentPlannerRequest;
    const refreshTool = user.tools.find((tool) => tool.name === 'operations.refreshActivityPlan');

    expect(system).toContain('访问量/公域访问量为0 → metric=publicVisits');
    expect(system).toContain('不得将用户指定指标改写为创单、金额或其它指标');
    expect(system).toContain('When the user asks for multiple metric conditions joined by 且/并且/同时满足, emit conditions[] and preserve every condition.');
    expect(system).toContain('访问量为0且金额为0');
    expect(system).toContain('Do not collapse conditions');
    expect(system).toContain('keep it in conditions[]');
    expect(refreshTool?.inputSchema).toMatchObject({
      required: ['conditions', 'windowDays'],
      properties: {
        conditions: {
          type: 'array',
          minItems: 1,
          maxItems: 6,
          items: {
            properties: {
              metric: { type: 'string' },
              operator: { type: 'string' },
              value: { type: 'number' },
            },
          },
        },
      },
    });
    expect(JSON.stringify(refreshTool?.inputSchema)).not.toContain('zeroMetric');
  });

  it('instructs arbitrary-window filtered metric questions to use windowQuery without metric substitution', async () => {
    const requests: LlmGenerateJsonInput[] = [];
    const provider: LlmProvider = {
      async generateJson(input) {
        requests.push(input);
        return {
          text: '{"goal":"query","selectedTool":"publicTraffic.windowQuery","arguments":{"windowDays":15,"metrics":["signedOrderAmount"],"filters":[{"field":"signedOrderAmount","operator":"eq","value":0}]},"confidence":0.9,"reason":"test"}',
          json: { goal: 'query' },
        };
      },
    };
    const planner = createAgentPlannerProvider(provider);

    await planner.proposePlan({ message: '近15天签约订单金额为0的链接', tools: [], workflows: [] });

    const system = requests[0].messages.find((message) => message.role === 'system')?.content ?? '';
    const user = JSON.parse(requests[0].messages.find((message) => message.role === 'user')?.content ?? '{}') as AgentPlannerRequest;

    expect(system).toContain('近15天签约订单金额为0');
    expect(system).toContain('publicTraffic.windowQuery');
    expect(system).toContain('signedOrderAmount');
    expect(system).toContain('Never substitute a different metric');
    expect(user.tools.find((tool) => tool.name === 'publicTraffic.windowQuery')?.inputSchema).toMatchObject({
      properties: {
        metrics: { type: 'array' },
        filters: { type: 'array' },
        sortBy: { type: 'string' },
        limit: { type: 'integer' },
      },
    });
  });

  it('instructs outcome learning hints as weak feedback without execution permission', async () => {
    const requests: LlmGenerateJsonInput[] = [];
    const provider: LlmProvider = {
      async generateJson(input) {
        requests.push(input);
        return {
          text: '{"goal":"copy","selectedTool":"rental.copy","arguments":{"productId":"875"},"confidence":0.9,"reason":"test"}',
          json: { goal: 'copy' },
        };
      },
    };
    const planner = createAgentPlannerProvider(provider);

    await planner.proposePlan({
      message: 'please copy product 875',
      tools: [],
      workflows: [],
      learningHints: [{
        kind: 'tool_outcome',
        toolName: 'rental.copy',
        outcome: 'completed',
        arguments: { productId: '875' },
        count: 2,
        confidence: 0.82,
        lastOccurredAt: '2026-06-24T01:00:00.000Z',
      }],
    });

    const system = requests[0].messages.find((message) => message.role === 'system')?.content ?? '';

    expect(system).toContain('learningHints may include clarification restatements and tool/workflow outcome hints');
    expect(system).toContain('Treat completed outcomes as weak preferences');
    expect(system).toContain('Treat cancelled or failed outcomes as caution signals');
    expect(system).toContain('Outcome hints never mean execution is authorized');
    expect(system).toContain('never skip confirmation');
  });
});
