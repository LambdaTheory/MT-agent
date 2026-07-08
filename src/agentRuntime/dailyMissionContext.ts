import type { HotspotEvent } from './hotspotEvents.js';
import type { OperationPlanJournalEntry } from './operationPlan.js';
import { loadOperationLedgerJsonlEntries } from './operationLedger.js';
import { buildTrackRecord, type TrackRecord } from './trackRecord.js';

export interface CollectedContext {
  runId: string;
  date: string;
  outputDir: string;
  collectedAt: string;
  exposure?: unknown;
  sales?: unknown;
  hotspots?: HotspotEvent[];
  marketPrice?: unknown;
  recentOperations?: OperationPlanJournalEntry[];
  trackRecord?: TrackRecord[];
  missingSources: string[];
}

export type CollectedContextPatch = Partial<Omit<CollectedContext, 'runId' | 'date' | 'outputDir' | 'collectedAt' | 'missingSources'>>;

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
  const context: CollectedContext = { ...base, collectedAt: new Date().toISOString(), missingSources: [] };
  const results = await Promise.allSettled(collectors.map((collector) => collector.collect(base)));
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      Object.assign(context, result.value);
    } else {
      context.missingSources.push(collectors[index].name);
    }
  });
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

export function createTrackRecordCollector(outputDir: string): ContextCollector {
  return {
    name: 'trackRecord',
    collect: async () => ({ trackRecord: await buildTrackRecord(outputDir) }),
  };
}
