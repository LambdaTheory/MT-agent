import { describe, expect, it } from 'vitest';
import { getLatestOverview, getProductPerformance, getProblemProducts, getNewProductPool } from '../src/agentData/publicTrafficQueries.js';
import type { PublicTrafficDataReportContext } from '../src/publicTraffic/types.js';

type ExtendedContext = Omit<PublicTrafficDataReportContext, 'newProductPoolItems' | 'newProductPoolIds'> & {
  newProductPoolItems?: Array<{ productId: string; productName: string; maintenanceStatus?: string } & Record<string, unknown>>;
  newProductPoolIds?: string[];
};

const context: ExtendedContext = {
  date: '2026-06-12',
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
  lifecycleGovernance: [],
  recommendedActions: [],
  emptySectionNotes: { lowExposure: '', weakClick: '', weakConversion: '', highPotential: '', newProductObservation: '', lifecycleGovernance: '', recommendedActions: '' },
};

const publicContext = context as unknown as PublicTrafficDataReportContext;

describe('agent public traffic queries', () => {
  it('returns overview metrics and quality notes', () => {
    expect(getLatestOverview(publicContext)).toMatchObject({ date: '2026-06-12', dataQualityNotes: ['后链路数据为空'] });
  });

  it('finds a product by display id or product name keyword', () => {
    expect(getProductPerformance(publicContext, '251')?.productName).toBe('佳能 G7X2');
    expect(getProductPerformance(publicContext, 'G7X2')?.productId).toBe('251');
  });

  it('returns problem products and new product pool', () => {
    expect(getProblemProducts(publicContext, 'low_exposure')).toEqual([{ type: 'low_exposure', productId: '251', action: '补曝光', reason: '曝光不足' }]);
    expect(getNewProductPool(publicContext)).toEqual([{ productId: '701', productName: '新品 Alpha', maintenanceStatus: '待维护' }]);
  });
});
