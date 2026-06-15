import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findReadOnlyTool, readOnlyTools } from '../src/feishuBot/readOnlyToolRegistry.js';
import type { PublicTrafficDataReportContext } from '../src/publicTraffic/types.js';

const metric = {
  exposure: 100,
  publicVisits: 10,
  dashboardVisits: 8,
  createdOrders: 2,
  signedOrders: 0,
  reviewedOrders: 0,
  shippedOrders: 1,
  amount: 88,
  exposureVisitRate: 0.1,
  visitCreatedOrderRate: 0.2,
  visitShipmentRate: 0.1,
  hasExposureData: true,
  hasDashboardData: true,
};

const context = {
  date: '2026-06-15',
  summary: { '1d': metric, '7d': metric, '30d': metric },
  conclusions: [],
  dataQualityNotes: [],
  rows: [{ productName: '大疆 Pocket 3', platformProductId: 'p701', displayProductId: '端内ID 701', custodyDays: 3, periods: { '1d': metric, '7d': metric, '30d': metric } }],
  lowExposure: [{ identifier: '端内ID 702', action: '补曝光', reason: '曝光不足' }],
  weakClick: [],
  weakConversion: [{ identifier: '端内ID 703', action: '提转化', reason: '访问多成交少' }],
  highPotential: [{ identifier: '端内ID 704', action: '继续放量', reason: '高潜力' }],
  newProductObservation: [],
  lifecycleGovernance: [],
  recommendedActions: [],
  newProductPoolItems: [{ productId: '701', productName: '大疆 Pocket 3', shortTitle: '', submittedAt: '2026-06-15 09:00:00', merchant: '', alipaySyncStatus: '已同步', alipayCode: '', stock: 0, skuCount: 0, maintenanceStatus: '待维护', note: '' }],
  agentData: { removedLinks: [{ productId: '705', platformProductId: 'p705', productName: '已下架链接', removedDate: '2026-06-14', reason: '商品总表缺失', source: 'goods_snapshot_diff' }] },
  orderAnalysis: { runDate: '2026-06-15', pages: { overview: { label: '订单概览', dataDate: '2026-06-14', indicators: [{ label: '发货订单', value: '12' }] } } },
  emptySectionNotes: { lowExposure: '', weakClick: '', weakConversion: '', highPotential: '', newProductObservation: '', lifecycleGovernance: '', recommendedActions: '' },
} as unknown as PublicTrafficDataReportContext;

describe('readOnlyTools', () => {
  it('exports stable read-only tool names and lookup helper', () => {
    expect(readOnlyTools.map((tool) => tool.name)).toEqual([
      'overview',
      'product',
      'new_product_pool',
      'tasks',
      'problem_products',
      'removed_links',
      'order_summary',
    ]);
    expect(findReadOnlyTool({ type: 'product', keyword: '701' })?.name).toBe('product');
    expect(findReadOnlyTool({ type: 'unknown', text: '随便聊聊' })).toBeUndefined();
  });

  it('does not register side-effect bot commands', () => {
    const source = readFileSync('src/feishuBot/readOnlyToolRegistry.ts', 'utf8');
    expect(source).not.toContain('run_public_traffic_report');
    expect(source).not.toContain('resend_latest_report');
    expect(source).not.toContain('push_latest_report_to_group');
  });

  it('answers every registered read-only Agent intent', async () => {
    await expect(findReadOnlyTool({ type: 'overview' })?.run(context, { type: 'overview' })).resolves.toMatchObject({ text: expect.stringContaining('公域日报 2026-06-15') });
    await expect(findReadOnlyTool({ type: 'product', keyword: '701' })?.run(context, { type: 'product', keyword: '701' })).resolves.toMatchObject({ text: expect.stringContaining('端内ID 701') });
    await expect(findReadOnlyTool({ type: 'new_product_pool' })?.run(context, { type: 'new_product_pool' })).resolves.toMatchObject({ text: expect.stringContaining('大疆 Pocket 3') });
    await expect(findReadOnlyTool({ type: 'tasks' })?.run(context, { type: 'tasks' })).resolves.toMatchObject({ text: expect.stringContaining('端内ID 704') });
    await expect(findReadOnlyTool({ type: 'problem_products', problemType: 'weak_conversion' })?.run(context, { type: 'problem_products', problemType: 'weak_conversion' })).resolves.toMatchObject({ text: expect.stringContaining('访问多成交少') });
    await expect(findReadOnlyTool({ type: 'removed_links' })?.run(context, { type: 'removed_links' })).resolves.toMatchObject({ text: expect.stringContaining('2026-06-14') });
    await expect(findReadOnlyTool({ type: 'order_summary' })?.run(context, { type: 'order_summary' })).resolves.toMatchObject({ text: expect.stringContaining('发货订单：12') });
  });
});
