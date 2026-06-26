import { describe, expect, it } from 'vitest';
import { buildInventorySameSkuSnapshot } from '../src/inventoryStatus/snapshot.js';
import type { LinkRegistryEntry } from '../src/linkRegistry/types.js';
import type { PublicTrafficDataReportContext, PublicTrafficPeriodMetrics, PublicTrafficProductDataRow } from '../src/publicTraffic/types.js';

function period(overrides: Partial<PublicTrafficPeriodMetrics> = {}): PublicTrafficPeriodMetrics {
  return {
    exposure: 0,
    publicVisits: 0,
    dashboardVisits: 0,
    createdOrders: 0,
    signedOrders: 0,
    reviewedOrders: 0,
    shippedOrders: 0,
    createdOrderAmount: 0,
    signedOrderAmount: 0,
    reviewedOrderAmount: 0,
    shippedOrderAmount: 0,
    amount: 0,
    exposureVisitRate: 0,
    visitCreatedOrderRate: 0,
    visitShipmentRate: 0,
    hasExposureData: true,
    hasDashboardData: true,
    ...overrides,
  };
}

function row(
  internalProductId: string,
  platformProductId: string,
  productName: string,
  oneDay: Partial<PublicTrafficPeriodMetrics>,
  sevenDay: Partial<PublicTrafficPeriodMetrics>,
  thirtyDay: Partial<PublicTrafficPeriodMetrics>,
): PublicTrafficProductDataRow {
  return {
    productName,
    platformProductId,
    displayProductId: `端内ID ${internalProductId}`,
    custodyDays: 7,
    periods: {
      '1d': period(oneDay),
      '7d': period(sevenDay),
      '30d': period(thirtyDay),
    },
  };
}

const registry: LinkRegistryEntry[] = [
  {
    internalProductId: '701',
    platformProductId: 'platform-701',
    productName: 'DJI Pocket 3 标准套装',
    shortName: 'Pocket 3',
    categoryId: 'camera',
    categoryName: '相机',
    productType: 'gimbal-camera',
    sameSkuGroupId: 'dji-pocket-3',
    status: 'active',
    source: ['product_id_mapping'],
  },
  {
    internalProductId: '702',
    platformProductId: 'platform-702',
    productName: 'DJI Pocket 3 创作者套装',
    shortName: 'Pocket 3',
    categoryId: 'camera',
    categoryName: '相机',
    productType: 'gimbal-camera',
    sameSkuGroupId: 'dji-pocket-3',
    status: 'active',
    source: ['product_id_mapping'],
  },
  {
    internalProductId: '703',
    platformProductId: 'platform-703',
    productName: 'DJI Pocket 3 已下架旧链',
    shortName: 'Pocket 3',
    categoryId: 'camera',
    categoryName: '相机',
    productType: 'gimbal-camera',
    sameSkuGroupId: 'dji-pocket-3',
    status: 'removed',
    source: ['goods_link_lifecycle'],
  },
];

