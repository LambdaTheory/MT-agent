import { describe, expect, it } from 'vitest';
import { resolveSafeSourceForSameSkuGroup } from '../src/agentData/safeSource.js';
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

const context: PublicTrafficDataReportContext = {
  date: '2026-07-06',
  summary: { '1d': baseMetric, '7d': baseMetric, '30d': baseMetric },
  conclusions: [],
  rows: [
    row('680', 'R50 健康源 A', { '7d': { shippedOrders: 1, amount: 100, publicVisits: 10 } }),
    row('681', 'R50 健康源 B', { '7d': { shippedOrders: 3, amount: 50, publicVisits: 8 } }),
    row('682', 'R50 待下架', { '7d': { shippedOrders: 5, amount: 500, publicVisits: 80 } }),
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

const registryEntries: LinkRegistryEntry[] = [
  { internalProductId: '680', platformProductId: 'p680', productName: 'R50 健康源 A', shortName: 'R50', sameSkuGroupId: 'canon-eos-r50', status: 'active', source: ['link_registry_override'] },
  { internalProductId: '681', platformProductId: 'p681', productName: 'R50 健康源 B', shortName: 'R50', sameSkuGroupId: 'canon-eos-r50', status: 'active', source: ['link_registry_override'] },
  { internalProductId: '682', platformProductId: 'p682', productName: 'R50 待下架', shortName: 'R50', sameSkuGroupId: 'canon-eos-r50', status: 'active', source: ['link_registry_override'] },
  { internalProductId: '900', platformProductId: 'p900', productName: 'Pocket Removed', shortName: 'Pocket 3', sameSkuGroupId: 'dji-pocket-3', status: 'removed', source: ['link_registry_override'] },
];

describe('resolveSafeSourceForSameSkuGroup', () => {
  it('selects the best active same-sku source outside the excluded delist set', () => {
    expect(resolveSafeSourceForSameSkuGroup(registryEntries, context, 'canon-eos-r50', new Set(['682']))).toMatchObject({
      sameSkuGroupId: 'canon-eos-r50',
      sourceProductId: '681',
      sourceProductName: 'R50 健康源 B',
      status: 'found',
    });
  });

  it('returns missing_group when the registry has no entries for the same-sku group', () => {
    expect(resolveSafeSourceForSameSkuGroup(registryEntries, context, 'missing-group', new Set())).toEqual({
      sameSkuGroupId: 'missing-group',
      status: 'missing_group',
      reason: '没有找到同款组。',
    });
  });

  it('blocks when every same-sku entry is removed, excluded, missing metrics, or zero-score', () => {
    expect(resolveSafeSourceForSameSkuGroup(registryEntries, context, 'dji-pocket-3', new Set())).toEqual({
      sameSkuGroupId: 'dji-pocket-3',
      status: 'blocked',
      reason: '同款组没有可用的安全源商品；不会从即将下架或缺少有效数据的链接复制新链。',
    });
  });
});
