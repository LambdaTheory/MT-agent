import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { saveHistoricalDashboardCapture } from '../src/publicTraffic/historicalDashboardCapture.js';

const table = (period: '1d' | '7d' | '30d') => ({
  period,
  headers: ['商品ID'],
  rows: [['1001']],
  collection: { period, actualPageSizes: [100], pageCount: 1, rowCount: 1, dedupedRowCount: 1, displayedTotalCount: 1, pageSizeFallback: false, complete: true },
});

describe('historical dashboard capture', () => {
  it('archives three period raws and a no-report manifest', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-historical-dashboard-'));
    const result = await saveHistoricalDashboardCapture({
      outputDir,
      dataDate: '2026-06-01',
      actualPageDate: '2026-06-01',
      rawTables: [table('1d'), table('7d'), table('30d')],
      refreshQuality: { hasMissing: false, notes: [], periods: { '1d': { complete: true, rowCount: 1 }, '7d': { complete: true, rowCount: 1 }, '30d': { complete: true, rowCount: 1 } } },
      capturedAt: '2026-07-14T00:00:00.000Z',
    });

    await expect(readFile(`${result.dir}/公域访问数据_1日.json`, 'utf8')).resolves.toContain('1001');
    await expect(readFile(`${result.dir}/公域访问数据_7日.json`, 'utf8')).resolves.toContain('1001');
    await expect(readFile(`${result.dir}/公域访问数据_30日.json`, 'utf8')).resolves.toContain('1001');
    await expect(readFile(result.manifestPath, 'utf8')).resolves.toContain('"reportContextFound": false');
    await expect(readFile(result.manifestPath, 'utf8')).resolves.toContain('"rebuild": "skipped"');
    await expect(readFile(result.manifestPath, 'utf8')).resolves.toContain('"resend": "skipped"');
  });

  it('rejects missing period raws before creating an archive directory', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-historical-dashboard-'));
    const archiveDir = join(outputDir, 'historical-dashboard-captures', '2026-06-01');

    await expect(saveHistoricalDashboardCapture({
      outputDir,
      dataDate: '2026-06-01',
      actualPageDate: '2026-06-01',
      rawTables: [table('1d'), table('7d')],
      refreshQuality: { hasMissing: true, notes: [], periods: { '1d': { complete: true, rowCount: 1 }, '7d': { complete: true, rowCount: 1 }, '30d': { complete: false, rowCount: 0 } } },
      capturedAt: '2026-07-14T00:00:00.000Z',
    })).rejects.toThrow('Historical dashboard archive is missing 30d raw table');
    await expect(stat(archiveDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
