import type { AgentConfig, RawTableData } from '../domain/types.js';
import { collectDashboardPage } from './dashboardCrawler.js';
import { collectExposurePage, type ExposureCrawlResult } from './exposureCrawler.js';
import { shouldKeepBrowserOpenOnFailure } from './failureHandling.js';
import { collectGoodsExportPage } from './goodsExportCrawler.js';
import { ensureAuthenticatedMerchantSession } from './merchantSession.js';
import { collectOrderAnalysisPages } from './orderAnalysisCrawler.js';
import type { OrderAnalysisCapture } from '../publicTraffic/orderAnalysis.js';

export interface PublicTrafficSourcesCrawlResult {
  goodsExportPath: string;
  exposure: ExposureCrawlResult;
  dashboard: RawTableData[];
  orderAnalysis: OrderAnalysisCapture;
}

export async function crawlPublicTrafficSources(config: AgentConfig, goodsExportPath: string): Promise<PublicTrafficSourcesCrawlResult> {
  const { browser, page } = await ensureAuthenticatedMerchantSession(config, { acceptDownloads: true, stage: 'public-traffic-full' });
  let completed = false;

  try {
    await collectGoodsExportPage(config, browser, page, goodsExportPath);
    const exposure = await collectExposurePage(config, page);
    const dashboard = await collectDashboardPage(config, page);
    const orderAnalysis = await collectOrderAnalysisPages(config, page);

    completed = true;
    return { goodsExportPath, exposure, dashboard, orderAnalysis };
  } finally {
    if (completed || !shouldKeepBrowserOpenOnFailure(process.env.MT_AGENT_KEEP_BROWSER_ON_FAILURE)) {
      await browser.close();
    } else {
      console.error('公域流量抓取失败；保留浏览器窗口供检查。');
    }
  }
}
