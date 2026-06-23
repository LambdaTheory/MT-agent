import { describe, expect, it } from 'vitest';
import { analyzePublicTrafficData } from '../src/publicTraffic/analyzePublicTrafficData.js';
import type { PublicTrafficPeriodMetrics, PublicTrafficProductDataRow } from '../src/publicTraffic/types.js';

function metrics(overrides: Partial<PublicTrafficPeriodMetrics> = {}): PublicTrafficPeriodMetrics {
  return {
    exposure: 0,
    publicVisits: 0,
    dashboardVisits: 0,
    createdOrders: 0,
    signedOrders: 0,
    reviewedOrders: 0,
    shippedOrders: 0,
    amount: 0,
    exposureVisitRate: 0,
    visitCreatedOrderRate: 0,
    visitShipmentRate: 0,
    hasExposureData: false,
    hasDashboardData: false,
    ...overrides,
  };
}

function row(overrides: Partial<PublicTrafficProductDataRow>): PublicTrafficProductDataRow {
  return {
    productName: '商品',
    platformProductId: 'p-1',
    displayProductId: '端内ID 100',
    custodyDays: null,
    periods: {
      '1d': metrics(),
      '7d': metrics(),
      '30d': metrics(),
    },
    ...overrides,
  };
}

describe('public traffic data analysis rules', () => {
  it('treats only daily new_product deltas as new product observations', () => {
    const context = analyzePublicTrafficData({
      date: '2026-06-10',
      rows: [
        row({ platformProductId: 'p-701', displayProductId: '端内ID 701', periods: { '1d': metrics({ exposure: 500, publicVisits: 20, hasExposureData: true }), '7d': metrics({ exposure: 500, publicVisits: 20, hasExposureData: true }), '30d': metrics({ exposure: 500, publicVisits: 20, hasExposureData: true }) } }),
        row({ platformProductId: 'p-700', displayProductId: '端内ID 700', periods: { '1d': metrics({ exposure: 500, publicVisits: 20, hasExposureData: true }), '7d': metrics({ exposure: 500, publicVisits: 20, hasExposureData: true }), '30d': metrics({ exposure: 500, publicVisits: 20, hasExposureData: true }) } }),
      ],
      dailyDelta: [{ date: '2026-06-10', productName: '商品', platformProductId: 'p-700', exposure: 500, visits: 20, amount: 0, custodyDays: null, flags: ['new_product'] }],
    });

    expect(context.newProductObservation.map((item) => item.identifier)).toEqual(['端内ID 700']);
    expect(context.newProductObservation[0]?.action).toBe('新品数据监控');
    expect(context.newProductObservation[0]?.reason).toContain('1日曝光 500，公域访问 20，金额 0.00');
  });

  it('flags low-exposure warnings from custody and sparse one-day exposure data', () => {
    const context = analyzePublicTrafficData({
      date: '2026-06-10',
      rows: [
        row({
          platformProductId: 'p-low',
          displayProductId: '端内ID 558',
          custodyDays: 6,
          periods: {
            '1d': metrics({ exposure: 99, publicVisits: 4, hasExposureData: true }),
            '7d': metrics({ publicVisits: 4, hasDashboardData: true }),
            '30d': metrics({ publicVisits: 9, hasDashboardData: true }),
          },
        }),
      ],
      dailyDelta: [],
    });

    expect(context.lowExposure[0]).toMatchObject({
      identifier: '端内ID 558',
      action: '检查托管状态、标题、主图、类目和是否继续投放',
    });
    expect(context.lowExposure[0]?.reason).toContain('已托管 6 天');
  });
});
