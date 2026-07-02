import { describe, expect, it } from 'vitest';
import { classifyDecisions } from '../src/agentRuntime/decisionPolicy.js';
import type { DecisionRecord } from '../src/agentRuntime/decisionRecord.js';

function record(overrides: Partial<DecisionRecord>): DecisionRecord {
  return {
    decisionId: 'dec-1',
    runId: 'run-1',
    title: '648 降价 10%',
    subjects: [{ kind: 'product', id: '648' }],
    operationType: 'price_down',
    recommendation: 'approve_to_execute',
    risk: 'write',
    rationale: ['曝光下降'],
    evidenceRefs: ['exposure'],
    uncertainties: [],
    proposedTool: { toolName: 'rental.pricePreview', arguments: { productIds: ['648'], discount: 0.9 } },
    ...overrides,
  };
}

describe('classifyDecisions tool validation', () => {
  it('approves when proposedTool args satisfy the tool schema', () => {
    const { approvals } = classifyDecisions([record({})]);

    expect(approvals).toHaveLength(1);
  });

  it('downgrades when toolName is unknown', () => {
    const { approvals, observations } = classifyDecisions([
      record({ proposedTool: { toolName: 'rental.nope', arguments: {} } }),
    ]);

    expect(approvals).toHaveLength(0);
    expect(observations[0].blockedReason).toBe('工具参数非法');
  });

  it('downgrades when args violate the schema', () => {
    const { approvals, observations } = classifyDecisions([
      record({ proposedTool: { toolName: 'rental.pricePreview', arguments: { productIds: '648' } } }),
    ]);

    expect(approvals).toHaveLength(0);
    expect(observations[0].blockedReason).toBe('工具参数非法');
  });
});
