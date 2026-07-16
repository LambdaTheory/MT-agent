import { describe, expect, it } from 'vitest';
import { buildInventorySameSkuSnapshot } from '../src/inventoryStatus/snapshot.js';
import type { InventoryStatusPeriodMetrics } from '../src/inventoryStatus/types.js';
import type { LinkListingState, LinkRegistryEntry } from '../src/linkRegistry/types.js';
import type { PublicTrafficDataReportContext, PublicTrafficPeriodMetrics, PublicTrafficProductDataRow } from '../src/publicTraffic/types.js';

const generatedAt = '2026-06-24T08:30:45.123Z';
const generationId = 'inventory-snapshot-20260624-083045';

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

function registryEntry(overrides: Partial<LinkRegistryEntry> & { internalProductId: string }): LinkRegistryEntry {
  const listingState = overrides.listingState ?? 'on_sale';
  return {
    platformProductId: `platform-${overrides.internalProductId}`,
    productName: `商品 ${overrides.internalProductId}`,
    shortName: '测试同款',
    categoryId: 'camera',
    categoryName: '相机',
    productType: 'gimbal-camera',
    sameSkuGroupId: 'test-same-sku',
    status: listingState === 'on_sale' ? 'active' : listingState === 'unknown' ? 'unknown' : 'removed',
    listingState,
    source: ['product_id_mapping'],
    ...overrides,
  };
}

