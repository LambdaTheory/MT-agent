import { describe, expect, it } from 'vitest';
import { parseAgentToolConfirmRequest } from '../src/agentRuntime/approvalCard.js';
import { agentExploreResponse } from '../src/feishuBot/agentExploreResponse.js';
import { FakeLlmProvider } from '../src/llm/fakeProvider.js';

function readConfirmRequests(card: unknown) {
  const body = (card as { body?: { elements?: Array<{ elements?: Array<{ name?: string; behaviors?: Array<{ value?: unknown }> }> }> } }).body;
  return (body?.elements ?? [])
    .flatMap((element) => element.elements ?? [])
    .filter((element) => element.name === 'agent_tool_confirm_submit')
    .map((element) => parseAgentToolConfirmRequest(element.behaviors?.[0]?.value))
    .filter((request): request is NonNullable<ReturnType<typeof parseAgentToolConfirmRequest>> => request !== null);
}

function decision(decisionId: string, toolName: string, args: Record<string, unknown>) {
  return {
    decisionId,
    runId: 'run-1',
    title: `${toolName} ${decisionId}`,
    subjects: [{ kind: 'product', id: '648' }],
    operationType: 'observe',
    recommendation: 'approve_to_execute',
    risk: 'high',
    rationale: ['测试证据'],
    evidenceRefs: ['explore.coverage.test'],
    proposedTool: { toolName, arguments: args },
    uncertainties: [],
  };
}

describe('Agent Explore confirmation card coverage', () => {
  it('creates confirmation buttons for ledger-covered rental write tools', async () => {
    const provider = new FakeLlmProvider(JSON.stringify({
      action: 'finish',
      answer: '建议执行原子写操作',
      decisions: [
        decision('price-apply', 'rental.priceApply', { items: [{ productId: '648', fields: { rent1day: '88.00' } }] }),
        decision('per-spec', 'rental.perSpecPriceApply', { productId: '648', specFields: { '3863': { rent1day: '88.00' } } }),
        decision('spec-dim', 'rental.specDimApply', { productId: '648', action: 'add', title: '激光险' }),
        decision('batch-delist', 'rental.delistBatch', { productIds: ['648', '649'] }),
        decision('rollback', 'rental.priceRollback', { taskId: 'task_123_abcd1234' }),
      ],
    }));

    const response = await agentExploreResponse('分析原子写操作', 'output', { provider });
    const requests = readConfirmRequests(response.card);

    expect(response.text).toContain('待确认执行：5 项');
    expect(requests.map((request) => request.toolName)).toEqual([
      'rental.priceApply',
      'rental.perSpecPriceApply',
      'rental.specDimApply',
      'rental.delistBatch',
      'rental.priceRollback',
    ]);
  });

  it('does not create generic Explore cards for advanced form-state tools', async () => {
    const provider = new FakeLlmProvider(JSON.stringify({
      action: 'finish',
      answer: '高级表单态需要专用入口',
      decisions: [
        decision('apply-current', 'rental.applyCurrent', { expectedProductId: '648', changes: { rent1day: '88.00' } }),
        decision('submit-current', 'rental.submitCurrent', { expectedProductId: '648' }),
      ],
    }));

    const response = await agentExploreResponse('分析高级表单态操作', 'output', { provider });

    expect(response.card).toBeUndefined();
    expect(response.text).not.toContain('待确认执行');
  });
});
