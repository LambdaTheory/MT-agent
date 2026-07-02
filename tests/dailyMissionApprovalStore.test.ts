import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decisionMatchesRequest, findApprovedDecision, loadApprovalRequest } from '../src/agentRuntime/dailyMissionApprovalStore.js';
import type { DecisionRecord } from '../src/agentRuntime/decisionRecord.js';

const approved: DecisionRecord = {
  decisionId: 'dec-1',
  runId: 'run-1',
  title: '下架 648',
  subjects: [{ kind: 'product', id: '648' }],
  operationType: 'delist',
  recommendation: 'approve_to_execute',
  risk: 'high',
  rationale: [],
  evidenceRefs: ['exposure'],
  uncertainties: [],
  proposedTool: { toolName: 'rental.delist', arguments: { productId: '648' } },
};

describe('dailyMissionApprovalStore', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mt-appr-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('loads approval-request and finds the approved decision by id', async () => {
    const missionDir = join(dir, 'daily-mission', '2026-07-02');
    await mkdir(missionDir, { recursive: true });
    await writeFile(join(missionDir, 'approval-request.json'), JSON.stringify({ approvals: [approved], observations: [] }), 'utf8');

    const approval = await loadApprovalRequest(dir, '2026-07-02');

    expect(approval).not.toBeNull();
    expect(findApprovedDecision(approval!, 'dec-1')?.decisionId).toBe('dec-1');
    expect(findApprovedDecision(approval!, 'nope')).toBeNull();
  });

  it('returns null when file is missing', async () => {
    await expect(loadApprovalRequest(dir, '2026-07-02')).resolves.toBeNull();
  });

  it('matches request against approved decision tool and args regardless of key order', () => {
    const orderedDecision: DecisionRecord = {
      ...approved,
      proposedTool: { toolName: 'rental.copy', arguments: { sourceProductId: '123', targetProductId: '648' } },
    };

    expect(decisionMatchesRequest(orderedDecision, 'rental.copy', { targetProductId: '648', sourceProductId: '123' })).toBe(true);
    expect(decisionMatchesRequest(approved, 'rental.priceApply', { productId: '648' })).toBe(false);
    expect(decisionMatchesRequest(approved, 'rental.delist', { productId: '999' })).toBe(false);
  });
});
