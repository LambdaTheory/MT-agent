import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { loadRecentExposureDeltas } from '../src/publicTraffic/recentExposureDeltas.js';
import { buildPublicTrafficPaths } from '../src/publicTraffic/paths.js';

async function writeDelta(outputDir: string, date: string, id: string): Promise<void> {
  const paths = buildPublicTrafficPaths(outputDir, date);
  await mkdir(paths.dir, { recursive: true });
  await writeFile(
    paths.exposureDailyDelta,
    JSON.stringify([{ date, productName: '商品', platformProductId: id, exposure: 1, visits: 1, amount: 0, custodyDays: null, flags: [] }]),
    'utf8',
  );
}

describe('loadRecentExposureDeltas', () => {
  it('loads available dates and skips missing dates', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-deltas-'));
    try {
      await writeDelta(outputDir, '2026-06-09', 'today');
      await writeDelta(outputDir, '2026-06-07', 'two-days-ago');
      const rows = await loadRecentExposureDeltas(outputDir, '2026-06-09', 3);
      expect(rows.map((row) => row.platformProductId)).toEqual(['today', 'two-days-ago']);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it('rejects corrupt existing delta files', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-deltas-'));
    try {
      const paths = buildPublicTrafficPaths(outputDir, '2026-06-09');
      await mkdir(paths.dir, { recursive: true });
      await writeFile(paths.exposureDailyDelta, '[{"foo":1}]', 'utf8');
      await expect(loadRecentExposureDeltas(outputDir, '2026-06-09', 1)).rejects.toThrow(/Invalid exposure daily delta/);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});
