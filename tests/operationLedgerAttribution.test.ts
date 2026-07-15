import { mkdir, mkdtemp, readFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  loadDailyOperationJournalStore,
  loadOperationLedgerJsonlEntries,
  loadOperationLedgerStore,
  dailyOperationJournalPath,
  operationLedgerPath,
  recordOperationEvent,
} from '../src/agentRuntime/operationLedger.js';

describe('operation ledger attribution', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mt-ledger-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('records an event carrying subject, decisionId and runId', async () => {
    await recordOperationEvent(dir, {
      planId: 'plan-1',
      at: '2026-07-01T09:00:00.000Z',
      event: 'execution_succeeded',
      runId: 'run-1',
      decisionId: 'dec-1',
      toolName: 'rental.priceApply',
      subject: { kind: 'product', id: '648' },
    });

    const entries = await loadOperationLedgerJsonlEntries(dir, '2026-07-01');
    const daily = await loadDailyOperationJournalStore(dir, '2026-07-01');

    expect(entries).toHaveLength(1);
    expect(entries[0]?.subject).toEqual({ kind: 'product', id: '648' });
    expect(entries[0]?.decisionId).toBe('dec-1');
    expect(entries[0]?.runId).toBe('run-1');
    expect(entries[0]?.toolName).toBe('rental.priceApply');
    expect(daily.entries).toEqual(entries);
    expect(daily.entries[0]?.toolName).toBe('rental.priceApply');
  });

  it('keeps distinct product events sharing all other dedupe components and dedupes exact repeats', async () => {
    const entry = {
      planId: 'plan-1',
      at: '2026-07-01T09:00:00.000Z',
      event: 'execution_succeeded' as const,
      runId: 'run-1',
      decisionId: 'dec-1',
      toolName: 'rental.delistBatch',
      subject: { kind: 'product' as const, id: '648' },
    };
    const distinctProduct = { ...entry, subject: { kind: 'product' as const, id: '649' } };

    await recordOperationEvent(dir, entry);
    await recordOperationEvent(dir, distinctProduct);
    await recordOperationEvent(dir, entry);

    const [jsonl, daily, ledger] = await Promise.all([
      loadOperationLedgerJsonlEntries(dir, '2026-07-01'),
      loadDailyOperationJournalStore(dir, '2026-07-01'),
      loadOperationLedgerStore(dir),
    ]);
    expect(jsonl.map((item) => item.subject)).toEqual([
      { kind: 'product', id: '648' },
      { kind: 'product', id: '649' },
    ]);
    expect(daily.entries).toEqual(jsonl);
    expect(ledger.journal).toEqual(jsonl);
  });

  it('repairs canonical and daily journals on retry after canonical ledger write fails', async () => {
    const entry = {
      planId: 'plan-1',
      at: '2026-07-01T09:00:00.000Z',
      event: 'execution_succeeded',
      runId: 'run-1',
      decisionId: 'dec-1',
      toolName: 'rental.priceApply',
      subject: { kind: 'product' as const, id: '648' },
    };
    const ledgerPath = operationLedgerPath(dir);

    await mkdir(ledgerPath, { recursive: true });
    await expect(recordOperationEvent(dir, entry)).rejects.toThrow();

    const jsonlAfterFailure = await loadOperationLedgerJsonlEntries(dir, '2026-07-01');
    expect(jsonlAfterFailure).toEqual([entry]);
    await expect(readFile(ledgerPath, 'utf8')).rejects.toThrow();

    await rm(ledgerPath, { recursive: true, force: true });
    await recordOperationEvent(dir, entry);

    const [jsonlAfterRetry, dailyAfterRetry, ledgerAfterRetry] = await Promise.all([
      loadOperationLedgerJsonlEntries(dir, '2026-07-01'),
      loadDailyOperationJournalStore(dir, '2026-07-01'),
      loadOperationLedgerStore(dir),
    ]);
    expect(jsonlAfterRetry).toEqual([entry]);
    expect(dailyAfterRetry.entries).toEqual([entry]);
    expect(ledgerAfterRetry.journal).toEqual([entry]);
  });

  it('repairs a JSONL-only event when a later distinct event arrives after canonical recovery', async () => {
    const eventA = {
      planId: 'plan-1',
      at: '2026-07-01T09:00:00.000Z',
      event: 'execution_succeeded',
      runId: 'run-1',
      decisionId: 'dec-1',
      toolName: 'rental.delistBatch',
      subject: { kind: 'product' as const, id: '648' },
      metadata: { rentalAction: 'delist', executionTimestampRecorded: true },
    };
    const eventB = {
      planId: 'plan-2',
      at: '2026-07-01T09:01:00.000Z',
      event: 'execution_succeeded',
      runId: 'run-2',
      decisionId: 'dec-2',
      toolName: 'rental.priceApply',
      subject: { kind: 'product' as const, id: '649' },
    };
    const ledgerPath = operationLedgerPath(dir);

    await mkdir(ledgerPath, { recursive: true });
    await expect(recordOperationEvent(dir, eventA)).rejects.toThrow();
    await rm(ledgerPath, { recursive: true, force: true });

    await recordOperationEvent(dir, eventB);

    const [jsonl, daily, ledger] = await Promise.all([
      loadOperationLedgerJsonlEntries(dir, '2026-07-01'),
      loadDailyOperationJournalStore(dir, '2026-07-01'),
      loadOperationLedgerStore(dir),
    ]);
    expect(jsonl).toEqual([eventA, eventB]);
    expect(daily.entries).toEqual([eventA, eventB]);
    expect(ledger.journal).toEqual([eventA, eventB]);

  });
  it('repairs a missing daily event when a later distinct event arrives after daily recovery', async () => {
    const eventA = {
      planId: 'plan-1',
      at: '2026-07-01T09:00:00.000Z',
      event: 'execution_succeeded',
      runId: 'run-1',
      decisionId: 'dec-1',
      toolName: 'rental.delistBatch',
      subject: { kind: 'product' as const, id: '648' },
    };
    const eventB = {
      planId: 'plan-2',
      at: '2026-07-01T09:01:00.000Z',
      event: 'execution_succeeded',
      runId: 'run-2',
      decisionId: 'dec-2',
      toolName: 'rental.priceApply',
      subject: { kind: 'product' as const, id: '649' },
    };
    const dailyPath = dailyOperationJournalPath(dir, '2026-07-01');

    await mkdir(dailyPath, { recursive: true });
    await expect(recordOperationEvent(dir, eventA)).rejects.toThrow();
    await rm(dailyPath, { recursive: true, force: true });

    await recordOperationEvent(dir, eventB);

    const [jsonl, daily, ledger] = await Promise.all([
      loadOperationLedgerJsonlEntries(dir, '2026-07-01'),
      loadDailyOperationJournalStore(dir, '2026-07-01'),
      loadOperationLedgerStore(dir),
    ]);
    expect(jsonl).toEqual([eventA, eventB]);
    expect(daily.entries).toEqual([eventA, eventB]);
    expect(ledger.journal).toEqual([eventA, eventB]);
  });
  it('repairs only the daily journal on retry after daily journal write fails', async () => {
    const entry = {
      planId: 'plan-1',
      at: '2026-07-01T09:00:00.000Z',
      event: 'execution_succeeded',
      runId: 'run-1',
      decisionId: 'dec-1',
      toolName: 'rental.priceApply',
      subject: { kind: 'product' as const, id: '648' },
    };
    const dailyPath = dailyOperationJournalPath(dir, '2026-07-01');

    await mkdir(dailyPath, { recursive: true });
    await expect(recordOperationEvent(dir, entry)).rejects.toThrow();

    const [jsonlAfterFailure, ledgerAfterFailure] = await Promise.all([
      loadOperationLedgerJsonlEntries(dir, '2026-07-01'),
      loadOperationLedgerStore(dir),
    ]);
    expect(jsonlAfterFailure).toEqual([entry]);
    expect(ledgerAfterFailure.journal).toEqual([entry]);
    await expect(readFile(dailyPath, 'utf8')).rejects.toThrow();

    await rm(dailyPath, { recursive: true, force: true });
    await recordOperationEvent(dir, entry);

    const [jsonlAfterRetry, dailyAfterRetry, ledgerAfterRetry] = await Promise.all([
      loadOperationLedgerJsonlEntries(dir, '2026-07-01'),
      loadDailyOperationJournalStore(dir, '2026-07-01'),
      loadOperationLedgerStore(dir),
    ]);
    expect(jsonlAfterRetry).toEqual([entry]);
    expect(dailyAfterRetry.entries).toEqual([entry]);
    expect(ledgerAfterRetry.journal).toEqual([entry]);
  });

  it('recovers a business partition from its daily journal when its JSONL sink is missing', async () => {
    const entry = {
      planId: 'plan-1',
      at: '2026-07-03T09:00:00.000Z',
      partitionDate: '2026-07-02',
      event: 'execution_succeeded',
      runId: 'run-1',
      decisionId: 'dec-1',
      toolName: 'rental.priceApply',
      subject: { kind: 'product' as const, id: '648' },
    };

    await recordOperationEvent(dir, entry);
    await unlink(join(dir, 'operation-ledger', '2026-07-02.jsonl'));
    const followUp = { ...entry, at: '2026-07-03T09:01:00.000Z', event: 'execution_failed' };
    await recordOperationEvent(dir, followUp);

    const [jsonl, daily, ledger] = await Promise.all([
      loadOperationLedgerJsonlEntries(dir, '2026-07-02'),
      loadDailyOperationJournalStore(dir, '2026-07-02'),
      loadOperationLedgerStore(dir),
    ]);
    expect(jsonl).toEqual([entry, followUp]);
    expect(daily.entries).toEqual(jsonl);
    expect(ledger.journal).toEqual(jsonl);
  });

  it('dedupes identical operation events across jsonl and daily journal stores', async () => {
    const entry = {
      planId: 'plan-1',
      at: '2026-07-01T09:00:00.000Z',
      event: 'execution_succeeded',
      runId: 'run-1',
      decisionId: 'dec-1',
      toolName: 'rental.priceApply',
      subject: { kind: 'product' as const, id: '648' },
    };

    await Promise.all([recordOperationEvent(dir, entry), recordOperationEvent(dir, entry)]);

    const entries = await loadOperationLedgerJsonlEntries(dir, '2026-07-01');
    const daily = await loadDailyOperationJournalStore(dir, '2026-07-01');
    expect(entries).toHaveLength(1);
    expect(daily.entries).toHaveLength(1);
  });
});
