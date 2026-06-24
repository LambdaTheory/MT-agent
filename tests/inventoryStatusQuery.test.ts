import { describe, expect, it } from 'vitest';
import { queryInventoryStatus } from '../src/inventoryStatus/query.js';
import type { InventoryStatusSnapshot } from '../src/inventoryStatus/types.js';
import { createLinkRegistry } from '../src/linkRegistry/store.js';
import type { LinkRegistryEntry } from '../src/linkRegistry/types.js';

const snapshot: InventoryStatusSnapshot = {
  date: '2026-06-24',
  sourceReportDate: '2026-06-23',
  generatedAt: '2026-06-24T00:00:00.000Z',
  summary: {
    sameSkuGroupCount: 2,
    activeLinkCount: 3,
    totalLinkCount: 4,
  },
  coverage: {
    groupedLinkCount: 4,
    ungroupedLinkCount: 0,
    groupsWithMetrics: 2,
    groupsWithoutMetrics: 0,
  },
  registryAuditSummary: {
    totalLinks: 4,
    activeLinks: 3,
    removedLinks: 1,
    unknownLinks: 0,
    overrideRiskCount: 0,
  },
  groups: [
    {
      sameSkuGroupId: 'insta360-ace-pro-2',
      groupName: 'Ace Pro 2',
      categoryName: '运动相机',
      productType: 'action-camera',
      activeLinkCount: 2,
      totalLinkCount: 3,
      mappedRowCount: 2,
      missingMetricLinkCount: 1,
      periods: {
        '1d': {
          exposure: 1000,
          publicVisits: 100,
          amount: 699,
          createdOrders: 4,
          signedOrders: 4,
          reviewedOrders: 4,
          shippedOrders: 3,
          createdOrderAmount: 888,
          signedOrderAmount: 799,
          reviewedOrderAmount: 699,
          shippedOrderAmount: 699,
          exposureVisitRate: 0.1,
          visitCreatedOrderRate: 0.04,
          visitShipmentRate: 0.03,
        },
        '7d': {
          exposure: 7000,
          publicVisits: 600,
          amount: 2888,
          createdOrders: 9,
          signedOrders: 8,
          reviewedOrders: 8,
          shippedOrders: 7,
          createdOrderAmount: 3200,
          signedOrderAmount: 3000,
          reviewedOrderAmount: 2888,
          shippedOrderAmount: 2888,
          exposureVisitRate: 600 / 7000,
          visitCreatedOrderRate: 9 / 600,
          visitShipmentRate: 7 / 600,
        },
        '30d': {
          exposure: 30000,
          publicVisits: 2400,
          amount: 9888,
          createdOrders: 30,
          signedOrders: 24,
          reviewedOrders: 22,
          shippedOrders: 20,
          createdOrderAmount: 11800,
          signedOrderAmount: 10300,
          reviewedOrderAmount: 9888,
          shippedOrderAmount: 9666,
          exposureVisitRate: 0.08,
          visitCreatedOrderRate: 30 / 2400,
          visitShipmentRate: 20 / 2400,
        },
      },
      topLinks: [
        {
          internalProductId: '842',
          platformProductId: 'p842',
          productName: 'Insta360 Ace Pro 2 续航套装',
          shortName: 'Ace Pro 2',
          status: 'active',
          oneDayExposure: 600,
          oneDayPublicVisits: 60,
          oneDayAmount: 499,
        },
      ],
      risks: ['组内 1 条链接无日报数据'],
    },
    {
      sameSkuGroupId: 'insta360-ace-pro',
      groupName: 'Ace Pro',
      categoryName: '运动相机',
      productType: 'action-camera',
      activeLinkCount: 1,
      totalLinkCount: 1,
      mappedRowCount: 1,
      missingMetricLinkCount: 0,
      periods: {
        '1d': {
          exposure: 200,
          publicVisits: 18,
          amount: 199,
          createdOrders: 1,
          signedOrders: 1,
          reviewedOrders: 1,
          shippedOrders: 1,
          createdOrderAmount: 199,
          signedOrderAmount: 199,
          reviewedOrderAmount: 199,
          shippedOrderAmount: 199,
          exposureVisitRate: 0.09,
          visitCreatedOrderRate: 1 / 18,
          visitShipmentRate: 1 / 18,
        },
        '7d': {
          exposure: 1400,
          publicVisits: 100,
          amount: 899,
          createdOrders: 3,
          signedOrders: 3,
          reviewedOrders: 3,
          shippedOrders: 2,
          createdOrderAmount: 999,
          signedOrderAmount: 899,
          reviewedOrderAmount: 899,
          shippedOrderAmount: 699,
          exposureVisitRate: 100 / 1400,
          visitCreatedOrderRate: 0.03,
          visitShipmentRate: 0.02,
        },
        '30d': {
          exposure: 6000,
          publicVisits: 420,
          amount: 2999,
          createdOrders: 8,
          signedOrders: 8,
          reviewedOrders: 8,
          shippedOrders: 6,
          createdOrderAmount: 3200,
          signedOrderAmount: 2999,
          reviewedOrderAmount: 2999,
          shippedOrderAmount: 2600,
          exposureVisitRate: 0.07,
          visitCreatedOrderRate: 8 / 420,
          visitShipmentRate: 6 / 420,
        },
      },
      topLinks: [
        {
          internalProductId: '851',
          platformProductId: 'p851',
          productName: 'Insta360 Ace Pro',
          shortName: 'Ace Pro',
          status: 'active',
          oneDayExposure: 200,
          oneDayPublicVisits: 18,
          oneDayAmount: 199,
        },
      ],
      risks: [],
    },
  ],
};

