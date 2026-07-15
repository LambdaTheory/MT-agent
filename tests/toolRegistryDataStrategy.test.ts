import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findAgentTool } from '../src/agentRuntime/toolRegistry.js';
import { validateAgentToolArguments } from '../src/agentRuntime/planner.js';
import { publicTrafficMetricKeys } from '../src/agentData/publicTrafficMetricCatalog.js';
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
        periods: { '1d': { ...metric, exposure, publicVisits: 3, dashboardVisits: 2, createdOrders: 1, amount, shippedOrders: 1 }, '7d': { ...metric, shippedOrders: 2, amount: 88, publicVisits: 12 }, '30d': { ...metric, createdOrders: 1, amount: 88 } },
      },
      {
        productName: 'R50 零金额',
        platformProductId: 'p681',
        displayProductId: '端内ID 681',
        custodyDays: 40,
        periods: { '1d': { ...metric, exposure: 2, publicVisits: 0, dashboardVisits: 1, createdOrders: 1, amount: 50 }, '7d': metric, '30d': { ...metric, createdOrders: 1, amount: 0 } },
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
  it('derives reportQuery metric schema from the metric catalog', () => {
    expect(findAgentTool('publicTraffic.reportQuery')?.inputSchema).toMatchObject({
      properties: { metrics: { items: { enum: [...publicTrafficMetricKeys] } } },
    });
  });

  it('registers windowQuery with catalog metrics and bounded windowDays', () => {
    expect(findAgentTool('publicTraffic.windowQuery')?.inputSchema).toMatchObject({
      properties: {
        windowDays: { minimum: 1, maximum: 90 },
        metrics: { items: { enum: [...publicTrafficMetricKeys] } },
        filters: { items: { properties: { field: { enum: [...publicTrafficMetricKeys] } } } },
        sortBy: { enum: [...publicTrafficMetricKeys] },
      },
    });
  });

  it('validates windowQuery string windows consistently with runtime normalization', () => {
    expect(validateAgentToolArguments('publicTraffic.windowQuery', { windowDays: '15' })).toBe(true);
    expect(validateAgentToolArguments('publicTraffic.windowQuery', { windowDays: '91' })).toBe(false);
    expect(validateAgentToolArguments('publicTraffic.windowQuery', { windowDays: '1e1' })).toBe(false);
    expect(validateAgentToolArguments('publicTraffic.windowQuery', { windowDays: '0x10' })).toBe(false);
    expect(validateAgentToolArguments('publicTraffic.windowQuery', { windowDays: '01' })).toBe(false);
  });

  it('registers ranking tools with catalog metrics and arbitrary positive windows', () => {
    expect(findAgentTool('product.rankBestSameSku')?.inputSchema).toMatchObject({
      properties: {
        metric: { enum: [...publicTrafficMetricKeys] },
        periodDays: { minimum: 1, maximum: 90 },
      },
    });
    expect(findAgentTool('product.rankByCategory')?.inputSchema).toMatchObject({
      properties: {
        metric: { enum: [...publicTrafficMetricKeys] },
        periodDays: { minimum: 1, maximum: 90 },
      },
    });
  });

  it('bounds every arbitrary window tool schema to 1..90 days', () => {
    for (const toolName of ['publicTraffic.windowAggregate', 'strategy.metricThresholdExplain', 'strategy.refreshCandidateExplain', 'operations.refreshActivityPlan']) {
      expect(findAgentTool(toolName)?.inputSchema).toMatchObject({
        properties: { windowDays: { minimum: 1, maximum: 90 } },
      });
    }
  });

  it('rejects oversized string windows at the planner schema boundary', () => {
    expect(validateAgentToolArguments('publicTraffic.windowAggregate', { windowDays: '91' })).toBe(false);
    expect(validateAgentToolArguments('strategy.metricThresholdExplain', { metric: 'publicVisits', operator: 'eq', value: 0, windowDays: '91' })).toBe(false);
    expect(validateAgentToolArguments('strategy.refreshCandidateExplain', { zeroMetric: 'amount', windowDays: '91' })).toBe(false);
    expect(validateAgentToolArguments('operations.refreshActivityPlan', {
      conditions: [{ metric: 'publicVisits', operator: 'eq', value: 0 }],
      windowDays: '91',
    })).toBe(false);
    expect(validateAgentToolArguments('product.rankBestSameSku', { query: 'r50', periodDays: '91' })).toBe(false);
    expect(validateAgentToolArguments('product.rankByCategory', { metric: 'publicVisits', periodDays: '91' })).toBe(false);
  });

  it('accepts metricThresholdExplain conditions while retaining legacy threshold arguments', () => {
    const schema = findAgentTool('strategy.metricThresholdExplain')?.inputSchema;
    expect(schema).toMatchObject({
      properties: {
        conditions: {
          type: 'array',
          minItems: 1,
          maxItems: 6,
          items: {
            properties: {
              metric: { enum: [...publicTrafficMetricKeys] },
              operator: { enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] },
              value: { type: 'number' },
            },
            required: ['metric', 'operator', 'value'],
          },
        },
        metric: { enum: [...publicTrafficMetricKeys] },
        operator: { enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] },
        value: { type: 'number' },
      },
    });
    expect(validateAgentToolArguments('strategy.metricThresholdExplain', { conditions: [{ metric: 'publicVisits', operator: 'eq', value: 0 }] })).toBe(true);
    expect(validateAgentToolArguments('strategy.metricThresholdExplain', {
      conditions: [
        { metric: 'publicVisits', operator: 'eq', value: 0 },
        { metric: 'createdOrders', operator: 'eq', value: 0 },
        { metric: 'amount', operator: 'eq', value: 0 },
        { metric: 'exposure', operator: 'gte', value: 1 },
        { metric: 'dashboardVisits', operator: 'gte', value: 0 },
        { metric: 'shippedOrders', operator: 'gte', value: 0 },
      ],
    })).toBe(true);
    expect(validateAgentToolArguments('strategy.metricThresholdExplain', { conditions: [] })).toBe(false);
    expect(validateAgentToolArguments('strategy.metricThresholdExplain', {})).toBe(false);
    expect(validateAgentToolArguments('strategy.metricThresholdExplain', { metric: 'publicVisits' })).toBe(false);
    expect(validateAgentToolArguments('strategy.metricThresholdExplain', { metric: 'publicVisits', operator: 'eq' })).toBe(false);
    expect(validateAgentToolArguments('strategy.metricThresholdExplain', {
      conditions: [
        { metric: 'publicVisits', operator: 'eq', value: 0 },
        { metric: 'createdOrders', operator: 'eq', value: 0 },
        { metric: 'amount', operator: 'eq', value: 0 },
        { metric: 'exposure', operator: 'gte', value: 1 },
        { metric: 'dashboardVisits', operator: 'gte', value: 0 },
        { metric: 'shippedOrders', operator: 'gte', value: 0 },
        { metric: 'signedOrders', operator: 'gte', value: 0 },
      ],
    })).toBe(false);
    expect(validateAgentToolArguments('strategy.metricThresholdExplain', { metric: 'publicVisits', operator: 'eq', value: 0 })).toBe(true);
  });

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
        windowDays: expect.any(Object),
        candidateCount: expect.any(Object),
        candidateProductIds: expect.any(Object),
        missing30dDashboardProductIds: expect.any(Object),
        missingRowProductIds: expect.any(Object),
        skippedReasons: expect.any(Object),
      },
    });
    const refreshActivityPlanInputSchema = findAgentTool('operations.refreshActivityPlan')?.inputSchema;
    expect(refreshActivityPlanInputSchema).toMatchObject({
      properties: {
        conditions: {
          type: 'array',
          minItems: 1,
          maxItems: 6,
        },
        windowDays: expect.any(Object),
      },
      required: ['conditions', 'windowDays'],
    });
    expect(findAgentTool('strategy.metricThresholdExplain')?.resultMetadataSchema).toMatchObject({
      properties: {
        conditions: expect.any(Object),
        conditionSummary: expect.any(Object),
      },
    });
    expect(refreshActivityPlanInputSchema).not.toHaveProperty('properties.metric');
    expect(refreshActivityPlanInputSchema).not.toHaveProperty('properties.operator');
    expect(refreshActivityPlanInputSchema).not.toHaveProperty('properties.value');
    expect(findAgentTool('operations.refreshActivityPlan')?.resultMetadataSchema).toMatchObject({
      properties: {
        conditions: expect.any(Object),
        conditionSummary: expect.any(Object),
        availability: expect.any(Object),
        groupPlans: expect.any(Object),
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

  it('dispatches refresh-candidate explanation with windowDays semantics', async () => {
    const { outputDir, registryPaths } = await writeFixtures();

    const tool = findAgentTool('strategy.refreshCandidateExplain');
    expect(tool?.inputSchema).toMatchObject({
      properties: { windowDays: expect.any(Object) },
    });

    const response = await executeAgentToolRequest(
      { toolName: 'strategy.refreshCandidateExplain', arguments: { date: '2026-07-02', query: 'r50', zeroMetric: 'amount', windowDays: 2 }, reason: '测试2天候选解释' },
      outputDir,
      { closedOrderRegistryPaths: registryPaths },
    );

    expect(response.text).toContain('没有找到符合 近2天订单金额为0 的 active 链接。');
    expect(response.text).not.toContain('近30天');
    expect(response.text).not.toContain('近 30 天');
    expect(response.metadata).toMatchObject({ toolName: 'strategy.refreshCandidateExplain', windowDays: 2, candidateCount: 0, candidateProductIds: [] });
  });

  it('normalizes string windowDays before refresh-candidate window aggregation', async () => {
    const { outputDir, registryPaths } = await writeFixtures();

    const response = await executeAgentToolRequest(
      { toolName: 'strategy.refreshCandidateExplain', arguments: { date: '2026-07-02', query: 'r50', zeroMetric: 'amount', windowDays: '2' }, reason: '测试字符串窗口候选解释' },
      outputDir,
      { closedOrderRegistryPaths: registryPaths },
    );

    expect(response.text).toContain('没有找到符合 近2天订单金额为0 的 active 链接。');
    expect(response.text).not.toContain('近30天');
    expect(response.text).not.toContain('近 30 天');
    expect(response.metadata).toMatchObject({ toolName: 'strategy.refreshCandidateExplain', windowDays: 2, candidateCount: 0, candidateProductIds: [] });
  });

  it('dispatches metric-threshold explanation with compound conditions before legacy fallback', async () => {
    const { outputDir, registryPaths } = await writeFixtures();
    const conditions = [
      { metric: 'publicVisits', operator: 'eq', value: 0 },
      { metric: 'createdOrders', operator: 'gte', value: 2 },
    ];

    const response = await executeAgentToolRequest(
      { toolName: 'strategy.metricThresholdExplain', arguments: { date: '2026-07-02', query: 'r50', conditions, metric: 'publicVisits', operator: 'gt', value: 999, windowDays: 2 }, reason: '测试复合阈值解释' },
      outputDir,
      { closedOrderRegistryPaths: registryPaths },
    );

    expect(response.text).toContain('近2天公域访问量 = 0 且 近2天创建订单数 >= 2');
    expect(response.text).toContain('端内ID');
    expect(response.text).toContain('指标数据完整');
    expect(response.text).not.toContain('公域曝光页数据完整');
    expect(response.metadata).toMatchObject({
      toolName: 'strategy.metricThresholdExplain',
      metric: 'publicVisits',
      operator: 'eq',
      value: 0,
      conditions,
      conditionSummary: '近2天公域访问量 = 0 且 近2天创建订单数 >= 2',
      productIds: ['681'],
      candidateCount: 1,
    });
  });

  it('rejects metric-threshold explanation missing both compound and legacy forms', async () => {
    const { outputDir, registryPaths } = await writeFixtures();

    await expect(executeAgentToolRequest(
      { toolName: 'strategy.metricThresholdExplain', arguments: { date: '2026-07-02', query: 'r50', windowDays: 2 }, reason: '测试缺少阈值' },
      outputDir,
      { closedOrderRegistryPaths: registryPaths },
    )).rejects.toThrow('conditions or metric/operator/value are required');
  });

  it('rejects oversized arbitrary windows at runtime for exposed tools', async () => {
    const { outputDir, registryPaths } = await writeFixtures();

    await expect(executeAgentToolRequest({ toolName: 'publicTraffic.windowAggregate', arguments: { endDate: '2026-07-02', windowDays: 91 }, reason: 'oversized' }, outputDir)).rejects.toThrow('windowDays must be between 1 and 90');
    await expect(executeAgentToolRequest({ toolName: 'strategy.metricThresholdExplain', arguments: { date: '2026-07-02', metric: 'publicVisits', operator: 'eq', value: 0, windowDays: 91 }, reason: 'oversized' }, outputDir, { closedOrderRegistryPaths: registryPaths })).rejects.toThrow('windowDays must be between 1 and 90');
    await expect(executeAgentToolRequest({ toolName: 'operations.refreshActivityPlan', arguments: { date: '2026-07-02', conditions: [{ metric: 'publicVisits', operator: 'eq', value: 0 }], windowDays: 91 }, reason: 'oversized' }, outputDir, { closedOrderRegistryPaths: registryPaths })).rejects.toThrow('windowDays must be between 1 and 90');
  });

  it('rejects schema-invalid numeric string windows at runtime for exposed tools', async () => {
    const { outputDir, registryPaths } = await writeFixtures();

    await expect(executeAgentToolRequest({ toolName: 'publicTraffic.windowAggregate', arguments: { endDate: '2026-07-02', windowDays: '1e1' }, reason: 'noncanonical' }, outputDir)).rejects.toThrow('windowDays must be between 1 and 90');
    await expect(executeAgentToolRequest({ toolName: 'strategy.metricThresholdExplain', arguments: { date: '2026-07-02', metric: 'publicVisits', operator: 'eq', value: 0, windowDays: '0x10' }, reason: 'noncanonical' }, outputDir, { closedOrderRegistryPaths: registryPaths })).rejects.toThrow('windowDays must be between 1 and 90');
    await expect(executeAgentToolRequest({ toolName: 'product.rankBestSameSku', arguments: { query: 'r50', metric: 'publicVisits', periodDays: '1e1' }, reason: 'noncanonical' }, outputDir, { closedOrderRegistryPaths: registryPaths })).rejects.toThrow('periodDays must be between 1 and 90');
    await expect(executeAgentToolRequest({ toolName: 'product.rankByCategory', arguments: { category: '相机', metric: 'publicVisits', periodDays: '0x10' }, reason: 'noncanonical' }, outputDir, { closedOrderRegistryPaths: registryPaths })).rejects.toThrow('periodDays must be between 1 and 90');
  });
});
