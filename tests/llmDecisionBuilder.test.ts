import { describe, expect, it } from 'vitest';
import { LlmDecisionBuilder } from '../src/agentRuntime/decisionBuilder.js';
import type { CollectedContext } from '../src/agentRuntime/dailyMissionContext.js';
import { FakeLlmProvider } from '../src/llm/fakeProvider.js';

const context: CollectedContext = {
  runId: 'run-9',
  date: '2026-07-01',
  outputDir: '/tmp/out',
  missingSources: [],
};

describe('LlmDecisionBuilder', () => {
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

  it('drops invalid decisions and never throws', async () => {
    const provider = new FakeLlmProvider(JSON.stringify({ decisions: [{ nonsense: true }] }));

    expect(await new LlmDecisionBuilder({ provider }).build(context)).toEqual([]);
  });
});