function contextWithRows(rows: PublicTrafficProductDataRow[]): PublicTrafficDataReportContext {
  return {
    date: '2026-06-24',
    generationId: 'inventory-status-source-report-2026-06-24',
    summary: {
      '1d': { exposure: 0, publicVisits: 0, dashboardVisits: 0, createdOrders: 0, shippedOrders: 0, amount: 0, exposureVisitRate: 0, visitCreatedOrderRate: 0, visitShipmentRate: 0 },
      '7d': { exposure: 0, publicVisits: 0, dashboardVisits: 0, createdOrders: 0, shippedOrders: 0, amount: 0, exposureVisitRate: 0, visitCreatedOrderRate: 0, visitShipmentRate: 0 },
      '30d': { exposure: 0, publicVisits: 0, dashboardVisits: 0, createdOrders: 0, shippedOrders: 0, amount: 0, exposureVisitRate: 0, visitCreatedOrderRate: 0, visitShipmentRate: 0 },
    },
    conclusions: [],
    rows,
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
}

function buildSnapshot(input: {
  context: PublicTrafficDataReportContext;
  registry: LinkRegistryEntry[];
  generationId?: string;
  generatedAt?: string;
}) {
  return buildInventorySameSkuSnapshot({
    date: '2026-06-24',
    reportDate: '2026-06-24',
    generationId: input.generationId ?? generationId,
    generatedAt: input.generatedAt ?? generatedAt,
    context: input.context,
    registry: input.registry,
    overrideRisks: [],
  });
}

function metricKeys(): Array<keyof InventoryStatusPeriodMetrics> {
  return [
    'exposure',
    'publicVisits',
    'amount',
    'createdOrders',
    'signedOrders',
    'reviewedOrders',
    'shippedOrders',
    'createdOrderAmount',
    'signedOrderAmount',
    'reviewedOrderAmount',
    'shippedOrderAmount',
    'exposureVisitRate',
    'visitCreatedOrderRate',
    'visitShipmentRate',
  ];
}

const registry: LinkRegistryEntry[] = [
  registryEntry({
    internalProductId: '701',
    platformProductId: 'platform-701',
    productName: 'DJI Pocket 3 标准套装',
    shortName: 'Pocket 3',
    sameSkuGroupId: 'dji-pocket-3',
    listingState: 'on_sale',
  }),
  registryEntry({
    internalProductId: '702',
    platformProductId: 'platform-702',
    productName: 'DJI Pocket 3 创作者套装',
    shortName: 'Pocket 3',
    sameSkuGroupId: 'dji-pocket-3',
    listingState: 'on_sale',
  }),
  registryEntry({
    internalProductId: '703',
    platformProductId: 'platform-703',
    productName: 'DJI Pocket 3 已下架旧链',
    shortName: 'Pocket 3',
    sameSkuGroupId: 'dji-pocket-3',
    listingState: 'delisted',
    source: ['goods_link_lifecycle'],
  }),
  registryEntry({
    internalProductId: '704',
    platformProductId: 'platform-704',
    productName: 'DJI Pocket 3 已消失旧链',
    shortName: 'Pocket 3',
    sameSkuGroupId: 'dji-pocket-3',
    listingState: 'gone',
    source: ['goods_link_lifecycle'],
  }),
  registryEntry({
    internalProductId: '705',
    platformProductId: 'platform-705',
    productName: 'DJI Pocket 3 状态未知链',
    shortName: 'Pocket 3',
    sameSkuGroupId: 'dji-pocket-3',
    listingState: 'unknown',
    source: ['product_id_mapping'],
  }),
];

const context = contextWithRows([
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
]);

describe('inventory same sku snapshot', () => {
  it('aggregates multiple product rows into one same sku snapshot and exposes schema, generation, listing-state, and audit metadata', () => {
    const snapshot = buildSnapshot({ context, registry });

    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      generationId,
      generatedAt,
      warnings: [],
    });
    expect(snapshot.registryAuditSummary).toEqual({
      totalLinks: 5,
      onSaleLinks: 2,
      delistedLinks: 1,
      goneLinks: 1,
      unknownLinks: 1,
      overrideRiskCount: 0,
    });
    expect(snapshot.groups).toHaveLength(1);
    expect(snapshot.groups[0]).toMatchObject({
      sameSkuGroupId: 'dji-pocket-3',
      groupName: 'Pocket 3',
      categoryId: 'camera',
      categoryName: '相机',
      productType: 'gimbal-camera',
      activeLinkCount: 2,
      totalLinkCount: 5,
      mappedRowCount: 2,
      missingMetricLinkCount: 3,
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
    expect(snapshot.groups[0]?.topLinks[0]).toHaveProperty('listingState', 'on_sale');
    expect(snapshot.groups[0]?.topLinks[0]).not.toHaveProperty('status');
  });

  it('preserves nullable metrics by source availability and only computes rates from real denominators', () => {
    const sourceAwareRow = row(
      '801',
      'platform-801',
      '来源可用性测试',
      { hasExposureData: false, hasDashboardData: false },
      { hasExposureData: true, hasDashboardData: true },
      { exposure: 120, publicVisits: 24, dashboardVisits: 24, createdOrders: 6, signedOrders: 5, reviewedOrders: 4, shippedOrders: 3, createdOrderAmount: 600, signedOrderAmount: 500, reviewedOrderAmount: 400, shippedOrderAmount: 300, amount: 360, exposureVisitRate: 0.2, visitCreatedOrderRate: 0.25, visitShipmentRate: 0.125 },
    );
    const snapshot = buildSnapshot({
      context: contextWithRows([sourceAwareRow]),
      registry: [registryEntry({ internalProductId: '801', platformProductId: 'platform-801' })],
    });
    const group = snapshot.groups[0];

    for (const key of metricKeys()) expect(group?.periods['1d']).toHaveProperty(key, null);
    expect(group?.topLinks[0]).toMatchObject({
      internalProductId: '801',
      oneDayExposure: null,
      oneDayPublicVisits: null,
      oneDayAmount: null,
    });
    expect(group?.periods['7d']).toMatchObject({
      exposure: 0,
      publicVisits: 0,
      amount: 0,
      createdOrders: 0,
      signedOrders: 0,
      reviewedOrders: 0,
      shippedOrders: 0,
      exposureVisitRate: null,
      visitCreatedOrderRate: null,
      visitShipmentRate: null,
    });
    expect(group?.periods['30d']).toMatchObject({
      exposure: 120,
      publicVisits: 24,
      amount: 360,
      createdOrders: 6,
      shippedOrders: 3,
      exposureVisitRate: 24 / 120,
      visitCreatedOrderRate: 6 / 24,
      visitShipmentRate: 3 / 24,
    });
  });

  it('aggregates mixed source rows without inventing zeros for unavailable source sides', () => {
    const exposureOnly = row(
      '811',
      'platform-811',
      '仅曝光侧',
      { exposure: 100, publicVisits: 25, amount: 250, hasExposureData: true, hasDashboardData: false },
      { exposure: 700, publicVisits: 175, amount: 1750, hasExposureData: true, hasDashboardData: false },
      { exposure: 3000, publicVisits: 600, amount: 6000, hasExposureData: true, hasDashboardData: false },
    );
    const dashboardOnly = row(
      '812',
      'platform-812',
      '仅订单侧',
      { createdOrders: 5, signedOrders: 4, reviewedOrders: 3, shippedOrders: 2, createdOrderAmount: 500, signedOrderAmount: 400, reviewedOrderAmount: 300, shippedOrderAmount: 200, hasExposureData: false, hasDashboardData: true },
      { createdOrders: 15, signedOrders: 14, reviewedOrders: 13, shippedOrders: 12, createdOrderAmount: 1500, signedOrderAmount: 1400, reviewedOrderAmount: 1300, shippedOrderAmount: 1200, hasExposureData: false, hasDashboardData: true },
      { createdOrders: 30, signedOrders: 28, reviewedOrders: 26, shippedOrders: 24, createdOrderAmount: 3000, signedOrderAmount: 2800, reviewedOrderAmount: 2600, shippedOrderAmount: 2400, hasExposureData: false, hasDashboardData: true },
    );
    const snapshot = buildSnapshot({
      context: contextWithRows([exposureOnly, dashboardOnly]),
      registry: [
        registryEntry({ internalProductId: '811', platformProductId: 'platform-811', sameSkuGroupId: 'mixed-source' }),
        registryEntry({ internalProductId: '812', platformProductId: 'platform-812', sameSkuGroupId: 'mixed-source' }),
      ],
    });

    expect(snapshot.groups[0]?.periods['1d']).toMatchObject({
      exposure: 100,
      publicVisits: 25,
      amount: 250,
      createdOrders: 5,
      signedOrders: 4,
      reviewedOrders: 3,
      shippedOrders: 2,
      createdOrderAmount: 500,
      signedOrderAmount: 400,
      reviewedOrderAmount: 300,
      shippedOrderAmount: 200,
      exposureVisitRate: 25 / 100,
      visitCreatedOrderRate: 5 / 25,
      visitShipmentRate: 2 / 25,
    });
    expect(snapshot.groups[0]?.topLinks.find((item) => item.internalProductId === '812')).toMatchObject({
      oneDayExposure: null,
      oneDayPublicVisits: null,
      oneDayAmount: null,
    });
  });

  it('keeps order metrics unavailable when exposure-side amount exists without dashboard rows', () => {
    const exposureOnlySale = row(
      '813',
      'platform-813',
      '有金额但无后链路',
      { exposure: 100, publicVisits: 20, amount: 205, hasExposureData: true, hasDashboardData: false },
      { exposure: 700, publicVisits: 120, amount: 1279, hasExposureData: true, hasDashboardData: false },
      { exposure: 3000, publicVisits: 600, amount: 30710, hasExposureData: true, hasDashboardData: false },
    );
    const snapshot = buildSnapshot({
      context: contextWithRows([exposureOnlySale]),
      registry: [registryEntry({ internalProductId: '813', platformProductId: 'platform-813', sameSkuGroupId: 'exposure-amount-only' })],
    });

    expect(snapshot.groups[0]?.periods['7d']).toMatchObject({
      amount: 1279,
      createdOrders: null,
      shippedOrders: null,
      visitCreatedOrderRate: null,
      visitShipmentRate: null,
    });
  });

  it('distinguishes zero and one on-sale link inventory risks', () => {
    const zeroOnSaleSnapshot = buildSnapshot({
      context: contextWithRows([]),
      registry: [
        registryEntry({ internalProductId: '821', sameSkuGroupId: 'zero-on-sale', listingState: 'delisted' }),
        registryEntry({ internalProductId: '822', sameSkuGroupId: 'zero-on-sale', listingState: 'gone' }),
      ],
    });
    const oneOnSaleSnapshot = buildSnapshot({
      context: contextWithRows([]),
      registry: [
        registryEntry({ internalProductId: '831', sameSkuGroupId: 'one-on-sale', listingState: 'on_sale' }),
        registryEntry({ internalProductId: '832', sameSkuGroupId: 'one-on-sale', listingState: 'delisted' }),
      ],
    });

    expect(zeroOnSaleSnapshot.groups[0]?.risks).toContain('无在售链接');
    expect(oneOnSaleSnapshot.groups[0]?.risks).toContain('仅 1 条在售链接');
    expect(zeroOnSaleSnapshot.groups[0]?.risks).not.toEqual(oneOnSaleSnapshot.groups[0]?.risks);
  });

  it('skips platform product-id conflict entries before matching while preserving structural counts and warnings', () => {
    const conflictRegistry = [
      registryEntry({
        internalProductId: '901',
        platformProductId: undefined,
        sameSkuGroupId: 'conflicted-group',
        platformProductIdConflict: {
          internalProductIds: ['901', '909'],
          platformProductIds: ['platform-conflict-primary', 'platform-conflict-shadow'],
        },
      }),
      registryEntry({ internalProductId: '902', platformProductId: 'platform-clean-902', sameSkuGroupId: 'conflicted-group' }),
      registryEntry({ internalProductId: '911', platformProductId: 'platform-clean-911', sameSkuGroupId: 'clean-group', shortName: 'Clean Group' }),
    ];
    const snapshot = buildSnapshot({
      context: contextWithRows([
        row('901', 'platform-conflict-primary', '冲突但有端内匹配', { exposure: 999, publicVisits: 99, amount: 999, createdOrders: 9, shippedOrders: 9 }, {}, {}),
        row('902', 'platform-clean-902', '干净同组链接', { exposure: 20, publicVisits: 4, amount: 40, createdOrders: 2, shippedOrders: 1 }, {}, {}),
        row('911', 'platform-clean-911', '干净独立组', { exposure: 30, publicVisits: 6, amount: 60, createdOrders: 3, shippedOrders: 2 }, {}, {}),
      ]),
      registry: conflictRegistry,
    });
    const conflictedGroup = snapshot.groups.find((group) => group.sameSkuGroupId === 'conflicted-group');
    const cleanGroup = snapshot.groups.find((group) => group.sameSkuGroupId === 'clean-group');

    expect(conflictedGroup).toMatchObject({
      totalLinkCount: 2,
      activeLinkCount: 2,
      mappedRowCount: 1,
      missingMetricLinkCount: 0,
    });
    expect(conflictedGroup?.periods['1d']).toMatchObject({ exposure: 20, publicVisits: 4, amount: 40, createdOrders: 2, shippedOrders: 1 });
    expect(conflictedGroup?.topLinks.map((item) => item.internalProductId)).toEqual(['902']);
    expect(conflictedGroup?.risks.join('\n')).toContain('1 条映射冲突链接');
    expect(cleanGroup?.periods['1d']).toMatchObject({ exposure: 30, publicVisits: 6, amount: 60, createdOrders: 3, shippedOrders: 2 });
    expect(snapshot).toHaveProperty('warnings');
    expect(JSON.stringify(snapshot)).toContain('901');
    expect(JSON.stringify(snapshot)).toContain('platform-conflict-primary');
    expect(JSON.stringify(snapshot)).toContain('platform-conflict-shadow');
  });
});
