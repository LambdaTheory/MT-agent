import { describe, expect, it } from 'vitest';
import { rankBestProductByRegistryQuery } from '../src/agentData/productRanking.js';
import type { LinkRegistryEntry } from '../src/linkRegistry/types.js';
import type { PublicTrafficDataReportContext, PublicTrafficPeriodMetrics } from '../src/publicTraffic/types.js';

function metric(overrides: Partial<PublicTrafficPeriodMetrics> = {}): PublicTrafficPeriodMetrics {
  return {
    exposure: 100,
    publicVisits: 10,
    dashboardVisits: 8,
    createdOrders: 0,
    signedOrders: 0,
    reviewedOrders: 0,
    shippedOrders: 0,
    createdOrderAmount: 0,
    signedOrderAmount: 0,
    reviewedOrderAmount: 0,
    shippedOrderAmount: 0,
    amount: 0,
    exposureVisitRate: 0.1,
    visitCreatedOrderRate: 0,
    visitShipmentRate: 0,
    hasExposureData: true,
    hasDashboardData: true,
    ...overrides,
  };
}

const baseMetric = metric();

function context(): PublicTrafficDataReportContext {
  return {
    date: '2026-06-22',
    summary: { '1d': baseMetric, '7d': baseMetric, '30d': baseMetric },
    conclusions: [],
    dataQualityNotes: [],
    rows: [
      {
        productName: 'Insta360 Ace Pro 2 标准套装',
        platformProductId: 'p841',
        displayProductId: '端内ID 841',
        custodyDays: 3,
        periods: {
          '1d': metric({ shippedOrders: 0, amount: 0, publicVisits: 20 }),
          '7d': metric({ shippedOrders: 1, amount: 499, publicVisits: 300 }),
          '30d': baseMetric,
        },
      },
      {
        productName: 'Insta360 Ace Pro 2 续航套装',
        platformProductId: 'p842',
        displayProductId: '端内ID 842',
        custodyDays: 4,
        periods: {
          '1d': metric({ shippedOrders: 1, amount: 699, publicVisits: 60 }),
          '7d': metric({ shippedOrders: 3, amount: 1888, publicVisits: 220 }),
          '30d': baseMetric,
        },
      },
      {
        productName: 'Insta360 Ace Pro 3 预售',
        platformProductId: 'p851',
        displayProductId: '端内ID 851',
        custodyDays: 1,
        periods: {
          '1d': metric({ shippedOrders: 0, amount: 0, publicVisits: 90 }),
          '7d': metric({ shippedOrders: 0, amount: 0, publicVisits: 500 }),
          '30d': baseMetric,
        },
      },
    ],
    lowExposure: [],
    weakClick: [],
    weakConversion: [],
    highPotential: [],
    newProductObservation: [],
    lifecycleGovernance: [],
    recommendedActions: [],
    emptySectionNotes: { lowExposure: '', weakClick: '', weakConversion: '', highPotential: '', newProductObservation: '', lifecycleGovernance: '', recommendedActions: '' },
  };
}

const registry: LinkRegistryEntry[] = [
  { internalProductId: '841', platformProductId: 'p841', shortName: 'Insta360 Ace Pro 2', sameSkuGroupId: 'insta360-ace-pro-2', status: 'active', source: ['product_name_map'] },
  { internalProductId: '842', platformProductId: 'p842', shortName: 'Insta360 Ace Pro 2', sameSkuGroupId: 'insta360-ace-pro-2', status: 'active', source: ['product_name_map'] },
  { internalProductId: '843', platformProductId: 'p843', shortName: 'Insta360 Ace Pro 2', sameSkuGroupId: 'insta360-ace-pro-2', status: 'removed', source: ['product_name_map'] },
  { internalProductId: '851', platformProductId: 'p851', shortName: 'Insta360 Ace Pro 3', sameSkuGroupId: 'insta360-ace-pro-3', status: 'active', source: ['product_name_map'] },
];

describe('rankBestProductByRegistryQuery', () => {
  it('ranks active same-sku links by 7d shipped orders, amount, and visits', () => {
    const result = rankBestProductByRegistryQuery(context(), registry, 'Ace pro 2');

    expect(result.status).toBe('ranked');
    if (result.status !== 'ranked') return;
    expect(result.best.internalProductId).toBe('842');
    expect(result.best.productName).toBe('Insta360 Ace Pro 2 续航套装');
    expect(result.ranking.map((item) => item.internalProductId)).toEqual(['842', '841']);
    expect(result.excluded).toEqual([{ internalProductId: '843', reason: 'removed' }]);
    expect(result.rationale).toContain('7日发货');
  });

  it('uses an explicit internal id only to find its same-sku group, not as the forced winner', () => {
    const result = rankBestProductByRegistryQuery(context(), registry, '841');

    expect(result.status).toBe('ranked');
    if (result.status !== 'ranked') return;
    expect(result.matchedBy).toBe('internal_id');
    expect(result.best.internalProductId).toBe('842');
  });

  it('asks for clarification when a fuzzy query matches multiple same-sku groups', () => {
    const result = rankBestProductByRegistryQuery(context(), registry, 'Ace Pro');

    expect(result.status).toBe('ambiguous');
    if (result.status !== 'ambiguous') return;
    expect(result.candidates.map((candidate) => candidate.sameSkuGroupId)).toEqual(['insta360-ace-pro-2', 'insta360-ace-pro-3']);
  });

  it('does not guess when registry cannot resolve the product query', () => {
    expect(rankBestProductByRegistryQuery(context(), registry, 'Osmo Action 5')).toEqual({
      status: 'not_found',
      query: 'Osmo Action 5',
    });
  });
});
