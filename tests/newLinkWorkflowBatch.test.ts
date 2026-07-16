import { describe, expect, it } from 'vitest';
import type { LinkRegistryEntry } from '../src/linkRegistry/types.js';
import {
  buildNewLinkBatchConfirmCard,
  buildNewLinkBatchConfirmRequest,
  buildNewLinkBatchPlan,
  buildNewLinkBatchMultiConfirmCard,
  buildNewLinkBatchMultiConfirmRequest,
  executeNewLinkBatchConfirmRequest,
  executeNewLinkBatchMultiConfirmRequest,
  explainNewLinkBatchMultiConfirmBlocker,
  formatNewLinkBatchPlan,
  MAX_NEW_LINK_BATCH_MULTI_TOTAL_COUNT,
  parseNewLinkBatchMultiConfirmRequest,
  parseNewLinkBatchConfirmRequest,
  readNewLinkBatchWorkflowRequest,
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

function readButtonValue(card: unknown, buttonName: string): Record<string, unknown> {
  const body = (card as { body?: { elements?: Array<{ elements?: Array<{ name?: string; behaviors?: Array<{ value?: unknown }> }>; actions?: Array<{ name?: string; behaviors?: Array<{ value?: unknown }> }> }> } }).body;
  for (const element of body?.elements ?? []) {
    for (const item of [...(element.elements ?? []), ...(element.actions ?? [])]) {
      if (item.name === buttonName) {
        const value = item.behaviors?.[0]?.value;
        if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
      }
    }
  }
  throw new Error(`${buttonName} value not found`);
}

function stringifyNumbers(value: unknown): unknown {
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map((item) => stringifyNumbers(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, stringifyNumbers(item)]));
  }
  return value;
}

