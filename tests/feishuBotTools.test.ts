import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseAgentToolConfirmRequest } from '../src/agentRuntime/approvalCard.js';
import type { AgentPlannerProvider } from '../src/agentRuntime/planner.js';
import type { LlmIntentProposalProvider } from '../src/feishuBot/llmIntentProposal.js';
import type { LlmToolSelectionProvider } from '../src/feishuBot/llmProvider.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';
import { recordAgentLearningEvent } from '../src/agentLearning/store.js';
import { executeAgentToolRequestWithContinuation } from '../src/feishuBot/agentToolContinuation.js';
import { executeAgentToolRequest } from '../src/feishuBot/agentToolExecutor.js';
import { loadAgentToolConfirmRequestFromValue } from '../src/feishuBot/agentToolConfirmStore.js';
import { handleBotIntent } from '../src/feishuBot/tools.js';

const mocks = vi.hoisted(() => ({
  runPublicTrafficReportCli: vi.fn(),
  sendFeishuCard: vi.fn(),
  loadEnv: vi.fn(),
  loadConfig: vi.fn(),
  runDashboardRefresh: vi.fn(),
}));

vi.mock('../src/cli/publicTrafficReport.js', () => ({
  runPublicTrafficReportCli: mocks.runPublicTrafficReportCli,
}));

vi.mock('../src/notify/feishu.js', () => ({
  sendFeishuCard: mocks.sendFeishuCard,
}));

vi.mock('../src/config/loadEnv.js', () => ({
  loadEnv: mocks.loadEnv,
}));

