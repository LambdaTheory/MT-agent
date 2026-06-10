import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function source(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

describe('public traffic CLI wiring', () => {
  it('crawls both exposure page and dashboard page before report generation', async () => {
    const text = await source('../src/cli/publicTrafficReport.ts');
    expect(text).toContain("import { crawlDashboard } from '../crawler/dashboardCrawler.js';");
    expect(text).toContain('const rawTables = await crawlDashboard(config);');
    expect(text.indexOf('const rawTables = await crawlDashboard(config);')).toBeLessThan(text.indexOf('mergePublicTrafficData({'));
  });

  it('loads product mapping and sends a Feishu card', async () => {
    const text = await source('../src/cli/publicTrafficReport.ts');
    expect(text).toContain("import { loadProductIdMapping } from '../mapping/productIdMapping.js';");
    expect(text).toContain('buildPublicTrafficCard(context,');
    expect(text).toContain('sendFeishuCard(process.env, card, fallbackText)');
  });

  it('passes overview to analyzer and skips product exposure aggregation without history', async () => {
    const text = await source('../src/cli/publicTrafficReport.ts');
    expect(text).toContain('const hasReliableExposureHistory = previousProducts.length > 0;');
    expect(text).toContain("log.addEvent('商品级曝光历史不足: 跳过商品级曝光聚合');");
    expect(text).toContain("'1d': hasReliableExposureHistory");
    expect(text).toContain("'7d': hasReliableExposureHistory ? sevenDaySummary : []");
    expect(text).toContain("'30d': hasReliableExposureHistory ? thirtyDaySummary : []");
    expect(text).toContain('overview: crawlResult.overview');
  });
});
