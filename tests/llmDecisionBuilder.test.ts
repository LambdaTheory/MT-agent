import { describe, expect, it } from 'vitest';
import { LlmDecisionBuilder } from '../src/agentRuntime/decisionBuilder.js';
import type { CollectedContext } from '../src/agentRuntime/dailyMissionContext.js';
import { FakeLlmProvider } from '../src/llm/fakeProvider.js';

const context: CollectedContext = {
  runId: 'run-9',
  date: '2026-07-01',
  outputDir: '/tmp/out',
  collectedAt: '2026-07-01T00:00:00.000Z',
  missingSources: [],
};

describe('LlmDecisionBuilder', () => {
  it('injects planner-visible tools into the system prompt', async () => {
    const provider = new FakeLlmProvider(JSON.stringify({ decisions: [] }));

    await new LlmDecisionBuilder({ provider }).build(context);

    const system = provider.lastInput?.messages.find((message) => message.role === 'system')?.content ?? '';
    expect(system).toContain('rental.pricePreview');
    expect(system).not.toContain('rental.priceApply');
  });

  it('parses valid decisions and forces runId', async () => {
    const provider = new FakeLlmProvider(JSON.stringify({
      decisions: [
        {
          decisionId: 'd1',
          runId: 'WRONG',
          title: '降价',
          subjects: [{ kind: 'product', id: '648' }],
          operationType: 'price_down',
          recommendation: 'observe',
          risk: 'read',
          rationale: ['曝光下降'],
          evidenceRefs: ['exposure'],
          uncertainties: [],
        },
      ],
    }));

    const decisions = await new LlmDecisionBuilder({ provider }).build(context);

    expect(decisions).toHaveLength(1);
    expect(decisions[0].runId).toBe('run-9');
  });

  it('converts invalid decisions into blocked observations and never throws', async () => {
    const provider = new FakeLlmProvider(JSON.stringify({ decisions: [{ nonsense: true }] }));

    const decisions = await new LlmDecisionBuilder({ provider }).build(context);
    expect(decisions).toMatchObject([
      {
        runId: 'run-9',
        recommendation: 'observe',
        operationType: 'observe',
        risk: 'read',
        evidenceRefs: ['llm.validation'],
        blockedReason: 'LLM 决策未通过数据契约校验',
      },
    ]);
    expect(decisions[0]?.proposedTool).toBeUndefined();
  });
});
