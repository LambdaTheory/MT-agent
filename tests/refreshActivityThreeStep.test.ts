import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentToolConfirmRequest } from '../src/agentRuntime/approvalCard.js';
import { loadAgentToolConfirmRequestFromValue } from '../src/feishuBot/agentToolConfirmStore.js';
import { executeAgentToolRequest } from '../src/feishuBot/agentToolExecutor.js';
import { handleRefreshActivityStrategySelect } from '../src/feishuBot/refreshActivityStrategySelect.js';
import {
  buildRefreshActivityExecuteConfirmCard,
  buildRefreshActivityStrategyCard,
} from '../src/feishuBot/refreshActivityCard.js';
import { refreshActivityPlanConfirmationKey, saveRefreshActivityPlan, type RefreshActivityPlan } from '../src/feishuBot/refreshActivityPlanStore.js';

type CardElement = {
  name?: string;
  text?: { content?: string };
  behaviors?: Array<{ value?: unknown }>;
  elements?: CardElement[];
};

function collectElements(value: unknown): CardElement[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  const element = value as CardElement;
  return [element, ...(element.elements ?? []).flatMap((child) => collectElements(child))];
}

function readButtonValue(card: unknown, buttonName: string): unknown {
  const body = (card as { body?: { elements?: unknown[] } }).body;
  const elements = (body?.elements ?? []).flatMap((element) => collectElements(element));
  return elements.find((element) => element.name === buttonName)?.behaviors?.[0]?.value;
}

