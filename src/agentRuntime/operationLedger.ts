import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { OperationPlan, OperationPlanJournalEntry } from './operationPlan.js';
import { operationLedgerJsonlPath } from './dailyMissionArtifacts.js';

export { operationLedgerJsonlPath } from './dailyMissionArtifacts.js';

export interface OperationLedgerStore {
  version: 1;
  updatedAt: string;
  plans: OperationPlan[];
  journal: OperationPlanJournalEntry[];
}

export interface DailyOperationJournalStore {
  version: 1;
  date: string;
  updatedAt: string;
  entries: OperationPlanJournalEntry[];
}

const ledgerLocks = new Map<string, Promise<void>>();

export function createEmptyOperationLedgerStore(now = new Date().toISOString()): OperationLedgerStore {
  return { version: 1, updatedAt: now, plans: [], journal: [] };
}

export function createEmptyDailyOperationJournalStore(
  date: string,
  now = new Date().toISOString(),
): DailyOperationJournalStore {
  return { version: 1, date, updatedAt: now, entries: [] };
}

export function operationLedgerPath(outputDir: string): string {
  return join(outputDir, 'state', 'operation-ledger.json');
}

export function dailyOperationJournalPath(outputDir: string, date: string): string {
  return join(outputDir, 'runtime', 'journal', `${date}.json`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseOperationLedgerStore(value: unknown): OperationLedgerStore | null {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.plans) || !Array.isArray(value.journal)) return null;
  return {
    version: 1,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
    plans: value.plans as OperationPlan[],
    journal: value.journal as OperationPlanJournalEntry[],
  };
}

function parseDailyOperationJournalStore(value: unknown, date: string): DailyOperationJournalStore | null {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.entries)) return null;
  return {
    version: 1,
    date: typeof value.date === 'string' ? value.date : date,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
    entries: value.entries as OperationPlanJournalEntry[],
  };
}

async function readJson(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function withLedgerLock<T>(outputDir: string, action: () => Promise<T>): Promise<T> {
  const key = operationLedgerPath(outputDir);
  const previous = ledgerLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const next = previous.then(() => current);
  ledgerLocks.set(key, next);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (ledgerLocks.get(key) === next) ledgerLocks.delete(key);
  }
}

export async function loadOperationLedgerStore(outputDir: string): Promise<OperationLedgerStore> {
  return parseOperationLedgerStore(await readJson(operationLedgerPath(outputDir))) ?? createEmptyOperationLedgerStore();
}

export async function loadDailyOperationJournalStore(
  outputDir: string,
  date: string,
): Promise<DailyOperationJournalStore> {
  return parseDailyOperationJournalStore(await readJson(dailyOperationJournalPath(outputDir, date)), date)
    ?? createEmptyDailyOperationJournalStore(date);
}

export async function recordOperationPlan(outputDir: string, plan: OperationPlan): Promise<OperationPlan> {
  return withLedgerLock(outputDir, async () => {
    const store = await loadOperationLedgerStore(outputDir);
    const plans = store.plans.filter((item) => item.id !== plan.id);
    plans.push(plan);
    await writeJson(operationLedgerPath(outputDir), { ...store, updatedAt: new Date().toISOString(), plans });
    return plan;
  });
}

export async function appendOperationPlanJournalEntry(
  outputDir: string,
  entry: OperationPlanJournalEntry,
): Promise<OperationPlanJournalEntry> {
  return withLedgerLock(outputDir, async () => {
    const date = entry.at.slice(0, 10);
    const ledger = await loadOperationLedgerStore(outputDir);
    const daily = await loadDailyOperationJournalStore(outputDir, date);
    const now = new Date().toISOString();
    await writeJson(operationLedgerPath(outputDir), { ...ledger, updatedAt: now, journal: [...ledger.journal, entry] });
    await writeJson(dailyOperationJournalPath(outputDir, date), { ...daily, date, updatedAt: now, entries: [...daily.entries, entry] });
    return entry;
  });
}

export async function appendOperationLedgerJsonlEntry(
  outputDir: string,
  entry: OperationPlanJournalEntry,
): Promise<OperationPlanJournalEntry> {
  return withLedgerLock(outputDir, async () => {
    const path = operationLedgerJsonlPath(outputDir, entry.at.slice(0, 10));
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(entry)}\n`, 'utf8');
    return entry;
  });
}

export async function recordOperationEvent(
  outputDir: string,
  entry: OperationPlanJournalEntry,
): Promise<OperationPlanJournalEntry> {
  await appendOperationLedgerJsonlEntry(outputDir, entry);
  await appendOperationPlanJournalEntry(outputDir, entry);
  return entry;
}

export async function loadOperationLedgerJsonlEntries(
  outputDir: string,
  date: string,
): Promise<OperationPlanJournalEntry[]> {
  try {
    const raw = await readFile(operationLedgerJsonlPath(outputDir, date), 'utf8');
    const entries: OperationPlanJournalEntry[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line) as OperationPlanJournalEntry);
      } catch {
        // Keep audit/recent-operations usable when a JSONL append is partially corrupted.
      }
    }
    return entries;
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return [];
    throw error;
  }
}
