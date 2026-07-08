import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveDailyMissionApproval } from '../src/agentRuntime/dailyMissionApprovalCallback.js';
import { createDailyMissionRun, loadDailyMissionRun, saveDailyMissionRun, transitionDailyMissionRun } from '../src/agentRuntime/dailyMissionRun.js';
import { loadOperationLedgerJsonlEntries } from '../src/agentRuntime/operationLedger.js';
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

function client(delist: ReturnType<typeof vi.fn>): RentalPriceSkillClient {
  return {
    delist,
    preview: async () => ({ productId: '648', fields: {}, lines: [], warnings: [] }),
    execute: async () => ({ productId: '648', ok: true, lines: [] }),
    specDiscover: async () => ({ productId: '648', ok: true, dimensions: [] }),
    copy: async () => ({ ok: true, action: 'copy', productId: '648', lines: [] }),
    tenancySet: async () => ({ ok: true, action: 'tenancy-set', productId: '648', lines: [] }),
    specAddAndRefresh: async () => ({ ok: true, action: 'spec-add-and-refresh', productId: '648', lines: [] }),
  } as unknown as RentalPriceSkillClient;
}

describe('daily mission hardening integration', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mt-hard-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('executes once, records chain, completes run, and rejects terminal repeat', async () => {
    await seed(dir);
    const delist = vi.fn(async () => ({ ok: true, action: 'delist', productId: '648', lines: [] }));
    const request = { toolName: 'rental.delist', arguments: { productId: '648' }, reason: '[[dailyMission:runId=run-1;decisionId=dec-1]] 下架' };

    const result = await resolveDailyMissionApproval(request, dir, { rentalPriceClient: client(delist) });
    await expect(resolveDailyMissionApproval(request, dir, { rentalPriceClient: client(delist) })).rejects.toThrow(/terminal/);

    expect(result?.status).toBe('executed');
    expect(delist).toHaveBeenCalledTimes(1);
    await expect(loadDailyMissionRun(dir, '2026-07-02')).resolves.toMatchObject({ status: 'completed' });
    const date = new Date().toISOString().slice(0, 10);
    const chain = (await loadOperationLedgerJsonlEntries(dir, date)).filter((entry) => entry.decisionId === 'dec-1').map((entry) => entry.event);
    expect(chain).toContain('approval_accepted');
    expect(chain).toContain('execution_succeeded');
  });
});
