import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadOperationLedgerJsonlEntries } from '../src/agentRuntime/operationLedger.js';
import { rentalPerSpecPriceApplyResponse } from '../src/feishuBot/rentalPerSpecPriceHandlers.js';
import { rentalSpecDimApplyResponse } from '../src/feishuBot/rentalSpecDimHandlers.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

function client(): RentalPriceSkillClient {
  return {
    applyPerSpec: async () => ({ productId: '648', ok: true, lines: ['price done'] }),
    specAddDim: async () => ({ productId: '648', ok: true, itemTitle: '激光险', lines: ['dim done'] }),
  } as unknown as RentalPriceSkillClient;
}

describe('atomization write ledger', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mt-atled-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('records per-spec price execution events with attribution when ledgerContext has outputDir', async () => {
    await rentalPerSpecPriceApplyResponse(
      { productId: '648', specFields: { '3863': { rent1day: '80.00' } } },
      client(),
      { outputDir: dir, runId: 'run-1', decisionId: 'dec-1' },
    );

    const date = new Date().toISOString().slice(0, 10);
    const events = (await loadOperationLedgerJsonlEntries(dir, date))
      .filter((entry) => entry.decisionId === 'dec-1')
      .map((entry) => entry.event);
    expect(events).toContain('execution_started');
    expect(events).toContain('execution_succeeded');
  });

  it('records spec-dim execution events with attribution when ledgerContext has outputDir', async () => {
    await rentalSpecDimApplyResponse(
      { productId: '648', action: 'add', title: '激光险' },
      client(),
      { outputDir: dir, runId: 'run-2', decisionId: 'dec-2' },
    );

    const date = new Date().toISOString().slice(0, 10);
    const events = (await loadOperationLedgerJsonlEntries(dir, date))
      .filter((entry) => entry.decisionId === 'dec-2')
      .map((entry) => entry.event);
    expect(events).toContain('execution_started');
    expect(events).toContain('execution_succeeded');
  });
});
