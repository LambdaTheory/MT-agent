import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadDailyOperationJournalStore, loadOperationLedgerJsonlEntries, loadOperationLedgerStore } from '../src/agentRuntime/operationLedger.js';
import * as operationLedger from '../src/agentRuntime/operationLedger.js';
import { collectAgentDelistEvents } from '../src/linkRegistry/delistOperationEvidence.js';
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

  it('preserves two successful batch delists at an identical timestamp for attribution', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-14T09:00:00.000Z'));
    try {
      const response = await executeAgentToolRequest(
        { toolName: 'rental.delistBatch', arguments: { productIds: ['648', '649'] }, reason: 'batch' },
        dir,
        { rentalPriceClient: { ...fakeClient(), delist: async (productId: string) => ({ productId, ok: true, lines: ['delisted'] }) }, ledgerContext: { outputDir: dir, runId: 'run-batch', decisionId: 'dec-batch' } },
      );
      const [jsonl, daily, ledger] = await Promise.all([
        loadOperationLedgerJsonlEntries(dir, '2026-07-14'),
        loadDailyOperationJournalStore(dir, '2026-07-14'),
        loadOperationLedgerStore(dir),
      ]);
      expect(response.metadata).toMatchObject({ ok: true, delistedProductIds: ['648', '649'], pendingProductIds: [] });
      expect(daily.entries).toEqual(jsonl);
      expect(ledger.journal).toEqual(jsonl);
      expect(collectAgentDelistEvents(jsonl).map((event) => event.internalProductId)).toEqual(['648', '649']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retains client successes and continues after ledger audit failure', async () => {
    const calls: string[] = [];
    const malformedOutputDir = join(dir, 'ledger-is-a-file');
    await writeFile(malformedOutputDir, 'not a directory', 'utf8');
    const response = await executeAgentToolRequest(
      { toolName: 'rental.delistBatch', arguments: { productIds: ['648', '649'] }, reason: 'batch' },
      dir,
      {
        rentalPriceClient: { ...fakeClient(), delist: async (productId: string) => {
          calls.push(productId);
          return { productId, ok: true, lines: ['delisted'] };
        } },
        ledgerContext: { outputDir: malformedOutputDir },
      },
    );

    expect(calls).toEqual(['648', '649']);
    expect(response.metadata).toMatchObject({
      ok: true,
      delistedProductIds: ['648', '649'],
      failedProductIds: [],
      pendingProductIds: [],
      auditWarnings: [expect.stringContaining('商品 648'), expect.stringContaining('商品 649')],
    });
    expect(response.text).toContain('审计警告：');
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
  it('continues refresh activity delists when success audit persistence fails', async () => {
    const calls: string[] = [];
    const recordSpy = vi.spyOn(operationLedger, 'recordOperationEvent');
    recordSpy.mockResolvedValueOnce({} as never);
    recordSpy.mockRejectedValueOnce(new Error('ledger unavailable'));
    recordSpy.mockResolvedValue({} as never);

    const response = await executeAgentToolRequest(
      {
        toolName: 'operations.refreshActivityExecute',
        arguments: { date: '2026-07-14', strategy: 'delist_only', delistProductIds: ['648', '649'] },
        reason: 'refresh',
      },
      dir,
      {
        rentalPriceClient: {
          ...fakeClient(),
          delist: async (productId: string) => {
            calls.push(productId);
            return { productId, ok: true, lines: ['delisted'] };
          },
        },
        ledgerContext: { outputDir: dir, runId: 'run-refresh', decisionId: 'dec-refresh' },
      },
    );

    expect(calls).toEqual(['648', '649']);
    expect(response).toMatchObject({
      text: expect.stringContaining('审计警告：'),
      metadata: { ok: true, delistedProductIds: ['648', '649'], auditWarnings: expect.arrayContaining([expect.stringContaining('商品 648')]) },
    });
    expect(recordSpy.mock.calls.filter(([, entry]) => entry.event === 'execution_failed')).toHaveLength(0);
    expect(recordSpy.mock.calls.filter(([, entry]) => entry.event === 'execution_succeeded')).toHaveLength(2);
    expect(recordSpy.mock.calls.filter(([, entry]) => entry.event === 'execution_succeeded' && entry.subject?.id === '648')).toHaveLength(1);
    recordSpy.mockRestore();
  });

  it('records refresh activity delists as attributable delist success evidence', async () => {
    const response = await executeAgentToolRequest(
      {
        toolName: 'operations.refreshActivityExecute',
        arguments: { date: '2026-07-14', strategy: 'delist_only', delistProductIds: ['648'] },
        reason: 'refresh',
      },
      dir,
      { rentalPriceClient: fakeClient(), ledgerContext: { outputDir: dir, runId: 'run-refresh', decisionId: 'dec-refresh' } },
    );

    const date = new Date().toISOString().slice(0, 10);
    const entries = await loadOperationLedgerJsonlEntries(dir, date);
    expect(response.metadata).toMatchObject({ ok: true, delistedProductIds: ['648'] });
    expect(collectAgentDelistEvents(entries)).toEqual([expect.objectContaining({
      internalProductId: '648', toolName: 'operations.refreshActivityExecute', runId: 'run-refresh', decisionId: 'dec-refresh',
    })]);
  });
});
