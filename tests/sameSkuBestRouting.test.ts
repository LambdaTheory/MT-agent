import { describe, expect, it } from 'vitest';
import { parseAgentDataIntent } from '../src/agentData/intent.js';
import { rankBestProductByRegistryQuery } from '../src/agentData/productRanking.js';
import { createLinkRegistry } from '../src/linkRegistry/store.js';
import type { LinkRegistryEntry } from '../src/linkRegistry/types.js';
import type { PublicTrafficDataReportContext, PublicTrafficPeriodMetrics, PublicTrafficProductDataRow } from '../src/publicTraffic/types.js';

const baseMetric: PublicTrafficPeriodMetrics = {
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
  hasExposureData: true,
  hasDashboardData: true,
};

function row(internalProductId: string, productName: string, metrics: Partial<Record<'1d' | '7d' | '30d', Partial<PublicTrafficPeriodMetrics>>>): PublicTrafficProductDataRow {
  return {
    productName,
    platformProductId: `p${internalProductId}`,
    displayProductId: `端内ID ${internalProductId}`,
    custodyDays: 40,
    periods: {
      '1d': { ...baseMetric, ...metrics['1d'] },
      '7d': { ...baseMetric, ...metrics['7d'] },
      '30d': { ...baseMetric, ...metrics['30d'] },
    },
  };
}

const registryEntries: LinkRegistryEntry[] = [
  { internalProductId: '681', platformProductId: 'p681', productName: '佳能 R50 高金额', shortName: 'R50', aliases: ['r50', 'EOS R50'], sameSkuGroupId: 'canon-eos-r50', status: 'active', source: ['link_registry_override'] },
  { internalProductId: '682', platformProductId: 'p682', productName: '佳能 R50 高发货', shortName: 'R50', aliases: ['r50'], sameSkuGroupId: 'canon-eos-r50', status: 'active', source: ['link_registry_override'] },
];

const context: PublicTrafficDataReportContext = {
  date: '2026-07-06',
  summary: { '1d': baseMetric, '7d': baseMetric, '30d': baseMetric },
  conclusions: [],
  rows: [
    row('681', '佳能 R50 高金额', { '7d': { shippedOrders: 1, amount: 100 }, '30d': { shippedOrders: 1, amount: 1200 } }),
    row('682', '佳能 R50 高发货', { '7d': { shippedOrders: 3, amount: 300 }, '30d': { shippedOrders: 3, amount: 300 } }),
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

describe('same-sku best product routing', () => {
  it('uses 30d amount when requested', () => {
    const result = rankBestProductByRegistryQuery(context, createLinkRegistry(registryEntries), 'r50', { periodDays: 30, metric: 'amount' });

    expect(result.status).toBe('ranked');
    expect(result.status === 'ranked' ? result.best.internalProductId : undefined).toBe('681');
  });

  it('keeps legacy ranking when no metric or period is provided', () => {
    const result = rankBestProductByRegistryQuery(context, createLinkRegistry(registryEntries), 'r50');

    expect(result.status).toBe('ranked');
    expect(result.status === 'ranked' ? result.best.internalProductId : undefined).toBe('682');
  });

  it('uses exposure values when exposure metric is requested', () => {
    const exposureContext: PublicTrafficDataReportContext = {
      ...context,
      rows: [
        row('681', '佳能 R50 高曝光', { '7d': { shippedOrders: 1, amount: 100 }, '30d': { shippedOrders: 1, amount: 300, exposure: 2000, publicVisits: 10 } }),
        row('682', '佳能 R50 高访问', { '7d': { shippedOrders: 3, amount: 300 }, '30d': { shippedOrders: 3, amount: 300, exposure: 500, publicVisits: 200 } }),
      ],
    };

    const result = rankBestProductByRegistryQuery(exposureContext, createLinkRegistry(registryEntries), 'r50', { periodDays: 30, metric: 'exposure' });

    expect(result.status).toBe('ranked');
    expect(result.status === 'ranked' ? result.best.internalProductId : undefined).toBe('681');
    expect(result.status === 'ranked' ? result.rationale : '').toContain('曝光');
  });

  it('routes recent best same-sku questions without product-specific special cases', () => {
    expect(parseAgentDataIntent('近20天数据最好r50是哪个id')).toEqual({
      type: 'best_product_by_same_sku',
      query: 'r50',
      periodDays: 30,
      metric: 'amount',
    });
    expect(parseAgentDataIntent('近20天数据最好pocket3是哪个id')).toEqual({
      type: 'best_product_by_same_sku',
      query: 'pocket3',
      periodDays: 30,
      metric: 'amount',
    });
    expect(parseAgentDataIntent('r50 近30天金额最好的链接是哪条')).toEqual({
      type: 'best_product_by_same_sku',
      query: 'r50',
      periodDays: 30,
      metric: 'amount',
    });
  });

});
