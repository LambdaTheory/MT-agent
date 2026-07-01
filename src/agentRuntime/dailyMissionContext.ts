import type { HotspotEvent } from './hotspotEvents.js';
import type { OperationPlanJournalEntry } from './operationPlan.js';
import { loadOperationLedgerJsonlEntries } from './operationLedger.js';

export interface CollectedContext {
  runId: string;
  date: string;
  outputDir: string;
  exposure?: unknown;
  hotspots?: HotspotEvent[];
  recentOperations?: OperationPlanJournalEntry[];
  missingSources: string[];
}

export type CollectedContextPatch = Partial<Omit<CollectedContext, 'runId' | 'date' | 'outputDir' | 'missingSources'>>;

export interface ContextCollectionBase {
  runId: string;
  date: string;
  outputDir: string;
}

export interface ContextCollector {
  name: string;
  collect(base: ContextCollectionBase): Promise<CollectedContextPatch>;
}

export async function collectDailyMissionContext(
  collectors: ContextCollector[],
  base: ContextCollectionBase,
): Promise<CollectedContext> {
  const context: CollectedContext = { ...base, missingSources: [] };
  for (const collector of collectors) {
    try {
      Object.assign(context, await collector.collect(base));
    } catch {
      context.missingSources.push(collector.name);
    }
  }
  return context;
}

function shiftDate(date: string, deltaDays: number): string {
  const current = new Date(`${date}T00:00:00.000Z`);
  current.setUTCDate(current.getUTCDate() + deltaDays);
  return current.toISOString().slice(0, 10);
}

export async function collectRecentOperations(
  outputDir: string,
  date: string,
  lookbackDays: number,
): Promise<OperationPlanJournalEntry[]> {
  const dates = Array.from({ length: lookbackDays }, (_, index) => shiftDate(date, -index));
  const entries = await Promise.all(dates.map((item) => loadOperationLedgerJsonlEntries(outputDir, item)));
  return entries.flat().sort((a, b) => b.at.localeCompare(a.at));
}
