import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findReadOnlyTool, readOnlyTools } from '../src/feishuBot/readOnlyToolRegistry.js';
import { createLinkRegistry } from '../src/linkRegistry/store.js';
import type { LinkRegistryEntry } from '../src/linkRegistry/types.js';
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
  lifecycleGovernance: [{ identifier: '端内ID 706', action: '下架、替换或重做素材', reason: '已托管 45 天，30日曝光 60，访问 1，金额 0.00', priority: 'medium' }],
  recommendedActions: [],
  newProductPoolItems: [{ productId: '701', productName: '大疆 Pocket 3', shortTitle: '', submittedAt: '2026-06-15 09:00:00', merchant: '', alipaySyncStatus: '已同步', alipayCode: '', stock: 0, skuCount: 0, maintenanceStatus: '待维护', note: '' }],
  agentData: { removedLinks: [{ productId: '705', platformProductId: 'p705', productName: '已下架链接', removedDate: '2026-06-14', reason: '商品总表缺失', source: 'goods_snapshot_diff' }] },
  orderAnalysis: { runDate: '2026-06-15', pages: { overview: { label: '订单概览', dataDate: '2026-06-14', indicators: [{ label: '发货订单', value: '12' }] } } },
  emptySectionNotes: { lowExposure: '', weakClick: '', weakConversion: '', highPotential: '', newProductObservation: '', lifecycleGovernance: '', recommendedActions: '' },
} as unknown as PublicTrafficDataReportContext;

const rankingContext = {
  ...context,
  rows: [
    ...context.rows,
    {
      productName: '大疆 Pocket 3 高转化套装',
      platformProductId: 'p702',
      displayProductId: '端内ID 702',
      custodyDays: 2,
      periods: {
        '1d': { ...metric, shippedOrders: 1, amount: 188, publicVisits: 22 },
        '7d': { ...metric, shippedOrders: 4, amount: 888, publicVisits: 80 },
        '30d': metric,
      },
    },
  ],
} as unknown as PublicTrafficDataReportContext;

const registry: LinkRegistryEntry[] = [
  { internalProductId: '701', platformProductId: 'p701', shortName: 'DJI Pocket 3', sameSkuGroupId: 'dji-pocket-3', status: 'active', source: ['product_name_map'] },
  { internalProductId: '702', platformProductId: 'p702', shortName: 'DJI Pocket 3', sameSkuGroupId: 'dji-pocket-3', status: 'active', source: ['product_name_map'] },
];

