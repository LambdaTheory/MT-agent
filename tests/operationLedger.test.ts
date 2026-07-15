import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { OperationPlan, OperationPlanJournalEntry } from '../src/agentRuntime/operationPlan.js';
import {
  appendOperationLedgerJsonlEntry,
  appendOperationPlanJournalEntry,
  dailyOperationJournalPath,
  loadOperationLedgerJsonlEntries,
  loadDailyOperationJournalStore,
  loadOperationLedgerStore,
  operationLedgerJsonlPath,
  operationLedgerPath,
  recordOperationEvent,
  recordOperationPlan,
} from '../src/agentRuntime/operationLedger.js';

async function tempOutputDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'mt-agent-operation-ledger-'));
}

function samplePlan(overrides: Partial<OperationPlan> = {}): OperationPlan {
  return {
    id: 'plan-1',
    goal: 'refresh rental links',
    createdAt: '2026-07-01T08:00:00.000Z',
    steps: [{
      id: 'step-1',
      toolName: 'rental.copy',
      arguments: { productId: '761' },
      risk: 'write',
      requiresConfirmation: true,
      status: 'pending',
    }],
    ...overrides,
  };
}

function sampleEntry(overrides: Partial<OperationPlanJournalEntry> = {}): OperationPlanJournalEntry {
  return {
    planId: 'plan-1',
    at: '2026-07-01T08:00:00.000Z',
    event: 'created',
    ...overrides,
  };
}

