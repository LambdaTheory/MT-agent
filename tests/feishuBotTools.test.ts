import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
    rows: [{ productName: 'iPhone 15', platformProductId: '2000000000000000000001', displayProductId: '端内ID 565', custodyDays: 10, periods: { '1d': metric, '7d': metric, '30d': metric } }],
    lowExposure: [{ identifier: '端内ID 565', action: '补曝光', reason: '曝光不足' }],
    weakClick: [],
    weakConversion: [{ identifier: '端内ID 565', action: '提转化', reason: '访问多成交少' }],
    highPotential: [{ identifier: '端内ID 566', action: '继续放量', reason: '高潜力' }],
    newProductObservation: [],
    lifecycleGovernance: [],
    recommendedActions: [],
    newProductPoolIds: ['701'],
    agentData: { removedLinks: [{ productId: '701', platformProductId: 'p701', productName: '已下架链接', removedDate: '2026-06-12', reason: '商品总表缺失', source: 'goods_snapshot_diff' }] },
    emptySectionNotes: {},
  }));
  return dir;
}

describe('handleBotIntent', () => {
  it('returns help text', async () => {
    await expect(handleBotIntent({ type: 'help' })).resolves.toEqual({ text: '可用命令：今日概况｜查询 565｜跑日报｜重发日报｜帮助' });
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

  it('answers removed-link questions through agent data understanding', async () => {
    const outputDir = await writeContext();
    const response = await handleBotIntent({ type: 'unknown', text: '下架链接有哪些' }, outputDir);
    expect(response.text).toContain('701');
    expect(response.text).toContain('商品总表缺失');
    expect(response.text).toContain('2026-06-12');
  });
});
