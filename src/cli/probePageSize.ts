import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { loadConfig } from '../config/loadConfig.js';
import { clearBrowserProfileLocks, prepareDashboardPage } from '../crawler/browserProfile.js';
import { selectSubAccountIfNeeded } from '../crawler/dashboardCrawler.js';
import { notifyLoginRequired } from '../crawler/loginNotification.js';
import { waitForDashboardAfterLogin, waitForSettledLoginState } from '../crawler/loginState.js';
import { chooseBestPageSizeProbe, probePageSizeCandidates } from '../crawler/pageSizeProbe.js';

const CANDIDATES = [100, 50, 20, 10];

export async function runProbePageSizeCli(): Promise<void> {
  const config = await loadConfig();
  await mkdir(config.browserProfileDir, { recursive: true });
  await clearBrowserProfileLocks(config.browserProfileDir);

  const browser = await chromium.launchPersistentContext(config.browserProfileDir, { headless: false });
  const page = await prepareDashboardPage(browser.pages(), () => browser.newPage());

  try {
    await page.goto(config.targetUrl, { waitUntil: 'domcontentloaded' });
    const loginState = await waitForSettledLoginState(page, { timeoutMs: 60000, intervalMs: 1000 });
    if (loginState === 'login-page') {
      await notifyLoginRequired({ page, stage: 'page-size-probe', outputDir: config.outputDir, log: console.log });
      await waitForDashboardAfterLogin(page);
    }

    await selectSubAccountIfNeeded(page);
    await page.waitForSelector('.ant-table table', { timeout: 180000 });

    const results = await probePageSizeCandidates(page, CANDIDATES);
    const best = chooseBestPageSizeProbe(results);
    const text = [
      `Page size probe candidates: ${CANDIDATES.join(', ')}`,
      ...results.map((result) =>
        `[${result.size}] ok=${result.ok} actual=${result.actualSize ?? 'unknown'} rows=${result.rowCount}${result.error ? ` error=${result.error}` : ''}`,
      ),
      `Best page size: ${best?.size ?? 'none'}`,
    ].join('\n');

    console.log(text);
    await mkdir('output/latest', { recursive: true });
    await writeFile('output/latest/page-size-probe.log', `${text}\n`, 'utf8');
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runProbePageSizeCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
