import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentPlannerProvider } from '../src/agentRuntime/planner.js';
import { findAgentTool } from '../src/agentRuntime/toolRegistry.js';
import { executeAgentToolRequest } from '../src/feishuBot/agentToolExecutor.js';
import { loadAgentToolConfirmRequestFromValue } from '../src/feishuBot/agentToolConfirmStore.js';
import { parseBotIntent } from '../src/feishuBot/intent.js';
import { handleBotIntent } from '../src/feishuBot/tools.js';
import { handleInactiveRefreshExecuteSelect } from '../src/feishuBot/inactiveRefreshExecuteSelect.js';
import type { RentalPriceReadResult, RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';
import type { DaemonCatalogSnapshot } from '../src/linkRegistry/daemonCatalog.js';
import { loadOperationObservations } from '../src/operationObservations/store.js';
import { inactiveRefreshPlanConfirmationKey, loadInactiveRefreshPlan, saveInactiveRefreshPlan, type InactiveRefreshPlan } from '../src/operations/inactiveRefresh/planStore.js';

type CardElement = {
  name?: string;
  behaviors?: Array<{ value?: unknown }>;
  elements?: CardElement[];
};

function collectElements(value: unknown): CardElement[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  const element = value as CardElement;
  return [element, ...Object.values(element).flatMap((child) => {
    if (Array.isArray(child)) return child.flatMap((item) => collectElements(item));
    return collectElements(child);
  })];
}

function collectElementsByTag(card: unknown, tag: string): CardElement[] {
  const body = (card as { body?: { elements?: unknown[] } }).body;
  return (body?.elements ?? []).flatMap((element) => collectElements(element)).filter((element) => (element as { tag?: string }).tag === tag);
}

function readButtonValue(card: unknown, buttonName: string): unknown {
  const body = (card as { body?: { elements?: unknown[] } }).body;
  const elements = (body?.elements ?? []).flatMap((element) => collectElements(element));
  return elements.find((element) => element.name === buttonName)?.behaviors?.[0]?.value;
}

function daemonCatalogSnapshot(entries: DaemonCatalogSnapshot['entries']): DaemonCatalogSnapshot {
  return {
    generatedAt: '2026-07-17T08:00:00.000Z',
    count: entries.length,
    excludedCount: 0,
    entries,
  };
}

function currentDaemonCatalog(options: { includeHealthySource?: boolean; delistedProductIds?: string[]; omittedProductIds?: string[] } = {}): DaemonCatalogSnapshot {
  const delisted = new Set(options.delistedProductIds ?? []);
  const omitted = new Set(options.omittedProductIds ?? []);
  return daemonCatalogSnapshot(([
    ...(options.includeHealthySource === false ? [] : [{ internalProductId: '900', productName: 'Pocket3 健康源', syncStatus: delisted.has('900') ? '已下架' : '可售卖', discoveredAt: '2026-07-17T08:00:00.000Z' }]),
    { internalProductId: '901', productName: 'Pocket3 失活 A', syncStatus: delisted.has('901') ? '已下架' : '可售卖', discoveredAt: '2026-07-17T08:00:00.000Z' },
    { internalProductId: '902', productName: 'Pocket3 新链保护', syncStatus: delisted.has('902') ? '已下架' : '可售卖', discoveredAt: '2026-07-17T08:00:00.000Z' },
  ]).filter((entry) => !omitted.has(entry.internalProductId)));
}

function inactiveRefreshOptions(registryPaths: Awaited<ReturnType<typeof writeInactiveRefreshFixtures>>['registryPaths'], snapshot = currentDaemonCatalog()): { closedOrderRegistryPaths: typeof registryPaths; daemonCatalogFetcher: () => Promise<DaemonCatalogSnapshot> } {
  return {
    closedOrderRegistryPaths: registryPaths,
    daemonCatalogFetcher: async () => snapshot,
  };
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
    async read(productId): Promise<RentalPriceReadResult> {
      return { productId, ok: true, specs: [{ specId: 'default', title: '默认规格' }], values: { default: { rent1day: '100' } }, lines: [`read ${productId}`] };
    },
    async copy(productId) {
      events.push(`copy:${productId}`);
      return { productId, ok: true, newProductId: `1${productId}`, lines: [`copied ${productId}`], status: 'completed' };
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

function fakeCopyWithoutNewProductIdClient(events: string[]): RentalPriceSkillClient {
  return {
    async preview() { throw new Error('preview should not run'); },
    async execute() { throw new Error('execute should not run'); },
    async read(productId): Promise<RentalPriceReadResult> {
      return { productId, ok: true, specs: [{ specId: 'default', title: '默认规格' }], values: { default: { rent1day: '100' } }, lines: [`read ${productId}`] };
    },
    async copy(productId) {
      events.push(`copy:${productId}`);
      return { productId, ok: true, newProductId: null, lines: [`copied ${productId} without new id`], status: 'completed' };
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

function fakeNumericNewLinkRentalClient(events: string[], newProductId: string): RentalPriceSkillClient {
  return {
    ...fakeRentalClient(events),
    async copy(productId) {
      events.push(`copy:${productId}`);
      return { productId, ok: true, newProductId, lines: [`copied ${productId}`], status: 'completed' };
    },
  };
}

function fakeInvalidNewLinkRentalClient(events: string[]): RentalPriceSkillClient {
  return {
    ...fakeRentalClient(events),
    async copy(productId) {
      events.push(`copy:${productId}`);
      return { productId, ok: true, newProductId: `new-${productId}`, lines: [`copied ${productId}`], status: 'completed' };
    },
  };
}

function fakeReadFailureClient(events: string[], failingProductId: string, mode: 'not-ok' | 'empty' | 'throw' = 'not-ok'): RentalPriceSkillClient {
  return {
    async preview() { throw new Error('preview should not run'); },
    async execute() { throw new Error('execute should not run'); },
    async read(productId): Promise<RentalPriceReadResult> {
      events.push(`read:${productId}`);
      if (productId === failingProductId && mode === 'throw') throw new Error(`read failed ${productId}`);
      if (productId === failingProductId && mode === 'empty') return { productId, ok: true, specs: [], values: {}, lines: [`empty ${productId}`] };
      if (productId === failingProductId) return { productId, ok: false, specs: [], values: {}, lines: [`not ok ${productId}`] };
      return { productId, ok: true, specs: [{ specId: 'default', title: '默认规格' }], values: { default: { rent1day: '100' } }, lines: [`read ${productId}`] };
    },
    async copy(productId) {
      events.push(`copy:${productId}`);
      return { productId, ok: true, newProductId: `1${productId}`, lines: [`copied ${productId}`], status: 'completed' };
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

function fakeClientWithoutRead(events: string[]): RentalPriceSkillClient {
  return {
    async preview() { throw new Error('preview should not run'); },
    async execute() { throw new Error('execute should not run'); },
    async copy(productId: string) {
      events.push(`copy:${productId}`);
      return { productId, ok: true, newProductId: `new-${productId}`, lines: [`copied ${productId}`], status: 'completed' };
    },
    async delist(productId: string) {
      events.push(`delist:${productId}`);
      return { productId, ok: true, lines: [`delisted ${productId}`] };
    },
    async tenancySet() { throw new Error('tenancySet should not run'); },
    async specDiscover() { throw new Error('specDiscover should not run'); },
    async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
  } as RentalPriceSkillClient;
}

describe('inactive refresh executable workflow', () => {
  it('registers a planner-visible plan tool and hidden execute tool', () => {
    expect(findAgentTool('operations.inactiveRefreshPlan')).toMatchObject({ risk: 'read', requiresConfirmation: false });
    expect(findAgentTool('operations.inactiveRefreshExecute')).toMatchObject({ risk: 'high', requiresConfirmation: true, plannerVisible: false });
  });

  it('parses Feishu command and returns a persisted plan card without execute payload', async () => {
    const { outputDir, registryPaths } = await writeInactiveRefreshFixtures();

    expect(parseBotIntent('跑失活刷新')).toEqual({ type: 'run_inactive_refresh', date: undefined });
    const response = await handleBotIntent({ type: 'run_inactive_refresh' }, outputDir, inactiveRefreshOptions(registryPaths));
    const cardJson = JSON.stringify(response.card);
    const approveValue = readButtonValue(response.card, 'inactive_refresh_execute_submit');
    const cancelValue = readButtonValue(response.card, 'inactive_refresh_execute_cancel_submit');
    const chart = collectElementsByTag(response.card, 'chart')[0] as { element_id?: string; chart_spec?: { type?: string; title?: { text?: string }; valueField?: string; categoryField?: string } } | undefined;
    const panels = collectElementsByTag(response.card, 'collapsible_panel') as Array<{ element_id?: string; expanded?: boolean }>;
    const planFiles = await readdir(join(outputDir, 'latest', 'inactive-refresh-plans'));

    expect(response.metadata).toMatchObject({ toolName: 'operations.inactiveRefreshPlan', executableCount: 1 });
    expect(response.card).toBeDefined();
    expect(cardJson).toContain('失活刷新执行计划');
    expect(cardJson).toContain('审批摘要');
    expect(cardJson).toContain('本次只审批下架补链 **1** 条');
    expect(cardJson).toContain('修改 Diff 摘要');
    expect(chart).toMatchObject({
      element_id: 'inactive_refresh_group_modification_ratio_chart',
      chart_spec: { type: 'pie', valueField: 'value', categoryField: 'label' },
    });
    expect(chart?.chart_spec?.title?.text).toContain('本次下架补链商品占比（共 1 条）');
    expect(cardJson).toContain('dji-pocket-3');
    expect(panels).toHaveLength(4);
    expect(panels.every((panel) => panel.expanded === false)).toBe(true);
    expect(cardJson).toContain('展开：补链商品组');
    expect(cardJson).toContain('展开：判定证据');
    expect(cardJson).toContain('展开：数据异常/未执行原因');
    expect(cardJson).toContain('展开：固定规则与审计口径');
    expect(cardJson).toContain('可执行链接判定');
    expect(cardJson).toContain('901 Pocket 3');
    expect(cardJson).toContain('上线 45天');
    expect(cardJson).toContain('曝光 280');
    expect(cardJson).toContain('日均曝光 20');
    expect(cardJson).toContain('访问 14');
    expect(cardJson).toContain('金额 0');
    expect(cardJson).toContain('上线满 14 天');
    expect(cardJson).toContain('补链来源');
    expect(cardJson).toContain('安全源 900 Pocket 3');
    expect(cardJson).toContain('金额 7000');
    expect(cardJson).toContain('同款组上限');
    expect(cardJson).toContain('active 3');
    expect(cardJson).toContain('本组上限 1');
    expect(cardJson).toContain('排除样例');
    expect(cardJson).toContain('902 Pocket 3');
    expect(cardJson).toContain('不满 14 天新链保护');
    expect(cardJson).not.toContain('daily_mission_inactive_refresh_preview_noop');
    expect(cardJson).not.toContain('批准可执行项');
    expect(cardJson).not.toContain('仅低风险');
    expect(cardJson).not.toContain('转人工复核');
    expect(cardJson).not.toContain('拒绝本次计划');
    expect(cardJson).not.toContain('Daily Mission');
    expect(cardJson).not.toContain('Run ');
    expect(Object.keys(approveValue as Record<string, unknown>).sort()).toEqual(['action', 'confirmationKey', 'planRef']);
    expect(Object.keys(cancelValue as Record<string, unknown>).sort()).toEqual(['action', 'confirmationKey', 'planRef']);
    expect(JSON.stringify(approveValue)).toContain('inactive_refresh_execute_select');
    expect(JSON.stringify(cancelValue)).toContain('inactive_refresh_execute_cancel');
    expect(JSON.stringify(approveValue)).not.toContain('delistProductIds');
    expect(JSON.stringify(approveValue)).not.toContain('newLinkItems');
    expect(JSON.stringify(cancelValue)).not.toContain('delistProductIds');
    expect(JSON.stringify(cancelValue)).not.toContain('newLinkItems');
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

  it('keeps evidence-bearing plan keys valid after persistence', async () => {
    const { outputDir } = await writeInactiveRefreshFixtures();
    const plan: InactiveRefreshPlan = {
      date: '2026-07-17',
      delistProductIds: ['901'],
      newLinkItems: [{ keyword: 'Pocket 3', count: 1, sourceProductId: '900', sourceProductName: 'Pocket3 健康源', sameSkuGroupId: 'dji-pocket-3' }],
      skippedGroups: [],
      executableCount: 1,
      evidence: {
        executableLinks: [{
          productId: '901',
          productName: 'Pocket 3',
          groupId: 'dji-pocket-3',
          decision: 'executable',
          reason: 'fixture evidence',
          metrics: { daysCovered: 14, dashboardDaysCovered: 14, custodyDays: 45, exposure14d: 280, avgExposure14d: 20, visits14d: 14, visitRate: 0.05, amount14d: 0, dashboardAmount14d: 0, missingDashboardDays: 0 },
        }],
        manualReviewLinks: [],
        excludedLinks: [],
        groups: [{
          groupId: 'dji-pocket-3',
          activeCount: 3,
          limit: 1,
          selectedProductIds: ['901'],
          limitExcludedProductIds: [],
          source: {
            productId: '900',
            productName: 'Pocket 3',
            groupId: 'dji-pocket-3',
            reason: 'healthy source',
            metrics: { daysCovered: 14, dashboardDaysCovered: 14, custodyDays: 60, exposure14d: 11200, avgExposure14d: 800, visits14d: 1120, visitRate: 0.1, amount14d: 7000, dashboardAmount14d: 7000, missingDashboardDays: 0 },
          },
        }],
      },
    };
    const planRef = await saveInactiveRefreshPlan(outputDir, plan);
    const loadedPlan = await loadInactiveRefreshPlan(outputDir, planRef);

    const response = await handleInactiveRefreshExecuteSelect(outputDir, {
      action: 'inactive_refresh_execute_select',
      planRef,
      confirmationKey: inactiveRefreshPlanConfirmationKey(plan),
    });

    expect(loadedPlan?.evidence?.executableLinks[0]?.metrics.exposure14d).toBe(280);
    expect(response.text).toBe('请确认失活刷新执行内容。');
    expect(JSON.stringify(response.card)).toContain('agent_tool_confirm');
  });

  it('uses the stale candidate itself as a fallback refill source when no healthy source exists', async () => {
    const { outputDir, registryPaths } = await writeInactiveRefreshFixtures({ healthySource: false });

    const response = await handleBotIntent({ type: 'run_inactive_refresh' }, outputDir, inactiveRefreshOptions(registryPaths, currentDaemonCatalog({ includeHealthySource: false })));
    const cardJson = JSON.stringify(response.card);

    expect(response.metadata).toMatchObject({ toolName: 'operations.inactiveRefreshPlan', executableCount: 1 });
    expect(response.card).toBeDefined();
    expect(cardJson).toContain('自复制源 901 Pocket 3');
    expect(cardJson).toContain('补链源 自复制');
  });

  it('does not duplicate-copy old links from a failed inactive refresh audit with copied new links', async () => {
    const { outputDir, registryPaths } = await writeInactiveRefreshFixtures({ healthySource: false });
    await mkdir(join(outputDir, 'latest', 'inactive-refresh-audits'), { recursive: true });
    await writeFile(join(outputDir, 'latest', 'inactive-refresh-audits', 'inactive_refresh_1_partial.json'), JSON.stringify({
      ok: false,
      plan: { delistProductIds: ['901'] },
      copyResults: [{ productId: '901', ok: true, newProductId: '1901' }],
      delistResults: [{ productId: '901', ok: false, message: 'Delist confirmation dialog was not confirmed' }],
    }), 'utf8');

    const response = await handleBotIntent({ type: 'run_inactive_refresh' }, outputDir, inactiveRefreshOptions(registryPaths, currentDaemonCatalog({ includeHealthySource: false })));

    expect(response.metadata).toMatchObject({ toolName: 'operations.inactiveRefreshPlan', executableCount: 0 });
    expect(response.card).toBeUndefined();
    expect(response.text).toContain('没有可执行失活刷新项');
  });

  it('does not execute stale candidates with unknown custody days', async () => {
    const { outputDir, registryPaths } = await writeInactiveRefreshFixtures({ staleCandidateCustodyDays: null });

    const response = await handleBotIntent({ type: 'run_inactive_refresh' }, outputDir, inactiveRefreshOptions(registryPaths));

    expect(response.metadata).toMatchObject({ toolName: 'operations.inactiveRefreshPlan', executableCount: 0 });
    expect(response.card).toBeUndefined();
    expect(response.text).toContain('没有可执行失活刷新项');
  });

  it('refreshes daemon catalog before inactive refresh planning instead of using a stale snapshot', async () => {
    const { outputDir, registryPaths } = await writeInactiveRefreshFixtures();
    await writeFile(registryPaths.daemonCatalogPath, JSON.stringify(currentDaemonCatalog()), 'utf8');

    const response = await handleBotIntent(
      { type: 'run_inactive_refresh' },
      outputDir,
      inactiveRefreshOptions(registryPaths, currentDaemonCatalog({ delistedProductIds: ['901'] })),
    );
    const refreshedCatalog = await readFile(registryPaths.daemonCatalogPath, 'utf8');

    expect(response.metadata).toMatchObject({ toolName: 'operations.inactiveRefreshPlan', executableCount: 0 });
    expect(response.card).toBeUndefined();
    expect(response.text).toContain('没有可执行失活刷新项');
    expect(refreshedCatalog).toContain('已下架');
  });

  it('excludes inactive refresh candidates omitted from the fresh daemon catalog', async () => {
    const { outputDir, registryPaths } = await writeInactiveRefreshFixtures();
    await writeFile(registryPaths.daemonCatalogPath, JSON.stringify(currentDaemonCatalog()), 'utf8');

    const response = await handleBotIntent(
      { type: 'run_inactive_refresh' },
      outputDir,
      inactiveRefreshOptions(registryPaths, currentDaemonCatalog({ omittedProductIds: ['901'] })),
    );

    expect(response.metadata).toMatchObject({ toolName: 'operations.inactiveRefreshPlan', executableCount: 0 });
    expect(response.card).toBeUndefined();
    expect(response.text).toContain('没有可执行失活刷新项');
  });

  it('fails closed when inactive refresh cannot refresh the daemon catalog', async () => {
    const { outputDir, registryPaths } = await writeInactiveRefreshFixtures();
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (message?: unknown) => { warnings.push(String(message)); };

    try {
      const response = await handleBotIntent(
        { type: 'run_inactive_refresh' },
        outputDir,
        {
          closedOrderRegistryPaths: registryPaths,
          daemonCatalogFetcher: async () => { throw new Error('daemon offline token=secret-token'); },
        },
      );

      expect(response.metadata).toMatchObject({ toolName: 'operations.inactiveRefreshPlan', ok: false, reason: 'daemon_catalog_refresh_failed' });
      expect(response.card).toBeUndefined();
      expect(response.text).toContain('daemon 链接目录刷新失败');
      expect(response.text).toContain('本次未生成计划');
      expect(response.text).not.toContain('secret-token');
      expect(warnings.join('\n')).not.toContain('secret-token');
      expect(warnings.join('\n')).toContain('token=[REDACTED]');
    } finally {
      console.warn = originalWarn;
    }
  });

  it('passes daemon catalog fetcher through multi-step inactive refresh planning', async () => {
    const { outputDir, registryPaths } = await writeInactiveRefreshFixtures();
    let daemonFetches = 0;
    const planner: AgentPlannerProvider = {
      async proposePlan() {
        return JSON.stringify({
          goal: '生成失活刷新计划',
          steps: [
            { toolName: 'operations.inactiveRefreshPlan', arguments: {}, reason: '先刷新 daemon 并生成失活刷新计划' },
            { toolName: 'productId.lookupCard', arguments: {}, reason: '再打开查询卡' },
          ],
          confidence: 0.9,
          reason: '用户要求跑失活刷新',
        });
      },
    };

    const response = await handleBotIntent(
      { type: 'unknown', text: '做一次运营计划检查' },
      outputDir,
      {
        agentPlannerProvider: planner,
        closedOrderRegistryPaths: registryPaths,
        daemonCatalogFetcher: async () => {
          daemonFetches += 1;
          return currentDaemonCatalog({ delistedProductIds: ['901'] });
        },
      },
    );

    expect(daemonFetches).toBe(1);
    expect(response.text).toContain('没有可执行失活刷新项');
    expect(response.text).toContain('步骤 1/2：operations.inactiveRefreshPlan');
  });

  it('excludes recently refreshed old links from the next inactive refresh plan', async () => {
    const { outputDir, registryPaths } = await writeInactiveRefreshFixtures();
    await mkdir(join(outputDir, 'latest'), { recursive: true });
    await writeFile(join(outputDir, 'latest', 'operation-observations.json'), JSON.stringify({
      version: 1,
      observations: [{
        observationId: 'opobs_inactive_refresh_fixture',
        operationType: 'inactive_refresh',
        status: 'observing',
        createdAt: '2026-07-17T00:00:00.000Z',
        observeUntil: '2099-01-01T00:00:00.000Z',
        source: { toolName: 'operations.inactiveRefreshExecute', planRef: 'inactive_refresh_1_aaaaaaaaaaaaaaaa' },
        subjects: [{ role: 'delisted_old_link', productId: '901', relatedProductId: 'new-900', sourceProductId: '900' }],
        metricsToWatch: ['exposure', 'visits', 'orders', 'amount'],
      }],
    }), 'utf8');

    const response = await handleBotIntent({ type: 'run_inactive_refresh' }, outputDir, inactiveRefreshOptions(registryPaths));

    expect(response.metadata).toMatchObject({ toolName: 'operations.inactiveRefreshPlan', executableCount: 0 });
    expect(response.card).toBeUndefined();
    expect(response.text).toContain('没有可执行失活刷新项');
  });

  it('allows expired inactive refresh observations to enter a new plan', async () => {
    const { outputDir, registryPaths } = await writeInactiveRefreshFixtures();
    await mkdir(join(outputDir, 'latest'), { recursive: true });
    await writeFile(join(outputDir, 'latest', 'operation-observations.json'), JSON.stringify({
      version: 1,
      observations: [{
        observationId: 'opobs_inactive_refresh_expired_fixture',
        operationType: 'inactive_refresh',
        status: 'observing',
        createdAt: '2000-01-01T00:00:00.000Z',
        observeUntil: '2000-01-15T00:00:00.000Z',
        source: { toolName: 'operations.inactiveRefreshExecute', planRef: 'inactive_refresh_1_bbbbbbbbbbbbbbbb' },
        subjects: [{ role: 'delisted_old_link', productId: '901', relatedProductId: 'new-900', sourceProductId: '900' }],
        metricsToWatch: ['exposure', 'visits', 'orders', 'amount'],
      }],
    }), 'utf8');

    const response = await handleBotIntent({ type: 'run_inactive_refresh' }, outputDir, inactiveRefreshOptions(registryPaths));

    expect(response.metadata).toMatchObject({ toolName: 'operations.inactiveRefreshPlan', executableCount: 1 });
    expect(response.card).toBeDefined();
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
    expect(response.metadata).toMatchObject({ toolName: 'operations.inactiveRefreshExecute', ok: true, delistedProductIds: ['901'], newProductIds: ['1900'] });
  });

  it('records an inactive_refresh operation observation for successful executions', async () => {
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
    const store = await loadOperationObservations(outputDir);

    expect(response.metadata).toMatchObject({ toolName: 'operations.inactiveRefreshExecute', ok: true, newProductIds: ['1900'], delistedProductIds: ['901'] });
    expect(store.observations).toHaveLength(1);
    expect(store.observations[0]).toMatchObject({
      operationType: 'inactive_refresh',
      status: 'observing',
      source: { toolName: 'operations.inactiveRefreshExecute', planRef },
      subjects: [
        { role: 'new_link', productId: '1900', relatedProductId: '901', sourceProductId: '900' },
        { role: 'delisted_old_link', productId: '901', relatedProductId: '1900', sourceProductId: '900' },
      ],
      metricsToWatch: ['exposure', 'visits', 'orders', 'amount'],
    });
    expect(store.observations[0]?.source.auditPath).toContain(`${planRef}.json`);
    expect(Date.parse(store.observations[0]!.observeUntil) - Date.parse(store.observations[0]!.createdAt)).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it('writes successful inactive refresh state back to link registry overrides immediately', async () => {
    const { outputDir, registryPaths } = await writeInactiveRefreshFixtures();
    const plan: InactiveRefreshPlan = {
      date: '2026-07-17',
      delistProductIds: ['901'],
      newLinkItems: [{ keyword: 'Pocket 3', count: 1, sourceProductId: '900', sourceProductName: 'Pocket3 健康源', sameSkuGroupId: 'dji-pocket-3' }],
      skippedGroups: [],
      executableCount: 1,
    };
    const planRef = await saveInactiveRefreshPlan(outputDir, plan);
    const events: string[] = [];

    await executeAgentToolRequest(
      { toolName: 'operations.inactiveRefreshExecute', arguments: { planRef, confirmationKey: inactiveRefreshPlanConfirmationKey(plan) }, reason: 'execute inactive refresh' },
      outputDir,
      { rentalPriceClient: fakeNumericNewLinkRentalClient(events, '1001'), closedOrderRegistryPaths: registryPaths },
    );
    const overrides = JSON.parse(await readFile(registryPaths.overridesPath, 'utf8')) as { entries: Array<Record<string, unknown>> };

    expect(overrides.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ internalProductId: '901', status: 'removed', listingState: 'delisted', reason: 'inactive_refresh_success', updatedAt: '2026-07-17' }),
      expect.objectContaining({ internalProductId: '1001', productName: 'Pocket3 健康源', shortName: 'Pocket 3', sameSkuGroupId: 'dji-pocket-3', status: 'active', listingState: 'on_sale', reason: 'inactive_refresh_success', updatedAt: '2026-07-17' }),
    ]));
  });

  it('uses the default sibling config override path for inactive refresh registry writeback', async () => {
    const { outputDir } = await writeInactiveRefreshFixtures();
    const plan: InactiveRefreshPlan = {
      date: '2026-07-17',
      delistProductIds: ['901'],
      newLinkItems: [{ keyword: 'Pocket 3', count: 1, sourceProductId: '900', sourceProductName: 'Pocket3 健康源', sameSkuGroupId: 'dji-pocket-3' }],
      skippedGroups: [],
      executableCount: 1,
    };
    const planRef = await saveInactiveRefreshPlan(outputDir, plan);

    await executeAgentToolRequest(
      { toolName: 'operations.inactiveRefreshExecute', arguments: { planRef, confirmationKey: inactiveRefreshPlanConfirmationKey(plan) }, reason: 'execute inactive refresh' },
      outputDir,
      { rentalPriceClient: fakeNumericNewLinkRentalClient([], '1001') },
    );
    const overrides = JSON.parse(await readFile(join(outputDir, '..', 'config', 'link-registry-overrides.json'), 'utf8')) as { entries: Array<Record<string, unknown>> };

    expect(overrides.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ internalProductId: '901', status: 'removed', listingState: 'delisted' }),
      expect.objectContaining({ internalProductId: '1001', productName: 'Pocket3 健康源', sameSkuGroupId: 'dji-pocket-3', status: 'active', listingState: 'on_sale' }),
    ]));
  });

  it('keeps successful inactive refresh responses when operation observation storage is corrupt', async () => {
    const { outputDir } = await writeInactiveRefreshFixtures();
    await mkdir(join(outputDir, 'latest'), { recursive: true });
    await writeFile(join(outputDir, 'latest', 'operation-observations.json'), '{bad json', 'utf8');
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
      { toolName: 'operations.inactiveRefreshExecute', arguments: { planRef, confirmationKey: inactiveRefreshPlanConfirmationKey(plan) }, reason: 'execute inactive refresh with corrupt observation store' },
      outputDir,
      { rentalPriceClient: fakeRentalClient(events) },
    );

    expect(events).toEqual(['copy:900', 'delist:901']);
    expect(response.metadata).toMatchObject({ toolName: 'operations.inactiveRefreshExecute', ok: true, newProductIds: ['1900'], delistedProductIds: ['901'] });
    expect(response.text).toContain('失活刷新执行完成');
  });

  it('stops before delisting when copy reports success without a new product id', async () => {
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
      { toolName: 'operations.inactiveRefreshExecute', arguments: { planRef, confirmationKey: inactiveRefreshPlanConfirmationKey(plan) }, reason: 'execute inactive refresh without new id' },
      outputDir,
      { rentalPriceClient: fakeCopyWithoutNewProductIdClient(events) },
    );
    const store = await loadOperationObservations(outputDir);

    expect(events).toEqual(['copy:900']);
    expect(response.metadata).toMatchObject({ toolName: 'operations.inactiveRefreshExecute', ok: false, newProductIds: [], delistedProductIds: [] });
    expect(response.text).toContain('复制未返回新链接 ID');
    expect(store.observations).toEqual([]);
    await expect(readFile(join(outputDir, '..', 'config', 'link-registry-overrides.json'), 'utf8')).resolves.not.toContain('new-900');
  });

  it('stops before delisting when copy returns a non-registry product id', async () => {
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
      { toolName: 'operations.inactiveRefreshExecute', arguments: { planRef, confirmationKey: inactiveRefreshPlanConfirmationKey(plan) }, reason: 'execute inactive refresh with invalid new id' },
      outputDir,
      { rentalPriceClient: fakeInvalidNewLinkRentalClient(events) },
    );
    const store = await loadOperationObservations(outputDir);

    expect(events).toEqual(['copy:900']);
    expect(response.metadata).toMatchObject({ toolName: 'operations.inactiveRefreshExecute', ok: false, newProductIds: [], delistedProductIds: [] });
    expect(response.text).toContain('新链接 ID 无效');
    expect(store.observations).toEqual([]);
    await expect(readFile(join(outputDir, '..', 'config', 'link-registry-overrides.json'), 'utf8')).resolves.not.toContain('new-900');
  });

  it('stops before copy or delist when inactive refresh preflight reads are unavailable', async () => {
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
      { toolName: 'operations.inactiveRefreshExecute', arguments: { planRef, confirmationKey: inactiveRefreshPlanConfirmationKey(plan) }, reason: 'execute inactive refresh without read' },
      outputDir,
      { rentalPriceClient: fakeClientWithoutRead(events) },
    );

    expect(events).toEqual([]);
    expect(response.metadata).toMatchObject({ toolName: 'operations.inactiveRefreshExecute', ok: false, newProductIds: [], delistedProductIds: [] });
    expect(response.text).toContain('执行前校验失败');
  });

  it('stops before copy or delist when the refill source preflight read fails', async () => {
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
      { toolName: 'operations.inactiveRefreshExecute', arguments: { planRef, confirmationKey: inactiveRefreshPlanConfirmationKey(plan) }, reason: 'execute inactive refresh with stale source' },
      outputDir,
      { rentalPriceClient: fakeReadFailureClient(events, '900') },
    );

    expect(events).toEqual(['read:900']);
    expect(response.metadata).toMatchObject({ toolName: 'operations.inactiveRefreshExecute', ok: false, newProductIds: [], delistedProductIds: [] });
    expect(response.text).toContain('补链源 900');
    expect(response.text).toContain('执行前校验失败');
  });

  it('stops before copy or delist when a target delist preflight read fails', async () => {
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
      { toolName: 'operations.inactiveRefreshExecute', arguments: { planRef, confirmationKey: inactiveRefreshPlanConfirmationKey(plan) }, reason: 'execute inactive refresh with stale target' },
      outputDir,
      { rentalPriceClient: fakeReadFailureClient(events, '901') },
    );

    expect(events).toEqual(['read:900', 'read:901']);
    expect(response.metadata).toMatchObject({ toolName: 'operations.inactiveRefreshExecute', ok: false, newProductIds: [], delistedProductIds: [] });
    expect(response.text).toContain('待下架链接 901');
    expect(response.text).toContain('执行前校验失败');
  });

  it('stops before copy or delist when preflight reads return an empty current shape', async () => {
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
      { toolName: 'operations.inactiveRefreshExecute', arguments: { planRef, confirmationKey: inactiveRefreshPlanConfirmationKey(plan) }, reason: 'execute inactive refresh with empty read' },
      outputDir,
      { rentalPriceClient: fakeReadFailureClient(events, '900', 'empty') },
    );

    expect(events).toEqual(['read:900']);
    expect(response.metadata).toMatchObject({ toolName: 'operations.inactiveRefreshExecute', ok: false, newProductIds: [], delistedProductIds: [] });
    expect(response.text).toContain('执行前校验失败');
  });

  it('does not consume the execution lock when preflight fails before writes', async () => {
    const { outputDir } = await writeInactiveRefreshFixtures();
    const plan: InactiveRefreshPlan = {
      date: '2026-07-17',
      delistProductIds: ['901'],
      newLinkItems: [{ keyword: 'Pocket 3', count: 1, sourceProductId: '900', sourceProductName: 'Pocket3 健康源', sameSkuGroupId: 'dji-pocket-3' }],
      skippedGroups: [],
      executableCount: 1,
    };
    const planRef = await saveInactiveRefreshPlan(outputDir, plan);
    const failedEvents: string[] = [];
    const retryEvents: string[] = [];

    const failed = await executeAgentToolRequest(
      { toolName: 'operations.inactiveRefreshExecute', arguments: { planRef, confirmationKey: inactiveRefreshPlanConfirmationKey(plan) }, reason: 'execute inactive refresh transient preflight failure' },
      outputDir,
      { rentalPriceClient: fakeReadFailureClient(failedEvents, '900') },
    );
    const retry = await executeAgentToolRequest(
      { toolName: 'operations.inactiveRefreshExecute', arguments: { planRef, confirmationKey: inactiveRefreshPlanConfirmationKey(plan) }, reason: 'retry inactive refresh after preflight recovers' },
      outputDir,
      { rentalPriceClient: fakeRentalClient(retryEvents) },
    );

    expect(failed.metadata).toMatchObject({ toolName: 'operations.inactiveRefreshExecute', ok: false, newProductIds: [], delistedProductIds: [] });
    expect(failed.text).toContain('执行前校验失败');
    expect(failedEvents).toEqual(['read:900']);
    expect(retryEvents).toEqual(['copy:900', 'delist:901']);
    expect(retry.metadata).toMatchObject({ toolName: 'operations.inactiveRefreshExecute', ok: true, newProductIds: ['1900'], delistedProductIds: ['901'] });
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
    expect(response.metadata).toMatchObject({ ok: true, newProductIds: ['1900', '1900'], delistedProductIds: ['901', '902'] });
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
