import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveDailyMissionApproval } from '../src/agentRuntime/dailyMissionApprovalCallback.js';
import { createDailyMissionRun, loadDailyMissionRun, saveDailyMissionRun, transitionDailyMissionRun } from '../src/agentRuntime/dailyMissionRun.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

async function seed(dir: string): Promise<void> {
  let run = createDailyMissionRun({ runId: 'run-1', date: '2026-07-02', trigger: 'manual', startedAt: 'x' });
  run = transitionDailyMissionRun(run, 'planning', 'x');
  run = transitionDailyMissionRun(run, 'waiting_approval', 'x');
  await saveDailyMissionRun(dir, run);
  const missionDir = join(dir, 'daily-mission', '2026-07-02');
  await mkdir(missionDir, { recursive: true });
  await writeFile(join(missionDir, 'approval-request.json'), JSON.stringify({
    approvals: [{
      decisionId: 'dec-1',
      runId: 'run-1',
      title: '下架',
      subjects: [{ kind: 'product', id: '648' }],
      operationType: 'delist',
      recommendation: 'approve_to_execute',
      risk: 'high',
      rationale: [],
      evidenceRefs: ['x'],
      uncertainties: [],
      proposedTool: { toolName: 'rental.delist', arguments: { productId: '648' } },
    }],
    observations: [],
  }), 'utf8');
}

function client(): RentalPriceSkillClient {
  return {
    delist: async () => ({ ok: true, action: 'delist', productId: '648', lines: [] }),
    preview: async () => ({ productId: '648', fields: {}, lines: [], warnings: [] }),
    execute: async () => ({ productId: '648', ok: true, lines: [] }),
    specDiscover: async () => ({ productId: '648', ok: true, dimensions: [] }),
    copy: async () => ({ ok: true, action: 'copy', productId: '648', lines: [] }),
    tenancySet: async () => ({ ok: true, action: 'tenancy-set', productId: '648', lines: [] }),
    specAddAndRefresh: async () => ({ ok: true, action: 'spec-add-and-refresh', productId: '648', lines: [] }),
  } as unknown as RentalPriceSkillClient;
}

describe('run advance after execution', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mt-adv-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('advances run to completed when the only approved decision executes ok', async () => {
    await seed(dir);

    await resolveDailyMissionApproval(
      { toolName: 'rental.delist', arguments: { productId: '648' }, reason: '[[dailyMission:runId=run-1;decisionId=dec-1]] 下架' },
      dir,
      { rentalPriceClient: client() },
    );

    const run = await loadDailyMissionRun(dir, '2026-07-02');
    expect(run?.status).toBe('completed');
  });
});