describe('operation ledger persistence', () => {
  it('returns empty stores when ledger and daily journal files are missing', async () => {
    const outputDir = await tempOutputDir();

    const ledger = await loadOperationLedgerStore(outputDir);
    const daily = await loadDailyOperationJournalStore(outputDir, '2026-07-01');

    expect(ledger).toEqual({
      version: 1,
      updatedAt: expect.any(String),
      plans: [],
      journal: [],
    });
    expect(daily).toEqual({
      version: 1,
      date: '2026-07-01',
      updatedAt: expect.any(String),
      entries: [],
    });
  });

  it('records an operation plan in the ledger JSON file', async () => {
    const outputDir = await tempOutputDir();
    const plan = samplePlan();

    await recordOperationPlan(outputDir, plan);

    const raw = await readFile(operationLedgerPath(outputDir), 'utf8');
    const stored = JSON.parse(raw) as unknown;
    expect(raw.endsWith('\n')).toBe(true);
    expect(stored).toMatchObject({ version: 1, plans: [plan], journal: [] });
  });

  it('replaces an existing plan with the same id', async () => {
    const outputDir = await tempOutputDir();

    await recordOperationPlan(outputDir, samplePlan());
    await recordOperationPlan(outputDir, samplePlan({ goal: 'updated goal' }));

    const ledger = await loadOperationLedgerStore(outputDir);
    expect(ledger.plans).toHaveLength(1);
    expect(ledger.plans[0]?.goal).toBe('updated goal');
  });

  it('appends journal entries to both the ledger and the daily journal', async () => {
    const outputDir = await tempOutputDir();
    const entry = sampleEntry();

    await appendOperationPlanJournalEntry(outputDir, entry);

    const ledger = await loadOperationLedgerStore(outputDir);
    const daily = await loadDailyOperationJournalStore(outputDir, '2026-07-01');
    expect(ledger.journal).toEqual([entry]);
    expect(daily.entries).toEqual([entry]);
  });

  it('preserves journal append order', async () => {
    const outputDir = await tempOutputDir();
    const created = sampleEntry({ event: 'created' });
    const ready = sampleEntry({ at: '2026-07-01T08:01:00.000Z', event: 'step_ready', stepId: 'step-1', status: 'ready' });

    await appendOperationPlanJournalEntry(outputDir, created);
    await appendOperationPlanJournalEntry(outputDir, ready);

    const ledger = await loadOperationLedgerStore(outputDir);
    const daily = await loadDailyOperationJournalStore(outputDir, '2026-07-01');
    expect(ledger.journal.map((entry) => entry.event)).toEqual(['created', 'step_ready']);
    expect(daily.entries.map((entry) => entry.event)).toEqual(['created', 'step_ready']);
  });

  it('falls back to empty stores when persisted JSON is corrupt', async () => {
    const outputDir = await tempOutputDir();

    await mkdir(join(outputDir, 'state'), { recursive: true });
    await mkdir(join(outputDir, 'runtime', 'journal'), { recursive: true });
    await writeFile(operationLedgerPath(outputDir), '{broken', 'utf8');
    await writeFile(dailyOperationJournalPath(outputDir, '2026-07-01'), '{broken', 'utf8');

    const ledger = await loadOperationLedgerStore(outputDir);
    const daily = await loadDailyOperationJournalStore(outputDir, '2026-07-01');
    expect(ledger.plans).toEqual([]);
    expect(ledger.journal).toEqual([]);
    expect(daily.entries).toEqual([]);
  });

  it('appends operation ledger JSONL entries under the roadmap contract path', async () => {
    const outputDir = await tempOutputDir();
    const entry = sampleEntry({ event: 'approved' });

    await appendOperationLedgerJsonlEntry(outputDir, entry);

    const raw = await readFile(operationLedgerJsonlPath(outputDir, '2026-07-01'), 'utf8');
    expect(raw).toBe(`${JSON.stringify(entry)}\n`);
  });

  it('loads operation ledger JSONL entries in append order', async () => {
    const outputDir = await tempOutputDir();
    const created = sampleEntry({ event: 'created' });
    const approved = sampleEntry({ at: '2026-07-01T08:01:00.000Z', event: 'approved' });

    await appendOperationLedgerJsonlEntry(outputDir, created);
    await appendOperationLedgerJsonlEntry(outputDir, approved);

    await expect(loadOperationLedgerJsonlEntries(outputDir, '2026-07-01')).resolves.toEqual([created, approved]);
  });

  it('writes an explicitly partitioned event under its business date while preserving the real execution timestamp', async () => {
    const outputDir = await tempOutputDir();
    const partitioned = sampleEntry({
      at: '2026-07-03T08:00:00.000Z',
      event: 'execution_succeeded',
      partitionDate: '2026-07-02',
    });
    const wallClock = sampleEntry({ at: '2026-07-03T08:01:00.000Z', event: 'created' });

    await recordOperationEvent(outputDir, partitioned);
    await recordOperationEvent(outputDir, wallClock);

    await expect(loadOperationLedgerJsonlEntries(outputDir, '2026-07-02')).resolves.toEqual([partitioned]);
    await expect(loadOperationLedgerJsonlEntries(outputDir, '2026-07-03')).resolves.toEqual([wallClock]);
    await expect(loadDailyOperationJournalStore(outputDir, '2026-07-02')).resolves.toMatchObject({ entries: [partitioned] });
    await expect(loadOperationLedgerStore(outputDir)).resolves.toMatchObject({ journal: [partitioned, wallClock] });
  });

  it('falls back to the execution date for an invalid partition date', async () => {
    const outputDir = await tempOutputDir();
    const entry = sampleEntry({ at: '2026-07-03T08:00:00.000Z', partitionDate: '2026-02-30' });

    await recordOperationEvent(outputDir, entry);

    await expect(loadOperationLedgerJsonlEntries(outputDir, '2026-07-03')).resolves.toEqual([entry]);
    await expect(loadOperationLedgerJsonlEntries(outputDir, '2026-02-30')).resolves.toEqual([]);
  });

  it('returns an empty JSONL entry list when the dated ledger file is missing', async () => {
    const outputDir = await tempOutputDir();

    await expect(loadOperationLedgerJsonlEntries(outputDir, '2026-07-01')).resolves.toEqual([]);
  });
});
