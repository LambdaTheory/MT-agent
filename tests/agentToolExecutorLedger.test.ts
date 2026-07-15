import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadOperationLedgerJsonlEntries } from '../src/agentRuntime/operationLedger.js';
import { executeAgentToolRequest } from '../src/feishuBot/agentToolExecutor.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

function fakeClient(): RentalPriceSkillClient {
  return {
    preview: async () => ({ productId: '648', fields: {}, lines: [], warnings: [] }),
    execute: async () => ({ productId: '648', ok: true, lines: ['done'] }),
    read: async () => ({ productId: '648', ok: true, specs: [], values: {}, lines: [] }),
    copy: async () => ({ productId: '648', ok: true, newProductId: '999', lines: ['copied'] }),
    delist: async () => ({ productId: '648', ok: true, lines: ['delisted'] }),
    tenancySet: async (_productId, days) => ({ productId: '648', ok: true, days, lines: [] }),
    specDiscover: async () => ({ productId: '648', ok: true, dimensions: [], lines: [] }),
    specAddAndRefresh: async (_productId, _specDimId, itemTitle) => ({ productId: '648', ok: true, itemTitle, lines: [] }),
  };
}

describe('executeAgentToolRequest ledgerContext', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mt-exec-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('records marked success evidence only for successful products in a batch delist', async () => {
    const client = {
      ...fakeClient(),
      delist: async (productId: string) => productId === '648'
        ? { productId, ok: true, lines: ['delisted'] }
        : productId === '649'
          ? { productId, ok: false, lines: ['Product not found'] }
          : { productId, ok: false, lines: ['failed'] },
    };
    await executeAgentToolRequest(
      { toolName: 'rental.delistBatch', arguments: { productIds: ['648', '649', '650', '651'] }, reason: 'batch' },
      dir,
      { rentalPriceClient: client, ledgerContext: { outputDir: dir, runId: 'run-batch', decisionId: 'dec-batch', missionDate: '2026-07-01' } },
    );
    const entries = await loadOperationLedgerJsonlEntries(dir, new Date().toISOString().slice(0, 10));
    expect(entries).toEqual([expect.objectContaining({
      at: expect.any(String), event: 'execution_succeeded', toolName: 'rental.delistBatch',
      runId: 'run-batch', decisionId: 'dec-batch', subject: { kind: 'product', id: '648' },
      metadata: { rentalAction: 'delist', executionTimestampRecorded: true, missionDate: '2026-07-01' },
    })]);
  });

  it('threads ledgerContext into rental write handler', async () => {
    await executeAgentToolRequest(
      { toolName: 'rental.delist', arguments: { productId: '648' }, reason: 'daily mission approval' },
      dir,
      { rentalPriceClient: fakeClient(), ledgerContext: { outputDir: dir, runId: 'run-1', decisionId: 'dec-1' } },
    );

    const date = new Date().toISOString().slice(0, 10);
    const entries = await loadOperationLedgerJsonlEntries(dir, date);
    expect(entries.some((entry) => entry.event === 'execution_succeeded' && entry.runId === 'run-1' && entry.decisionId === 'dec-1')).toBe(true);
  });
});
