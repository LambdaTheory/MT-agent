import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAgentToolConfirmRequest } from '../src/agentRuntime/approvalCard.js';
import { executeAgentToolRequest } from '../src/feishuBot/agentToolExecutor.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';
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

function confirmValues(card: unknown): Array<{ text: string; value: unknown }> {
  const body = (card as { body?: { elements?: Array<{ elements?: Array<{ text?: { content?: string }; behaviors?: Array<{ value?: unknown }> }> }> } }).body;
  const forms = body?.elements?.filter((element) => Array.isArray(element.elements)) ?? [];
  return forms.flatMap((form) => form.elements ?? []).map((element) => ({ text: element.text?.content ?? '', value: element.behaviors?.[0]?.value }));
}

async function writeStrategyFixtures() {
  const rootDir = await mkdtemp(join(tmpdir(), 'mt-agent-refresh-strategy-'));
  const outputDir = join(rootDir, 'output');
  const configDir = join(rootDir, 'config');
  const stateDir = join(outputDir, 'state');
  await mkdir(join(outputDir, '2026-06-11'), { recursive: true });
  await mkdir(configDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });

  const source30d = { ...metric, exposure: 600, publicVisits: 80, dashboardVisits: 60, createdOrders: 3, shippedOrders: 2, amount: 900, hasDashboardData: true };
  const zero30d = { ...metric, exposure: 300, publicVisits: 30, dashboardVisits: 20, createdOrders: 0, amount: 0, hasDashboardData: true };
  await writeFile(join(outputDir, '2026-06-11', 'report-context.json'), JSON.stringify({
    date: '2026-06-11',
    summary: { '1d': metric, '7d': metric, '30d': metric },
    conclusions: [],
    rows: [
      { productName: 'R50 健康源', platformProductId: 'p680', displayProductId: '端内ID 680', custodyDays: 50, periods: { '1d': metric, '7d': source30d, '30d': source30d } },
      { productName: 'R50 零金额', platformProductId: 'p681', displayProductId: '端内ID 681', custodyDays: 45, periods: { '1d': metric, '7d': metric, '30d': zero30d } },
      { productName: 'Pocket 3 blocker', platformProductId: 'p901', displayProductId: '端内ID 901', custodyDays: 45, periods: { '1d': metric, '7d': metric, '30d': zero30d } },
      { productName: 'SQ1 健康源', platformProductId: 'p902', displayProductId: '端内ID 902', custodyDays: 50, periods: { '1d': metric, '7d': source30d, '30d': source30d } },
      { productName: 'SQ1 零金额', platformProductId: 'p903', displayProductId: '端内ID 903', custodyDays: 45, periods: { '1d': metric, '7d': metric, '30d': zero30d } },
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
  await writeFile(join(configDir, 'product-id-map.json'), JSON.stringify({ p680: '680', p681: '681', p901: '901', p902: '902', p903: '903' }), 'utf8');
  await writeFile(join(configDir, 'product-name-map.json'), JSON.stringify({ '680': 'R50 健康源', '681': 'R50 零金额', '901': 'Pocket 3 blocker', '902': 'SQ1 健康源', '903': 'SQ1 零金额' }), 'utf8');
  await writeFile(join(configDir, 'link-registry-overrides.json'), JSON.stringify({
    version: 1,
    entries: [
      { internalProductId: '680', shortName: 'R50', sameSkuGroupId: 'canon-eos-r50', categoryName: '相机', status: 'active' },
      { internalProductId: '681', shortName: 'R50', sameSkuGroupId: 'canon-eos-r50', categoryName: '相机', status: 'active' },
      { internalProductId: '901', shortName: 'Pocket 3', sameSkuGroupId: 'dji-pocket-3', categoryName: '云台相机', status: 'active' },
      { internalProductId: '902', shortName: 'SQ1', sameSkuGroupId: 'instax-sq1', categoryName: '拍立得', status: 'active' },
      { internalProductId: '903', shortName: 'SQ1', sameSkuGroupId: 'instax-sq1', categoryName: '拍立得', status: 'active' },
    ],
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

describe('targeted refresh activity execute strategy', () => {
  it('returns a strategy choice card instead of a direct execute request', async () => {
    const { outputDir, registryPaths } = await writeStrategyFixtures();

    const response = await executeAgentToolRequest(
      { toolName: 'operations.refreshActivityPlan', arguments: { zeroMetric: 'amount' }, reason: 'plan refresh strategy' },
      outputDir,
      { closedOrderRegistryPaths: registryPaths },
    );

    expect(JSON.stringify(response.card)).toContain('只下架');
    expect(JSON.stringify(response.card)).toContain('下架+补链');
    expect(response.metadata?.executeRequest).toBeNull();
  });

  it('builds partial confirmation requests by strategy and skips blocker groups', async () => {
    const { outputDir, registryPaths } = await writeStrategyFixtures();

    const response = await executeAgentToolRequest(
      { toolName: 'operations.refreshActivityPlan', arguments: { zeroMetric: 'amount' }, reason: 'plan refresh strategy' },
      outputDir,
      { closedOrderRegistryPaths: registryPaths },
    );

    const values = confirmValues(response.card);
    const delistOnly = parseAgentToolConfirmRequest(values.find((item) => item.text === '只下架')?.value);
    const refill = parseAgentToolConfirmRequest(values.find((item) => item.text === '下架+补链')?.value);

    expect(delistOnly?.arguments.strategy).toBe('delist_only');
    expect(new Set(delistOnly?.arguments.delistProductIds as string[])).toEqual(new Set(['681', '901', '903']));
    expect(delistOnly?.arguments).not.toHaveProperty('newLinkItems');
    expect(refill?.arguments).toMatchObject({ strategy: 'delist_and_refill', delistProductIds: ['681', '903'] });
    expect(JSON.stringify(refill?.arguments)).not.toContain('901');
    expect(JSON.stringify(refill?.arguments)).toContain('canon-eos-r50');
    expect(JSON.stringify(refill?.arguments)).toContain('instax-sq1');
    expect(response.text).toContain('已跳过 blocker：Pocket 3｜dji-pocket-3');
  });

  it('executes delist_only without triggering new-link copy', async () => {
    const { outputDir } = await writeStrategyFixtures();
    const delisted: string[] = [];
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run'); },
      async execute() { throw new Error('execute should not run'); },
      async copy() { throw new Error('copy should not run'); },
      async delist(productId) {
        delisted.push(productId);
        return { productId, ok: true, lines: [`delisted ${productId}`] };
      },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };

    const response = await executeAgentToolRequest(
      { toolName: 'operations.refreshActivityExecute', arguments: { date: '2026-06-11', delistProductIds: ['681', '901'], strategy: 'delist_only' }, reason: 'execute delist only' },
      outputDir,
      { rentalPriceClient },
    );

    expect(delisted).toEqual(['681', '901']);
    expect(response.text).toContain('补链：策略为只下架，未补链');
    expect(response.metadata?.ok).toBe(true);
  });
});
