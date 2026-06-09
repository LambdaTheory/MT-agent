import { describe, expect, it } from 'vitest';
import { analyzePublicTraffic } from '../src/publicTraffic/analyzePublicTraffic.js';
import { DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG } from '../src/publicTraffic/rulesConfig.js';
import type { ExposureCumulativeProduct, ExposureDailyDelta, ExposureProductSummary } from '../src/publicTraffic/types.js';

function delta(overrides: Partial<ExposureDailyDelta>): ExposureDailyDelta {
  return {
    date: '2026-06-09',
    productName: '商品',
    platformProductId: '20260603220003308013234',
    exposure: 0,
    visits: 0,
    amount: 0,
    custodyDays: null,
    flags: [],
    ...overrides,
  };
}

function summary(overrides: Partial<ExposureProductSummary>): ExposureProductSummary {
  return {
    productName: '商品',
    platformProductId: '20260603220003308013234',
    exposure: 0,
    visits: 0,
    amount: 0,
    visitRate: 0,
    days: 7,
    flags: [],
    ...overrides,
  };
}

function cumulative(overrides: Partial<ExposureCumulativeProduct>): ExposureCumulativeProduct {
  return {
    productName: '商品',
    platformProductId: '20260603220003308013234',
    exposure: 0,
    visits: 0,
    amount: 0,
    custodyDays: null,
    raw: {},
    ...overrides,
  };
}

describe('analyzePublicTraffic', () => {
  it('creates exposure optimization candidates', () => {
    const result = analyzePublicTraffic({
      date: '2026-06-09',
      dailyDelta: [],
      sevenDaySummary: [summary({ platformProductId: 'high-low', productName: '高曝低访', exposure: 2000, visits: 10, visitRate: 0.005 })],
      thirtyDaySummary: [],
      cumulativeProducts: [],
      config: DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG,
    });

    expect(result.exposureOptimization[0]).toMatchObject({
      identifier: '平台商品ID high-low',
      action: '曝光优化',
    });
    expect(result.exposureOptimization[0]?.reason).toContain('访问率');
  });

  it('prioritizes high exposure candidates by lowest visit rate before low exposure potential candidates', () => {
    const result = analyzePublicTraffic({
      date: '2026-06-09',
      dailyDelta: [],
      sevenDaySummary: [
        summary({ platformProductId: 'low-exposure-high-amount', productName: '低曝高成交', exposure: 10, visits: 3, amount: 999, visitRate: 0.3 }),
        summary({ platformProductId: 'high-higher-rate', productName: '高曝较低访', exposure: 5000, visits: 45, visitRate: 0.009 }),
        summary({ platformProductId: 'high-lowest-rate', productName: '高曝最低访', exposure: 2000, visits: 2, visitRate: 0.001 }),
      ],
      thirtyDaySummary: [],
      cumulativeProducts: [],
      config: { ...DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG, topN: 2 },
    });

    expect(result.exposureOptimization.map((item) => item.identifier)).toEqual([
      '平台商品ID high-lowest-rate',
      '平台商品ID high-higher-rate',
    ]);
  });

  it('creates conversion optimization candidates', () => {
    const result = analyzePublicTraffic({
      date: '2026-06-09',
      dailyDelta: [],
      sevenDaySummary: [summary({ platformProductId: 'visit-no-amount', productName: '有访无成交', exposure: 300, visits: 20, amount: 0, visitRate: 0.066 })],
      thirtyDaySummary: [],
      cumulativeProducts: [],
      config: DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG,
    });

    expect(result.conversionOptimization[0]).toMatchObject({
      identifier: '平台商品ID visit-no-amount',
      action: '转化优化',
    });
    expect(result.conversionOptimization[0]?.reason).toContain('金额 0');
  });

  it('creates new product observation candidates', () => {
    const result = analyzePublicTraffic({
      date: '2026-06-09',
      dailyDelta: [delta({ platformProductId: 'new-low', productName: '新品低曝', exposure: 5, visits: 0, flags: ['new_product'] })],
      sevenDaySummary: [],
      thirtyDaySummary: [],
      cumulativeProducts: [],
      config: DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG,
    });

    expect(result.newProductObservation[0]).toMatchObject({
      identifier: '平台商品ID new-low',
      action: '新品观察',
    });
    expect(result.newProductObservation[0]?.reason).toContain('新品');
  });

  it('creates lifecycle governance candidates only when custody days are present', () => {
    const result = analyzePublicTraffic({
      date: '2026-06-09',
      dailyDelta: [],
      sevenDaySummary: [],
      thirtyDaySummary: [summary({ platformProductId: 'old-weak', productName: '老品弱表现', exposure: 20, visits: 1, amount: 0, days: 30 })],
      cumulativeProducts: [cumulative({ platformProductId: 'old-weak', productName: '老品弱表现', custodyDays: 45 }), cumulative({ platformProductId: 'unknown-days', custodyDays: null })],
      config: DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG,
    });

    expect(result.lifecycleGovernance).toHaveLength(1);
    expect(result.lifecycleGovernance[0]).toMatchObject({
      identifier: '平台商品ID old-weak',
      action: '生命周期治理',
    });
  });

  it('skips lifecycle governance when 30 day data is incomplete or flagged as reset/error', () => {
    const result = analyzePublicTraffic({
      date: '2026-06-09',
      dailyDelta: [],
      sevenDaySummary: [],
      thirtyDaySummary: [
        summary({ platformProductId: 'incomplete', exposure: 20, visits: 1, amount: 0, days: 3 }),
        summary({ platformProductId: 'reset', exposure: 20, visits: 1, amount: 0, days: 30, flags: ['counter_reset_or_data_error'] }),
      ],
      cumulativeProducts: [
        cumulative({ platformProductId: 'incomplete', custodyDays: 45 }),
        cumulative({ platformProductId: 'reset', custodyDays: 45 }),
      ],
      config: DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG,
    });

    expect(result.lifecycleGovernance).toEqual([]);
  });
});
