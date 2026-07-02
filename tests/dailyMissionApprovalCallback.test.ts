import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveDailyMissionApproval } from '../src/agentRuntime/dailyMissionApprovalCallback.js';
import { createDailyMissionRun, saveDailyMissionRun, transitionDailyMissionRun } from '../src/agentRuntime/dailyMissionRun.js';
import { loadOperationLedgerJsonlEntries } from '../src/agentRuntime/operationLedger.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

function fakeClient(): RentalPriceSkillClient {
  return {
    preview: async () => ({ productId: '648', fields: {}, lines: [], warnings: [] }),
    execute: async () => ({ productId: '648', ok: true, lines: [] }),
    read: async () => ({ productId: '648', ok: true, specs: [], values: {}, lines: [] }),
    copy: async () => ({ productId: '648', ok: true, newProductId: '999', lines: [] }),
    delist: async () => ({ productId: '648', ok: true, lines: [] }),
    tenancySet: async (_productId, days) => ({ productId: '648', ok: true, days, lines: [] }),
    specDiscover: async () => ({ productId: '648', ok: true, dimensions: [], lines: [] }),
    specAddAndRefresh: async (_productId, itemTitle) => ({ productId: '648', ok: true, itemTitle, lines: [] }),
  };
}

async function seedWaitingApprovalRun(dir: string, approvals: Array<{ decisionId: string; productId: string }>): Promise<void> {
  let run = createDailyMissionRun({ runId: 'run-custom', date: '2026-07-02', trigger: 'manual', startedAt: '2026-07-02T00:00:00.000Z' });
  run = transitionDailyMissionRun(run, 'planning', '2026-07-02T00:00:01.000Z');
  run = transitionDailyMissionRun(run, 'waiting_approval', '2026-07-02T00:00:02.000Z');
  await saveDailyMissionRun(dir, run);
  const missionDir = join(dir, 'daily-mission', '2026-07-02');
  await mkdir(missionDir, { recursive: true });
  await writeFile(join(missionDir, 'approval-request.json'), JSON.stringify({
    approvals: approvals.map(({ decisionId, productId }) => ({
      decisionId,
      runId: 'run-custom',
      title: `下架 ${productId}`,
      subjects: [{ kind: 'product', id: productId }],
      operationType: 'delist',
      recommendation: 'approve_to_execute',
      risk: 'high',
      rationale: [],
      evidenceRefs: ['approval.callback'],
      uncertainties: [],
      proposedTool: { toolName: 'rental.delist', arguments: { productId } },
    })),
    observations: [],
  }), 'utf8');
}

describe('resolveDailyMissionApproval', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mt-cb-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('executes a daily-mission-tagged confirm request', async () => {
    await seedWaitingApprovalRun(dir, [{ decisionId: 'dec-1', productId: '648' }]);
    const result = await resolveDailyMissionApproval(
      { toolName: 'rental.delist', arguments: { productId: '648' }, reason: '[[dailyMission:runId=run-custom;decisionId=dec-1]] 下架 648' },
      dir,
      { rentalPriceClient: fakeClient() },
    );

    expect(result?.ok).toBe(true);
    const date = new Date().toISOString().slice(0, 10);
    const events = (await loadOperationLedgerJsonlEntries(dir, date)).map((entry) => entry.event);
    expect(events).toContain('approval_accepted');
    expect(events).toContain('execution_succeeded');
    const rawResults = await readFile(join(dir, 'daily-mission', '2026-07-02', 'execution-results.json'), 'utf8');
    expect(JSON.parse(rawResults)).toEqual([{ runId: 'run-custom', decisionId: 'dec-1', ok: true, status: 'executed', text: expect.any(String) }]);
  });

  it('preserves previous execution results when a second decision is approved', async () => {
    await seedWaitingApprovalRun(dir, [{ decisionId: 'dec-1', productId: '648' }, { decisionId: 'dec-2', productId: '649' }]);

    await resolveDailyMissionApproval(
      { toolName: 'rental.delist', arguments: { productId: '648' }, reason: '[[dailyMission:runId=run-custom;decisionId=dec-1]] 下架 648' },
      dir,
      { rentalPriceClient: fakeClient() },
    );
    await resolveDailyMissionApproval(
      { toolName: 'rental.delist', arguments: { productId: '649' }, reason: '[[dailyMission:runId=run-custom;decisionId=dec-2]] 下架 649' },
      dir,
      { rentalPriceClient: fakeClient() },
    );

    const rawResults = await readFile(join(dir, 'daily-mission', '2026-07-02', 'execution-results.json'), 'utf8');
    expect(JSON.parse(rawResults).map((result: { decisionId: string }) => result.decisionId)).toEqual(['dec-1', 'dec-2']);
  });

  it('returns null for non-daily-mission requests', async () => {
    const result = await resolveDailyMissionApproval(
      { toolName: 'rental.delist', arguments: { productId: '648' }, reason: '普通下架' },
      dir,
      { rentalPriceClient: fakeClient() },
    );

    expect(result).toBeNull();
  });

  it('does not execute when the referenced Daily Mission run is missing', async () => {
    const calls: string[] = [];
    const client: RentalPriceSkillClient = {
      ...fakeClient(),
      delist: async (productId) => {
        calls.push(productId);
        return { productId, ok: true, lines: [] };
      },
    };

    await expect(resolveDailyMissionApproval(
      { toolName: 'rental.delist', arguments: { productId: '648' }, reason: '[[dailyMission:runId=missing-run;decisionId=dec-1]] 下架 648' },
      dir,
      { rentalPriceClient: client },
    )).rejects.toThrow('Daily Mission run not found: missing-run');

    expect(calls).toEqual([]);
  });
});
