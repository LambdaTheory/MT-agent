import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  loadDailyOperationJournalStore,
  loadOperationLedgerJsonlEntries,
  loadOperationLedgerStore,
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
