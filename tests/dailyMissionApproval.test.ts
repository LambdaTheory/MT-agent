import { describe, expect, it } from 'vitest';
import { buildDailyMissionApprovalCards, decisionToConfirmRequest, parseDailyMissionReason } from '../src/agentRuntime/dailyMissionApproval.js';
import type { DecisionRecord } from '../src/agentRuntime/decisionRecord.js';

const decision: DecisionRecord = {
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
};

describe('dailyMissionApproval', () => {
  it('encodes runId/decisionId into the confirm request reason and round-trips', () => {
    const request = decisionToConfirmRequest(decision);

    expect(request.toolName).toBe('rental.pricePreview');
    expect(request.arguments).toEqual({ productIds: ['648'], discount: 0.9 });
    expect(parseDailyMissionReason(request.reason)).toEqual({ runId: 'run-1', decisionId: 'dec-1' });
  });

  it('returns null for non-daily-mission reasons', () => {
    expect(parseDailyMissionReason('普通改价')).toBeNull();
  });

  it('builds one card per decision', () => {
    expect(buildDailyMissionApprovalCards([decision])).toHaveLength(1);
  });

  it('skips decisions without proposedTool', () => {
    expect(buildDailyMissionApprovalCards([{ ...decision, proposedTool: undefined }])).toHaveLength(0);
  });
});
