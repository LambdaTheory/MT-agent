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
    expect(text).toContain("import { loadProductIdMapping, type ProductIdMapping } from '../mapping/productIdMapping.js';");
    expect(text).toContain("import { loadProductNameMap } from '../publicTraffic/productDisplayName.js';");
    expect(text).toContain("import { buildInventorySameSkuSnapshot } from '../inventoryStatus/snapshot.js';");
    expect(text).toContain("import { writeInventorySameSkuSnapshot } from '../inventoryStatus/store.js';");
    expect(text).toContain("const productNameMap = await loadProductNameMap('config/product-name-map.json', (message) => log.addEvent(message));");
    expect(text).toContain('buildPublicTrafficCard(context,');
    expect(text).toContain('productNameMap,');
    expect(text).toContain('const registryContext = await writeInventorySameSkuSnapshotSafely({');
    expect(text).toContain('await writeInventorySameSkuSnapshot(sameSkuSnapshot, input.snapshotPath);');
    expect(text).toContain('inventory same-sku snapshot skipped:');
    expect(text).toContain('const sendTo = parseFeishuSendToArg(process.argv);');
    expect(text).toContain('sendFeishuCard(env, card, fallbackText)');
  });

  it('passes overview to analyzer and only skips same-day product exposure delta when the previous snapshot is missing', async () => {
    const text = await source('../src/cli/publicTrafficReport.ts');
    expect(text).toContain('const snapshotDate = daysBefore(date, 1);');
    expect(text).not.toContain('days <= 7');
    expect(text).toContain('const dailyDelta = previous.found ? computeExposureDailyDelta(dataDate, previous.products, crawlResult.products, mapping, { newProductPlatformIds: newGoodsPlatformIds }) : [];');
    expect(text).toContain('if (!previous.found) {');
    expect(text).toContain("log.addEvent('商品级曝光历史不足: 跳过商品级日差分');");
    expect(text).toContain("'1d': dailyDelta.map((row) => ({");
    expect(text).toContain('productName: row.productName,');
    expect(text).toContain('platformProductId: row.platformProductId,');
    expect(text).toContain('exposure: row.exposure,');
    expect(text).toContain('visits: row.visits,');
    expect(text).toContain('amount: row.amount,');
    expect(text).toContain('visitRate: row.exposure > 0 ? row.visits / row.exposure : 0,');
    expect(text).toContain('flags: row.flags,');
    expect(text).toContain("'7d': sevenDaySummary");
    expect(text).toContain("'30d': thirtyDaySummary");
    expect(text).not.toContain('const hasReliableExposureHistory = previousProducts.length > 0;');
    expect(text).not.toContain("'7d': hasReliableExposureHistory ? sevenDaySummary : []");
    expect(text).not.toContain("'30d': hasReliableExposureHistory ? thirtyDaySummary : []");
    expect(text).toContain('overview: crawlResult.overview');
  });

  it('bases exposure new_product flags on goods table first-seen state', async () => {
    const text = await source('../src/cli/publicTrafficReport.ts');
    expect(text).toContain('newGoodsPlatformIdsFromFirstSeen');
    expect(text).toContain('entry.firstSeenDate === currentDate');
    expect(text).toContain('newProductPlatformIds: newGoodsPlatformIds');
    expect(text).toContain('昨日漏抓=');
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

  it('CLI 在映射刷新后为商品总表注端内ID列', async () => {
    const text = await source('../src/cli/publicTrafficReport.ts');
    expect(text).toContain('annotateGoodsExportWorkbookWithInternalId');
    expect(text).toContain('商品总表端内ID列注入失败');
  });

  it('CLI writes exposure pagination diagnostics into the run log', async () => {
    const text = await source('../src/cli/publicTrafficReport.ts');
    expect(text).toContain('crawlResult.paginationStats');
    expect(text).toContain('曝光商品分页');
    expect(text).toContain('pageRowCounts');
    expect(text).toContain('duplicateProductRows');
  });

  it('CLI rejects unreliable previous exposure snapshots before computing daily product deltas', async () => {
    const text = await source('../src/cli/publicTrafficReport.ts');
    expect(text).toContain('MIN_RELIABLE_PREVIOUS_EXPOSURE_PRODUCTS');
    expect(text).toContain('昨日曝光商品快照不可靠');
    expect(text.indexOf('assertExposureSnapshotCoverage(crawlResult.products.length, previous.products.length, log);')).toBeLessThan(
      text.indexOf('const dailyDelta = previous.found ? computeExposureDailyDelta'),
    );
  });

  it('CLI keeps a latest run log for inspection', async () => {
    const cliText = await source('../src/cli/publicTrafficReport.ts');
    const pathsText = await source('../src/publicTraffic/paths.ts');
    expect(pathsText).toContain('latestLog');
    expect(pathsText).toContain('公域数据运行日志_latest.log');
    expect(cliText).toContain('const logText = log.toText();');
    expect(cliText).toContain('await writeFile(paths.latestLog, logText,');
  });

  it('paths 定义订单分析中文路径', async () => {
    const text = await source('../src/publicTraffic/paths.ts');
    expect(text).toContain('订单分析_');
  });
});
