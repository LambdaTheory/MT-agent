import { describe, expect, it } from 'vitest';
import type { AgentPlannerProvider } from '../src/agentRuntime/planner.js';
import { handleBotIntent, shouldForceClarificationBeforePlanner } from '../src/feishuBot/tools.js';

describe('ambiguous write clarification gate', () => {
  it('identifies vague high-risk operations on internal product ids', () => {
    expect(shouldForceClarificationBeforePlanner('处理一下761')).toBe(true);
    expect(shouldForceClarificationBeforePlanner('帮我处理一下648')).toBe(true);
    expect(shouldForceClarificationBeforePlanner('处理一下761/648')).toBe(true);
    expect(shouldForceClarificationBeforePlanner('把761下架')).toBe(false);
    expect(shouldForceClarificationBeforePlanner('把761/648下架')).toBe(false);
    expect(shouldForceClarificationBeforePlanner('给761补3条新链')).toBe(false);
    expect(shouldForceClarificationBeforePlanner('查761')).toBe(false);
  });

  it('forces vague single-id operations into clarification before the planner can guess a write tool', async () => {
    let plannerCalled = false;
    const planner: AgentPlannerProvider = {
      async proposePlan() {
        plannerCalled = true;
        return JSON.stringify({
          goal: '猜测给 761 铺新链',
          selectedTool: 'rental.newLinkBatchPlan',
          arguments: { sourceProductId: '761', count: 3 },
          confidence: 0.94,
          reason: 'planner should not be reached for vague high-risk operation',
          requiresConfirmation: true,
        });
      },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '处理一下761' }, 'output', {
      agentPlannerProvider: planner,
    });

    expect(plannerCalled).toBe(false);
    expect(response.text).toBe('你想对 761 做什么？');
    expect(response.card).toBeDefined();
    expect(JSON.stringify(response.card)).toContain('agent_clarify_select');
    expect(JSON.stringify(response.card)).not.toContain('rental.newLinkBatchPlan');
    expect(response.metadata).toMatchObject({ needsClarification: true });
  });

  it('forces vague multi-id operations into clarification before the planner can guess a write tool', async () => {
    let plannerCalled = false;
    const planner: AgentPlannerProvider = {
      async proposePlan() {
        plannerCalled = true;
        return JSON.stringify({
          goal: '猜测给 761 和 648 铺新链',
          selectedTool: 'rental.newLinkBatchPlan',
          arguments: { items: [{ sourceProductId: '761', count: 3 }, { sourceProductId: '648', count: 3 }] },
          confidence: 0.94,
          reason: 'planner should not be reached for vague high-risk operation',
          requiresConfirmation: true,
        });
      },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '处理一下761/648' }, 'output', {
      agentPlannerProvider: planner,
    });

    expect(plannerCalled).toBe(false);
    expect(response.text).toBe('你想对 761/648 做什么？');
    expect(response.card).toBeDefined();
    expect(JSON.stringify(response.card)).toContain('agent_clarify_select');
    expect(JSON.stringify(response.card)).not.toContain('rental.newLinkBatchPlan');
    expect(response.metadata).toMatchObject({ needsClarification: true });
  });
});
