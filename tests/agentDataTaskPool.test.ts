import { describe, expect, it } from 'vitest';
import { buildAgentTaskPool } from '../src/agentData/taskPool.js';
import type { PublicTrafficDataReportContext } from '../src/publicTraffic/types.js';

const baseContext = {
  date: '2026-06-12',
  summary: { '1d': { exposure: 0, publicVisits: 0, dashboardVisits: 0, createdOrders: 0, shippedOrders: 0, amount: 0, exposureVisitRate: 0, visitCreatedOrderRate: 0, visitShipmentRate: 0 }, '7d': { exposure: 0, publicVisits: 0, dashboardVisits: 0, createdOrders: 0, shippedOrders: 0, amount: 0, exposureVisitRate: 0, visitCreatedOrderRate: 0, visitShipmentRate: 0 }, '30d': { exposure: 0, publicVisits: 0, dashboardVisits: 0, createdOrders: 0, shippedOrders: 0, amount: 0, exposureVisitRate: 0, visitCreatedOrderRate: 0, visitShipmentRate: 0 } },
  conclusions: [], rows: [], lowExposure: [{ identifier: '251', action: '补曝光', reason: '曝光不足' }], weakClick: [], weakConversion: [{ identifier: '252', action: '提转化', reason: '访问多成交少' }], highPotential: [{ identifier: '253', action: '继续放量', reason: '高潜力' }], newProductObservation: [], lifecycleGovernance: [], recommendedActions: [{ identifier: '254', action: '综合治理', reason: '建议跟进' }], newProductPoolIds: ['701'], emptySectionNotes: { lowExposure: '', weakClick: '', weakConversion: '', highPotential: '', newProductObservation: '', lifecycleGovernance: '', recommendedActions: '' },
} satisfies PublicTrafficDataReportContext;

describe('buildAgentTaskPool', () => {
  it('combines report actions and new product pool into prioritized tasks', () => {
    expect(buildAgentTaskPool(baseContext).map((item) => [item.productId, item.taskType, item.priority, item.status])).toEqual([
      ['253', 'high_potential', 90, '待处理'],
      ['252', 'weak_conversion', 80, '待处理'],
      ['251', 'low_exposure', 70, '待处理'],
      ['701', 'new_product_pool', 60, '待处理'],
      ['254', 'recommended_action', 50, '待处理'],
    ]);
  });
});
