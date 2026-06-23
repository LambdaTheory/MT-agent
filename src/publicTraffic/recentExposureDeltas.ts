import { readFile } from 'node:fs/promises';
import { buildPublicTrafficPaths } from './paths.js';
import type { ExposureDailyDelta, ExposureDeltaFlag } from './types.js';

const VALID_FLAGS = new Set<ExposureDeltaFlag>(['new_product', 'missing', 'missing_previous_snapshot_row', 'counter_reset_or_data_error']);

function dateBefore(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function isExposureDailyDelta(value: unknown): value is ExposureDailyDelta {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.date === 'string' &&
    typeof row.productName === 'string' &&
    typeof row.platformProductId === 'string' &&
    typeof row.exposure === 'number' &&
    typeof row.visits === 'number' &&
    typeof row.amount === 'number' &&
    (typeof row.custodyDays === 'number' || row.custodyDays === null) &&
    Array.isArray(row.flags) &&
    row.flags.every((flag) => typeof flag === 'string' && VALID_FLAGS.has(flag as ExposureDeltaFlag))
  );
}

export function parseExposureDailyDeltaSnapshot(text: string): ExposureDailyDelta[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed) || !parsed.every(isExposureDailyDelta)) {
    throw new Error('Invalid exposure daily delta: expected ExposureDailyDelta[]');
  }
  return parsed;
}

export async function loadRecentExposureDeltas(outputDir: string, endDate: string, days: number): Promise<ExposureDailyDelta[]> {
  const rows: ExposureDailyDelta[] = [];

  for (let offset = 0; offset < days; offset += 1) {
    const date = dateBefore(endDate, offset);
    const paths = buildPublicTrafficPaths(outputDir, date);
    try {
      rows.push(...parseExposureDailyDeltaSnapshot(await readFile(paths.exposureDailyDelta, 'utf8')));
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        continue;
      }
      throw error;
    }
  }

  return rows;
}
