import { describe, expect, it, vi } from 'vitest';
import { parseAgentToolConfirmRequest } from '../src/agentRuntime/approvalCard.js';
import { agentExploreLedgerContextFromRequest } from '../src/feishuBot/agentExploreAttribution.js';
import { agentExploreResponse } from '../src/feishuBot/agentExploreResponse.js';
import { handleBotIntent } from '../src/feishuBot/tools.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';
import { FakeLlmProvider } from '../src/llm/fakeProvider.js';

function readConfirmRequest(card: unknown) {
  const body = (card as { body?: { elements?: Array<{ elements?: Array<{ name?: string; behaviors?: Array<{ value?: unknown }> }> }> } }).body;
  const form = body?.elements?.find((element) => Array.isArray(element.elements));
  const button = form?.elements?.find((element) => element.name === 'agent_tool_confirm_submit');
  const request = parseAgentToolConfirmRequest(button?.behaviors?.[0]?.value);
  if (!request) throw new Error('confirm request missing');
  return request;
}

function readConfirmRequests(card: unknown) {
  const body = (card as { body?: { elements?: Array<{ elements?: Array<{ name?: string; behaviors?: Array<{ value?: unknown }> }> }> } }).body;
  return (body?.elements ?? [])
    .flatMap((element) => element.elements ?? [])
    .filter((element) => element.name === 'agent_tool_confirm_submit')
    .map((element) => parseAgentToolConfirmRequest(element.behaviors?.[0]?.value))
    .filter((request): request is NonNullable<ReturnType<typeof parseAgentToolConfirmRequest>> => request !== null);
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
    const provider = new FakeLlmProvider([
      JSON.stringify({ action: 'call_tool', tool: 'system.help', args: {} }),
      JSON.stringify({ action: 'finish', answer: '已查看帮助' }),
    ]);

    const response = await agentExploreResponse('看帮助', 'output', { provider });

    expect(response.text).toContain('已查看帮助');
    expect(response.text).toContain('探索步骤：system.help');
    expect(response.card).toBeUndefined();
  });

  it('turns executable decisions into confirmation cards without executing writes', async () => {
    const provider = new FakeLlmProvider([
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

  it('turns every executable decision into an actionable confirmation button', async () => {
    const provider = new FakeLlmProvider(JSON.stringify({
      action: 'finish',
      answer: '建议处理两条链接',
      decisions: [
        {
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
        },
        {
          decisionId: 'dec-2',
          runId: 'run-1',
          title: '下架 649',
          subjects: [{ kind: 'product', id: '649' }],
          operationType: 'delist',
          recommendation: 'approve_to_execute',
          risk: 'high',
          rationale: ['测试证据'],
          evidenceRefs: ['explore.test'],
          proposedTool: { toolName: 'rental.delist', arguments: { productId: '649' } },
          uncertainties: [],
        },
      ],
    }));

    const response = await agentExploreResponse('分析 648 649', 'output', { provider });
    const requests = readConfirmRequests(response.card);

    expect(response.text).toContain('待确认执行：2 项');
    expect(requests.map((request) => request.arguments.productId)).toEqual(['648', '649']);
    expect(requests.every((request) => !request.reason.includes('[[dailyMission:'))).toBe(true);
  });

  it('round-trips valid Agent Explore decision ids into ledger attribution', async () => {
    const provider = new FakeLlmProvider(JSON.stringify({
      action: 'finish',
      answer: '建议下架 648',
      decisions: [{
        decisionId: 'dec.1:with space/中文',
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
    }));

    const response = await agentExploreResponse('分析 648', 'output', { provider });
    const request = readConfirmRequest(response.card);

    expect(agentExploreLedgerContextFromRequest(request, 'output')).toMatchObject({
      outputDir: 'output',
      runId: 'agentExplore',
      decisionId: 'dec.1:with space/中文',
    });
  });

  it('creates confirmation cards for batch delist and rollback Agent Explore write tools', async () => {
    const provider = new FakeLlmProvider(JSON.stringify({
      action: 'finish',
      answer: '建议批量下架和回滚',
      decisions: [
        {
          decisionId: 'batch-1',
          runId: 'run-1',
          title: '批量下架',
          subjects: [{ kind: 'product', id: '648' }],
          operationType: 'delist',
          recommendation: 'approve_to_execute',
          risk: 'high',
          rationale: ['测试证据'],
          evidenceRefs: ['explore.test'],
          proposedTool: { toolName: 'rental.delistBatch', arguments: { productIds: ['648', '649'] } },
          uncertainties: [],
        },
        {
          decisionId: 'rollback-1',
          runId: 'run-1',
          title: '回滚改价',
          subjects: [{ kind: 'product', id: '648' }],
          operationType: 'price_up',
          recommendation: 'approve_to_execute',
          risk: 'high',
          rationale: ['测试证据'],
          evidenceRefs: ['explore.test'],
          proposedTool: { toolName: 'rental.priceRollback', arguments: { taskId: 'task_123_abcd1234' } },
          uncertainties: [],
        },
      ],
    }));

    const response = await agentExploreResponse('分析批量操作', 'output', { provider });
    const requests = readConfirmRequests(response.card);

    expect(response.text).toContain('待确认执行：2 项');
    expect(requests.map((request) => request.toolName)).toEqual(['rental.delistBatch', 'rental.priceRollback']);
  });

  it('rejects malformed executable decisions before creating confirmation cards', async () => {
    const provider = new FakeLlmProvider(JSON.stringify({
      action: 'finish',
      answer: 'malformed decision should not become actionable',
      decisions: [{
        recommendation: 'approve_to_execute',
        risk: 'high',
        operationType: 'delist',
        evidenceRefs: ['explore.test'],
        uncertainties: [],
        proposedTool: { toolName: 'rental.delist', arguments: { productId: '648' } },
      }],
    }));

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let response: Awaited<ReturnType<typeof agentExploreResponse>>;
    try {
      response = await agentExploreResponse('分析 648', 'output', { provider });
    } finally {
      warn.mockRestore();
    }

    expect(response.card).toBeUndefined();
    expect(response.metadata).toMatchObject({ ok: false, stopReason: 'invalid', invalidReason: 'invalid_finish' });
    expect(response.text).toContain('模型完成探索时输出格式无效');
  });

  it('surfaces invalid explore loop diagnostics in logs and user text', async () => {
    const provider = new FakeLlmProvider('{"action":"unknown","note":"not executable"}');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const response = await agentExploreResponse('分析 648', 'output', { provider });

      expect(response.metadata).toMatchObject({ ok: false, stopReason: 'invalid', invalidReason: 'unknown_action' });
      expect(response.text).toContain('模型未按要求输出可执行动作');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknown_action'), expect.stringContaining('not executable'));
    } finally {
      warn.mockRestore();
    }
  });

  it('routes explicit explore commands from the Feishu unknown branch', async () => {
    const provider = new FakeLlmProvider([
      JSON.stringify({ action: 'finish', answer: '探索完成' }),
    ]);

    const response = await handleBotIntent({ type: 'unknown', text: '探索 查648曝光' }, 'output', { agentExploreProvider: provider });

    expect(response.text).toContain('探索完成');
  });
});
