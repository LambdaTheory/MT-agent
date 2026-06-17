import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { handleBotIntent } from '../src/feishuBot/tools.js';
import type { LlmToolSelectionProvider } from '../src/feishuBot/llmProvider.js';
import type { LlmIntentProposalProvider } from '../src/feishuBot/llmIntentProposal.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

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
});
