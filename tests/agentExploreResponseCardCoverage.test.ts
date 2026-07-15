import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agentExploreResponse } from '../src/feishuBot/agentExploreResponse.js';
import { loadAgentToolConfirmRequestFromValue } from '../src/feishuBot/agentToolConfirmStore.js';
import { FakeLlmProvider } from '../src/llm/fakeProvider.js';

async function readConfirmRequests(outputDir: string, card: unknown) {
  const body = (card as { body?: { elements?: Array<{ elements?: Array<{ name?: string; behaviors?: Array<{ value?: unknown }> }> }> } }).body;
  const values = (body?.elements ?? [])
    .flatMap((element) => element.elements ?? [])
    .filter((element) => element.name === 'agent_tool_confirm_submit')
    .map((element) => element.behaviors?.[0]?.value);
  const requests = await Promise.all(values.map((value) => loadAgentToolConfirmRequestFromValue(outputDir, value)));
  return requests.filter((request): request is NonNullable<typeof request> => request !== null);
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
  let outputDir: string;

  beforeEach(async () => {
    outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-explore-card-'));
  });

  afterEach(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  it('does not create Agent Explore confirmations for low-level rental price writes', async () => {
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

    const response = await agentExploreResponse('分析原子写操作', outputDir, { provider });
    const requests = await readConfirmRequests(outputDir, response.card);

    expect(response.text).toContain('待确认执行：2 项');
    expect(requests.map((request) => request.toolName)).toEqual([
      'rental.delistBatch',
      'rental.priceRollback',
    ]);
    expect(JSON.stringify(response.card)).not.toContain('rental.priceApply');
    expect(JSON.stringify(response.card)).not.toContain('rental.perSpecPriceApply');
    expect(JSON.stringify(response.card)).not.toContain('rental.specDimApply');
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

    const response = await agentExploreResponse('分析高级表单态操作', outputDir, { provider });

    expect(response.card).toBeUndefined();
    expect(response.text).not.toContain('待确认执行');
  });
});
