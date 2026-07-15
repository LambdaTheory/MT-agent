import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadOperationLedgerJsonlEntries, loadOperationLedgerStore, operationLedgerJsonlPath } from '../src/agentRuntime/operationLedger.js';
import { executeRentalWriteOperationHandler } from '../src/feishuBot/rentalWriteOperationHandlers.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

function fakeClient(overrides: Partial<RentalPriceSkillClient> = {}): RentalPriceSkillClient {
  return {
    preview: async () => ({ productId: '648', fields: {}, lines: [], warnings: [] }),
    execute: async () => ({ productId: '648', ok: true, lines: ['done'] }),
    read: async () => ({ productId: '648', ok: true, specs: [], values: {}, lines: [] }),
    copy: async () => ({ productId: '648', ok: true, newProductId: '999', lines: ['copied'] }),
    delist: async () => ({ productId: '648', ok: true, lines: ['delisted'] }),
    tenancySet: async (_productId, days) => ({ productId: '648', ok: true, days, lines: [] }),
    specDiscover: async () => ({ productId: '648', ok: true, dimensions: [], lines: [] }),
    specAddAndRefresh: async (_productId, _specDimId, itemTitle) => ({ productId: '648', ok: true, itemTitle, lines: [] }),
    ...overrides,
  };
}

describe('rental write ledger', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mt-rw-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('records execution events with attribution when ledgerContext is provided', async () => {
    await executeRentalWriteOperationHandler(
      { toolName: 'rental.delist', arguments: { productId: '648' }, reason: 'test' },
      fakeClient(),
      { outputDir: dir, runId: 'run-1', decisionId: 'dec-1' },
    );

    const date = new Date().toISOString().slice(0, 10);
    const entries = await loadOperationLedgerJsonlEntries(dir, date);

    expect(entries.map((entry) => entry.event)).toEqual(['execution_started', 'execution_succeeded']);
    expect(entries.every((entry) => entry.runId === 'run-1' && entry.decisionId === 'dec-1')).toBe(true);
    expect(entries.every((entry) => entry.toolName === 'rental.delist')).toBe(true);
    expect(entries.every((entry) => entry.subject?.id === '648')).toBe(true);
    expect(entries.every((entry) => entry.metadata?.rentalAction === 'delist')).toBe(true);
    expect(entries.every((entry) => entry.metadata?.executionTimestampRecorded === true)).toBe(true);
  });

  it('records execution_failed when a rental write operation throws', async () => {
    await expect(executeRentalWriteOperationHandler(
      { toolName: 'rental.delist', arguments: { productId: '648' }, reason: 'test' },
      fakeClient({ delist: async () => { throw new Error('delist failed'); } }),
      { outputDir: dir, runId: 'run-1', decisionId: 'dec-1' },
    )).rejects.toThrow('delist failed');

    const date = new Date().toISOString().slice(0, 10);
    const entries = await loadOperationLedgerJsonlEntries(dir, date);

    expect(entries.map((entry) => entry.event)).toEqual(['execution_started', 'execution_failed']);
    expect(entries.every((entry) => entry.subject?.id === '648')).toBe(true);
  });

  it('preserves the rental error when recording execution_failed also fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(executeRentalWriteOperationHandler(
      { toolName: 'rental.delist', arguments: { productId: '648' }, reason: 'test' },
      fakeClient({
        delist: async () => {
          const date = new Date().toISOString().slice(0, 10);
          const path = operationLedgerJsonlPath(dir, date);
          await rm(path, { force: true });
          await mkdir(path, { recursive: true });
          throw new Error('delist failed');
        },
      }),
      { outputDir: dir, runId: 'run-1', decisionId: 'dec-1' },
    )).rejects.toThrow('delist failed');

    expect(warn).toHaveBeenCalledWith('Failed to record rental write failure event.', expect.any(Error));
    warn.mockRestore();
  });

  it('records execution time in at while retaining missionDate only as metadata', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T13:45:00.000Z'));
    try {
      await executeRentalWriteOperationHandler(
        { toolName: 'rental.delist', arguments: { productId: '648' }, reason: 'test' },
        fakeClient(),
        { outputDir: dir, missionDate: '2026-07-01' },
      );

      const entries = await loadOperationLedgerJsonlEntries(dir, '2026-07-15');
      expect(entries).toHaveLength(2);
      expect(entries.every((entry) => entry.at === '2026-07-15T13:45:00.000Z')).toBe(true);
      expect(entries.every((entry) => entry.metadata?.missionDate === '2026-07-01')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
  it.each([
    { toolName: 'rental.delist', arguments: { productId: '648' } },
    { toolName: 'rental.operationConfirmRequest', arguments: { action: 'delist', productId: '648' } },
  ])('keeps a successful delist successful when its success audit persistence fails ($toolName)', async ({ toolName, arguments: args }) => {
    const response = await executeRentalWriteOperationHandler(
      { toolName, arguments: args, reason: 'test' },
      fakeClient({
        delist: async () => {
          const date = new Date().toISOString().slice(0, 10);
          const path = operationLedgerJsonlPath(dir, date);
          await rm(path, { force: true });
          await mkdir(path, { recursive: true });
          return { productId: '648', ok: true, lines: ['delisted'] };
        },
      }),
      { outputDir: dir, runId: 'run-1', decisionId: 'dec-1' },
    );

    expect(response).toMatchObject({
      text: expect.stringContaining('下架成功：商品 648'),
      metadata: { toolName, ok: true, productId: '648', auditWarnings: [expect.stringContaining('商品 648')] },
    });
    expect(response.text).toContain('审计警告：');
    const ledger = await loadOperationLedgerStore(dir);
    expect(ledger.journal.map((entry) => entry.event)).toEqual(['execution_started']);
  });

});
