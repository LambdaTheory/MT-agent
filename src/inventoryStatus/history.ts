import { readdir } from 'node:fs/promises';
import { buildPublicTrafficPaths } from '../publicTraffic/paths.js';
import { readInventorySameSkuSnapshot } from './store.js';
import type { InventoryStatusSnapshot } from './types.js';

const HISTORY_LOOKBACK_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

async function datedOutputDirs(outputDir: string): Promise<string[]> {
  const entries = await readdir(outputDir, { withFileTypes: true }).catch((error: unknown) => {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  });
  return entries
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

export async function readInventorySameSkuSnapshotHistory(outputDir: string, endDate: string): Promise<InventoryStatusSnapshot[]> {
  const endMs = Date.parse(`${endDate}T00:00:00.000Z`);
  const startMs = endMs - HISTORY_LOOKBACK_DAYS * DAY_MS;
  const dates = (await datedOutputDirs(outputDir)).filter((date) => date <= endDate && Date.parse(`${date}T00:00:00.000Z`) >= startMs);
  const snapshots: InventoryStatusSnapshot[] = [];
  for (const date of dates) {
    const snapshot = await readInventorySameSkuSnapshot(buildPublicTrafficPaths(outputDir, date).sameSkuSnapshot);
    if (snapshot) snapshots.push(snapshot);
  }
  return snapshots.sort((left, right) => left.date.localeCompare(right.date));
}
