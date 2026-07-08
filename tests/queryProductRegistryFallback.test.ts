import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseBotIntent } from '../src/feishuBot/intent.js';
import { handleBotIntent } from '../src/feishuBot/tools.js';
import type { PublicTrafficDataReportContext } from '../src/publicTraffic/types.js';

const summary = {
  exposure: 100,
  publicVisits: 10,
  dashboardVisits: 10,
  createdOrders: 1,
  shippedOrders: 1,
  amount: 88,
  exposureVisitRate: 0.1,
  visitCreatedOrderRate: 0.1,
  visitShipmentRate: 0.1,
};

const metric = {
  exposure: 10,
  publicVisits: 2,
  dashboardVisits: 2,
  createdOrders: 0,
  signedOrders: 0,
  reviewedOrders: 0,
  shippedOrders: 0,
  amount: 0,
  exposureVisitRate: 0.2,
  visitCreatedOrderRate: 0,
  visitShipmentRate: 0,
  hasExposureData: true,
  hasDashboardData: true,
};

const emptySectionNotes = {
  lowExposure: '',
  weakClick: '',
  weakConversion: '',
  highPotential: '',
  newProductObservation: '',
  lifecycleGovernance: '',
  recommendedActions: '',
};

async function writeLatestReportWithoutProduct(productId: string): Promise<{
  outputDir: string;
  goodsSnapshotPath: string;
  productIdMapPath: string;
  productNameMapPath: string;
  firstSeenPath: string;
  lifecyclePath: string;
  daemonCatalogPath: string;
  overridesPath: string;
  artifactsDir: string;
}> {
  const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-query-registry-fallback-'));
  const reportDir = join(outputDir, '2026-06-11');
  const stateDir = join(outputDir, 'state');
  await mkdir(reportDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  const reportContext: PublicTrafficDataReportContext = {
    date: '2026-06-11',
    summary: { '1d': summary, '7d': summary, '30d': summary },
    conclusions: [],
    rows: [
      { productName: '在架商品', platformProductId: 'p565', displayProductId: '端内ID 565', custodyDays: 10, periods: { '1d': metric, '7d': metric, '30d': metric } },
    ],
    lowExposure: [],
    weakClick: [],
    weakConversion: [],
    highPotential: [],
    newProductObservation: [],
    lifecycleGovernance: [],
    recommendedActions: [],
    emptySectionNotes,
  };
  const goodsSnapshotPath = join(stateDir, 'goods-current-snapshot.json');
  const productIdMapPath = join(stateDir, 'product-id-map.json');
  const productNameMapPath = join(stateDir, 'product-name-map.json');
  const firstSeenPath = join(stateDir, 'goods-first-seen.json');
  const lifecyclePath = join(stateDir, 'goods-link-lifecycle.json');
  const daemonCatalogPath = join(stateDir, 'link-registry-daemon-catalog.json');
  const overridesPath = join(stateDir, 'link-registry-overrides.json');
  await writeFile(join(reportDir, 'report-context.json'), JSON.stringify(reportContext), 'utf8');
  await writeFile(productIdMapPath, JSON.stringify({}), 'utf8');
  await writeFile(productNameMapPath, JSON.stringify({}), 'utf8');
  await writeFile(firstSeenPath, JSON.stringify({}), 'utf8');
  await writeFile(lifecyclePath, JSON.stringify(null), 'utf8');
  await writeFile(daemonCatalogPath, JSON.stringify({ generatedAt: '2026-06-11T00:00:00.000Z', count: 0, excludedCount: 0, entries: [] }), 'utf8');
  await writeFile(overridesPath, JSON.stringify(null), 'utf8');
  await writeFile(goodsSnapshotPath, JSON.stringify([
    {
      internalProductId: productId,
      platformProductId: `p${productId}`,
      productName: '已下架相机',
      listingState: 'delisted',
      listingStatusText: '已下架',
      observedAt: '2026-06-11T00:00:00.000Z',
    },
  ]), 'utf8');
  return { outputDir, goodsSnapshotPath, productIdMapPath, productNameMapPath, firstSeenPath, lifecyclePath, daemonCatalogPath, overridesPath, artifactsDir: outputDir };
}

describe('query product registry fallback', () => {
  it('falls back to the link registry for a single numeric id missing from the latest report', async () => {
    const {
      outputDir,
      goodsSnapshotPath,
      productIdMapPath,
      productNameMapPath,
      firstSeenPath,
      lifecyclePath,
      daemonCatalogPath,
      overridesPath,
      artifactsDir,
    } = await writeLatestReportWithoutProduct('956');

    expect(parseBotIntent('查956')).toEqual({ type: 'query_product', keyword: '956' });

    const response = await handleBotIntent({ type: 'query_product', keyword: '956' }, outputDir, {
      closedOrderRegistryPaths: {
        productIdMapPath,
        productNameMapPath,
        goodsSnapshotPath,
        firstSeenPath,
        lifecyclePath,
        daemonCatalogPath,
        overridesPath,
        artifactsDir,
      },
    });

    expect(response.text).toContain('端内ID 956 已下架相机');
    expect(response.text).toContain('状态 已下架（上架后可操作）');
    expect(response.text).not.toContain('没有找到匹配商品');
  });
});
