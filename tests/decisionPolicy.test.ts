import { describe, expect, it } from 'vitest';
import { classifyDecisions } from '../src/agentRuntime/decisionPolicy.js';
import { isValidDecisionRecord, type DecisionRecord } from '../src/agentRuntime/decisionRecord.js';

function record(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    decisionId: 'd-1',
    runId: 'run-1',
    title: '建议降价',
    subjects: [{ kind: 'product', id: '648' }],
    operationType: 'price_down',
    recommendation: 'approve_to_execute',
    risk: 'write',
    rationale: ['曝光下降'],
    evidenceRefs: ['exposure.rows.648'],
    uncertainties: [],
    proposedTool: { toolName: 'rental.pricePreview', arguments: { productIds: ['648'] } },
    ...overrides,
  };
}

describe('classifyDecisions', () => {
  it('routes a well-evidenced executable decision into approvals', () => {
    const { approvals, observations } = classifyDecisions([record()]);

    expect(approvals).toHaveLength(1);
    expect(observations).toHaveLength(0);
  });

  it('downgrades an executable decision with uncertainties to observation', () => {
    const { approvals, observations } = classifyDecisions([record({ uncertainties: ['不确定库存'] })]);

    expect(approvals).toHaveLength(0);
    expect(observations).toHaveLength(1);
    expect(observations[0]?.recommendation).toBe('observe');
    expect(observations[0]?.blockedReason).toBe('存在不确定项');
  });

  it('downgrades executable decisions without evidence or tool arguments', () => {
    const { approvals, observations } = classifyDecisions([
      record({ decisionId: 'no-evidence', evidenceRefs: [] }),
      record({ decisionId: 'no-tool', proposedTool: undefined }),
    ]);

    expect(approvals).toEqual([]);
    expect(observations.map((item) => item.blockedReason)).toEqual(['证据不足', '缺少可执行工具参数']);
  });

  it('keeps observe and skip recommendations as observations', () => {
    const { approvals, observations } = classifyDecisions([
      record({ decisionId: 'observe', recommendation: 'observe' }),
      record({ decisionId: 'skip', recommendation: 'skip' }),
    ]);

    expect(approvals).toEqual([]);
    expect(observations.map((item) => item.recommendation)).toEqual(['observe', 'skip']);
  });

  it('prefers missing tool as the blocked reason when multiple downgrade causes exist', () => {
    const { observations } = classifyDecisions([
      record({ proposedTool: undefined, uncertainties: ['不确定库存'], evidenceRefs: [] }),
    ]);

    expect(observations[0]?.blockedReason).toBe('缺少可执行工具参数');
  });
});

describe('isValidDecisionRecord', () => {
  it('rejects malformed proposedTool payloads', () => {
    expect(isValidDecisionRecord(record({ proposedTool: {} as DecisionRecord['proposedTool'] }))).toBe(false);
    expect(isValidDecisionRecord(record({ proposedTool: { toolName: '', arguments: {} } }))).toBe(false);
    expect(isValidDecisionRecord(record({ proposedTool: { toolName: '   ', arguments: {} } }))).toBe(false);
    expect(isValidDecisionRecord(record({ proposedTool: { toolName: 'rental.pricePreview', arguments: [] as unknown as Record<string, unknown> } }))).toBe(false);
  });

  it('rejects blank evidence references', () => {
    expect(isValidDecisionRecord(record({ evidenceRefs: [''] }))).toBe(false);
    expect(isValidDecisionRecord(record({ evidenceRefs: ['   '] }))).toBe(false);
  });

  it('rejects malformed optional string fields', () => {
    expect(isValidDecisionRecord(record({ subjects: [{ kind: 'product', id: '648', displayName: 1 as unknown as string }] }))).toBe(false);
    expect(isValidDecisionRecord(record({ blockedReason: 1 as unknown as string }))).toBe(false);
  });
});
