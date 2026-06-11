import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function source(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

describe('public traffic CLI wiring', () => {
  it('crawls both exposure page and dashboard page before report generation', async () => {
    const text = await source('../src/cli/publicTrafficReport.ts');
    expect(text).toContain("import { crawlPublicTrafficSources } from '../crawler/publicTrafficCrawler.js';");
    expect(text).not.toContain("import { crawlDashboard } from '../crawler/dashboardCrawler.js';");
    expect(text).not.toContain("import { crawlExposurePage } from '../crawler/exposureCrawler.js';");
    expect(text).toContain('const { goodsExportPath, exposure: crawlResult, dashboard: rawTables, orderAnalysis: orderAnalysisCapture } = await crawlPublicTrafficSources(config, paths.goodsExportWorkbook);');
    expect(text).not.toContain('await crawlExposurePage(config)');
    expect(text).not.toContain('await crawlDashboard(config)');
    expect(text.indexOf('const { goodsExportPath, exposure: crawlResult, dashboard: rawTables, orderAnalysis: orderAnalysisCapture } = await crawlPublicTrafficSources(config, paths.goodsExportWorkbook);')).toBeLessThan(
      text.indexOf('mergePublicTrafficData({'),
    );
    expect(text).toContain('await refreshProductIdMappingForReport(goodsExportPath, mappingPath, paths.productIdMappingSyncLog, log);');
  });

  it('loads product mapping and sends a Feishu card', async () => {
    const text = await source('../src/cli/publicTrafficReport.ts');
    expect(text).toContain("import { loadProductIdMapping } from '../mapping/productIdMapping.js';");
    expect(text).toContain('buildPublicTrafficCard(context,');
    expect(text).toContain('const sendTo = parseFeishuSendToArg(process.argv);');
    expect(text).toContain('sendFeishuCard(env, card, fallbackText)');
  });

  it('passes overview to analyzer and only skips same-day product exposure delta when the previous snapshot is missing', async () => {
    const text = await source('../src/cli/publicTrafficReport.ts');
    expect(text).toContain('const dailyDelta = previous.found ? computeExposureDailyDelta(dataDate, previous.products, crawlResult.products) : [];');
    expect(text).toContain('if (!previous.found) {');
    expect(text).toContain("log.addEvent('商品级曝光历史不足: 跳过商品级日差分');");
    expect(text).toContain("'1d': dailyDelta.map((row) => ({");
    expect(text).toContain("'7d': sevenDaySummary");
    expect(text).toContain("'30d': thirtyDaySummary");
    expect(text).not.toContain('const hasReliableExposureHistory = previousProducts.length > 0;');
    expect(text).not.toContain("'7d': hasReliableExposureHistory ? sevenDaySummary : []");
    expect(text).not.toContain("'30d': hasReliableExposureHistory ? thirtyDaySummary : []");
    expect(text).toContain('overview: crawlResult.overview');
  });

  it('crawler 接入订单分析抓取', async () => {
    const text = await source('../src/crawler/publicTrafficCrawler.ts');
    expect(text).toContain('collectOrderAnalysisPages');
    expect(text).toContain('orderAnalysis');
  });

  it('CLI 落盘订单分析 JSON 并传入分析上下文', async () => {
    const text = await source('../src/cli/publicTrafficReport.ts');
    expect(text).toContain('paths.orderAnalysis');
    expect(text).toContain('${latestDir}/order-analysis.json');
    expect(text).toContain('orderAnalysis,');
  });

  it('paths 定义订单分析中文路径', async () => {
    const text = await source('../src/publicTraffic/paths.ts');
    expect(text).toContain('订单分析_');
  });
});
