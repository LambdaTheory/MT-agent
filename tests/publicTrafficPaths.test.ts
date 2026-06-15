import { describe, expect, it } from 'vitest';
import { buildPublicTrafficPaths } from '../src/publicTraffic/paths.js';

describe('buildPublicTrafficPaths', () => {
  it('builds public traffic output paths for a date', () => {
    expect(buildPublicTrafficPaths('output', '2026-06-09')).toEqual({
      dir: 'output/2026-06-09',
      exposureOverview: 'output/2026-06-09/公域曝光总览_2026-06-09.json',
      exposureCumulativeProducts: 'output/2026-06-09/公域曝光商品快照_2026-06-09.json',
      exposureDailyDelta: 'output/2026-06-09/公域曝光日差分_2026-06-09.json',
      exposure7dSummary: 'output/2026-06-09/公域曝光7日汇总_2026-06-09.json',
      exposure30dSummary: 'output/2026-06-09/公域曝光30日汇总_2026-06-09.json',
      publicVisitRaw: {
        '1d': 'output/2026-06-09/公域访问数据_1日.json',
        '7d': 'output/2026-06-09/公域访问数据_7日.json',
        '30d': 'output/2026-06-09/公域访问数据_30日.json',
      },
      goodsListSnapshot: 'output/2026-06-09/goods-list-snapshot.json',
      goodsFirstSeenState: 'output/state/goods-first-seen.json',
      goodsLinkLifecycleState: 'output/state/goods-link-lifecycle.json',
      goodsExportWorkbook: 'output/2026-06-09/商品总表_2026-06-09.xlsx',
      productIdMappingSyncLog: 'output/2026-06-09/商品ID映射同步日志_2026-06-09.log',
      newProductObservation: 'output/2026-06-09/new-product-observation.json',
      observationState: 'output/2026-06-09/observation-state.json',
      orderAnalysis: 'output/2026-06-09/订单分析_2026-06-09.json',
      markdown: 'output/2026-06-09/公域数据日报_2026-06-09.md',
      workbook: 'output/2026-06-09/公域数据日报_2026-06-09.xlsx',
      reportContext: 'output/2026-06-09/公域数据上下文_2026-06-09.json',
      publicTrafficRunState: 'output/2026-06-09/public-traffic-run-state.json',
      log: 'output/2026-06-09/公域数据运行日志_2026-06-09.log',
    });
  });
});
