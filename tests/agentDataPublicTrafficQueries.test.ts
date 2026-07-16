import { describe, expect, it } from 'vitest';
import { getInactiveLinks, getLatestOverview, getProductPerformance, getProblemProducts, getNewProductPool, getRemovedLinks } from '../src/agentData/publicTrafficQueries.js';
import type { PublicTrafficDataReportContext } from '../src/publicTraffic/types.js';

type ExtendedContext = Omit<PublicTrafficDataReportContext, 'newProductPoolItems' | 'newProductPoolIds'> & {
  newProductPoolItems?: Array<{ productId: string; productName: string; maintenanceStatus?: string } & Record<string, unknown>>;
  newProductPoolIds?: string[];
};

const context: ExtendedContext = {
  date: '2026-06-12',
  generationId: 'agent-public-traffic-queries-2026-06-12',
  summary: {
    '1d': { exposure: 100, publicVisits: 10, dashboardVisits: 8, createdOrders: 2, shippedOrders: 1, amount: 99, exposureVisitRate: 0.1, visitCreatedOrderRate: 0.2, visitShipmentRate: 0.1 },
    '7d': { exposure: 700, publicVisits: 70, dashboardVisits: 60, createdOrders: 8, shippedOrders: 4, amount: 399, exposureVisitRate: 0.1, visitCreatedOrderRate: 0.11, visitShipmentRate: 0.06 },
    '30d': { exposure: 3000, publicVisits: 300, dashboardVisits: 250, createdOrders: 20, shippedOrders: 10, amount: 999, exposureVisitRate: 0.1, visitCreatedOrderRate: 0.07, visitShipmentRate: 0.03 },
  },
  conclusions: [],
  dataQualityNotes: ['后链路数据为空'],
  newProductPoolItems: [{ productId: '701', productName: '新品 Alpha', shortTitle: '', submittedAt: '2026-06-12 09:00:00', merchant: '', alipaySyncStatus: '', alipayCode: '', stock: 0, skuCount: 0, maintenanceStatus: '待维护', note: '' }],
  rows: [{ productName: '佳能 G7X2', platformProductId: 'p-251', displayProductId: '251', custodyDays: 3, periods: {
    '1d': { exposure: 50, publicVisits: 5, dashboardVisits: 4, createdOrders: 1, signedOrders: 0, reviewedOrders: 0, shippedOrders: 1, amount: 49, exposureVisitRate: 0.1, visitCreatedOrderRate: 0.2, visitShipmentRate: 0.2, hasExposureData: true, hasDashboardData: true },
    '7d': { exposure: 200, publicVisits: 20, dashboardVisits: 18, createdOrders: 3, signedOrders: 0, reviewedOrders: 0, shippedOrders: 2, amount: 149, exposureVisitRate: 0.1, visitCreatedOrderRate: 0.15, visitShipmentRate: 0.1, hasExposureData: true, hasDashboardData: true },
    '30d': { exposure: 1000, publicVisits: 100, dashboardVisits: 80, createdOrders: 10, signedOrders: 0, reviewedOrders: 0, shippedOrders: 5, amount: 499, exposureVisitRate: 0.1, visitCreatedOrderRate: 0.1, visitShipmentRate: 0.05, hasExposureData: true, hasDashboardData: true },
  }}],
  lowExposure: [{ identifier: '251', action: '补曝光', reason: '曝光不足' }],
  weakClick: [],
  weakConversion: [{ identifier: '251', action: '提转化', reason: '访问多成交少' }],
  highPotential: [],
  newProductObservation: [],
  lifecycleGovernance: [{ identifier: '端内ID 252', action: '下架、替换或重做素材', reason: '已托管 45 天，30日曝光 60，访问 1，金额 0.00', priority: 'medium' }],
  recommendedActions: [],
  emptySectionNotes: { lowExposure: '', weakClick: '', weakConversion: '', highPotential: '', newProductObservation: '', lifecycleGovernance: '', recommendedActions: '' },
};

