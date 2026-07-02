import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveDailyMissionApproval } from '../src/agentRuntime/dailyMissionApprovalCallback.js';
import { createDailyMissionRun, saveDailyMissionRun, transitionDailyMissionRun } from '../src/agentRuntime/dailyMissionRun.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

async function seedRun(dir: string, status: 'waiting_approval' | 'completed', approvalRunId = 'run-1'): Promise<void> {
  let run = createDailyMissionRun({ runId: 'run-1', date: '2026-07-02', trigger: 'manual', startedAt: '2026-07-02T00:00:00.000Z' });
  run = transitionDailyMissionRun(run, 'planning', '2026-07-02T00:00:01.000Z');
  run = transitionDailyMissionRun(run, 'waiting_approval', '2026-07-02T00:00:02.000Z');
  if (status === 'completed') {
    run = transitionDailyMissionRun(run, 'executing', '2026-07-02T00:00:03.000Z');
    run = transitionDailyMissionRun(run, 'completed', '2026-07-02T00:00:04.000Z');
  }
  await saveDailyMissionRun(dir, run);
  const missionDir = join(dir, 'daily-mission', '2026-07-02');
  await mkdir(missionDir, { recursive: true });
  await writeFile(join(missionDir, 'approval-request.json'), JSON.stringify({
    approvals: [{
      decisionId: 'dec-1',
      runId: approvalRunId,
      title: '下架 648',
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

function client(delist = vi.fn(async () => ({ ok: true, action: 'delist', productId: '648', lines: [] }))): { client: RentalPriceSkillClient; delist: typeof delist } {
  const c = {
    delist,
    preview: async () => ({ productId: '648', fields: {}, lines: [], warnings: [] }),
    execute: async () => ({ productId: '648', ok: true, lines: [] }),
    specDiscover: async () => ({ productId: '648', ok: true, dimensions: [] }),
    copy: async () => ({ ok: true, action: 'copy', productId: '648', lines: [] }),
    tenancySet: async () => ({ ok: true, action: 'tenancy-set', productId: '648', lines: [] }),
    specAddAndRefresh: async () => ({ ok: true, action: 'spec-add-and-refresh', productId: '648', lines: [] }),
  } as unknown as RentalPriceSkillClient;
  return { client: c, delist };
}

function request(over: Partial<{ toolName: string; args: Record<string, unknown>; decisionId: string }> = {}) {
  return {
    toolName: over.toolName ?? 'rental.delist',
    arguments: over.args ?? { productId: '648' },
    reason: `[[dailyMission:runId=run-1;decisionId=${over.decisionId ?? 'dec-1'}]] 下架 648`,
  };
}

describe('resolveDailyMissionApproval guards', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mt-guard-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('executes when run is waiting_approval and decision matches', async () => {
    await seedRun(dir, 'waiting_approval');
    const { client: c, delist } = client();

    const result = await resolveDailyMissionApproval(request(), dir, { rentalPriceClient: c });

    expect(result?.ok).toBe(true);
    expect(delist).toHaveBeenCalledTimes(1);
  });

  it('rejects when run is terminal', async () => {
    await seedRun(dir, 'completed');
    const { client: c, delist } = client();

    await expect(resolveDailyMissionApproval(request(), dir, { rentalPriceClient: c })).rejects.toThrow();
    expect(delist).not.toHaveBeenCalled();
  });

  it('rejects when decisionId is not in approval-request', async () => {
    await seedRun(dir, 'waiting_approval');
    const { client: c, delist } = client();

    await expect(resolveDailyMissionApproval(request({ decisionId: 'nope' }), dir, { rentalPriceClient: c })).rejects.toThrow();
    expect(delist).not.toHaveBeenCalled();
  });

  it('rejects when args mismatch persisted approval', async () => {
    await seedRun(dir, 'waiting_approval');
    const { client: c, delist } = client();

    await expect(resolveDailyMissionApproval(request({ args: { productId: '999' } }), dir, { rentalPriceClient: c })).rejects.toThrow();
    expect(delist).not.toHaveBeenCalled();
  });

  it('rejects when persisted decision belongs to another run', async () => {
    await seedRun(dir, 'waiting_approval', 'other-run');
    const { client: c, delist } = client();

    await expect(resolveDailyMissionApproval(request(), dir, { rentalPriceClient: c })).rejects.toThrow('does not belong');
    expect(delist).not.toHaveBeenCalled();
  });
});