function context(): PublicTrafficDataReportContext {
  return {
    date: '2026-06-22',
    generationId: 'new-link-workflow-batch-2026-06-22',
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

  it('locks an explicit source product id instead of switching to a better same-sku candidate', () => {
    const unsafeContext = {
      ...context(),
      rows: [
        row('533', '大疆Pocket3手持数码口袋相机', 'platform-533', { exposure: 5000, publicVisits: 8405, shippedOrders: 0, amount: 22570 }),
        row('848', '佳能G12复古CCD相机', 'platform-848', { exposure: 0, publicVisits: 0, shippedOrders: 0, amount: 0 }),
      ],
    };
    const unsafeRegistry: LinkRegistryEntry[] = [
      {
        internalProductId: '533',
        platformProductId: 'platform-533',
        shortName: '大疆 Pocket3',
        sameSkuGroupId: 'bad-shared-group',
        status: 'active',
        source: ['product_id_mapping'],
      },
      {
        internalProductId: '848',
        platformProductId: 'platform-848',
        shortName: '佳能 G12',
        sameSkuGroupId: 'bad-shared-group',
        status: 'active',
        source: ['product_id_mapping'],
      },
    ];

    const plan = buildNewLinkBatchPlan({ keyword: '848', count: 3, sourceProductId: '848' }, unsafeContext, unsafeRegistry);

    expect(plan.status).toBe('ready');
    expect(plan.requestedSourceProductId).toBe('848');
    expect(plan.selectedSource?.productId).toBe('848');
    expect(plan.candidates.map((candidate) => candidate.productId)).toEqual(['848']);
    expect(JSON.stringify(buildNewLinkBatchConfirmCard(plan, '从端内ID 848 复制'))).toContain('"requestedSourceProductId":"848"');
  });

  it('treats numeric new-link keywords as explicit source product ids', () => {
    const request = readNewLinkBatchWorkflowRequest({ keyword: '875', count: 3 });
    expect(request).toEqual({ keyword: '875', count: 3, sourceProductId: '875' });

    const plan = buildNewLinkBatchPlan(request!, context(), registry());

    expect(plan.status).toBe('ready');
    expect(plan.requestedSourceProductId).toBe('875');
    expect(plan.selectedSource?.productId).toBe('875');
    expect(plan.candidates.map((candidate) => candidate.productId)).toEqual(['875']);
  });

  it('accepts source-product-id-only new-link requests from the planner', () => {
    expect(readNewLinkBatchWorkflowRequest({ sourceProductId: '875', count: 3 }))
      .toEqual({ keyword: '875', count: 3, sourceProductId: '875' });
    expect(readNewLinkBatchWorkflowRequest({ keyword: 'ID844', count: 5 }))
      .toEqual({ keyword: 'ID844', count: 5, sourceProductId: '844' });
    expect(readNewLinkBatchWorkflowRequest({ keyword: '\u7aef\u5185ID648', count: 5 }))
      .toEqual({ keyword: '\u7aef\u5185ID648', count: 5, sourceProductId: '648' });
  });

  it('carries signed fallback source candidates for agent-ranked new-link plans', () => {
    const plan = buildNewLinkBatchPlan({ keyword: 'pocket3', count: 3, sourceProductId: '733', fallbackSourceProductIds: ['875'] }, context(), registry());
    const card = buildNewLinkBatchConfirmCard(plan, 'agent ranked source');
    const value = readButtonValue(card, 'new_link_batch_confirm_submit');
    const parsed = parseNewLinkBatchConfirmRequest(value);

    expect(plan.candidates.map((candidate) => candidate.productId)).toEqual(['733', '875']);
    expect(parsed).toMatchObject({ sourceProductId: '733', fallbackSourceProductIds: ['875'] });
    expect(JSON.stringify(card)).toContain('"fallbackSourceProductIds":["875"]');
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
    const plan = buildNewLinkBatchPlan({ keyword: 'pocket3', count: 3, sourceProductId: '733' }, context(), registry());
    const card = buildNewLinkBatchConfirmCard(plan, 'user wants new links');
    const value = readButtonValue(card, 'new_link_batch_confirm_submit');
    const legacyFlatValue = { action: value.action, ...(value.request as Record<string, unknown>), confirmationKey: value.confirmationKey };

    expect(JSON.stringify(card)).toContain('"tag":"form"');
    expect(JSON.stringify(card)).toContain('new_link_batch_confirm_form');
    expect(JSON.stringify(card)).not.toContain('"tag":"action"');
    expect(value).toEqual({ action: 'new_link_batch_confirm', request: expect.any(Object), confirmationKey: expect.any(String) });
    expect(value).not.toHaveProperty('count');
    expect(parseNewLinkBatchConfirmRequest(value)).toMatchObject({ count: 3, sourceProductId: '733' });
    expect(parseNewLinkBatchConfirmRequest(legacyFlatValue)).toMatchObject({ count: 3, sourceProductId: '733' });
    expect(parseNewLinkBatchConfirmRequest(stringifyNumbers(value))).toMatchObject({ count: 3, sourceProductId: '733' });

    expect(parseNewLinkBatchConfirmRequest({
      request: {
        safetyVersion: 2,
        workflowName: 'rental.newLinkBatch',
        keyword: 'pocket3',
        count: 3,
        sourceProductId: '733',
        sourceProductName: '大疆 Pocket3',
        dataDate: '2026-06-22',
        reason: '用户要铺新链',
      },
    })).toBeNull();

    expect(parseNewLinkBatchConfirmRequest({
      request: {
        safetyVersion: 2,
        workflowName: 'rental.newLinkBatch',
        keyword: 'pocket3',
        count: 99,
        sourceProductId: '733',
        sourceProductName: '大疆 Pocket3',
        dataDate: '2026-06-22',
        reason: 'too many',
      },
    })).toBeNull();

    expect(parseNewLinkBatchConfirmRequest({
      request: {
        workflowName: 'rental.newLinkBatch',
        keyword: 'pocket3',
        count: 3,
        sourceProductId: '733',
        sourceProductName: '大疆 Pocket3',
        dataDate: '2026-06-22',
        reason: 'legacy card',
      },
    })).toBeNull();

    expect(parseNewLinkBatchConfirmRequest({
      request: {
        safetyVersion: 2,
        workflowName: 'rental.newLinkBatch',
        keyword: '848',
        count: 3,
        sourceProductId: '533',
        requestedSourceProductId: '848',
        sourceProductName: '大疆 Pocket3',
        dataDate: '2026-06-22',
        reason: 'mismatched source',
      },
    })).toBeNull();

    expect(parseNewLinkBatchConfirmRequest({
      ...value,
      request: { ...(value.request as Record<string, unknown>), sourceProductId: '875' },
    })).toBeNull();
  });

  it('builds and executes one confirmation for multiple best-link copy plans', async () => {
    const left = buildNewLinkBatchPlan({ keyword: 'wide 300', count: 5, sourceProductId: '733' }, context(), registry());
    const right = buildNewLinkBatchPlan({ keyword: 'wide 400', count: 5, sourceProductId: '841' }, context(), registry());
    const request = buildNewLinkBatchMultiConfirmRequest([left, right], '用户要求分别复制');

    expect(request).toMatchObject({
      safetyVersion: 2,
      workflowName: 'rental.newLinkBatch',
      mode: 'multi-source',
      items: [
        expect.objectContaining({ keyword: 'wide 300', count: 5, sourceProductId: '733' }),
        expect.objectContaining({ keyword: 'wide 400', count: 5, sourceProductId: '841' }),
      ],
    });
    const multiCard = buildNewLinkBatchMultiConfirmCard([left, right], '用户要求分别复制');
    expect(JSON.stringify(multiCard)).toContain('new_link_batch_multi_confirm');
    expect(JSON.stringify(multiCard)).toContain('"tag":"form"');
    expect(JSON.stringify(multiCard)).toContain('new_link_batch_multi_confirm_form');
    expect(JSON.stringify(multiCard)).not.toContain('"tag":"action"');
    const confirmValue = readButtonValue(buildNewLinkBatchMultiConfirmCard([left, right], request!.reason), 'new_link_batch_multi_confirm_submit');
    const flatConfirmValue = { action: confirmValue.action, ...(confirmValue.request as Record<string, unknown>), confirmationKey: confirmValue.confirmationKey };
    expect(confirmValue).toEqual({ action: 'new_link_batch_multi_confirm', request: expect.any(Object), confirmationKey: expect.any(String) });
    expect(confirmValue).not.toHaveProperty('items');
    expect(parseNewLinkBatchMultiConfirmRequest(confirmValue)).toEqual(request);
    expect(parseNewLinkBatchMultiConfirmRequest(flatConfirmValue)).toEqual(request);
    expect(parseNewLinkBatchMultiConfirmRequest(stringifyNumbers(confirmValue))).toEqual(request);
    expect(parseNewLinkBatchMultiConfirmRequest({
      ...confirmValue,
      request: { ...(confirmValue.request as Record<string, unknown>), items: [{ ...request!.items[0], count: 6 }, request!.items[1]] },
    })).toBeNull();
    expect(parseNewLinkBatchMultiConfirmRequest({ request })).toBeNull();

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

    const result = await executeNewLinkBatchMultiConfirmRequest(rentalPriceClient, request!);

    expect(calls).toEqual(['733', '733', '733', '733', '733', '841', '841', '841', '841', '841']);
    expect(result).toMatchObject({ ok: true, completedCount: 10 });
    expect(result.text).toContain('wide 300');
    expect(result.text).toContain('wide 400');
  });

  it('allows multi-product new-link confirmations above the single-product copy cap', () => {
    const plans = ['pocket3', 'action5', 'wide 300', 'wide 400', 'SQ1'].map((keyword, index) =>
      buildNewLinkBatchPlan({ keyword, count: 5, sourceProductId: index % 2 === 0 ? '733' : '841' }, context(), registry()));
    const request = buildNewLinkBatchMultiConfirmRequest(plans, '用户要求 5 个商品各铺 5 条');
    const card = buildNewLinkBatchMultiConfirmCard(plans, '用户要求 5 个商品各铺 5 条');

    expect(request?.items).toHaveLength(5);
    expect(request?.items.reduce((sum, item) => sum + item.count, 0)).toBe(25);
    expect(card).toBeDefined();
    expect(JSON.stringify(card)).toContain('new_link_batch_multi_confirm');
    expect(JSON.stringify(card)).not.toContain('"tag":"action"');
  });

  it('skips a missing source product and continues the remaining multi-product new-link batch', async () => {
    const calls: string[] = [];
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run'); },
      async execute() { throw new Error('execute should not run'); },
      async copy(productId) {
        calls.push(productId);
        if (productId === 'missing') {
          return {
            productId,
            ok: false,
            status: 'error',
            newProductId: null,
            message: 'Product not found: missing',
            lines: ['copy: error', 'message: Product not found: missing'],
          };
        }
        return { productId, ok: true, newProductId: `new-${calls.length}`, lines: ['copy: ok'] };
      },
      async delist() { throw new Error('delist should not run'); },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };

    const result = await executeNewLinkBatchMultiConfirmRequest(rentalPriceClient, {
      safetyVersion: 2,
      workflowName: 'rental.newLinkBatch',
      mode: 'multi-source',
      dataDate: '2026-06-28',
      reason: 'test partial batch',
      items: [
        {
          safetyVersion: 2,
          workflowName: 'rental.newLinkBatch',
          keyword: 'missing sku',
          count: 2,
          sourceProductId: 'missing',
          sourceProductName: 'missing sku',
          dataDate: '2026-06-28',
          reason: 'test partial batch',
        },
        {
          safetyVersion: 2,
          workflowName: 'rental.newLinkBatch',
          keyword: 'valid sku',
          count: 2,
          sourceProductId: 'valid',
          sourceProductName: 'valid sku',
          dataDate: '2026-06-28',
          reason: 'test partial batch',
        },
      ],
    });

    expect(calls).toEqual(['missing', 'valid', 'valid']);
    expect(result).toMatchObject({
      ok: false,
      completedCount: 2,
      newProductIds: ['new-2', 'new-3'],
      failedItems: [expect.objectContaining({ sourceProductId: 'missing', skipped: true, blocking: false })],
    });
    expect(result.text).toContain('部分完成');
    expect(result.text).toContain('跳过 1 个找不到的商品');
  });

  it('blocks multi-product new-link confirmations only when they exceed the multi-total cap', () => {
    const plans = ['pocket3', 'wide 300', 'SQ1'].map((keyword, index) =>
      buildNewLinkBatchPlan({ keyword, count: 20, sourceProductId: index % 2 === 0 ? '733' : '841' }, context(), registry()));

    expect(buildNewLinkBatchMultiConfirmRequest(plans, 'too many links')).toBeNull();
    expect(buildNewLinkBatchMultiConfirmCard(plans, 'too many links')).toBeUndefined();
    expect(explainNewLinkBatchMultiConfirmBlocker(plans)).toContain(`超过多商品单次确认上限 ${MAX_NEW_LINK_BATCH_MULTI_TOTAL_COUNT} 条`);
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
      safetyVersion: 2,
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

  it('switches to a fallback source when the selected source is missing before any side effect', async () => {
    const calls: string[] = [];
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run'); },
      async execute() { throw new Error('execute should not run'); },
      async copy(productId) {
        calls.push(productId);
        if (productId === '823') {
          return {
            productId,
            ok: false,
            status: 'error',
            newProductId: null,
            message: 'Product not found: 823',
            lines: ['copy: error', 'newProductId: unknown', 'message: Product not found: 823'],
          };
        }
        return { productId, ok: true, newProductId: `new-${calls.length}`, lines: ['copy: ok'] };
      },
      async delist() { throw new Error('delist should not run'); },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };

    const result = await executeNewLinkBatchConfirmRequest(rentalPriceClient, {
      safetyVersion: 2,
      workflowName: 'rental.newLinkBatch',
      keyword: 'sx70',
      count: 3,
      sourceProductId: '823',
      fallbackSourceProductIds: ['825', '826'],
      sourceProductName: 'Canon SX70',
      dataDate: '2026-06-28',
      reason: 'Agent ranked source with fallback candidates',
    });

    expect(calls).toEqual(['823', '825', '825', '825']);
    expect(result).toMatchObject({ ok: true, completedCount: 3, newProductIds: ['new-2', 'new-3', 'new-4'] });
    expect(result.text).toContain('源商品 825');
  });

  it('stops with an explicit no-retry warning when copy status is unknown after a possible side effect', async () => {
    const calls: string[] = [];
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run'); },
      async execute() { throw new Error('execute should not run'); },
      async copy(productId) {
        calls.push(productId);
        return {
          productId,
          ok: false,
          status: 'unknown',
          newProductId: null,
          sideEffectPossible: true,
          retrySafe: false,
          message: 'Copy may have succeeded but newProductId could not be detected; do not retry automatically',
          lines: [
            'copy: unknown',
            'newProductId: unknown',
            'message: Copy may have succeeded but newProductId could not be detected; do not retry automatically',
            'sideEffectPossible: true',
            'retrySafe: false',
          ],
        };
      },
      async delist() { throw new Error('delist should not run'); },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };

    const result = await executeNewLinkBatchConfirmRequest(rentalPriceClient, {
      safetyVersion: 2,
      workflowName: 'rental.newLinkBatch',
      keyword: 'ID844',
      count: 20,
      sourceProductId: '844',
      sourceProductName: '测试商品',
      dataDate: '2026-06-23',
      reason: '用户确认',
    });

    expect(calls).toEqual(['844']);
    expect(result).toMatchObject({ ok: false, completedCount: 0, newProductIds: [] });
    expect(result.text).toContain('1. 状态未知');
    expect(result.text).toContain('可能已经提交');
    expect(result.text).toContain('不要直接重试');
  });
});