const context: PublicTrafficDataReportContext = {
  date: '2026-06-24',
  summary: {
    '1d': {
      exposure: 300,
      publicVisits: 30,
      dashboardVisits: 30,
      createdOrders: 3,
      shippedOrders: 2,
      amount: 120,
      exposureVisitRate: 0.1,
      visitCreatedOrderRate: 0.1,
      visitShipmentRate: 2 / 30,
    },
    '7d': {
      exposure: 2100,
      publicVisits: 210,
      dashboardVisits: 210,
      createdOrders: 21,
      shippedOrders: 14,
      amount: 840,
      exposureVisitRate: 0.1,
      visitCreatedOrderRate: 0.1,
      visitShipmentRate: 14 / 210,
    },
    '30d': {
      exposure: 9000,
      publicVisits: 900,
      dashboardVisits: 900,
      createdOrders: 90,
      shippedOrders: 60,
      amount: 3600,
      exposureVisitRate: 0.1,
      visitCreatedOrderRate: 0.1,
      visitShipmentRate: 60 / 900,
    },
  },
  conclusions: [],
  rows: [
    row(
      '701',
      'platform-701',
      'DJI Pocket 3 标准套装',
      { exposure: 100, publicVisits: 10, dashboardVisits: 10, createdOrders: 1, signedOrders: 1, reviewedOrders: 1, shippedOrders: 1, createdOrderAmount: 50, signedOrderAmount: 45, reviewedOrderAmount: 44, shippedOrderAmount: 40, amount: 40, exposureVisitRate: 0.1, visitCreatedOrderRate: 0.1, visitShipmentRate: 0.1 },
      { exposure: 700, publicVisits: 70, dashboardVisits: 70, createdOrders: 7, signedOrders: 7, reviewedOrders: 7, shippedOrders: 5, createdOrderAmount: 350, signedOrderAmount: 320, reviewedOrderAmount: 315, shippedOrderAmount: 280, amount: 280, exposureVisitRate: 0.1, visitCreatedOrderRate: 0.1, visitShipmentRate: 5 / 70 },
      { exposure: 3000, publicVisits: 300, dashboardVisits: 300, createdOrders: 30, signedOrders: 30, reviewedOrders: 28, shippedOrders: 20, createdOrderAmount: 1500, signedOrderAmount: 1380, reviewedOrderAmount: 1300, shippedOrderAmount: 1200, amount: 1200, exposureVisitRate: 0.1, visitCreatedOrderRate: 0.1, visitShipmentRate: 20 / 300 },
    ),
    row(
      '702',
      'platform-702',
      'DJI Pocket 3 创作者套装',
      { exposure: 200, publicVisits: 20, dashboardVisits: 20, createdOrders: 2, signedOrders: 2, reviewedOrders: 2, shippedOrders: 1, createdOrderAmount: 90, signedOrderAmount: 80, reviewedOrderAmount: 76, shippedOrderAmount: 70, amount: 80, exposureVisitRate: 0.1, visitCreatedOrderRate: 0.1, visitShipmentRate: 1 / 20 },
      { exposure: 1400, publicVisits: 140, dashboardVisits: 140, createdOrders: 14, signedOrders: 14, reviewedOrders: 14, shippedOrders: 9, createdOrderAmount: 630, signedOrderAmount: 590, reviewedOrderAmount: 560, shippedOrderAmount: 490, amount: 560, exposureVisitRate: 0.1, visitCreatedOrderRate: 0.1, visitShipmentRate: 9 / 140 },
      { exposure: 6000, publicVisits: 600, dashboardVisits: 600, createdOrders: 60, signedOrders: 60, reviewedOrders: 55, shippedOrders: 40, createdOrderAmount: 2700, signedOrderAmount: 2500, reviewedOrderAmount: 2300, shippedOrderAmount: 2000, amount: 2400, exposureVisitRate: 0.1, visitCreatedOrderRate: 0.1, visitShipmentRate: 40 / 600 },
    ),
  ],
  lowExposure: [],
  weakClick: [],
  weakConversion: [],
  highPotential: [],
  newProductObservation: [],
  lifecycleGovernance: [],
  recommendedActions: [],
  emptySectionNotes: {
    lowExposure: '',
    weakClick: '',
    weakConversion: '',
    highPotential: '',
    newProductObservation: '',
    lifecycleGovernance: '',
    recommendedActions: '',
  },
};

describe('inventory same sku snapshot', () => {
  it('aggregates multiple product rows into one same sku snapshot and recomputes rates', () => {
    const snapshot = buildInventorySameSkuSnapshot({
      date: '2026-06-24',
      reportDate: '2026-06-24',
      context,
      registry,
      overrideRisks: [],
    });

    expect(snapshot.groups).toHaveLength(1);
    expect(snapshot.groups[0]).toMatchObject({
      sameSkuGroupId: 'dji-pocket-3',
      groupName: 'Pocket 3',
      categoryId: 'camera',
      categoryName: '相机',
      productType: 'gimbal-camera',
      activeLinkCount: 2,
      totalLinkCount: 3,
      mappedRowCount: 2,
      missingMetricLinkCount: 1,
    });
    expect(snapshot.groups[0]?.periods['1d']).toMatchObject({
      exposure: 300,
      publicVisits: 30,
      amount: 120,
      createdOrders: 3,
      signedOrders: 3,
      reviewedOrders: 3,
      shippedOrders: 2,
      createdOrderAmount: 140,
      signedOrderAmount: 125,
      reviewedOrderAmount: 120,
      shippedOrderAmount: 110,
      exposureVisitRate: 0.1,
      visitCreatedOrderRate: 0.1,
      visitShipmentRate: 2 / 30,
    });
    expect(snapshot.groups[0]?.topLinks.map((item) => item.internalProductId)).toEqual(['702', '701']);
  });
});