const registryEntries: LinkRegistryEntry[] = [
  {
    internalProductId: '841',
    platformProductId: 'p841',
    productName: 'Insta360 Ace Pro 2 标准套装',
    shortName: 'Ace Pro 2',
    aliases: ['Ace pro 2', 'AcePro2', 'ace pro'],
    sameSkuGroupId: 'insta360-ace-pro-2',
    status: 'active',
    source: ['product_name_map'],
  },
  {
    internalProductId: '842',
    platformProductId: 'p842',
    productName: 'Insta360 Ace Pro 2 续航套装',
    shortName: 'Ace Pro 2',
    aliases: ['Ace pro 2'],
    sameSkuGroupId: 'insta360-ace-pro-2',
    status: 'active',
    source: ['product_name_map'],
  },
  {
    internalProductId: '843',
    platformProductId: 'p843',
    productName: 'Insta360 Ace Pro 2 已下架',
    shortName: 'Ace Pro 2',
    aliases: ['Ace pro 2'],
    sameSkuGroupId: 'insta360-ace-pro-2',
    status: 'removed',
    source: ['product_name_map'],
  },
  {
    internalProductId: '851',
    platformProductId: 'p851',
    productName: 'Insta360 Ace Pro',
    shortName: 'Ace Pro',
    aliases: ['Ace pro'],
    sameSkuGroupId: 'insta360-ace-pro',
    status: 'active',
    source: ['product_name_map'],
  },
];

describe('queryInventoryStatus', () => {
  it('returns overview mode when no query is provided', () => {
    const result = queryInventoryStatus({ snapshot, registryStore: createLinkRegistry(registryEntries), query: '' });
    expect(result.status).toBe('overview');
  });

  it('returns detail mode for unique alias matches', () => {
    const result = queryInventoryStatus({ snapshot, registryStore: createLinkRegistry(registryEntries), query: 'AcePro2' });
    expect(result).toMatchObject({ status: 'detail', sameSkuGroupId: 'insta360-ace-pro-2', matchedBy: 'alias' });
  });

  it('returns detail mode for explicit internal ids by same-sku group', () => {
    const result = queryInventoryStatus({ snapshot, registryStore: createLinkRegistry(registryEntries), query: '841' });
    expect(result).toMatchObject({ status: 'detail', sameSkuGroupId: 'insta360-ace-pro-2', matchedBy: 'internal_id' });
  });

  it('returns ambiguous mode for multiple alias matches', () => {
    const result = queryInventoryStatus({ snapshot, registryStore: createLinkRegistry(registryEntries), query: 'Ace Pro' });
    expect(result.status).toBe('ambiguous');
    if (result.status !== 'ambiguous') return;
    expect(result.candidates.map((candidate) => candidate.sameSkuGroupId).sort()).toEqual(['insta360-ace-pro', 'insta360-ace-pro-2']);
  });

  it('returns not_found when registry cannot resolve the query', () => {
    expect(queryInventoryStatus({ snapshot, registryStore: createLinkRegistry(registryEntries), query: 'totally unknown' })).toEqual({
      status: 'not_found',
      query: 'totally unknown',
    });
  });

  it('returns snapshot_missing when no persisted snapshot is available', () => {
    expect(queryInventoryStatus({ snapshot: null, registryStore: createLinkRegistry(registryEntries), query: '' })).toEqual({
      status: 'snapshot_missing',
    });
  });
});
