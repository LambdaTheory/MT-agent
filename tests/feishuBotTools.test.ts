import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentPlannerProvider } from '../src/agentRuntime/planner.js';
import type { LlmIntentProposalProvider } from '../src/feishuBot/llmIntentProposal.js';
import type { LlmToolSelectionProvider } from '../src/feishuBot/llmProvider.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';
import { recordAgentLearningEvent } from '../src/agentLearning/store.js';
import { executeAgentToolRequest } from '../src/feishuBot/agentToolExecutor.js';
import { handleBotIntent } from '../src/feishuBot/tools.js';

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
    lifecycleGovernance: [],
    recommendedActions: [
      { identifier: '端内ID 565', action: '补曝光', reason: '曝光不足', priority: 'high' },
      { identifier: '端内ID 701', action: '新品维护', reason: '新链接池维护', priority: 'medium' },
    ],
    newProductPoolIds: ['701'],
    newProductPoolItems: [{ productId: '701', productName: '大疆 Pocket 3', shortTitle: '', submittedAt: '2026-06-11 09:00:00', merchant: '', alipaySyncStatus: '已同步', alipayCode: '', stock: 0, skuCount: 0, maintenanceStatus: '待维护', note: '' }],
    orderAnalysis: { runDate: '2026-06-11', pages: { overview: { label: '订单概览', dataDate: '2026-06-10', indicators: [{ label: '发货订单', value: '12' }] } } },
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

  await writeOne('2026-06-10', '2026-06-10', 321, '旧日期 Pocket3');
  await writeOne('2026-06-11', '2026-06-11', 999, '最新日期 Pocket3');
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

async function writeRankingRegistryFixtures(rootDir: string, artifactsDir: string): Promise<{
  productIdMapPath: string;
  productNameMapPath: string;
  firstSeenPath: string;
  lifecyclePath: string;
  overridesPath: string;
  artifactsDir: string;
}> {
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
    firstSeenPath: join(stateDir, 'goods-first-seen.json'),
    lifecyclePath: join(stateDir, 'goods-link-lifecycle.json'),
    overridesPath: join(configDir, 'link-registry-overrides.json'),
    artifactsDir,
  };
}

