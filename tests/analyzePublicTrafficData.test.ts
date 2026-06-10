import { describe, expect, it } from 'vitest';
import { analyzePublicTrafficData } from '../src/publicTraffic/analyzePublicTrafficData.js';
import type { PublicTrafficProductDataRow } from '../src/publicTraffic/types.js';

function row(
  displayProductId: string,
  exposure: number,
  publicVisits: number,
  dashboardVisits: number,
  shippedOrders: number,
): PublicTrafficProductDataRow {
  const period = {
    exposure,
    publicVisits,
    dashboardVisits,
    createdOrders: shippedOrders,
    signedOrders: 0,
    reviewedOrders: 0,
    shippedOrders,
    amount: shippedOrders * 100,
    exposureVisitRate: exposure > 0 ? publicVisits / exposure : 0,
    visitCreatedOrderRate: dashboardVisits > 0 ? shippedOrders / dashboardVisits : 0,
    visitShipmentRate: dashboardVisits > 0 ? shippedOrders / dashboardVisits : 0,
    hasExposureData: true,
    hasDashboardData: true,
  };
  return {
    productName: displayProductId,
    platformProductId: displayProductId,
    displayProductId,
    custodyDays: null,
    periods: { '1d': period, '7d': period, '30d': period },
  };
}

describe('analyzePublicTrafficData', () => {
  it('builds one-day funnel summary', () => {
    const report = analyzePublicTrafficData({ date: '2026-06-10', rows: [row('端内ID 1', 1000, 50, 40, 4)] });
    expect(report.summary['1d']).toMatchObject({
      exposure: 1000,
      publicVisits: 50,
      dashboardVisits: 40,
      shippedOrders: 4,
      amount: 400,
    });
    expect(report.summary['1d'].exposureVisitRate).toBeCloseTo(0.05);
  });

  it('classifies problem and opportunity groups', () => {
    const report = analyzePublicTrafficData({
      date: '2026-06-10',
      rows: [
        row('端内ID low', 10, 0, 0, 0),
        row('端内ID click-weak', 2000, 5, 4, 0),
        row('端内ID conversion-weak', 1500, 120, 100, 0),
        row('端内ID potential', 1500, 180, 160, 8),
      ],
    });

    expect(report.lowExposure[0].identifier).toBe('端内ID low');
    expect(report.weakClick[0].identifier).toBe('端内ID click-weak');
    expect(report.weakConversion[0].identifier).toBe('端内ID conversion-weak');
    expect(report.highPotential[0].identifier).toBe('端内ID potential');
  });
});
