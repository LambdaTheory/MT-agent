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
