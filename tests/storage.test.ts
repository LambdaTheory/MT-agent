import { describe, expect, it } from 'vitest';
import { buildOutputPaths } from '../src/storage/outputPaths.js';
import { createRunLog } from '../src/storage/runLog.js';

describe('storage helpers', () => {
  it('builds dated output paths', () => {
    expect(buildOutputPaths('output', '2026-06-08')).toEqual({
      dir: 'output/2026-06-08',
      workbook: 'output/2026-06-08/MT运营日报_2026-06-08.xlsx',
      markdown: 'output/2026-06-08/MT运营日报_2026-06-08.md',
      raw: {
        '1d': 'output/2026-06-08/raw-1d.json',
        '7d': 'output/2026-06-08/raw-7d.json',
        '30d': 'output/2026-06-08/raw-30d.json',
      },
      log: 'output/2026-06-08/run.log',
    });
  });

  it('serializes run log events and period stats', () => {
    const log = createRunLog('2026-06-08T00:00:00.000Z', 'https://example.com');
    log.addEvent('started');
    log.addPeriodStats({
      period: '1d',
      actualPageSizes: [10],
      pageCount: 2,
      rowCount: 20,
      dedupedRowCount: 20,
      displayedTotalCount: 20,
      pageSizeFallback: true,
      complete: true,
    });

    expect(log.toText()).toContain('started');
    expect(log.toText()).toContain('[1d] pages=2 rows=20 deduped=20 total=20 fallback=true complete=true');
  });
});