const summary = {
  exposure: 1000,
  publicVisits: 50,
  dashboardVisits: 40,
  createdOrders: 3,
  shippedOrders: 1,
  amount: 88,
  exposureVisitRate: 0.05,
  visitCreatedOrderRate: 0.075,
  visitShipmentRate: 0.025,
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

async function writeRefreshActivityFixtures(): Promise<{ outputDir: string; registryPaths: {
  productIdMapPath: string;
  productNameMapPath: string;
  goodsSnapshotPath: string;
  firstSeenPath: string;
  lifecyclePath: string;
  daemonCatalogPath: string;
  overridesPath: string;
  artifactsDir: string;
} }> {
  const rootDir = await mkdtemp(join(tmpdir(), 'mt-agent-refresh-three-step-'));
  const outputDir = join(rootDir, 'output');
  const configDir = join(rootDir, 'config');
  const stateDir = join(outputDir, 'state');
  await mkdir(join(outputDir, '2026-06-11'), { recursive: true });
  await mkdir(configDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  const zero30d = { ...metric, exposure: 300, publicVisits: 30, dashboardVisits: 20, createdOrders: 0, hasDashboardData: true };
  const active30d = { ...metric, exposure: 600, publicVisits: 80, dashboardVisits: 60, createdOrders: 3, hasDashboardData: true };
  await writeFile(join(outputDir, '2026-06-11', 'report-context.json'), JSON.stringify({
    date: '2026-06-11',
    summary: { '1d': summary, '7d': summary, '30d': summary },
    conclusions: [],
    rows: [
      { productName: 'Pocket3 健康源', platformProductId: 'p900', displayProductId: '端内ID 900', custodyDays: 50, periods: { '1d': metric, '7d': metric, '30d': active30d } },
      { productName: 'Pocket3 零创单 A', platformProductId: 'p901', displayProductId: '端内ID 901', custodyDays: 35, periods: { '1d': metric, '7d': metric, '30d': zero30d } },
      { productName: 'Pocket3 零创单 B', platformProductId: 'p902', displayProductId: '端内ID 902', custodyDays: 40, periods: { '1d': metric, '7d': metric, '30d': zero30d } },
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
  await writeFile(join(configDir, 'product-id-map.json'), JSON.stringify({ p900: '900', p901: '901', p902: '902' }), 'utf8');
  await writeFile(join(configDir, 'product-name-map.json'), JSON.stringify({ '900': 'Pocket3 健康源', '901': 'Pocket3 零创单 A', '902': 'Pocket3 零创单 B' }), 'utf8');
  await writeFile(join(configDir, 'link-registry-overrides.json'), JSON.stringify({
    version: 1,
    entries: [
      { internalProductId: '900', shortName: 'DJI Pocket 3', sameSkuGroupId: 'dji-pocket-3', categoryName: '云台相机', status: 'active' },
      { internalProductId: '901', shortName: 'DJI Pocket 3', sameSkuGroupId: 'dji-pocket-3', categoryName: '云台相机', status: 'active' },
      { internalProductId: '902', shortName: 'DJI Pocket 3', sameSkuGroupId: 'dji-pocket-3', categoryName: '云台相机', status: 'active' },
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

describe('refresh activity three-step cards', () => {
  it('uses intent-only values for strategy buttons', () => {
    const card = buildRefreshActivityStrategyCard({
      date: '2026-07-07',
      planRef: 'refresh_plan_1_deadbeef1234dead',
      confirmationKeyDelistOnly: 'aaaaaaaaaaaaaaaaaaaaaaaa',
      confirmationKeyDelistAndRefill: 'bbbbbbbbbbbbbbbbbbbbbbbb',
      delistCount: 2,
      newLinkCount: 2,
      skippedGroups: [],
    });

    const delistValue = readButtonValue(card, 'refresh_activity_delist_only_submit');
    const refillValue = readButtonValue(card, 'refresh_activity_delist_refill_submit');

    expect(delistValue).toEqual({
      action: 'refresh_activity_strategy_select',
      planRef: 'refresh_plan_1_deadbeef1234dead',
      strategy: 'delist_only',
      confirmationKey: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    });
    expect(refillValue).toEqual({
      action: 'refresh_activity_strategy_select',
      planRef: 'refresh_plan_1_deadbeef1234dead',
      strategy: 'delist_and_refill',
      confirmationKey: 'bbbbbbbbbbbbbbbbbbbbbbbb',
    });
    expect(JSON.stringify(delistValue)).not.toContain('toolName');
    expect(JSON.stringify(delistValue)).not.toContain('arguments');
    expect(JSON.stringify(delistValue)).not.toContain('request');
  });

  it('builds an execute confirmation card that shows delist IDs before confirmation', () => {
    const request: AgentToolConfirmRequest = {
      toolName: 'operations.refreshActivityExecute',
      arguments: {
        date: '2026-07-07',
        delistProductIds: ['683', '686'],
        newLinkItems: [{ keyword: 'DJI Pocket 3', count: 2, sourceProductId: '690', sourceProductName: 'Pocket3 补链源', sameSkuGroupId: 'dji-pocket-3' }],
        strategy: 'delist_and_refill',
      },
      reason: '用户选择活跃度刷新策略：下架候选链接并按同款组补链。',
    };

    const card = buildRefreshActivityExecuteConfirmCard(request, 'agent_tool_1_deadbeef1234dead', {
      delistProductIds: ['683', '686'],
      newLinkSummary: 'R50 补 2 条，源 690 Pocket3 补链源',
      skippedGroups: ['无安全源组'],
    });
    const cardJson = JSON.stringify(card);
    const confirmValue = readButtonValue(card, 'agent_tool_confirm_submit');

    expect(cardJson).toContain('即将下架端内ID：683、686');
    expect(cardJson).toContain('R50 补 2 条，源 690 Pocket3 补链源');
    expect(cardJson).toContain('跳过组：无安全源组');
    expect(cardJson).toContain('确认执行');
    expect(confirmValue).toMatchObject({ action: 'agent_tool_confirm', requestRef: 'agent_tool_1_deadbeef1234dead' });
  });

  it('stores refresh plan and returns a strategy card without an execute request', async () => {
    const { outputDir, registryPaths } = await writeRefreshActivityFixtures();

    const response = await executeAgentToolRequest(
      { toolName: 'operations.refreshActivityPlan', arguments: {}, reason: '测试生成活跃度刷新计划' },
      outputDir,
      { closedOrderRegistryPaths: registryPaths },
    );
    const cardJson = JSON.stringify(response.card);
    const delistValue = readButtonValue(response.card, 'refresh_activity_delist_only_submit');
    const planFiles = await readdir(join(outputDir, 'latest', 'refresh-activity-plans'));

    expect(response.card).toBeDefined();
    expect(cardJson).toContain('refresh_activity_strategy_select');
    expect(cardJson).not.toContain('agent_tool_confirm');
    expect(JSON.stringify(delistValue)).not.toContain('request');
    expect(planFiles).toHaveLength(1);
  });

  it('turns a strategy selection into an execute confirmation card without executing refreshActivityExecute', async () => {
    const { outputDir } = await writeRefreshActivityFixtures();
    const plan: RefreshActivityPlan = {
      date: '2026-06-11',
      delistProductIds: ['901', '902'],
      newLinkItemsForRefill: [{ keyword: 'DJI Pocket 3', count: 2, sourceProductId: '900', sourceProductName: 'Pocket3 健康源', sameSkuGroupId: 'dji-pocket-3' }],
      skippedGroups: [],
      canRefill: true,
    };
    const planRef = await saveRefreshActivityPlan(outputDir, plan);

    const response = await handleRefreshActivityStrategySelect(outputDir, {
      action: 'refresh_activity_strategy_select',
      planRef,
      strategy: 'delist_and_refill',
      confirmationKey: refreshActivityPlanConfirmationKey(plan, 'delist_and_refill'),
    });
    const cardJson = JSON.stringify(response.card);
    const confirmValue = readButtonValue(response.card, 'agent_tool_confirm_submit');
    const request = await loadAgentToolConfirmRequestFromValue(outputDir, confirmValue);

    expect(response.text).toBe('请确认活跃度刷新执行内容。');
    expect(cardJson).toContain('确认执行');
    expect(cardJson).toContain('即将下架端内ID：901、902');
    expect(cardJson).toContain('dji-pocket-3 补 2 条，源 900 Pocket3 健康源');
    expect(request).toMatchObject({
      toolName: 'operations.refreshActivityExecute',
      arguments: {
        date: '2026-06-11',
        delistProductIds: ['901', '902'],
        newLinkItems: plan.newLinkItemsForRefill,
        strategy: 'delist_and_refill',
      },
    });
  });
});
