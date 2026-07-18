import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findAgentTool } from '../src/agentRuntime/toolRegistry.js';
import { executeAgentToolRequest } from '../src/feishuBot/agentToolExecutor.js';
import { loadAgentToolConfirmRequestFromValue } from '../src/feishuBot/agentToolConfirmStore.js';
import { parseBotIntent } from '../src/feishuBot/intent.js';
import { handleBotIntent } from '../src/feishuBot/tools.js';
import { handleInactiveRefreshExecuteSelect } from '../src/feishuBot/inactiveRefreshExecuteSelect.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';
import { inactiveRefreshPlanConfirmationKey, saveInactiveRefreshPlan, type InactiveRefreshPlan } from '../src/operations/inactiveRefresh/planStore.js';

type CardElement = {
  name?: string;
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

async function writeInactiveRefreshFixtures(options: { healthySource?: boolean; staleCandidateCustodyDays?: number | null } = {}): Promise<{ outputDir: string; registryPaths: {
  productIdMapPath: string;
  productNameMapPath: string;
  goodsSnapshotPath: string;
  firstSeenPath: string;
  lifecyclePath: string;
  daemonCatalogPath: string;
  overridesPath: string;
  artifactsDir: string;
} }> {
  const rootDir = await mkdtemp(join(tmpdir(), 'mt-agent-inactive-refresh-'));
  const outputDir = join(rootDir, 'output');
  const configDir = join(rootDir, 'config');
  const stateDir = join(outputDir, 'state');
  const dates = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 6, 4 + index));
    return date.toISOString().slice(0, 10);
  });
  for (const date of dates) await mkdir(join(outputDir, date), { recursive: true });
  await mkdir(configDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  const healthySource = options.healthySource !== false;
  const rows = [
    ...(healthySource ? [
    { productName: 'Pocket3 健康源', platformProductId: 'p900', displayProductId: '端内ID 900', custodyDays: 60, periods: { '1d': { exposure: 800, publicVisits: 90, dashboardVisits: 80, amount: 500, createdOrders: 3, shippedOrders: 1, exposureVisitRate: 0.1125, visitCreatedOrderRate: 0.0375, visitShipmentRate: 0.0125, hasExposureData: true, hasDashboardData: true } } },
    ] : []),
    { productName: 'Pocket3 失活 A', platformProductId: 'p901', displayProductId: '端内ID 901', ...(options.staleCandidateCustodyDays === null ? {} : { custodyDays: options.staleCandidateCustodyDays ?? 45 }), periods: { '1d': { exposure: 20, publicVisits: 1, dashboardVisits: 1, amount: 0, createdOrders: 0, shippedOrders: 0, exposureVisitRate: 0.05, visitCreatedOrderRate: 0, visitShipmentRate: 0, hasExposureData: true, hasDashboardData: true } } },
    { productName: 'Pocket3 新链保护', platformProductId: 'p902', displayProductId: '端内ID 902', custodyDays: 7, periods: { '1d': { exposure: 10, publicVisits: 1, dashboardVisits: 1, amount: 0, createdOrders: 0, shippedOrders: 0, exposureVisitRate: 0.1, visitCreatedOrderRate: 0, visitShipmentRate: 0, hasExposureData: true, hasDashboardData: true } } },
  ];
  for (const date of dates) {
    await writeFile(join(outputDir, date, `公域数据上下文_${date}.json`), JSON.stringify({ date, summary: {}, conclusions: [], rows }), 'utf8');
  }
  await writeFile(join(outputDir, '2026-07-17', 'report-context.json'), JSON.stringify({ date: '2026-07-17', summary: {}, conclusions: [], rows }), 'utf8');
  await writeFile(join(outputDir, '2026-07-17', '同款组经营快照_2026-07-17.json'), JSON.stringify({
    schemaVersion: 1,
    generationId: 'fixture-generation',
    date: '2026-07-17',
    sourceReportDate: '2026-07-17',
    generatedAt: '2026-07-17T00:00:00.000Z',
    groups: [{ sameSkuGroupId: 'dji-pocket-3', groupName: 'Pocket 3', activeLinkCount: 3, productIds: ['900', '901', '902'], periods: {}, mainProductId: '900', coverage: { total: 3, active: 3, missing: 0 } }],
  }), 'utf8');
  await writeFile(join(configDir, 'product-id-map.json'), JSON.stringify({ p900: '900', p901: '901', p902: '902' }), 'utf8');
  await writeFile(join(configDir, 'product-name-map.json'), JSON.stringify({ '900': 'Pocket3 健康源', '901': 'Pocket3 失活 A', '902': 'Pocket3 新链保护' }), 'utf8');
  await writeFile(join(configDir, 'link-registry-overrides.json'), JSON.stringify({
    version: 1,
    entries: [
      ...(healthySource ? [
      { internalProductId: '900', shortName: 'Pocket 3', sameSkuGroupId: 'dji-pocket-3', categoryName: '云台相机', status: 'active' },
      ] : []),
      { internalProductId: '901', shortName: 'Pocket 3', sameSkuGroupId: 'dji-pocket-3', categoryName: '云台相机', status: 'active' },
      { internalProductId: '902', shortName: 'Pocket 3', sameSkuGroupId: 'dji-pocket-3', categoryName: '云台相机', status: 'active' },
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

function fakeRentalClient(events: string[]): RentalPriceSkillClient {
  return {
    async preview() { throw new Error('preview should not run'); },
    async execute() { throw new Error('execute should not run'); },
    async copy(productId) {
      events.push(`copy:${productId}`);
      return { productId, ok: true, newProductId: `new-${productId}`, lines: [`copied ${productId}`], status: 'completed' };
    },
    async delist(productId) {
      events.push(`delist:${productId}`);
      return { productId, ok: true, lines: [`delisted ${productId}`] };
    },
    async tenancySet() { throw new Error('tenancySet should not run'); },
    async specDiscover() { throw new Error('specDiscover should not run'); },
    async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
  };
}

describe('inactive refresh executable workflow', () => {
  it('registers a planner-visible plan tool and hidden execute tool', () => {
    expect(findAgentTool('operations.inactiveRefreshPlan')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('operations.inactiveRefreshExecute')).toMatchObject({ risk: 'high', requiresConfirmation: true, plannerVisible: false });
  });

  it('parses Feishu command and returns a persisted plan card without execute payload', async () => {
    const { outputDir, registryPaths } = await writeInactiveRefreshFixtures();

    expect(parseBotIntent('跑失活刷新')).toEqual({ type: 'run_inactive_refresh', date: undefined });
    const response = await handleBotIntent({ type: 'run_inactive_refresh' }, outputDir, { closedOrderRegistryPaths: registryPaths });
    const cardJson = JSON.stringify(response.card);
    const approveValue = readButtonValue(response.card, 'inactive_refresh_execute_submit');
    const planFiles = await readdir(join(outputDir, 'latest', 'inactive-refresh-plans'));

    expect(response.metadata).toMatchObject({ toolName: 'operations.inactiveRefreshPlan', executableCount: 1 });
    expect(response.card).toBeDefined();
    expect(cardJson).toContain('失活刷新执行计划');
    expect(JSON.stringify(approveValue)).toContain('inactive_refresh_execute_select');
    expect(JSON.stringify(approveValue)).not.toContain('delistProductIds');
    expect(JSON.stringify(approveValue)).not.toContain('newLinkItems');
    expect(planFiles).toHaveLength(1);
  });

  it('rejects tampered execute confirmation keys before any write', async () => {
    const { outputDir } = await writeInactiveRefreshFixtures();
    const plan: InactiveRefreshPlan = {
      date: '2026-07-17',
      delistProductIds: ['901'],
      newLinkItems: [{ keyword: 'Pocket 3', count: 1, sourceProductId: '900', sourceProductName: 'Pocket3 健康源', sameSkuGroupId: 'dji-pocket-3' }],
      skippedGroups: [],
      executableCount: 1,
    };
    const planRef = await saveInactiveRefreshPlan(outputDir, plan);
    const events: string[] = [];

    const response = await executeAgentToolRequest(
      { toolName: 'operations.inactiveRefreshExecute', arguments: { planRef, confirmationKey: 'tampered' }, reason: 'tampered execute' },
      outputDir,
      { rentalPriceClient: fakeRentalClient(events) },
    );

    expect(response.metadata).toMatchObject({ toolName: 'operations.inactiveRefreshExecute', ok: false });
    expect(response.text).toContain('失活刷新计划已失效');
    expect(events).toEqual([]);
  });

  it('rejects invalid plan refs before filesystem path use or writes', async () => {
    const { outputDir } = await writeInactiveRefreshFixtures();
    const events: string[] = [];

    const response = await executeAgentToolRequest(
      { toolName: 'operations.inactiveRefreshExecute', arguments: { planRef: '../evil', confirmationKey: 'anything' }, reason: 'invalid ref execute' },
      outputDir,
      { rentalPriceClient: fakeRentalClient(events) },
    );

    expect(response.metadata).toMatchObject({ toolName: 'operations.inactiveRefreshExecute', ok: false });
    expect(response.text).toContain('失活刷新计划已失效');
    expect(events).toEqual([]);
  });

  it('turns an inactive refresh plan button into a hidden execute confirmation request', async () => {
    const { outputDir } = await writeInactiveRefreshFixtures();
    const plan: InactiveRefreshPlan = {
      date: '2026-07-17',
      delistProductIds: ['901'],
      newLinkItems: [{ keyword: 'Pocket 3', count: 1, sourceProductId: '900', sourceProductName: 'Pocket3 健康源', sameSkuGroupId: 'dji-pocket-3' }],
      skippedGroups: [],
      executableCount: 1,
    };
    const planRef = await saveInactiveRefreshPlan(outputDir, plan);

    const response = await handleInactiveRefreshExecuteSelect(outputDir, {
      action: 'inactive_refresh_execute_select',
      planRef,
      confirmationKey: inactiveRefreshPlanConfirmationKey(plan),
    });
    const confirmValue = readButtonValue(response.card, 'agent_tool_confirm_submit');
    const request = await loadAgentToolConfirmRequestFromValue(outputDir, confirmValue);

    expect(response.text).toBe('请确认失活刷新执行内容。');
    expect(JSON.stringify(response.card)).toContain('agent_tool_confirm');
    expect(request).toMatchObject({
      toolName: 'operations.inactiveRefreshExecute',
      arguments: { planRef, confirmationKey: inactiveRefreshPlanConfirmationKey(plan) },
    });
  });

  it('does not use another stale candidate as the refill safety source', async () => {
    const { outputDir, registryPaths } = await writeInactiveRefreshFixtures({ healthySource: false });

    const response = await handleBotIntent({ type: 'run_inactive_refresh' }, outputDir, { closedOrderRegistryPaths: registryPaths });

    expect(response.metadata).toMatchObject({ toolName: 'operations.inactiveRefreshPlan', executableCount: 0 });
    expect(response.card).toBeUndefined();
    expect(response.text).toContain('没有可执行失活刷新项');
  });

  it('does not execute stale candidates with unknown custody days', async () => {
    const { outputDir, registryPaths } = await writeInactiveRefreshFixtures({ staleCandidateCustodyDays: null });

    const response = await handleBotIntent({ type: 'run_inactive_refresh' }, outputDir, { closedOrderRegistryPaths: registryPaths });

    expect(response.metadata).toMatchObject({ toolName: 'operations.inactiveRefreshPlan', executableCount: 0 });
    expect(response.card).toBeUndefined();
    expect(response.text).toContain('没有可执行失活刷新项');
  });

  it('executes a persisted plan by copying safety source before delisting stale links', async () => {
    const { outputDir } = await writeInactiveRefreshFixtures();
    const plan: InactiveRefreshPlan = {
      date: '2026-07-17',
      delistProductIds: ['901'],
      newLinkItems: [{ keyword: 'Pocket 3', count: 1, sourceProductId: '900', sourceProductName: 'Pocket3 健康源', sameSkuGroupId: 'dji-pocket-3' }],
      skippedGroups: [],
      executableCount: 1,
    };
    const planRef = await saveInactiveRefreshPlan(outputDir, plan);
    const events: string[] = [];

    const response = await executeAgentToolRequest(
      { toolName: 'operations.inactiveRefreshExecute', arguments: { planRef, confirmationKey: inactiveRefreshPlanConfirmationKey(plan) }, reason: 'execute inactive refresh' },
      outputDir,
      { rentalPriceClient: fakeRentalClient(events) },
    );

    expect(events).toEqual(['copy:900', 'delist:901']);
    expect(response.text).toContain('失活刷新执行完成');
    expect(response.metadata).toMatchObject({ toolName: 'operations.inactiveRefreshExecute', ok: true, delistedProductIds: ['901'], newProductIds: ['new-900'] });
  });

  it('copies each planned refill count before delisting stale links', async () => {
    const { outputDir } = await writeInactiveRefreshFixtures();
    const plan: InactiveRefreshPlan = {
      date: '2026-07-17',
      delistProductIds: ['901', '902'],
      newLinkItems: [{ keyword: 'Pocket 3', count: 2, sourceProductId: '900', sourceProductName: 'Pocket3 健康源', sameSkuGroupId: 'dji-pocket-3' }],
      skippedGroups: [],
      executableCount: 2,
    };
    const planRef = await saveInactiveRefreshPlan(outputDir, plan);
    const events: string[] = [];

    const response = await executeAgentToolRequest(
      { toolName: 'operations.inactiveRefreshExecute', arguments: { planRef, confirmationKey: inactiveRefreshPlanConfirmationKey(plan) }, reason: 'execute inactive refresh count' },
      outputDir,
      { rentalPriceClient: fakeRentalClient(events) },
    );

    expect(events).toEqual(['copy:900', 'copy:900', 'delist:901', 'delist:902']);
    expect(response.metadata).toMatchObject({ ok: true, newProductIds: ['new-900', 'new-900'], delistedProductIds: ['901', '902'] });
  });

  it('does not execute the same persisted plan twice', async () => {
    const { outputDir } = await writeInactiveRefreshFixtures();
    const plan: InactiveRefreshPlan = {
      date: '2026-07-17',
      delistProductIds: ['901'],
      newLinkItems: [{ keyword: 'Pocket 3', count: 1, sourceProductId: '900', sourceProductName: 'Pocket3 健康源', sameSkuGroupId: 'dji-pocket-3' }],
      skippedGroups: [],
      executableCount: 1,
    };
    const planRef = await saveInactiveRefreshPlan(outputDir, plan);
    const events: string[] = [];
    const request = { toolName: 'operations.inactiveRefreshExecute', arguments: { planRef, confirmationKey: inactiveRefreshPlanConfirmationKey(plan) }, reason: 'execute inactive refresh once' };

    await executeAgentToolRequest(request, outputDir, { rentalPriceClient: fakeRentalClient(events) });
    const replay = await executeAgentToolRequest(request, outputDir, { rentalPriceClient: fakeRentalClient(events) });

    expect(events).toEqual(['copy:900', 'delist:901']);
    expect(replay.metadata).toMatchObject({ toolName: 'operations.inactiveRefreshExecute', ok: false });
    expect(replay.text).toContain('已执行');
  });

  it('keeps refresh activity strategy buttons free of direct execute payloads', async () => {
    const { outputDir, registryPaths } = await writeInactiveRefreshFixtures();
    const response = await executeAgentToolRequest(
      { toolName: 'operations.refreshActivityPlan', arguments: { conditions: [{ metric: 'amount', operator: 'eq', value: 0 }], windowDays: 1 }, reason: 'adjacent refresh activity plan' },
      outputDir,
      { closedOrderRegistryPaths: registryPaths },
    );
    const cardJson = JSON.stringify(response.card);

    expect(cardJson).toContain('refresh_activity_strategy_select');
    expect(cardJson).not.toContain('agent_tool_confirm');
  });
});