async function writeX200RankingRegistryFixtures(rootDir: string, artifactsDir: string): Promise<{
  productIdMapPath: string;
  productNameMapPath: string;
  firstSeenPath: string;
  lifecyclePath: string;
  overridesPath: string;
  artifactsDir: string;
}> {
  const configDir = join(rootDir, 'config');
  const stateDir = join(rootDir, 'output', 'state');
  await mkdir(configDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  await writeFile(join(configDir, 'product-id-map.json'), JSON.stringify({ p362: '362', p372: '372' }), 'utf8');
  await writeFile(join(configDir, 'product-name-map.json'), JSON.stringify({ '362': 'vivo X200 Ultra', '372': 'vivo 蔡司增距镜' }), 'utf8');
  await writeFile(join(configDir, 'link-registry-overrides.json'), JSON.stringify({ version: 1, entries: [] }), 'utf8');
  return {
    productIdMapPath: join(configDir, 'product-id-map.json'),
    productNameMapPath: join(configDir, 'product-name-map.json'),
    firstSeenPath: join(stateDir, 'goods-first-seen.json'),
    lifecyclePath: join(stateDir, 'goods-link-lifecycle.json'),
    overridesPath: join(configDir, 'link-registry-overrides.json'),
    artifactsDir,
  };
}

async function writeX200PriceSnapshotRegistryFixtures(rootDir: string): Promise<{
  productIdMapPath: string;
  productNameMapPath: string;
  firstSeenPath: string;
  lifecyclePath: string;
  overridesPath: string;
  artifactsDir: string;
}> {
  const configDir = join(rootDir, 'config');
  const outputDir = join(rootDir, 'output');
  const stateDir = join(outputDir, 'state');
  await mkdir(configDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  await writeFile(join(configDir, 'product-id-map.json'), JSON.stringify({ p362: '362', p363: '363' }), 'utf8');
  await writeFile(join(configDir, 'product-name-map.json'), JSON.stringify({ '362': 'vivo X200 Ultra 黑色', '363': 'vivo X200 Ultra 蓝色' }), 'utf8');
  await writeFile(join(configDir, 'link-registry-overrides.json'), JSON.stringify({
    version: 1,
    entries: [
      { internalProductId: '362', productName: 'vivo X200 Ultra 黑色', shortName: 'vivo X200 Ultra', aliases: ['x200u', 'X200U'], sameSkuGroupId: 'vivo-x200-ultra', updatedAt: '2026-06-26' },
      { internalProductId: '363', productName: 'vivo X200 Ultra 蓝色', shortName: 'vivo X200 Ultra', aliases: ['x200u', 'X200U'], sameSkuGroupId: 'vivo-x200-ultra', updatedAt: '2026-06-26' },
    ],
    sameSkuGroupAliasRules: [{ sameSkuGroupId: 'vivo-x200-ultra', aliases: ['x200u', 'X200U'] }],
  }), 'utf8');
  return {
    productIdMapPath: join(configDir, 'product-id-map.json'),
    productNameMapPath: join(configDir, 'product-name-map.json'),
    firstSeenPath: join(stateDir, 'goods-first-seen.json'),
    lifecyclePath: join(stateDir, 'goods-link-lifecycle.json'),
    overridesPath: join(configDir, 'link-registry-overrides.json'),
    artifactsDir: outputDir,
  };
}

async function writeClosedOrderRegistryFixtures(rootDir: string): Promise<{
  productIdMapPath: string;
  productNameMapPath: string;
  firstSeenPath: string;
  lifecyclePath: string;
  overridesPath: string;
  artifactsDir: string;
}> {
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
    firstSeenPath: join(outputDir, 'state', 'goods-first-seen.json'),
    lifecyclePath: join(outputDir, 'state', 'goods-link-lifecycle.json'),
    overridesPath: join(configDir, 'link-registry-overrides.json'),
    artifactsDir: outputDir,
  };
}

async function writeLinkRegistryOverviewFixtures(rootDir: string): Promise<{
  productIdMapPath: string;
  productNameMapPath: string;
  firstSeenPath: string;
  lifecyclePath: string;
  overridesPath: string;
  artifactsDir: string;
}> {
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
    firstSeenPath: join(outputDir, 'state', 'goods-first-seen.json'),
    lifecyclePath: join(outputDir, 'state', 'goods-link-lifecycle.json'),
    overridesPath: join(configDir, 'link-registry-overrides.json'),
    artifactsDir: outputDir,
  };
}

async function writeInventoryStatusFixtures(rootDir: string): Promise<{
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
      firstSeenPath: join(stateDir, 'goods-first-seen.json'),
      lifecyclePath: join(stateDir, 'goods-link-lifecycle.json'),
      overridesPath: join(configDir, 'link-registry-overrides.json'),
      artifactsDir: outputDir,
    },
  };
}

async function writeNewLinkWorkflowContext(): Promise<{
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
      firstSeenPath: join(stateDir, 'goods-first-seen.json'),
      lifecyclePath: join(stateDir, 'goods-link-lifecycle.json'),
      overridesPath: join(configDir, 'link-registry-overrides.json'),
      artifactsDir: outputDir,
    },
  };
}

