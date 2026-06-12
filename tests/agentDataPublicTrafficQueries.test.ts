import { describe, expect, it } from 'vitest';
import { getLatestOverview, getNewProductPool, getProblemProducts, getProductPerformance } from '../src/agentData/publicTrafficQueries.js';
import type { PublicTrafficDataReportContext } from '../src/publicTraffic/types.js';

type ExtendedContext = Omit<PublicTrafficDataReportContext, 'newProductPoolItems' | 'newProductPoolIds'> & {
  newProductPoolItems?: Array<{ productId: string; productName: string; maintenanceStatus?: string }>;
  newProductPoolIds?: string[];
};

const summary = {
  exposure: 100,
  publicVisits: 10,
  dashboardVisits: 8,
  createdOrders: 2,
  shippedOrders: 1,
  amount: 99,
  exposureVisitRate: 0.1,
  visitCreatedOrderRate: 0.2,
  visitShipmentRate: 0.1,
};

const period = {
  exposure: 50,
  publicVisits: 5,
  dashboardVisits: 4,
  createdOrders: 1,
  signedOrders: 0,
  reviewedOrders: 0,
  shippedOrders: 1,
  amount: 49,
  exposureVisitRate: 0.1,
  visitCreatedOrderRate: 0.2,
  visitShipmentRate: 0.2,
  hasExposureData: true,
  hasDashboardData: true,
};

const context: ExtendedContext = {
  date: '2026-06-12',
  summary: { '1d': summary, '7d': { ...summary, exposure: 700 }, '30d': { ...summary, exposure: 3000 } },
  conclusions: [],
  dataQualityNotes: ['后链路数据为空'],
  newProductPoolItems: [{ productId: '701', productName: '新品 Alpha', maintenanceStatus: '待维护' }],
  rows: [{ productName: '佳能 G7X2', platformProductId: 'p-251', displayProductId: '251', custodyDays: 3, periods: { '1d': period, '7d': { ...period, exposure: 200 }, '30d': { ...period, exposure: 1000 } } }],
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
    expect(getLatestOverview(publicContext).metrics.map((item) => item.period)).toEqual(['1d', '7d', '30d']);
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
