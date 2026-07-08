import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { rankProductsByCategory } from '../src/agentData/categoryRanking.js';
import { executeAgentToolRequest } from '../src/feishuBot/agentToolExecutor.js';
import { findAgentTool } from '../src/agentRuntime/toolRegistry.js';
import type { PublicTrafficDataReportContext, PublicTrafficPeriodMetrics } from '../src/publicTraffic/types.js';
import type { LinkRegistryEntry } from '../src/linkRegistry/types.js';

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

function row(productName: string, internalId: string, platformProductId: string, shippedOrders: number, amount: number, exposure: number) {
  return {
    productName,
    platformProductId,
    displayProductId: `端内ID ${internalId}`,
    custodyDays: 10,
    periods: {
      '1d': { ...metric },
      '7d': { ...metric },
      '30d': { ...metric, shippedOrders, amount, exposure },
    },
  };
}

function context(): PublicTrafficDataReportContext {
  return {
    date: '2026-07-02',
    summary: { '1d': { ...metric }, '7d': { ...metric }, '30d': { ...metric } },
    conclusions: [],
    rows: [row('A 相机', '101', 'p101', 2, 200, 1000), row('B 相机', '102', 'p102', 5, 150, 800), row('C 手机', '201', 'p201', 8, 300, 1200)],
    lowExposure: [],
    weakClick: [],
    weakConversion: [],
    highPotential: [],
    newProductObservation: [],
    lifecycleGovernance: [],
    recommendedActions: [],
    emptySectionNotes: { lowExposure: '', weakClick: '', weakConversion: '', highPotential: '', newProductObservation: '', lifecycleGovernance: '', recommendedActions: '' },
  };
}

const registry: LinkRegistryEntry[] = [
  { internalProductId: '101', platformProductId: 'p101', productName: 'A 相机', categoryName: '相机', status: 'active', source: ['link_registry_override'] },
  { internalProductId: '102', platformProductId: 'p102', productName: 'B 相机', categoryName: '相机', status: 'active', source: ['link_registry_override'] },
  { internalProductId: '201', platformProductId: 'p201', productName: 'C 手机', categoryName: '手机', status: 'active', source: ['link_registry_override'] },
];

describe('rankProductsByCategory', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('ranks products in a category by 30-day shipped orders', () => {
    const result = rankProductsByCategory(context(), registry, { category: '相机', metric: 'shippedOrders', periodDays: 30, limit: 2 });

    expect(result.items.map((item) => item.internalProductId)).toEqual(['102', '101']);
    expect(result.items[0]).toMatchObject({ category: '相机', value: 5 });
  });

  it('registers and dispatches product.rankByCategory as a read tool', async () => {
    dir = await mkdtemp(join(tmpdir(), 'mt-cat-rank-'));
    const configDir = join(dir, 'config');
    const stateDir = join(dir, 'state');
    await mkdir(join(dir, '2026-07-02'), { recursive: true });
    await mkdir(configDir, { recursive: true });
    await mkdir(stateDir, { recursive: true });
    await writeFile(join(dir, '2026-07-02', 'report-context.json'), JSON.stringify(context()), 'utf8');
    await writeFile(join(configDir, 'product-id-map.json'), JSON.stringify({ p101: '101', p102: '102', p201: '201' }), 'utf8');
    await writeFile(join(configDir, 'product-name-map.json'), JSON.stringify({ '101': 'A 相机', '102': 'B 相机', '201': 'C 手机' }), 'utf8');
    await writeFile(join(configDir, 'link-registry-overrides.json'), JSON.stringify({ version: 1, entries: registry }), 'utf8');

    expect(findAgentTool('product.rankByCategory')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    const response = await executeAgentToolRequest(
      { toolName: 'product.rankByCategory', arguments: { category: '相机', metric: 'shippedOrders', periodDays: 30, limit: 1 }, reason: 'test' },
      dir,
      {
        closedOrderRegistryPaths: {
          productIdMapPath: join(configDir, 'product-id-map.json'),
          productNameMapPath: join(configDir, 'product-name-map.json'),
          goodsSnapshotPath: join(stateDir, 'goods-current-snapshot.json'),
          firstSeenPath: join(stateDir, 'goods-first-seen.json'),
          lifecyclePath: join(stateDir, 'goods-link-lifecycle.json'),
          daemonCatalogPath: join(stateDir, 'link-registry-daemon-catalog.json'),
          overridesPath: join(configDir, 'link-registry-overrides.json'),
          artifactsDir: dir,
        },
      },
    );

    expect(response.text).toContain('B 相机');
    expect(response.text).toContain('发货 5');
  });
});