describe('handleBotIntent', () => {
  it('returns help text', async () => {
    await expect(handleBotIntent({ type: 'help' })).resolves.toEqual({ text: `📋 查询与分析
  今日概况 — 查看最新公域日报概况
  看 2026-06-22 的日报 / 查昨天日报 — 查看指定日期公域日报
  查询 565 / 查 433,798 — 查询单个或多个端内ID表现
  2026-06-22 查询 733 — 查询指定日期的商品表现
  s23u最好的链接是哪条 — 按链接档案找同款组里数据最好的端内ID
  x200u的定价情况怎么样 — 按同款组汇总SKU平均租金
  查ID 565 / 商品ID互查 — 端内ID与平台商品ID互查
  库存情况 / 库存情况 pocket3 — 查看库存与同款组状态
  新链接池怎么样 / 待处理任务 / 下架链接 / 订单情况 — 查询运营数据池

📊 报表与数据
  跑日报 — 生成公域流量日报
  抓取访问页数据 — 补抓访问页/后链路数据
  重发日报 — 重新发送最新日报
  推送日报到群 — 推送日报到指定群
  同步关单 — 拉取最新关单并写入本地状态
  跑关单观察 — 生成关单观察摘要并回卡片

🤖 复合目标
  数据最好的SQ1是哪条？按这个ID复制5条新链
  数据最好的wide300、wide400分别复制5条新链
  刷新活跃度 — 这类高风险批量运营动作会先生成计划/澄清，不会直接执行

🎓 运营学习
  运营学习 — 开始运营学习测验
  运营学习汇总 / 运营学习历史 — 查看测验反馈汇总或历史统计
  Agent学习汇总 — 查看 Agent 澄清与确认学习记录

💰 改价、审计与回滚
  876 全局改价 0.9 — 生成改价审计预览和确认卡
  改价 761 1天22 10天55 — 指定租期改价
  改价 761 所有价格 *0.9 — 所有价格乘法（含押金、成本等）
  回滚 task_xxxx — 按改价审计任务回滚到该任务执行前

🔧 商品操作
  复制商品 761 / 从端内ID 848复制3条新链 — 复制或铺新链
  下架商品 761 — 下架商品
  设置租期 761 1,10,30 — 设置租期天数
  查看规格 761 — 查看商品规格维度与项目
  添加规格 761 128G — 添加规格项

🛡️ 安全规则
  写操作会先弹确认卡；取消后不会执行
  商品ID、数量、规格层级不明确时会先澄清
  Agent学习汇总 — 查看 Agent 澄清与确认学习记录
  帮助 — 显示此帮助信息` });
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
    await expect(handleBotIntent({ type: 'unknown', text: '订单情况' }, outputDir)).resolves.toMatchObject({ text: expect.stringContaining('发货订单：12') });
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
      text: '我现在可以查：今日概况、商品、新链接池、待处理任务、转化差、曝光低、高潜力、下架链接、订单情况。你可以问“新链接池怎么样”或“查一下721”。',
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
        expect(request.workflows.map((workflow) => workflow.name)).toContain('rental.newLinkBatch');
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

  it('returns confirmation cards for exact report write operations', async () => {
    const runReport = await handleBotIntent({ type: 'run_public_traffic_report' }, 'output');
    expect(runReport.text).toContain('请确认 Agent 操作：publicTraffic.runReport');
    expect(JSON.stringify(runReport.card)).toContain('agent_tool_confirm');

    const refreshDashboard = await handleBotIntent({ type: 'refresh_public_traffic_dashboard', sendTo: 'group' }, 'output');
    expect(refreshDashboard.text).toContain('请确认 Agent 操作：publicTraffic.refreshDashboard');
    expect(JSON.stringify(refreshDashboard.card)).toContain('agent_tool_confirm');
    expect(JSON.stringify(refreshDashboard.card)).toContain('"sendTo":"group"');

    const resend = await handleBotIntent({ type: 'resend_latest_report', sendTo: 'both' }, 'output');
    expect(resend.text).toContain('请确认 Agent 操作：publicTraffic.resendLatestReport');
    expect(JSON.stringify(resend.card)).toContain('"sendTo":"both"');
  });

  it('plans new-link batch workflows through LLM without copying before confirmation', async () => {
    const { outputDir, registryPaths } = await writeNewLinkWorkflowContext();
    const planner: AgentPlannerProvider = {
      async proposePlan(request) {
        expect(request.workflows.map((workflow) => workflow.name)).toContain('rental.newLinkBatch');
        return JSON.stringify({
          goal: '铺设 pocket3 新链',
          selectedWorkflow: 'rental.newLinkBatch',
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
          selectedWorkflow: 'rental.newLinkBatch',
          arguments: { keyword: 'pocket3', count: 3 },
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

  it('turns a best-link follow-up copy command into a new-link confirmation card without executing', async () => {
    const { outputDir, registryPaths } = await writeNewLinkWorkflowContext();
    const planner: AgentPlannerProvider = {
      async proposePlan(request) {
        expect(request.message).toBe('数据最好的SQ1的端内id是多少?按这个id复制5条新链');
        return JSON.stringify({
          goal: '按 SQ1 最佳链接复制 5 条新链',
          selectedWorkflow: 'rental.newLinkBatch',
          arguments: { keyword: 'SQ1', count: 5 },
          confidence: 0.95,
          reason: '用户要求先找到 SQ1 表现最好的链接，再按该链接复制 5 条新链',
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

  it('turns multiple best-link follow-up copy commands into one multi-source confirmation card without executing', async () => {
    const { outputDir, registryPaths } = await writeNewLinkWorkflowContext();
    const planner: AgentPlannerProvider = {
      async proposePlan(request) {
        expect(request.message).toBe('数据最好的wide 300,wide 400的端内id是多少?分别按这个id复制5条新。');
        return JSON.stringify({
          goal: '分别按 wide 300 和 wide 400 最佳链接复制新链',
          selectedWorkflow: 'rental.newLinkBatch',
          arguments: { items: [{ keyword: 'wide 300', count: 5 }, { keyword: 'wide 400', count: 5 }] },
          confidence: 0.95,
          reason: '用户要求分别找到 wide 300、wide 400 的最佳链接，并各复制 5 条新链',
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

  it('does not fall through to read-only new product pool when the LLM planner fails a new-link write plan', async () => {
    const outputDir = await writeContext();
    const planner: AgentPlannerProvider = {
      async proposePlan() {
        return '{"goal":"bad","selectedWorkflow":"rental.newLinkBatch","arguments":{"keyword":"pocket3","count":"10"},"confidence":0.9,"reason":"bad"}';
      },
    };

    const response = await handleBotIntent({ type: 'unknown', text: '帮我铺十条 pocket3 的新链' }, outputDir, {
      agentPlannerProvider: planner,
    });

    expect(response.text).toContain('Agent planner 没有生成有效');
    expect(response.text).toContain('本次不执行');
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
    expect(JSON.stringify(response.card)).not.toContain('agent_tool_confirm');
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
    expect(response.text).toContain('请确认 Agent 操作：closedOrder.syncFeedback');
    expect(response.card).toBeDefined();
    expect(JSON.stringify(response.card)).toContain('agent_tool_confirm');
    expect(JSON.stringify(response.card)).toContain('closedOrder.syncFeedback');

    const executed = await executeAgentToolRequest(
      { toolName: 'closedOrder.syncFeedback', arguments: {}, reason: '测试确认同步关单' },
      outputDir,
      { closedOrderFetchImpl: fetchImpl as typeof fetch },
    );
    expect(executed.text).toContain('关单同步完成');
    expect(executed.text).toContain('新增 1 条');
    await expect(readFile(join(outputDir, 'state', 'closed-order-feedback-ingest.json'), 'utf8')).resolves.toContain('close:close-1');
  });

  it('returns a confirmation card before running the closed-order observation report', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-closed-order-bot-report-confirm-'));

    const response = await handleBotIntent({ type: 'run_closed_order_observation_report' }, outputDir);
    expect(response.text).toContain('请确认 Agent 操作：closedOrder.runObservationReport');
    expect(response.card).toBeDefined();
    expect(JSON.stringify(response.card)).toContain('agent_tool_confirm');
    expect(JSON.stringify(response.card)).toContain('closedOrder.runObservationReport');
  });

  it('runs a closed-order observation report after Agent confirmation', async () => {
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
          closedAt: '2026-06-22T01:00:00.000Z',
          firstIngestedAt: '2026-06-22T01:05:00.000Z',
          lastIngestedAt: '2026-06-22T01:05:00.000Z',
          seenCount: 1,
        },
        {
          dedupeKey: 'close:close-2',
          closeId: 'close-2',
          internalProductId: '561',
          rawRemark: '库存不足',
          closedAt: '2026-06-21T08:00:00.000Z',
          firstIngestedAt: '2026-06-21T08:05:00.000Z',
          lastIngestedAt: '2026-06-21T08:05:00.000Z',
          seenCount: 1,
        },
      ],
    }), 'utf8');

    const response = await executeAgentToolRequest(
      { toolName: 'closedOrder.runObservationReport', arguments: {}, reason: '测试确认生成关单观察' },
      outputDir,
      { closedOrderRegistryPaths: registryPaths },
    );
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
