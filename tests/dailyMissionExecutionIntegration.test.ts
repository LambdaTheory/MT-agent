import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveDailyMissionApproval } from '../src/agentRuntime/dailyMissionApprovalCallback.js';
import { createDailyMissionRun, saveDailyMissionRun } from '../src/agentRuntime/dailyMissionRun.js';
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

describe('daily mission execution closure', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mt-closure-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('approval callback executes and records the full attribution chain', async () => {
    await saveDailyMissionRun(dir, createDailyMissionRun({
      runId: 'run-1',
      date: '2026-07-02',
      trigger: 'manual',
      startedAt: '2026-07-02T00:00:00.000Z',
    }));
    const result = await resolveDailyMissionApproval(
      { toolName: 'rental.delist', arguments: { productId: '648' }, reason: '[[dailyMission:runId=run-1;decisionId=dec-1]] 下架 648' },
      dir,
      { rentalPriceClient: fakeClient() },
    );

    expect(result?.ok).toBe(true);
    const date = new Date().toISOString().slice(0, 10);
    const chain = (await loadOperationLedgerJsonlEntries(dir, date)).filter((entry) => entry.decisionId === 'dec-1');
    expect(chain.map((entry) => entry.event)).toEqual(['approval_accepted', 'execution_started', 'execution_succeeded']);
    expect(chain.every((entry) => entry.runId === 'run-1')).toBe(true);
    expect(chain.every((entry) => entry.subject?.id === '648')).toBe(true);
  });
});
