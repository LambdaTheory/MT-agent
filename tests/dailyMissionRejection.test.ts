import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordDailyMissionRejection } from '../src/agentRuntime/dailyMissionRejection.js';
import { loadOperationLedgerJsonlEntries } from '../src/agentRuntime/operationLedger.js';

describe('recordDailyMissionRejection', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mt-rej-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('records approval_rejected for a daily-mission tagged cancel', async () => {
    const handled = await recordDailyMissionRejection(
      { toolName: 'rental.delist', arguments: { productId: '648' }, reason: '[[dailyMission:runId=run-1;decisionId=dec-1]] 下架 648' },
      dir,
    );

    expect(handled).toBe(true);
    const date = new Date().toISOString().slice(0, 10);
    const entries = await loadOperationLedgerJsonlEntries(dir, date);
    expect(entries.some((entry) => entry.event === 'approval_rejected' && entry.decisionId === 'dec-1')).toBe(true);
  });

  it('returns false for non-daily-mission cancels', async () => {
    await expect(recordDailyMissionRejection({ toolName: 'rental.delist', arguments: {}, reason: '普通取消' }, dir)).resolves.toBe(false);
  });
});
