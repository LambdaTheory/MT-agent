import { describe, expect, it } from 'vitest';
import type { PeriodProductMetrics } from '../src/domain/types.js';
import { mergePublicTrafficData } from '../src/publicTraffic/mergePublicTrafficData.js';
import type { ExposureCumulativeProduct, ExposureProductSummary } from '../src/publicTraffic/types.js';

function dashboard(period: '1d' | '7d' | '30d', platformProductId: string, visits: number, shippedOrders: number): PeriodProductMetrics {
  return {
    period,
    productName: `商品${platformProductId}`,
    platformProductId,
    visits,
    createdOrders: Math.floor(visits / 10),
    signedOrders: Math.floor(visits / 20),
    reviewedOrders: Math.floor(visits / 30),
    shippedOrders,
  };
}

function exposure(platformProductId: string, exposureValue: number, visits: number, amount = 0): ExposureProductSummary {
  return {
    productName: `商品${platformProductId}`,
    platformProductId,
    exposure: exposureValue,
    visits,
    amount,
    visitRate: exposureValue > 0 ? visits / exposureValue : 0,
    days: 1,
    flags: [],
  };
}

const cumulative: ExposureCumulativeProduct[] = [
  { productName: '商品p1', platformProductId: 'p1', exposure: 100, visits: 10, amount: 20, custodyDays: 3, raw: {} },
];

describe('mergePublicTrafficData', () => {
  it('joins dashboard and exposure rows by platform product id', () => {
    const result = mergePublicTrafficData({
      dashboardRows: [dashboard('1d', 'p1', 8, 2)],
      exposureByPeriod: { '1d': [exposure('p1', 100, 10, 50)], '7d': [], '30d': [] },
      cumulativeProducts: cumulative,
      mapping: { p1: '558' },
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      platformProductId: 'p1',
      displayProductId: '端内ID 558',
      custodyDays: 3,
    });
    expect(result.rows[0].periods['1d']).toMatchObject({ exposure: 100, publicVisits: 10, dashboardVisits: 8, shippedOrders: 2, amount: 50 });
  });

  it('keeps rows that exist only in exposure data', () => {
    const result = mergePublicTrafficData({
      dashboardRows: [],
      exposureByPeriod: { '1d': [exposure('p2', 40, 0)], '7d': [], '30d': [] },
      cumulativeProducts: [],
      mapping: {},
    });

    expect(result.rows[0].displayProductId).toBe('平台商品ID p2');
    expect(result.rows[0].periods['1d']).toMatchObject({ exposure: 40, publicVisits: 0, dashboardVisits: 0 });
  });

  it('marks zero exposure rows with blocking flags as missing source data', () => {
    const result = mergePublicTrafficData({
      dashboardRows: [],
      exposureByPeriod: {
        '1d': [{ ...exposure('p2', 0, 0), flags: ['counter_reset_or_data_error'] }],
        '7d': [],
        '30d': [],
      },
      cumulativeProducts: [],
      mapping: {},
    });

    expect(result.rows[0].periods['1d']).toMatchObject({ exposure: 0, publicVisits: 0, hasExposureData: false });
  });

  it('keeps flagged aggregate exposure usable when positive evidence exists', () => {
    const result = mergePublicTrafficData({
      dashboardRows: [],
      exposureByPeriod: {
        '1d': [],
        '7d': [{ ...exposure('p2', 120, 3), flags: ['counter_reset_or_data_error'] }],
        '30d': [],
      },
      cumulativeProducts: [],
      mapping: {},
    });

    expect(result.rows[0].periods['7d']).toMatchObject({ exposure: 120, publicVisits: 3, hasExposureData: true });
  });

  it('keeps rows that exist only in dashboard data', () => {
    const result = mergePublicTrafficData({
      dashboardRows: [dashboard('7d', 'p3', 70, 4)],
      exposureByPeriod: { '1d': [], '7d': [], '30d': [] },
      cumulativeProducts: [],
      mapping: { p3: '900' },
    });

    expect(result.rows[0].displayProductId).toBe('端内ID 900');
    expect(result.rows[0].periods['7d']).toMatchObject({ exposure: 0, publicVisits: 0, dashboardVisits: 70, shippedOrders: 4 });
  });

  it('透传访问页金额字段', () => {
    const merged = mergePublicTrafficData({
      dashboardRows: [{
        period: '1d', productName: '测试', platformProductId: 'P1',
        visits: 10, createdOrders: 5, signedOrders: 4, reviewedOrders: 3, shippedOrders: 2,
        createdOrderAmount: 500, signedOrderAmount: 400, reviewedOrderAmount: 300, shippedOrderAmount: 200,
      }],
      exposureByPeriod: { '1d': [], '7d': [], '30d': [] },
      cumulativeProducts: [],
      mapping: {},
    });
    const metrics = merged.rows[0].periods['1d'];
    expect(metrics.createdOrderAmount).toBe(500);
    expect(metrics.signedOrderAmount).toBe(400);
    expect(metrics.reviewedOrderAmount).toBe(300);
    expect(metrics.shippedOrderAmount).toBe(200);
  });

  it('保留缺失访问页金额字段为 undefined', () => {
    const merged = mergePublicTrafficData({
      dashboardRows: [dashboard('1d', 'P2', 10, 0)],
      exposureByPeriod: { '1d': [], '7d': [], '30d': [] },
      cumulativeProducts: [],
      mapping: {},
    });
    expect(merged.rows[0].periods['1d'].createdOrders).toBe(1);
    expect(merged.rows[0].periods['1d'].createdOrderAmount).toBeUndefined();
  });

  it('空 period 不默认生成访问页金额字段', () => {
    const merged = mergePublicTrafficData({
      dashboardRows: [dashboard('1d', 'P3', 10, 0)],
      exposureByPeriod: { '1d': [], '7d': [], '30d': [] },
      cumulativeProducts: [],
      mapping: {},
    });

    expect(merged.rows[0].periods['7d'].hasDashboardData).toBe(false);
    expect(merged.rows[0].periods['7d'].createdOrderAmount).toBeUndefined();
  });
});
