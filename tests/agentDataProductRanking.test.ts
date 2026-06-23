import { describe, expect, it } from 'vitest';
import { rankBestProductByRegistryQuery } from '../src/agentData/productRanking.js';
import { createLinkRegistry } from '../src/linkRegistry/store.js';
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

function row(
  internalProductId: string,
  platformProductId: string,
  productName: string,
  oneDay: Partial<PublicTrafficPeriodMetrics>,
  sevenDay: Partial<PublicTrafficPeriodMetrics>,
): PublicTrafficDataReportContext['rows'][number] {
  return {
    productName,
    platformProductId,
    displayProductId: `internal ${internalProductId}`,
    custodyDays: 3,
    periods: {
      '1d': metric(oneDay),
      '7d': metric(sevenDay),
      '30d': baseMetric,
    },
  };
}

function context(): PublicTrafficDataReportContext {
  return {
    date: '2026-06-22',
    summary: { '1d': baseMetric, '7d': baseMetric, '30d': baseMetric },
    conclusions: [],
    dataQualityNotes: [],
    rows: [
      row('841', 'p841', 'Insta360 Ace Pro 2 standard kit', { shippedOrders: 0, amount: 0, publicVisits: 20 }, { shippedOrders: 1, amount: 499, publicVisits: 300 }),
      row('842', 'p842', 'Insta360 Ace Pro 2 endurance kit', { shippedOrders: 1, amount: 699, publicVisits: 60 }, { shippedOrders: 3, amount: 1888, publicVisits: 220 }),
      row('851', 'p851', 'Insta360 Ace Pro 3 presale', { shippedOrders: 0, amount: 0, publicVisits: 90 }, { shippedOrders: 0, amount: 0, publicVisits: 500 }),
      row('388', 'p388', 'Fujifilm instax SQUARE SQ1 high conversion', { shippedOrders: 0, amount: 19888.33, publicVisits: 4002 }, { shippedOrders: 19, amount: 22315.83, publicVisits: 4227 }),
      row('490', 'p490', 'Fujifilm instax SQUARE SQ1 low conversion', { shippedOrders: 0, amount: 3005.73, publicVisits: 1263 }, { shippedOrders: 3, amount: 3054.73, publicVisits: 1284 }),
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
  { internalProductId: '841', platformProductId: 'p841', productName: 'Insta360 Ace Pro 2 standard kit', shortName: 'Insta360 Ace Pro 2', aliases: ['Ace pro 2', 'AcePro2'], sameSkuGroupId: 'insta360-ace-pro-2', status: 'active', source: ['product_name_map'] },
  { internalProductId: '842', platformProductId: 'p842', productName: 'Insta360 Ace Pro 2 endurance kit', shortName: 'Insta360 Ace Pro 2', aliases: ['Ace pro 2'], sameSkuGroupId: 'insta360-ace-pro-2', status: 'active', source: ['product_name_map'] },
  { internalProductId: '843', platformProductId: 'p843', productName: 'Insta360 Ace Pro 2 removed', shortName: 'Insta360 Ace Pro 2', aliases: ['Ace pro 2'], sameSkuGroupId: 'insta360-ace-pro-2', status: 'removed', source: ['product_name_map'] },
  { internalProductId: '851', platformProductId: 'p851', productName: 'Insta360 Ace Pro 3 presale', shortName: 'Insta360 Ace Pro 3', sameSkuGroupId: 'insta360-ace-pro-3', status: 'active', source: ['product_name_map'] },
  { internalProductId: '388', platformProductId: 'p388', productName: 'Fujifilm instax SQUARE SQ1 high conversion', aliases: ['Fujifilm instax SQUARE SQ1'], sameSkuGroupId: 'fujifilm-instax-square-sq1', status: 'active', source: ['goods_first_seen'] },
  { internalProductId: '490', platformProductId: 'p490', productName: 'Fujifilm instax SQUARE SQ1 low conversion', aliases: ['Fujifilm instax SQUARE SQ1'], sameSkuGroupId: 'fujifilm-instax-square-sq1', status: 'active', source: ['goods_first_seen'] },
];

function registryStore() {
  return createLinkRegistry(registry);
}

describe('rankBestProductByRegistryQuery', () => {
  it('ranks active same-sku links by 7d shipped orders, amount, and visits', () => {
    const result = rankBestProductByRegistryQuery(context(), registryStore(), 'Ace pro 2');

    expect(result.status).toBe('ranked');
    if (result.status !== 'ranked') return;
    expect(result.best.internalProductId).toBe('842');
    expect(result.best.productName).toBe('Insta360 Ace Pro 2 endurance kit');
    expect(result.ranking.map((item) => item.internalProductId)).toEqual(['842', '841']);
    expect(result.excluded).toEqual([{ internalProductId: '843', reason: 'removed' }]);
    expect(result.rationale.length).toBeGreaterThan(0);
  });

  it('resolves compact aliases through the link registry store', () => {
    const result = rankBestProductByRegistryQuery(context(), registryStore(), 'AcePro2');

    expect(result.status).toBe('ranked');
    if (result.status !== 'ranked') return;
    expect(result.matchedBy).toBe('alias');
    expect(result.sameSkuGroupId).toBe('insta360-ace-pro-2');
    expect(result.best.internalProductId).toBe('842');
  });

  it('resolves short model tokens from complete aliases', () => {
    const result = rankBestProductByRegistryQuery(context(), registryStore(), 'SQ1');

    expect(result.status).toBe('ranked');
    if (result.status !== 'ranked') return;
    expect(result.matchedBy).toBe('alias');
    expect(result.sameSkuGroupId).toBe('fujifilm-instax-square-sq1');
    expect(result.best.internalProductId).toBe('388');
  });

  it('uses an explicit internal id only to find its same-sku group, not as the forced winner', () => {
    const result = rankBestProductByRegistryQuery(context(), registryStore(), '841');

    expect(result.status).toBe('ranked');
    if (result.status !== 'ranked') return;
    expect(result.matchedBy).toBe('internal_id');
    expect(result.best.internalProductId).toBe('842');
  });

  it('asks for clarification when a fuzzy query matches multiple same-sku groups', () => {
    const result = rankBestProductByRegistryQuery(context(), registryStore(), 'Ace Pro');

    expect(result.status).toBe('ambiguous');
    if (result.status !== 'ambiguous') return;
    expect(result.candidates.map((candidate) => candidate.sameSkuGroupId)).toEqual(['insta360-ace-pro-2', 'insta360-ace-pro-3']);
  });

  it('does not guess when registry cannot resolve the product query', () => {
    expect(rankBestProductByRegistryQuery(context(), registryStore(), 'Osmo Action 5')).toEqual({
      status: 'not_found',
      query: 'Osmo Action 5',
    });
  });
});
