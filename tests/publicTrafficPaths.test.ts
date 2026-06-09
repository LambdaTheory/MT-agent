import { describe, expect, it } from 'vitest';
import { buildPublicTrafficPaths } from '../src/publicTraffic/paths.js';

describe('buildPublicTrafficPaths', () => {
  it('builds public traffic output paths for a date', () => {
    expect(buildPublicTrafficPaths('output', '2026-06-09')).toEqual({
      dir: 'output/public-traffic/2026-06-09',
      exposureOverview: 'output/public-traffic/2026-06-09/exposure-overview.json',
      exposureCumulativeProducts: 'output/public-traffic/2026-06-09/exposure-cumulative-products.json',
      exposureDailyDelta: 'output/public-traffic/2026-06-09/exposure-daily-delta.json',
      exposure7dSummary: 'output/public-traffic/2026-06-09/exposure-7d-summary.json',
      exposure30dSummary: 'output/public-traffic/2026-06-09/exposure-30d-summary.json',
      goodsListSnapshot: 'output/public-traffic/2026-06-09/goods-list-snapshot.json',
      newProductObservation: 'output/public-traffic/2026-06-09/new-product-observation.json',
      observationState: 'output/public-traffic/2026-06-09/observation-state.json',
      markdown: 'output/public-traffic/2026-06-09/public-traffic-report.md',
      workbook: 'output/public-traffic/2026-06-09/public-traffic-report.xlsx',
      reportContext: 'output/public-traffic/2026-06-09/report-context.json',
      log: 'output/public-traffic/2026-06-09/run.log',
    });
  });
});
