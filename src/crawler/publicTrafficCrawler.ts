import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import type { AgentConfig, RawTableData } from '../domain/types.js';
import { clearBrowserProfileLocks, prepareDashboardPage } from './browserProfile.js';
import { collectDashboardPage } from './dashboardCrawler.js';
import { collectExposurePage, type ExposureCrawlResult } from './exposureCrawler.js';
import { shouldKeepBrowserOpenOnFailure } from './failureHandling.js';

export interface PublicTrafficSourcesCrawlResult {
  exposure: ExposureCrawlResult;
  dashboard: RawTableData[];
}

export async function crawlPublicTrafficSources(config: AgentConfig): Promise<PublicTrafficSourcesCrawlResult> {
  await mkdir(config.browserProfileDir, { recursive: true });
  await clearBrowserProfileLocks(config.browserProfileDir);
  const browser = await chromium.launchPersistentContext(config.browserProfileDir, { headless: false });
  const page = await prepareDashboardPage(browser.pages(), () => browser.newPage());
  let completed = false;

  try {
    const exposure = await collectExposurePage(config, page);
    const dashboard = await collectDashboardPage(config, page);

    completed = true;
    return { exposure, dashboard };
  } finally {
    if (completed || !shouldKeepBrowserOpenOnFailure(process.env.MT_AGENT_KEEP_BROWSER_ON_FAILURE)) {
      await browser.close();
    } else {
      console.error('公域流量抓取失败；保留浏览器窗口供检查。');
    }
  }
}
