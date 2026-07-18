import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildAgentToolConfirmCard, type AgentToolConfirmContinuation } from '../src/agentRuntime/approvalCard.js';
import { buildAgentClarificationCard } from '../src/agentRuntime/clarificationCard.js';
import { MAX_CLARIFY_DEPTH } from '../src/agentRuntime/intentResolution.js';
import { clarificationConfirmationKey, saveClarificationContext } from '../src/feishuBot/clarificationStore.js';
import { loadOperationLedgerJsonlEntries } from '../src/agentRuntime/operationLedger.js';
import { agentExploreReason } from '../src/feishuBot/agentExploreAttribution.js';
import { createFeishuSdkBot } from '../src/feishuBot/sdkClient.js';
import {
  buildActivityAutomationCard,
  buildActivityCancelAssistanceCard,
  buildActivityPriceCallbackConfirmCard,
  buildCancelDifferentialPricingCard,
  type ActivityAutomationSkillClient,
  type ActivityPriceCallbackConfirmRequest,
} from '../src/feishuBot/activityAutomation.js';
import { buildRentalOperationConfirmCard, type RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';
import { buildNewLinkBatchConfirmCard, type NewLinkBatchPlan } from '../src/newLinkWorkflow/batch.js';
import { saveAgentToolConfirmRequest } from '../src/feishuBot/agentToolConfirmStore.js';
import { buildRefreshActivityStrategyCard } from '../src/feishuBot/refreshActivityCard.js';
import { refreshActivityPlanConfirmationKey, saveRefreshActivityPlan, type RefreshActivityPlan } from '../src/feishuBot/refreshActivityPlanStore.js';
import { openLinkRegistryGovernancePrompt } from '../src/linkRegistry/governanceSession.js';
import type { LinkRegistryEntry } from '../src/linkRegistry/types.js';
import { openLinkRegistryMaintenancePrompt } from '../src/linkRegistry/maintenanceSession.js';
import type { LinkRegistryOverrideRisk } from '../src/linkRegistry/overrides.js';

const dashboardRefreshMocks = vi.hoisted(() => ({
  loadEnv: vi.fn(),
  loadConfig: vi.fn(),
  runDashboardRefresh: vi.fn(),
}));

vi.mock('../src/config/loadEnv.js', () => ({
  loadEnv: dashboardRefreshMocks.loadEnv,
}));

vi.mock('../src/config/loadConfig.js', () => ({
  loadConfig: dashboardRefreshMocks.loadConfig,
}));

vi.mock('../src/publicTraffic/dashboardRefresh.js', () => ({
  runDashboardRefresh: dashboardRefreshMocks.runDashboardRefresh,
}));

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

const AUDIT_HASH = 'a'.repeat(64);

function completeAudit(productId: string, taskId = `task_${productId}_ref`) {
  return {
    taskId,
    changesFile: `changes-${productId}.json`,
    rollbackFile: `rollback-${productId}.json`,
    currentValuesFile: `current-${productId}.json`,
    changesSha256: AUDIT_HASH,
    rollbackSha256: AUDIT_HASH,
    currentSnapshotSha256: AUDIT_HASH,
    planHash: AUDIT_HASH,
    expectedFieldCount: 2,
    hasErrors: false,
    hasWarnings: false,
    diff: [{ field: 'rent1day', label: '1天', old: '33.00', new: '29.85', change: '-3.15', changePct: '-9.5%', issues: [] }],
  };
}

function legacyPriceConfirmValue(request: Record<string, unknown>): Record<string, unknown> {
  return { action: 'rental_price_confirm', request, confirmationKey: createHash('sha256').update(JSON.stringify(request)).digest('hex').slice(0, 24) };
}

function fakeSdk(sent: unknown[], registered: Record<string, (data: unknown) => Promise<unknown>>) {
  class FakeClient {
    im = { v1: { message: { reply: async (request: unknown) => sent.push({ kind: 'reply', request }), patch: async (request: unknown) => sent.push({ kind: 'patch', request }) } } };
  }
  class FakeWSClient {
    start() {
      return undefined;
    }
  }
  class FakeEventDispatcher {
    register(handlers: Record<string, (data: unknown) => Promise<unknown>>) {
      Object.assign(registered, handlers);
      return this;
    }
  }
  return { Client: FakeClient, WSClient: FakeWSClient, EventDispatcher: FakeEventDispatcher };
}

function fakeActivityAutomationClient() {
  const client: ActivityAutomationSkillClient & { executions: unknown[] } = {
    executions: [],
    async execute(request) {
      client.executions.push(request);
      return {
        ok: true,
        request,
        selectedCount: 7,
        pagesVisited: 3,
        dateFilledCount: 7,
        discountFilledCount: 28,
        mappedCount: 7,
        unmappedCount: 0,
        productPickSessionPath: 'output/latest/activity-automation/activity-product-pick-session.json',
        submitSessionPath: 'output/latest/activity-automation/activity-submit-session.json',
        callbackProductIds: ['770', '800', '801'],
        lines: ['自动选品: 7', '活动时间填写: 7', '折扣填写: 28', '已映射端内ID: 7'],
      };
    },
  };
  return client;
}

function fakeActivityCancellationAssistant() {
  return {
    requests: [] as unknown[],
    async open(request: unknown) {
      this.requests.push(request);
      return {
        openedUrl: 'https://b.alipay.com/page/commodity-operation/activity/list?appId=2021005181665859&productCode=PROMO_ZHIMA_REDUCTION',
        requiresManualLogin: true,
        lines: [
          '已打开差异化定价活动页面。',
          '当前页面可能需要登录、切换子账号，或手动完成最后的取消确认。',
        ],
      };
    },
  };
}

function activityCallbackRequest(submitSessionPath = 'output/latest/activity-automation/activity-submit-session.json'): ActivityPriceCallbackConfirmRequest {
  return {
    submitSessionPath,
    productIds: ['886'],
    mappedCount: 1,
    startsAt: '2026-06-24',
    endsAt: '2026-07-01',
  };
}

function agentToolConfirmActionValue(card: unknown): Record<string, unknown> {
  const body = (card as { body?: { elements?: Array<{ elements?: Array<{ name?: string; behaviors?: Array<{ value?: unknown }> }> }> } }).body;
  const form = body?.elements?.find((element) => Array.isArray(element.elements));
  const button = form?.elements?.find((element) => element.name === 'agent_tool_confirm_submit');
  const value = button?.behaviors?.[0]?.value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('agent tool confirm value not found');
  return value as Record<string, unknown>;
}

function readButtonValue(card: unknown, buttonName: string): Record<string, unknown> {
  const body = (card as { body?: { elements?: Array<{ elements?: Array<{ name?: string; behaviors?: Array<{ value?: unknown }> }>; actions?: Array<{ name?: string; behaviors?: Array<{ value?: unknown }> }> }> } }).body;
  for (const element of body?.elements ?? []) {
    for (const item of [...(element.elements ?? []), ...(element.actions ?? [])]) {
      if (item.name === buttonName) {
        const value = item.behaviors?.[0]?.value;
        if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
      }
    }
  }
  throw new Error(`${buttonName} value not found`);
}

function newLinkPlan(): NewLinkBatchPlan {
  return {
    status: 'ready',
    request: { keyword: 'SQ1', count: 2, sourceProductId: '388' },
    dataDate: '2026-06-11',
    requestedSourceProductId: '388',
    selectedSource: {
      productId: '388',
      platformProductId: 'platform-388',
      productName: 'SQ1 source',
      score: 100,
      reasons: ['fixture'],
    },
    candidates: [],
    warnings: [],
  };
}

function query565Continuation(currentStepId: string, currentStepIndex: number): AgentToolConfirmContinuation {
  return {
    goal: 'continue after confirmed product action',
    reason: 'continue with product query after confirmation',
    steps: [{ toolName: 'product.query', arguments: { keyword: '565' }, reason: 'query product 565' }],
    nextIndex: 1,
    totalSteps: 2,
    currentStepId,
    currentStepIndex,
    metadataStore: {},
  };
}

function patchedCard(sentItem: unknown): unknown {
  const content = (sentItem as { request?: { data?: { content?: unknown } } }).request?.data?.content;
  if (typeof content !== 'string') throw new Error('patch content not found');
  return JSON.parse(content);
}

async function writeActivitySubmitSessionFixture(status: string = 'price_callback_pending'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mt-agent-activity-cancel-sdk-'));
  const submitSessionPath = join(dir, 'activity-submit-session.json');
  await writeFile(submitSessionPath, `${JSON.stringify({
    status,
    submittedAt: '2026-06-24T08:00:00.000Z',
    submittedUrl: 'https://b.alipay.com/page/commodity-operation/activity/activityForm?appId=2021005181665859&productCode=PROMO_ZHIMA_REDUCTION',
    confirmationText: '返回活动列表',
    startsAt: '2026-06-24',
    endsAt: '2026-07-01',
    mappedCount: 1,
    unmappedCount: 0,
    products: [
      {
        platformProductId: '2026062322000235349104',
        merchantProductId: '81665859-886-06231159',
        internalProductId: '886',
      },
    ],
  }, null, 2)}\n`, 'utf8');
  return submitSessionPath;
}

async function writeContext(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mt-agent-card-action-'));
  await mkdir(join(dir, '2026-06-11'), { recursive: true });
  await writeFile(join(dir, '2026-06-11', 'report-context.json'), JSON.stringify({
    date: '2026-06-11',
    summary: { '1d': metric, '7d': metric, '30d': metric },
    conclusions: [],
    rows: [{ productName: 'iPhone 15', platformProductId: '2000000000000000000001', displayProductId: '端内ID 565', custodyDays: 10, periods: { '1d': metric, '7d': metric, '30d': metric } }],
    lowExposure: [],
    weakClick: [],
    weakConversion: [],
    highPotential: [],
    newProductObservation: [],
    lifecycleGovernance: [],
    recommendedActions: [],
    emptySectionNotes: {},
    orderAnalysis: { runDate: '2026-06-11', pages: {} },
    agentData: { removedLinks: [] },
  }));
  return dir;
}

async function writeRankingContinuationContext(): Promise<{
  outputDir: string;
  registryPaths: {
    productIdMapPath: string;
    productNameMapPath: string;
    firstSeenPath: string;
    lifecyclePath: string;
    overridesPath: string;
    artifactsDir: string;
  };
}> {
  const rootDir = await mkdtemp(join(tmpdir(), 'mt-agent-sdk-continuation-registry-'));
  const outputDir = join(rootDir, 'output');
  const configDir = join(rootDir, 'config');
  const stateDir = join(outputDir, 'state');
  await mkdir(join(outputDir, '2026-06-11'), { recursive: true });
  await mkdir(configDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  await writeFile(join(outputDir, '2026-06-11', 'report-context.json'), JSON.stringify({
    date: '2026-06-11',
    summary: { '1d': metric, '7d': metric, '30d': metric },
    conclusions: [],
    rows: [
      { productName: 'Alpha 低表现链接', platformProductId: 'p710', displayProductId: '端内ID 710', custodyDays: 10, periods: { '1d': metric, '7d': { ...metric, exposure: 100, publicVisits: 8, shippedOrders: 0, amount: 0 }, '30d': metric } },
      { productName: 'Alpha 高表现链接', platformProductId: 'p711', displayProductId: '端内ID 711', custodyDays: 10, periods: { '1d': metric, '7d': { ...metric, exposure: 500, publicVisits: 80, shippedOrders: 1, amount: 199 }, '30d': metric } },
    ],
    lowExposure: [],
    weakClick: [],
    weakConversion: [],
    highPotential: [],
    newProductObservation: [],
    lifecycleGovernance: [],
    recommendedActions: [],
    emptySectionNotes: {},
    orderAnalysis: { runDate: '2026-06-11', pages: {} },
    agentData: { removedLinks: [] },
  }), 'utf8');
  await writeFile(join(configDir, 'product-id-map.json'), JSON.stringify({ p710: '710', p711: '711' }), 'utf8');
  await writeFile(join(configDir, 'product-name-map.json'), JSON.stringify({ '710': 'Alpha 低表现链接', '711': 'Alpha 高表现链接' }), 'utf8');
  await writeFile(join(configDir, 'link-registry-overrides.json'), JSON.stringify({
    version: 1,
    entries: [
      { internalProductId: '710', productName: 'Alpha 低表现链接', shortName: 'Alpha', aliases: ['alpha'], sameSkuGroupId: 'alpha-group', status: 'active' },
      { internalProductId: '711', productName: 'Alpha 高表现链接', shortName: 'Alpha', aliases: ['alpha'], sameSkuGroupId: 'alpha-group', status: 'active' },
    ],
    sameSkuGroupAliasRules: [{ sameSkuGroupId: 'alpha-group', aliases: ['alpha'] }],
  }), 'utf8');
  return {
    outputDir,
    registryPaths: {
      productIdMapPath: join(configDir, 'product-id-map.json'),
      productNameMapPath: join(configDir, 'product-name-map.json'),
      firstSeenPath: join(stateDir, 'goods-first-seen.json'),
      lifecyclePath: join(stateDir, 'goods-link-lifecycle.json'),
      overridesPath: join(configDir, 'link-registry-overrides.json'),
      artifactsDir: outputDir,
    },
  };
}

async function writeLearningContext(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mt-agent-learning-card-action-'));
  await mkdir(join(dir, '2026-06-11'), { recursive: true });
  const rows = [629, 630].map((id) => ({ productName: `商品${id}`, platformProductId: `p${id}`, displayProductId: `端内ID ${id}`, custodyDays: 10, periods: { '1d': metric, '7d': metric, '30d': metric } }));
  await writeFile(join(dir, '2026-06-11', 'report-context.json'), JSON.stringify({
    date: '2026-06-11',
    summary: { '1d': metric, '7d': metric, '30d': metric },
    conclusions: [],
    rows,
    lowExposure: [],
    weakClick: [],
    weakConversion: [],
    highPotential: [],
    newProductObservation: [],
    lifecycleGovernance: [],
    recommendedActions: [
      { identifier: '端内ID 629', action: '检查价格', reason: '建议操作池', priority: 'high' },
      { identifier: '端内ID 630', action: '继续放量', reason: '建议操作池', priority: 'medium' },
    ],
    emptySectionNotes: {},
    orderAnalysis: { runDate: '2026-06-11', pages: {} },
    agentData: { removedLinks: [] },
  }));
  return dir;
}

async function seedLearningSession(outputDir: string): Promise<void> {
  await mkdir(join(outputDir, '2026-06-11'), { recursive: true });
  await writeFile(join(outputDir, '2026-06-11', 'operations-learning-session.json'), JSON.stringify({
    date: '2026-06-11',
    createdAt: '2026-06-11T00:00:00.000Z',
    updatedAt: '2026-06-11T00:00:00.000Z',
    items: [
      { productId: '565', productName: 'iPhone 15', platformProductId: 'p565', score: 1, sourceModules: ['建议操作'], reasons: ['原因1'], recommendedOperation: '补曝光', metrics: { '1d': metric, '7d': metric, '30d': metric }, feedbackOptions: ['reasonable', 'unreasonable', 'suggested_action', 'not_representative'] },
      { productId: '566', productName: 'Pocket 3', platformProductId: 'p566', score: 1, sourceModules: ['建议操作'], reasons: ['原因2'], recommendedOperation: '提转化', metrics: { '1d': metric, '7d': metric, '30d': metric }, feedbackOptions: ['reasonable', 'unreasonable', 'suggested_action', 'not_representative'] },
    ],
    feedbacks: [],
    learnedSignals: { acceptedReasons: {}, rejectedReasons: {}, rejectedOperations: {}, nonRepresentativeProducts: [] },
  }));
}

const linkMaintenanceRegistry: LinkRegistryEntry[] = [
  {
    internalProductId: '701',
    platformProductId: 'platform-701',
    productName: 'DJI Pocket 3 标准版',
    shortName: 'Pocket 3',
    sameSkuGroupId: 'dji-pocket-3',
    categoryId: 'camera',
    categoryName: '相机',
    productType: 'gimbal-camera',
    status: 'active',
    source: ['product_id_mapping', 'link_registry_override'],
  },
  {
    internalProductId: '702',
    platformProductId: 'platform-702',
    productName: 'DJI Pocket3 创作者套装',
    shortName: 'Pocket3',
    status: 'active',
    firstSeenDate: '2026-06-24',
    updatedAt: '2026-06-24',
    source: ['goods_first_seen'],
  },
];

async function seedLinkMaintenanceSession(outputDir: string): Promise<string> {
  const overridesPath = join(outputDir, 'config', 'link-registry-overrides.json');
  await openLinkRegistryMaintenancePrompt(outputDir, {
    date: '2026-06-24',
    registry: linkMaintenanceRegistry,
    referenceDate: '2026-06-24',
    overridesPath,
  });
  return overridesPath;
}

const linkGovernanceRegistry: LinkRegistryEntry[] = [
  {
    internalProductId: '801',
    platformProductId: 'platform-801',
    productName: 'Wide300 单机身',
    shortName: 'Wide300',
    sameSkuGroupId: 'instax-wide300',
    categoryId: 'camera',
    categoryName: '相机',
    productType: 'instant-camera',
    status: 'active',
    source: ['product_id_mapping'],
  },
];

const linkGovernanceRisks: LinkRegistryOverrideRisk[] = [
  { type: 'unknown_internal_product_id', message: 'Override target not found: 999', internalProductId: '999' },
];

async function seedLinkGovernanceSession(outputDir: string): Promise<void> {
  await openLinkRegistryGovernancePrompt(outputDir, {
    date: '2026-06-24',
    registry: linkGovernanceRegistry,
    overrideRisks: linkGovernanceRisks,
    referenceDate: '2026-06-24',
  });
}

describe('dashboard refresh SDK card delivery contract', () => {
  it('patches an executor-provided orange refresh card instead of the generic green completion card', async () => {
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-sdk-dashboard-refresh-card-'));
    const config = { targetUrl: 'https://example.test/dashboard', periods: ['1d', '7d', '30d'], preferredPageSize: 100, outputDir, browserProfileDir: 'profile' };
    dashboardRefreshMocks.loadConfig.mockResolvedValueOnce(config);
    dashboardRefreshMocks.runDashboardRefresh.mockResolvedValueOnce({
      status: 'still_missing',
      dataDate: '2026-06-24',
      actualPageDate: '2026-06-24',
      refreshQuality: { hasMissing: true, notes: [], periods: { '1d': { complete: true, rowCount: 12 }, '7d': { complete: false, rowCount: 0, reason: 'rowCount=0' }, '30d': { complete: true, rowCount: 300 } } },
      rebuild: 'skipped',
      resend: 'skipped',
      rawLocation: `${outputDir}/2026-06-25`,
      message: 'saved safely',
    });
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir, sdk: fakeSdk(sent, registered) });
    const confirmValue = agentToolConfirmActionValue(buildAgentToolConfirmCard({
      toolName: 'publicTraffic.refreshDashboard',
      arguments: { date: '2026-06-24' },
      reason: '补抓 2026-06-24 访问页',
    }));

    bot.start();
    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-dashboard-refresh-card' },
        operator: { open_id: 'ou_dashboard' },
        action: { tag: 'button', name: 'agent_tool_confirm_submit', behaviors: [{ type: 'callback', value: confirmValue }] },
      },
    });

    for (let attempt = 0; attempt < 100 && !JSON.stringify(sent).includes('访问页补抓完成，但数据仍未完整'); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(dashboardRefreshMocks.runDashboardRefresh).toHaveBeenCalledWith({ config, dataDate: '2026-06-24', sendTo: undefined });
    const finalCard = patchedCard(sent[sent.length - 1]) as { header?: { title?: { content?: string }; template?: string } };
    expect(finalCard.header?.title?.content).toBe('访问页补抓完成，但数据仍未完整');
    expect(finalCard.header?.template).toBe('orange');
    expect(JSON.stringify(finalCard)).toContain('rowCount=0');
    expect(JSON.stringify(finalCard)).toContain('未重建、未重发');
    expect(JSON.stringify(finalCard)).not.toContain('Agent 操作已完成');
  });
});

