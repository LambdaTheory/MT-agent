import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { OutcomeRecord, OutcomeStatus } from './outcomeAttribution.js';

export interface TrackRecord {
  key: string;
  operationType: string;
  category?: string;
  magnitudeBucket?: string;
  samples: number;
  positive: number;
  neutral: number;
  negative: number;
  successRate: number;
}

export interface BuildTrackRecordOptions {
  sinceDate?: string;
  days?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOutcomeRecord(value: unknown): value is OutcomeRecord {
  if (!isRecord(value)) return false;
  return typeof value.decisionId === 'string'
    && typeof value.runId === 'string'
    && typeof value.operationType === 'string'
    && isRecord(value.subject)
    && typeof value.executedAt === 'string'
    && typeof value.measuredAt === 'string'
    && isRecord(value.before)
    && (value.outcome === 'positive' || value.outcome === 'neutral' || value.outcome === 'negative' || value.outcome === 'pending');
}

function parseOutcomes(value: unknown): OutcomeRecord[] {
  return Array.isArray(value) ? value.filter(isOutcomeRecord) : [];
}

async function datedMissionDirs(outputDir: string): Promise<string[]> {
  const root = join(outputDir, 'daily-mission');
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function selectedDates(dates: string[], options: BuildTrackRecordOptions): string[] {
  const sinceFiltered = options.sinceDate ? dates.filter((date) => date >= options.sinceDate!) : dates;
  return options.days ? sinceFiltered.slice(-Math.max(1, options.days)) : sinceFiltered;
}

function countOutcome(record: TrackRecord, outcome: OutcomeStatus): void {
  if (outcome === 'positive') record.positive += 1;
  if (outcome === 'neutral') record.neutral += 1;
  if (outcome === 'negative') record.negative += 1;
}

function finalize(record: TrackRecord): TrackRecord {
  return { ...record, successRate: record.samples === 0 ? 0 : record.positive / record.samples };
}

export async function buildTrackRecord(outputDir: string, options: BuildTrackRecordOptions = {}): Promise<TrackRecord[]> {
  const groups = new Map<string, TrackRecord>();
  for (const date of selectedDates(await datedMissionDirs(outputDir), options)) {
    const path = join(outputDir, 'daily-mission', date, 'outcomes.json');
    const outcomes = parseOutcomes(JSON.parse(await readFile(path, 'utf8').catch(() => '[]')));
    for (const outcome of outcomes.filter((item) => item.outcome !== 'pending')) {
      const key = outcome.operationType;
      const current = groups.get(key) ?? { key, operationType: outcome.operationType, samples: 0, positive: 0, neutral: 0, negative: 0, successRate: 0 };
      current.samples += 1;
      countOutcome(current, outcome.outcome);
      groups.set(key, current);
    }
  }

  const records = [...groups.values()].map(finalize).sort((left, right) => left.key.localeCompare(right.key));
  const outputPath = join(outputDir, 'track-record.json');
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
  return records;
}