vi.mock('../src/config/loadConfig.js', () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock('../src/publicTraffic/dashboardRefresh.js', () => ({
  runDashboardRefresh: mocks.runDashboardRefresh,
}));

beforeEach(() => {
  mocks.runPublicTrafficReportCli.mockReset();
  mocks.runPublicTrafficReportCli.mockResolvedValue({
    logPath: 'output/test-report.log',
    dashboardCrawlSummary: '访问页抓取情况：测试通过',
  });
  mocks.sendFeishuCard.mockReset();
  mocks.sendFeishuCard.mockResolvedValue({ sent: true, channel: 'app' });
  mocks.loadEnv.mockReset();
  mocks.loadEnv.mockResolvedValue(undefined);
  mocks.loadConfig.mockReset();
  mocks.loadConfig.mockResolvedValue({
    targetUrl: 'https://example.test/dashboard',
    periods: ['1d', '7d', '30d'],
    preferredPageSize: 100,
    outputDir: 'output',
    browserProfileDir: 'profile',
  });
  mocks.runDashboardRefresh.mockReset();
  mocks.runDashboardRefresh.mockResolvedValue({
    decision: 'refreshed',
    message: '已补抓访问页数据',
    refreshQualityText: '访问页已抓取',
    firstQualityText: '首版可用',
  });
});

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

interface TestRegistryPaths {
  productIdMapPath: string;
  productNameMapPath: string;
  goodsSnapshotPath: string;
  firstSeenPath: string;
  lifecyclePath: string;
  daemonCatalogPath: string;
  overridesPath: string;
  artifactsDir: string;
}

function readAgentToolConfirmValueFromCard(card: unknown): unknown {
  const body = (card as { body?: { elements?: Array<{ elements?: Array<{ name?: string; behaviors?: Array<{ value?: unknown }> }> }> } }).body;
  const form = body?.elements?.find((element) => Array.isArray(element.elements));
  const button = form?.elements?.find((element) => element.name === 'agent_tool_confirm_submit');
  return button?.behaviors?.[0]?.value;
}

function readAgentToolConfirmRequestFromCard(card: unknown) {
  const value = readAgentToolConfirmValueFromCard(card);
  const request = parseAgentToolConfirmRequest(value);
  if (!request) throw new Error('agent tool confirmation request not found');
  return request;
}

async function loadAgentToolConfirmRequestFromCard(outputDir: string, card: unknown) {
  const request = await loadAgentToolConfirmRequestFromValue(outputDir, readAgentToolConfirmValueFromCard(card));
  if (!request) throw new Error('agent tool confirmation request not found');
  return request;
}

async function writeContext(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mt-agent-bot-tools-'));
  await mkdir(join(dir, '2026-06-11'), { recursive: true });
  await writeFile(join(dir, '2026-06-11', 'report-context.json'), JSON.stringify({
    date: '2026-06-11',
    summary: { '1d': summary, '7d': summary, '30d': summary },
    conclusions: [],
    rows: [
      { productName: 'iPhone 15', platformProductId: '2000000000000000000001', displayProductId: '端内ID 565', custodyDays: 10, periods: { '1d': metric, '7d': metric, '30d': metric } },
      { productName: '大疆 Pocket 3', platformProductId: 'p701', displayProductId: '端内ID 701', custodyDays: 1, periods: { '1d': metric, '7d': metric, '30d': metric } },
      {
        productName: '大疆 Pocket 3 高转化套装',
        platformProductId: 'p702',
        displayProductId: '端内ID 702',
        custodyDays: 2,
        periods: {
          '1d': { ...metric, shippedOrders: 1, amount: 188, publicVisits: 22 },
          '7d': { ...metric, shippedOrders: 4, amount: 888, publicVisits: 80 },
          '30d': metric,
        },
      },
      { productName: 'vivo X300Ultra 733 长焦演唱会神器', platformProductId: '2000000000000000000733', displayProductId: '端内ID 649', custodyDays: 1, periods: { '1d': metric, '7d': metric, '30d': metric } },
      { productName: '佳能R50微单相机', platformProductId: 'p-841-733', displayProductId: '端内ID 841', custodyDays: 1, periods: { '1d': metric, '7d': metric, '30d': metric } },
      { productName: '大疆DJI Pocket3云台相机128G', platformProductId: 'p-733-target', displayProductId: '端内ID 733', custodyDays: 1, periods: { '1d': metric, '7d': metric, '30d': metric } },
    ],
    lowExposure: [{ identifier: '端内ID 565', action: '补曝光', reason: '曝光不足' }],
    weakClick: [],
    weakConversion: [{ identifier: '端内ID 565', action: '提转化', reason: '访问多成交少' }],
    highPotential: [{ identifier: '端内ID 566', action: '继续放量', reason: '高潜力' }],
    newProductObservation: [],
    lifecycleGovernance: [{ identifier: '端内ID 706', action: '下架、替换或重做素材', reason: '已托管 45 天，30日曝光 60，访问 1，金额 0.00', priority: 'medium' }],
    recommendedActions: [
      { identifier: '端内ID 565', action: '补曝光', reason: '曝光不足', priority: 'high' },
      { identifier: '端内ID 701', action: '新品维护', reason: '新链接池维护', priority: 'medium' },
    ],
    newProductPoolIds: ['701'],
    newProductPoolItems: [{ productId: '701', productName: '大疆 Pocket 3', shortTitle: '', submittedAt: '2026-06-11 09:00:00', merchant: '', alipaySyncStatus: '已同步', alipayCode: '', stock: 0, skuCount: 0, maintenanceStatus: '待维护', note: '' }],
    orderAnalysis: {
      runDate: '2026-06-11',
      capturedAt: '2026-06-11T01:00:00.000Z',
      pages: {
        overview: {
          key: 'overview',
          label: '订单概览',
          dataDate: '2026-06-10',
          indicators: [
            { label: '创建订单数', value: '20', delta: '' },
            { label: '签约订单数', value: '10', delta: '' },
            { label: '审出订单数', value: '8', delta: '' },
            { label: '发货订单数', value: '12', delta: '' },
            { label: '发货订单', value: '12', delta: '' },
            { label: '签约完成金额（元）', value: '500', delta: '' },
          ],
        },
        delivery: { key: 'delivery', label: '发货分析', dataDate: '2026-06-10', indicators: [] },
        return: { key: 'return', label: '归还分析', dataDate: '2026-06-10', indicators: [] },
        customs: { key: 'customs', label: '关单分析', dataDate: '2026-06-10', indicators: [{ label: '关单数', value: '5', delta: '' }] },
      },
    },
    agentData: { removedLinks: [{ productId: '701', platformProductId: 'p701', productName: '已下架链接', removedDate: '2026-06-12', reason: '商品总表缺失', source: 'goods_snapshot_diff' }] },
    emptySectionNotes: {},
  }));
  return dir;
}

async function writeDatedContexts(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mt-agent-bot-tools-dated-'));
  const writeOne = async (runDate: string, reportDate: string, exposure: number, productName: string): Promise<void> => {
    await mkdir(join(dir, runDate), { recursive: true });
    await writeFile(join(dir, runDate, 'report-context.json'), JSON.stringify({
      date: reportDate,
      summary: {
        '1d': { ...summary, exposure },
        '7d': { ...summary, exposure: exposure + 7 },
        '30d': { ...summary, exposure: exposure + 30 },
      },
      conclusions: [],
      rows: [
        {
          productName,
          platformProductId: `platform-${reportDate}-733`,
          displayProductId: '端内ID 733',
          custodyDays: 1,
          periods: {
            '1d': { ...metric, exposure },
            '7d': { ...metric, exposure: exposure + 7 },
            '30d': { ...metric, exposure: exposure + 30 },
          },
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
    }), 'utf8');
  };

  await writeOne('2026-06-11', '2026-06-10', 321, '旧日期 Pocket3');
  await writeOne('2026-06-12', '2026-06-11', 999, '最新日期 Pocket3');
  return dir;
}

async function writeX200RankingContext(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mt-agent-x200-ranking-'));
  await mkdir(join(dir, '2026-06-11'), { recursive: true });
  await writeFile(join(dir, '2026-06-11', 'report-context.json'), JSON.stringify({
    date: '2026-06-11',
    summary: { '1d': summary, '7d': summary, '30d': summary },
    conclusions: [],
    rows: [
      {
        productName: 'vivoX200Ultra增距镜蔡司2.35倍演...',
        platformProductId: 'p372',
        displayProductId: '端内ID 372',
        custodyDays: 30,
        periods: {
          '1d': { ...metric, exposure: 198, publicVisits: 4 },
          '7d': { ...metric, exposure: 100767, publicVisits: 5044, amount: 0 },
          '30d': metric,
        },
      },
      {
        productName: 'VIVO X200 Ultra 演唱会神器 2亿像...',
        platformProductId: 'p362',
        displayProductId: '端内ID 362',
        custodyDays: 30,
        periods: {
          '1d': { ...metric, exposure: 20, publicVisits: 3 },
          '7d': { ...metric, exposure: 4000, publicVisits: 1028, amount: 3697.12 },
          '30d': metric,
        },
      },
      {
        productName: '三星Galaxy S23Ultra演唱会神器2亿...',
        platformProductId: 'p786',
        displayProductId: '端内ID 786',
        custodyDays: 30,
        periods: {
          '1d': { ...metric, exposure: 81, publicVisits: 3 },
          '7d': { ...metric, exposure: 135, publicVisits: 5, amount: 0 },
          '30d': metric,
        },
      },
      {
        productName: '三星Galaxy S23Ultra短租特惠演唱...',
        platformProductId: 'p500',
        displayProductId: '端内ID 500',
        custodyDays: 30,
        periods: {
          '1d': { ...metric, exposure: 0, publicVisits: 0 },
          '7d': { ...metric, exposure: 20885, publicVisits: 742, amount: 0 },
          '30d': metric,
        },
      },
    ],
    lowExposure: [],
    weakClick: [],
    weakConversion: [],
    highPotential: [],
    newProductObservation: [],
    lifecycleGovernance: [],
    recommendedActions: [],
    newProductPoolIds: [],
    newProductPoolItems: [],
    emptySectionNotes: {},
  }), 'utf8');
  return dir;
}

async function writeRankingRegistryFixtures(rootDir: string, artifactsDir: string): Promise<TestRegistryPaths> {
  const configDir = join(rootDir, 'config');
  const stateDir = join(rootDir, 'output', 'state');
  await mkdir(configDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  await writeFile(join(configDir, 'product-id-map.json'), JSON.stringify({ p701: '701', p702: '702' }), 'utf8');
  await writeFile(join(configDir, 'product-name-map.json'), JSON.stringify({ '701': 'DJI Pocket 3', '702': 'DJI Pocket 3' }), 'utf8');
  await writeFile(join(configDir, 'link-registry-overrides.json'), JSON.stringify({ version: 1, entries: [] }), 'utf8');
  return {
    productIdMapPath: join(configDir, 'product-id-map.json'),
    productNameMapPath: join(configDir, 'product-name-map.json'),
    goodsSnapshotPath: join(stateDir, 'goods-current-snapshot.json'),
    firstSeenPath: join(stateDir, 'goods-first-seen.json'),
    lifecyclePath: join(stateDir, 'goods-link-lifecycle.json'),
    daemonCatalogPath: join(stateDir, 'link-registry-daemon-catalog.json'),
    overridesPath: join(configDir, 'link-registry-overrides.json'),
    artifactsDir,
  };
}

async function writeX200RankingRegistryFixtures(rootDir: string, artifactsDir: string): Promise<TestRegistryPaths> {
  const configDir = join(rootDir, 'config');
  const stateDir = join(rootDir, 'output', 'state');
  await mkdir(configDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  await writeFile(join(configDir, 'product-id-map.json'), JSON.stringify({ p362: '362', p372: '372', p500: '500', p786: '786' }), 'utf8');
  await writeFile(join(configDir, 'product-name-map.json'), JSON.stringify({
    '362': 'vivo X200 Ultra',
    '372': 'vivo 蔡司增距镜',
    '500': '三星Galaxy S23Ultra短租特惠演唱',
    '786': '三星Galaxy S23Ultra演唱会神器',
  }), 'utf8');
  await writeFile(join(configDir, 'link-registry-overrides.json'), JSON.stringify({
    version: 1,
    entries: [
      { internalProductId: '500', productName: '三星Galaxy S23Ultra短租特惠演唱', shortName: '三星 Galaxy S23 Ultra', aliases: ['s23u', 'S23U', 's23'], sameSkuGroupId: 'samsung-galaxy-s23-ultra', updatedAt: '2026-06-27' },
      { internalProductId: '786', productName: '三星Galaxy S23Ultra演唱会神器', shortName: '三星 Galaxy S23 Ultra', aliases: ['s23u', 'S23U', 's23'], sameSkuGroupId: 'samsung-galaxy-s23-ultra', updatedAt: '2026-06-27' },
    ],
    sameSkuGroupAliasRules: [{ sameSkuGroupId: 'samsung-galaxy-s23-ultra', aliases: ['s23u', 'S23U', 's23'] }],
  }), 'utf8');
  return {
    productIdMapPath: join(configDir, 'product-id-map.json'),
    productNameMapPath: join(configDir, 'product-name-map.json'),
    goodsSnapshotPath: join(stateDir, 'goods-current-snapshot.json'),
    firstSeenPath: join(stateDir, 'goods-first-seen.json'),
    lifecyclePath: join(stateDir, 'goods-link-lifecycle.json'),
    daemonCatalogPath: join(stateDir, 'link-registry-daemon-catalog.json'),
    overridesPath: join(configDir, 'link-registry-overrides.json'),
    artifactsDir,
  };
}

async function writeX200PriceSnapshotRegistryFixtures(rootDir: string, productCount = 2): Promise<TestRegistryPaths> {
  const configDir = join(rootDir, 'config');
  const outputDir = join(rootDir, 'output');
  const stateDir = join(outputDir, 'state');
  await mkdir(configDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  const productIds = Array.from({ length: productCount }, (_, index) => String(362 + index));
  await writeFile(join(configDir, 'product-id-map.json'), JSON.stringify(Object.fromEntries(productIds.map((id) => [`p${id}`, id]))), 'utf8');
  await writeFile(join(configDir, 'product-name-map.json'), JSON.stringify(Object.fromEntries(productIds.map((id) => [id, `vivo X200 Ultra ${id}`]))), 'utf8');
  await writeFile(join(configDir, 'link-registry-overrides.json'), JSON.stringify({
    version: 1,
    entries: productIds.map((id) => ({
      internalProductId: id,
      productName: `vivo X200 Ultra ${id}`,
      shortName: 'vivo X200 Ultra',
      aliases: ['x200u', 'X200U'],
      sameSkuGroupId: 'vivo-x200-ultra',
      updatedAt: '2026-06-26',
    })),
    sameSkuGroupAliasRules: [{ sameSkuGroupId: 'vivo-x200-ultra', aliases: ['x200u', 'X200U'] }],
  }), 'utf8');
  return {
    productIdMapPath: join(configDir, 'product-id-map.json'),
    productNameMapPath: join(configDir, 'product-name-map.json'),
    goodsSnapshotPath: join(stateDir, 'goods-current-snapshot.json'),
    firstSeenPath: join(stateDir, 'goods-first-seen.json'),
    lifecyclePath: join(stateDir, 'goods-link-lifecycle.json'),
    daemonCatalogPath: join(stateDir, 'link-registry-daemon-catalog.json'),
    overridesPath: join(configDir, 'link-registry-overrides.json'),
    artifactsDir: outputDir,
  };
}

async function writeAceProPriceRegistryFixtures(rootDir: string): Promise<TestRegistryPaths> {
  const configDir = join(rootDir, 'config');
  const outputDir = join(rootDir, 'output');
  const stateDir = join(outputDir, 'state');
  await mkdir(configDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  await mkdir(join(outputDir, '2026-06-27'), { recursive: true });
  await writeFile(join(configDir, 'product-id-map.json'), JSON.stringify({ p841: '841', p842: '842' }), 'utf8');
  await writeFile(join(configDir, 'product-name-map.json'), JSON.stringify({
    '841': '影石 Insta360 Ace Pro 2 标准套装',
    '842': '影石 Insta360 Ace Pro 2 续航套装',
  }), 'utf8');
  await writeFile(join(configDir, 'link-registry-overrides.json'), JSON.stringify({
    version: 1,
    entries: [
      { internalProductId: '841', productName: '影石 Insta360 Ace Pro 2 标准套装', shortName: 'Ace Pro 2', aliases: ['acepro2', 'Ace Pro 2'], sameSkuGroupId: 'insta360-ace-pro-2', status: 'active', updatedAt: '2026-06-27' },
      { internalProductId: '842', productName: '影石 Insta360 Ace Pro 2 续航套装', shortName: 'Ace Pro 2', aliases: ['acepro2', 'Ace Pro 2'], sameSkuGroupId: 'insta360-ace-pro-2', status: 'active', updatedAt: '2026-06-27' },
    ],
    sameSkuGroupAliasRules: [{ sameSkuGroupId: 'insta360-ace-pro-2', aliases: ['acepro2', 'Ace Pro 2'] }],
  }), 'utf8');
  return {
    productIdMapPath: join(configDir, 'product-id-map.json'),
    productNameMapPath: join(configDir, 'product-name-map.json'),
    goodsSnapshotPath: join(stateDir, 'goods-current-snapshot.json'),
    firstSeenPath: join(stateDir, 'goods-first-seen.json'),
    lifecyclePath: join(stateDir, 'goods-link-lifecycle.json'),
    daemonCatalogPath: join(stateDir, 'link-registry-daemon-catalog.json'),
    overridesPath: join(configDir, 'link-registry-overrides.json'),
    artifactsDir: outputDir,
  };
}

async function writePocket4PriceRegistryFixtures(rootDir: string): Promise<TestRegistryPaths> {
  const configDir = join(rootDir, 'config');
  const outputDir = join(rootDir, 'output');
  const stateDir = join(outputDir, 'state');
  await mkdir(configDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  await mkdir(join(outputDir, '2026-06-27'), { recursive: true });
  await writeFile(join(configDir, 'product-id-map.json'), JSON.stringify({
    '2026062922000000000914': '914',
    '2026062922000000001915': '915',
    '2026062922000000002916': '916',
  }), 'utf8');
  await writeFile(join(configDir, 'product-name-map.json'), JSON.stringify({
    '914': 'Pocket 4 Pro A',
    '915': 'Pocket 4 Pro B',
    '916': 'Pocket 4 Pro C',
  }), 'utf8');
  await writeFile(join(configDir, 'link-registry-overrides.json'), JSON.stringify({
    version: 1,
    entries: [
      { internalProductId: '914', productName: 'Pocket 4 Pro A', shortName: 'Pocket 4 Pro', sameSkuGroupId: 'dji-pocket-4-pro', status: 'active', updatedAt: '2026-06-27' },
      { internalProductId: '915', productName: 'Pocket 4 Pro B', shortName: 'Pocket 4 Pro', sameSkuGroupId: 'dji-pocket-4-pro', status: 'active', updatedAt: '2026-06-27' },
      { internalProductId: '916', productName: 'Pocket 4 Pro C', shortName: 'Pocket 4 Pro', sameSkuGroupId: 'dji-pocket-4-pro', status: 'active', updatedAt: '2026-06-27' },
    ],
    sameSkuGroupAliasRules: [{ sameSkuGroupId: 'dji-pocket-4-pro', aliases: ['pocket4pro', 'Pocket 4 Pro'] }],
  }), 'utf8');
  return {
    productIdMapPath: join(configDir, 'product-id-map.json'),
    productNameMapPath: join(configDir, 'product-name-map.json'),
    goodsSnapshotPath: join(stateDir, 'goods-current-snapshot.json'),
    firstSeenPath: join(stateDir, 'goods-first-seen.json'),
    lifecyclePath: join(stateDir, 'goods-link-lifecycle.json'),
    daemonCatalogPath: join(stateDir, 'link-registry-daemon-catalog.json'),
    overridesPath: join(configDir, 'link-registry-overrides.json'),
    artifactsDir: outputDir,
  };
}

async function writeX300SpecRemoveRegistryFixtures(rootDir: string): Promise<TestRegistryPaths> {
  const configDir = join(rootDir, 'config');
  const outputDir = join(rootDir, 'output');
  const stateDir = join(outputDir, 'state');
  await mkdir(configDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  await writeFile(join(configDir, 'product-id-map.json'), JSON.stringify({ p501: '501', p502: '502' }), 'utf8');
  await writeFile(join(configDir, 'product-name-map.json'), JSON.stringify({ '501': 'vivo X300 Ultra 手柄套装', '502': 'vivo X300 Ultra 标准套装' }), 'utf8');
  await writeFile(join(configDir, 'link-registry-overrides.json'), JSON.stringify({
    version: 1,
    entries: [
      { internalProductId: '501', productName: 'vivo X300 Ultra 手柄套装', shortName: 'vivo X300 Ultra', aliases: ['x300u-spec-test', 'X300U-SPEC-TEST'], sameSkuGroupId: 'vivo-x300-ultra-spec-test', updatedAt: '2026-06-26' },
      { internalProductId: '502', productName: 'vivo X300 Ultra 标准套装', shortName: 'vivo X300 Ultra', aliases: ['x300u-spec-test', 'X300U-SPEC-TEST'], sameSkuGroupId: 'vivo-x300-ultra-spec-test', updatedAt: '2026-06-26' },
    ],
    sameSkuGroupAliasRules: [{ sameSkuGroupId: 'vivo-x300-ultra-spec-test', aliases: ['x300u-spec-test', 'X300U-SPEC-TEST'] }],
  }), 'utf8');
  return {
    productIdMapPath: join(configDir, 'product-id-map.json'),
    productNameMapPath: join(configDir, 'product-name-map.json'),
    goodsSnapshotPath: join(stateDir, 'goods-current-snapshot.json'),
    firstSeenPath: join(stateDir, 'goods-first-seen.json'),
    lifecyclePath: join(stateDir, 'goods-link-lifecycle.json'),
    daemonCatalogPath: join(stateDir, 'link-registry-daemon-catalog.json'),
    overridesPath: join(configDir, 'link-registry-overrides.json'),
    artifactsDir: outputDir,
  };
}

async function writeBulkSpecRemoveRegistryFixtures(rootDir: string, ids: string[]): Promise<TestRegistryPaths> {
  const configDir = join(rootDir, 'config');
  const outputDir = join(rootDir, 'output');
  const stateDir = join(outputDir, 'state');
  await mkdir(configDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  await writeFile(join(configDir, 'product-id-map.json'), JSON.stringify(Object.fromEntries(ids.map((id) => [`p${id}`, id]))), 'utf8');
  await writeFile(join(configDir, 'product-name-map.json'), JSON.stringify(Object.fromEntries(ids.map((id) => [id, `vivo X300 Ultra ${id}`]))), 'utf8');
  await writeFile(join(configDir, 'link-registry-overrides.json'), JSON.stringify({
    version: 1,
    entries: ids.map((id) => ({
      internalProductId: id,
      productName: `vivo X300 Ultra ${id}`,
      shortName: 'vivo X300 Ultra',
      aliases: ['x300u', 'X300U'],
      sameSkuGroupId: 'vivo-x300-ultra',
      status: 'active',
      updatedAt: '2026-06-26',
    })),
    sameSkuGroupAliasRules: [{ sameSkuGroupId: 'vivo-x300-ultra', aliases: ['x300u', 'X300U'] }],
  }), 'utf8');
  return {
    productIdMapPath: join(configDir, 'product-id-map.json'),
    productNameMapPath: join(configDir, 'product-name-map.json'),
    goodsSnapshotPath: join(stateDir, 'goods-current-snapshot.json'),
    firstSeenPath: join(stateDir, 'goods-first-seen.json'),
    lifecyclePath: join(stateDir, 'goods-link-lifecycle.json'),
    daemonCatalogPath: join(stateDir, 'link-registry-daemon-catalog.json'),
    overridesPath: join(configDir, 'link-registry-overrides.json'),
    artifactsDir: outputDir,
  };
}

async function writeRefreshActivityFixtures(): Promise<{
  outputDir: string;
  registryPaths: TestRegistryPaths;
}> {
  const rootDir = await mkdtemp(join(tmpdir(), 'mt-agent-refresh-activity-'));
  const outputDir = join(rootDir, 'output');
  const configDir = join(rootDir, 'config');
  const stateDir = join(outputDir, 'state');
  await mkdir(join(outputDir, '2026-06-11'), { recursive: true });
  await mkdir(configDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  const zero30d = { ...metric, exposure: 300, publicVisits: 30, dashboardVisits: 20, createdOrders: 0, hasDashboardData: true };
  const active30d = { ...metric, exposure: 600, publicVisits: 80, dashboardVisits: 60, createdOrders: 3, hasDashboardData: true };
  const missing30d = { ...metric, exposure: 100, publicVisits: 0, dashboardVisits: 0, createdOrders: 0, hasDashboardData: false };
  await writeFile(join(outputDir, '2026-06-11', 'report-context.json'), JSON.stringify({
    date: '2026-06-11',
    summary: { '1d': summary, '7d': summary, '30d': summary },
    conclusions: [],
    rows: [
      { productName: 'Pocket3 健康源', platformProductId: 'p900', displayProductId: '端内ID 900', custodyDays: 50, periods: { '1d': metric, '7d': metric, '30d': active30d } },
      { productName: 'Pocket3 零创单 A', platformProductId: 'p901', displayProductId: '端内ID 901', custodyDays: 35, periods: { '1d': metric, '7d': metric, '30d': zero30d } },
      { productName: 'Pocket3 零创单 B', platformProductId: 'p902', displayProductId: '端内ID 902', custodyDays: 40, periods: { '1d': metric, '7d': metric, '30d': zero30d } },
      { productName: 'SQ1 有创单', platformProductId: 'p903', displayProductId: '端内ID 903', custodyDays: 40, periods: { '1d': metric, '7d': metric, '30d': active30d } },
      { productName: 'Wide 300 缺访问页', platformProductId: 'p904', displayProductId: '端内ID 904', custodyDays: 40, periods: { '1d': metric, '7d': metric, '30d': missing30d } },
      { productName: 'Pocket3 新链零创单', platformProductId: 'p906', displayProductId: '端内ID 906', custodyDays: 12, periods: { '1d': metric, '7d': metric, '30d': zero30d } },
      { productName: 'Pocket3 上线天数未知', platformProductId: 'p907', displayProductId: '端内ID 907', custodyDays: null, periods: { '1d': metric, '7d': metric, '30d': zero30d } },
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
  await writeFile(join(configDir, 'product-id-map.json'), JSON.stringify({ p900: '900', p901: '901', p902: '902', p903: '903', p904: '904', p906: '906', p907: '907' }), 'utf8');
  await writeFile(join(configDir, 'product-name-map.json'), JSON.stringify({
    '900': 'Pocket3 健康源',
    '901': 'Pocket3 零创单 A',
    '902': 'Pocket3 零创单 B',
    '903': 'SQ1 有创单',
    '904': 'Wide 300 缺访问页',
    '906': 'Pocket3 新链零创单',
    '907': 'Pocket3 上线天数未知',
  }), 'utf8');
  await writeFile(join(configDir, 'link-registry-overrides.json'), JSON.stringify({
    version: 1,
    entries: [
      { internalProductId: '900', shortName: 'DJI Pocket 3', sameSkuGroupId: 'dji-pocket-3', categoryName: '云台相机', status: 'active' },
      { internalProductId: '901', shortName: 'DJI Pocket 3', sameSkuGroupId: 'dji-pocket-3', categoryName: '云台相机', status: 'active' },
      { internalProductId: '902', shortName: 'DJI Pocket 3', sameSkuGroupId: 'dji-pocket-3', categoryName: '云台相机', status: 'active' },
      { internalProductId: '903', shortName: 'SQ1', sameSkuGroupId: 'instax-sq1', categoryName: '拍立得', status: 'active' },
      { internalProductId: '904', shortName: 'Wide 300', sameSkuGroupId: 'instax-wide300', categoryName: '拍立得', status: 'active' },
      { internalProductId: '905', shortName: 'Removed item', sameSkuGroupId: 'removed-group', categoryName: '其他', status: 'removed' },
      { internalProductId: '906', shortName: 'DJI Pocket 3', sameSkuGroupId: 'dji-pocket-3', categoryName: '云台相机', status: 'active' },
      { internalProductId: '907', shortName: 'DJI Pocket 3', sameSkuGroupId: 'dji-pocket-3', categoryName: '云台相机', status: 'active' },
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

async function writeClosedOrderRegistryFixtures(rootDir: string): Promise<TestRegistryPaths> {
  const configDir = join(rootDir, 'config');
  const outputDir = join(rootDir, 'output');
  await mkdir(configDir, { recursive: true });
  await mkdir(join(outputDir, 'state'), { recursive: true });
  await mkdir(join(outputDir, '2026-06-21'), { recursive: true });
  await writeFile(join(configDir, 'product-id-map.json'), JSON.stringify({ 'platform-560': '560', 'platform-561': '561' }), 'utf8');
  await writeFile(join(configDir, 'product-name-map.json'), JSON.stringify({ '560': 'DJI Pocket 3', '561': 'DJI Pocket 3 Creator' }), 'utf8');
  await writeFile(join(configDir, 'link-registry-overrides.json'), JSON.stringify({
    version: 1,
    entries: [
      { internalProductId: '560', categoryId: 'camera', categoryName: '相机', productType: 'gimbal-camera', shortName: 'DJI Pocket 3', aliases: ['Pocket3'], sameSkuGroupId: 'dji-pocket-3', updatedAt: '2026-06-24' },
      { internalProductId: '561', categoryId: 'camera', categoryName: '相机', productType: 'gimbal-camera', shortName: 'DJI Pocket 3', aliases: ['Pocket3 Creator'], sameSkuGroupId: 'dji-pocket-3', updatedAt: '2026-06-24' },
    ],
  }), 'utf8');
  await writeFile(join(outputDir, '2026-06-21', 'exposure-cumulative-products.json'), JSON.stringify([
    { platformProductId: 'platform-560', productName: 'DJI Pocket 3 Creator Combo' },
    { platformProductId: 'platform-561', productName: 'DJI Pocket 3 Standard' },
  ]), 'utf8');
  return {
    productIdMapPath: join(configDir, 'product-id-map.json'),
    productNameMapPath: join(configDir, 'product-name-map.json'),
    goodsSnapshotPath: join(outputDir, 'state', 'goods-current-snapshot.json'),
    firstSeenPath: join(outputDir, 'state', 'goods-first-seen.json'),
    lifecyclePath: join(outputDir, 'state', 'goods-link-lifecycle.json'),
    daemonCatalogPath: join(outputDir, 'state', 'link-registry-daemon-catalog.json'),
    overridesPath: join(configDir, 'link-registry-overrides.json'),
    artifactsDir: outputDir,
  };
}

async function writeLinkRegistryOverviewFixtures(rootDir: string): Promise<TestRegistryPaths> {
  const configDir = join(rootDir, 'config');
  const outputDir = join(rootDir, 'output');
  await mkdir(configDir, { recursive: true });
  await mkdir(join(outputDir, 'state'), { recursive: true });
  await writeFile(join(configDir, 'product-id-map.json'), JSON.stringify({
    'platform-560': '560',
    'platform-561': '561',
    'platform-562': '562',
    'platform-590': '590',
  }), 'utf8');
  await writeFile(join(configDir, 'product-name-map.json'), JSON.stringify({
    '560': 'DJI Pocket 3 全能套装',
    '561': 'DJI Pocket 3 标准版',
    '562': 'DJI Pocket 3 Creator Combo',
    '580': 'Canon SX70 HS',
    '590': '未归类商品',
  }), 'utf8');
  await writeFile(join(outputDir, 'state', 'goods-link-lifecycle.json'), JSON.stringify({
    active: {
      '560': { platformProductId: 'platform-560', productName: 'DJI Pocket 3 全能套装' },
      '561': { platformProductId: 'platform-561', productName: 'DJI Pocket 3 标准版' },
      '590': { platformProductId: 'platform-590', productName: '未归类商品' },
    },
    removedLinks: [
      {
        productId: '562',
        platformProductId: 'platform-562',
        productName: 'DJI Pocket 3 Creator Combo',
        removedDate: '2026-06-22',
        reason: '商品总表缺失',
        source: 'goods_snapshot_diff',
      },
    ],
  }), 'utf8');
  await writeFile(join(configDir, 'link-registry-overrides.json'), JSON.stringify({
    version: 1,
    entries: [
      {
        internalProductId: '560',
        categoryId: 'camera',
        categoryName: '相机',
        productType: 'dji-pocket-3',
        shortName: 'DJI Pocket 3',
        aliases: ['Pocket3'],
        sameSkuGroupId: 'dji-pocket-3',
        updatedAt: '2026-06-23',
      },
      {
        internalProductId: '561',
        categoryId: 'camera',
        categoryName: '相机',
        productType: 'dji-pocket-3',
        shortName: 'DJI Pocket 3',
        aliases: ['Pocket3 标准版'],
        sameSkuGroupId: 'dji-pocket-3',
        updatedAt: '2026-06-23',
      },
      {
        internalProductId: '562',
        categoryId: 'camera',
        categoryName: '相机',
        productType: 'dji-pocket-3',
        shortName: 'DJI Pocket 3',
        aliases: ['Pocket3 Creator'],
        sameSkuGroupId: 'dji-pocket-3',
        updatedAt: '2026-06-23',
      },
      {
        internalProductId: '580',
        categoryId: 'camera',
        categoryName: '相机',
        productType: 'canon-sx70',
        shortName: 'Canon SX70 HS',
        aliases: ['SX70'],
        sameSkuGroupId: 'canon-sx70',
        updatedAt: '2026-06-23',
      },
      {
        internalProductId: '999',
        categoryId: 'camera',
        categoryName: '相机',
      },
    ],
    sameSkuGroupAliasRules: [
      {
        sameSkuGroupId: 'dji-pocket-3',
        aliases: ['口袋3', 'pocket 3'],
        updatedAt: '2026-06-23',
      },
    ],
  }), 'utf8');
  return {
    productIdMapPath: join(configDir, 'product-id-map.json'),
    productNameMapPath: join(configDir, 'product-name-map.json'),
    goodsSnapshotPath: join(outputDir, 'state', 'goods-current-snapshot.json'),
    firstSeenPath: join(outputDir, 'state', 'goods-first-seen.json'),
    lifecyclePath: join(outputDir, 'state', 'goods-link-lifecycle.json'),
    daemonCatalogPath: join(outputDir, 'state', 'link-registry-daemon-catalog.json'),
    overridesPath: join(configDir, 'link-registry-overrides.json'),
    artifactsDir: outputDir,
  };
}

async function writeInventoryStatusFixtures(rootDir: string): Promise<{
  outputDir: string;
  registryPaths: TestRegistryPaths;
}> {
  const outputDir = join(rootDir, 'output');
  const configDir = join(rootDir, 'config');
  const stateDir = join(outputDir, 'state');
  const runDate = '2026-06-24';
  const reportDir = join(outputDir, runDate);
  await mkdir(reportDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  await mkdir(configDir, { recursive: true });

  await writeFile(join(reportDir, 'report-context.json'), JSON.stringify({
    date: '2026-06-23',
    summary: { '1d': summary, '7d': summary, '30d': summary },
    conclusions: [],
    rows: [],
    lowExposure: [],
    weakClick: [],
    weakConversion: [],
    highPotential: [],
    newProductObservation: [],
    lifecycleGovernance: [],
    recommendedActions: [],
    emptySectionNotes: {},
  }), 'utf8');

  await writeFile(join(reportDir, '同款组经营快照_2026-06-24.json'), JSON.stringify({
    date: '2026-06-24',
    sourceReportDate: '2026-06-23',
    generatedAt: '2026-06-24T00:00:00.000Z',
    summary: { sameSkuGroupCount: 2, activeLinkCount: 3, totalLinkCount: 4 },
    coverage: { groupedLinkCount: 4, ungroupedLinkCount: 0, groupsWithMetrics: 2, groupsWithoutMetrics: 0 },
    registryAuditSummary: { totalLinks: 4, activeLinks: 3, removedLinks: 1, unknownLinks: 0, overrideRiskCount: 0 },
    groups: [
      {
        sameSkuGroupId: 'dji-pocket-3',
        groupName: 'DJI Pocket 3',
        categoryName: '相机',
        productType: 'gimbal-camera',
        activeLinkCount: 2,
        totalLinkCount: 3,
        mappedRowCount: 2,
        missingMetricLinkCount: 1,
        periods: {
          '1d': { exposure: 300, publicVisits: 30, amount: 120, createdOrders: 3, signedOrders: 3, reviewedOrders: 3, shippedOrders: 2, createdOrderAmount: 140, signedOrderAmount: 125, reviewedOrderAmount: 120, shippedOrderAmount: 110, exposureVisitRate: 0.1, visitCreatedOrderRate: 0.1, visitShipmentRate: 2 / 30 },
          '7d': { exposure: 2100, publicVisits: 210, amount: 980, createdOrders: 12, signedOrders: 10, reviewedOrders: 10, shippedOrders: 8, createdOrderAmount: 1180, signedOrderAmount: 1080, reviewedOrderAmount: 980, shippedOrderAmount: 930, exposureVisitRate: 0.1, visitCreatedOrderRate: 12 / 210, visitShipmentRate: 8 / 210 },
          '30d': { exposure: 9000, publicVisits: 720, amount: 3600, createdOrders: 35, signedOrders: 32, reviewedOrders: 30, shippedOrders: 28, createdOrderAmount: 3900, signedOrderAmount: 3720, reviewedOrderAmount: 3600, shippedOrderAmount: 3450, exposureVisitRate: 0.08, visitCreatedOrderRate: 35 / 720, visitShipmentRate: 28 / 720 },
        },
        topLinks: [
          { internalProductId: '560', platformProductId: 'platform-560', productName: 'DJI Pocket 3 创作者套装', shortName: 'DJI Pocket 3', status: 'active', oneDayExposure: 200, oneDayPublicVisits: 20, oneDayAmount: 80 },
        ],
        risks: ['组内 1 条链接无日报数据'],
      },
      {
        sameSkuGroupId: 'canon-sx70',
        groupName: 'Canon SX70 HS',
        categoryName: '相机',
        productType: 'camera',
        activeLinkCount: 1,
        totalLinkCount: 1,
        mappedRowCount: 1,
        missingMetricLinkCount: 0,
        periods: {
          '1d': { exposure: 80, publicVisits: 8, amount: 40, createdOrders: 1, signedOrders: 1, reviewedOrders: 1, shippedOrders: 1, createdOrderAmount: 50, signedOrderAmount: 50, reviewedOrderAmount: 40, shippedOrderAmount: 40, exposureVisitRate: 0.1, visitCreatedOrderRate: 0.125, visitShipmentRate: 0.125 },
          '7d': { exposure: 500, publicVisits: 40, amount: 200, createdOrders: 2, signedOrders: 2, reviewedOrders: 2, shippedOrders: 2, createdOrderAmount: 220, signedOrderAmount: 220, reviewedOrderAmount: 200, shippedOrderAmount: 200, exposureVisitRate: 0.08, visitCreatedOrderRate: 0.05, visitShipmentRate: 0.05 },
          '30d': { exposure: 2400, publicVisits: 190, amount: 800, createdOrders: 7, signedOrders: 7, reviewedOrders: 7, shippedOrders: 6, createdOrderAmount: 900, signedOrderAmount: 880, reviewedOrderAmount: 800, shippedOrderAmount: 760, exposureVisitRate: 190 / 2400, visitCreatedOrderRate: 7 / 190, visitShipmentRate: 6 / 190 },
        },
        topLinks: [],
        risks: [],
      },
    ],
  }), 'utf8');

  await writeFile(join(configDir, 'product-id-map.json'), JSON.stringify({
    'platform-560': '560',
    'platform-561': '561',
    'platform-562': '562',
    'platform-580': '580',
  }), 'utf8');
  await writeFile(join(configDir, 'product-name-map.json'), JSON.stringify({
    '560': 'DJI Pocket 3',
    '561': 'DJI Pocket 3 标准版',
    '562': 'DJI Pocket 3 Creator',
    '580': 'Canon SX70 HS',
  }), 'utf8');
  await writeFile(join(configDir, 'link-registry-overrides.json'), JSON.stringify({
    version: 1,
    entries: [
      { internalProductId: '560', categoryId: 'camera', categoryName: '相机', productType: 'gimbal-camera', shortName: 'DJI Pocket 3', aliases: ['Pocket3'], sameSkuGroupId: 'dji-pocket-3', updatedAt: '2026-06-24' },
      { internalProductId: '561', categoryId: 'camera', categoryName: '相机', productType: 'gimbal-camera', shortName: 'DJI Pocket 3', aliases: ['Pocket3 标准版'], sameSkuGroupId: 'dji-pocket-3', updatedAt: '2026-06-24' },
      { internalProductId: '562', categoryId: 'camera', categoryName: '相机', productType: 'gimbal-camera', shortName: 'DJI Pocket 3', aliases: ['Pocket3 Creator'], sameSkuGroupId: 'dji-pocket-3', updatedAt: '2026-06-24' },
      { internalProductId: '580', categoryId: 'camera', categoryName: '相机', productType: 'camera', shortName: 'Canon SX70 HS', aliases: ['SX70'], sameSkuGroupId: 'canon-sx70', updatedAt: '2026-06-24' },
      { internalProductId: '841', categoryId: 'camera', categoryName: '相机', productType: 'action-camera', shortName: 'Ace Pro 2', aliases: ['Ace pro 2', 'AcePro2', 'ace pro'], sameSkuGroupId: 'insta360-ace-pro-2', updatedAt: '2026-06-24' },
      { internalProductId: '851', categoryId: 'camera', categoryName: '相机', productType: 'action-camera', shortName: 'Ace Pro', aliases: ['Ace pro'], sameSkuGroupId: 'insta360-ace-pro', updatedAt: '2026-06-24' },
    ],
    sameSkuGroupAliasRules: [
      { sameSkuGroupId: 'dji-pocket-3', aliases: ['口袋3', 'pocket 3'] },
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

async function writeNewLinkWorkflowContext(): Promise<{
  outputDir: string;
  registryPaths: TestRegistryPaths;
}> {
  const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-new-link-workflow-output-'));
  const registryRoot = await mkdtemp(join(tmpdir(), 'mt-agent-new-link-workflow-registry-'));
  const configDir = join(registryRoot, 'config');
  const stateDir = join(registryRoot, 'output', 'state');
  await mkdir(join(outputDir, '2026-06-22'), { recursive: true });
  await mkdir(configDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  await writeFile(join(configDir, 'product-id-map.json'), JSON.stringify({
    'platform-733': '733',
    'platform-875': '875',
    'platform-841': '841',
    'platform-388': '388',
    'platform-490': '490',
    'platform-301': '301',
    'platform-302': '302',
    'platform-401': '401',
    'platform-402': '402',
  }), 'utf8');
  await writeFile(join(configDir, 'product-name-map.json'), JSON.stringify({
    '733': '大疆 Pocket3',
    '875': 'DJI Pocket 3',
    '841': '佳能 R50',
    '388': 'Fujifilm instax SQUARE SQ1',
    '490': 'Fujifilm instax SQUARE SQ1',
    '301': 'Wide 300',
    '302': 'Wide 300',
    '401': 'Wide 400',
    '402': 'Wide 400',
  }), 'utf8');
  await writeFile(join(configDir, 'link-registry-overrides.json'), JSON.stringify({ version: 1, entries: [] }), 'utf8');
  await writeFile(join(outputDir, '2026-06-22', 'report-context.json'), JSON.stringify({
    date: '2026-06-22',
    summary: { '1d': summary, '7d': summary, '30d': summary },
    conclusions: [],
    rows: [
      {
        productName: '大疆DJI Pocket3云台相机128G 高转化',
        platformProductId: 'platform-733',
        displayProductId: '端内ID 733',
        custodyDays: 7,
        periods: {
          '1d': { ...metric, exposure: 100, publicVisits: 10, shippedOrders: 0, amount: 0 },
          '7d': { ...metric, exposure: 1700, publicVisits: 220, shippedOrders: 4, amount: 1800 },
          '30d': { ...metric, exposure: 300, publicVisits: 20, shippedOrders: 0, amount: 0 },
        },
      },
      {
        productName: '大疆DJI Pocket3云台相机128G 低表现',
        platformProductId: 'platform-875',
        displayProductId: '端内ID 875',
        custodyDays: 7,
        periods: {
          '1d': { ...metric, exposure: 50, publicVisits: 5, shippedOrders: 0, amount: 0 },
          '7d': { ...metric, exposure: 300, publicVisits: 30, shippedOrders: 0, amount: 120 },
          '30d': { ...metric, exposure: 300, publicVisits: 20, shippedOrders: 0, amount: 0 },
        },
      },
      {
        productName: '佳能R50微单相机',
        platformProductId: 'platform-841',
        displayProductId: '端内ID 841',
        custodyDays: 7,
        periods: {
          '1d': { ...metric, exposure: 100, publicVisits: 10, shippedOrders: 0, amount: 0 },
          '7d': { ...metric, exposure: 1200, publicVisits: 140, shippedOrders: 2, amount: 700 },
          '30d': { ...metric, exposure: 300, publicVisits: 20, shippedOrders: 0, amount: 0 },
        },
      },
      {
        productName: 'Fujifilm instax SQUARE SQ1 high conversion',
        platformProductId: 'platform-388',
        displayProductId: '端内ID 388',
        custodyDays: 7,
        periods: {
          '1d': { ...metric, exposure: 300, publicVisits: 90, shippedOrders: 0, amount: 1200 },
          '7d': { ...metric, exposure: 9000, publicVisits: 900, shippedOrders: 6, amount: 4500 },
          '30d': { ...metric, exposure: 300, publicVisits: 20, shippedOrders: 0, amount: 0 },
        },
      },
      {
        productName: 'Fujifilm instax SQUARE SQ1 low conversion',
        platformProductId: 'platform-490',
        displayProductId: '端内ID 490',
        custodyDays: 7,
        periods: {
          '1d': { ...metric, exposure: 100, publicVisits: 20, shippedOrders: 0, amount: 300 },
          '7d': { ...metric, exposure: 4000, publicVisits: 320, shippedOrders: 1, amount: 900 },
          '30d': { ...metric, exposure: 300, publicVisits: 20, shippedOrders: 0, amount: 0 },
        },
      },
      {
        productName: 'Wide 300 standard source',
        platformProductId: 'platform-301',
        displayProductId: '端内ID 301',
        custodyDays: 7,
        periods: {
          '1d': { ...metric, exposure: 100, publicVisits: 10, shippedOrders: 0, amount: 0 },
          '7d': { ...metric, exposure: 4000, publicVisits: 200, shippedOrders: 1, amount: 800 },
          '30d': { ...metric, exposure: 300, publicVisits: 20, shippedOrders: 0, amount: 0 },
        },
      },
      {
        productName: 'Wide 300 best source',
        platformProductId: 'platform-302',
        displayProductId: '端内ID 302',
        custodyDays: 7,
        periods: {
          '1d': { ...metric, exposure: 200, publicVisits: 40, shippedOrders: 0, amount: 200 },
          '7d': { ...metric, exposure: 8000, publicVisits: 700, shippedOrders: 4, amount: 3200 },
          '30d': { ...metric, exposure: 300, publicVisits: 20, shippedOrders: 0, amount: 0 },
        },
      },
      {
        productName: 'Wide 400 standard source',
        platformProductId: 'platform-401',
        displayProductId: '端内ID 401',
        custodyDays: 7,
        periods: {
          '1d': { ...metric, exposure: 90, publicVisits: 8, shippedOrders: 0, amount: 0 },
          '7d': { ...metric, exposure: 3000, publicVisits: 160, shippedOrders: 1, amount: 700 },
          '30d': { ...metric, exposure: 300, publicVisits: 20, shippedOrders: 0, amount: 0 },
        },
      },
      {
        productName: 'Wide 400 best source',
        platformProductId: 'platform-402',
        displayProductId: '端内ID 402',
        custodyDays: 7,
        periods: {
          '1d': { ...metric, exposure: 190, publicVisits: 30, shippedOrders: 0, amount: 100 },
          '7d': { ...metric, exposure: 7500, publicVisits: 650, shippedOrders: 3, amount: 2800 },
          '30d': { ...metric, exposure: 300, publicVisits: 20, shippedOrders: 0, amount: 0 },
        },
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

describe('handleBotIntent', () => {
  it('returns help text', async () => {
    const response = await handleBotIntent({ type: 'help' });

    expect(response.text).toContain('📋 查询与分析');
    expect(response.text).toContain('2026-06-22 访问最高的前20个商品');
    expect(response.text).toContain('Pocket 3 的7日访问总和是多少');
    expect(response.text).toContain('访问页缺失哪些商品');
    expect(response.text).toContain('733 的所有日报数据');
    expect(response.text).toContain('各问题池分别多少条');
    expect(response.text).toContain('关单率 / 客单价');
    expect(response.text).toContain('涉及商品修改的操作会先弹确认卡');
    expect(response.text).toContain('非商品修改操作会直接执行');
  });

  it('returns the product ID lookup input card', async () => {
    const response = await handleBotIntent({ type: 'lookup_product_id_card' });
    expect(response.text).toContain('常驻商品ID互查卡');
    expect(response.card).toBeDefined();
    expect(response.card?.schema).toBe('2.0');
    expect(JSON.stringify(response.card)).toContain('id_lookup_form');
    expect(JSON.stringify(response.card)).toContain('lookup_query');
    expect(JSON.stringify(response.card)).toContain('id_lookup');
  });

  it('returns a link registry overview card for the inventory command', async () => {
    const registryRoot = await mkdtemp(join(tmpdir(), 'mt-agent-link-registry-overview-'));
    const registryPaths = await writeLinkRegistryOverviewFixtures(registryRoot);

    const response = await handleBotIntent(
      { type: 'link_registry_overview' },
      'output',
      { closedOrderRegistryPaths: registryPaths },
    );

    expect(response.text).toContain('库存情况');
    expect(response.text).toContain('总链接 5');
    expect(response.text).toContain('分类覆盖 80%');
    expect(response.card).toBeDefined();
    const cardText = JSON.stringify(response.card);
    expect(cardText).toContain('库存情况');
    expect(cardText).toContain('分类覆盖');
    expect(cardText).toContain('风险概览');
    expect(cardText).toContain('DJI Pocket 3');
    expect(cardText).toContain('Canon SX70 HS');
    expect(cardText).toContain('未归类商品');
  });

  it('opens the link registry maintenance prompt card from an explicit command intent', async () => {
    const registryRoot = await mkdtemp(join(tmpdir(), 'mt-agent-link-registry-maintenance-prompt-'));
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-link-registry-maintenance-output-'));
    const registryPaths = await writeLinkRegistryOverviewFixtures(registryRoot);

    const response = await handleBotIntent(
      { type: 'link_registry_maintenance_prompt' },
      outputDir,
      { closedOrderRegistryPaths: registryPaths },
    );

    expect(response.card).toBeDefined();
    const cardText = JSON.stringify(response.card);
    expect(cardText).toContain('link_registry_maintenance_start_submit');
    expect(cardText).toContain('link_registry_maintenance_snooze_submit');
  });

  it('opens the link registry governance prompt card from an explicit command intent', async () => {
    const registryRoot = await mkdtemp(join(tmpdir(), 'mt-agent-link-registry-governance-prompt-'));
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-link-registry-governance-output-'));
    const registryPaths = await writeLinkRegistryOverviewFixtures(registryRoot);

    const response = await handleBotIntent(
      { type: 'link_registry_governance_prompt' },
      outputDir,
      { closedOrderRegistryPaths: registryPaths },
    );

    expect(response.card).toBeDefined();
    expect(JSON.stringify(response.card)).toContain('link_registry_governance_start_submit');
  });

  it('opens the same maintenance prompt through the Agent tool executor', async () => {
    const registryRoot = await mkdtemp(join(tmpdir(), 'mt-agent-link-registry-agent-maintenance-'));
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-link-registry-agent-output-'));
    const registryPaths = await writeLinkRegistryOverviewFixtures(registryRoot);

    const response = await executeAgentToolRequest(
      { toolName: 'linkRegistry.maintenancePrompt', arguments: {}, reason: 'open maintenance card' },
      outputDir,
      { closedOrderRegistryPaths: registryPaths },
    );

    expect(response.card).toBeDefined();
    expect(JSON.stringify(response.card)).toContain('link_registry_maintenance_start_submit');
  });

  it('returns an inventory status overview card for the new command', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'mt-agent-inventory-status-overview-'));
    const fixtures = await writeInventoryStatusFixtures(rootDir);

    const response = await handleBotIntent(
      { type: 'inventory_status_overview' },
      fixtures.outputDir,
      { closedOrderRegistryPaths: fixtures.registryPaths },
    );

    expect(response.text).toContain('库存情况');
    expect(response.text).toContain('同款组');
    expect(response.card).toBeDefined();
    const cardText = JSON.stringify(response.card);
    expect(cardText).toContain('库存情况');
    expect(cardText).toContain('链接维护概览');
    expect(cardText).toContain('待核查同款组');
    expect(cardText).toContain('DJI Pocket 3');
    expect(cardText).not.toContain('7日总金额');
    expect(cardText).not.toContain('7日总访问');
  });

  it('returns an inventory status detail card for a unique alias query', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'mt-agent-inventory-status-detail-'));
    const fixtures = await writeInventoryStatusFixtures(rootDir);

    const response = await handleBotIntent(
      { type: 'inventory_status_query', query: 'pocket3' },
      fixtures.outputDir,
      { closedOrderRegistryPaths: fixtures.registryPaths },
    );

    expect(response.text).toContain('DJI Pocket 3');
    expect(response.text).toContain('同款组');
    expect(response.card).toBeDefined();
    const cardText = JSON.stringify(response.card);
    expect(cardText).toContain('DJI Pocket 3');
    expect(cardText).toContain('主力链接');
    expect(cardText).toContain('1日');
  });

  it('answers latest summary from report context', async () => {
    const outputDir = await writeContext();
    const response = await handleBotIntent({ type: 'latest_summary' }, outputDir);
    expect(response.text).toContain('公域日报 2026-06-11');
    expect(response.text).toContain('曝光 1000');
  });

  it('answers dated latest summary from the requested report context', async () => {
    const outputDir = await writeDatedContexts();
    const response = await handleBotIntent({ type: 'latest_summary', date: '2026-06-10' }, outputDir);
    expect(response.text).toContain('公域日报 2026-06-10');
    expect(response.text).toContain('曝光 321');
    expect(response.text).not.toContain('2026-06-11');
    expect(response.text).not.toContain('曝光 999');
  });

  it('answers dated conversion summary as a focused read-only query', async () => {
    const outputDir = await writeDatedContexts();
    const response = await handleBotIntent({ type: 'conversion_summary', date: '2026-06-10' }, outputDir);
    expect(response.text).toContain('公域转化率 2026-06-10');
    expect(response.text).toContain('1日：曝光到访问率 5.00%');
    expect(response.text).toContain('访问到创建率 7.50%');
    expect(response.text).toContain('访问到发货率 2.50%');
    expect(response.text).toContain('曝光 321');
    expect(response.text).not.toContain('公域日报 2026-06-11');
  });

  it('answers product query from report context', async () => {
    const outputDir = await writeContext();
    const response = await handleBotIntent({ type: 'query_product', keyword: '565' }, outputDir);
    expect(response.text).toContain('端内ID 565 iPhone 15');
    expect(response.text).toContain('1日：曝光 10');
  });

  it('answers dated product query from the requested report context', async () => {
    const outputDir = await writeDatedContexts();
    const response = await handleBotIntent({ type: 'query_product', keyword: '733', date: '2026-06-10' }, outputDir);
    expect(response.text).toContain('端内ID 733 旧日期 Pocket3');
    expect(response.text).toContain('1日：曝光 321');
    expect(response.text).not.toContain('最新日期 Pocket3');
  });

  it('returns dated missing-context text instead of silently using latest context', async () => {
    const outputDir = await writeDatedContexts();
    await expect(handleBotIntent({ type: 'latest_summary', date: '2026-06-09' }, outputDir)).resolves.toEqual({
      text: '没有找到 2026-06-09 的公域日报上下文。',
    });
  });

  it('answers numeric product query with only the exact product id', async () => {
    const outputDir = await writeContext();
    const response = await handleBotIntent({ type: 'query_product', keyword: '733' }, outputDir);
    expect(response.text).toContain('端内ID 733 大疆DJI Pocket3云台相机128G');
    expect(response.text).not.toContain('端内ID 649');
    expect(response.text).not.toContain('端内ID 841');
  });

  it('answers comma separated product id queries from report context', async () => {
    const outputDir = await writeContext();
    const response = await handleBotIntent({ type: 'query_product', keyword: '565, 701, 733' }, outputDir);
    expect(response.text).toContain('端内ID 565 iPhone 15');
    expect(response.text).toContain('端内ID 701 大疆 Pocket 3');
    expect(response.text).toContain('端内ID 733 大疆DJI Pocket3云台相机128G');
    expect(response.text).not.toContain('没有找到匹配商品');
  });

  it('falls back to link registry for comma separated product ids missing from report rows', async () => {
    const outputDir = await writeContext();
    const registryRoot = await mkdtemp(join(tmpdir(), 'mt-agent-bot-registry-query-'));
    const registryPaths = await writeLinkRegistryOverviewFixtures(registryRoot);

    const response = await handleBotIntent(
      { type: 'query_product', keyword: '560, 561;' },
      outputDir,
      { closedOrderRegistryPaths: registryPaths },
    );

    expect(response.text).toContain('端内ID 560 DJI Pocket 3 全能套装');
    expect(response.text).toContain('平台商品ID platform-560');
    expect(response.text).toContain('端内ID 561 DJI Pocket 3 标准版');
    expect(response.text).toContain('平台商品ID platform-561');
    expect(response.text).not.toContain('没有找到匹配商品');
  });

  it('returns an operations learning question card', async () => {
    const outputDir = await writeContext();
    const response = await handleBotIntent({ type: 'operations_learning_quiz' }, outputDir);
    expect(response.text).toContain('运营学习 loop 测验');
    expect(response.card).toBeDefined();
    expect(response.card?.header).toMatchObject({ title: { content: expect.stringContaining('运营学习 loop 测验') } });
    expect(JSON.stringify(response.card)).toContain('suggested_action');
    await expect(readFile(join(outputDir, '2026-06-11', 'operations-learning-session.json'), 'utf8')).resolves.toContain('565');
  });

  it('returns an operations learning feedback summary', async () => {
    const outputDir = await writeContext();
    await handleBotIntent({ type: 'operations_learning_quiz' }, outputDir);
    const response = await handleBotIntent({ type: 'operations_learning_summary' }, outputDir);

    expect(response.text).toContain('运营学习反馈汇总 2026-06-11');
    expect(response.text).toContain('已答 0/2');
  });

  it('returns operations learning history stats', async () => {
    const outputDir = await writeContext();
    await handleBotIntent({ type: 'operations_learning_quiz' }, outputDir);

    const response = await handleBotIntent({ type: 'operations_learning_history' }, outputDir);

    expect(response.text).toContain('运营学习历史汇总');
    expect(response.text).toContain('会话 1');
    expect(response.text).toContain('已答 0/2');
  });

  it('returns missing context text for operations learning quiz', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-bot-tools-empty-'));
    await expect(handleBotIntent({ type: 'operations_learning_quiz' }, outputDir)).resolves.toEqual({ text: '还没有找到公域日报上下文。' });
  });

  it('answers task pool questions through agent data understanding', async () => {
    const outputDir = await writeContext();
    const response = await handleBotIntent({ type: 'unknown', text: '今天要处理哪些' }, outputDir);
    expect(response.text).toContain('端内ID 566');
    expect(response.text).toContain('继续放量');
    expect(response.text).toContain('701');
  });

  it('answers weak conversion questions through agent data understanding', async () => {
    const outputDir = await writeContext();
    const response = await handleBotIntent({ type: 'unknown', text: '转化差的有哪些' }, outputDir);
    expect(response.text).toContain('端内ID 565');
    expect(response.text).toContain('提转化');
    expect(response.text).toContain('访问多成交少');
  });

  it('answers all registry-backed read-only agent data questions', async () => {
    const outputDir = await writeContext();
    await expect(handleBotIntent({ type: 'unknown', text: '今天怎么样' }, outputDir)).resolves.toMatchObject({ text: expect.stringContaining('公域日报 2026-06-11') });
    await expect(handleBotIntent({ type: 'unknown', text: '查701' }, outputDir)).resolves.toMatchObject({ text: expect.stringContaining('端内ID 701') });
    await expect(handleBotIntent({ type: 'unknown', text: '新品池有哪些' }, outputDir)).resolves.toMatchObject({ text: expect.stringContaining('大疆 Pocket 3') });
    await expect(handleBotIntent({ type: 'unknown', text: '整理一下失活链接的id集合' }, outputDir)).resolves.toMatchObject({ text: expect.stringContaining('失活候选链接ID集合：706') });
    await expect(handleBotIntent({ type: 'unknown', text: '订单情况' }, outputDir)).resolves.toMatchObject({ text: expect.stringContaining('发货订单：12') });
  });

  it('splits latest overview into exposure-page and order-analysis sources', async () => {
    const outputDir = await writeContext();
    const response = await handleBotIntent({ type: 'unknown', text: '今日概况' }, outputDir);

    expect(response.text).toContain('公域日报 2026-06-11');
    expect(response.text).toContain('公域曝光页：');
    expect(response.text).toContain('曝光 1000，访问 50，金额 ¥88.00，转化率 5.00%');
    expect(response.text).toContain('订单情况：');
    expect(response.text).toContain('发货订单 12');
    expect(response.text).toContain('数据源：曝光页已抓取；访问页已抓取；订单情况已抓取');
    expect(response.text).not.toContain('发货 1');
  });

  it('does not misroute new-link write intents to the read-only new product pool when LLM is unavailable', async () => {
    const outputDir = await writeContext();

    const response = await handleBotIntent({ type: 'unknown', text: '帮我铺十条 pocket3 的新链' }, outputDir);

    expect(response.text).toContain('LLM Agent planner');
    expect(response.text).toContain('不会执行');
    expect(response.text).toContain('不会把它当作新链接池查询');
    expect(response.text).not.toContain('大疆 Pocket 3');
    expect(response.card).toBeUndefined();
  });

  it('answers removed-link questions through agent data understanding', async () => {
    const outputDir = await writeContext();
    const response = await handleBotIntent({ type: 'unknown', text: '下架链接有哪些' }, outputDir);
    expect(response.text).toContain('701');
    expect(response.text).toContain('商品总表缺失');
    expect(response.text).toContain('2026-06-12');
  });

  it('returns read-only guidance for unsupported unknown questions', async () => {
    const outputDir = await writeContext();
    await expect(handleBotIntent({ type: 'unknown', text: '随便聊聊' }, outputDir)).resolves.toEqual({
      text: '我现在可以查：今日概况、商品、新链接池、待处理任务、转化差、曝光低、高潜力、失活链接、下架链接、订单情况。你可以问“新链接池怎么样”或“查一下721”。',
    });
  });

  it('uses an injected LLM selector as the read-only agent fallback for unsupported unknown questions', async () => {
    const outputDir = await writeContext();
    const selector: LlmToolSelectionProvider = {
      async selectTool(request) {
        expect(request.message).toBe('帮我看看苹果手机');
        expect(request.tools.map((tool) => tool.name)).toContain('query_product_performance');
        return '{"intent":"product_lookup","tool":"query_product_performance","arguments":{"keyword":"iPhone"},"confidence":0.92,"reason":"product name lookup"}';
      },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '帮我看看苹果手机' }, outputDir, { llmToolSelector: selector });

    expect(response.text).toContain('端内ID 565 iPhone 15');
  });

  it('uses the LLM read-only ranking tool with link registry context for unsupported natural phrasing', async () => {
    const outputDir = await writeContext();
    const registryRoot = await mkdtemp(join(tmpdir(), 'mt-agent-ranking-registry-'));
    const registryPaths = await writeRankingRegistryFixtures(registryRoot, outputDir);
    let selectorCalled = false;
    const selector: LlmToolSelectionProvider = {
      async selectTool(request) {
        selectorCalled = true;
        expect(request.message).toBe('帮我找 pocket3 里最能打的链接');
        expect(request.tools.map((tool) => tool.name)).toContain('rank_best_same_sku_product');
        return '{"intent":"rank_best","tool":"rank_best_same_sku_product","arguments":{"query":"pocket3"},"confidence":0.92,"reason":"用户要查询同款组中数据最好的端内ID"}';
      },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '帮我找 pocket3 里最能打的链接' }, outputDir, {
      llmToolSelector: selector,
      closedOrderRegistryPaths: registryPaths,
    });

    expect(selectorCalled).toBe(true);
    expect(response.text).toContain('端内ID 702');
    expect(response.text).toContain('数据日期：2026-06-11');
    expect(response.text).toContain('7日：发货 4');
  });

  it('uses the LLM read-only ranking selector instead of legacy product lookup for best-id questions', async () => {
    const outputDir = await writeX200RankingContext();
    const registryRoot = await mkdtemp(join(tmpdir(), 'mt-agent-x200-ranking-registry-'));
    const registryPaths = await writeX200RankingRegistryFixtures(registryRoot, outputDir);
    let selectorCalled = false;
    const selector: LlmToolSelectionProvider = {
      async selectTool(request) {
        selectorCalled = true;
        expect(request.message).toBe('数据最好的X200Ultra是哪个id?');
        expect(request.tools.map((tool) => tool.name)).toContain('rank_best_same_sku_product');
        return '{"intent":"rank_best","tool":"rank_best_same_sku_product","arguments":{"query":"X200Ultra"},"confidence":0.93,"reason":"用户要找同款组中表现最好的端内ID"}';
      },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '数据最好的X200Ultra是哪个id?' }, outputDir, {
      llmToolSelector: selector,
      closedOrderRegistryPaths: registryPaths,
    });

    expect(selectorCalled).toBe(true);
    expect(response.text).toContain('端内ID 362');
    expect(response.text).toContain('同款组 vivo-x200-ultra');
    expect(response.text).not.toContain('端内ID 372');
  });

  it('routes the corpus S23U best-link phrase through Agent ranking instead of old product lookup ordering', async () => {
    const outputDir = await writeX200RankingContext();
    const registryRoot = await mkdtemp(join(tmpdir(), 'mt-agent-s23-ranking-registry-'));
    const registryPaths = await writeX200RankingRegistryFixtures(registryRoot, outputDir);
    const planner: AgentPlannerProvider = {
      async proposePlan(request) {
        expect(request.message).toBe('s23u最好的链接是哪条?');
        expect(request.tools.map((tool) => tool.name)).toContain('product.rankBestSameSku');
        expect(request.tools.map((tool) => tool.name)).toContain('product.query');
        return JSON.stringify({
          goal: '查询 S23U 同款组数据最好的链接',
          selectedTool: 'product.rankBestSameSku',
          arguments: { query: 's23u' },
          confidence: 0.94,
          reason: '用户问最好的链接，应按链接档案同款组排序，而不是普通商品查询',
        });
      },
    };

    const response = await handleBotIntent({ type: 'unknown', text: 's23u最好的链接是哪条?' }, outputDir, {
      agentPlannerProvider: planner,
      closedOrderRegistryPaths: registryPaths,
    });

    expect(response.text).toContain('端内ID 500');
    expect(response.text).toContain('同款组 samsung-galaxy-s23-ultra');
    expect(response.text).not.toContain('端内ID 786\n1日');
    expect(response.card).toBeUndefined();
  });

  it('lets the Agent planner choose the best same-sku ranking tool', async () => {
    const outputDir = await writeContext();
    const registryRoot = await mkdtemp(join(tmpdir(), 'mt-agent-ranking-registry-'));
    const registryPaths = await writeRankingRegistryFixtures(registryRoot, outputDir);
    let plannerCalled = false;
    const planner: AgentPlannerProvider = {
      async proposePlan(request) {
        plannerCalled = true;
        expect(request.message).toBe('数据最好的 pocket3 的端内id是多少');
        expect(request.tools.map((tool) => tool.name)).toContain('product.rankBestSameSku');
        expect(request.tools.map((tool) => tool.name)).toContain('product.query');
        return JSON.stringify({
          goal: '查询 pocket3 同款组数据最好的端内ID',
          selectedTool: 'product.rankBestSameSku',
          arguments: { query: 'pocket3' },
          confidence: 0.94,
          reason: '用户明确要找同款组里表现最好的端内ID',
        });
      },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '数据最好的 pocket3 的端内id是多少' }, outputDir, {
      agentPlannerProvider: planner,
      closedOrderRegistryPaths: registryPaths,
    });

    expect(plannerCalled).toBe(true);
    expect(response.text).toContain('端内ID 702');
    expect(response.text).toContain('同款组 dji-pocket-3');
    expect(response.text).not.toContain('端内ID 701\n1日');
  });

  it('uses the generic agent planner to run safe registered tools', async () => {
    const outputDir = await writeContext();
    const planner: AgentPlannerProvider = {
      async proposePlan(request) {
        expect(request.message).toBe('帮我看看苹果手机');
        expect(request.tools.map((tool) => tool.name)).toContain('product.query');
        expect(request.workflows).toEqual([]);
        return JSON.stringify({
          goal: '查询商品表现',
          selectedTool: 'product.query',
          arguments: { keyword: 'iPhone' },
          confidence: 0.92,
          reason: '用户要查看苹果手机表现',
        });
      },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '帮我看看苹果手机' }, outputDir, { agentPlannerProvider: planner });

    expect(response.text).toContain('端内ID 565 iPhone 15');
  });

  it('lets the Agent planner answer natural report data questions through publicTraffic.reportQuery', async () => {
    const outputDir = await writeContext();
    let plannerCalled = false;
    const planner: AgentPlannerProvider = {
      async proposePlan(request) {
        plannerCalled = true;
        expect(request.message).toBe('2026-06-11 7日访问最高的1个商品是谁');
        expect(request.tools.map((tool) => tool.name)).toContain('publicTraffic.reportQuery');
        return JSON.stringify({
          goal: '查询指定日期7日访问最高商品',
          selectedTool: 'publicTraffic.reportQuery',
          arguments: {
            target: 'products',
            date: '2026-06-11',
            period: '7d',
            sortBy: 'publicVisits',
            metrics: ['publicVisits', 'amount', 'shippedOrders'],
            limit: 1,
          },
          confidence: 0.94,
          reason: '用户询问日报商品排行，属于只读报表查询',
        });
      },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '2026-06-11 7日访问最高的1个商品是谁' }, outputDir, { agentPlannerProvider: planner });

    expect(plannerCalled).toBe(true);
    expect(response.text).toContain('公域日报商品查询 2026-06-11');
    expect(response.text).toContain('端内ID 702');
    expect(response.text).toContain('7d 公域访问 80');
    expect(response.card).toBeUndefined();
  });

  it('lets the Agent planner answer aggregate report row questions through publicTraffic.reportQuery', async () => {
    const outputDir = await writeContext();
    let plannerCalled = false;
    const planner: AgentPlannerProvider = {
      async proposePlan(request) {
        plannerCalled = true;
        expect(request.message).toBe('Pocket 3 的7日访问总和是多少');
        expect(request.tools.map((tool) => tool.name)).toContain('publicTraffic.reportQuery');
        return JSON.stringify({
          goal: '统计Pocket 3商品7日访问总和',
          selectedTool: 'publicTraffic.reportQuery',
          arguments: {
            target: 'productAggregation',
            date: '2026-06-11',
            productQuery: 'Pocket 3',
            period: '7d',
            metrics: ['publicVisits'],
            aggregation: 'sum',
          },
          confidence: 0.94,
          reason: '用户要对已保存日报商品行做聚合统计',
        });
      },
    };

    const response = await handleBotIntent({ type: 'unknown', text: 'Pocket 3 的7日访问总和是多少' }, outputDir, { agentPlannerProvider: planner });

    expect(plannerCalled).toBe(true);
    expect(response.text).toContain('公域日报商品聚合统计 2026-06-11');
    expect(response.text).toContain('匹配 2 条商品');
    expect(response.text).toContain('访问总和 = 82');
    expect(response.card).toBeUndefined();
  });

  it('lets the Agent planner answer link count questions through link registry instead of report aggregation', async () => {
    const outputDir = await writeContext();
    const registryRoot = await mkdtemp(join(tmpdir(), 'mt-agent-link-count-registry-'));
    const registryPaths = await writeAceProPriceRegistryFixtures(registryRoot);
    const planner: AgentPlannerProvider = {
      async proposePlan(request) {
        expect(request.message).toBe('acepro2有多少条链接');
        expect(request.tools.map((tool) => tool.name)).toContain('linkRegistry.resolveProducts');
        expect(request.tools.map((tool) => tool.name)).toContain('publicTraffic.reportQuery');
        return JSON.stringify({
          goal: '统计 acepro2 的链接数量',
          selectedTool: 'linkRegistry.resolveProducts',
          arguments: { query: 'acepro2' },
          confidence: 0.93,
          reason: '用户询问的是链接档案数量，应以链接维护档案为准，而不是日报商品聚合行。',
          requiresConfirmation: false,
        });
      },
    };

    const response = await handleBotIntent({ type: 'unknown', text: 'acepro2有多少条链接' }, outputDir, {
      agentPlannerProvider: planner,
      closedOrderRegistryPaths: registryPaths,
    });

    expect(response.text).toContain('商品集合解析：acepro2');
    expect(response.text).toContain('同款组：insta360-ace-pro-2');
    expect(response.text).toContain('链接数量：2 条');
    expect(response.text).toContain('可用端内ID：841、842');
    expect(response.card).toBeUndefined();
  });

  it('keeps explicit product identifiers separate from same-sku group expansion', async () => {
    const registryRoot = await mkdtemp(join(tmpdir(), 'mt-agent-identifier-boundary-registry-'));
    const registryPaths = await writePocket4PriceRegistryFixtures(registryRoot);

    const internalId = await executeAgentToolRequest(
      { toolName: 'linkRegistry.resolveProducts', arguments: { query: '914' }, reason: 'short numeric ids default to one internal product' },
      'output',
      { closedOrderRegistryPaths: registryPaths },
    );
    expect(internalId.metadata).toMatchObject({ productIds: ['914'], count: 1, resolutionMode: 'single' });
    expect(internalId.text).not.toContain('915');
    expect(internalId.text).not.toContain('916');

    const labelledInternalId = await executeAgentToolRequest(
      { toolName: 'linkRegistry.resolveProducts', arguments: { query: '端内ID 914' }, reason: 'labelled internal ids also mean one product' },
      'output',
      { closedOrderRegistryPaths: registryPaths },
    );
    expect(labelledInternalId.metadata).toMatchObject({ productIds: ['914'], count: 1, resolutionMode: 'single' });
    expect(labelledInternalId.text).not.toContain('915');

    const labelledInternalIdSentence = await executeAgentToolRequest(
      { toolName: 'linkRegistry.resolveProducts', arguments: { query: '\u7aef\u5185ID 914 \u6574\u4f53\u6539\u4ef7 0.99' }, reason: 'planner may pass the whole sentence as query' },
      'output',
      { closedOrderRegistryPaths: registryPaths },
    );
    expect(labelledInternalIdSentence.metadata).toMatchObject({ productIds: ['914'], count: 1, resolutionMode: 'single' });
    expect(labelledInternalIdSentence.text).not.toContain('915');

    const leadingInternalIdSentence = await executeAgentToolRequest(
      { toolName: 'linkRegistry.resolveProducts', arguments: { query: '914\u6574\u4f53\u6539\u4ef7 0.99' }, reason: 'a leading short id in an action sentence is one internal product' },
      'output',
      { closedOrderRegistryPaths: registryPaths },
    );
    expect(leadingInternalIdSentence.metadata).toMatchObject({ productIds: ['914'], count: 1, resolutionMode: 'single' });
    expect(leadingInternalIdSentence.text).not.toContain('915');

    const platformId = await executeAgentToolRequest(
      { toolName: 'linkRegistry.resolveProducts', arguments: { query: '商品ID 2026062922000000000914' }, reason: 'platform product ids must match exactly' },
      'output',
      { closedOrderRegistryPaths: registryPaths },
    );
    expect(platformId.metadata).toMatchObject({ productIds: ['914'], count: 1, resolutionMode: 'single' });
    expect(platformId.text).not.toContain('915');

    const platformIdSentence = await executeAgentToolRequest(
      { toolName: 'linkRegistry.resolveProducts', arguments: { query: '\u5546\u54c1ID 2026062922000000000914 \u6574\u4f53\u6539\u4ef7' }, reason: 'platform ids embedded in action sentences must be exact matches' },
      'output',
      { closedOrderRegistryPaths: registryPaths },
    );
    expect(platformIdSentence.metadata).toMatchObject({ productIds: ['914'], count: 1, resolutionMode: 'single' });
    expect(platformIdSentence.text).not.toContain('915');

    const sameSkuGroup = await executeAgentToolRequest(
      { toolName: 'linkRegistry.resolveProducts', arguments: { query: '914', resolutionMode: 'sameSkuGroup' }, reason: 'user explicitly asks for the same-sku group' },
      'output',
      { closedOrderRegistryPaths: registryPaths },
    );
    expect(sameSkuGroup.metadata).toMatchObject({ productIds: ['914', '915', '916'], count: 3, resolutionMode: 'sameSkuGroup' });
  });

  it('lets the Agent planner answer report source coverage questions through publicTraffic.reportQuery', async () => {
    const outputDir = await writeContext();
    let plannerCalled = false;
    const planner: AgentPlannerProvider = {
      async proposePlan(request) {
        plannerCalled = true;
        expect(request.message).toBe('7日访问页覆盖情况怎么样');
        expect(request.tools.map((tool) => tool.name)).toContain('publicTraffic.reportQuery');
        return JSON.stringify({
          goal: '查询7日访问页覆盖情况',
          selectedTool: 'publicTraffic.reportQuery',
          arguments: {
            target: 'sourceCoverage',
            date: '2026-06-11',
            period: '7d',
            source: 'dashboard',
            coverageStatus: 'all',
          },
          confidence: 0.94,
          reason: '用户要查看已保存日报商品行的访问页抓取覆盖情况',
        });
      },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '7日访问页覆盖情况怎么样' }, outputDir, { agentPlannerProvider: planner });

    expect(plannerCalled).toBe(true);
    expect(response.text).toContain('日报数据源覆盖 2026-06-11');
    expect(response.text).toContain('数据源：访问页，状态：全部');
    expect(response.text).toContain('7d：商品 6 条');
    expect(response.text).toContain('访问页已抓取 6 条/未更新 0 条');
    expect(response.card).toBeUndefined();
  });

  it('lets the Agent planner answer derived order metric questions through publicTraffic.reportQuery', async () => {
    const outputDir = await writeContext();
    let plannerCalled = false;
    const planner: AgentPlannerProvider = {
      async proposePlan(request) {
        plannerCalled = true;
        expect(request.message).toBe('关单率是否达标');
        expect(request.tools.map((tool) => tool.name)).toContain('publicTraffic.reportQuery');
        return JSON.stringify({
          goal: '查询关单率是否达标',
          selectedTool: 'publicTraffic.reportQuery',
          arguments: {
            target: 'orderDerived',
            date: '2026-06-11',
            orderDerivedMetric: 'closeRateStatus',
          },
          confidence: 0.94,
          reason: '用户要查看订单分析衍生经营指标',
        });
      },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '关单率是否达标' }, outputDir, { agentPlannerProvider: planner });

    expect(plannerCalled).toBe(true);
    expect(response.text).toContain('订单经营指标 2026-06-11');
    expect(response.text).toContain('关单率状态：达标（目标<=35%）');
    expect(response.text).not.toContain('客单价');
    expect(response.card).toBeUndefined();
  });

  it('does not fall back to deterministic exact routing when the Agent planner is configured but invalid', async () => {
    const outputDir = await writeContext();
    const planner: AgentPlannerProvider = {
      async proposePlan() {
        return '{}';
      },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '查 565' }, outputDir, { agentPlannerProvider: planner });

    expect(response.text).toContain('No legacy deterministic route');
    expect(response.text).not.toContain('iPhone 15');
    expect(response.card).toBeUndefined();
  });

  it('does not use rollback shortcut routing when the Agent planner is configured but invalid', async () => {
    const planner: AgentPlannerProvider = {
      async proposePlan() {
        return '{}';
      },
    };

    const response = await handleBotIntent({ type: 'unknown', text: 'rollback task_1782451929574_977a5f62' }, 'output', { agentPlannerProvider: planner });

    expect(response.text).toContain('No legacy deterministic route');
    expect(response.card).toBeUndefined();
  });

  it('keeps pre-parsed exact intents local when a planner is configured', async () => {
    let plannerCalled = false;
    const planner: AgentPlannerProvider = {
      async proposePlan() {
        plannerCalled = true;
        return JSON.stringify({
          goal: 'should not be used without raw text',
          selectedTool: 'publicTraffic.runReport',
          arguments: {},
          confidence: 1,
          reason: 'test',
        });
      },
    };

    const reportResponse = await handleBotIntent({ type: 'run_public_traffic_report' }, 'output', { agentPlannerProvider: planner });
    const copyResponse = await handleBotIntent({ type: 'rental_copy', productId: '761' }, 'output', { agentPlannerProvider: planner });

    expect(plannerCalled).toBe(false);
    expect(reportResponse.text).toContain('publicTraffic.runReport');
    expect(JSON.stringify(reportResponse.card)).toContain('agent_tool_confirm');
    expect(mocks.runPublicTrafficReportCli).not.toHaveBeenCalled();
    expect(copyResponse.text).toContain('请确认租赁商品操作：761');
    expect(JSON.stringify(copyResponse.card)).toContain('copy');
  });

  it('allows exact operations learning quiz to open locally in planner-first mode', async () => {
    const outputDir = await writeContext();
    let plannerCalled = false;
    const planner: AgentPlannerProvider = {
      async proposePlan() {
        plannerCalled = true;
        return '{}';
      },
    };

    const response = await handleBotIntent({ type: 'operations_learning_quiz' }, outputDir, { agentPlannerProvider: planner });

    expect(plannerCalled).toBe(false);
    expect(response.text).toContain('运营学习 loop 测验');
    expect(JSON.stringify(response.card)).toContain('运营学习 loop 测验');
  });

  it('lets the Agent planner handle help as a registered tool', async () => {
    const planner: AgentPlannerProvider = {
      async proposePlan(request) {
        expect(request.message).toBe('帮助');
        expect(request.tools.map((tool) => tool.name)).toContain('system.help');
        return JSON.stringify({
          goal: '显示帮助',
          selectedTool: 'system.help',
          arguments: {},
          confidence: 0.99,
          reason: '用户要求查看帮助',
        });
      },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '帮助' }, 'output', { agentPlannerProvider: planner });

    expect(response.text).toContain('可用能力概览');
    expect(response.text).toContain('涉及商品修改的动作会先弹确认卡');
    expect(response.text).toContain('非商品修改动作会直接执行');
  });

  it('executes safe multi-step planner plans in sequence', async () => {
    const outputDir = await writeContext();
    const planner: AgentPlannerProvider = {
      async proposePlan(request) {
        expect(request.message).toBe('先看今天概况，再查 565');
        return JSON.stringify({
          goal: '先看概况再查商品',
          steps: [
            { toolName: 'publicTraffic.latestSummary', arguments: {}, reason: '先读取最新日报概况' },
            { toolName: 'product.query', arguments: { keyword: '565' }, reason: '再查询端内ID 565 的表现' },
          ],
          confidence: 0.91,
          reason: '用户明确要求按顺序完成两个只读查询',
        });
      },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '先看今天概况，再查 565' }, outputDir, { agentPlannerProvider: planner });

    expect(response.text).toContain('Agent 多步骤计划：先看概况再查商品');
    expect(response.text).toContain('步骤 1/2：publicTraffic.latestSummary');
    expect(response.text).toContain('步骤 2/2：product.query');
    expect(response.text).toContain('565');
    expect(response.card).toBeUndefined();
  });

  it('pauses remaining multi-step planner steps when a read tool returns an interactive card', async () => {
    const outputDir = await writeContext();
    const planner: AgentPlannerProvider = {
      async proposePlan(request) {
        expect(request.message).toBe('打开商品ID互查卡，然后查 565');
        return JSON.stringify({
          goal: '先打开互查卡再查询商品',
          steps: [
            { toolName: 'productId.lookupCard', arguments: {}, reason: '先打开常驻商品 ID 互查卡' },
            { toolName: 'product.query', arguments: { keyword: '565' }, reason: '再查询 565 表现' },
          ],
          confidence: 0.86,
          reason: '第一步返回交互卡片，后续步骤必须暂停避免覆盖卡片',
        });
      },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '打开商品ID互查卡，然后查 565' }, outputDir, { agentPlannerProvider: planner });

    expect(response.text).toContain('步骤 1/2：productId.lookupCard');
    expect(response.text).toContain('已打开常驻商品ID互查卡');
    expect(response.text).toContain('后续步骤已暂停，避免覆盖卡片结果');
    expect(response.text).not.toContain('步骤 2/2：product.query');
    expect(response.text).not.toContain('端内ID 565 iPhone 15');
    expect(response.card).toBeDefined();
    expect(JSON.stringify(response.card)).toContain('id_lookup_form');
  });

  it('continues multi-step planner plans through non-product write steps', async () => {
    const outputDir = await writeContext();
    const planner: AgentPlannerProvider = {
      async proposePlan() {
        return JSON.stringify({
          goal: '先看概况再推送日报',
          steps: [
            { toolName: 'publicTraffic.latestSummary', arguments: {}, reason: '先确认最新日报内容' },
            { toolName: 'publicTraffic.pushLatestReportToGroup', arguments: {}, reason: '再把最新日报推送到群' },
          ],
          confidence: 0.9,
          reason: '用户要求先读日报再推群，推群不修改商品',
        });
      },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '先看今天概况，再推送日报到群' }, outputDir, { agentPlannerProvider: planner });

    expect(response.text).toContain('步骤 1/2：publicTraffic.latestSummary');
    expect(response.text).toContain('步骤 2/2：publicTraffic.pushLatestReportToGroup');
    expect(response.text).toContain('最新公域日报已推送到群');
    expect(response.card).toBeUndefined();
    expect(mocks.sendFeishuCard).toHaveBeenCalledOnce();
  });

  it('continues a multi-step planner plan after a confirmed product step', async () => {
    const outputDir = await writeContext();
    const planner: AgentPlannerProvider = {
      async proposePlan() {
        return JSON.stringify({
          goal: '先读概况再复制商品最后查询',
          steps: [
            { toolName: 'publicTraffic.latestSummary', arguments: {}, reason: '先读取最新日报概况' },
            { toolName: 'rental.copy', arguments: { productId: '761' }, reason: '复制商品 761，必须确认' },
            { toolName: 'product.query', arguments: { keyword: '565' }, reason: '复制后查询 565 的表现' },
          ],
          confidence: 0.91,
          reason: '用户要求先读再复制商品后查询，商品修改必须确认后才能继续',
        });
      },
    };
    const copyCalls: string[] = [];
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run'); },
      async execute() { throw new Error('execute should not run'); },
      async copy(productId) {
        copyCalls.push(productId);
        return { productId, ok: true, newProductId: '901', lines: ['copy: ok'] };
      },
      async delist() { throw new Error('delist should not run'); },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '先看概况，再复制 761，最后查 565' }, outputDir, {
      agentPlannerProvider: planner,
      rentalPriceClient,
    });
    const request = readAgentToolConfirmRequestFromCard(response.card);

    expect(copyCalls).toEqual([]);
    expect(request.toolName).toBe('rental.copy');
    expect(request.continuation?.steps).toHaveLength(1);

    const executed = await executeAgentToolRequestWithContinuation(request, outputDir, { rentalPriceClient });

    expect(copyCalls).toEqual(['761']);
    expect(executed.text).toContain('Agent 多步骤计划继续执行：先读概况再复制商品最后查询');
    expect(executed.text).toContain('步骤 2/3：rental.copy');
    expect(executed.text).toContain('复制成功：商品 761 → 新商品 901');
    expect(executed.text).toContain('步骤 3/3：product.query');
    expect(executed.text).toContain('端内ID 565');
    expect(executed.card).toBeUndefined();
  });

  it('asks for a second confirmation when a confirmed product step is followed by another product step', async () => {
    const outputDir = await writeContext();
    const planner: AgentPlannerProvider = {
      async proposePlan() {
        return JSON.stringify({
          goal: '连续两个高风险商品动作',
          steps: [
            { toolName: 'publicTraffic.latestSummary', arguments: {}, reason: '先确认上下文' },
            { toolName: 'rental.copy', arguments: { productId: '761' }, reason: '先复制 761' },
            { toolName: 'rental.delist', arguments: { productId: '762' }, reason: '再下架 762，仍然必须确认' },
          ],
          confidence: 0.88,
          reason: '连续写操作不能一次确认全部执行',
        });
      },
    };
    const calls: string[] = [];
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run'); },
      async execute() { throw new Error('execute should not run'); },
      async copy(productId) {
        calls.push(`copy:${productId}`);
        return { productId, ok: true, newProductId: '902', lines: ['copy: ok'] };
      },
      async delist(productId) {
        calls.push(`delist:${productId}`);
        return { productId, ok: true, lines: ['delist: ok'] };
      },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '先复制 761，再下架 762' }, outputDir, {
      agentPlannerProvider: planner,
      rentalPriceClient,
    });
    const firstRequest = readAgentToolConfirmRequestFromCard(response.card);
    const continued = await executeAgentToolRequestWithContinuation(firstRequest, outputDir, { rentalPriceClient });
    const secondRequest = readAgentToolConfirmRequestFromCard(continued.card);

    expect(calls).toEqual(['copy:761']);
    expect(continued.text).toContain('步骤 3/3 需要确认：rental.delist');
    expect(JSON.stringify(continued.card)).toContain('agent_tool_confirm');
    expect(secondRequest.toolName).toBe('rental.delist');
    expect(secondRequest.arguments).toEqual({ productId: '762' });
  });

  it('continues after confirmed copy with the returned new product id metadata', async () => {
    const outputDir = await writeContext();
    const planner: AgentPlannerProvider = {
      async proposePlan() {
        return JSON.stringify({
          goal: '复制商品后查询新商品',
          steps: [
            { id: 'copy', toolName: 'rental.copy', arguments: { productId: '761' }, reason: '先复制商品 761' },
            { toolName: 'product.query', arguments: { keyword: '${copy.newProductId}' }, reason: '按复制返回的新商品 ID 查询' },
          ],
          confidence: 0.9,
          reason: '后续查询依赖 rental.copy 的 resultMetadataSchema.newProductId',
        });
      },
    };
    const copyCalls: string[] = [];
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run'); },
      async execute() { throw new Error('execute should not run'); },
      async copy(productId) {
        copyCalls.push(productId);
        return { productId, ok: true, newProductId: '565', lines: ['copy: ok'] };
      },
      async delist() { throw new Error('delist should not run'); },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '复制 761 后查新商品' }, outputDir, {
      agentPlannerProvider: planner,
      rentalPriceClient,
    });
    const request = readAgentToolConfirmRequestFromCard(response.card);
    const executed = await executeAgentToolRequestWithContinuation(request, outputDir, { rentalPriceClient });

    expect(copyCalls).toEqual(['761']);
    expect(executed.text).toContain('复制成功：商品 761 → 新商品 565');
    expect(executed.text).toContain('步骤 2/2：product.query');
    expect(executed.text).toContain('端内ID 565');
    expect(executed.card).toBeUndefined();
  });

  it('continues into a dedicated new-link planning card without copying new links before its own confirmation', async () => {
    const { outputDir, registryPaths } = await writeNewLinkWorkflowContext();
    const planner: AgentPlannerProvider = {
      async proposePlan() {
        return JSON.stringify({
          goal: '先复制一个商品再给 SQ1 铺新链',
          steps: [
            { toolName: 'rental.copy', arguments: { productId: '761' }, reason: '先复制商品 761' },
            { toolName: 'rental.newLinkBatchPlan', arguments: { keyword: 'SQ1', count: 5, sourceProductId: '388' }, reason: '再生成 SQ1 新链确认卡' },
          ],
          confidence: 0.9,
          reason: '第二步是新链计划工具，只能生成专用确认卡',
        });
      },
    };
    const copyCalls: string[] = [];
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run'); },
      async execute() { throw new Error('execute should not run'); },
      async copy(productId) {
        copyCalls.push(productId);
        return { productId, ok: true, newProductId: '903', lines: ['copy: ok'] };
      },
      async delist() { throw new Error('delist should not run'); },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '先复制 761，再按 SQ1 铺 5 条新链' }, outputDir, {
      agentPlannerProvider: planner,
      rentalPriceClient,
      closedOrderRegistryPaths: registryPaths,
    });
    const request = readAgentToolConfirmRequestFromCard(response.card);
    const continued = await executeAgentToolRequestWithContinuation(request, outputDir, {
      rentalPriceClient,
      closedOrderRegistryPaths: registryPaths,
    });

    expect(copyCalls).toEqual(['761']);
    expect(continued.text).toContain('步骤 2/2：rental.newLinkBatchPlan');
    expect(JSON.stringify(continued.card)).toContain('new_link_batch_confirm');
    expect(JSON.stringify(continued.card)).toContain('"sourceProductId":"388"');
  });

  it('passes best-link metadata into a later new-link planning step', async () => {
    const { outputDir, registryPaths } = await writeNewLinkWorkflowContext();
    const planner: AgentPlannerProvider = {
      async proposePlan(request) {
        expect(request.tools.map((tool) => tool.name)).toContain('product.rankBestSameSku');
        expect(request.tools.map((tool) => tool.name)).toContain('rental.newLinkBatchPlan');
        return JSON.stringify({
          goal: 'rank SQ1 then copy five new links',
          steps: [
            { id: 'rank', toolName: 'product.rankBestSameSku', arguments: { query: 'SQ1' }, reason: 'find the best SQ1 source' },
            { toolName: 'rental.newLinkBatchPlan', arguments: { keyword: 'SQ1', count: 5, sourceProductId: '${rank.bestProductId}' }, reason: 'create a confirmation card from the ranked source' },
          ],
          confidence: 0.93,
          reason: 'the user asks for a best-link lookup followed by a high-risk copy plan',
        });
      },
    };
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run'); },
      async execute() { throw new Error('execute should not run'); },
      async copy() { throw new Error('copy should not run before confirmation'); },
      async delist() { throw new Error('delist should not run'); },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };

    const response = await handleBotIntent({ type: 'unknown', text: 'best SQ1 then copy 5 new links' }, outputDir, {
      agentPlannerProvider: planner,
      rentalPriceClient,
      closedOrderRegistryPaths: registryPaths,
    });

    const cardText = JSON.stringify(response.card);
    expect(response.text).toContain('product.rankBestSameSku');
    expect(response.text).toContain('rental.newLinkBatchPlan');
    expect(response.text).toContain('388');
    expect(response.card).toBeDefined();
    expect(cardText).toContain('new_link_batch_confirm');
    expect(cardText).toContain('"keyword":"SQ1"');
    expect(cardText).toContain('"count":5');
    expect(cardText).toContain('"sourceProductId":"388"');
  });

  it('stops a multi-step plan when a metadata placeholder cannot be resolved', async () => {
    const outputDir = await writeContext();
    const planner: AgentPlannerProvider = {
      async proposePlan() {
        return JSON.stringify({
          goal: 'bad unresolved reference',
          steps: [
            { id: 'rank', toolName: 'publicTraffic.latestSummary', arguments: {}, reason: 'read summary without bestProductId metadata' },
            { toolName: 'rental.copy', arguments: { productId: '${rank.bestProductId}' }, reason: 'bad reference should stop' },
          ],
          confidence: 0.8,
          reason: 'test unresolved reference safety',
        });
      },
    };
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run'); },
      async execute() { throw new Error('execute should not run'); },
      async copy() { throw new Error('copy should not run'); },
      async delist() { throw new Error('delist should not run'); },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };

    const response = await handleBotIntent({ type: 'unknown', text: 'bad multi step reference' }, outputDir, {
      agentPlannerProvider: planner,
      rentalPriceClient,
    });

    expect(response.text).toContain('rank.bestProductId');
    expect(response.text).toContain('未触发任何未确认的写操作');
    expect(response.card).toBeUndefined();
  });

  it('lets the Agent planner summarize same-sku rental price snapshots', async () => {
    const outputDir = await writeContext();
    const registryRoot = await mkdtemp(join(tmpdir(), 'mt-agent-x200-price-registry-'));
    const registryPaths = await writeX200PriceSnapshotRegistryFixtures(registryRoot);
    const planner: AgentPlannerProvider = {
      async proposePlan(request) {
        expect(request.message).toBe('x200u的定价情况怎么样');
        expect(request.tools.map((tool) => tool.name)).toContain('rental.priceSnapshot');
        expect(request.tools.map((tool) => tool.name)).toContain('rental.priceChange');
        return JSON.stringify({
          goal: '查询 x200u 同款组 SKU 定价情况',
          selectedTool: 'rental.priceSnapshot',
          arguments: { query: 'x200u' },
          confidence: 0.92,
          reason: '用户询问定价情况，是只读价格快照，不是改价',
        });
      },
    };
    const rentalPriceClient: RentalPriceSkillClient = {
      async read(productId) {
        const valuesByProduct: Record<string, Record<string, Record<string, string>>> = {
          '362': {
            'sku-64': { rent1day: '10', rent7day: '60' },
            'sku-128': { rent1day: '14', rent7day: '88' },
          },
          '363': {
            'sku-64': { rent1day: '12', rent7day: '70' },
            'sku-128': { rent1day: '16', rent7day: '92' },
          },
        };
        return {
          productId,
          ok: true,
          specs: [
            { specId: 'sku-64', title: '黑色 64G' },
            { specId: 'sku-128', title: '黑色 128G' },
          ],
          values: valuesByProduct[productId] ?? {},
          lines: ['read: ok', '2 specs'],
        };
      },
      async preview() { throw new Error('preview should not run for price snapshot'); },
      async execute() { throw new Error('execute should not run for price snapshot'); },
      async copy() { throw new Error('copy should not run for price snapshot'); },
      async delist() { throw new Error('delist should not run for price snapshot'); },
      async tenancySet() { throw new Error('tenancySet should not run for price snapshot'); },
      async specDiscover() { throw new Error('specDiscover should not run for price snapshot'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run for price snapshot'); },
    };

    const response = await handleBotIntent({ type: 'unknown', text: 'x200u的定价情况怎么样' }, outputDir, {
      agentPlannerProvider: planner,
      rentalPriceClient,
      closedOrderRegistryPaths: registryPaths,
    });

    expect(response.text).toContain('定价情况：x200u');
    expect(response.text).toContain('同款组：vivo-x200-ultra');
    expect(response.text).toContain('黑色 64G：1天 ¥11');
    expect(response.text).toContain('7天 ¥65');
    expect(response.text).toContain('黑色 128G：1天 ¥15');
    expect(response.text).toContain('读取商品：成功 2/2');
  });

  it('allows read-only rental price snapshots for same-sku groups above twenty products', async () => {
    const outputDir = await writeContext();
    const registryRoot = await mkdtemp(join(tmpdir(), 'mt-agent-x200-price-large-registry-'));
    const registryPaths = await writeX200PriceSnapshotRegistryFixtures(registryRoot, 23);
    const planner: AgentPlannerProvider = {
      async proposePlan() {
        return JSON.stringify({
          goal: '查询 x200u 大同款组 SKU 定价情况',
          selectedTool: 'rental.priceSnapshot',
          arguments: { query: 'x200u' },
          confidence: 0.92,
          reason: '用户询问定价情况，是只读价格快照，不是改价',
        });
      },
    };
    const readProductIds: string[] = [];
    const rentalPriceClient: RentalPriceSkillClient = {
      async read(productId) {
        readProductIds.push(productId);
        return {
          productId,
          ok: true,
          specs: [{ specId: 'sku-standard', title: '标准版' }],
          values: { 'sku-standard': { rent1day: '10', rent7day: '60' } },
          lines: ['read: ok', '1 spec'],
        };
      },
      async preview() { throw new Error('preview should not run for price snapshot'); },
      async execute() { throw new Error('execute should not run for price snapshot'); },
      async copy() { throw new Error('copy should not run for price snapshot'); },
      async delist() { throw new Error('delist should not run for price snapshot'); },
      async tenancySet() { throw new Error('tenancySet should not run for price snapshot'); },
      async specDiscover() { throw new Error('specDiscover should not run for price snapshot'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run for price snapshot'); },
    };

    const response = await handleBotIntent({ type: 'unknown', text: 'x200u 价格情况' }, outputDir, {
      agentPlannerProvider: planner,
      rentalPriceClient,
      closedOrderRegistryPaths: registryPaths,
    });

    expect(readProductIds).toHaveLength(23);
    expect(response.text).toContain('定价情况：x200u');
    expect(response.text).toContain('读取商品：成功 23/23');
    expect(response.text).toContain('覆盖商品 23 个');
    expect(response.text).not.toContain('超过单次定价快照上限');
  });

  it('turns Agent-planned same-sku spec removal into a dedicated confirmation card', async () => {
    const outputDir = await writeContext();
    const registryRoot = await mkdtemp(join(tmpdir(), 'mt-agent-x300-spec-remove-'));
    const registryPaths = await writeX300SpecRemoveRegistryFixtures(registryRoot);
    const planner: AgentPlannerProvider = {
      async proposePlan(request) {
        expect(request.message).toBe('x300u-spec-test 含手柄的sku 都得下掉');
        expect(request.tools.map((tool) => tool.name)).toContain('rental.specRemovePlan');
        return JSON.stringify({
          goal: '删除 x300u-spec-test 同款组里含手柄的规格项',
          selectedTool: 'rental.specRemovePlan',
          arguments: { query: 'x300u-spec-test', keyword: '手柄' },
          confidence: 0.91,
          reason: '用户要求删除同款组内含手柄的 SKU，属于高风险规格项删除，必须先预览并确认',
        });
      },
    };
    const specDiscoverCalls: string[] = [];
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run for spec removal plan'); },
      async execute() { throw new Error('execute should not run for spec removal plan'); },
      async copy() { throw new Error('copy should not run'); },
      async delist() { throw new Error('delist should not run'); },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover(productId) {
        specDiscoverCalls.push(productId);
        return {
          productId,
          ok: true,
          dimensions: [
            { specId: 'color', title: '颜色', items: [{ id: 'black', title: '黑色' }, { id: 'white', title: '白色' }] },
            { specId: 'kit', title: '套装', items: [{ id: 'standard', title: '标准' }, { id: 'handle', title: '含手柄' }] },
          ],
          lines: ['spec-discover: ok'],
        };
      },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
      async specRemoveItem() { throw new Error('specRemoveItem should not run before confirmation'); },
    };

    const response = await handleBotIntent({ type: 'unknown', text: 'x300u-spec-test 含手柄的sku 都得下掉' }, outputDir, {
      agentPlannerProvider: planner,
      rentalPriceClient,
      closedOrderRegistryPaths: registryPaths,
    });

    const cardText = JSON.stringify(response.card);
    expect(specDiscoverCalls.sort()).toEqual(['501', '502']);
    expect(response.text).toContain('规格项删除计划：x300u-spec-test / 关键词「手柄」');
    expect(response.text).toContain('命中规格项：2 个');
    expect(response.text).toContain('商品 501：套装 / 含手柄');
    expect(response.text).toContain('只删除命中的规格项，不删除规格维度');
    expect(response.card).toBeDefined();
    expect(cardText).toContain('rental_operation_confirm');
    expect(cardText).toContain('spec-remove-items');
    expect(cardText).toContain('"itemTitle":"含手柄"');
    expect(cardText).not.toContain('agent_tool_confirm');
  });

  it('turns Agent-planned per-spec price plan into the apply confirmation card without confirming the plan first', async () => {
    const outputDir = await writeContext();
    const planner: AgentPlannerProvider = {
      async proposePlan(request) {
        expect(request.tools.map((tool) => tool.name)).toContain('rental.perSpecPricePlan');
        return JSON.stringify({
          goal: '给商品 648 的指定规格写绝对租金',
          selectedTool: 'rental.perSpecPricePlan',
          arguments: { productId: '648', specPrices: [{ specId: '3863', fields: { rent1day: '80.00' } }] },
          confidence: 0.91,
          reason: '用户要求按规格差异化改价，必须先生成确认卡',
        });
      },
    };
    const readCalls: string[] = [];
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run for per-spec plan'); },
      async execute() { throw new Error('execute should not run for per-spec plan'); },
      async read(productId) {
        readCalls.push(productId);
        return { productId, ok: true, specs: [{ specId: '3863', title: 'B' }], values: { '3863': { rent1day: '70.00' } }, lines: ['read: ok'] };
      },
      async copy() { throw new Error('copy should not run'); },
      async delist() { throw new Error('delist should not run'); },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
      async applyPerSpec() { throw new Error('applyPerSpec should not run before confirmation'); },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '648 的 3863 规格 1天改成80' }, outputDir, { agentPlannerProvider: planner, rentalPriceClient });

    expect(readCalls).toEqual(['648']);
    expect(response.text).toContain('按规格改价预览：商品 648');
    const confirmRequest = await loadAgentToolConfirmRequestFromCard(outputDir, response.card);
    expect(confirmRequest.toolName).toBe('rental.perSpecPriceApply');
    expect(confirmRequest.arguments).toEqual({ productId: '648', specFields: { '3863': { rent1day: '80.00' } } });
  });

  it('turns Agent-planned spec dimension plan into the apply confirmation card without confirming the plan first', async () => {
    const outputDir = await writeContext();
    const planner: AgentPlannerProvider = {
      async proposePlan(request) {
        expect(request.tools.map((tool) => tool.name)).toContain('rental.specDimPlan');
        return JSON.stringify({
          goal: '给商品 648 添加规格维度',
          selectedTool: 'rental.specDimPlan',
          arguments: { productId: '648', action: 'add', title: '激光险' },
          confidence: 0.91,
          reason: '用户要求添加规格维度，必须先生成确认卡',
        });
      },
    };
    const specDiscoverCalls: string[] = [];
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run for spec dimension plan'); },
      async execute() { throw new Error('execute should not run for spec dimension plan'); },
      async copy() { throw new Error('copy should not run'); },
      async delist() { throw new Error('delist should not run'); },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover(productId) {
        specDiscoverCalls.push(productId);
        return { productId, ok: true, dimensions: [], lines: ['spec-discover: ok'] };
      },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
      async specAddDim() { throw new Error('specAddDim should not run before confirmation'); },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '给 648 加激光险规格维度' }, outputDir, { agentPlannerProvider: planner, rentalPriceClient });

    expect(specDiscoverCalls).toEqual(['648']);
    expect(response.text).toContain('规格维度变更预览：商品 648');
    const confirmRequest = await loadAgentToolConfirmRequestFromCard(outputDir, response.card);
    expect(confirmRequest.toolName).toBe('rental.specDimApply');
    expect(confirmRequest.arguments).toEqual({ productId: '648', action: 'add', title: '激光险' });
  });

  it('keeps explicit internal id spec removal scoped to that product only', async () => {
    const outputDir = await writeContext();
    const registryRoot = await mkdtemp(join(tmpdir(), 'mt-agent-x300-spec-remove-explicit-id-'));
    const registryPaths = await writeX300SpecRemoveRegistryFixtures(registryRoot);
    const specDiscoverCalls: string[] = [];
    const response = await executeAgentToolRequest(
      { toolName: 'rental.specRemovePlan', arguments: { query: '501', keyword: '手柄' }, reason: '用户指定端内ID删除含手柄规格项' },
      outputDir,
      {
        closedOrderRegistryPaths: registryPaths,
        rentalPriceClient: {
          async preview() { throw new Error('preview should not run'); },
          async execute() { throw new Error('execute should not run'); },
          async copy() { throw new Error('copy should not run'); },
          async delist() { throw new Error('delist should not run'); },
          async tenancySet() { throw new Error('tenancySet should not run'); },
          async specDiscover(productId) {
            specDiscoverCalls.push(productId);
            return {
              productId,
              ok: true,
              dimensions: [{ specId: 'kit', title: '套装', items: [{ id: 'standard', title: '标准' }, { id: 'handle', title: '含手柄' }] }],
              lines: ['spec-discover: ok'],
            };
          },
          async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
          async specRemoveItem() { throw new Error('specRemoveItem should not run before confirmation'); },
        },
      },
    );

    expect(specDiscoverCalls).toEqual(['501']);
    expect(response.text).toContain('匹配依据：按端内ID 501 查询指定商品');
    expect(response.text).toContain('涉及商品：1 个（501）');
    expect(response.card).toBeDefined();
  });

  it('allows explicit multi-id spec removal to produce one bulk confirmation card', async () => {
    const outputDir = await writeContext();
    const ids = Array.from({ length: 13 }, (_, index) => String(601 + index));
    const registryRoot = await mkdtemp(join(tmpdir(), 'mt-agent-x300-spec-remove-bulk-id-'));
    const registryPaths = await writeBulkSpecRemoveRegistryFixtures(registryRoot, ids);
    const specDiscoverCalls: string[] = [];
    const response = await executeAgentToolRequest(
      { toolName: 'rental.specRemovePlan', arguments: { query: ids.join(', '), keyword: '手柄' }, reason: '用户指定多个端内ID删除含手柄规格项' },
      outputDir,
      {
        closedOrderRegistryPaths: registryPaths,
        rentalPriceClient: {
          async preview() { throw new Error('preview should not run'); },
          async execute() { throw new Error('execute should not run'); },
          async copy() { throw new Error('copy should not run'); },
          async delist() { throw new Error('delist should not run'); },
          async tenancySet() { throw new Error('tenancySet should not run'); },
          async specDiscover(productId) {
            specDiscoverCalls.push(productId);
            return {
              productId,
              ok: true,
              dimensions: [{ specId: 'kit', title: '套装', items: [{ id: 'standard', title: '标准' }, { id: 'handle', title: '含手柄' }] }],
              lines: ['spec-discover: ok'],
            };
          },
          async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
          async specRemoveItem() { throw new Error('specRemoveItem should not run before confirmation'); },
        },
      },
    );

    const cardText = JSON.stringify(response.card);
    expect(specDiscoverCalls).toEqual(ids);
    expect(response.text).toContain('涉及商品：13 个');
    expect(response.text).toContain('命中规格项：13 个');
    expect(response.text).toContain('大批量提示');
    expect(response.card).toBeDefined();
    expect(cardText).toContain('"template":"red"');
    expect(cardText).toContain('确认删除 13 项');
    expect(cardText).toContain('"itemTitle":"含手柄"');
  });

  it('blocks spec removal when a keyword only matches the parent dimension', async () => {
    const outputDir = await writeContext();
    const registryRoot = await mkdtemp(join(tmpdir(), 'mt-agent-x300-spec-remove-block-'));
    const registryPaths = await writeX300SpecRemoveRegistryFixtures(registryRoot);
    const response = await executeAgentToolRequest(
      { toolName: 'rental.specRemovePlan', arguments: { query: 'x300u-spec-test', keyword: '套装' }, reason: '测试只命中父级维度时的阻断' },
      outputDir,
      {
        closedOrderRegistryPaths: registryPaths,
        rentalPriceClient: {
          async preview() { throw new Error('preview should not run'); },
          async execute() { throw new Error('execute should not run'); },
          async copy() { throw new Error('copy should not run'); },
          async delist() { throw new Error('delist should not run'); },
          async tenancySet() { throw new Error('tenancySet should not run'); },
          async specDiscover(productId) {
            return {
              productId,
              ok: true,
              dimensions: [{ specId: 'kit', title: '套装', items: [{ id: 'standard', title: '标准' }, { id: 'handle', title: '含手柄' }] }],
              lines: ['spec-discover: ok'],
            };
          },
          async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
        },
      },
    );

    expect(response.text).toContain('没有找到可安全删除的规格项');
    expect(response.text).toContain('只命中规格维度');
    expect(response.card).toBeUndefined();
  });

  it('lets the Agent planner generate an activity refresh plan and execution confirmation without executing writes', async () => {
    const { outputDir, registryPaths } = await writeRefreshActivityFixtures();
    const planner: AgentPlannerProvider = {
      async proposePlan(request) {
        expect(request.message).toBe('刷新活跃度');
        expect(request.tools.map((tool) => tool.name)).toContain('operations.refreshActivityPlan');
        return JSON.stringify({
          goal: '生成活跃度刷新计划',
          selectedTool: 'operations.refreshActivityPlan',
          arguments: {},
          confidence: 0.9,
          reason: '用户要求刷新活跃度，应先筛选近30天零创单链接并生成计划',
        });
      },
    };
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run'); },
      async execute() { throw new Error('execute should not run'); },
      async copy() { throw new Error('copy should not run'); },
      async delist() { throw new Error('delist should not run'); },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '刷新活跃度' }, outputDir, {
      agentPlannerProvider: planner,
      rentalPriceClient,
      closedOrderRegistryPaths: registryPaths,
    });

    expect(response.text).toContain('活跃度刷新计划：2026-06-11');
    expect(response.text).toContain('待下架候选：2 条');
    expect(response.text).toContain('DJI Pocket 3');
    expect(response.text).toContain('dji-pocket-3：待下架 2 条，建议补回 2 条新链');
    expect(response.text).toContain('补链源 900 Pocket3 健康源');
    expect(response.text).toContain('端内ID 901、902');
    expect(response.text).toContain('30日访问页缺失 1 条');
    expect(response.text).toContain('上线不足 30 天 1 条');
    expect(response.text).toContain('上线天数未知 1 条');
    expect(response.text).toContain('已生成执行确认卡；确认前不会下架或补链');
    expect(response.card).toBeDefined();
    const request = readAgentToolConfirmRequestFromCard(response.card);
    expect(request.toolName).toBe('operations.refreshActivityExecute');
    expect(request.arguments).toMatchObject({
      date: '2026-06-11',
      delistProductIds: ['901', '902'],
      newLinkItems: [{ keyword: 'DJI Pocket 3', count: 2, sourceProductId: '900', sourceProductName: 'Pocket3 健康源', sameSkuGroupId: 'dji-pocket-3' }],
    });
    expect(request.arguments.delistProductIds).not.toContain('906');
    expect(request.arguments.delistProductIds).not.toContain('907');
  });

  it('uses first seen date as a fallback before treating zero 30-day orders as inactive', async () => {
    const { outputDir, registryPaths } = await writeRefreshActivityFixtures();
    await writeFile(registryPaths.firstSeenPath, JSON.stringify({
      '907': { firstSeenDate: '2026-05-01', platformProductId: 'p907', productName: 'Pocket3 上线天数未知' },
    }), 'utf8');

    const response = await executeAgentToolRequest(
      { toolName: 'operations.refreshActivityPlan', arguments: {}, reason: '测试 firstSeenDate 满 30 天后才允许进入候选' },
      outputDir,
      { closedOrderRegistryPaths: registryPaths },
    );

    expect(response.text).toContain('待下架候选：3 条');
    expect(response.text).toContain('上线天数未知 0 条');
    const request = readAgentToolConfirmRequestFromCard(response.card);
    expect(request.arguments).toMatchObject({
      delistProductIds: ['901', '902', '907'],
      newLinkItems: [{ keyword: 'DJI Pocket 3', count: 3, sourceProductId: '900' }],
    });
    expect(request.arguments.delistProductIds).not.toContain('906');
  });

  it('executes a confirmed activity refresh plan with audit output', async () => {
    const { outputDir, registryPaths } = await writeRefreshActivityFixtures();
    const plan = await executeAgentToolRequest(
      { toolName: 'operations.refreshActivityPlan', arguments: {}, reason: '测试生成活跃度刷新计划' },
      outputDir,
      { closedOrderRegistryPaths: registryPaths },
    );
    const request = readAgentToolConfirmRequestFromCard(plan.card);
    const calls: string[] = [];
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run'); },
      async execute() { throw new Error('execute should not run'); },
      async copy(productId) {
        calls.push(`copy:${productId}`);
        return { productId, ok: true, newProductId: `new-${calls.length}`, lines: ['copy: ok'] };
      },
      async delist(productId) {
        calls.push(`delist:${productId}`);
        return { productId, ok: true, lines: ['delist: ok'] };
      },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };

    const response = await executeAgentToolRequest(request, outputDir, { rentalPriceClient });

    expect(calls).toEqual(['delist:901', 'delist:902', 'copy:900', 'copy:900']);
    expect(response.text).toContain('活跃度刷新执行完成：2026-06-11');
    expect(response.text).toContain('下架：成功 2/2');
    expect(response.text).toContain('补链：成功，完成 2/2 条');
    expect(response.text).toContain('审计文件：');
    const auditPath = response.metadata?.auditPath;
    expect(typeof auditPath).toBe('string');
    const audit = JSON.parse(await readFile(auditPath as string, 'utf8')) as { ok?: boolean; request?: { delistProductIds?: string[] } };
    expect(audit.ok).toBe(true);
    expect(audit.request?.delistProductIds).toEqual(['901', '902']);
  });

  it('skips missing products during confirmed activity refresh execution and continues the batch', async () => {
    const { outputDir, registryPaths } = await writeRefreshActivityFixtures();
    const plan = await executeAgentToolRequest(
      { toolName: 'operations.refreshActivityPlan', arguments: {}, reason: 'test refresh activity plan' },
      outputDir,
      { closedOrderRegistryPaths: registryPaths },
    );
    const request = readAgentToolConfirmRequestFromCard(plan.card);
    const calls: string[] = [];
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run'); },
      async execute() { throw new Error('execute should not run'); },
      async copy(productId) {
        calls.push(`copy:${productId}`);
        return { productId, ok: true, newProductId: `new-${calls.length}`, lines: ['copy: ok'] };
      },
      async delist(productId) {
        calls.push(`delist:${productId}`);
        if (productId === '901') {
          return { productId, ok: false, lines: ['delist: error', 'Product not found: 901'] };
        }
        return { productId, ok: true, lines: ['delist: ok'] };
      },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };

    const response = await executeAgentToolRequest(request, outputDir, { rentalPriceClient });

    expect(calls).toEqual(['delist:901', 'delist:902', 'copy:900', 'copy:900']);
    expect(response.text).toContain('活跃度刷新部分完成');
    expect(response.text).toContain('跳过：1 个商品不存在（901）');
    expect(response.metadata?.skippedMissingDelistProductIds).toEqual(['901']);
    expect(response.metadata?.ok).toBe(false);
    const audit = JSON.parse(await readFile(response.metadata?.auditPath as string, 'utf8')) as {
      ok?: boolean;
      skippedMissingDelistProductIds?: string[];
    };
    expect(audit.ok).toBe(false);
    expect(audit.skippedMissingDelistProductIds).toEqual(['901']);
  });

  it('continues a multi-step plan after a confirmed activity refresh execution card', async () => {
    const { outputDir, registryPaths } = await writeRefreshActivityFixtures();
    const planner: AgentPlannerProvider = {
      async proposePlan() {
        return JSON.stringify({
          goal: '刷新活跃度后查询健康源',
          steps: [
            { id: 'refresh', toolName: 'operations.refreshActivityPlan', arguments: {}, reason: '先生成活跃度刷新计划和确认卡' },
            { toolName: 'product.query', arguments: { keyword: '900' }, reason: '确认执行后再查询健康源表现' },
          ],
          confidence: 0.9,
          reason: '活跃度刷新会生成专用执行确认卡，确认后仍应续跑后续查询',
        });
      },
    };
    const calls: string[] = [];
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run'); },
      async execute() { throw new Error('execute should not run'); },
      async copy(productId) {
        calls.push(`copy:${productId}`);
        return { productId, ok: true, newProductId: `new-${calls.length}`, lines: ['copy: ok'] };
      },
      async delist(productId) {
        calls.push(`delist:${productId}`);
        return { productId, ok: true, lines: ['delist: ok'] };
      },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '刷新活跃度，然后查 900' }, outputDir, {
      agentPlannerProvider: planner,
      rentalPriceClient,
      closedOrderRegistryPaths: registryPaths,
    });
    const request = readAgentToolConfirmRequestFromCard(response.card);

    expect(request.toolName).toBe('operations.refreshActivityExecute');
    expect(request.continuation?.steps).toHaveLength(1);

    const executed = await executeAgentToolRequestWithContinuation(request, outputDir, {
      rentalPriceClient,
      closedOrderRegistryPaths: registryPaths,
    });

    expect(calls).toEqual(['delist:901', 'delist:902', 'copy:900', 'copy:900']);
    expect(executed.text).toContain('Agent 多步骤计划继续执行：刷新活跃度后查询健康源');
    expect(executed.text).toContain('步骤 1/2：operations.refreshActivityExecute');
    expect(executed.text).toContain('活跃度刷新执行完成：2026-06-11');
    expect(executed.text).toContain('步骤 2/2：product.query');
    expect(executed.text).toContain('端内ID 900');
  });

  it('passes silent learning hints into the generic agent planner', async () => {
    const outputDir = await writeContext();
    await recordAgentLearningEvent(outputDir, {
      type: 'clarification_selected',
      originalMessage: '帮我处理一下 pocket3',
      selectedMessage: '帮我铺十条 pocket3 的新链',
      label: '铺新链',
      createdAt: '2026-06-23T01:00:00.000Z',
    });
    const planner: AgentPlannerProvider = {
      async proposePlan(request) {
        expect(request.message).toBe('帮我处理 pocket3');
        expect(request.learningHints).toEqual([expect.objectContaining({
          originalMessage: '帮我处理一下 pocket3',
          selectedMessage: '帮我铺十条 pocket3 的新链',
          label: '铺新链',
        })]);
        return JSON.stringify({
          goal: '查询商品表现',
          selectedTool: 'product.query',
          arguments: { keyword: 'pocket3' },
          confidence: 0.82,
          reason: '测试学习提示注入',
        });
      },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '帮我处理 pocket3' }, outputDir, { agentPlannerProvider: planner });

    expect(response.text).toContain('端内ID');
  });

  it('returns the Agent learning summary on request', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-bot-learning-summary-'));
    await recordAgentLearningEvent(outputDir, {
      type: 'clarification_selected',
      originalMessage: '帮我处理一下 875',
      selectedMessage: '复制商品 875',
      label: '复制商品',
    });

    const response = await handleBotIntent({ type: 'agent_learning_summary' }, outputDir);

    expect(response.text).toContain('Agent 学习汇总');
    expect(response.text).toContain('澄清选择 1');
    expect(response.text).toContain('复制商品 875');
  });

  it('turns high-risk generic agent plans into approval cards without side effects', async () => {
    const planner: AgentPlannerProvider = {
      async proposePlan(request) {
        expect(request.tools.map((tool) => tool.name)).toContain('rental.delist');
        expect(request.tools.map((tool) => tool.name)).not.toContain('rental.operationConfirmRequest');
        return JSON.stringify({
          goal: '下架租赁商品',
          selectedTool: 'rental.delist',
          arguments: { productId: '761' },
          confidence: 0.95,
          reason: '用户要求下架商品 761',
          requiresConfirmation: true,
        });
      },
    };
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run before approval'); },
      async execute() { throw new Error('execute should not run before approval'); },
      async copy() { throw new Error('copy should not run before approval'); },
      async delist() { throw new Error('delist should not run before approval'); },
      async tenancySet() { throw new Error('tenancySet should not run before approval'); },
      async specDiscover() { throw new Error('specDiscover should not run before approval'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run before approval'); },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '帮我把 761 下架' }, 'output', {
      agentPlannerProvider: planner,
      rentalPriceClient,
    });

    expect(response.text).toContain('请确认 Agent 操作：rental.delist');
    expect(response.card).toBeDefined();
    expect(JSON.stringify(response.card)).toContain('agent_tool_confirm');
    expect(JSON.stringify(response.card)).toContain('rental.delist');
    expect(JSON.stringify(response.card)).toContain('761');
  });

  it('turns batch delist agent plans into one approval card without side effects', async () => {
    const planner: AgentPlannerProvider = {
      async proposePlan(request) {
        expect(request.tools.map((tool) => tool.name)).toContain('rental.delistBatch');
        return JSON.stringify({
          goal: '批量下架租赁商品',
          selectedTool: 'rental.delistBatch',
          arguments: { productIds: ['251', '467', '252'] },
          confidence: 0.95,
          reason: '用户明确给出多个端内ID并要求下架',
          requiresConfirmation: true,
        });
      },
    };
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run before approval'); },
      async execute() { throw new Error('execute should not run before approval'); },
      async copy() { throw new Error('copy should not run before approval'); },
      async delist() { throw new Error('delist should not run before approval'); },
      async tenancySet() { throw new Error('tenancySet should not run before approval'); },
      async specDiscover() { throw new Error('specDiscover should not run before approval'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run before approval'); },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '下架: 251, 467, 252' }, 'output', {
      agentPlannerProvider: planner,
      rentalPriceClient,
    });

    expect(response.text).toContain('请确认 Agent 操作：rental.delistBatch');
    expect(response.card).toBeDefined();
    expect(JSON.stringify(response.card)).toContain('agent_tool_confirm');
    expect(JSON.stringify(response.card)).toContain('rental.delistBatch');
    expect(JSON.stringify(response.card)).toContain('251');
    expect(JSON.stringify(response.card)).toContain('467');
    expect(JSON.stringify(response.card)).toContain('252');
  });

  it('executes batch delist requests and skips missing products safely', async () => {
    const calls: string[] = [];
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run'); },
      async execute() { throw new Error('execute should not run'); },
      async copy() { throw new Error('copy should not run'); },
      async delist(productId) {
        calls.push(productId);
        if (productId === '901') {
          return { productId, ok: false, lines: ['delist: error', 'Product not found: 901'] };
        }
        return { productId, ok: true, lines: ['delist: ok'] };
      },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };

    const response = await executeAgentToolRequest(
      { toolName: 'rental.delistBatch', arguments: { productIds: ['900', '901', '902'] }, reason: '批量下架测试' },
      'output',
      { rentalPriceClient },
    );

    expect(calls).toEqual(['900', '901', '902']);
    expect(response.text).toContain('批量下架部分完成');
    expect(response.text).toContain('跳过：1 个商品不存在（901）');
    expect(response.metadata).toMatchObject({
      toolName: 'rental.delistBatch',
      ok: false,
      delistedProductIds: ['900', '902'],
      skippedMissingProductIds: ['901'],
    });
  });

  it('continues batch delist after an individual product fails verification', async () => {
    const calls: string[] = [];
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run'); },
      async execute() { throw new Error('execute should not run'); },
      async copy() { throw new Error('copy should not run'); },
      async delist(productId) {
        calls.push(productId);
        if (productId === '467') {
          return { productId, ok: false, lines: ['delist: error', 'Product still visible after delist'] };
        }
        return { productId, ok: true, lines: ['delist: ok'] };
      },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };

    const response = await executeAgentToolRequest(
      { toolName: 'rental.delistBatch', arguments: { productIds: ['251', '467', '252'] }, reason: '批量下架测试' },
      'output',
      { rentalPriceClient },
    );

    expect(calls).toEqual(['251', '467', '252']);
    expect(response.text).toContain('批量下架部分完成');
    expect(response.text).toContain('失败：1 个（467）');
    expect(response.text).not.toContain('未执行');
    expect(response.metadata).toMatchObject({
      toolName: 'rental.delistBatch',
      ok: false,
      delistedProductIds: ['251', '252'],
      failedProductIds: ['467'],
      pendingProductIds: [],
    });
  });

  it('keeps rental.delist compatible with productIds arrays from the planner', async () => {
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

    const response = await executeAgentToolRequest(
      { toolName: 'rental.delist', arguments: { productIds: ['251', '467'] }, reason: '兼容批量下架参数' },
      'output',
      { rentalPriceClient },
    );

    expect(calls).toEqual(['251', '467']);
    expect(response.text).toContain('批量下架完成');
    expect(response.metadata).toMatchObject({ toolName: 'rental.delist', ok: true, delistedProductIds: ['251', '467'] });
  });

  it('keeps rental.delist compatible with comma separated productId lists from the planner', async () => {
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

    const response = await executeAgentToolRequest(
      { toolName: 'rental.delist', arguments: { productId: '251, 467, 252' }, reason: '兼容批量下架 productId 字符串' },
      'output',
      { rentalPriceClient },
    );

    expect(calls).toEqual(['251', '467', '252']);
    expect(response.text).toContain('批量下架完成');
    expect(response.metadata).toMatchObject({ toolName: 'rental.delist', ok: true, delistedProductIds: ['251', '467', '252'] });
  });

  it('turns ambiguous generic agent plans into clarification cards', async () => {
    const planner: AgentPlannerProvider = {
      async proposePlan(request) {
        expect(request.message).toBe('帮我处理一下 pocket3');
        return JSON.stringify({
          goal: '澄清 pocket3 操作',
          needsClarification: true,
          originalMessage: request.message,
          question: '你想怎么处理 pocket3？',
          options: [
            { label: '查询数据', message: '查询 pocket3 的公域数据', description: '只读查询' },
            { label: '铺新链', message: '帮我铺十条 pocket3 的新链', description: '需要确认后复制' },
          ],
          confidence: 0.4,
          reason: '处理动作不明确',
        });
      },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '帮我处理一下 pocket3' }, 'output', {
      agentPlannerProvider: planner,
    });

    expect(response.text).toBe('你想怎么处理 pocket3？');
    expect(response.card).toBeDefined();
    expect(JSON.stringify(response.card)).toContain('agent_clarify_select');
    expect(JSON.stringify(response.card)).toContain('帮我铺十条 pocket3 的新链');
    expect(JSON.stringify(response.card)).not.toContain('agent_tool_confirm');
  });

  it('keeps exact report generation and dashboard refresh behind confirmation cards', async () => {
    const outputDir = await writeContext();

    const runReport = await handleBotIntent({ type: 'run_public_traffic_report' }, outputDir);
    expect(runReport.text).toContain('publicTraffic.runReport');
    expect(JSON.stringify(runReport.card)).toContain('agent_tool_confirm');
    expect(mocks.runPublicTrafficReportCli).not.toHaveBeenCalled();

    const refreshDashboard = await handleBotIntent({ type: 'refresh_public_traffic_dashboard', sendTo: 'group' }, outputDir);
    expect(refreshDashboard.text).toContain('publicTraffic.refreshDashboard');
    expect(JSON.stringify(refreshDashboard.card)).toContain('agent_tool_confirm');
    expect(mocks.runDashboardRefresh).not.toHaveBeenCalled();

    const resend = await handleBotIntent({ type: 'resend_latest_report', sendTo: 'both' }, outputDir);
    expect(resend.text).toContain('公域日报已重发');
    expect(resend.card).toBeUndefined();

    const datedResend = await handleBotIntent({ type: 'resend_latest_report', sendTo: 'group', date: '2026-06-11' }, outputDir);
    expect(datedResend.text).toContain('2026-06-11 公域日报已重发');
    expect(datedResend.card).toBeUndefined();

    const datedPush = await handleBotIntent({ type: 'push_latest_report_to_group', date: '2026-06-11' }, outputDir);
    expect(datedPush.text).toContain('2026-06-11 公域日报已推送到群');
    expect(datedPush.card).toBeUndefined();
    expect(mocks.sendFeishuCard).toHaveBeenCalledTimes(3);
  });

  it('plans new-link batch tool calls through LLM without copying before confirmation', async () => {
    const { outputDir, registryPaths } = await writeNewLinkWorkflowContext();
    const planner: AgentPlannerProvider = {
      async proposePlan(request) {
        expect(request.workflows).toEqual([]);
        expect(request.tools.map((tool) => tool.name)).toContain('rental.newLinkBatchPlan');
        return JSON.stringify({
          goal: '铺设 pocket3 新链',
          selectedTool: 'rental.newLinkBatchPlan',
          arguments: { keyword: 'pocket3', count: 10 },
          confidence: 0.95,
          reason: '用户要求铺十条 pocket3 的新链',
          requiresConfirmation: true,
        });
      },
    };
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run'); },
      async execute() { throw new Error('execute should not run'); },
      async copy() { throw new Error('copy should not run before workflow confirmation'); },
      async delist() { throw new Error('delist should not run'); },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '帮我铺十条 pocket3 的新链' }, outputDir, {
      agentPlannerProvider: planner,
      rentalPriceClient,
      closedOrderRegistryPaths: registryPaths,
    });

    expect(response.text).toContain('新链批量铺设计划：准备复制 10 条「pocket3」新链');
    expect(response.text).toContain('推荐源商品：733 大疆DJI Pocket3云台相机128G 高转化');
    expect(response.card).toBeDefined();
    expect(JSON.stringify(response.card)).toContain('new_link_batch_confirm');
    expect(JSON.stringify(response.card)).toContain('733');
  });

  it('locks explicit internal product id as the new-link copy source', async () => {
    const { outputDir, registryPaths } = await writeNewLinkWorkflowContext();
    const planner: AgentPlannerProvider = {
      async proposePlan() {
        return JSON.stringify({
          goal: '从端内ID 875 复制新链',
          selectedTool: 'rental.newLinkBatchPlan',
          arguments: { keyword: 'pocket3', count: 3, sourceProductId: '875' },
          confidence: 0.95,
          reason: '用户要求从端内ID 875 复制 3 条新链',
          requiresConfirmation: true,
        });
      },
    };
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run'); },
      async execute() { throw new Error('execute should not run'); },
      async copy() { throw new Error('copy should not run before workflow confirmation'); },
      async delist() { throw new Error('delist should not run'); },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '从端内ID 875 复制 3 条新链' }, outputDir, {
      agentPlannerProvider: planner,
      rentalPriceClient,
      closedOrderRegistryPaths: registryPaths,
    });

    const cardText = JSON.stringify(response.card);
    expect(response.text).toContain('875');
    expect(cardText).toContain('"sourceProductId":"875"');
    expect(cardText).toContain('"requestedSourceProductId":"875"');
    expect(cardText).not.toContain('"sourceProductId":"733"');
  });

  it('locks numeric new-link keywords as explicit internal product ids', async () => {
    const { outputDir, registryPaths } = await writeNewLinkWorkflowContext();
    const planner: AgentPlannerProvider = {
      async proposePlan() {
        return JSON.stringify({
          goal: 'copy from internal id 875',
          selectedTool: 'rental.newLinkBatchPlan',
          arguments: { keyword: '875', count: 3 },
          confidence: 0.95,
          reason: 'the user provided an explicit internal product id',
          requiresConfirmation: true,
        });
      },
    };
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run'); },
      async execute() { throw new Error('execute should not run'); },
      async copy() { throw new Error('copy should not run before workflow confirmation'); },
      async delist() { throw new Error('delist should not run'); },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '帮我铺五条 875' }, outputDir, {
      agentPlannerProvider: planner,
      rentalPriceClient,
      closedOrderRegistryPaths: registryPaths,
    });

    const cardText = JSON.stringify(response.card);
    expect(response.text).toContain('875');
    expect(cardText).toContain('"sourceProductId":"875"');
    expect(cardText).toContain('"requestedSourceProductId":"875"');
    expect(cardText).not.toContain('"sourceProductId":"733"');
  });

  it('accepts planner new-link requests with sourceProductId and count but no keyword', async () => {
    const { outputDir, registryPaths } = await writeNewLinkWorkflowContext();
    const planner: AgentPlannerProvider = {
      async proposePlan() {
        return JSON.stringify({
          goal: 'copy from internal id 875',
          selectedTool: 'rental.newLinkBatchPlan',
          arguments: { sourceProductId: '875', count: 3 },
          confidence: 0.95,
          reason: 'the user provided an explicit internal product id',
          requiresConfirmation: true,
        });
      },
    };
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run'); },
      async execute() { throw new Error('execute should not run'); },
      async copy() { throw new Error('copy should not run before workflow confirmation'); },
      async delist() { throw new Error('delist should not run'); },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '复制五条端内id875' }, outputDir, {
      agentPlannerProvider: planner,
      rentalPriceClient,
      closedOrderRegistryPaths: registryPaths,
    });

    const cardText = JSON.stringify(response.card);
    expect(response.text).not.toContain('参数无效');
    expect(cardText).toContain('"sourceProductId":"875"');
    expect(cardText).toContain('"requestedSourceProductId":"875"');
  });

  it('turns a best-link follow-up copy command into a new-link confirmation card without executing', async () => {
    const { outputDir, registryPaths } = await writeNewLinkWorkflowContext();
    const planner: AgentPlannerProvider = {
      async proposePlan(request) {
        expect(request.message).toBe('数据最好的SQ1的端内id是多少?按这个id复制5条新链');
        return JSON.stringify({
          goal: '按 SQ1 最佳链接复制 5 条新链',
          steps: [
            { id: 'rank', toolName: 'product.rankBestSameSku', arguments: { query: 'SQ1' }, reason: '先找 SQ1 同款组里数据最好的端内ID' },
            { toolName: 'rental.newLinkBatchPlan', arguments: { keyword: 'SQ1', count: 5, sourceProductId: '${rank.bestProductId}' }, reason: '按最佳端内ID生成新链复制确认卡' },
          ],
          confidence: 0.95,
          reason: '用户要求先找到 SQ1 表现最好的链接，再按该链接复制 5 条新链',
        });
      },
    };
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run'); },
      async execute() { throw new Error('execute should not run'); },
      async copy() { throw new Error('copy should not run before workflow confirmation'); },
      async delist() { throw new Error('delist should not run'); },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };

    const response = await handleBotIntent(
      { type: 'unknown', text: '数据最好的SQ1的端内id是多少?按这个id复制5条新链' },
      outputDir,
      { agentPlannerProvider: planner, rentalPriceClient, closedOrderRegistryPaths: registryPaths },
    );

    const cardText = JSON.stringify(response.card);
    expect(response.text).toContain('新链批量铺设计划：准备复制 5 条「SQ1」新链');
    expect(response.text).toContain('推荐源商品：388 Fujifilm instax SQUARE SQ1 high conversion');
    expect(response.card).toBeDefined();
    expect(cardText).toContain('new_link_batch_confirm');
    expect(cardText).toContain('"keyword":"SQ1"');
    expect(cardText).toContain('"count":5');
    expect(cardText).toContain('"sourceProductId":"388"');
  });

  it('fills missing new-link keyword and count from a prior best-link step for one-link copy requests', async () => {
    const { outputDir, registryPaths } = await writeNewLinkWorkflowContext();
    const planner: AgentPlannerProvider = {
      async proposePlan() {
        return JSON.stringify({
          goal: '按 SQ1 同款组中表现最好的链接复制一条新链',
          steps: [
            { id: 'rank', toolName: 'product.rankBestSameSku', arguments: { query: 'SQ1' }, reason: '先找到 SQ1 表现最好的端内ID' },
            { toolName: 'rental.newLinkBatchPlan', arguments: { sourceProductId: '${rank.bestProductId}' }, reason: '按最佳端内ID复制一条新链' },
          ],
          confidence: 0.95,
          reason: '用户请求复制一条 SQ1 链接，需要先找最优源，再生成复制确认卡。',
        });
      },
    };
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run'); },
      async execute() { throw new Error('execute should not run'); },
      async copy() { throw new Error('copy should not run before workflow confirmation'); },
      async delist() { throw new Error('delist should not run'); },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };

    const response = await handleBotIntent(
      { type: 'unknown', text: '复制一条SQ1的链接' },
      outputDir,
      { agentPlannerProvider: planner, rentalPriceClient, closedOrderRegistryPaths: registryPaths },
    );

    const cardText = JSON.stringify(response.card);
    expect(response.text).toContain('准备复制 1 条');
    expect(response.text).toContain('SQ1');
    expect(response.card).toBeDefined();
    expect(cardText).toContain('new_link_batch_confirm');
    expect(cardText).toContain('"keyword":"SQ1"');
    expect(cardText).toContain('"count":1');
    expect(cardText).toContain('"sourceProductId":"388"');
    expect(response.text).not.toContain('参数无效');
  });

  it('turns multiple best-link follow-up copy commands into one multi-source confirmation card without executing', async () => {
    const { outputDir, registryPaths } = await writeNewLinkWorkflowContext();
    const planner: AgentPlannerProvider = {
      async proposePlan(request) {
        expect(request.message).toBe('数据最好的wide 300,wide 400的端内id是多少?分别按这个id复制5条新。');
        return JSON.stringify({
          goal: '分别按 wide 300 和 wide 400 最佳链接复制新链',
          steps: [
            { id: 'wide300', toolName: 'product.rankBestSameSku', arguments: { query: 'wide 300' }, reason: '找到 wide 300 最佳链接' },
            { id: 'wide400', toolName: 'product.rankBestSameSku', arguments: { query: 'wide 400' }, reason: '找到 wide 400 最佳链接' },
            {
              toolName: 'rental.newLinkBatchPlan',
              arguments: {
                items: [
                  { keyword: 'wide 300', count: 5, sourceProductId: '${wide300.bestProductId}' },
                  { keyword: 'wide 400', count: 5, sourceProductId: '${wide400.bestProductId}' },
                ],
              },
              reason: '按两个最佳链接分别生成新链复制确认卡',
            },
          ],
          confidence: 0.95,
          reason: '用户要求分别找到 wide 300、wide 400 的最佳链接，并各复制 5 条新链',
        });
      },
    };
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run'); },
      async execute() { throw new Error('execute should not run'); },
      async copy() { throw new Error('copy should not run before workflow confirmation'); },
      async delist() { throw new Error('delist should not run'); },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };

    const response = await handleBotIntent(
      { type: 'unknown', text: '数据最好的wide 300,wide 400的端内id是多少?分别按这个id复制5条新。' },
      outputDir,
      { agentPlannerProvider: planner, rentalPriceClient, closedOrderRegistryPaths: registryPaths },
    );

    const cardText = JSON.stringify(response.card);
    expect(response.text).toContain('多商品新链批量铺设计划：准备分别复制 2 个商品');
    expect(response.text).toContain('wide 300：源商品 302 Wide 300 best source，复制 5 条');
    expect(response.text).toContain('wide 400：源商品 402 Wide 400 best source，复制 5 条');
    expect(response.card).toBeDefined();
    expect(cardText).toContain('new_link_batch_multi_confirm');
    expect(cardText).toContain('"keyword":"wide 300"');
    expect(cardText).toContain('"sourceProductId":"302"');
    expect(cardText).toContain('"keyword":"wide 400"');
    expect(cardText).toContain('"sourceProductId":"402"');
  });

  it('returns a multi-source confirmation card when five products each need five new links', async () => {
    const { outputDir, registryPaths } = await writeNewLinkWorkflowContext();
    const planner: AgentPlannerProvider = {
      async proposePlan() {
        return JSON.stringify({
          goal: '五个商品各铺五条新链',
          selectedTool: 'rental.newLinkBatchPlan',
          arguments: {
            items: [
              { keyword: 'pocket3', count: 5, sourceProductId: '733' },
              { keyword: 'action5', count: 5, sourceProductId: '841' },
              { keyword: 'wide 300', count: 5, sourceProductId: '302' },
              { keyword: 'wide 400', count: 5, sourceProductId: '402' },
              { keyword: 'SQ1', count: 5, sourceProductId: '388' },
            ],
          },
          confidence: 0.95,
          reason: '用户要求多个商品分别铺设 5 条新链，需生成多商品确认卡',
          requiresConfirmation: true,
        });
      },
    };
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run'); },
      async execute() { throw new Error('execute should not run'); },
      async copy() { throw new Error('copy should not run before workflow confirmation'); },
      async delist() { throw new Error('delist should not run'); },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };

    const response = await handleBotIntent(
      { type: 'unknown', text: 'pocket3, action5,wide 300,wide 400,SQ1,各铺五条链接' },
      outputDir,
      { agentPlannerProvider: planner, rentalPriceClient, closedOrderRegistryPaths: registryPaths },
    );

    const cardText = JSON.stringify(response.card);
    expect(response.text).toContain('多商品新链批量铺设计划：准备分别复制 5 个商品');
    expect(response.text).toContain('注意：当前仅生成计划和确认卡');
    expect(response.card).toBeDefined();
    expect(cardText).toContain('new_link_batch_multi_confirm');
    expect(cardText).toContain('"keyword":"pocket3"');
    expect(cardText).toContain('"keyword":"action5"');
    expect(cardText).toContain('"keyword":"wide 300"');
    expect(cardText).toContain('"keyword":"wide 400"');
    expect(cardText).toContain('"keyword":"SQ1"');
  });

  it('rejects legacy selectedWorkflow output in the planner-first Feishu path', async () => {
    const outputDir = await writeContext();
    const planner: AgentPlannerProvider = {
      async proposePlan() {
        return '{"goal":"bad","selectedWorkflow":"rental.newLinkBatch","arguments":{"keyword":"pocket3","count":"10"},"confidence":0.9,"reason":"bad"}';
      },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '帮我铺十条 pocket3 的新链' }, outputDir, {
      agentPlannerProvider: planner,
    });

    expect(response.text).toContain('legacy workflow');
    expect(response.text).toContain('未执行任何操作');
    expect(response.text).toContain('selectedTool 或 steps');
    expect(response.text).not.toContain('大疆 Pocket 3');
    expect(response.card).toBeUndefined();
  });

  it('returns a confirmation card for LLM-proposed rental delist without executing the daemon', async () => {
    const proposalProvider: LlmIntentProposalProvider = {
      async proposeIntent(request) {
        expect(request.message).toBe('帮我把 761 下架');
        expect(request.intents.map((intent) => intent.name)).toContain('rental_delist');
        return JSON.stringify({ intent: 'rental_delist', arguments: { productId: '761' }, confidence: 0.94, reason: '用户要求下架商品 761' });
      },
    };
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run for delist proposal'); },
      async execute() { throw new Error('execute should not run for delist proposal'); },
      async copy() { throw new Error('copy should not run before confirmation'); },
      async delist() { throw new Error('delist should not run before confirmation'); },
      async tenancySet() { throw new Error('tenancySet should not run before confirmation'); },
      async specDiscover() { throw new Error('specDiscover should not run before confirmation'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run before confirmation'); },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '帮我把 761 下架' }, 'output', { llmIntentProposalProvider: proposalProvider, rentalPriceClient });

    expect(response.text).toContain('请确认租赁商品操作：761');
    expect(response.card).toBeDefined();
    expect(JSON.stringify(response.card)).toContain('rental_operation_confirm');
    expect(JSON.stringify(response.card)).toContain('delist');
    expect(JSON.stringify(response.card)).toContain('761');
  });

  it('returns a rental price preview card for LLM-proposed price changes without executing', async () => {
    const proposalProvider: LlmIntentProposalProvider = {
      async proposeIntent() {
        return JSON.stringify({ intent: 'rental_price_change', arguments: { productId: '761', fields: { rent1day: 22, rent10day: '55' } }, confidence: 0.96, reason: '用户要求改 1 天和 10 天租金' });
      },
    };
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview(request) {
        expect(request).toEqual({ mode: 'explicit_fields', productId: '761', fields: { rent1day: '22.00', rent10day: '55.00' } });
        if (request.mode !== 'explicit_fields') throw new Error('expected explicit fields preview');
        return { productId: '761', fields: request.fields, lines: ['rent1day -> 22.00', 'rent10day -> 55.00'], warnings: [] };
      },
      async execute() { throw new Error('execute should not run before confirmation'); },
      async copy() { throw new Error('copy should not run'); },
      async delist() { throw new Error('delist should not run'); },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '把 761 的 1 天租金改成 22，10 天改成 55' }, 'output', { llmIntentProposalProvider: proposalProvider, rentalPriceClient });

    expect(response.text).toContain('请确认商品 761 改价');
    expect(JSON.stringify(response.card)).toContain('rental_price_confirm');
    expect(JSON.stringify(response.card)).toContain('rent1day');
    expect(JSON.stringify(response.card)).toContain('22.00');
  });

  it('turns Agent-planned rental.priceChange into the dedicated rental price preview card', async () => {
    const planner: AgentPlannerProvider = {
      async proposePlan(request) {
        expect(request.tools.map((tool) => tool.name)).toContain('rental.priceChange');
        return JSON.stringify({
          goal: '改商品 761 的租金',
          selectedTool: 'rental.priceChange',
          arguments: { productId: '761', fields: { rent1day: 22 } },
          confidence: 0.94,
          reason: '用户要求把 761 的 1 天租金改成 22',
        });
      },
    };
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview(request) {
        expect(request).toEqual({ mode: 'explicit_fields', productId: '761', fields: { rent1day: '22.00' } });
        if (request.mode !== 'explicit_fields') throw new Error('expected explicit fields preview');
        return { productId: '761', fields: request.fields, lines: ['rent1day -> 22.00'], warnings: [] };
      },
      async execute() { throw new Error('execute should not run before price confirmation'); },
      async copy() { throw new Error('copy should not run'); },
      async delist() { throw new Error('delist should not run'); },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '把 761 的 1 天租金改成 22' }, 'output', { agentPlannerProvider: planner, rentalPriceClient });

    expect(response.text).toContain('请确认商品 761 改价');
    expect(JSON.stringify(response.card)).toContain('rental_price_confirm');
    expect(JSON.stringify(response.card)).toContain('用户要求把 761 的 1 天租金改成 22');
    expect(JSON.stringify(response.card)).not.toContain('agent_tool_confirm');
  });

  it('recovers explicit rent fields from the original message when Agent plans pricePreview with only productIds', async () => {
    const planner: AgentPlannerProvider = {
      async proposePlan(request) {
        expect(request.message).toBe('改价 954 1天88 10天999');
        return JSON.stringify({
          goal: '对商品 954 生成改价预览',
          selectedTool: 'rental.pricePreview',
          arguments: { productIds: ['954'] },
          confidence: 0.92,
          reason: '用户要求对 954 改价，需先生成确认卡',
        });
      },
    };
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview(request) {
        expect(request).toEqual({ mode: 'explicit_fields', productId: '954', fields: { rent1day: '88.00', rent10day: '999.00' } });
        if (request.mode !== 'explicit_fields') throw new Error('expected explicit fields preview');
        return { productId: '954', fields: request.fields, lines: ['rent1day -> 88.00', 'rent10day -> 999.00'], warnings: [] };
      },
      async execute() { throw new Error('execute should not run before price confirmation'); },
      async copy() { throw new Error('copy should not run'); },
      async delist() { throw new Error('delist should not run'); },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '改价 954 1天88 10天999' }, 'output', { agentPlannerProvider: planner, rentalPriceClient });

    expect(response.text).toContain('改价预览：1 个端内ID');
    expect(JSON.stringify(response.card)).toContain('rent1day');
    expect(JSON.stringify(response.card)).toContain('999.00');
  });

  it('lets the Agent compose product resolution and atomic price preview before group discount execution', async () => {
    const outputDir = await writeContext();
    const registryRoot = await mkdtemp(join(tmpdir(), 'mt-agent-ace-price-registry-'));
    const registryPaths = await writeAceProPriceRegistryFixtures(registryRoot);
    const planner: AgentPlannerProvider = {
      async proposePlan(request) {
        expect(request.tools.map((tool) => tool.name)).toContain('linkRegistry.resolveProducts');
        expect(request.tools.map((tool) => tool.name)).toContain('rental.pricePreview');
        expect(request.tools.map((tool) => tool.name)).not.toContain('rental.priceApply');
        return JSON.stringify({
          goal: '所有 Ace Pro 2 商品整体价格打九折',
          steps: [
            { id: 'resolve', toolName: 'linkRegistry.resolveProducts', arguments: { query: 'acepro2' }, reason: '先解析商品名对应的端内ID集合' },
            { toolName: 'rental.pricePreview', arguments: { productIds: '${resolve.productIds}', discount: 0.9, scope: 'all_price_fields' }, reason: '对解析出的商品逐个生成改价审计预览' },
          ],
          confidence: 0.94,
          reason: '用户要求对一个商品组整体打九折，需要先解析集合再预览改价',
        });
      },
    };
    const previewCalls: unknown[] = [];
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview(request) {
        previewCalls.push(request);
        if (request.mode !== 'global_discount') throw new Error('expected global discount preview');
        return {
          productId: request.productId,
          fields: { rent1day: request.productId === '841' ? '90.00' : '81.00' },
          lines: ['preview: ok'],
          warnings: [],
          audit: { taskId: `task_${request.productId}_preview`, rollbackFile: `rollback-${request.productId}.json`, hasErrors: false },
        };
      },
      async execute() { throw new Error('execute should not run before confirmation'); },
      async copy() { throw new Error('copy should not run'); },
      async delist() { throw new Error('delist should not run'); },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '所有acepro2,整体价格打九折' }, outputDir, {
      agentPlannerProvider: planner,
      rentalPriceClient,
      closedOrderRegistryPaths: registryPaths,
    });

    expect(previewCalls).toEqual([
      { mode: 'global_discount', productId: '841', discount: 0.9, scope: 'rent_fields' },
      { mode: 'global_discount', productId: '842', discount: 0.9, scope: 'rent_fields' },
    ]);
    expect(response.text).toContain('步骤 1/2：linkRegistry.resolveProducts');
    expect(response.text).toContain('步骤 2/2：rental.pricePreview');
    expect(response.text).toContain('链接数量：2 条');
    expect(response.text).toContain('端内ID：841、842');
    expect(JSON.stringify(response.card)).toContain('agent_tool_confirm');
    expect(JSON.stringify(response.card)).toContain('rental.priceApply');
    const confirmRequest = await loadAgentToolConfirmRequestFromCard(outputDir, response.card);
    expect(confirmRequest.toolName).toBe('rental.priceApply');
    expect((confirmRequest.arguments.items as Array<{ productId: string }>).map((item) => item.productId)).toEqual(['841', '842']);
  });

  it('keeps explicit internal-id price changes scoped to that single product', async () => {
    const outputDir = await writeContext();
    const registryRoot = await mkdtemp(join(tmpdir(), 'mt-agent-explicit-price-registry-'));
    const registryPaths = await writePocket4PriceRegistryFixtures(registryRoot);
    const planner: AgentPlannerProvider = {
      async proposePlan() {
        return JSON.stringify({
          goal: '对端内ID 914 整体改价 0.99',
          steps: [
            { id: 'resolve', toolName: 'linkRegistry.resolveProducts', arguments: { query: '914' }, reason: '先解析用户给出的端内ID' },
            { toolName: 'rental.pricePreview', arguments: { productIds: '${resolve.productIds}', discount: 0.99, scope: 'all_price_fields' }, reason: '对指定端内ID生成租金字段改价预览' },
          ],
          confidence: 0.94,
          reason: '用户给出的是明确端内ID，整体改价只表示该商品租金字段',
        });
      },
    };
    const previewCalls: unknown[] = [];
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview(request) {
        previewCalls.push(request);
        if (request.mode !== 'global_discount') throw new Error('expected global discount preview');
        return {
          productId: request.productId,
          fields: { rent1day: '99.00' },
          lines: ['preview: ok'],
          warnings: [],
          audit: { taskId: `task_${request.productId}_preview`, rollbackFile: `rollback-${request.productId}.json`, hasErrors: false },
        };
      },
      async execute() { throw new Error('execute should not run before confirmation'); },
      async copy() { throw new Error('copy should not run'); },
      async delist() { throw new Error('delist should not run'); },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '914整体改价 0.99' }, outputDir, {
      agentPlannerProvider: planner,
      rentalPriceClient,
      closedOrderRegistryPaths: registryPaths,
    });

    expect(previewCalls).toEqual([
      { mode: 'global_discount', productId: '914', discount: 0.99, scope: 'rent_fields' },
    ]);
    expect(response.text).toContain('914');
    expect(response.text).not.toContain('915');
    expect(response.text).not.toContain('916');
    const confirmRequest = await loadAgentToolConfirmRequestFromCard(outputDir, response.card);
    expect(confirmRequest.toolName).toBe('rental.priceApply');
    expect((confirmRequest.arguments.items as Array<{ productId: string }>).map((item) => item.productId)).toEqual(['914']);
  });

  it('executes atomic rental.priceApply after confirmation and returns audit references', async () => {
    const calls: unknown[] = [];
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run after confirmation'); },
      async execute(request) {
        calls.push(request);
        return {
          productId: request.productId,
          ok: true,
          lines: ['apply: ok', 'submit: ok', 'verify: ok'],
          audit: { taskId: `task_${request.productId}_done`, status: 'completed', rollbackFile: `rollback-${request.productId}.json` },
        };
      },
      async copy() { throw new Error('copy should not run'); },
      async delist() { throw new Error('delist should not run'); },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };

    const response = await executeAgentToolRequest(
      {
        toolName: 'rental.priceApply',
        arguments: {
          items: [
            { productId: '841', fields: { rent1day: '90.00' }, audit: { taskId: 'task_841_preview', rollbackFile: 'rollback-841.json' } },
            { productId: '842', fields: { rent1day: '81.00' }, audit: { taskId: 'task_842_preview', rollbackFile: 'rollback-842.json' } },
          ],
        },
        reason: '用户确认对 Ace Pro 2 商品组整体打九折',
      },
      'output',
      { rentalPriceClient },
    );

    expect(calls).toEqual([
      { mode: 'explicit_fields', productId: '841', fields: { rent1day: '90.00' }, audit: { taskId: 'task_841_preview', rollbackFile: 'rollback-841.json' } },
      { mode: 'explicit_fields', productId: '842', fields: { rent1day: '81.00' }, audit: { taskId: 'task_842_preview', rollbackFile: 'rollback-842.json' } },
    ]);
    expect(response.text).toContain('改价执行完成：成功 2/2');
    expect(response.metadata).toMatchObject({
      toolName: 'rental.priceApply',
      ok: true,
      productIds: ['841', '842'],
      taskIds: ['task_841_done', 'task_842_done'],
      rollbackFiles: ['rollback-841.json', 'rollback-842.json'],
    });
  });

  it('returns a rollback confirmation card when a message contains rollback and an audit task id', async () => {
    const response = await handleBotIntent({ type: 'unknown', text: '回滚商品改价任务 task_1782451929574_977a5f62' }, 'output');

    expect(response.text).toContain('请确认 Agent 操作：rental.priceRollback');
    expect(JSON.stringify(response.card)).toContain('agent_tool_confirm');
    expect(JSON.stringify(response.card)).toContain('rental.priceRollback');
    expect(JSON.stringify(response.card)).toContain('task_1782451929574_977a5f62');
  });

  it('executes rental.priceRollback through the confirmed Agent tool path with task id only', async () => {
    const calls: unknown[] = [];
    const rentalPriceClient: RentalPriceSkillClient = {
      async preview() { throw new Error('preview should not run for rollback'); },
      async execute() { throw new Error('execute should not run for rollback'); },
      async rollback(request) {
        calls.push(request);
        return { productId: '761', ok: true, lines: ['rollbackApply: ok', 'submit: ok', 'verify: ok'] };
      },
      async copy() { throw new Error('copy should not run'); },
      async delist() { throw new Error('delist should not run'); },
      async tenancySet() { throw new Error('tenancySet should not run'); },
      async specDiscover() { throw new Error('specDiscover should not run'); },
      async specAddAndRefresh() { throw new Error('specAddAndRefresh should not run'); },
    };

    const response = await executeAgentToolRequest(
      { toolName: 'rental.priceRollback', arguments: { taskId: 'task_123_abcd1234' }, reason: '用户要求回滚改价任务' },
      'output',
      { rentalPriceClient },
    );

    expect(calls).toEqual([{ taskId: 'task_123_abcd1234' }]);
    expect(response.text).toContain('改价回滚成功：商品 761');
  });

  it('syncs closed-order feedback through the bot command', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-closed-order-bot-sync-'));
    const fetchImpl = async () => new Response(JSON.stringify({
      source_app_code: 'order_dispatch',
      items: [
        {
          id: 'close-1',
          order_no: 'SH202606220001',
          goods_id: '560',
          merchant: 'merchant-A',
          merchant_remark: '价格太低',
          captured_at: '2026-06-22T01:00:00Z',
          received_at: '2026-06-22T01:05:00Z',
        },
      ],
    }), { status: 200 });

    process.env.CLOSED_ORDER_REMARKS_BASE_URL = 'https://hub.leejh.cyou';
    process.env.CLOSED_ORDER_REMARKS_API_TOKEN = 'secret-token';
    process.env.CLOSED_ORDER_REMARKS_SOURCE_APP_CODE = 'order_dispatch';

    const response = await handleBotIntent({ type: 'sync_closed_order_feedback' }, outputDir, { closedOrderFetchImpl: fetchImpl as typeof fetch });
    expect(response.text).toContain('关单同步完成');
    expect(response.text).toContain('新增 1 条');
    expect(response.card).toBeUndefined();
    await expect(readFile(join(outputDir, 'state', 'closed-order-feedback-ingest.json'), 'utf8')).resolves.toContain('close:close-1');
  });

  it('runs a closed-order observation report directly from exact intent', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-closed-order-bot-report-'));
    const registryRoot = await mkdtemp(join(tmpdir(), 'mt-agent-closed-order-registry-'));
    const registryPaths = await writeClosedOrderRegistryFixtures(registryRoot);
    await mkdir(join(outputDir, 'state'), { recursive: true });
    await writeFile(join(outputDir, 'state', 'closed-order-feedback-ingest.json'), JSON.stringify({
      version: 1,
      items: [
        {
          dedupeKey: 'close:close-1',
          closeId: 'close-1',
          internalProductId: '560',
          rawRemark: '价格太低，不接单',
          closedAt: '2026-06-30T01:00:00.000Z',
          firstIngestedAt: '2026-06-30T01:05:00.000Z',
          lastIngestedAt: '2026-06-30T01:05:00.000Z',
          seenCount: 1,
        },
        {
          dedupeKey: 'close:close-2',
          closeId: 'close-2',
          internalProductId: '561',
          rawRemark: '库存不足',
          closedAt: '2026-06-29T08:00:00.000Z',
          firstIngestedAt: '2026-06-29T08:05:00.000Z',
          lastIngestedAt: '2026-06-29T08:05:00.000Z',
          seenCount: 1,
        },
      ],
    }), 'utf8');

    const response = await handleBotIntent({ type: 'run_closed_order_observation_report' }, outputDir, { closedOrderRegistryPaths: registryPaths });
    expect(response.text).toContain('关单观察');
    expect(response.text).toContain('报告已写入');
    expect(response.card).toBeDefined();
    expect(JSON.stringify(response.card)).toContain('重点分组');
    expect(JSON.stringify(response.card)).toContain('DJI Pocket 3');
    expect(JSON.stringify(response.card)).toContain('价格信号');
    const markdownPath = response.text.split('报告已写入：')[1]?.trim();
    expect(markdownPath).toBeTruthy();
    await expect(readFile(markdownPath!, 'utf8')).resolves.toContain('关单观察');
  });
});
