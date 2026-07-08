import { describe, expect, it } from 'vitest';
import { RuleBasedDecisionBuilder } from '../src/agentRuntime/decisionBuilder.js';
import type { CollectedContext } from '../src/agentRuntime/dailyMissionContext.js';

describe('RuleBasedDecisionBuilder', () => {
  it('produces one observe decision per hotspot', async () => {
    const context: CollectedContext = {
      runId: 'run-1',
      date: '2026-07-01',
      outputDir: '/tmp/out',
      collectedAt: '2026-07-01T00:00:00.000Z',
      missingSources: [],
      hotspots: [
        {
          eventId: 'e1',
          source: 'manual',
          title: '演唱会A',
          startsAt: '2026-07-03T00:00:00.000Z',
          affectedCategories: ['相机'],
          confidence: 'high',
        },
      ],
    };

    const decisions = await new RuleBasedDecisionBuilder().build(context);

    expect(decisions).toHaveLength(1);
    expect(decisions[0].recommendation).toBe('observe');
    expect(decisions[0].runId).toBe('run-1');
    expect(decisions[0].evidenceRefs).toEqual(['hotspots.e1']);
  });

  it('returns empty when there is no hotspot context', async () => {
    const context: CollectedContext = {
      runId: 'run-1',
      date: '2026-07-01',
      outputDir: '/tmp/out',
      collectedAt: '2026-07-01T00:00:00.000Z',
      missingSources: [],
    };

    expect(await new RuleBasedDecisionBuilder().build(context)).toEqual([]);
  });
});
