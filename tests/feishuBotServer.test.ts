import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildAgentToolConfirmCard } from '../src/agentRuntime/approvalCard.js';
import { MAX_CLARIFY_DEPTH } from '../src/agentRuntime/intentResolution.js';
import { clarificationConfirmationKey, saveClarificationContext } from '../src/feishuBot/clarificationStore.js';
import { createDailyMissionRun, saveDailyMissionRun, transitionDailyMissionRun } from '../src/agentRuntime/dailyMissionRun.js';
import { loadOperationLedgerJsonlEntries } from '../src/agentRuntime/operationLedger.js';
import { agentExploreReason } from '../src/feishuBot/agentExploreAttribution.js';
import type { AgentPlannerProvider } from '../src/agentRuntime/planner.js';
import { extractTextMessage, startFeishuBotServer } from '../src/feishuBot/server.js';
import {
  buildActivityAutomationCard,
  buildActivityCancelAssistanceCard,
  buildActivityPriceCallbackConfirmCard,
  buildCancelDifferentialPricingCard,
  type ActivityAutomationSkillClient,
  type ActivityPriceCallbackConfirmRequest,
} from '../src/feishuBot/activityAutomation.js';
import { saveAgentToolConfirmRequest } from '../src/feishuBot/agentToolConfirmStore.js';
import { openLinkRegistryGovernancePrompt } from '../src/linkRegistry/governanceSession.js';
import { openLinkRegistryMaintenancePrompt } from '../src/linkRegistry/maintenanceSession.js';
import type { LinkRegistryOverrideRisk } from '../src/linkRegistry/overrides.js';
import type { LinkRegistryEntry } from '../src/linkRegistry/types.js';
import { buildRentalOperationConfirmCard, type RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';
import { buildRefreshActivityStrategyCard } from '../src/feishuBot/refreshActivityCard.js';
import { refreshActivityPlanConfirmationKey, saveRefreshActivityPlan, type RefreshActivityPlan } from '../src/feishuBot/refreshActivityPlanStore.js';
import type { FeishuBotIncomingTextMessage } from '../src/feishuBot/types.js';
import { buildFeishuSignature } from '../src/feishuBot/verify.js';

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

function readAgentToolConfirmValue(card: unknown): unknown {
  const body = (card as { body?: { elements?: Array<{ elements?: Array<{ name?: string; behaviors?: Array<{ value?: unknown }> }> }> } }).body;
  const form = body?.elements?.find((element) => Array.isArray(element.elements));
  const button = form?.elements?.find((element) => element.name === 'agent_tool_confirm_submit');
  return button?.behaviors?.[0]?.value;
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

function completeAudit(productId: string, taskIdOrOverrides: string | Record<string, unknown> = `task_${productId}_ref`) {
  const overrides = typeof taskIdOrOverrides === 'string' ? { taskId: taskIdOrOverrides } : taskIdOrOverrides;
  return {
    taskId: `task_${productId}_ref`,
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
    ...overrides,
  };
}

function legacyPriceConfirmValue(request: Record<string, unknown>): Record<string, unknown> {
  return { action: 'rental_price_confirm', request, confirmationKey: createHash('sha256').update(JSON.stringify(request)).digest('hex').slice(0, 24) };
}

async function writeLearningContext(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mt-agent-bot-http-learning-'));
  await mkdir(join(dir, '2026-06-11'), { recursive: true });
  await writeFile(join(dir, '2026-06-11', 'report-context.json'), JSON.stringify({
    date: '2026-06-11',
    summary: { '1d': metric, '7d': metric, '30d': metric },
    conclusions: [],
    rows: [
      { productName: 'iPhone 15', platformProductId: 'p565', displayProductId: '端内ID 565', custodyDays: 10, periods: { '1d': metric, '7d': metric, '30d': metric } },
      { productName: 'Pocket 3', platformProductId: 'p566', displayProductId: '端内ID 566', custodyDays: 1, periods: { '1d': metric, '7d': metric, '30d': metric } },
    ],
    recommendedActions: [
      { identifier: '端内ID 565', action: '补曝光', reason: '曝光不足', priority: 'high' },
      { identifier: '端内ID 566', action: '提转化', reason: '访问多成交少', priority: 'high' },
    ],
    lowExposure: [],
    weakClick: [],
    weakConversion: [],
    highPotential: [],
    newProductObservation: [],
    lifecycleGovernance: [],
    agentData: { removedLinks: [] },
    emptySectionNotes: {},
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
  const rootDir = await mkdtemp(join(tmpdir(), 'mt-agent-http-continuation-registry-'));
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
    recommendedActions: [],
    lowExposure: [],
    weakClick: [],
    weakConversion: [],
    highPotential: [],
    newProductObservation: [],
    lifecycleGovernance: [],
    agentData: { removedLinks: [] },
    emptySectionNotes: {},
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

async function seedLinkMaintenanceSession(outputDir: string): Promise<void> {
  await openLinkRegistryMaintenancePrompt(outputDir, {
    date: '2026-06-24',
    registry: linkMaintenanceRegistry,
    referenceDate: '2026-06-24',
    overridesPath: join(outputDir, 'config', 'link-registry-overrides.json'),
  });
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

function fakeRentalPriceClient() {
  const calls: string[] = [];
  const client: RentalPriceSkillClient & { calls: string[] } = {
    calls,
    async preview() { throw new Error('preview should not run'); },
    async execute() { throw new Error('execute should not run'); },
    async copy(productId) {
      calls.push(productId);
      return { productId, ok: true, newProductId: '999', lines: [`复制完成: ${productId}`] };
    },
    async delist(productId) {
      calls.push(productId);
      return { productId, ok: true, lines: [`下架完成: ${productId}`] };
    },
    async tenancySet(productId, days) {
      calls.push(productId);
      return { productId, ok: true, days, lines: [`租期完成: ${productId}`] };
    },
    async specDiscover(productId) {
      calls.push(productId);
      return { productId, ok: true, dimensions: [], lines: [`规格读取完成: ${productId}`] };
    },
    async specAddAndRefresh(productId, _specDimId, itemTitle) {
      calls.push(productId);
      return { productId, ok: true, itemTitle, lines: [`规格添加完成: ${productId}`] };
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

async function writeActivitySubmitSessionFixture(status: string = 'price_callback_pending'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mt-agent-activity-cancel-http-'));
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

describe('extractTextMessage', () => {
  it('extracts Feishu text content', () => {
    expect(extractTextMessage({ event: { message: { message_id: 'mid', message_type: 'text', content: JSON.stringify({ text: '今日概况' }) } } } as any)).toEqual({ messageId: 'mid', text: '今日概况' });
  });

  it('ignores non-text messages', () => {
    expect(extractTextMessage({ event: { message: { message_id: 'mid', message_type: 'image', content: '{}' } } } as any)).toBeNull();
  });
});

describe('dashboard refresh HTTP card delivery contract', () => {
  it('replies with an executor-provided orange refresh card instead of generic green completion text', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-http-dashboard-refresh-card-'));
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
    const cards: Array<{ messageId: string; card: Record<string, unknown> }> = [];
    const texts: Array<{ messageId: string; text: string }> = [];
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir,
      replyCard: async ({ messageId }, card) => {
        cards.push({ messageId, card });
        return { sent: true, channel: 'app' };
      },
      replyText: async ({ messageId }, text) => {
        texts.push({ messageId, text });
        return { sent: true, channel: 'app' };
      },
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
      const confirmValue = readAgentToolConfirmValue(buildAgentToolConfirmCard({
        toolName: 'publicTraffic.refreshDashboard',
        arguments: { date: '2026-06-24' },
        reason: '补抓 2026-06-24 访问页',
      }));

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: { event_type: 'card.action.trigger' },
          event: { context: { open_message_id: 'mid-http-dashboard-refresh-card' }, action: { value: confirmValue } },
        }),
      });

      expect(response.status).toBe(200);
      expect(dashboardRefreshMocks.runDashboardRefresh).toHaveBeenCalledWith({ config, dataDate: '2026-06-24', sendTo: undefined });
      expect(texts).toEqual([]);
      expect(cards).toHaveLength(1);
      expect(cards[0]?.messageId).toBe('mid-http-dashboard-refresh-card');
      expect((cards[0]?.card as { header?: { title?: { content?: string }; template?: string } }).header?.title?.content).toBe('访问页补抓完成，但数据仍未完整');
      expect((cards[0]?.card as { header?: { template?: string } }).header?.template).toBe('orange');
      expect(JSON.stringify(cards[0]?.card)).toContain('rowCount=0');
      expect(JSON.stringify(cards[0]?.card)).toContain('未重建、未重发');
      expect(JSON.stringify(cards[0]?.card)).not.toContain('Agent 操作已完成');
    } finally {
      server.close();
    }
  });
});

describe('startFeishuBotServer', () => {
  it('responds to Feishu URL verification challenge', async () => {
    const server = startFeishuBotServer({ port: 0, appId: 'app', appSecret: 'secret', verificationToken: 'token' });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'url_verification', challenge: 'challenge-value', token: 'token' }),
      });

      await expect(response.json()).resolves.toEqual({ challenge: 'challenge-value' });
    } finally {
      server.close();
    }
  });

  it('does not treat encrypt key as request signature secret for url verification', async () => {
    const server = startFeishuBotServer({ port: 0, appId: 'app', appSecret: 'secret', verificationToken: 'token', encryptKey: 'encrypt-key' });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'url_verification', challenge: 'challenge-value', token: 'token' }),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ challenge: 'challenge-value' });
    } finally {
      server.close();
    }
  });

  it('rejects unsigned HTTP agent tool confirmations when no callback signature secret is configured', async () => {
    const server = startFeishuBotServer({ port: 0, appId: 'app', appSecret: 'secret', verificationToken: 'token', encryptKey: 'encrypt-key' });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: { event_type: 'card.action.trigger' },
          event: { context: { open_message_id: 'mid-forged' }, action: { value: { action: 'agent_tool_confirm' } } },
        }),
      });

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: 'missing callback signature secret' });
    } finally {
      server.close();
    }
  });

  it('rejects unsigned HTTP inactive refresh execute-select callbacks when no callback signature secret is configured', async () => {
    const server = startFeishuBotServer({ port: 0, appId: 'app', appSecret: 'secret', verificationToken: 'token' });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: { event_type: 'card.action.trigger' },
          event: {
            context: { open_message_id: 'mid-forged-inactive-refresh' },
            action: {
              name: 'inactive_refresh_execute_submit',
              behaviors: [{ type: 'callback', value: { action: 'inactive_refresh_execute_select', planRef: 'inactive_refresh_1_deadbeefdeadbeef', confirmationKey: 'key' } }],
            },
          },
        }),
      });

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: 'missing callback signature secret' });
    } finally {
      server.close();
    }
  });

  it('rejects unsigned HTTP card callbacks when callback signature secret is configured', async () => {
    const server = startFeishuBotServer({ port: 0, appId: 'app', appSecret: 'secret', verificationToken: 'token', callbackSignatureSecret: 'signature-secret' });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: { event_type: 'card.action.trigger' },
          event: { context: { open_message_id: 'mid-forged' }, action: { value: { action: 'agent_tool_confirm' } } },
        }),
      });

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: 'invalid signature' });
    } finally {
      server.close();
    }
  });

  it('accepts signed HTTP card callbacks when callback signature secret is configured', async () => {
    const server = startFeishuBotServer({ port: 0, appId: 'app', appSecret: 'secret', verificationToken: 'token', callbackSignatureSecret: 'signature-secret' });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
      const body = JSON.stringify({
        header: { event_type: 'card.action.trigger' },
        event: { context: { open_message_id: 'mid-signed' }, action: { value: { action: 'unknown' } } },
      });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const nonce = 'nonce';

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Lark-Request-Timestamp': timestamp,
          'X-Lark-Request-Nonce': nonce,
          'X-Lark-Signature': buildFeishuSignature(timestamp, nonce, body, 'signature-secret'),
        },
        body,
      });

      expect(response.status).toBe(200);
    } finally {
      server.close();
    }
  });

  it('rejects stale signed HTTP card callbacks when callback signature secret is configured', async () => {
    const server = startFeishuBotServer({ port: 0, appId: 'app', appSecret: 'secret', verificationToken: 'token', callbackSignatureSecret: 'signature-secret' });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
      const body = JSON.stringify({
        header: { event_type: 'card.action.trigger' },
        event: { context: { open_message_id: 'mid-stale-signed' }, action: { value: { action: 'unknown' } } },
      });
      const timestamp = String(Math.floor(Date.now() / 1000) - 601);
      const nonce = 'nonce-stale';
      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Lark-Request-Timestamp': timestamp,
          'X-Lark-Request-Nonce': nonce,
          'X-Lark-Signature': buildFeishuSignature(timestamp, nonce, body, 'signature-secret'),
        },
        body,
      });

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: 'stale signature' });
    } finally {
      server.close();
    }
  });

  it('routes text event through dispatcher and replies', async () => {
    const replies: Array<{ messageId: string; text: string }> = [];
    const cards: Array<{ messageId: string; card: unknown }> = [];
    const messages: FeishuBotIncomingTextMessage[] = [];
    let resolveReplySent!: () => void;
    const replySent = new Promise<void>((resolve) => {
      resolveReplySent = resolve;
    });
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      dispatchMessage: async (message) => {
        messages.push(message);
        return { text: `handled:${message.text}`, skipped: false };
      },
      replyText: async ({ messageId }, text) => {
        replies.push({ messageId, text });
        resolveReplySent();
        return { sent: true, channel: 'app' };
      },
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: { message: { message_id: 'mid-http-route', chat_id: 'chat', message_type: 'text', content: JSON.stringify({ text: '今日概况' }) }, sender: { sender_id: { open_id: 'ou_1' } } } }),
      });

      expect(response.status).toBe(200);
      await replySent;
      expect(messages).toEqual([{ messageId: 'mid-http-route', text: '今日概况', source: 'http', chatId: 'chat', senderOpenId: 'ou_1' }]);
      expect(replies).toEqual([{ messageId: 'mid-http-route', text: 'handled:今日概况' }]);
    } finally {
      server.close();
    }
  });

  it('replies with an interactive card when dispatcher returns a card', async () => {
    const cards: Array<{ messageId: string; card: Record<string, unknown> }> = [];
    let resolveReplySent!: () => void;
    const replySent = new Promise<void>((resolve) => {
      resolveReplySent = resolve;
    });
    const card = { schema: '2.0', body: { elements: [] } };
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      dispatchMessage: async () => ({ text: 'card fallback', card, skipped: false }),
      replyCard: async ({ messageId }, payload) => {
        cards.push({ messageId, card: payload });
        resolveReplySent();
        return { sent: true, channel: 'app' };
      },
      replyText: async () => {
        throw new Error('replyText should not be called for card responses');
      },
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: { message: { message_id: 'mid-http-card', message_type: 'text', content: JSON.stringify({ text: '商品ID互查' }) } } }),
      });

      expect(response.status).toBe(200);
      await replySent;
      expect(cards).toEqual([{ messageId: 'mid-http-card', card }]);
    } finally {
      server.close();
    }
  });

  it('keeps product-modifying exact HTTP text commands planner-first but opens operations learning locally', async () => {
    const outputDir = await writeLearningContext();
    const cards: Array<{ messageId: string; card: Record<string, unknown> }> = [];
    const texts: Array<{ messageId: string; text: string }> = [];
    const plannerMessages: string[] = [];
    let resolveCardsSent!: () => void;
    const cardsSent = Promise.race([
      new Promise<void>((resolve) => {
        resolveCardsSent = resolve;
      }),
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error('timed out waiting for planner-first cards')), 2000)),
    ]);
    const planner: AgentPlannerProvider = {
      async proposePlan(request) {
        plannerMessages.push(request.message);
        expect(request.workflows).toEqual([]);
        if (request.message === '复制商品 761') {
          return JSON.stringify({
            goal: '复制商品 761',
            selectedTool: 'rental.copy',
            arguments: { productId: '761' },
            confidence: 0.96,
            reason: '用户要求复制商品，必须确认',
          });
        }
        throw new Error(`unexpected planner message: ${request.message}`);
      },
    };
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir,
      agentPlannerProvider: planner,
      replyCard: async ({ messageId }, card) => {
        cards.push({ messageId, card });
        if (cards.length === 2) resolveCardsSent();
        return { sent: true, channel: 'app' };
      },
      replyText: async ({ messageId }, text) => {
        texts.push({ messageId, text });
        return { sent: true, channel: 'app' };
      },
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');

      for (const [index, text] of ['运营学习', '复制商品 761'].entries()) {
        const response = await fetch(`http://127.0.0.1:${address.port}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: { message: { message_id: `mid-http-planner-first-${index}`, message_type: 'text', content: JSON.stringify({ text }) } } }),
        });
        expect(response.status).toBe(200);
      }

      await cardsSent;
      expect(plannerMessages).toEqual(['复制商品 761']);
      expect(texts).toEqual([]);
      const cardByMessageId = new Map(cards.map((item) => [item.messageId, item.card]));
      const learningCard = JSON.stringify(cardByMessageId.get('mid-http-planner-first-0'));
      const copyCard = JSON.stringify(cardByMessageId.get('mid-http-planner-first-1'));
      expect(learningCard).toContain('运营学习 loop 测验');
      expect(copyCard).toContain('rental.copy');
      expect(copyCard).toContain('agent_tool_confirm');
    } finally {
      server.close();
    }
  });

  it('returns an updated card for HTTP card action id lookup callbacks', async () => {
    const replies: Array<{ messageId: string; text: string }> = [];
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir: await mkdtemp(join(tmpdir(), 'mt-agent-bot-http-empty-')),
      replyText: async ({ messageId }, text) => {
        replies.push({ messageId, text });
        return { sent: true, channel: 'app' };
      },
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: { event_type: 'card.action.trigger' },
          event: {
            context: { open_message_id: 'mid-http-id-card' },
            action: { value: { action: 'id_lookup' }, form_value: { lookup_query: '565' } },
          },
        }),
      });

      expect(response.status).toBe(200);
      const card = await response.json();
      expect(JSON.stringify(card)).toContain('还没有找到公域日报上下文。');
      expect(JSON.stringify(card)).not.toContain('查询结果');
      expect(JSON.stringify(card)).not.toContain('"tag":"hr"');
      expect(replies).toEqual([]);
    } finally {
      server.close();
    }
  });

  it('handles HTTP query full-list callbacks by replying with read-only text', async () => {
    const replies: Array<{ messageId: string; text: string }> = [];
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-bot-http-query-full-list-'));
    await mkdir(join(outputDir, '2026-06-11'), { recursive: true });
    await writeFile(join(outputDir, '2026-06-11', 'report-context.json'), JSON.stringify({
      date: '2026-06-11',
      summary: { '1d': metric, '7d': metric, '30d': metric },
      conclusions: [],
      rows: [
        { productName: '托管异常商品', platformProductId: 'platform-565', displayProductId: '端内ID 565', custodyDays: 10, periods: { '1d': metric, '7d': metric, '30d': metric } },
      ],
      recommendedActions: [],
      lowExposure: [],
      weakClick: [],
      weakConversion: [],
      highPotential: [],
      newProductObservation: [],
      lifecycleGovernance: [],
      custodyAbnormal: [{ identifier: '端内ID 565', action: '检查托管', reason: '托管异常', priority: 'high' }],
      agentData: { removedLinks: [] },
      emptySectionNotes: {},
    }), 'utf8');
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir,
      callbackSignatureSecret: 'signature-secret',
      replyText: async ({ messageId }, text) => {
        replies.push({ messageId, text });
        return { sent: true, channel: 'app' };
      },
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
      const body = JSON.stringify({
        header: { event_type: 'card.action.trigger' },
        event: {
          context: { open_message_id: 'mid-http-query-full-list' },
          action: { name: 'query_full_list_submit', behaviors: [{ type: 'callback', value: { action: 'query_full_list', queryRef: '2026-06-11:custodyAbnormal' } }] },
        },
      });
      const timestamp = '1710000000';
      const nonce = 'nonce';

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Lark-Request-Timestamp': timestamp,
          'X-Lark-Request-Nonce': nonce,
          'X-Lark-Signature': buildFeishuSignature(timestamp, nonce, body, 'signature-secret'),
        },
        body,
      });

      expect(response.status).toBe(200);
      expect(replies).toHaveLength(1);
      expect(replies[0]).toEqual(expect.objectContaining({ messageId: 'mid-http-query-full-list' }));
      expect(replies[0]?.text).toContain('托管异常完整清单 2026-06-11');
      expect(replies[0]?.text).toContain('端内ID 565｜商品ID platform-565');
      const card = await response.json();
      const cardText = JSON.stringify(card);
      expect(cardText).toContain('完整清单已发送');
      expect(cardText).not.toContain('端内ID 565｜商品ID platform-565');
    } finally {
      server.close();
    }
  });

  it('rejects unsigned HTTP query full-list callbacks when no callback signature secret is configured', async () => {
    const server = startFeishuBotServer({ port: 0, appId: 'app', appSecret: 'secret' });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: { event_type: 'card.action.trigger' },
          event: {
            context: { open_message_id: 'mid-http-query-full-list-unsigned' },
            action: { name: 'query_full_list_submit', behaviors: [{ type: 'callback', value: { action: 'query_full_list', queryRef: '2026-06-11:custodyAbnormal' } }] },
          },
        }),
      });

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: 'missing callback signature secret' });
    } finally {
      server.close();
    }
  });

  it('returns a replacement card for malformed HTTP new-link confirmations without text replies', async () => {
    const replies: Array<{ messageId: string; text: string }> = [];
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir: await mkdtemp(join(tmpdir(), 'mt-agent-bot-http-new-link-malformed-')),
      replyText: async ({ messageId }, text) => {
        replies.push({ messageId, text });
        return { sent: true, channel: 'app' };
      },
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: { event_type: 'card.action.trigger' },
          event: {
            context: { open_message_id: 'mid-http-new-link-malformed' },
            action: {
              tag: 'button',
              name: 'new_link_batch_confirm_submit',
              value: { action: 'new_link_batch_confirm' },
            },
          },
        }),
      });

      expect(response.status).toBe(200);
      expect(JSON.stringify(await response.json())).toContain('新链批量复制确认异常');
      expect(replies).toEqual([]);
    } finally {
      server.close();
    }
  });

  it('returns replacement cards for HTTP Agent clarification cancellation and duplicate clicks', async () => {
    const replies: Array<{ messageId: string; text: string }> = [];
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-bot-http-clarify-cancel-'));
    const context = {
      originalMessage: '抓取访问页数据',
      question: '你想抓取哪类访问页数据？',
      reason: '用户目标不明确',
      candidates: [{ toolName: 'report.fetchVisitPage', arguments: {}, label: '抓取访问页数据' }],
      depth: 1,
      confidence: 0.4,
    };
    const clarificationRef = await saveClarificationContext(outputDir, context);
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir,
      replyText: async ({ messageId }, text) => {
        replies.push({ messageId, text });
        return { sent: true, channel: 'app' };
      },
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
      const body = {
        header: { event_type: 'card.action.trigger' },
        event: {
          context: { open_message_id: 'mid-http-agent-clarify-cancel' },
          operator: { open_id: 'ou_http_cancel' },
          action: {
            name: 'agent_clarify_cancel',
            behaviors: [{ type: 'callback', value: { action: 'agent_clarify_cancel', clarificationRef, confirmationKey: clarificationConfirmationKey(context) } }],
          },
        },
      };

      const first = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const second = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(JSON.stringify(await first.json())).toContain('已取消');
      expect(JSON.stringify(await second.json())).toContain('已经取消');
      expect(replies).toEqual([]);
    } finally {
      server.close();
    }
  });

  it('returns replacement cards for HTTP Agent tool cancellation and duplicate clicks', async () => {
    const replies: Array<{ messageId: string; text: string }> = [];
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir: await mkdtemp(join(tmpdir(), 'mt-agent-bot-http-tool-cancel-')),
      replyText: async ({ messageId }, text) => {
        replies.push({ messageId, text });
        return { sent: true, channel: 'app' };
      },
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
      const body = {
        header: { event_type: 'card.action.trigger' },
        event: {
          context: { open_message_id: 'mid-http-agent-tool-cancel' },
          operator: { open_id: 'ou_http_cancel' },
          action: {
            name: 'agent_tool_cancel_submit',
            behaviors: [{ type: 'callback', value: { action: 'agent_tool_cancel', toolName: 'publicTraffic.runReport' } }],
          },
        },
      };

      const first = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const second = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(JSON.stringify(await first.json())).toContain('已取消');
      expect(JSON.stringify(await second.json())).toContain('已经取消');
      expect(replies).toEqual([]);
    } finally {
      server.close();
    }
  });

  it('resolves requestRef-only HTTP Agent tool cancellation through the stored request', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-bot-http-tool-ref-cancel-'));
    const request = {
      toolName: 'rental.delist',
      arguments: { productId: '648' },
      reason: '[[dailyMission:runId=run-ref-cancel;decisionId=dec-ref-cancel]] 下架确认取消',
    };
    const requestRef = await saveAgentToolConfirmRequest(outputDir, request);
    const card = buildAgentToolConfirmCard(request, { requestRef });
    const cancelValue = readButtonValue(card, 'agent_tool_cancel_submit');
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir,
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: { event_type: 'card.action.trigger' },
          event: {
            context: { open_message_id: 'mid-http-agent-tool-ref-cancel' },
            operator: { open_id: 'ou_http_ref_cancel' },
            action: { name: 'agent_tool_cancel_submit', behaviors: [{ type: 'callback', value: cancelValue }] },
          },
        }),
      });

      expect(response.status).toBe(200);
      expect(JSON.stringify(await response.json())).toContain('rental.delist');
      const date = new Date().toISOString().slice(0, 10);
      const entries = await loadOperationLedgerJsonlEntries(outputDir, date);
      expect(entries).toEqual(expect.arrayContaining([
        expect.objectContaining({ event: 'approval_rejected', runId: 'run-ref-cancel', decisionId: 'dec-ref-cancel', toolName: 'rental.delist', subject: { kind: 'product', id: '648' } }),
      ]));
    } finally {
      server.close();
    }
  });

  it('fails closed for unresolved requestRef-only HTTP Agent tool cancellation', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-bot-http-tool-ref-cancel-missing-'));
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir,
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: { event_type: 'card.action.trigger' },
          event: {
            context: { open_message_id: 'mid-http-agent-tool-ref-cancel-missing' },
            operator: { open_id: 'ou_http_ref_cancel_missing' },
            action: {
              name: 'agent_tool_cancel_submit',
              behaviors: [{ type: 'callback', value: { action: 'agent_tool_cancel', requestRef: 'agent_tool_missing_ref', confirmationKey: '0123456789abcdef01234567' } }],
            },
          },
        }),
      });

      expect(response.status).toBe(200);
      expect(JSON.stringify(await response.json())).toContain('取消异常');
      const date = new Date().toISOString().slice(0, 10);
      expect(await loadOperationLedgerJsonlEntries(outputDir, date)).toEqual([]);
    } finally {
      server.close();
    }
  });

  it('does not dispatch duplicate HTTP Agent clarification selections from the same card', async () => {
    const replies: Array<{ messageId: string; text: string }> = [];
    const cards: Array<{ messageId: string; card: unknown }> = [];
    const dispatched: FeishuBotIncomingTextMessage[] = [];
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-bot-http-clarify-select-'));
    const context = {
      originalMessage: '抓取访问页数据',
      question: '你想怎么处理访问页数据？',
      reason: '动作不明确',
      candidates: [{ toolName: 'publicTraffic.refreshDashboard', arguments: {}, label: '补抓访问页' }],
      depth: 1,
      confidence: 0.4,
    };
    const clarificationRef = await saveClarificationContext(outputDir, context);
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir,
      dispatchMessage: async (message) => {
        dispatched.push(message);
        return { text: '澄清后结果', skipped: false };
      },
      replyText: async ({ messageId }, text) => {
        replies.push({ messageId, text });
        return { sent: true, channel: 'app' };
      },
      replyCard: async ({ messageId }, card) => {
        cards.push({ messageId, card });
        return { sent: true, channel: 'app' };
      },
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
      const body = {
        header: { event_type: 'card.action.trigger' },
        event: {
          context: { open_message_id: 'mid-http-agent-clarify-select' },
          action: {
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
      };

      const first = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const second = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(dispatched.map((message) => message.text)).toEqual([]);
      expect(replies).toEqual([]);
      expect(JSON.stringify(cards[0]?.card)).toContain('agent_tool_confirm');
      expect(JSON.stringify(await second.json())).toContain('已经执行完成');
    } finally {
      server.close();
    }
  });

  it('resumes a referenced HTTP clarification candidate into the existing Agent confirmation path', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-bot-http-clarify-resume-'));
    const replies: Array<{ messageId: string; text: string }> = [];
    const cards: Array<{ messageId: string; card: unknown }> = [];
    const context = {
      originalMessage: '帮我把 648 下架',
      question: '你想怎么处理 648？',
      reason: '动作不明确',
      candidates: [{ toolName: 'rental.delist', arguments: { productId: '648' }, label: '下架 648' }],
      depth: 1,
      confidence: 0.42,
    };
    const clarificationRef = await saveClarificationContext(outputDir, context);
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir,
      dispatchMessage: async () => { throw new Error('clarification select must not replay text'); },
      replyText: async ({ messageId }, text) => {
        replies.push({ messageId, text });
        return { sent: true, channel: 'app' };
      },
      replyCard: async ({ messageId }, card) => {
        cards.push({ messageId, card });
        return { sent: true, channel: 'app' };
      },
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
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: { event_type: 'card.action.trigger' },
          event: {
            context: { open_message_id: 'mid-http-agent-clarify-resume' },
            action: {
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
        }),
      });

      expect(response.status).toBe(200);
      expect(replies).toEqual([]);
      expect(JSON.stringify(cards[0]?.card)).toContain('agent_tool_confirm');
      expect(JSON.stringify(cards[0]?.card)).toContain('rental.delist');
    } finally {
      server.close();
    }
  });

  it('preserves HTTP clarification depth when a selected locked candidate needs another clarification', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-bot-http-clarify-depth-'));
    const replies: Array<{ messageId: string; text: string }> = [];
    const cards: Array<{ messageId: string; card: unknown }> = [];
    const context = {
      originalMessage: '商品 648 下调 10',
      question: '你想怎么调整 648？',
      reason: '商品 648 下调 10',
      candidates: [{ toolName: 'rental.pricePreview', arguments: { productIds: ['648'] }, label: '预览调价' }],
      depth: MAX_CLARIFY_DEPTH,
      confidence: 0.42,
    };
    const clarificationRef = await saveClarificationContext(outputDir, context);
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir,
      dispatchMessage: async () => { throw new Error('clarification select must not replay text'); },
      replyText: async ({ messageId }, text) => {
        replies.push({ messageId, text });
        return { sent: true, channel: 'app' };
      },
      replyCard: async ({ messageId }, card) => {
        cards.push({ messageId, card });
        return { sent: true, channel: 'app' };
      },
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: { event_type: 'card.action.trigger' },
          event: {
            context: { open_message_id: 'mid-http-agent-clarify-depth' },
            action: {
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
        }),
      });

      expect(response.status).toBe(200);
      expect(replies[0]?.text).toContain('我还是没法确定你的意图');
      expect(cards).toEqual([]);
    } finally {
      server.close();
    }
  });

  it('replies with a price callback confirmation card after differential pricing automation completes', async () => {
    const cards: Array<{ messageId: string; card: Record<string, unknown> }> = [];
    let resolveReplySent!: () => void;
    const replySent = new Promise<void>((resolve) => {
      resolveReplySent = resolve;
    });
    const activityAutomationClient = fakeActivityAutomationClient();
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir: 'output',
      activityAutomationClient,
      replyCard: async ({ messageId }, card) => {
        cards.push({ messageId, card });
        resolveReplySent();
        return { sent: true, channel: 'app' };
      },
      replyText: async () => {
        throw new Error('replyText should not be called when a callback confirmation card is available');
      },
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
      const confirmValue = readButtonValue(buildActivityAutomationCard(), 'activity_automation_confirm_submit');

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: { event_type: 'card.action.trigger' },
          event: {
            context: { open_message_id: 'mid-http-activity-card' },
            action: {
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
        }),
      });

      expect(response.status).toBe(200);
      await replySent;
      expect(activityAutomationClient.executions).toEqual([
        {
          startsAt: '2026-06-23',
          endsAt: '2026-06-30',
          discounts: { SS: '8.5', S: '9.0', A: '9.5', B: '9.8' },
        },
      ]);
      expect(cards).toHaveLength(1);
      expect(cards[0]?.messageId).toBe('mid-http-activity-card');
      expect(JSON.stringify(cards[0]?.card)).toContain('activity_price_callback_confirm');
      expect(JSON.stringify(cards[0]?.card)).not.toContain('activity_cancel_open');
      expect(JSON.stringify(cards[0]?.card)).toContain('activity-submit-session.json');
      expect(JSON.stringify(cards[0]?.card)).toContain('770');
    } finally {
      server.close();
    }
  });

  it('rejects unsigned HTTP differential pricing automation callbacks', async () => {
    const replies: Array<{ messageId: string; text: string }> = [];
    const activityAutomationClient = fakeActivityAutomationClient();
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir: 'output',
      activityAutomationClient,
      replyText: async ({ messageId }, text) => {
        replies.push({ messageId, text });
        return { sent: true, channel: 'app' };
      },
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: { event_type: 'card.action.trigger' },
          event: {
            context: { open_message_id: 'mid-http-activity-card-unsigned' },
            action: {
              value: { action: 'activity_automation_confirm' },
              form_value: {
                starts_at: '2026-06-23',
                ends_at: '2026-06-30',
              },
            },
          },
        }),
      });

      expect(response.status).toBe(200);
      expect(activityAutomationClient.executions).toEqual([]);
      expect(replies).toEqual([{ messageId: 'mid-http-activity-card-unsigned', text: '差异化定价确认参数无效，请重新发起。' }]);
    } finally {
      server.close();
    }
  });

  it('accepts nested differential_pricing_form values in HTTP differential pricing callbacks', async () => {
    const cards: Array<{ messageId: string; card: unknown }> = [];
    let resolveReplySent!: () => void;
    const replySent = new Promise<void>((resolve) => {
      resolveReplySent = resolve;
    });
    const activityAutomationClient = fakeActivityAutomationClient();
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir: 'output',
      activityAutomationClient,
      replyCard: async ({ messageId }, card) => {
        cards.push({ messageId, card });
        resolveReplySent();
        return { sent: true, channel: 'app' };
      },
      replyText: async () => {
        throw new Error('replyText should not be called when nested differential pricing values are provided');
      },
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
      const confirmValue = readButtonValue(buildActivityAutomationCard(), 'activity_automation_confirm_submit');

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: { event_type: 'card.action.trigger' },
          event: {
            context: { open_message_id: 'mid-http-activity-card-nested' },
            action: {
              value: confirmValue,
              form_value: {
                differential_pricing_form: {
                  starts_at: '2026-06-24',
                  ends_at: '2026-06-30',
                },
              },
            },
          },
        }),
      });

      expect(response.status).toBe(200);
      await replySent;
      expect(activityAutomationClient.executions).toEqual([
        {
          startsAt: '2026-06-24',
          endsAt: '2026-06-30',
          discounts: { SS: '8.5', S: '9.0', A: '9.5', B: '9.8' },
        },
      ]);
      expect(cards).toHaveLength(1);
      expect(cards[0]?.messageId).toBe('mid-http-activity-card-nested');
      expect(JSON.stringify(cards[0]?.card)).toContain('activity_price_callback_confirm');
    } finally {
      server.close();
    }
  });

  it('returns a human-assisted cancellation card for submitted activities', async () => {
    const activityCancellationAssistant = fakeActivityCancellationAssistant();
    const submitSessionPath = await writeActivitySubmitSessionFixture();
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir: 'output',
      activityCancellationAssistant,
    } as any);
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
      const openValue = readButtonValue(buildCancelDifferentialPricingCard(activityCallbackRequest(submitSessionPath)), 'cancel_differential_pricing_open_submit');

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: { event_type: 'card.action.trigger' },
          event: {
            context: { open_message_id: 'mid-http-activity-cancel-open' },
            action: {
              name: 'cancel_differential_pricing_open_submit',
              value: openValue,
            },
          },
        }),
      });

      expect(response.status).toBe(200);
      const card = await response.json();
      expect(JSON.stringify(card)).toContain('cancel_differential_pricing_done');
      expect(JSON.stringify(card)).toContain('cancel_differential_pricing_abort');
      expect(activityCancellationAssistant.requests).toEqual([
        {
          submitSessionPath,
          productIds: ['886'],
          mappedCount: 1,
          startsAt: '2026-06-24',
          endsAt: '2026-07-01',
        },
      ]);
      await expect(readFile(submitSessionPath, 'utf8')).resolves.toContain('"status": "cancel_assistance_opened"');
    } finally {
      server.close();
    }
  });

  it('marks the submitted activity as cancelled for HTTP card callbacks', async () => {
    const submitSessionPath = await writeActivitySubmitSessionFixture('cancel_assistance_opened');
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir: 'output',
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
      const doneValue = readButtonValue(
        buildActivityCancelAssistanceCard(activityCallbackRequest(submitSessionPath), { openedUrl: 'https://example.test/activity', requiresManualLogin: false, lines: [] }),
        'cancel_differential_pricing_done_submit',
      );

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: { event_type: 'card.action.trigger' },
          event: {
            context: { open_message_id: 'mid-http-activity-cancel-done' },
            action: {
              name: 'cancel_differential_pricing_done_submit',
              value: doneValue,
            },
          },
        }),
      });

      expect(response.status).toBe(200);
      const card = await response.json();
      expect(JSON.stringify(card)).toContain('差异化定价活动已取消');
      await expect(readFile(submitSessionPath, 'utf8')).resolves.toContain('"status": "cancelled"');
    } finally {
      server.close();
    }
  });

  it('returns a cancelled status card when the HTTP differential pricing card is cancelled', async () => {
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir: 'output',
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
      const cancelValue = readButtonValue(buildActivityAutomationCard(), 'activity_automation_cancel_submit');

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: { event_type: 'card.action.trigger' },
          event: {
            context: { open_message_id: 'mid-http-activity-card-cancel' },
            action: {
              value: cancelValue,
            },
          },
        }),
      });

      expect(response.status).toBe(200);
      expect(JSON.stringify(await response.json())).toContain('已取消');
    } finally {
      server.close();
    }
  });

  it('returns replacement cards for HTTP price callback cancellation and duplicate clicks', async () => {
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir: 'output',
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
      const request: ActivityPriceCallbackConfirmRequest = {
        submitSessionPath: 'output/latest/activity-automation/activity-submit-session.json',
        productIds: ['770', '800'],
        mappedCount: 2,
        startsAt: '2026-06-24',
        endsAt: '2026-06-30',
      };
      const cancelValue = readButtonValue(buildActivityPriceCallbackConfirmCard(request), 'activity_price_callback_cancel_submit');
      const body = {
        header: { event_type: 'card.action.trigger' },
        event: {
          context: { open_message_id: 'mid-http-activity-price-callback-cancel' },
          action: {
            value: cancelValue,
          },
        },
      };

      const first = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const second = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(JSON.stringify(await first.json())).toContain('已取消');
      expect(JSON.stringify(await second.json())).toContain('已经取消');
    } finally {
      server.close();
    }
  });

  it('does not execute duplicate HTTP rental operation confirmations from the same card', async () => {
    const replies: Array<{ messageId: string; text: string }> = [];
    const rentalPriceClient = fakeRentalPriceClient();
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir: 'output',
      rentalPriceClient,
      replyText: async ({ messageId }, text) => {
        replies.push({ messageId, text });
        return { sent: true, channel: 'app' };
      },
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
      const confirmValue = readButtonValue(buildRentalOperationConfirmCard({ action: 'copy', productId: '875' }, 'test reason'), 'rental_operation_confirm_submit');
      const body = {
        header: { event_type: 'card.action.trigger' },
        event: {
          context: { open_message_id: 'mid-http-rental-operation-confirm' },
          action: {
            value: confirmValue,
          },
        },
      };

      const first = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const second = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(rentalPriceClient.calls).toEqual(['875']);
      expect(replies).toHaveLength(1);
      expect(JSON.stringify(await second.json())).toContain('已经执行完成');
    } finally {
      server.close();
    }
  });

  it('does not replay signed HTTP rental operation confirmations after restart', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-http-persistent-claim-'));
    const replies: Array<{ messageId: string; text: string }> = [];
    const rentalPriceClient = fakeRentalPriceClient();
    const confirmValue = readButtonValue(buildRentalOperationConfirmCard({ action: 'copy', productId: '875' }, 'test reason'), 'rental_operation_confirm_submit');
    const body = JSON.stringify({
      header: { event_type: 'card.action.trigger' },
      event: { context: { open_message_id: 'mid-http-rental-operation-replay' }, action: { value: confirmValue } },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = 'nonce-rental-replay';
    const headers = {
      'Content-Type': 'application/json',
      'X-Lark-Request-Timestamp': timestamp,
      'X-Lark-Request-Nonce': nonce,
      'X-Lark-Signature': buildFeishuSignature(timestamp, nonce, body, 'signature-secret'),
    };

    let server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir,
      callbackSignatureSecret: 'signature-secret',
      rentalPriceClient,
      replyText: async ({ messageId }, text) => {
        replies.push({ messageId, text });
        return { sent: true, channel: 'app' };
      },
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const firstAddress = server.address();
      if (!firstAddress || typeof firstAddress === 'string') throw new Error('Expected TCP server address');
      const first = await fetch(`http://127.0.0.1:${firstAddress.port}`, { method: 'POST', headers, body });
      expect(first.status).toBe(200);
      await expect(readdir(join(outputDir, 'latest', 'card-action-claims'))).resolves.toHaveLength(1);
    } finally {
      server.close();
    }

    server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir,
      callbackSignatureSecret: 'signature-secret',
      rentalPriceClient,
      replyText: async ({ messageId }, text) => {
        replies.push({ messageId, text });
        return { sent: true, channel: 'app' };
      },
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const secondAddress = server.address();
      if (!secondAddress || typeof secondAddress === 'string') throw new Error('Expected TCP server address');
      const replay = await fetch(`http://127.0.0.1:${secondAddress.port}`, { method: 'POST', headers, body });

      expect(replay.status).toBe(200);
      expect(rentalPriceClient.calls).toEqual(['875']);
      expect(JSON.stringify(await replay.json())).toContain('已经执行完成');
    } finally {
      server.close();
    }
  });

  it('blocks cross-strategy HTTP refresh activity selections from the same plan card', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-http-refresh-strategy-claim-'));
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
    const cards: Array<{ messageId: string; card: Record<string, unknown> }> = [];
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir,
      replyCard: async ({ messageId }, card) => {
        cards.push({ messageId, card });
        return { sent: true, channel: 'app' };
      },
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
      const first = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ header: { event_type: 'card.action.trigger' }, event: { context: { open_message_id: 'mid-http-refresh-strategy' }, action: { value: delistValue } } }),
      });
      const second = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ header: { event_type: 'card.action.trigger' }, event: { context: { open_message_id: 'mid-http-refresh-strategy' }, action: { value: refillValue } } }),
      });

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(cards).toHaveLength(1);
      expect(JSON.stringify(cards[0].card)).toContain('即将下架端内ID：901、902');
      expect(JSON.stringify(await second.json())).toContain('已经执行完成');
    } finally {
      server.close();
    }
  });

  it('rejects legacy HTTP rental price confirmation before execution', async () => {
    const replies: Array<{ messageId: string; text: string }> = [];
    const calls: unknown[] = [];
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run'); },
      async execute(request) {
        calls.push(request);
        return { productId: request.productId, ok: true, lines: ['apply: ok'] };
      },
      async copy() { throw new Error('copy should not run'); },
      async delist() { throw new Error('delist should not run'); },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir: 'output',
      rentalPriceClient,
      replyText: async ({ messageId }, text) => {
        replies.push({ messageId, text });
        return { sent: true, channel: 'app' };
      },
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
      const confirmValue = legacyPriceConfirmValue({ mode: 'explicit_fields', productId: '761', fields: { rent1day: '22.00' } });

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: { event_type: 'card.action.trigger' },
          event: { context: { open_message_id: 'mid-http-legacy-price-confirm' }, action: { value: confirmValue } },
        }),
      });

      expect(response.status).toBe(200);
      expect(calls).toEqual([]);
      expect(replies).toEqual([{ messageId: 'mid-http-legacy-price-confirm', text: expect.stringContaining('旧改价确认入口已停用') }]);
    } finally {
      server.close();
    }
  });

  it('executes a referenced Agent price apply confirmation from the HTTP callback', async () => {
    const replies: Array<{ messageId: string; text: string }> = [];
    const cards: Array<{ messageId: string; card: unknown }> = [];
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-http-agent-tool-ref-'));
    const calls: Array<{ productId: string; fields: Record<string, string> }> = [];
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run'); },
      async execute(request) {
        calls.push({ productId: request.productId, fields: request.fields });
        return {
          productId: request.productId,
          ok: true,
          lines: ['apply: ok', 'submit: ok', 'verify: ok'],
          audit: { taskId: 'task_653_done', status: 'completed' as const, rollbackFile: 'rollback-653.json' },
        };
      },
      async copy() { throw new Error('copy should not run'); },
      async delist() { throw new Error('delist should not run'); },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir,
      rentalPriceClient,
      replyText: async ({ messageId }, text) => {
        replies.push({ messageId, text });
        return { sent: true, channel: 'app' };
      },
      replyCard: async ({ messageId }, card) => {
        cards.push({ messageId, card });
        return { sent: true, channel: 'app' };
      },
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
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
      const confirmValue = readAgentToolConfirmValue(buildAgentToolConfirmCard(request, { requestRef }));
      expect(JSON.stringify(confirmValue)).not.toContain('rent10day');

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: { event_type: 'card.action.trigger' },
          event: {
            context: { open_message_id: 'mid-http-agent-tool-ref-price' },
            action: {
              value: confirmValue,
            },
          },
        }),
      });

      expect(response.status).toBe(200);
      expect(calls).toEqual([{ productId: '653', fields: { rent1day: '29.85', rent10day: '74.85' } }]);
      expect(replies).toHaveLength(0);
      expect(cards).toHaveLength(1);
      const cardText = JSON.stringify(cards[0].card);
      expect(cardText).toContain('租赁改价执行完成');
      expect(cardText).toContain('生成回滚确认卡');
      expect(cardText).toContain('rental_price_prepare_rollback');
    } finally {
      server.close();
    }
  });

  it('records ledger attribution for confirmed Agent Explore writes through HTTP callbacks', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-http-agent-explore-ledger-'));
    const replies: Array<{ messageId: string; text: string }> = [];
    const rentalPriceClient = {
      async preview() { throw new Error('preview should not run'); },
      async execute() { throw new Error('execute should not run'); },
      async copy() { throw new Error('copy should not run'); },
      async delist(productId: string) { return { productId, ok: true, lines: ['delisted'] }; },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    } satisfies RentalPriceSkillClient;
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir,
      rentalPriceClient,
      replyText: async ({ messageId }, text) => {
        replies.push({ messageId, text });
        return { sent: true, channel: 'app' };
      },
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
      const confirmValue = readAgentToolConfirmValue(buildAgentToolConfirmCard({
        toolName: 'rental.delist',
        arguments: { productId: '648' },
        reason: agentExploreReason('dec-http-ledger', '下架 648'),
      }));

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: { event_type: 'card.action.trigger' },
          event: { context: { open_message_id: 'mid-http-agent-explore-ledger' }, action: { value: confirmValue } },
        }),
      });

      const date = new Date().toISOString().slice(0, 10);
      const entries = await loadOperationLedgerJsonlEntries(outputDir, date);
      expect(response.status).toBe(200);
      expect(replies[0]?.text).toContain('下架成功：商品 648');
      expect(entries).toEqual(expect.arrayContaining([
        expect.objectContaining({ event: 'execution_started', runId: 'agentExplore', decisionId: 'dec-http-ledger', toolName: 'rental.delist' }),
        expect.objectContaining({ event: 'execution_succeeded', runId: 'agentExplore', decisionId: 'dec-http-ledger', toolName: 'rental.delist' }),
      ]));
    } finally {
      server.close();
    }
  });

  it('passes registry paths into HTTP Agent continuation steps after a confirmed product action', async () => {
    const replies: Array<{ messageId: string; text: string }> = [];
    const fixtures = await writeRankingContinuationContext();
    const rentalPriceClient = fakeRentalPriceClient();
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir: fixtures.outputDir,
      rentalPriceClient,
      closedOrderRegistryPaths: fixtures.registryPaths,
      replyText: async ({ messageId }, text) => {
        replies.push({ messageId, text });
        return { sent: true, channel: 'app' };
      },
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
      const confirmValue = readAgentToolConfirmValue(buildAgentToolConfirmCard({
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
      }));
      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: { event_type: 'card.action.trigger' },
          event: {
            context: { open_message_id: 'mid-http-agent-continuation-registry' },
            action: {
              value: confirmValue,
            },
          },
        }),
      });

      expect(response.status).toBe(200);
      expect(rentalPriceClient.calls).toEqual(['875']);
      expect(replies).toHaveLength(1);
      expect(replies[0].text).toContain('步骤 2/2：product.rankBestSameSku');
      expect(replies[0].text).toContain('数据最好的 alpha 是：端内ID 711');
    } finally {
      server.close();
    }
  });

  it('delivers Daily Mission pending confirmation cards through HTTP callbacks', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-http-dm-pending-'));
    const missionDir = join(outputDir, 'daily-mission', '2026-07-02');
    await mkdir(missionDir, { recursive: true });
    let run = createDailyMissionRun({ runId: 'run-http-pending', date: '2026-07-02', trigger: 'manual', startedAt: '2026-07-02T00:00:00.000Z' });
    run = transitionDailyMissionRun(run, 'planning', '2026-07-02T00:00:01.000Z');
    run = transitionDailyMissionRun(run, 'waiting_approval', '2026-07-02T00:00:02.000Z');
    await saveDailyMissionRun(outputDir, run);
    await writeFile(join(missionDir, 'approval-request.json'), JSON.stringify({
      approvals: [{
        decisionId: 'dec-pending',
        runId: 'run-http-pending',
        title: '预览改价',
        subjects: [{ kind: 'product', id: '648' }],
        operationType: 'price_down',
        recommendation: 'approve_to_execute',
        risk: 'high',
        rationale: [],
        evidenceRefs: ['http.pending'],
        uncertainties: [],
        proposedTool: { toolName: 'rental.pricePreview', arguments: { productIds: ['648'], discount: 0.9 } },
      }],
      observations: [],
    }), 'utf8');
    const cards: Array<{ messageId: string; card: Record<string, unknown> }> = [];
    const rentalPriceClient = {
      async preview() {
        return {
          productId: '648',
          fields: { rent1day: '18.00' },
          lines: ['1天:20->18'],
          warnings: [],
          audit: completeAudit('648', { taskId: undefined, expectedFieldCount: 1, diff: [{ field: 'rent1day', label: '1天', old: '20.00', new: '18.00', change: '-2.00', changePct: '-10.0%', issues: [] }] }),
        };
      },
      async execute() { throw new Error('execute should not run during preview'); },
      async copy() { throw new Error('copy should not run during preview'); },
      async delist() { throw new Error('delist should not run during preview'); },
      async tenancySet() { throw new Error('tenancySet should not run during preview'); },
      async specDiscover() { return { productId: '648', ok: true, dimensions: [], lines: [] }; },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run during preview'); },
    } as unknown as RentalPriceSkillClient;
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir,
      rentalPriceClient,
      replyCard: async ({ messageId }, card) => {
        cards.push({ messageId, card });
        return { sent: true, channel: 'app' };
      },
      replyText: async () => {
        throw new Error('replyText should not be called for pending confirmation card');
      },
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
      const request = {
        toolName: 'rental.pricePreview',
        arguments: { productIds: ['648'], discount: 0.9 },
        reason: '[[dailyMission:runId=run-http-pending;decisionId=dec-pending]] 预览改价',
      };
      const confirmValue = readAgentToolConfirmValue(buildAgentToolConfirmCard(request));

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: { event_type: 'card.action.trigger' },
          event: { context: { open_message_id: 'mid-http-dm-pending' }, action: { value: confirmValue } },
        }),
      });

      expect(response.status).toBe(200);
      expect(cards).toHaveLength(1);
      expect(JSON.stringify(cards[0]?.card)).toContain('agent_tool_confirm');
      expect(JSON.stringify(cards[0]?.card)).toContain('rental.priceApply');
    } finally {
      server.close();
    }
  });

  it('routes HTTP operations learning feedback callbacks to the next question and persists feedback', async () => {
    const replies: Array<{ messageId: string; text: string }> = [];
    const cards: Array<{ messageId: string; card: Record<string, unknown> }> = [];
    let resolveReplySent!: () => void;
    const replySent = new Promise<void>((resolve) => {
      resolveReplySent = resolve;
    });
    const outputDir = await writeLearningContext();
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir,
      replyText: async ({ messageId }, text) => {
        replies.push({ messageId, text });
        resolveReplySent();
        return { sent: true, channel: 'app' };
      },
      replyCard: async ({ messageId }, card) => {
        cards.push({ messageId, card });
        resolveReplySent();
        return { sent: true, channel: 'app' };
      },
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');

      await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: { message: { message_id: 'mid-start-learning', message_type: 'text', content: JSON.stringify({ text: '运营学习' }) } } }),
      });
      await replySent;

      let resolveFeedbackSent!: () => void;
      const feedbackSent = new Promise<void>((resolve) => {
        resolveFeedbackSent = resolve;
        resolveReplySent = resolveFeedbackSent;
      });
      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: { event_type: 'card.action.trigger' },
          event: {
            context: { open_message_id: 'mid-http-loop-card' },
            operator: { open_id: 'ou_http_reviewer' },
            action: { value: { action: 'operations_learning_feedback', date: '2026-06-11', productId: '565', feedback: 'suggested_action', questionIndex: 1 }, form_value: { suggested_action: '继续放量' } },
          },
        }),
      });

      expect(response.status).toBe(200);
      await feedbackSent;
      expect(replies).toEqual([]);
      expect(cards).toHaveLength(2);
      expect(JSON.stringify(cards[1].card)).toContain('运营学习 loop 测验 2/2');
      await expect(readFile(join(outputDir, '2026-06-11', 'operations-learning-session.json'), 'utf8')).resolves.toContain('继续放量');
      await expect(readFile(join(outputDir, '2026-06-11', 'operations-learning-session.json'), 'utf8')).resolves.toContain('ou_http_reviewer');
    } finally {
      server.close();
    }
  });

  it('rejects malformed HTTP operations learning feedback callbacks', async () => {
    const replies: Array<{ messageId: string; text: string }> = [];
    let resolveReplySent!: () => void;
    const replySent = new Promise<void>((resolve) => {
      resolveReplySent = resolve;
    });
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      replyText: async ({ messageId }, text) => {
        replies.push({ messageId, text });
        resolveReplySent();
        return { sent: true, channel: 'app' };
      },
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: { event_type: 'card.action.trigger' },
          event: {
            context: { open_message_id: 'mid-http-loop-malformed' },
            action: { value: { action: 'operations_learning_feedback', productId: '565', feedback: 'reasonable' } },
          },
        }),
      });

      expect(response.status).toBe(200);
      await replySent;
      expect(replies).toEqual([{ messageId: 'mid-http-loop-malformed', text: '运营学习反馈回调缺少必要字段。' }]);
    } finally {
      server.close();
    }
  });

  it('returns a stopped operations learning card for HTTP stop callbacks', async () => {
    const outputDir = await writeLearningContext();
    await writeFile(join(outputDir, '2026-06-11', 'operations-learning-session.json'), JSON.stringify({
      date: '2026-06-11',
      createdAt: '2026-06-11T00:00:00.000Z',
      updatedAt: '2026-06-11T00:00:00.000Z',
      items: [
        { productId: '565', productName: 'iPhone 15', platformProductId: 'p565', score: 1, sourceModules: ['建议操作'], reasons: ['原因1'], recommendedOperation: '补曝光', metrics: { '1d': metric, '7d': metric, '30d': metric }, feedbackOptions: ['reasonable', 'unreasonable', 'suggested_action', 'not_representative'] },
      ],
      feedbacks: [],
      learnedSignals: { acceptedReasons: {}, rejectedReasons: {}, rejectedOperations: {}, nonRepresentativeProducts: [] },
    }));
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir,
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: { event_type: 'card.action.trigger' },
          event: {
            context: { open_message_id: 'mid-http-loop-stop' },
            operator: { open_id: 'ou_http_stop' },
            action: { value: { action: 'operations_learning_stop', date: '2026-06-11' } },
          },
        }),
      });

      expect(response.status).toBe(200);
      expect(JSON.stringify(await response.json())).toContain('运营学习已停止');
      await expect(readFile(join(outputDir, '2026-06-11', 'operations-learning-session.json'), 'utf8')).resolves.toContain('ou_http_stop');
    } finally {
      server.close();
    }
  });

  it('routes HTTP card action callbacks when Feishu returns callback value through behaviors', async () => {
    const replies: Array<{ messageId: string; text: string }> = [];
    const cards: Array<{ messageId: string; card: Record<string, unknown> }> = [];
    let resolveReplySent!: () => void;
    const replySent = new Promise<void>((resolve) => {
      resolveReplySent = resolve;
    });
    const outputDir = await writeLearningContext();
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
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir,
      replyText: async ({ messageId }, text) => {
        replies.push({ messageId, text });
        resolveReplySent();
        return { sent: true, channel: 'app' };
      },
      replyCard: async ({ messageId }, card) => {
        cards.push({ messageId, card });
        resolveReplySent();
        return { sent: true, channel: 'app' };
      },
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: { event_type: 'card.action.trigger' },
          event: {
            context: { open_message_id: 'mid-http-loop-behavior' },
            action: { behaviors: [{ type: 'callback', value: { action: 'operations_learning_feedback', date: '2026-06-11', productId: '565', feedback: 'reasonable', questionIndex: 1 } }] },
          },
        }),
      });

      expect(response.status).toBe(200);
      await replySent;
      expect(replies).toEqual([]);
      expect(cards).toHaveLength(1);
      expect(cards[0]?.messageId).toBe('mid-http-loop-behavior');
      expect(JSON.stringify(cards[0]?.card)).toContain('运营学习 loop 测验 2/2');
    } finally {
      server.close();
    }
  });


  it('returns the first maintenance review card directly for HTTP callbacks', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-link-maintenance-http-'));
    await seedLinkMaintenanceSession(outputDir);
    const cards: Array<{ messageId: string; card: Record<string, unknown> }> = [];
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir,
      replyCard: async ({ messageId }, card) => {
        cards.push({ messageId, card });
        return { sent: true, channel: 'app' };
      },
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: { event_type: 'card.action.trigger' },
          event: {
            context: { open_message_id: 'mid-http-link-maintenance-start' },
            action: {
              name: 'link_registry_maintenance_start_submit',
              behaviors: [{ type: 'callback', value: { action: 'link_registry_maintenance_start', date: '2026-06-24' } }],
            },
          },
        }),
      });

      expect(response.status).toBe(200);
      expect(cards).toEqual([]);
      const card = await response.json();
      expect(JSON.stringify(card)).toContain('link_registry_maintenance_form');
      expect(JSON.stringify(card)).toContain('Pocket3');
    } finally {
      server.close();
    }
  });

  it('returns the first maintenance review card when HTTP callback only has a button name', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-link-maintenance-http-name-only-'));
    await seedLinkMaintenanceSession(outputDir);
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir,
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: { event_type: 'card.action.trigger' },
          event: {
            context: { open_message_id: 'mid-http-link-maintenance-start-name-only' },
            action: {
              name: 'link_registry_maintenance_start_submit',
            },
          },
        }),
      });

      expect(response.status).toBe(200);
      const card = await response.json();
      expect(JSON.stringify(card)).toContain('link_registry_maintenance_form');
      expect(JSON.stringify(card)).toContain('Pocket3');
    } finally {
      server.close();
    }
  });

  it('returns a non-clickable ignored maintenance status card for HTTP callbacks', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-link-maintenance-http-ignore-'));
    await seedLinkMaintenanceSession(outputDir);
    const replies: Array<{ messageId: string; text: string }> = [];
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir,
      replyText: async ({ messageId }, text) => {
        replies.push({ messageId, text });
        return { sent: true, channel: 'app' };
      },
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: { event_type: 'card.action.trigger' },
          event: {
            context: { open_message_id: 'mid-http-link-maintenance-ignore' },
            action: { value: { action: 'link_registry_maintenance_ignore', date: '2026-06-24' } },
          },
        }),
      });

      expect(response.status).toBe(200);
      expect(replies).toEqual([]);
      const card = await response.json();
      expect(JSON.stringify(card)).not.toContain('link_registry_maintenance_start');
      expect(JSON.stringify(card)).not.toContain('\"tag\":\"button\"');
    } finally {
      server.close();
    }
  });


  it('returns the next governance review card directly for HTTP callbacks and persists the decision', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-link-governance-http-'));
    await seedLinkGovernanceSession(outputDir);
    const cards: Array<{ messageId: string; card: Record<string, unknown> }> = [];
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir,
      replyCard: async ({ messageId }, card) => {
        cards.push({ messageId, card });
        return { sent: true, channel: 'app' };
      },
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: { event_type: 'card.action.trigger' },
          event: {
            context: { open_message_id: 'mid-http-link-governance-submit' },
            operator: { open_id: 'ou_http_governance' },
            action: {
              value: { action: 'link_registry_governance_submit', date: '2026-06-24', reviewIndex: 1 },
              form_value: {
                decision: 'resolved',
                note: 'Wide300 next-round backlog confirmed',
              },
            },
          },
        }),
      });

      expect(response.status).toBe(200);
      expect(cards).toEqual([]);
      const card = await response.json();
      expect(JSON.stringify(card)).toContain('link_registry_governance_form');
      await expect(readFile(join(outputDir, '2026-06-24', 'link-registry-governance-session.json'), 'utf8')).resolves.toContain('Wide300 next-round backlog confirmed');
      await expect(readFile(join(outputDir, '2026-06-24', 'link-registry-governance-session.json'), 'utf8')).resolves.toContain('ou_http_governance');
    } finally {
      server.close();
    }
  });

  it('returns the first governance review card when HTTP callback only has a button name', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-link-governance-http-name-only-'));
    await seedLinkGovernanceSession(outputDir);
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir,
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: { event_type: 'card.action.trigger' },
          event: {
            context: { open_message_id: 'mid-http-link-governance-start-name-only' },
            action: {
              name: 'link_registry_governance_start_submit',
            },
          },
        }),
      });

      expect(response.status).toBe(200);
      const card = await response.json();
      expect(JSON.stringify(card)).toContain('link_registry_governance_form');
    } finally {
      server.close();
    }
  });
  it('does not reply when dispatcher skips a duplicate message', async () => {
    const replies: Array<{ messageId: string; text: string }> = [];
    let resolveDispatchCalled!: () => void;
    const dispatchCalled = new Promise<void>((resolve) => {
      resolveDispatchCalled = resolve;
    });
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      dispatchMessage: async () => {
        resolveDispatchCalled();
        return { text: '', skipped: true };
      },
      replyText: async ({ messageId }, text) => {
        replies.push({ messageId, text });
        throw new Error('replyText should not be called for skipped messages');
      },
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address');

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: { message: { message_id: 'mid-http-skip', message_type: 'text', content: JSON.stringify({ text: '今日概况' }) } } }),
      });

      expect(response.status).toBe(200);
      await dispatchCalled;
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(replies).toEqual([]);
    } finally {
      server.close();
    }
  });
});
