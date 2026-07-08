import { describe, expect, it } from 'vitest';
import { classifyDecisions } from '../src/agentRuntime/decisionPolicy.js';
import type { DecisionRecord } from '../src/agentRuntime/decisionRecord.js';

function record(toolName: string): DecisionRecord {
  return {
    decisionId: 'd',
    runId: 'r',
    title: 't',
    subjects: [{ kind: 'product', id: '648' }],
    operationType: 'price_down',
    recommendation: 'approve_to_execute',
    risk: 'high',
    rationale: ['x'],
    evidenceRefs: ['exposure'],
    uncertainties: [],
    proposedTool: { toolName, arguments: { items: [{ productId: '648', fields: { rent1day: '20.00' } }] } },
  };
}

describe('decision policy hidden tool rejection', () => {
  it('downgrades plannerVisible false tools like rental.priceApply', () => {
    const { approvals, observations } = classifyDecisions([record('rental.priceApply')]);

    expect(approvals).toHaveLength(0);
    expect(observations[0].blockedReason).toBe('工具不允许自动审批');
  });
});
