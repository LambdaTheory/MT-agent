import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentPlannerProvider } from '../src/agentRuntime/planner.js';
import type { LlmIntentProposalProvider } from '../src/feishuBot/llmIntentProposal.js';
import type { LlmToolSelectionProvider } from '../src/feishuBot/llmProvider.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';
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

async function writeClosedOrderRegistryFixtures(rootDir: string): Promise<{
  productIdMapPath: string;
  productNameMapPath: string;
  firstSeenPath: string;
  lifecyclePath: string;
  artifactsDir: string;
}> {
  const configDir = join(rootDir, 'config');
  const outputDir = join(rootDir, 'output');
  await mkdir(configDir, { recursive: true });
  await mkdir(join(outputDir, 'state'), { recursive: true });
  await mkdir(join(outputDir, '2026-06-21'), { recursive: true });
  await writeFile(join(configDir, 'product-id-map.json'), JSON.stringify({ 'platform-560': '560', 'platform-561': '561' }), 'utf8');
  await writeFile(join(configDir, 'product-name-map.json'), JSON.stringify({ '560': 'DJI Pocket 3', '561': 'DJI Pocket 3 Creator' }), 'utf8');
  await writeFile(join(outputDir, '2026-06-21', 'exposure-cumulative-products.json'), JSON.stringify([
    { platformProductId: 'platform-560', productName: 'DJI Pocket 3 Creator Combo' },
    { platformProductId: 'platform-561', productName: 'DJI Pocket 3 Standard' },
  ]), 'utf8');
  return {
    productIdMapPath: join(configDir, 'product-id-map.json'),
    productNameMapPath: join(configDir, 'product-name-map.json'),
    firstSeenPath: join(outputDir, 'state', 'goods-first-seen.json'),
    lifecyclePath: join(outputDir, 'state', 'goods-link-lifecycle.json'),
    artifactsDir: outputDir,
  };
}

async function writeNewLinkWorkflowContext(): Promise<{
  outputDir: string;
  registryPaths: {
    productIdMapPath: string;
    productNameMapPath: string;
    firstSeenPath: string;
    lifecyclePath: string;
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
  }), 'utf8');
  await writeFile(join(configDir, 'product-name-map.json'), JSON.stringify({
    '733': '大疆 Pocket3',
    '875': 'DJI Pocket 3',
    '841': '佳能 R50',
  }), 'utf8');
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
      artifactsDir: outputDir,
    },
  };
}

describe('handleBotIntent', () => {
  it('returns help text', async () => {
    await expect(handleBotIntent({ type: 'help' })).resolves.toEqual({ text: `📋 数据查询
  今日概况 — 查看今日公域流量概况
  查询 565 — 按关键词查询商品
  查ID 565 — 端内ID与平台商品ID互查
  商品ID互查 — 打开常驻ID互查卡片
  查看规格 761 — 查看商品规格维度与项目

📊 报表操作
  跑日报 — 生成公域流量日报
  重发日报 — 重新发送最新日报
  推送日报到群 — 推送日报到指定群
  同步关单 — 拉取最新关单并写入本地状态
  跑关单观察 — 生成关单观察摘要并回卡片

🎓 运营学习
  运营学习 — 开始运营学习测验

💰 租赁改价
  改价 761 1天22 10天55 — 指定租期改价（格式：改价 ID 租期1价格1 租期2价格2 ...）
  改价 761 全局改价 0.9 — 全局折扣（所有租金字段 ×0.9）
  改价 761 全部租金九折 — 全部租金九折
  改价 761 所有价格 *0.9 — 所有价格乘法（含押金、成本等）

🔧 商品操作
  复制商品 761 — 复制商品
  下架商品 761 — 下架商品
  设置租期 761 1,10,30 — 设置租期天数
  添加规格 761 128G — 添加规格项

❓ 帮助
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

  it('answers latest summary from report context', async () => {
    const outputDir = await writeContext();
    const response = await handleBotIntent({ type: 'latest_summary' }, outputDir);
    expect(response.text).toContain('公域日报 2026-06-11');
    expect(response.text).toContain('曝光 1000');
  });

  it('answers product query from report context', async () => {
    const outputDir = await writeContext();
    const response = await handleBotIntent({ type: 'query_product', keyword: '565' }, outputDir);
    expect(response.text).toContain('端内ID 565 iPhone 15');
    expect(response.text).toContain('1日：曝光 10');
  });

  it('answers numeric product query with only the exact product id', async () => {
    const outputDir = await writeContext();
    const response = await handleBotIntent({ type: 'query_product', keyword: '733' }, outputDir);
    expect(response.text).toContain('端内ID 733 大疆DJI Pocket3云台相机128G');
    expect(response.text).not.toContain('端内ID 649');
    expect(response.text).not.toContain('端内ID 841');
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

  it('turns high-risk generic agent plans into approval cards without side effects', async () => {
    const planner: AgentPlannerProvider = {
      async proposePlan(request) {
        expect(request.tools.map((tool) => tool.name)).toContain('rental.operationConfirmRequest');
        return JSON.stringify({
          goal: '下架租赁商品',
          selectedTool: 'rental.operationConfirmRequest',
          arguments: { action: 'delist', productId: '761' },
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

    expect(response.text).toContain('请确认 Agent 操作：rental.operationConfirmRequest');
    expect(response.card).toBeDefined();
    expect(JSON.stringify(response.card)).toContain('agent_tool_confirm');
    expect(JSON.stringify(response.card)).toContain('delist');
    expect(JSON.stringify(response.card)).toContain('761');
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
    await expect(readFile(join(outputDir, 'state', 'closed-order-feedback-ingest.json'), 'utf8')).resolves.toContain('close:close-1');
  });

  it('returns a closed-order observation card through the bot command', async () => {
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

    const response = await handleBotIntent(
      { type: 'run_closed_order_observation_report' },
      outputDir,
      { closedOrderRegistryPaths: registryPaths },
    );
    expect(response.text).toContain('关单观察');
    expect(response.text).toContain('报告已写入');
    expect(response.card).toBeDefined();
    expect(JSON.stringify(response.card)).toContain('重点分组');
    expect(JSON.stringify(response.card)).toContain('DJI Pocket 3');
    expect(JSON.stringify(response.card)).toContain('价格信号');
    await expect(readFile(join(outputDir, 'closed-order-observation', 'closed-order-observation-2026-06-22.md'), 'utf8')).resolves.toContain('关单观察 2026-06-22');
  });
});
