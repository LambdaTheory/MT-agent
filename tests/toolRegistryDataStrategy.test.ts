import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findAgentTool } from '../src/agentRuntime/toolRegistry.js';
import { executeAgentToolRequest } from '../src/feishuBot/agentToolExecutor.js';

const metric = {
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

async function writeJson(path: string, value: unknown) {
  await writeFile(path, JSON.stringify(value), 'utf8');
}

async function writeDay(outputDir: string, date: string, exposure: number, amount: number) {
  const dayDir = join(outputDir, date);
  await mkdir(dayDir, { recursive: true });
  await writeJson(join(dayDir, `公域数据上下文_${date}.json`), {
    date,
    summary: { '1d': metric, '7d': metric, '30d': metric },
    conclusions: [],
    dataQualityNotes: ['30d 访问页缺失 1 条'],
    rows: [
      {
        productName: 'R50 健康源',
        platformProductId: 'p680',
        displayProductId: '端内ID 680',
        custodyDays: 40,
        periods: { '1d': { ...metric, exposure, amount, shippedOrders: 1 }, '7d': { ...metric, shippedOrders: 2, amount: 88, publicVisits: 12 }, '30d': { ...metric, createdOrders: 1, amount: 88 } },
      },
      {
        productName: 'R50 零金额',
        platformProductId: 'p681',
        displayProductId: '端内ID 681',
        custodyDays: 40,
        periods: { '1d': metric, '7d': metric, '30d': { ...metric, createdOrders: 1, amount: 0 } },
      },
    ],
    lowExposure: [],
    weakClick: [],
    weakConversion: [],
    highPotential: [],
    newProductObservation: [],
    lifecycleGovernance: [],
    recommendedActions: [],
    emptySectionNotes: {},
  });
}

async function writeFixtures() {
  const outputDir = await mkdtemp(join(tmpdir(), 'mt-tool-registry-'));
  const configDir = join(outputDir, 'config');
  const stateDir = join(outputDir, 'state');
  await mkdir(configDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  await writeDay(outputDir, '2026-07-01', 10, 0);
  await writeDay(outputDir, '2026-07-02', 20, 100);
  await writeJson(join(outputDir, '2026-07-02', '订单分析_2026-07-02.json'), { pages: { overview: { dataDate: '2026-07-01' } } });
  await writeJson(join(outputDir, '2026-07-02', '曝光无ID样本_2026-07-02.json'), [{ raw: 'missing' }]);
  await writeJson(join(configDir, 'product-id-map.json'), { p680: '680', p681: '681' });
  await writeJson(join(configDir, 'product-name-map.json'), { '680': 'R50 健康源', '681': 'R50 零金额' });
  await writeJson(join(configDir, 'link-registry-overrides.json'), {
    version: 1,
    entries: [
      { internalProductId: '680', platformProductId: 'p680', shortName: 'R50', aliases: ['r50'], sameSkuGroupId: 'canon-eos-r50', categoryName: '相机', status: 'active' },
      { internalProductId: '681', platformProductId: 'p681', shortName: 'R50', aliases: ['r50'], sameSkuGroupId: 'canon-eos-r50', categoryName: '相机', status: 'active' },
    ],
    sameSkuGroupAliasRules: [{ sameSkuGroupId: 'canon-eos-r50', aliases: ['r50'] }],
  });
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

describe('data and strategy capability tools', () => {
  it('registers every new capability as read-only', () => {
    for (const name of ['publicTraffic.windowAggregate', 'system.dataHealth', 'strategy.safeSourceResolve', 'strategy.refreshCandidateExplain']) {
      expect(findAgentTool(name)).toMatchObject({ risk: 'read', requiresConfirmation: false });
    }
  });

  it('documents stable metadata fields for data and strategy tool continuation', () => {
    expect(findAgentTool('publicTraffic.windowAggregate')?.resultMetadataSchema).toMatchObject({
      properties: {
        productIds: expect.any(Object),
        fullyCoveredProductIds: expect.any(Object),
        partialCoveredProductIds: expect.any(Object),
        missingDatesByProduct: expect.any(Object),
        windowDays: expect.any(Object),
        productCount: expect.any(Object),
        items: expect.any(Object),
      },
    });
    expect(findAgentTool('product.rankBestSameSku')?.resultMetadataSchema).toMatchObject({
      properties: {
        bestProductId: expect.any(Object),
        sameSkuGroupId: expect.any(Object),
        productIds: expect.any(Object),
      },
    });
    expect(findAgentTool('strategy.safeSourceResolve')?.resultMetadataSchema).toMatchObject({
      properties: {
        status: expect.any(Object),
        sameSkuGroupId: expect.any(Object),
        sourceProductId: expect.any(Object),
        excludedProductIds: expect.any(Object),
        candidateSourceCount: expect.any(Object),
      },
    });
    expect(findAgentTool('strategy.refreshCandidateExplain')?.resultMetadataSchema).toMatchObject({
      properties: {
        candidateCount: expect.any(Object),
        candidateProductIds: expect.any(Object),
        missing30dDashboardProductIds: expect.any(Object),
        missingRowProductIds: expect.any(Object),
        skippedReasons: expect.any(Object),
      },
    });
    expect(findAgentTool('operations.refreshActivityPlan')?.inputSchema).toMatchObject({
      properties: {
        windowDays: expect.any(Object),
      },
    });
    expect(findAgentTool('operations.refreshActivityPlan')?.resultMetadataSchema).toMatchObject({
      properties: {
        windowDays: expect.any(Object),
      },
    });
    expect(findAgentTool('operations.refreshActivityPlan')?.description).toContain('windowDays');
    expect(findAgentTool('operations.refreshActivityPlan')?.description).not.toContain('近30天零创单');
  });

  it('dispatches window aggregation and data health tools', async () => {
    const { outputDir } = await writeFixtures();

    await expect(executeAgentToolRequest({ toolName: 'publicTraffic.windowAggregate', arguments: { endDate: '2026-07-02', windowDays: 2 }, reason: '测试窗口聚合' }, outputDir)).resolves.toMatchObject({
      metadata: { toolName: 'publicTraffic.windowAggregate', windowDays: 2, productCount: 2 },
    });
    await expect(executeAgentToolRequest({ toolName: 'system.dataHealth', arguments: { date: '2026-07-02' }, reason: '测试数据健康' }, outputDir)).resolves.toMatchObject({
      metadata: { toolName: 'system.dataHealth', missingIdSampleCount: 1, hasReportContext: true },
    });
  });

  it('dispatches safe-source and refresh-candidate explanation strategy tools', async () => {
    const { outputDir, registryPaths } = await writeFixtures();

    await expect(executeAgentToolRequest({ toolName: 'strategy.safeSourceResolve', arguments: { date: '2026-07-02', sameSkuGroupId: 'canon-eos-r50', excludedProductIds: ['681'] }, reason: '测试安全源' }, outputDir, { closedOrderRegistryPaths: registryPaths })).resolves.toMatchObject({
      metadata: { toolName: 'strategy.safeSourceResolve', status: 'found', sourceProductId: '680' },
    });
    await expect(executeAgentToolRequest({ toolName: 'strategy.refreshCandidateExplain', arguments: { date: '2026-07-02', query: 'r50', zeroMetric: 'amount' }, reason: '测试候选解释' }, outputDir, { closedOrderRegistryPaths: registryPaths })).resolves.toMatchObject({
      metadata: { toolName: 'strategy.refreshCandidateExplain', query: 'r50', sameSkuGroupId: 'canon-eos-r50', candidateCount: 1, candidateProductIds: ['681'] },
    });
  });
});