describe('createFeishuSdkBot card.action.trigger', () => {
  it('returns a replacement status card when cancelling an Agent clarification and suppresses duplicate text replies', async () => {
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-sdk-clarify-cancel-'));
    const context = {
      originalMessage: '抓取访问页数据',
      question: '你想抓取哪类访问页数据？',
      reason: '用户目标不明确',
      candidates: [{ toolName: 'report.fetchVisitPage', arguments: {}, label: '抓取访问页数据' }],
      depth: 1,
      confidence: 0.4,
    };
    const clarificationRef = await saveClarificationContext(outputDir, context);
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir, sdk: fakeSdk(sent, registered) });

    bot.start();
    const event = {
      event: {
        context: { open_message_id: 'om-agent-clarify-cancel' },
        operator: { open_id: 'ou_cancel' },
        action: {
          tag: 'button',
          name: 'agent_clarify_cancel',
          behaviors: [{ type: 'callback', value: { action: 'agent_clarify_cancel', clarificationRef, confirmationKey: clarificationConfirmationKey(context) } }],
        },
      },
    };

    const first = await registered['card.action.trigger'](event);
    const second = await registered['card.action.trigger'](event);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'patch', request: { path: { message_id: 'om-agent-clarify-cancel' } } });
    expect(first).toMatchObject({ card: { type: 'raw', data: { schema: '2.0' } } });
    expect(JSON.stringify((first as any).card.data)).toContain('已取消');
    expect(second).toMatchObject({ card: { type: 'raw', data: { schema: '2.0' } } });
    expect(JSON.stringify((second as any).card.data)).toContain('已经取消');
  });

  it('returns a replacement status card when cancelling an Agent tool confirmation and suppresses duplicate text replies', async () => {
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir: 'output', sdk: fakeSdk(sent, registered) });

    bot.start();
    const event = {
      event: {
        context: { open_message_id: 'om-agent-tool-cancel' },
        operator: { open_id: 'ou_cancel' },
        action: {
          tag: 'button',
          name: 'agent_tool_cancel_submit',
          behaviors: [{ type: 'callback', value: { action: 'agent_tool_cancel', toolName: 'publicTraffic.runReport' } }],
        },
      },
    };

    const first = await registered['card.action.trigger'](event);
    const second = await registered['card.action.trigger'](event);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'patch', request: { path: { message_id: 'om-agent-tool-cancel' } } });
    expect(first).toMatchObject({ card: { type: 'raw', data: { schema: '2.0' } } });
    expect(JSON.stringify((first as any).card.data)).toContain('已取消');
    expect(second).toMatchObject({ card: { type: 'raw', data: { schema: '2.0' } } });
    expect(JSON.stringify((second as any).card.data)).toContain('已经取消');
  });

  it('resolves requestRef-only SDK Agent tool cancellation through the stored request', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-sdk-tool-ref-cancel-'));
    const request = {
      toolName: 'rental.delist',
      arguments: { productId: '648' },
      reason: '[[dailyMission:runId=run-sdk-ref-cancel;decisionId=dec-sdk-ref-cancel]] 下架确认取消',
    };
    const requestRef = await saveAgentToolConfirmRequest(outputDir, request);
    const card = buildAgentToolConfirmCard(request, { requestRef });
    const cancelValue = readButtonValue(card, 'agent_tool_cancel_submit');
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir, sdk: fakeSdk(sent, registered) });

    bot.start();
    const result = await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-agent-tool-ref-cancel' },
        operator: { open_id: 'ou_sdk_ref_cancel' },
        action: { tag: 'button', name: 'agent_tool_cancel_submit', behaviors: [{ type: 'callback', value: cancelValue }] },
      },
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'patch', request: { path: { message_id: 'om-agent-tool-ref-cancel' } } });
    const resultCard = result as { card?: { data?: unknown } };
    expect(JSON.stringify(resultCard.card?.data)).toContain('rental.delist');
    const date = new Date().toISOString().slice(0, 10);
    const entries = await loadOperationLedgerJsonlEntries(outputDir, date);
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: 'approval_rejected', runId: 'run-sdk-ref-cancel', decisionId: 'dec-sdk-ref-cancel', toolName: 'rental.delist', subject: { kind: 'product', id: '648' } }),
    ]));
  });

  it('fails closed for unresolved requestRef-only SDK Agent tool cancellation', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-sdk-tool-ref-cancel-missing-'));
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir, sdk: fakeSdk(sent, registered) });

    bot.start();
    const result = await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-agent-tool-ref-cancel-missing' },
        operator: { open_id: 'ou_sdk_ref_cancel_missing' },
        action: {
          tag: 'button',
          name: 'agent_tool_cancel_submit',
          behaviors: [{ type: 'callback', value: { action: 'agent_tool_cancel', requestRef: 'agent_tool_missing_ref', confirmationKey: '0123456789abcdef01234567' } }],
        },
      },
    });

    expect(sent).toHaveLength(0);
    const resultCard = result as { card?: { data?: unknown } };
    expect(JSON.stringify(resultCard.card?.data)).toContain('取消异常');
    const date = new Date().toISOString().slice(0, 10);
    expect(await loadOperationLedgerJsonlEntries(outputDir, date)).toEqual([]);
  });

  it('renders failed Agent clarification continuation as a red status card', async () => {
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-sdk-clarify-json-failed-'));
    const context = {
      originalMessage: 'RX10M4整体价格 -1',
      question: '请确认改价方式',
      reason: '金额或比例不明确',
      candidates: [],
      depth: 1,
      confidence: 0.4,
    };
    const clarificationRef = await saveClarificationContext(outputDir, context);
    const bot = createFeishuSdkBot({
      appId: 'app',
      appSecret: 'secret',
      outputDir,
      dispatchMessage: async () => ({
        text: 'Agent 暂时没有把这次指令或补充解析成可执行计划。',
        skipped: false,
        metadata: { ok: false, errorType: 'llm_json_parse_failed' },
      }),
      sdk: fakeSdk(sent, registered),
    });

    bot.start();
    const card = buildAgentClarificationCard({
      originalMessage: 'RX10M4整体价格 -1',
      question: '请确认改价方式',
      reason: '金额或比例不明确',
      options: [
        { label: '按金额', message: 'RX10M4同款组整体价格按金额减1' },
        { label: '按比例', message: 'RX10M4同款组整体价格乘以0.9' },
      ],
    }, { clarificationRef, confirmationKey: clarificationConfirmationKey(context) });
    const value = readButtonValue(card, 'agent_clarify_custom');
    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-agent-clarify-json-failed' },
        operator: { open_id: 'ou_agent' },
        action: {
          tag: 'button',
          name: 'agent_clarify_custom',
          behaviors: [{ type: 'callback', value }],
          form_value: { custom_message: '-1是金额;RX10M4是同款组' },
        },
      },
    });

    for (let attempt = 0; attempt < 100 && sent.length < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const finalCard = patchedCard(sent[sent.length - 1]) as { header?: { title?: { content?: string }; template?: string } };
    expect(finalCard.header?.template).toBe('red');
    expect(finalCard.header?.title?.content).toBe('Agent 澄清处理失败');
    expect(JSON.stringify(finalCard)).not.toContain('Agent 澄清处理完成');
  });

  it('returns immediately for selected clarified-message candidates and updates final card asynchronously', async () => {
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-sdk-clarify-select-async-'));
    let finishDispatch: ((value: { text: string; card: Record<string, unknown>; skipped: false }) => void) | undefined;
    const dispatchStarted: string[] = [];
    const context = {
      originalMessage: '761改价-15元',
      question: '请确认改价范围',
      reason: '范围不明确',
      candidates: [{ toolName: 'agent.clarifiedMessage', arguments: { message: '761所有租期-15元' }, label: '所有租期' }],
      depth: 1,
      confidence: 0.4,
    };
    const clarificationRef = await saveClarificationContext(outputDir, context);
    const bot = createFeishuSdkBot({
      appId: 'app',
      appSecret: 'secret',
      outputDir,
      dispatchMessage: async (message) => {
        dispatchStarted.push(message.text);
        return await new Promise((resolve) => {
          finishDispatch = resolve;
        });
      },
      sdk: fakeSdk(sent, registered),
    });

    bot.start();
    const actionPromise = registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-agent-clarify-select-async' },
        operator: { open_id: 'ou_agent' },
        action: {
          tag: 'button',
          name: 'agent_clarify_select_1',
          behaviors: [{
            type: 'callback',
            value: {
              action: 'agent_clarify_select',
              clarificationRef,
              candidateIndex: 0,
              confirmationKey: clarificationConfirmationKey(context),
            },
          }],
        },
      },
    });

    const result = await Promise.race([
      actionPromise,
      new Promise((resolve) => setTimeout(() => resolve('timed-out'), 25)),
    ]);

    expect(result).not.toBe('timed-out');
    expect(JSON.stringify(result)).toContain('Agent 已收到你的选择');
    expect(dispatchStarted).toEqual(['761所有租期-15元']);
    expect(sent).toHaveLength(1);
    expect(JSON.stringify(patchedCard(sent[0]))).toContain('Agent 已收到你的选择');

    finishDispatch?.({
      text: '最终结果',
      skipped: false,
      card: { schema: '2.0', header: { title: { tag: 'plain_text', content: '最终审批卡' }, template: 'green' }, body: { elements: [] } },
    });
    await actionPromise;
    for (let attempt = 0; attempt < 100 && sent.length < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(JSON.stringify(patchedCard(sent[sent.length - 1]))).toContain('最终审批卡');
  });

  it('resumes a referenced SDK clarification candidate into the existing Agent confirmation path', async () => {
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-sdk-clarify-resume-'));
    const context = {
      originalMessage: '帮我把 648 下架',
      question: '你想怎么处理 648？',
      reason: '动作不明确',
      candidates: [{ toolName: 'rental.delist', arguments: { productId: '648' }, label: '下架 648' }],
      depth: 1,
      confidence: 0.42,
    };
    const clarificationRef = await saveClarificationContext(outputDir, context);
    const bot = createFeishuSdkBot({
      appId: 'app',
      appSecret: 'secret',
      outputDir,
      dispatchMessage: async () => { throw new Error('clarification select must not replay text'); },
      sdk: fakeSdk(sent, registered),
      rentalPriceClient: {
        async preview() { throw new Error('preview should not run'); },
        async execute() { throw new Error('execute should not run'); },
        async copy() { throw new Error('copy should not run'); },
        async delist() { throw new Error('delist should not run before confirmation'); },
        async tenancySet() { throw new Error('tenancySet should not run'); },
        async specDiscover() { throw new Error('specDiscover should not run'); },
        async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
      },
    });

    bot.start();
    const result = await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-agent-clarify-resume' },
        operator: { open_id: 'ou_agent' },
        action: {
          tag: 'button',
          name: 'agent_clarify_select_1',
          behaviors: [{
            type: 'callback',
            value: {
              action: 'agent_clarify_select',
              clarificationRef,
              candidateIndex: 0,
              confirmationKey: clarificationConfirmationKey(context),
            },
          }],
        },
      },
    });

    expect(JSON.stringify(result)).toContain('agent_tool_confirm');
    expect(JSON.stringify(result)).toContain('rental.delist');
    expect(sent).toEqual([]);
  });

  it('preserves SDK clarification depth when a selected locked candidate needs another clarification', async () => {
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-sdk-clarify-depth-'));
    const context = {
      originalMessage: '商品 648 下调 10',
      question: '你想怎么调整 648？',
      reason: '商品 648 下调 10',
      candidates: [{ toolName: 'rental.pricePreview', arguments: { productIds: ['648'] }, label: '预览调价' }],
      depth: MAX_CLARIFY_DEPTH,
      confidence: 0.42,
    };
    const clarificationRef = await saveClarificationContext(outputDir, context);
    const bot = createFeishuSdkBot({
      appId: 'app',
      appSecret: 'secret',
      outputDir,
      dispatchMessage: async () => { throw new Error('clarification select must not replay text'); },
      sdk: fakeSdk(sent, registered),
    });

    bot.start();
    const result = await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-agent-clarify-depth' },
        operator: { open_id: 'ou_agent' },
        action: {
          tag: 'button',
          name: 'agent_clarify_select_1',
          behaviors: [{
            type: 'callback',
            value: {
              action: 'agent_clarify_select',
              clarificationRef,
              candidateIndex: 0,
              confirmationKey: clarificationConfirmationKey(context),
            },
          }],
        },
      },
    });

    expect(JSON.stringify(result)).toContain('我还是没法确定你的意图');
    expect(JSON.stringify(result)).not.toContain('agent_clarify_select');
    expect(sent).toEqual([]);
  });

  it('allows a continued Agent tool confirmation on the same message after the first write completes', async () => {
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const calls: string[] = [];
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run'); },
      async execute() { throw new Error('execute should not run'); },
      async copy(productId) {
        calls.push(`copy:${productId}`);
        return { productId, ok: true, newProductId: '901', lines: ['copy: ok'] };
      },
      async delist(productId) {
        calls.push(`delist:${productId}`);
        return { productId, ok: true, lines: ['delist: ok'] };
      },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };
    const bot = createFeishuSdkBot({
      appId: 'app',
      appSecret: 'x',
      outputDir: 'output',
      rentalPriceClient,
      sdk: fakeSdk(sent, registered),
    });

    bot.start();
    const firstCard = buildAgentToolConfirmCard({
      toolName: 'rental.copy',
      arguments: { productId: '761' },
      reason: '先复制 761',
      continuation: {
        goal: '先复制再下架',
        reason: '连续写操作要逐步确认',
        steps: [
          { toolName: 'rental.delist', arguments: { productId: '762' }, reason: '再下架 762' },
        ],
        nextIndex: 1,
        totalSteps: 2,
        currentStepId: 'copy',
        currentStepIndex: 0,
        metadataStore: {},
      },
    });

    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-agent-tool-continued' },
        operator: { open_id: 'ou_agent' },
        action: {
          tag: 'button',
          name: 'agent_tool_confirm_submit',
          behaviors: [{ type: 'callback', value: agentToolConfirmActionValue(firstCard) }],
        },
      },
    });
    for (let attempt = 0; attempt < 100 && (calls.length < 1 || sent.length < 2); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(calls).toEqual(['copy:761']);
    const secondCard = patchedCard(sent[sent.length - 1]);
    expect(JSON.stringify(secondCard)).toContain('rental.delist');

    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-agent-tool-continued' },
        operator: { open_id: 'ou_agent' },
        action: {
          tag: 'button',
          name: 'agent_tool_confirm_submit',
          behaviors: [{ type: 'callback', value: agentToolConfirmActionValue(secondCard) }],
        },
      },
    });
    for (let attempt = 0; attempt < 100 && calls.length < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(calls).toEqual(['copy:761', 'delist:762']);
  });

  it('executes a referenced Agent price apply confirmation from the SDK callback', async () => {
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-sdk-agent-tool-ref-'));
    const calls: Array<{ productId: string; fields: Record<string, string> }> = [];
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run'); },
      async execute(request) {
        calls.push({ productId: request.productId, fields: request.fields });
        return { productId: request.productId, ok: true, lines: ['apply: ok'] };
      },
      async copy() { throw new Error('copy should not run'); },
      async delist() { throw new Error('delist should not run'); },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };
    const bot = createFeishuSdkBot({
      appId: 'app',
      appSecret: 'x',
      outputDir,
      rentalPriceClient,
      sdk: fakeSdk(sent, registered),
    });

    bot.start();
    const request = {
      toolName: 'rental.priceApply',
      arguments: {
        items: [
          {
            productId: '653',
            fields: { rent1day: '29.85', rent10day: '74.85' },
            audit: completeAudit('653', 'task_653_ref'),
          },
        ],
      },
      reason: 'confirmed preview',
    };
    const requestRef = await saveAgentToolConfirmRequest(outputDir, request);
    const card = buildAgentToolConfirmCard(request, { requestRef });
    const value = agentToolConfirmActionValue(card);
    expect(JSON.stringify(value)).not.toContain('rent10day');

    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-agent-tool-ref-price' },
        operator: { open_id: 'ou_agent' },
        action: {
          tag: 'button',
          name: 'agent_tool_confirm_submit',
          behaviors: [{ type: 'callback', value }],
        },
      },
    });

    for (let attempt = 0; attempt < 100 && calls.length < 1; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(calls).toEqual([{ productId: '653', fields: { rent1day: '29.85', rent10day: '74.85' } }]);
    expect(JSON.stringify(sent)).toContain('rental.priceApply');
  });

  it('records ledger attribution for confirmed Agent Explore writes from the SDK callback', async () => {
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-sdk-agent-explore-ledger-'));
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run'); },
      async execute() { throw new Error('execute should not run'); },
      async copy() { throw new Error('copy should not run'); },
      async delist(productId) { return { productId, ok: true, lines: ['delisted'] }; },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };
    const bot = createFeishuSdkBot({
      appId: 'app',
      appSecret: 'x',
      outputDir,
      rentalPriceClient,
      sdk: fakeSdk(sent, registered),
    });

    bot.start();
    const card = buildAgentToolConfirmCard({
      toolName: 'rental.delist',
      arguments: { productId: '648' },
      reason: agentExploreReason('dec-sdk-ledger', '下架 648'),
    });

    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-agent-explore-ledger' },
        operator: { open_id: 'ou_agent' },
        action: {
          tag: 'button',
          name: 'agent_tool_confirm_submit',
          behaviors: [{ type: 'callback', value: agentToolConfirmActionValue(card) }],
        },
      },
    });

    const date = new Date().toISOString().slice(0, 10);
    let entries: Awaited<ReturnType<typeof loadOperationLedgerJsonlEntries>> = [];
    for (let attempt = 0; attempt < 100 && (entries.length < 2 || !JSON.stringify(sent).includes('下架成功：商品 648')); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      entries = await loadOperationLedgerJsonlEntries(outputDir, date);
    }

    expect(JSON.stringify(sent)).toContain('下架成功：商品 648');
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: 'execution_started', runId: 'agentExplore', decisionId: 'dec-sdk-ledger', toolName: 'rental.delist' }),
      expect.objectContaining({ event: 'execution_succeeded', runId: 'agentExplore', decisionId: 'dec-sdk-ledger', toolName: 'rental.delist' }),
    ]));
  });

  it('renders failed Agent price apply results as a failure card from the SDK callback', async () => {
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-sdk-agent-tool-failed-ref-'));
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run'); },
      async execute(request) {
        return { productId: request.productId, ok: false, lines: ['apply: partial', 'submit: skipped', 'verify: skipped'] };
      },
      async copy() { throw new Error('copy should not run'); },
      async delist() { throw new Error('delist should not run'); },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };
    const bot = createFeishuSdkBot({
      appId: 'app',
      appSecret: 'x',
      outputDir,
      rentalPriceClient,
      sdk: fakeSdk(sent, registered),
    });

    bot.start();
    const request = {
      toolName: 'rental.priceApply',
      arguments: {
        items: [
          {
            productId: '653',
            fields: { rent1day: '29.85', rent10day: '74.85' },
            audit: completeAudit('653', 'task_653_ref'),
          },
        ],
      },
      reason: 'confirmed preview',
    };
    const requestRef = await saveAgentToolConfirmRequest(outputDir, request);
    const card = buildAgentToolConfirmCard(request, { requestRef });
    const event = {
      event: {
        context: { open_message_id: 'om-agent-tool-ref-price-failed' },
        operator: { open_id: 'ou_agent' },
        action: {
          tag: 'button',
          name: 'agent_tool_confirm_submit',
          behaviors: [{ type: 'callback', value: agentToolConfirmActionValue(card) }],
        },
      },
    };

    await registered['card.action.trigger'](event);

    for (let attempt = 0; attempt < 100 && !JSON.stringify(sent).includes('Agent 操作失败'); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const finalCard = patchedCard(sent[sent.length - 1]) as { header?: { title?: { content?: string }; template?: string } };
    expect(finalCard.header?.title?.content).toBe('Agent 操作失败');
    expect(finalCard.header?.template).toBe('red');
    expect(JSON.stringify(finalCard)).toContain('成功 0/1');
    expect(JSON.stringify(finalCard)).toContain('apply: partial');
    expect(JSON.stringify(finalCard)).not.toContain('Agent 操作已完成');

    const duplicate = await registered['card.action.trigger'](event);
    const duplicateCard = (duplicate as { card?: { data?: { header?: { template?: string }; body?: unknown } } }).card?.data;
    expect(duplicateCard?.header?.template).toBe('red');
    expect(JSON.stringify(duplicateCard)).toContain('已经执行失败');
  });

  it('blocks cross-strategy SDK refresh activity selections from the same plan card', async () => {
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-sdk-refresh-strategy-claim-'));
    const plan: RefreshActivityPlan = {
      date: '2026-06-11',
      delistProductIds: ['901', '902'],
      delistProductIdsForRefill: ['901', '902'],
      newLinkItemsForRefill: [{ keyword: 'DJI Pocket 3', count: 2, sourceProductId: '900', sourceProductName: 'Pocket3 健康源', sameSkuGroupId: 'dji-pocket-3' }],
      skippedGroups: [],
      canRefill: true,
    };
    const planRef = await saveRefreshActivityPlan(outputDir, plan);
    const strategyCard = buildRefreshActivityStrategyCard({
      date: plan.date,
      planRef,
      confirmationKeyDelistOnly: refreshActivityPlanConfirmationKey(plan, 'delist_only'),
      confirmationKeyDelistAndRefill: refreshActivityPlanConfirmationKey(plan, 'delist_and_refill'),
      delistCount: 2,
      newLinkCount: 2,
      skippedGroups: [],
    });
    const delistValue = readButtonValue(strategyCard, 'refresh_activity_delist_only_submit');
    const refillValue = readButtonValue(strategyCard, 'refresh_activity_delist_refill_submit');
    const bot = createFeishuSdkBot({
      appId: 'app',
      appSecret: 'x',
      outputDir,
      sdk: fakeSdk(sent, registered),
    });

    bot.start();
    const first = await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-refresh-strategy-select' },
        action: {
          tag: 'button',
          name: 'refresh_activity_delist_only_submit',
          behaviors: [{ type: 'callback', value: delistValue }],
        },
      },
    });
    const second = await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-refresh-strategy-select' },
        action: {
          tag: 'button',
          name: 'refresh_activity_delist_refill_submit',
          behaviors: [{ type: 'callback', value: refillValue }],
        },
      },
    });

    expect(JSON.stringify(first)).toContain('即将下架端内ID：901、902');
    expect(JSON.stringify(second)).toContain('已经执行完成');
    expect(JSON.stringify(second)).not.toContain('即将下架端内ID');
  });

  it('passes registry paths into SDK Agent continuation steps after a confirmed product action', async () => {
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const fixtures = await writeRankingContinuationContext();
    const calls: string[] = [];
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run'); },
      async execute() { throw new Error('execute should not run'); },
      async copy(productId) {
        calls.push(productId);
        return { productId, ok: true, newProductId: '901', lines: ['copy: ok'] };
      },
      async delist() { throw new Error('delist should not run'); },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };
    const bot = createFeishuSdkBot({
      appId: 'app',
      appSecret: 'x',
      outputDir: fixtures.outputDir,
      rentalPriceClient,
      closedOrderRegistryPaths: fixtures.registryPaths,
      sdk: fakeSdk(sent, registered),
    });

    bot.start();
    const card = buildAgentToolConfirmCard({
      toolName: 'rental.copy',
      arguments: { productId: '875' },
      reason: '先复制，再查询 alpha 最佳链接',
      continuation: {
        goal: '先复制再查 alpha 最佳链接',
        reason: '确认后继续读链接档案',
        steps: [
          { toolName: 'product.rankBestSameSku', arguments: { query: 'alpha' }, reason: '查询 alpha 同款组最佳链接' },
        ],
        nextIndex: 1,
        totalSteps: 2,
        currentStepId: 'copy',
        currentStepIndex: 0,
        metadataStore: {},
      },
    });

    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-agent-tool-continuation-registry' },
        operator: { open_id: 'ou_agent' },
        action: {
          tag: 'button',
          name: 'agent_tool_confirm_submit',
          behaviors: [{ type: 'callback', value: agentToolConfirmActionValue(card) }],
        },
      },
    });

    for (let attempt = 0; attempt < 100 && !sent.some((item) => JSON.stringify(item).includes('数据最好的 alpha 是：端内ID 711')); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(calls).toEqual(['875']);
    expect(JSON.stringify(sent)).toContain('步骤 2/2：product.rankBestSameSku');
    expect(JSON.stringify(sent)).toContain('数据最好的 alpha 是：端内ID 711');
  });

  it('continues a planner sequence after a dedicated new-link confirmation succeeds', async () => {
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const outputDir = await writeContext();
    const calls: string[] = [];
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run'); },
      async execute() { throw new Error('execute should not run'); },
      async copy(productId) {
        calls.push(productId);
        return { productId, ok: true, newProductId: `new-${calls.length}`, lines: ['copy: ok'] };
      },
      async delist() { throw new Error('delist should not run'); },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };
    const bot = createFeishuSdkBot({
      appId: 'app',
      appSecret: 'x',
      outputDir,
      rentalPriceClient,
      sdk: fakeSdk(sent, registered),
    });
    const confirmValue = readButtonValue(
      buildNewLinkBatchConfirmCard(newLinkPlan(), 'test reason', query565Continuation('newLinks', 0)),
      'new_link_batch_confirm_submit',
    );

    bot.start();
    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-new-link-continued' },
        operator: { open_id: 'ou_agent' },
        action: {
          tag: 'button',
          name: 'new_link_batch_confirm_submit',
          value: confirmValue,
        },
      },
    });

    for (let attempt = 0; attempt < 100 && !sent.some((item) => JSON.stringify(item).includes('端内ID 565')); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(calls).toEqual(['388', '388']);
    const finalPatch = sent.map(patchedCard).find((card) => JSON.stringify(card).includes('端内ID 565'));
    expect(JSON.stringify(finalPatch)).toContain('商品查询结果');
    expect(JSON.stringify(finalPatch)).toContain('端内ID 565');
  });

  it('returns a replacement status card for malformed new-link confirmations without text replies', async () => {
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir: 'output', sdk: fakeSdk(sent, registered) });

    bot.start();
    const result = await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-new-link-malformed' },
        operator: { open_id: 'ou_agent' },
        action: {
          tag: 'button',
          name: 'new_link_batch_confirm_submit',
          value: { action: 'new_link_batch_confirm' },
        },
      },
    });

    expect(sent).toEqual([]);
    expect(result).toMatchObject({ card: { type: 'raw', data: { schema: '2.0' } } });
    expect(JSON.stringify((result as any).card.data)).toContain('新链批量复制确认异常');
  });

  it('rejects a legacy dedicated price confirmation before planner continuation', async () => {
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const outputDir = await writeContext();
    const executions: unknown[] = [];
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run'); },
      async execute(request) {
        executions.push(request);
        return { productId: request.productId, ok: true, lines: ['apply: ok', 'submit: ok', 'verify: ok'] };
      },
      async copy() { throw new Error('copy should not run'); },
      async delist() { throw new Error('delist should not run'); },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'x', outputDir, rentalPriceClient, sdk: fakeSdk(sent, registered) });
    const confirmValue = legacyPriceConfirmValue({ mode: 'explicit_fields', productId: '761', fields: { rent1day: '22.00' }, reason: 'test reason', continuation: query565Continuation('price', 0) });

    bot.start();
    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-price-continued' },
        action: {
          tag: 'button',
          name: 'rental_price_confirm_submit',
          value: confirmValue,
        },
      },
    });

    for (let attempt = 0; attempt < 100 && !sent.some((item) => JSON.stringify(item).includes('旧改价确认入口已停用')); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(executions).toHaveLength(0);
    expect(JSON.stringify(sent)).toContain('旧改价确认入口已停用');
    expect(JSON.stringify(sent)).not.toContain('端内ID 565');
  });

  it('continues a planner sequence after a dedicated rental operation confirmation succeeds', async () => {
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const outputDir = await writeContext();
    const calls: string[] = [];
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run'); },
      async execute() { throw new Error('execute should not run'); },
      async copy() { throw new Error('copy should not run'); },
      async delist(productId) {
        calls.push(productId);
        return { productId, ok: true, lines: ['delist: ok'] };
      },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'x', outputDir, rentalPriceClient, sdk: fakeSdk(sent, registered) });
    const confirmValue = readButtonValue(buildRentalOperationConfirmCard({
      action: 'delist',
      productId: '761',
      plannerToolName: 'rental.operationConfirmRequest',
      plannerArguments: { action: 'delist', productId: '761' },
      plannerReason: 'test reason',
      continuation: query565Continuation('delist', 0),
    }, 'test reason'), 'rental_operation_confirm_submit');

    bot.start();
    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-rental-operation-continued' },
        action: {
          tag: 'button',
          name: 'rental_operation_confirm_submit',
          value: confirmValue,
        },
      },
    });

    for (let attempt = 0; attempt < 100 && !sent.some((item) => JSON.stringify(item).includes('端内ID 565')); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(calls).toEqual(['761']);
    const finalPatch = sent.map(patchedCard).find((card) => JSON.stringify(card).includes('端内ID 565'));
    expect(JSON.stringify(finalPatch)).toContain('商品查询结果');
    expect(JSON.stringify(finalPatch)).toContain('端内ID 565');
  });

  it('patches a price callback confirmation card after differential pricing automation completes', async () => {
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const activityAutomationClient = fakeActivityAutomationClient();
    const bot = createFeishuSdkBot({
      appId: 'app',
      appSecret: 'secret',
      outputDir: 'output',
      activityAutomationClient,
      sdk: fakeSdk(sent, registered),
    });

    bot.start();
    const confirmValue = readButtonValue(buildActivityAutomationCard(), 'activity_automation_confirm_submit');
    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-activity-automation' },
        action: {
          tag: 'button',
          value: confirmValue,
          form_value: {
            starts_at: '2026-06-23',
            ends_at: '2026-06-30',
            discount_ss: '8.5',
            discount_s: '9.0',
            discount_a: '9.5',
            discount_b: '9.8',
          },
        },
      },
    });

    for (let attempt = 0; attempt < 100 && (activityAutomationClient.executions.length < 1 || sent.length < 2); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(activityAutomationClient.executions).toEqual([
      {
        startsAt: '2026-06-23',
        endsAt: '2026-06-30',
        discounts: { SS: '8.5', S: '9.0', A: '9.5', B: '9.8' },
      },
    ]);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ kind: 'patch', request: { path: { message_id: 'om-activity-automation' } } });
    expect(JSON.stringify(sent[0])).toContain('处理中');
    expect(sent[1]).toMatchObject({ kind: 'patch', request: { path: { message_id: 'om-activity-automation' } } });
    expect(JSON.stringify(sent[1])).toContain('activity_price_callback_confirm');
    expect(JSON.stringify(sent[1])).not.toContain('activity_cancel_open');
    expect(JSON.stringify(sent[1])).toContain('activity-submit-session.json');
    expect(JSON.stringify(sent[1])).toContain('770');
  });

  it('rejects unsigned differential pricing automation callbacks', async () => {
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const activityAutomationClient = fakeActivityAutomationClient();
    const bot = createFeishuSdkBot({
      appId: 'app',
      appSecret: 'secret',
      outputDir: 'output',
      activityAutomationClient,
      sdk: fakeSdk(sent, registered),
    });

    bot.start();
    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-activity-automation-unsigned' },
        action: {
          tag: 'button',
          value: { action: 'activity_automation_confirm' },
          form_value: {
            starts_at: '2026-06-23',
            ends_at: '2026-06-30',
          },
        },
      },
    });

    expect(activityAutomationClient.executions).toEqual([]);
    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent[0])).toContain('参数无效');
  });

  it('rejects differential pricing callbacks when the card key belongs to another action', async () => {
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const activityAutomationClient = fakeActivityAutomationClient();
    const bot = createFeishuSdkBot({
      appId: 'app',
      appSecret: 'secret',
      outputDir: 'output',
      activityAutomationClient,
      sdk: fakeSdk(sent, registered),
    });

    bot.start();
    const cancelValue = readButtonValue(buildActivityAutomationCard(), 'activity_automation_cancel_submit');
    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-activity-automation-wrong-action-key' },
        action: {
          tag: 'button',
          value: { ...cancelValue, action: 'activity_automation_confirm' },
          form_value: {
            starts_at: '2026-06-23',
            ends_at: '2026-06-30',
          },
        },
      },
    });

    expect(activityAutomationClient.executions).toEqual([]);
    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent[0])).toContain('参数无效');
  });

  it('accepts date picker objects and omitted default discounts for differential pricing automation', async () => {
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const activityAutomationClient = fakeActivityAutomationClient();
    const bot = createFeishuSdkBot({
      appId: 'app',
      appSecret: 'secret',
      outputDir: 'output',
      activityAutomationClient,
      sdk: fakeSdk(sent, registered),
    });

    bot.start();
    const confirmValue = readButtonValue(buildActivityAutomationCard(), 'activity_automation_confirm_submit');
    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-activity-automation-defaults' },
        action: {
          tag: 'button',
          value: confirmValue,
          form_value: {
            starts_at: { date: '2026-06-24' },
            ends_at: { value: '2026-06-30' },
          },
        },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(activityAutomationClient.executions).toEqual([
      {
        startsAt: '2026-06-24',
        endsAt: '2026-06-30',
        discounts: { SS: '8.5', S: '9.0', A: '9.5', B: '9.8' },
      },
    ]);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ kind: 'patch', request: { path: { message_id: 'om-activity-automation-defaults' } } });
    expect(JSON.stringify(sent[1])).toContain('activity_price_callback_confirm');
  });

  it('accepts nested differential_pricing_form values from differential pricing callbacks', async () => {
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const activityAutomationClient = fakeActivityAutomationClient();
    const bot = createFeishuSdkBot({
      appId: 'app',
      appSecret: 'secret',
      outputDir: 'output',
      activityAutomationClient,
      sdk: fakeSdk(sent, registered),
    });

    bot.start();
    const confirmValue = readButtonValue(buildActivityAutomationCard(), 'activity_automation_confirm_submit');
    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-activity-automation-nested' },
        action: {
          tag: 'button',
          value: confirmValue,
          form_value: {
            differential_pricing_form: {
              starts_at: '2026-06-24',
              ends_at: '2026-06-30',
            },
          },
        },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(activityAutomationClient.executions).toEqual([
      {
        startsAt: '2026-06-24',
        endsAt: '2026-06-30',
        discounts: { SS: '8.5', S: '9.0', A: '9.5', B: '9.8' },
      },
    ]);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ kind: 'patch', request: { path: { message_id: 'om-activity-automation-nested' } } });
    expect(JSON.stringify(sent[1])).toContain('activity_price_callback_confirm');
  });

  it('replaces the differential pricing card when the user cancels', async () => {
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const activityAutomationClient = fakeActivityAutomationClient();
    const bot = createFeishuSdkBot({
      appId: 'app',
      appSecret: 'secret',
      outputDir: 'output',
      activityAutomationClient,
      sdk: fakeSdk(sent, registered),
    });

    bot.start();
    const cancelValue = readButtonValue(buildActivityAutomationCard(), 'activity_automation_cancel_submit');
    const result = await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-activity-automation-cancel' },
        action: {
          tag: 'button',
          value: cancelValue,
        },
      },
    });

    expect(activityAutomationClient.executions).toEqual([]);
    expect(result).toMatchObject({ card: { type: 'raw', data: { schema: '2.0' } } });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'patch', request: { path: { message_id: 'om-activity-automation-cancel' } } });
    expect(JSON.stringify(sent[0])).toContain('已取消');
  });

  it('returns replacement cards for price callback cancellation and duplicate clicks', async () => {
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir: 'output', sdk: fakeSdk(sent, registered) });

    bot.start();
    const request: ActivityPriceCallbackConfirmRequest = {
      submitSessionPath: 'output/latest/activity-automation/activity-submit-session.json',
      productIds: ['770', '800'],
      mappedCount: 2,
      startsAt: '2026-06-24',
      endsAt: '2026-06-30',
    };
    const cancelValue = readButtonValue(buildActivityPriceCallbackConfirmCard(request), 'activity_price_callback_cancel_submit');
    const event = {
      event: {
        context: { open_message_id: 'om-activity-price-callback-cancel' },
        action: {
          tag: 'button',
          value: cancelValue,
        },
      },
    };

    const first = await registered['card.action.trigger'](event);
    const second = await registered['card.action.trigger'](event);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'patch', request: { path: { message_id: 'om-activity-price-callback-cancel' } } });
    expect(first).toMatchObject({ card: { type: 'raw', data: { schema: '2.0' } } });
    expect(JSON.stringify((first as any).card.data)).toContain('已取消');
    expect(second).toMatchObject({ card: { type: 'raw', data: { schema: '2.0' } } });
    expect(JSON.stringify((second as any).card.data)).toContain('已经取消');
  });

  it('opens human-assisted activity cancellation and patches the card in place', async () => {
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const activityCancellationAssistant = fakeActivityCancellationAssistant();
    const submitSessionPath = await writeActivitySubmitSessionFixture();
    const bot = createFeishuSdkBot({
      appId: 'app',
      appSecret: 'secret',
      outputDir: 'output',
      sdk: fakeSdk(sent, registered),
      activityCancellationAssistant,
    } as any);

    bot.start();
    const request = activityCallbackRequest(submitSessionPath);
    const openValue = readButtonValue(buildCancelDifferentialPricingCard(request), 'cancel_differential_pricing_open_submit');
    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-activity-cancel-open' },
        action: {
          tag: 'button',
          name: 'cancel_differential_pricing_open_submit',
          value: openValue,
        },
      },
    });

    for (let attempt = 0; attempt < 100 && sent.length < 1; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(activityCancellationAssistant.requests).toEqual([
      {
        submitSessionPath,
        productIds: ['886'],
        mappedCount: 1,
        startsAt: '2026-06-24',
        endsAt: '2026-07-01',
      },
    ]);
    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent[0])).toContain('cancel_differential_pricing_done');
    expect(JSON.stringify(sent[0])).toContain('cancel_differential_pricing_abort');
    await expect(readFile(submitSessionPath, 'utf8')).resolves.toContain('"status": "cancel_assistance_opened"');
  });

  it('marks the submitted activity as cancelled after manual confirmation', async () => {
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const submitSessionPath = await writeActivitySubmitSessionFixture('cancel_assistance_opened');
    const bot = createFeishuSdkBot({
      appId: 'app',
      appSecret: 'secret',
      outputDir: 'output',
      sdk: fakeSdk(sent, registered),
    });

    bot.start();
    const request = activityCallbackRequest(submitSessionPath);
    const doneValue = readButtonValue(
      buildActivityCancelAssistanceCard(request, { openedUrl: 'https://example.test/activity', requiresManualLogin: false, lines: [] }),
      'cancel_differential_pricing_done_submit',
    );
    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-activity-cancel-done' },
        action: {
          tag: 'button',
          name: 'cancel_differential_pricing_done_submit',
          value: doneValue,
        },
      },
    });

    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent[0])).toContain('差异化定价活动已取消');
    await expect(readFile(submitSessionPath, 'utf8')).resolves.toContain('"status": "cancelled"');
  });

  it('restores the price callback confirmation card when keeping the activity', async () => {
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const submitSessionPath = await writeActivitySubmitSessionFixture('cancel_assistance_opened');
    const bot = createFeishuSdkBot({
      appId: 'app',
      appSecret: 'secret',
      outputDir: 'output',
      sdk: fakeSdk(sent, registered),
    });

    bot.start();
    const request = activityCallbackRequest(submitSessionPath);
    const abortValue = readButtonValue(
      buildActivityCancelAssistanceCard(request, { openedUrl: 'https://example.test/activity', requiresManualLogin: false, lines: [] }),
      'cancel_differential_pricing_abort_submit',
    );
    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-activity-cancel-abort' },
        action: {
          tag: 'button',
          name: 'cancel_differential_pricing_abort_submit',
          value: abortValue,
        },
      },
    });

    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent[0])).toContain('取消差异化定价');
    expect(JSON.stringify(sent[0])).toContain('cancel_differential_pricing_open');
    await expect(readFile(submitSessionPath, 'utf8')).resolves.toContain('"status": "price_callback_pending"');
  });

  it('handles query full-list card action by replying with read-only text', async () => {
    const outputDir = await writeContext();
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir, sdk: fakeSdk(sent, registered) });

    bot.start();
    const result = await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-query-full-list' },
        action: { tag: 'button', name: 'query_full_list_submit', behaviors: [{ type: 'callback', value: { action: 'query_full_list', queryRef: '2026-06-11:custodyAbnormal' } }] },
      },
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      kind: 'reply',
      request: {
        path: { message_id: 'om-query-full-list' },
        data: { msg_type: 'text' },
      },
    });
    const textContent = JSON.parse((sent[0] as { request: { data: { content: string } } }).request.data.content) as { text: string };
    expect(textContent.text).toContain('托管异常 2026-06-11');
    expect(textContent.text).toContain('暂无数据。');
    expect(result).toMatchObject({ card: { type: 'raw', data: { schema: '2.0' } } });
    const cardText = JSON.stringify((result as any).card.data);
    expect(cardText).toContain('完整清单已发送');
    expect(cardText).not.toContain('托管异常 2026-06-11');
    expect(cardText).not.toContain('暂无数据。');
  });

  it('handles id_lookup form submit by returning the updated card', async () => {
    const outputDir = await writeContext();
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir, sdk: fakeSdk(sent, registered) });

    bot.start();
    const result = await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-id-lookup' },
        action: { tag: 'button', value: { action: 'id_lookup' }, form_value: { lookup_query: '565' } },
      },
    });

    expect(sent).toEqual([]);
    expect(result).toMatchObject({ card: { type: 'raw', data: { schema: '2.0' } } });
    expect(JSON.stringify((result as any).card.data)).toContain('"tag":"column_set"');
    expect(JSON.stringify((result as any).card.data)).toContain('端内ID');
    expect(JSON.stringify((result as any).card.data)).toContain('平台商品ID');
    expect(JSON.stringify((result as any).card.data)).toContain('2000000000000000000001');
    expect(JSON.stringify((result as any).card.data)).not.toContain('查询结果');
    expect(JSON.stringify((result as any).card.data)).not.toContain('"tag":"hr"');
  });

  it('handles id_lookup submit when Feishu returns the callback value through behaviors', async () => {
    const outputDir = await writeContext();
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir, sdk: fakeSdk(sent, registered) });

    bot.start();
    const result = await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-id-lookup-behavior' },
        action: { tag: 'button', name: 'id_lookup_submit', behaviors: [{ type: 'callback', value: { action: 'id_lookup' } }], form_value: { lookup_query: '565' } },
      },
    });

    expect(sent).toEqual([]);
    expect(result).toMatchObject({ card: { type: 'raw', data: { schema: '2.0' } } });
    expect(JSON.stringify((result as any).card.data)).toContain('"tag":"column_set"');
    expect(JSON.stringify((result as any).card.data)).toContain('2000000000000000000001');
    expect(JSON.stringify((result as any).card.data)).not.toContain('查询结果');
  });

  it('handles id_lookup form submit when SDK returns flattened card action data', async () => {
    const outputDir = await writeContext();
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir, sdk: fakeSdk(sent, registered) });

    bot.start();
    const result = await registered['card.action.trigger']({
      context: { open_message_id: 'om-id-lookup-flat' },
      action: { tag: 'button', name: 'id_lookup_submit', behaviors: [{ type: 'callback', value: { action: 'id_lookup' } }], form_value: { lookup_query: '565' } },
    });

    expect(sent).toEqual([]);
    expect(result).toMatchObject({ card: { type: 'raw', data: { schema: '2.0' } } });
    expect(JSON.stringify((result as any).card.data)).toContain('"tag":"column_set"');
    expect(JSON.stringify((result as any).card.data)).toContain('2000000000000000000001');
    expect(JSON.stringify((result as any).card.data)).not.toContain('查询结果');
  });

  it('persists operations learning feedback and replies with the next card', async () => {
    const outputDir = await writeContext();
    await seedLearningSession(outputDir);
    const registered: Record<string, (data: unknown) => Promise<void>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir, sdk: fakeSdk(sent, registered) });

    bot.start();
    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-feedback' },
        operator: { open_id: 'ou_sdk_reviewer' },
        action: { tag: 'button', input_value: '建议先看库存', value: { action: 'operations_learning_feedback', date: '2026-06-11', productId: '565', feedback: 'suggested_action', questionIndex: 1 } },
      },
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'reply', request: { path: { message_id: 'om-feedback' }, data: { msg_type: 'interactive' } } });
    expect(JSON.parse((sent[0] as { request: { data: { content: string } } }).request.data.content).header.title.content).toBe('运营学习 loop 测验 2/2');
    await expect(readFile(join(outputDir, '2026-06-11', 'operations-learning-session.json'), 'utf8')).resolves.toContain('建议先看库存');
    await expect(readFile(join(outputDir, '2026-06-11', 'operations-learning-session.json'), 'utf8')).resolves.toContain('ou_sdk_reviewer');
  });

  it('rejects malformed operations learning feedback callbacks', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-empty-learning-'));
    const registered: Record<string, (data: unknown) => Promise<void>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir, sdk: fakeSdk(sent, registered) });

    bot.start();
    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-feedback-malformed' },
        action: { tag: 'button', value: { action: 'operations_learning_feedback', productId: '565', feedback: 'reasonable' } },
      },
    });

    expect(sent).toEqual([
      { kind: 'reply', request: { path: { message_id: 'om-feedback-malformed' }, data: { content: JSON.stringify({ text: '运营学习反馈回调缺少必要字段。' }), msg_type: 'text' } } },
    ]);
  });

  it('stops operations learning from a card action and replaces the current card', async () => {
    const outputDir = await writeContext();
    await seedLearningSession(outputDir);
    const registered: Record<string, (data: unknown) => Promise<unknown>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir, sdk: fakeSdk(sent, registered) });

    bot.start();
    const result = await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-learning-stop' },
        operator: { open_id: 'ou_stop' },
        action: { tag: 'button', value: { action: 'operations_learning_stop', date: '2026-06-11' } },
      },
    });
    await Promise.resolve();

    expect(JSON.stringify(result)).toContain('运营学习已停止');
    expect(sent).toEqual([
      expect.objectContaining({ kind: 'patch', request: expect.objectContaining({ path: { message_id: 'om-learning-stop' } }) }),
    ]);
    await expect(readFile(join(outputDir, '2026-06-11', 'operations-learning-session.json'), 'utf8')).resolves.toContain('ou_stop');
  });

  it('replies with the next operations learning question after feedback', async () => {
    const outputDir = await writeContext();
    await seedLearningSession(outputDir);
    const registered: Record<string, (data: unknown) => Promise<void>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir, sdk: fakeSdk(sent, registered) });

    bot.start();
    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-feedback-next' },
        action: { tag: 'button', value: { action: 'operations_learning_feedback', date: '2026-06-11', productId: '565', feedback: 'reasonable', questionIndex: 1 } },
      },
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'reply', request: { path: { message_id: 'om-feedback-next' }, data: { msg_type: 'interactive' } } });
    expect(JSON.stringify(sent[0])).toContain('运营学习 loop 测验 2/2');
    expect(JSON.stringify(sent[0])).toContain('端内ID 566');
  });

  it('persists operations learning feedback when callback value is returned through behaviors', async () => {
    const outputDir = await writeContext();
    await seedLearningSession(outputDir);
    const registered: Record<string, (data: unknown) => Promise<void>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir, sdk: fakeSdk(sent, registered) });

    bot.start();
    await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-feedback-behavior' },
        action: { tag: 'button', behaviors: [{ type: 'callback', value: { action: 'operations_learning_feedback', date: '2026-06-11', productId: '565', feedback: 'reasonable', questionIndex: 1 } }] },
      },
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'reply', request: { path: { message_id: 'om-feedback-behavior' }, data: { msg_type: 'interactive' } } });
    await expect(readFile(join(outputDir, '2026-06-11', 'operations-learning-session.json'), 'utf8')).resolves.toContain('reasonable');
  });

  it('persists operations learning feedback when SDK returns flattened card action data', async () => {
    const outputDir = await writeContext();
    await seedLearningSession(outputDir);
    const registered: Record<string, (data: unknown) => Promise<void>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir, sdk: fakeSdk(sent, registered) });

    bot.start();
    await registered['card.action.trigger']({
      context: { open_message_id: 'om-feedback-flat' },
      action: { tag: 'button', behaviors: [{ type: 'callback', value: { action: 'operations_learning_feedback', date: '2026-06-11', productId: '565', feedback: 'reasonable', questionIndex: 1 } }] },
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'reply', request: { path: { message_id: 'om-feedback-flat' }, data: { msg_type: 'interactive' } } });
    await expect(readFile(join(outputDir, '2026-06-11', 'operations-learning-session.json'), 'utf8')).resolves.toContain('reasonable');
  });


  it('replaces the proactive maintenance reminder card with the first review card', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-link-maintenance-sdk-'));
    await seedLinkMaintenanceSession(outputDir);
    const registered: Record<string, (data: unknown) => Promise<void>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir, sdk: fakeSdk(sent, registered) });

    bot.start();
    const result = await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-link-maintenance-start' },
        action: {
          tag: 'button',
          name: 'link_registry_maintenance_start_submit',
          behaviors: [{ type: 'callback', value: { action: 'link_registry_maintenance_start', date: '2026-06-24' } }],
        },
      },
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'patch', request: { path: { message_id: 'om-link-maintenance-start' } } });
    expect(result).toMatchObject({ card: { type: 'raw', data: { schema: '2.0' } } });
    expect(JSON.stringify((result as any).card.data)).toContain('link_registry_maintenance_form');
    expect(JSON.stringify((result as any).card.data)).toContain('Pocket3');
  });

  it('handles maintenance start callbacks that only include the Feishu form button name', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-link-maintenance-sdk-name-only-'));
    await seedLinkMaintenanceSession(outputDir);
    const registered: Record<string, (data: unknown) => Promise<void>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir, sdk: fakeSdk(sent, registered) });

    bot.start();
    const result = await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-link-maintenance-start-name-only' },
        action: {
          tag: 'button',
          name: 'link_registry_maintenance_start_submit',
        },
      },
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'patch', request: { path: { message_id: 'om-link-maintenance-start-name-only' } } });
    expect(result).toMatchObject({ card: { type: 'raw', data: { schema: '2.0' } } });
    expect(JSON.stringify((result as any).card.data)).toContain('link_registry_maintenance_form');
  });

  it('replaces the maintenance reminder card with a non-clickable ignored status card', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-link-maintenance-sdk-ignore-'));
    await seedLinkMaintenanceSession(outputDir);
    const registered: Record<string, (data: unknown) => Promise<void>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir, sdk: fakeSdk(sent, registered) });

    bot.start();
    const result = await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-link-maintenance-ignore' },
        action: { tag: 'button', value: { action: 'link_registry_maintenance_ignore', date: '2026-06-24' } },
      },
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'patch', request: { path: { message_id: 'om-link-maintenance-ignore' } } });
    expect(result).toMatchObject({ card: { type: 'raw', data: { schema: '2.0' } } });
    expect(JSON.stringify((result as any).card.data)).not.toContain('link_registry_maintenance_start');
    expect(JSON.stringify((result as any).card.data)).not.toContain('\"tag\":\"button\"');
  });

  it('submits link registry maintenance edits and replaces the card with a completion status', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-link-maintenance-sdk-submit-'));
    const overridesPath = await seedLinkMaintenanceSession(outputDir);
    const registered: Record<string, (data: unknown) => Promise<void>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir, sdk: fakeSdk(sent, registered) });

    bot.start();
    const result = await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-link-maintenance-submit' },
        operator: { open_id: 'ou_link_reviewer' },
        action: {
          tag: 'button',
          value: { action: 'link_registry_maintenance_submit', date: '2026-06-24', internalProductId: '702', reviewIndex: 1 },
          form_value: {
            decision: 'accept_with_edit',
            same_sku_group_id_custom: 'dji-pocket-3',
            category_id: 'camera',
            product_type: 'gimbal-camera',
            short_name: 'DJI Pocket 3',
          },
        },
      },
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'patch', request: { path: { message_id: 'om-link-maintenance-submit' } } });
    expect(result).toMatchObject({ card: { type: 'raw', data: { schema: '2.0' } } });
    expect(JSON.stringify((result as any).card.data)).toContain('2026-06-24');
    expect(JSON.stringify((result as any).card.data)).not.toContain('\"tag\":\"button\"');
    await expect(readFile(overridesPath, 'utf8')).resolves.toContain('"internalProductId": "702"');
    await expect(readFile(overridesPath, 'utf8')).resolves.toContain('"sameSkuGroupId": "dji-pocket-3"');
  });

  it('submits maintenance edits when Feishu omits callback value fields', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-link-maintenance-sdk-submit-name-only-'));
    const overridesPath = await seedLinkMaintenanceSession(outputDir);
    const registered: Record<string, (data: unknown) => Promise<void>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir, sdk: fakeSdk(sent, registered) });

    bot.start();
    const result = await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-link-maintenance-submit-name-only' },
        operator: { open_id: 'ou_link_reviewer_name_only' },
        action: {
          tag: 'button',
          name: 'link_registry_maintenance_submit',
          form_value: {
            decision: 'accept_with_edit',
            same_sku_group_id_custom: 'dji-pocket-3',
            category_id: 'camera',
            product_type: 'gimbal-camera',
            short_name: 'DJI Pocket 3',
          },
        },
      },
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'patch', request: { path: { message_id: 'om-link-maintenance-submit-name-only' } } });
    expect(result).toMatchObject({ card: { type: 'raw', data: { schema: '2.0' } } });
    await expect(readFile(overridesPath, 'utf8')).resolves.toContain('"internalProductId": "702"');
    await expect(readFile(overridesPath, 'utf8')).resolves.toContain('"sameSkuGroupId": "dji-pocket-3"');
  });

  it('replaces the proactive governance reminder card with the first review card', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-link-governance-sdk-'));
    await seedLinkGovernanceSession(outputDir);
    const registered: Record<string, (data: unknown) => Promise<void>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir, sdk: fakeSdk(sent, registered) });

    bot.start();
    const result = await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-link-governance-start' },
        action: { tag: 'button', value: { action: 'link_registry_governance_start', date: '2026-06-24' } },
      },
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'patch', request: { path: { message_id: 'om-link-governance-start' } } });
    expect(result).toMatchObject({ card: { type: 'raw', data: { schema: '2.0' } } });
    expect(JSON.stringify((result as any).card.data)).toContain('link_registry_governance_form');
  });

  it('handles governance start callbacks that only include the Feishu form button name', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-link-governance-sdk-name-only-'));
    await seedLinkGovernanceSession(outputDir);
    const registered: Record<string, (data: unknown) => Promise<void>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir, sdk: fakeSdk(sent, registered) });

    bot.start();
    const result = await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-link-governance-start-name-only' },
        action: {
          tag: 'button',
          name: 'link_registry_governance_start_submit',
        },
      },
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'patch', request: { path: { message_id: 'om-link-governance-start-name-only' } } });
    expect(result).toMatchObject({ card: { type: 'raw', data: { schema: '2.0' } } });
    expect(JSON.stringify((result as any).card.data)).toContain('link_registry_governance_form');
  });

  it('replaces the governance reminder card with a non-clickable ignored status card', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-link-governance-sdk-ignore-'));
    await seedLinkGovernanceSession(outputDir);
    const registered: Record<string, (data: unknown) => Promise<void>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir, sdk: fakeSdk(sent, registered) });

    bot.start();
    const result = await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-link-governance-ignore' },
        action: { tag: 'button', value: { action: 'link_registry_governance_ignore', date: '2026-06-24' } },
      },
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'patch', request: { path: { message_id: 'om-link-governance-ignore' } } });
    expect(result).toMatchObject({ card: { type: 'raw', data: { schema: '2.0' } } });
    expect(JSON.stringify((result as any).card.data)).not.toContain('link_registry_maintenance_start');
    expect(JSON.stringify((result as any).card.data)).not.toContain('\"tag\":\"button\"');
  });

  it('submits link registry governance decisions from the review card and replaces it with the next step', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-link-governance-sdk-submit-'));
    await seedLinkGovernanceSession(outputDir);
    const registered: Record<string, (data: unknown) => Promise<void>> = {};
    const sent: unknown[] = [];
    const bot = createFeishuSdkBot({ appId: 'app', appSecret: 'secret', outputDir, sdk: fakeSdk(sent, registered) });

    bot.start();
    const result = await registered['card.action.trigger']({
      event: {
        context: { open_message_id: 'om-link-governance-submit' },
        operator: { open_id: 'ou_link_governance' },
        action: {
          tag: 'button',
          value: { action: 'link_registry_governance_submit', date: '2026-06-24', reviewIndex: 1 },
          form_value: {
            decision: 'resolved',
            note: 'Pocket 3 sample backlog reviewed',
          },
        },
      },
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'patch', request: { path: { message_id: 'om-link-governance-submit' } } });
    expect(result).toMatchObject({ card: { type: 'raw', data: { schema: '2.0' } } });
    expect(JSON.stringify((result as any).card.data)).toContain('link_registry_governance_form');
    await expect(readFile(join(outputDir, '2026-06-24', 'link-registry-governance-session.json'), 'utf8')).resolves.toContain('Pocket 3 sample backlog reviewed');
    await expect(readFile(join(outputDir, '2026-06-24', 'link-registry-governance-session.json'), 'utf8')).resolves.toContain('ou_link_governance');
  });
});
