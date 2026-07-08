import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadOperationLedgerJsonlEntries } from '../src/agentRuntime/operationLedger.js';
import { executeAgentToolRequest } from '../src/feishuBot/agentToolExecutor.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

function client(): RentalPriceSkillClient {
  return {
    preview: async () => ({ productId: '648', fields: { rent1day: '18.00' }, lines: [], warnings: [] }),
    execute: async () => ({ productId: '648', ok: true, lines: ['done'] }),
    specDiscover: async () => ({ productId: '648', ok: true, dimensions: [] }),
    copy: async () => ({ ok: true, action: 'copy', productId: '648', lines: [] }),
    delist: async () => ({ ok: true, action: 'delist', productId: '648', lines: [] }),
    tenancySet: async () => ({ ok: true, action: 'tenancy-set', productId: '648', lines: [] }),
    specAddAndRefresh: async () => ({ ok: true, action: 'spec-add-and-refresh', productId: '648', lines: [] }),
  } as unknown as RentalPriceSkillClient;
}

describe('ledgerContext coverage for priceApply', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mt-cov-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('records execution events with attribution for rental.priceApply', async () => {
    await executeAgentToolRequest(
      { toolName: 'rental.priceApply', arguments: { items: [{ productId: '648', fields: { rent1day: '18.00' } }] }, reason: 'x' },
      dir,
      { rentalPriceClient: client(), ledgerContext: { outputDir: dir, runId: 'run-1', decisionId: 'dec-1' } },
    );

    const date = new Date().toISOString().slice(0, 10);
    const entries = await loadOperationLedgerJsonlEntries(dir, date);
    expect(entries.some((entry) => entry.event === 'execution_succeeded' && entry.decisionId === 'dec-1')).toBe(true);
  });
});
