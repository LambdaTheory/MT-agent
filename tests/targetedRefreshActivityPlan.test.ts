import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { executeAgentToolRequest } from '../src/feishuBot/agentToolExecutor.js';
import type { PublicTrafficPeriodMetrics } from '../src/publicTraffic/types.js';

const metric: PublicTrafficPeriodMetrics = {
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
};

async function writeTargetedRefreshFixtures(options: { includeWindowOnlineCandidate?: boolean; includeWindowCreatedOrdersCandidate?: boolean; dirtyWindowDashboardCandidate?: boolean; includePlatformFallbackCandidate?: boolean; preferWindowSourceCandidate?: boolean } = {}) {
  const rootDir = await mkdtemp(join(tmpdir(), 'mt-agent-targeted-refresh-'));
  const outputDir = join(rootDir, 'output');
  const configDir = join(rootDir, 'config');
  const stateDir = join(outputDir, 'state');
  await mkdir(join(outputDir, '2026-06-11'), { recursive: true });
  await mkdir(configDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });

  const active30d = { ...metric, exposure: 600, publicVisits: 80, dashboardVisits: 60, createdOrders: 3, amount: 900, hasDashboardData: true };
  const zeroCreatedOrders30d = { ...metric, exposure: 300, publicVisits: 30, dashboardVisits: 20, createdOrders: 0, amount: 100, hasDashboardData: true };
  const zeroAmount30d = { ...metric, exposure: 240, publicVisits: 24, dashboardVisits: 18, createdOrders: 2, amount: 0, hasDashboardData: true };
  const globalZero30d = { ...metric, exposure: 500, publicVisits: 50, dashboardVisits: 40, createdOrders: 0, amount: 0, hasDashboardData: true };

  async function writeWindowDay(date: string) {
    const dirtyDashboardMetric = date === '2026-06-11'
      ? { ...metric, exposure: 3, publicVisits: 1, dashboardVisits: Number.NaN, createdOrders: 0, amount: 0, hasDashboardData: true }
      : { ...metric, exposure: 3, publicVisits: 1, dashboardVisits: 1, createdOrders: 0, amount: 0, hasDashboardData: true };
    const source680WindowMetric = options.preferWindowSourceCandidate
      ? date === '2026-06-11'
        ? { ...metric, exposure: 500, publicVisits: 20, dashboardVisits: 20, createdOrders: 1, amount: 1000, shippedOrders: 5, hasDashboardData: true }
        : { ...metric, exposure: 1, publicVisits: 0, dashboardVisits: 1, createdOrders: 1, amount: 0, shippedOrders: 0, hasDashboardData: true }
      : { ...metric, exposure: 10, publicVisits: 2, dashboardVisits: 2, createdOrders: 1, amount: 10, hasDashboardData: true };
    const source681WindowMetric = options.preferWindowSourceCandidate
      ? date === '2026-06-11'
        ? { ...metric, exposure: 2, publicVisits: 1, dashboardVisits: 1, createdOrders: 1, amount: 1, shippedOrders: 0, hasDashboardData: true }
        : { ...metric, exposure: 100, publicVisits: 20, dashboardVisits: 20, createdOrders: 1, amount: 200, shippedOrders: 5, hasDashboardData: true }
      : { ...metric, exposure: 2, publicVisits: 1, dashboardVisits: 1, createdOrders: 1, amount: 1, hasDashboardData: true };
    await mkdir(join(outputDir, date), { recursive: true });
    await writeFile(join(outputDir, date, `公域数据上下文_${date}.json`), JSON.stringify({
      date,
      summary: { '1d': metric, '7d': metric, '30d': metric },
      conclusions: [],
      dataQualityNotes: date === '2026-06-11' ? ['15日窗口测试缺失 1 条'] : [],
      rows: [
        { productName: 'R50 健康源', platformProductId: 'p680', displayProductId: '端内ID 680', custodyDays: 50, periods: { '1d': source680WindowMetric, '7d': metric, '30d': active30d } },
        { productName: 'R50 金额为0', platformProductId: 'p681', displayProductId: '端内ID 681', custodyDays: 45, periods: { '1d': source681WindowMetric, '7d': metric, '30d': zeroAmount30d } },
        { productName: 'R50 创单为0', platformProductId: 'p682', displayProductId: '端内ID 682', custodyDays: 45, periods: { '1d': options.dirtyWindowDashboardCandidate ? dirtyDashboardMetric : { ...metric, exposure: 3, publicVisits: 1, dashboardVisits: 1, createdOrders: 0, amount: 0, hasDashboardData: true }, '7d': metric, '30d': zeroCreatedOrders30d } },
        ...(options.includeWindowOnlineCandidate ? [{ productName: 'R50 上线20天窗口候选', platformProductId: 'p683', displayProductId: '端内ID 683', custodyDays: 20, periods: { '1d': { ...metric, exposure: 4, publicVisits: 1, dashboardVisits: 1, createdOrders: 0, amount: 0, hasDashboardData: true }, '7d': metric, '30d': zeroCreatedOrders30d } }] : []),
        ...(options.includeWindowCreatedOrdersCandidate ? [{ productName: 'R50 窗口创单为0', platformProductId: 'p684', displayProductId: '端内ID 684', custodyDays: 45, periods: { '1d': { ...metric, exposure: 5, publicVisits: 1, dashboardVisits: 1, createdOrders: 0, amount: 10, hasDashboardData: true }, '7d': metric, '30d': active30d } }] : []),
        ...(options.includePlatformFallbackCandidate ? [{ productName: '平台兜底候选', platformProductId: 'p685', displayProductId: '端内ID 999', custodyDays: 45, periods: { '1d': { ...metric, exposure: 6, publicVisits: 1, dashboardVisits: 1, createdOrders: 0, amount: 0, hasDashboardData: true }, '7d': metric, '30d': active30d } }] : []),
      ],
      lowExposure: [],
      weakClick: [],
      weakConversion: [],
      highPotential: [],
      newProductObservation: [],
      lifecycleGovernance: [],
      recommendedActions: [],
      emptySectionNotes: {},
    }), 'utf8');
  }

  for (let day = 28; day <= 31; day += 1) await writeWindowDay(`2026-05-${String(day).padStart(2, '0')}`);
  for (let day = 1; day <= 11; day += 1) await writeWindowDay(`2026-06-${String(day).padStart(2, '0')}`);

  await writeFile(join(outputDir, '2026-06-11', 'report-context.json'), JSON.stringify({
    date: '2026-06-11',
    summary: { '1d': metric, '7d': metric, '30d': metric },
    conclusions: [],
    rows: [
      { productName: 'R50 健康源', platformProductId: 'p680', displayProductId: '端内ID 680', custodyDays: 50, periods: { '1d': metric, '7d': metric, '30d': active30d } },
      { productName: 'R50 金额为0', platformProductId: 'p681', displayProductId: '端内ID 681', custodyDays: 45, periods: { '1d': metric, '7d': metric, '30d': zeroAmount30d } },
      { productName: 'R50 创单为0', platformProductId: 'p682', displayProductId: '端内ID 682', custodyDays: 45, periods: { '1d': metric, '7d': metric, '30d': zeroCreatedOrders30d } },
      ...(options.includeWindowOnlineCandidate ? [{ productName: 'R50 上线20天窗口候选', platformProductId: 'p683', displayProductId: '端内ID 683', custodyDays: 20, periods: { '1d': metric, '7d': metric, '30d': zeroCreatedOrders30d } }] : []),
      ...(options.includeWindowCreatedOrdersCandidate ? [{ productName: 'R50 窗口创单为0', platformProductId: 'p684', displayProductId: '端内ID 684', custodyDays: 45, periods: { '1d': metric, '7d': metric, '30d': active30d } }] : []),
      ...(options.includePlatformFallbackCandidate ? [{ productName: '平台兜底候选', platformProductId: 'p685', displayProductId: '端内ID 999', custodyDays: 45, periods: { '1d': metric, '7d': metric, '30d': active30d } }] : []),
      { productName: 'Pocket 3 全局零金额', platformProductId: 'p901', displayProductId: '端内ID 901', custodyDays: 45, periods: { '1d': metric, '7d': metric, '30d': globalZero30d } },
      { productName: 'SQ1 全局零金额', platformProductId: 'p903', displayProductId: '端内ID 903', custodyDays: 45, periods: { '1d': metric, '7d': metric, '30d': globalZero30d } },
    ],
    lowExposure: [],
    weakClick: [],
    weakConversion: [],
    highPotential: [],
    newProductObservation: [],
    lifecycleGovernance: [],
    recommendedActions: [],
    emptySectionNotes: {},
  }), 'utf8');

  await writeFile(join(configDir, 'product-id-map.json'), JSON.stringify({ p680: '680', p681: '681', p682: '682', ...(options.includeWindowOnlineCandidate ? { p683: '683' } : {}), ...(options.includeWindowCreatedOrdersCandidate ? { p684: '684' } : {}), ...(options.includePlatformFallbackCandidate ? { p685: '685' } : {}), p901: '901', p903: '903' }), 'utf8');
  await writeFile(join(configDir, 'product-name-map.json'), JSON.stringify({ '680': 'R50 健康源', '681': 'R50 金额为0', '682': 'R50 创单为0', ...(options.includeWindowOnlineCandidate ? { '683': 'R50 上线20天窗口候选' } : {}), ...(options.includeWindowCreatedOrdersCandidate ? { '684': 'R50 窗口创单为0' } : {}), ...(options.includePlatformFallbackCandidate ? { '685': '平台兜底候选' } : {}), '901': 'Pocket 3 全局零金额', '903': 'SQ1 全局零金额' }), 'utf8');
  await writeFile(join(configDir, 'link-registry-overrides.json'), JSON.stringify({
    version: 1,
    entries: [
      { internalProductId: '680', shortName: 'R50', aliases: ['r50'], sameSkuGroupId: 'canon-eos-r50', categoryName: '相机', status: 'active' },
      { internalProductId: '681', shortName: 'R50', aliases: ['r50'], sameSkuGroupId: 'canon-eos-r50', categoryName: '相机', status: 'active' },
      { internalProductId: '682', shortName: 'R50', aliases: ['r50'], sameSkuGroupId: 'canon-eos-r50', categoryName: '相机', status: 'active' },
      ...(options.includeWindowOnlineCandidate ? [{ internalProductId: '683', shortName: 'R50', aliases: ['r50'], sameSkuGroupId: 'canon-eos-r50', categoryName: '相机', status: 'active' }] : []),
      ...(options.includeWindowCreatedOrdersCandidate ? [{ internalProductId: '684', shortName: 'R50', aliases: ['r50'], sameSkuGroupId: 'canon-eos-r50', categoryName: '相机', status: 'active' }] : []),
      ...(options.includePlatformFallbackCandidate ? [{ internalProductId: '685', platformProductId: 'p685', shortName: '平台兜底候选', aliases: ['platform-fallback'], sameSkuGroupId: 'platform-fallback', categoryName: '相机', status: 'active' }] : []),
      { internalProductId: '901', shortName: 'Pocket 3', aliases: ['pocket3'], sameSkuGroupId: 'dji-pocket-3', categoryName: '云台相机', status: 'active' },
      { internalProductId: '903', shortName: 'SQ1', sameSkuGroupId: 'instax-sq1', categoryName: '拍立得', status: 'active' },
    ],
    sameSkuGroupAliasRules: [{ sameSkuGroupId: 'canon-eos-r50', aliases: ['r50', 'EOS R50'] }, { sameSkuGroupId: 'dji-pocket-3', aliases: ['pocket3', 'Pocket 3'] }],
  }), 'utf8');

  return {
    outputDir,
    registryPaths: {
      productIdMapPath: join(configDir, 'product-id-map.json'),
      productNameMapPath: join(configDir, 'product-name-map.json'),
      goodsSnapshotPath: join(stateDir, 'goods-current-snapshot.json'),
      firstSeenPath: join(stateDir, 'goods-first-seen.json'),
      lifecyclePath: join(stateDir, 'goods-link-lifecycle.json'),
      daemonCatalogPath: join(stateDir, 'link-registry-daemon-catalog.json'),
      overridesPath: join(configDir, 'link-registry-overrides.json'),
      artifactsDir: outputDir,
    },
  };
}

