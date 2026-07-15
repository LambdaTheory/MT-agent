import { describe, expect, it } from 'vitest';
import {
  getPublicTrafficMetric,
  metricAvailabilityForFixedPeriod,
  publicTrafficMetricKeys,
} from '../src/agentData/publicTrafficMetricCatalog.js';
import type { PublicTrafficPeriodMetrics, PublicTrafficProductDataRow } from '../src/publicTraffic/types.js';

function period(overrides: Partial<PublicTrafficPeriodMetrics> = {}): PublicTrafficPeriodMetrics {
  return {
    exposure: 100,
    publicVisits: 10,
    dashboardVisits: 20,
    createdOrders: 2,
    signedOrders: 1,
    reviewedOrders: 1,
    shippedOrders: 1,
    createdOrderAmount: 200,
    signedOrderAmount: 150,
    reviewedOrderAmount: 120,
    shippedOrderAmount: 100,
    amount: 88,
    exposureVisitRate: 0.1,
    visitCreatedOrderRate: 0.1,
    visitShipmentRate: 0.05,
    hasExposureData: true,
    hasDashboardData: true,
    ...overrides,
  };
}

function row(overrides: Partial<PublicTrafficPeriodMetrics> = {}): PublicTrafficProductDataRow {
  return {
    productName: 'Pocket 3',
    platformProductId: 'p101',
    displayProductId: '端内ID 101',
    custodyDays: 15,
    periods: {
      '1d': period(overrides),
      '7d': period(overrides),
      '30d': period(overrides),
    },
  };
}

describe('public traffic metric catalog', () => {
  it('registers every PublicTrafficPeriodMetrics business field exactly once', () => {
    expect(publicTrafficMetricKeys).toEqual([
      'exposure', 'publicVisits', 'dashboardVisits', 'createdOrders',
      'signedOrders', 'reviewedOrders', 'shippedOrders',
      'createdOrderAmount', 'signedOrderAmount', 'reviewedOrderAmount',
      'shippedOrderAmount', 'amount', 'exposureVisitRate',
      'visitCreatedOrderRate', 'visitShipmentRate', 'custodyDays',
    ]);
  });

  it('keeps public visits independent from dashboard health', () => {
    expect(getPublicTrafficMetric('publicVisits')).toMatchObject({
      label: '公域访问量',
      source: 'exposure',
      windowAggregation: 'sum',
      executableDelistAllowed: true,
    });
    expect(getPublicTrafficMetric('createdOrders')).toMatchObject({
      source: 'dashboard',
      windowAggregation: 'sum',
    });
  });

  it('does not conflate public amount with stage-specific order amounts', () => {
    expect(getPublicTrafficMetric('amount')).toMatchObject({
      label: '公域交易金额', source: 'exposure',
    });
    expect(getPublicTrafficMetric('signedOrderAmount')).toMatchObject({
      label: '签约订单金额', source: 'dashboard',
    });
  });

  it('keeps exposure metrics available when dashboard data is missing', () => {
    expect(metricAvailabilityForFixedPeriod(row({ hasDashboardData: false }), '7d', 'publicVisits')).toMatchObject({
      available: true,
      source: 'exposure',
      requiredDays: 7,
      coveredDays: 7,
    });
  });

  it('marks missing dashboard and optional amount fields unavailable instead of zero', () => {
    const missingDashboard = metricAvailabilityForFixedPeriod(row({ hasDashboardData: false }), '7d', 'createdOrders');
    expect(missingDashboard).toMatchObject({ available: false, reason: 'missing_dashboard_data' });

    const missingOptional = metricAvailabilityForFixedPeriod(row({ signedOrderAmount: undefined }), '7d', 'signedOrderAmount');
    expect(missingOptional).toMatchObject({ available: false, reason: 'missing_optional_dashboard_column' });
  });

  it('marks derived rates unavailable when their denominator is zero', () => {
    expect(metricAvailabilityForFixedPeriod(row({ dashboardVisits: 0 }), '7d', 'visitShipmentRate')).toMatchObject({
      available: false,
      reason: 'zero_denominator',
    });
  });
});