const publicContext = context as unknown as PublicTrafficDataReportContext;

function productRow(displayProductId: string, productName: string, platformProductId: string) {
  return {
    productName,
    platformProductId,
    displayProductId,
    custodyDays: 3,
    periods: {
      '1d': { exposure: 50, publicVisits: 5, dashboardVisits: 4, createdOrders: 1, signedOrders: 0, reviewedOrders: 0, shippedOrders: 1, amount: 49, exposureVisitRate: 0.1, visitCreatedOrderRate: 0.2, visitShipmentRate: 0.2, hasExposureData: true, hasDashboardData: true },
      '7d': { exposure: 200, publicVisits: 20, dashboardVisits: 18, createdOrders: 3, signedOrders: 0, reviewedOrders: 0, shippedOrders: 2, amount: 149, exposureVisitRate: 0.1, visitCreatedOrderRate: 0.15, visitShipmentRate: 0.1, hasExposureData: true, hasDashboardData: true },
      '30d': { exposure: 1000, publicVisits: 100, dashboardVisits: 80, createdOrders: 10, signedOrders: 0, reviewedOrders: 0, shippedOrders: 5, amount: 499, exposureVisitRate: 0.1, visitCreatedOrderRate: 0.1, visitShipmentRate: 0.05, hasExposureData: true, hasDashboardData: true },
    },
  };
}

describe('agent public traffic queries', () => {
  it('returns overview metrics and quality notes', () => {
    expect(getLatestOverview(publicContext)).toMatchObject({ date: '2026-06-12', dataQualityNotes: ['后链路数据为空'] });
  });

  it('finds a product by display id or product name keyword', () => {
    expect(getProductPerformance(publicContext, '251')?.productName).toBe('佳能 G7X2');
    expect(getProductPerformance(publicContext, 'G7X2')?.productId).toBe('251');
  });

  it('treats a bare numeric product query as exact id matching', () => {
    const collisionContext = {
      ...context,
      rows: [
        productRow('端内ID 649', 'vivo X300Ultra 733 长焦演唱会神器', '2000000000000000000733'),
        productRow('端内ID 841', '佳能R50微单相机', 'p-841-733'),
        productRow('端内ID 733', '大疆DJI Pocket3云台相机128G', 'p-733-target'),
      ],
    } as unknown as PublicTrafficDataReportContext;

    expect(getProductPerformance(collisionContext, '733')?.productId).toBe('端内ID 733');
  });

  it('returns problem products and new product pool', () => {
    expect(getProblemProducts(publicContext, 'low_exposure')).toEqual([{ type: 'low_exposure', productId: '251', action: '补曝光', reason: '曝光不足' }]);
    expect(getNewProductPool(publicContext)).toEqual([{ productId: '701', productName: '新品 Alpha', maintenanceStatus: '待维护' }]);
  });

  it('returns removed links from Agent-only report context data', () => {
    const withRemovedLinks = {
      ...context,
      agentData: {
        removedLinks: [
          { productId: '701', platformProductId: 'p701', productName: '已下架链接', removedDate: '2026-06-12', reason: '商品总表缺失', source: 'goods_snapshot_diff' },
        ],
      },
    } as unknown as PublicTrafficDataReportContext;

    expect(getRemovedLinks(withRemovedLinks)).toEqual([
      { productId: '701', platformProductId: 'p701', productName: '已下架链接', removedDate: '2026-06-12', reason: '商品总表缺失', source: 'goods_snapshot_diff' },
    ]);
  });

  it('returns an empty removed-link list when Agent data is absent', () => {
    expect(getRemovedLinks(publicContext)).toEqual([]);
  });

  it('returns inactive-link candidates from lifecycle governance instead of removed links', () => {
    expect(getInactiveLinks(publicContext)).toEqual([
      {
        productId: '252',
        identifier: '端内ID 252',
        action: '下架、替换或重做素材',
        reason: '已托管 45 天，30日曝光 60，访问 1，金额 0.00',
        priority: 'medium',
      },
    ]);
  });
});
