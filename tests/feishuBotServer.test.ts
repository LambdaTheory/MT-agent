import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildAgentToolConfirmCard } from '../src/agentRuntime/approvalCard.js';
import type { AgentPlannerProvider } from '../src/agentRuntime/planner.js';
import { extractTextMessage, startFeishuBotServer } from '../src/feishuBot/server.js';
import type { ActivityAutomationSkillClient } from '../src/feishuBot/activityAutomation.js';
import { openLinkRegistryGovernancePrompt } from '../src/linkRegistry/governanceSession.js';
import { openLinkRegistryMaintenancePrompt } from '../src/linkRegistry/maintenanceSession.js';
import type { LinkRegistryOverrideRisk } from '../src/linkRegistry/overrides.js';
import type { LinkRegistryEntry } from '../src/linkRegistry/types.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';
import type { FeishuBotIncomingTextMessage } from '../src/feishuBot/types.js';

function readAgentToolConfirmValue(card: unknown): unknown {
  const body = (card as { body?: { elements?: Array<{ elements?: Array<{ name?: string; behaviors?: Array<{ value?: unknown }> }> }> } }).body;
  const form = body?.elements?.find((element) => Array.isArray(element.elements));
  const button = form?.elements?.find((element) => element.name === 'agent_tool_confirm_submit');
  return button?.behaviors?.[0]?.value;
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
    async specAddAndRefresh(productId, itemTitle) {
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

  it('routes text event through dispatcher and replies', async () => {
    const replies: Array<{ messageId: string; text: string }> = [];
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

  it('routes legacy exact HTTP text commands through the Agent planner when configured', async () => {
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
        if (request.message === '跑日报') {
          return JSON.stringify({
            goal: '生成公域日报',
            selectedTool: 'publicTraffic.runReport',
            arguments: {},
            confidence: 0.95,
            reason: '用户要求跑日报，写操作必须确认',
          });
        }
        if (request.message === '运营学习') {
          return JSON.stringify({
            goal: '开始运营学习测验',
            selectedTool: 'operationsLearning.startQuiz',
            arguments: {},
            confidence: 0.93,
            reason: '用户要求开始运营学习',
          });
        }
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
        if (cards.length === 3) resolveCardsSent();
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

      for (const [index, text] of ['跑日报', '运营学习', '复制商品 761'].entries()) {
        const response = await fetch(`http://127.0.0.1:${address.port}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: { message: { message_id: `mid-http-planner-first-${index}`, message_type: 'text', content: JSON.stringify({ text }) } } }),
        });
        expect(response.status).toBe(200);
      }

      await cardsSent;
      expect(plannerMessages).toEqual(['跑日报', '运营学习', '复制商品 761']);
      expect(texts).toEqual([]);
      const cardByMessageId = new Map(cards.map((item) => [item.messageId, item.card]));
      const runReportCard = JSON.stringify(cardByMessageId.get('mid-http-planner-first-0'));
      const learningCard = JSON.stringify(cardByMessageId.get('mid-http-planner-first-1'));
      const copyCard = JSON.stringify(cardByMessageId.get('mid-http-planner-first-2'));
      expect(runReportCard).toContain('publicTraffic.runReport');
      expect(runReportCard).toContain('agent_tool_confirm');
      expect(runReportCard).not.toContain('公域日报已生成');
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

  it('returns replacement cards for HTTP Agent clarification cancellation and duplicate clicks', async () => {
    const replies: Array<{ messageId: string; text: string }> = [];
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir: await mkdtemp(join(tmpdir(), 'mt-agent-bot-http-clarify-cancel-')),
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
            behaviors: [{ type: 'callback', value: { action: 'agent_clarify_cancel', originalMessage: '抓取访问页数据' } }],
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

  it('does not dispatch duplicate HTTP Agent clarification selections from the same card', async () => {
    const replies: Array<{ messageId: string; text: string }> = [];
    const dispatched: FeishuBotIncomingTextMessage[] = [];
    const server = startFeishuBotServer({
      port: 0,
      appId: 'app',
      appSecret: 'secret',
      outputDir: await mkdtemp(join(tmpdir(), 'mt-agent-bot-http-clarify-select-')),
      dispatchMessage: async (message) => {
        dispatched.push(message);
        return { text: '澄清后结果', skipped: false };
      },
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
          context: { open_message_id: 'mid-http-agent-clarify-select' },
          action: {
            name: 'agent_clarify_select_1',
            behaviors: [{
              type: 'callback',
              value: {
                action: 'agent_clarify_select',
                originalMessage: '抓取访问页数据',
                selectedMessage: '补抓访问页',
                label: '补抓访问页',
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
      expect(dispatched.map((message) => message.text)).toEqual(['补抓访问页']);
      expect(replies).toEqual([{ messageId: 'mid-http-agent-clarify-select', text: '澄清后结果' }]);
      expect(JSON.stringify(await second.json())).toContain('已经执行完成');
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

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: { event_type: 'card.action.trigger' },
          event: {
            context: { open_message_id: 'mid-http-activity-card' },
            action: {
              value: { action: 'activity_automation_confirm' },
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

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: { event_type: 'card.action.trigger' },
          event: {
            context: { open_message_id: 'mid-http-activity-card-nested' },
            action: {
              value: { action: 'activity_automation_confirm' },
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

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: { event_type: 'card.action.trigger' },
          event: {
            context: { open_message_id: 'mid-http-activity-cancel-open' },
            action: {
              name: 'cancel_differential_pricing_open_submit',
              value: {
                action: 'cancel_differential_pricing_open',
                request: {
                  submitSessionPath,
                  productIds: ['886'],
                  mappedCount: 1,
                  startsAt: '2026-06-24',
                  endsAt: '2026-07-01',
                },
              },
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

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: { event_type: 'card.action.trigger' },
          event: {
            context: { open_message_id: 'mid-http-activity-cancel-done' },
            action: {
              name: 'cancel_differential_pricing_done_submit',
              value: {
                action: 'cancel_differential_pricing_done',
                request: {
                  submitSessionPath,
                  productIds: ['886'],
                  mappedCount: 1,
                  startsAt: '2026-06-24',
                  endsAt: '2026-07-01',
                },
              },
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

      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: { event_type: 'card.action.trigger' },
          event: {
            context: { open_message_id: 'mid-http-activity-card-cancel' },
            action: {
              value: { action: 'activity_automation_cancel' },
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
      const body = {
        header: { event_type: 'card.action.trigger' },
        event: {
          context: { open_message_id: 'mid-http-activity-price-callback-cancel' },
          action: {
            value: {
              action: 'activity_price_callback_cancel',
              request: {
                submitSessionPath: 'output/latest/activity-automation/activity-submit-session.json',
                productIds: ['770', '800'],
                mappedCount: 2,
                startsAt: '2026-06-24',
                endsAt: '2026-06-30',
              },
            },
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
      const body = {
        header: { event_type: 'card.action.trigger' },
        event: {
          context: { open_message_id: 'mid-http-rental-operation-confirm' },
          action: {
            value: { action: 'rental_operation_confirm', request: { action: 'copy', productId: '875' } },
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

  it('passes registry paths into HTTP Agent continuation steps after a confirmed write', async () => {
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
            action: { value: { action: 'link_registry_maintenance_start', date: '2026-06-24' } },
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
