import { describe, expect, it } from 'vitest';
import type { LinkRegistryEntry } from '../src/linkRegistry/types.js';
import {
  buildNewLinkBatchConfirmCard,
  buildNewLinkBatchConfirmRequest,
  buildNewLinkBatchPlan,
  executeNewLinkBatchConfirmRequest,
  formatNewLinkBatchPlan,
  parseNewLinkBatchConfirmRequest,
} from '../src/newLinkWorkflow/batch.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';
import type { PublicTrafficDataReportContext, PublicTrafficPeriodMetrics } from '../src/publicTraffic/types.js';

const emptySummary = {
  exposure: 0,
  publicVisits: 0,
  dashboardVisits: 0,
  createdOrders: 0,
  shippedOrders: 0,
  amount: 0,
  exposureVisitRate: 0,
  visitCreatedOrderRate: 0,
  visitShipmentRate: 0,
};

function metrics(overrides: Partial<PublicTrafficPeriodMetrics> = {}): PublicTrafficPeriodMetrics {
  return {
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
    ...overrides,
  };
}

function row(productId: string, productName: string, platformProductId: string, sevenDay: Partial<PublicTrafficPeriodMetrics>) {
  return {
    productName,
    platformProductId,
    displayProductId: `端内ID ${productId}`,
    custodyDays: 7,
    periods: {
      '1d': metrics({ exposure: 100, publicVisits: 10 }),
      '7d': metrics(sevenDay),
      '30d': metrics({ exposure: 300, publicVisits: 20 }),
    },
  };
}

function context(): PublicTrafficDataReportContext {
  return {
    date: '2026-06-22',
    summary: { '1d': emptySummary, '7d': emptySummary, '30d': emptySummary },
    conclusions: [],
    rows: [
      row('733', '大疆DJI Pocket3云台相机128G 高转化', 'platform-733', { exposure: 1700, publicVisits: 220, shippedOrders: 4, amount: 1800 }),
      row('875', '大疆DJI Pocket3云台相机128G 低表现', 'platform-875', { exposure: 300, publicVisits: 30, shippedOrders: 0, amount: 120 }),
      row('841', '佳能R50微单相机', 'platform-841', { exposure: 1200, publicVisits: 140, shippedOrders: 2, amount: 700 }),
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
}

function registry(): LinkRegistryEntry[] {
  return [
    {
      internalProductId: '733',
      platformProductId: 'platform-733',
      shortName: '大疆 Pocket3',
      sameSkuGroupId: 'dji-pocket-3',
      status: 'active',
      source: ['product_id_mapping'],
    },
    {
      internalProductId: '875',
      platformProductId: 'platform-875',
      shortName: 'DJI Pocket 3',
      sameSkuGroupId: 'dji-pocket-3',
      status: 'active',
      source: ['product_id_mapping'],
    },
    {
      internalProductId: '841',
      platformProductId: 'platform-841',
      shortName: '佳能 R50',
      sameSkuGroupId: 'canon-r50',
      status: 'active',
      source: ['product_id_mapping'],
    },
  ];
}

describe('new link batch workflow', () => {
  it('uses link registry grouping and public traffic performance to choose the best source', () => {
    const plan = buildNewLinkBatchPlan({ keyword: 'pocket3', count: 10 }, context(), registry());

    expect(plan.status).toBe('ready');
    expect(plan.selectedSource).toMatchObject({
      productId: '733',
      platformProductId: 'platform-733',
      sameSkuGroupId: 'dji-pocket-3',
    });
    expect(plan.candidates.map((candidate) => candidate.productId)).toEqual(['733', '875']);
    expect(formatNewLinkBatchPlan(plan)).toContain('准备复制 10 条「pocket3」新链');
    expect(JSON.stringify(buildNewLinkBatchConfirmCard(plan, '用户要铺新链'))).toContain('new_link_batch_confirm');
  });

  it('requires review when registry classification misses the keyword', () => {
    const plan = buildNewLinkBatchPlan({ keyword: 'pocket3', count: 2 }, context(), []);

    expect(plan.status).toBe('needs_review');
    expect(plan.selectedSource?.productId).toBe('733');
    expect(plan.warnings).toContain('链接档案未命中「pocket3」，候选仅按日报商品名兜底匹配，不能直接执行。');
    expect(buildNewLinkBatchConfirmRequest(plan, 'fallback')).toBeNull();
  });

  it('enforces the batch size safety cap', () => {
    const plan = buildNewLinkBatchPlan({ keyword: 'pocket3', count: 21 }, context(), registry());

    expect(plan.status).toBe('needs_review');
    expect(plan.warnings).toContain('铺新链数量必须在 1-20 之间。');
    expect(buildNewLinkBatchConfirmRequest(plan, 'too many')).toBeNull();
  });

  it('parses only valid confirmation requests', () => {
    expect(parseNewLinkBatchConfirmRequest({
      request: {
        workflowName: 'rental.newLinkBatch',
        keyword: 'pocket3',
        count: 3,
        sourceProductId: '733',
        sourceProductName: '大疆 Pocket3',
        dataDate: '2026-06-22',
        reason: '用户要铺新链',
      },
    })).toMatchObject({ count: 3, sourceProductId: '733' });

    expect(parseNewLinkBatchConfirmRequest({
      request: {
        workflowName: 'rental.newLinkBatch',
        keyword: 'pocket3',
        count: 99,
        sourceProductId: '733',
        sourceProductName: '大疆 Pocket3',
        dataDate: '2026-06-22',
        reason: 'too many',
      },
    })).toBeNull();
  });

  it('copies the selected source once per requested new link after confirmation', async () => {
    const calls: string[] = [];
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run'); },
      async execute() { throw new Error('execute should not run'); },
      async copy(productId) {
        calls.push(productId);
        return { productId, ok: true, newProductId: `new-${calls.length}`, lines: ['copy: ok'] };
      },
      async delist() { throw new Error('delist should not run'); },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };

    const result = await executeNewLinkBatchConfirmRequest(rentalPriceClient, {
      workflowName: 'rental.newLinkBatch',
      keyword: 'pocket3',
      count: 3,
      sourceProductId: '733',
      sourceProductName: '大疆 Pocket3',
      dataDate: '2026-06-22',
      reason: '用户确认',
    });

    expect(calls).toEqual(['733', '733', '733']);
    expect(result).toMatchObject({ ok: true, completedCount: 3, newProductIds: ['new-1', 'new-2', 'new-3'] });
    expect(result.text).toContain('成功 3 条');
  });
});