describe('readOnlyTools', () => {
  it('exports stable read-only tool names and lookup helper', () => {
    expect(readOnlyTools.map((tool) => tool.name)).toEqual([
      'overview',
      'product',
      'best_product_by_same_sku',
      'refresh_candidate_explain',
      'safe_source_resolve',
      'safe_source_groups',
      'new_product_pool',
      'tasks',
      'problem_products',
      'inactive_links',
      'removed_links',
      'order_summary',
    ]);
    expect(findReadOnlyTool({ type: 'product', keyword: '701' })?.name).toBe('product');
    expect(findReadOnlyTool({ type: 'best_product_by_same_sku', query: 'Pocket3' })?.name).toBe('best_product_by_same_sku');
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
    await expect(findReadOnlyTool({ type: 'inactive_links' })?.run(context, { type: 'inactive_links' })).resolves.toMatchObject({
      text: expect.stringContaining('失活候选链接ID集合：706'),
    });
    await expect(findReadOnlyTool({ type: 'removed_links' })?.run(context, { type: 'removed_links' })).resolves.toMatchObject({ text: expect.stringContaining('2026-06-14') });
    await expect(findReadOnlyTool({ type: 'order_summary' })?.run(context, { type: 'order_summary' })).resolves.toMatchObject({ text: expect.stringContaining('发货订单：12') });
  });

  it('answers best same-sku product questions only when registry data is available', async () => {
    await expect(findReadOnlyTool({ type: 'best_product_by_same_sku', query: 'Pocket3' })?.run(rankingContext, { type: 'best_product_by_same_sku', query: 'Pocket3' }, { linkRegistryStore: createLinkRegistry(registry) })).resolves.toMatchObject({
      text: expect.stringContaining('端内ID 702'),
    });

    await expect(findReadOnlyTool({ type: 'best_product_by_same_sku', query: 'Pocket3' })?.run(rankingContext, { type: 'best_product_by_same_sku', query: 'Pocket3' })).resolves.toMatchObject({
      text: expect.stringContaining('需要先读取链接维护档案'),
    });
  });

  it('answers arbitrary-window same-sku ranking through daily window aggregation', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-read-only-window-'));
    for (const [date, amount701, amount702] of [
      ['2026-06-14', 500, 0],
      ['2026-06-15', 0, 900],
    ] as const) {
      const dayDir = join(outputDir, date);
      await mkdir(dayDir, { recursive: true });
      await writeFile(join(dayDir, `公域数据上下文_${date}.json`), JSON.stringify({
        date,
        rows: [
          { productName: '大疆 Pocket 3', platformProductId: 'p701', displayProductId: '端内ID 701', periods: { '1d': { ...metric, amount: amount701 } } },
          { productName: '大疆 Pocket 3 高转化套装', platformProductId: 'p702', displayProductId: '端内ID 702', periods: { '1d': { ...metric, amount: amount702 } } },
        ],
      }), 'utf8');
    }

    await expect(findReadOnlyTool({ type: 'best_product_by_same_sku', query: 'Pocket3', periodDays: 2, metric: 'amount' })?.run(rankingContext, { type: 'best_product_by_same_sku', query: 'Pocket3', periodDays: 2, metric: 'amount' }, { linkRegistryStore: createLinkRegistry(registry), registryEntries: registry, outputDir })).resolves.toMatchObject({
      text: expect.stringContaining('端内ID 702'),
      metadata: { toolName: 'product.rankBestSameSku', periodDays: 2, metric: 'amount' },
    });
  });

  it('answers parsed strategy capability intents as executable read-only tools', async () => {
    const blockedRegistry: LinkRegistryEntry[] = [
      { internalProductId: '701', platformProductId: 'p701', shortName: 'DJI Pocket 3', sameSkuGroupId: 'dji-pocket-3', status: 'active', source: ['product_name_map'] },
      { internalProductId: '702', platformProductId: 'p702', shortName: 'DJI Pocket 3', sameSkuGroupId: 'dji-pocket-3', status: 'active', source: ['product_name_map'] },
      { internalProductId: '801', platformProductId: 'p801', shortName: 'Empty Group', aliases: ['empty'], sameSkuGroupId: 'empty-group', status: 'active', source: ['product_name_map'] },
    ];

    await expect(findReadOnlyTool({ type: 'refresh_candidate_explain', query: 'Pocket3', zeroMetric: 'created_orders' })?.run(rankingContext, { type: 'refresh_candidate_explain', query: 'Pocket3', zeroMetric: 'created_orders' }, { registryEntries: blockedRegistry })).resolves.toMatchObject({
      text: expect.stringContaining('筛选范围'),
      metadata: { toolName: 'strategy.refreshCandidateExplain' },
    });

    await expect(findReadOnlyTool({ type: 'safe_source_resolve', query: 'Pocket3' })?.run(rankingContext, { type: 'safe_source_resolve', query: 'Pocket3' }, { registryEntries: blockedRegistry, linkRegistryStore: createLinkRegistry(blockedRegistry) })).resolves.toMatchObject({
      text: expect.stringContaining('安全源商品'),
      metadata: { toolName: 'strategy.safeSourceResolve', status: 'found' },
    });

    await expect(findReadOnlyTool({ type: 'safe_source_groups' })?.run(rankingContext, { type: 'safe_source_groups' }, { registryEntries: blockedRegistry })).resolves.toMatchObject({
      text: expect.stringContaining('empty-group'),
    });
  });
});