describe('targeted refresh activity plan', () => {
  it('scopes refreshActivityPlan to the requested same-sku group', async () => {
    const { outputDir, registryPaths } = await writeTargetedRefreshFixtures();

    const response = await executeAgentToolRequest(
      { toolName: 'operations.refreshActivityPlan', arguments: { query: 'r50' }, reason: '帮我下架r50近30天产生订单金额为0的链接' },
      outputDir,
      { closedOrderRegistryPaths: registryPaths },
    );

    expect(response.text).toContain('筛选范围：R50 / canon-eos-r50');
    expect(response.text).toContain('端内ID 682');
    expect(response.text).not.toContain('Pocket 3');
    expect(response.text).not.toContain('SQ1');
    expect(response.metadata?.candidateCount).toBe(1);
  });

  it('uses zero amount when zeroMetric is amount', async () => {
    const { outputDir, registryPaths } = await writeTargetedRefreshFixtures();

    const response = await executeAgentToolRequest(
      { toolName: 'operations.refreshActivityPlan', arguments: { query: 'r50', zeroMetric: 'amount' }, reason: '帮我下架r50近30天产生订单金额为0的链接' },
      outputDir,
      { closedOrderRegistryPaths: registryPaths },
    );

    expect(response.text).toContain('筛选口径：active 链接，30日访问页数据已抓取，上线满 30 天，近30天订单金额为0。');
    expect(response.text).toContain('端内ID 681');
    expect(response.text).not.toContain('端内ID 682');
    expect(response.metadata?.candidateCount).toBe(1);
  });

  it('accepts a configurable windowDays value at the plan layer', async () => {
    const { outputDir, registryPaths } = await writeTargetedRefreshFixtures();

    const response = await executeAgentToolRequest(
      { toolName: 'operations.refreshActivityPlan', arguments: { query: 'r50', zeroMetric: 'amount', windowDays: 15 }, reason: '帮我下架r50近15天产生订单金额为0的链接' },
      outputDir,
      { closedOrderRegistryPaths: registryPaths },
    );

    expect(response.text).toContain('筛选口径：active 链接，15日访问页数据已抓取，上线满 15 天，近15天订单金额为0。');
    expect(response.metadata).toMatchObject({ toolName: 'operations.refreshActivityPlan', windowDays: 15 });
  });

  it('uses daily window aggregates instead of fixed 30d summary for non-30-day candidates', async () => {
    const { outputDir, registryPaths } = await writeTargetedRefreshFixtures();

    const response = await executeAgentToolRequest(
      { toolName: 'operations.refreshActivityPlan', arguments: { query: 'r50', zeroMetric: 'amount', windowDays: 15 }, reason: '帮我下架r50近15天产生订单金额为0的链接' },
      outputDir,
      { closedOrderRegistryPaths: registryPaths },
    );

    expect(response.text).toContain('端内ID 682');
    expect(response.text).not.toContain('端内ID 681');
    expect(response.metadata?.candidateCount).toBe(1);
  });

  it('uses windowDays as the online-day threshold', async () => {
    const { outputDir, registryPaths } = await writeTargetedRefreshFixtures({ includeWindowOnlineCandidate: true });

    const response = await executeAgentToolRequest(
      { toolName: 'operations.refreshActivityPlan', arguments: { query: 'r50', zeroMetric: 'amount', windowDays: 15 }, reason: '帮我下架r50近15天产生订单金额为0的链接' },
      outputDir,
      { closedOrderRegistryPaths: registryPaths },
    );

    expect(response.text).toContain('端内ID 682、683');
    expect(response.metadata?.candidateCount).toBe(2);
  });

  it('uses the selected window metric when zeroMetric is created_orders', async () => {
    const { outputDir, registryPaths } = await writeTargetedRefreshFixtures({ includeWindowCreatedOrdersCandidate: true });

    const response = await executeAgentToolRequest(
      { toolName: 'operations.refreshActivityPlan', arguments: { query: 'r50', zeroMetric: 'created_orders', windowDays: 15 }, reason: '帮我下架r50近15天创单为0的链接' },
      outputDir,
      { closedOrderRegistryPaths: registryPaths },
    );

    expect(response.text).toContain('端内ID 682、684');
    expect(response.text).not.toContain('端内ID 681');
    expect(response.metadata?.candidateCount).toBe(2);
  });

  it('does not treat a full row window as dashboard-covered when a daily dashboard metric is invalid', async () => {
    const { outputDir, registryPaths } = await writeTargetedRefreshFixtures({ dirtyWindowDashboardCandidate: true });

    const response = await executeAgentToolRequest(
      { toolName: 'operations.refreshActivityPlan', arguments: { query: 'r50', zeroMetric: 'created_orders', windowDays: 15 }, reason: '帮我下架r50近15天创单为0的链接' },
      outputDir,
      { closedOrderRegistryPaths: registryPaths },
    );

    expect(response.text).not.toContain('端内ID 682');
    expect(response.text).toContain('15日访问页缺失 1 条');
    expect(response.metadata?.candidateCount).toBe(0);
    expect(response.metadata?.skipped).toMatchObject({ missing30dDashboard: 1 });
  });

  it('matches non-30-day window aggregates by platformProductId fallback', async () => {
    const { outputDir, registryPaths } = await writeTargetedRefreshFixtures({ includePlatformFallbackCandidate: true });

    const response = await executeAgentToolRequest(
      { toolName: 'operations.refreshActivityPlan', arguments: { sameSkuGroupId: 'platform-fallback', zeroMetric: 'created_orders', windowDays: 15 }, reason: '帮我下架平台兜底候选近15天创单为0的链接' },
      outputDir,
      { closedOrderRegistryPaths: registryPaths },
    );

    expect(response.text).toContain('端内ID 685');
    expect(response.text).toContain('待下架候选：1 条');
    expect(response.text).toContain('15日访问页缺失 0 条');
    expect(response.metadata?.candidateCount).toBe(1);
  });

  it('orders refill sources by the selected window metrics', async () => {
    const { outputDir, registryPaths } = await writeTargetedRefreshFixtures({ preferWindowSourceCandidate: true });

    const response = await executeAgentToolRequest(
      { toolName: 'operations.refreshActivityPlan', arguments: { query: 'r50', zeroMetric: 'created_orders', windowDays: 15 }, reason: '帮我下架r50近15天创单为0的链接并补链' },
      outputDir,
      { closedOrderRegistryPaths: registryPaths },
    );

    expect(response.text).toContain('端内ID 682；补链源 681 R50 金额为0');
    expect(response.metadata?.strategyRequests).toMatchObject({ delistAndRefill: { newLinkItems: [{ sourceProductId: '681' }] } });
  });

  it('explains zero candidates with data health and strategy context', async () => {
    const { outputDir, registryPaths } = await writeTargetedRefreshFixtures();

    const response = await executeAgentToolRequest(
      { toolName: 'operations.refreshActivityPlan', arguments: { query: 'pocket3', zeroMetric: 'amount', windowDays: 15 }, reason: '为什么pocket3近15天金额为0候选是0' },
      outputDir,
      { closedOrderRegistryPaths: registryPaths },
    );

    expect(response.text).toContain('0 候选解释：');
    expect(response.text).toContain('数据健康：15日窗口测试缺失 1 条');
    expect(response.text).toContain('没有找到符合条件的近15天订单金额为0 active 链接。');
    expect(response.text).toContain('没有找到符合 近15天订单金额为0 的 active 链接。');
    expect(response.text).toContain('15日访问页缺失');
    expect(response.text).not.toContain('近30天');
    expect(response.text).not.toContain('近 30 天');
    expect(response.text).not.toContain('30日访问页缺失');
    expect(response.text).not.toContain('上线不足 30 天');
    expect(response.text).not.toContain('零创单 active 链接');
    expect(response.metadata?.candidateCount).toBe(0);
  });
});
