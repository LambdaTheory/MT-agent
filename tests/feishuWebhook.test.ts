import { describe, expect, it } from 'vitest';
import type { DailyReportData } from '../src/domain/types.js';
import { buildFeishuReportText, buildFeishuTestText, maybeSendFeishuReport, maybeSendFeishuTestMessage } from '../src/notify/feishuWebhook.js';

const report: DailyReportData = {
  date: '2026-06-08',
  incomplete: false,
  rawTables: [],
  analysisRows: [
    {
      productName: '商品A',
      platformProductId: '10001',
      internalProductId: '762',
      mappingStatus: 'mapped',
      metrics: { '1d': null, '7d': null, '30d': null },
      riskScore: 80,
      opportunityScore: 20,
      riskLevel: '高',
      opportunityLevel: '低',
      action: '疑似价格问题',
      confidence: '高',
      reason: '7天发货为0',
    },
    {
      productName: '商品B',
      platformProductId: '10002',
      internalProductId: '421',
      mappingStatus: 'mapped',
      metrics: { '1d': null, '7d': { productName: '商品B', platformProductId: '10002', visits: 80, createdOrders: 0, signedOrders: 0, reviewedOrders: 0, shippedOrders: 2 }, '30d': null },
      riskScore: 15,
      opportunityScore: 85,
      riskLevel: '低',
      opportunityLevel: '高',
      action: '建议补链',
      confidence: '高',
      reason: '低曝光但已有发货',
    },
  ],
};

describe('Feishu webhook notification', () => {
  it('builds an executive summary report text with planned operations', () => {
    const text = buildFeishuReportText(report, { markdownPath: 'output/report.md', workbookPath: 'output/report.xlsx' });

    expect(text).toContain('MT运营日报 2026-06-08');
    expect(text).toContain('今日结论');
    expect(text).toContain('高优先级：1个');
    expect(text).toContain('增长机会：1个');
    expect(text).toContain('未映射ID：0个');
    expect(text).toContain('拟执行运营操作');
    expect(text).toContain('1. 查价/调价：端内ID 762');
    expect(text).toContain('2. 补链/加曝光：端内ID 421');
    expect(text).toContain('重点商品');
    expect(text).toContain('端内ID 762｜疑似价格问题');
    expect(text).toContain('建议：检查价格、库存、履约竞争力');
    expect(text).toContain('Markdown：output/report.md');
    expect(text).toContain('XLSX：output/report.xlsx');
  });

  it('skips sending when webhook URL is missing', async () => {
    const result = await maybeSendFeishuReport('', report, { markdownPath: 'a.md', workbookPath: 'a.xlsx' });

    expect(result).toEqual({ sent: false, reason: 'missing webhook url' });
  });

  it('posts text payload to the configured webhook', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const result = await maybeSendFeishuReport('https://example.test/hook', report, { markdownPath: 'a.md', workbookPath: 'a.xlsx' }, async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return { ok: true, status: 200, text: async () => '{"code":0}' } as Response;
    });

    expect(result).toEqual({ sent: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://example.test/hook');
    expect(calls[0]?.body).toMatchObject({ msg_type: 'text' });
  });

  it('builds a connectivity test message', () => {
    expect(buildFeishuTestText()).toContain('MT-agent 飞书连通测试');
  });

  it('sends connectivity test message to webhook', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const result = await maybeSendFeishuTestMessage('https://example.test/hook', async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return { ok: true, status: 200, text: async () => '{"code":0}' } as Response;
    });

    expect(result).toEqual({ sent: true });
    expect(calls[0]?.body).toMatchObject({ msg_type: 'text' });
  });
});
