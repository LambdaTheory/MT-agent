import { describe, expect, it, vi } from 'vitest';
import { parseAgentToolConfirmRequest } from '../src/agentRuntime/approvalCard.js';
import { agentExploreResponse } from '../src/feishuBot/agentExploreResponse.js';
import { handleBotIntent } from '../src/feishuBot/tools.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';
import type { LlmGenerateJsonInput, LlmProvider, LlmProviderResult } from '../src/llm/provider.js';

class ScriptedProvider implements LlmProvider {
  private index = 0;

  constructor(private readonly scripts: string[]) {}

  async generateJson(_input: LlmGenerateJsonInput): Promise<LlmProviderResult> {
    const text = this.scripts[Math.min(this.index++, this.scripts.length - 1)];
    return { text, json: JSON.parse(text), model: 'fake' };
  }
}

function readConfirmRequest(card: unknown) {
  const body = (card as { body?: { elements?: Array<{ elements?: Array<{ name?: string; behaviors?: Array<{ value?: unknown }> }> }> } }).body;
  const form = body?.elements?.find((element) => Array.isArray(element.elements));
  const button = form?.elements?.find((element) => element.name === 'agent_tool_confirm_submit');
  const request = parseAgentToolConfirmRequest(button?.behaviors?.[0]?.value);
  if (!request) throw new Error('confirm request missing');
  return request;
}

function rentalClientWithDelist(delist: RentalPriceSkillClient['delist']): RentalPriceSkillClient {
  return {
    async preview() { throw new Error('preview should not run'); },
    async execute() { throw new Error('execute should not run'); },
    async copy() { throw new Error('copy should not run'); },
    delist,
    async tenancySet() { throw new Error('tenancySet should not run'); },
    async specDiscover() { throw new Error('specDiscover should not run'); },
    async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
  };
}

describe('agentExploreResponse', () => {
  it('runs a read-only tool and returns the answer with step summary', async () => {
    const provider = new ScriptedProvider([
      JSON.stringify({ action: 'call_tool', tool: 'system.help', args: {} }),
      JSON.stringify({ action: 'finish', answer: '已查看帮助' }),
    ]);

    const response = await agentExploreResponse('看帮助', 'output', { provider });

    expect(response.text).toContain('已查看帮助');
    expect(response.text).toContain('探索步骤：system.help');
    expect(response.card).toBeUndefined();
  });

  it('turns executable decisions into confirmation cards without executing writes', async () => {
    const provider = new ScriptedProvider([
      JSON.stringify({
        action: 'finish',
        answer: '建议下架 648',
        decisions: [{
          decisionId: 'dec-1',
          runId: 'run-1',
          title: '下架 648',
          subjects: [{ kind: 'product', id: '648' }],
          operationType: 'delist',
          recommendation: 'approve_to_execute',
          risk: 'high',
          rationale: ['测试证据'],
          evidenceRefs: ['explore.test'],
          proposedTool: { toolName: 'rental.delist', arguments: { productId: '648' } },
          uncertainties: [],
        }],
      }),
    ]);
    const delist = vi.fn(async () => ({ productId: '648', ok: true, lines: ['should not run'] }));

    const response = await agentExploreResponse('分析 648', 'output', { provider, executionOptions: { rentalPriceClient: rentalClientWithDelist(delist) } });

    expect(delist).not.toHaveBeenCalled();
    expect(response.text).toContain('待确认执行：1 项');
    const request = readConfirmRequest(response.card);
    expect(request.toolName).toBe('rental.delist');
    expect(request.reason).not.toContain('[[dailyMission:');
    expect(request.reason).toContain('下架 648');
  });

  it('routes explicit explore commands from the Feishu unknown branch', async () => {
    const provider = new ScriptedProvider([
      JSON.stringify({ action: 'finish', answer: '探索完成' }),
    ]);

    const response = await handleBotIntent({ type: 'unknown', text: '探索 查648曝光' }, 'output', { agentExploreProvider: provider });

    expect(response.text).toContain('探索完成');
  });
});
