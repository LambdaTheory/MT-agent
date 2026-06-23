import { describe, expect, it } from 'vitest';
import type { RawTableData } from '../src/domain/types.js';
import { assessDashboardQuality, hasDashboardMissingNote } from '../src/publicTraffic/dashboardQuality.js';

function table(period: RawTableData['period'], overrides: Partial<RawTableData> = {}): RawTableData {
  return {
    period,
    headers: ['商品', '访问'],
    rows: [['A', '1']],
    collection: {
      period,
      actualPageSizes: [50],
      pageCount: 1,
      rowCount: 1,
      dedupedRowCount: 1,
      displayedTotalCount: 1,
      pageSizeFallback: false,
      complete: true,
    },
    ...overrides,
  };
}

describe('assessDashboardQuality', () => {
  it('marks all periods complete when raw tables are complete', () => {
    const quality = assessDashboardQuality([table('1d'), table('7d'), table('30d')], []);
    expect(quality.hasMissing).toBe(false);
    expect(quality.periods['1d']).toMatchObject({ complete: true, rowCount: 1 });
    expect(quality.periods['7d']).toMatchObject({ complete: true, rowCount: 1 });
    expect(quality.periods['30d']).toMatchObject({ complete: true, rowCount: 1 });
  });

  it('marks a period missing when collection is incomplete', () => {
    const incomplete = table('1d');
    const quality = assessDashboardQuality([{ ...incomplete, collection: { ...incomplete.collection, complete: false } }, table('7d'), table('30d')], []);
    expect(quality.hasMissing).toBe(true);
    expect(quality.periods['1d'].complete).toBe(false);
  });

  it('marks a period missing when rows or headers are empty', () => {
    const quality = assessDashboardQuality([table('1d', { rows: [] }), table('7d', { headers: [] }), table('30d')], []);
    expect(quality.hasMissing).toBe(true);
    expect(quality.periods['1d'].complete).toBe(false);
    expect(quality.periods['7d'].complete).toBe(false);
  });

  it('marks missing periods that are absent from raw tables', () => {
    const quality = assessDashboardQuality([table('1d')], []);
    expect(quality.hasMissing).toBe(true);
    expect(quality.periods['7d'].complete).toBe(false);
    expect(quality.periods['30d'].complete).toBe(false);
  });

  it('detects dashboard missing notes from report context notes', () => {
    expect(hasDashboardMissingNote(['今日访问数据支付宝暂未更新，本期访问量板块指标缺失。'])).toBe(true);
    expect(assessDashboardQuality([table('1d'), table('7d'), table('30d')], ['后链路数据缺失']).hasMissing).toBe(true);
  });
});
