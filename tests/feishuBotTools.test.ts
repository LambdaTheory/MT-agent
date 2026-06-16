import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { handleBotIntent } from '../src/feishuBot/tools.js';
import type { LlmToolSelectionProvider } from '../src/feishuBot/llmProvider.js';

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
    recommendedActions: [],
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
    await expect(handleBotIntent({ type: 'help' })).resolves.toEqual({ text: '可用命令：今日概况｜查询 565｜查ID 565｜商品ID互查｜运营学习｜跑日报｜重发日报｜推送日报到群｜帮助' });
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
});
