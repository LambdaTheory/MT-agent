import { chromium, type Page } from 'playwright';
import type { AgentConfig } from '../domain/types.js';
import type { ExposureCumulativeProduct, ExposureOverviewMetric } from '../publicTraffic/types.js';
import { extractOverviewFromText } from '../publicTraffic/extractOverviewFromText.js';
import { extractProductIdFromInfo } from '../publicTraffic/extractProductIdFromInfo.js';
import { parseMoney, parseNumberText } from '../publicTraffic/exposureNormalize.js';
import { clearBrowserProfileLocks, prepareDashboardPage } from './browserProfile.js';
import { selectSubAccountIfNeeded } from './dashboardCrawler.js';
import { shouldKeepBrowserOpenOnFailure } from './failureHandling.js';
import { waitForSettledLoginState } from './loginState.js';

export interface ExposureCrawlResult {
  overview: ExposureOverviewMetric[];
  products: ExposureCumulativeProduct[];
  url: string;
}

const EXPOSURE_URL = 'https://b.alipay.com/page/self-operation-center/custody?custodyChannel=public';
const PERIOD_LABELS: Array<{ label: string; period: ExposureOverviewMetric['period'] }> = [
  { label: '1日', period: '1d' },
  { label: '7日', period: '7d' },
  { label: '30日', period: '30d' },
];

function normalizeText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function findHeaderIndex(headers: string[], expected: string): number {
  return headers.findIndex((header) => normalizeText(header).includes(expected));
}

function productNameFromInfo(infoText: string, platformProductId: string): string {
  const escapedProductId = platformProductId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const productIdToken = new RegExp(`\\s*[（(]?\\s*(?:商品ID|平台商品ID|ID)?\\s*[:：]?\\s*${escapedProductId}\\s*[）)]?\\s*`, 'gi');
  return normalizeText(infoText.replace(productIdToken, ' '));
}

async function ensureExposurePage(config: AgentConfig, page: Page): Promise<void> {
  const url = config.exposureUrl ?? EXPOSURE_URL;
  await page.goto(config.targetUrl, { waitUntil: 'domcontentloaded' });

  let loginState = await waitForSettledLoginState(page, { timeoutMs: 60000, intervalMs: 1000 });
  if (loginState === 'login-page') {
    console.log('检测到支付宝登录页，请扫码登录；登录成功后程序会继续抓取曝光数据。');
    await page.waitForURL((currentUrl) => !/auth\.alipay\.com|login/i.test(currentUrl.toString()), { timeout: 300000 });
    loginState = await waitForSettledLoginState(page, { timeoutMs: 60000, intervalMs: 1000 });
  }

  if (loginState === 'select-identity' || page.url().includes('select-identity')) {
    await selectSubAccountIfNeeded(page);
  }

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  loginState = await waitForSettledLoginState(page, { timeoutMs: 60000, intervalMs: 1000 });

  if (loginState === 'select-identity' || page.url().includes('select-identity')) {
    await selectSubAccountIfNeeded(page);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  await page.waitForTimeout(5000);
}

async function extractAllOverviews(page: Page): Promise<ExposureOverviewMetric[]> {
  const results: ExposureOverviewMetric[] = [];

  for (const { label, period } of PERIOD_LABELS) {
    const button = page.getByText(label, { exact: true }).first();
    try {
      await button.waitFor({ state: 'visible', timeout: 10000 });
      await button.click();
      await page.waitForTimeout(2000);
    } catch (error) {
      throw new Error(`无法点击曝光总体概况周期 ${label}: ${error instanceof Error ? error.message : String(error)}`);
    }

    const bodyText = normalizeText(await page.locator('body').innerText().catch(() => ''));
    const metrics = extractOverviewFromText(bodyText);
    if (metrics) {
      results.push({ period, ...metrics });
      console.log(`[曝光] ${label}: 曝光=${metrics.exposure}, 访问=${metrics.visits}, 金额=${metrics.amount}`);
    } else {
      throw new Error(`未能提取曝光总体概况周期 ${label}`);
    }
  }

  if (results.length !== PERIOD_LABELS.length) {
    throw new Error(`曝光总体概况抓取不完整: expected ${PERIOD_LABELS.length}, got ${results.length}`);
  }

  return results;
}

async function getCurrentTable(page: Page): Promise<{
  headers: string[];
  rows: string[][];
}> {
  return page.evaluate(`(() => {
    const table = document.querySelector('table');
    if (!table) return { headers: [], rows: [] };
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const headers = Array.from(table.querySelectorAll('thead th')).map((cell) => clean(cell.textContent));
    const rows = Array.from(table.querySelectorAll('tbody tr')).map((row) =>
      Array.from(row.querySelectorAll('td')).map((cell) => clean(cell.textContent)),
    );

    return { headers, rows };
  })()`);
}

async function extractProductRows(page: Page): Promise<ExposureCumulativeProduct[]> {
  const products: ExposureCumulativeProduct[] = [];
  let pageNum = 0;

  while (true) {
    pageNum += 1;
    const { headers, rows } = await getCurrentTable(page);
    const infoIndex = findHeaderIndex(headers, '商品信息');
    const exposureIndex = findHeaderIndex(headers, '曝光次数');
    const visitsIndex = findHeaderIndex(headers, '商品访问次数');
    const amountIndex = findHeaderIndex(headers, '交易金额');

    if (infoIndex < 0 || exposureIndex < 0 || visitsIndex < 0 || amountIndex < 0) {
      throw new Error(`Missing exposure table columns. Actual headers: ${headers.join(', ')}`);
    }

    for (const cells of rows) {
      const infoText = normalizeText(cells[infoIndex]);
      const platformProductId = extractProductIdFromInfo(infoText);
      if (!platformProductId) {
        continue;
      }

      const raw: Record<string, string> = {};
      headers.forEach((header, index) => {
        raw[normalizeText(header) || String(index)] = normalizeText(cells[index]);
      });

      products.push({
        productName: productNameFromInfo(infoText, platformProductId),
        platformProductId,
        exposure: parseNumberText(cells[exposureIndex]),
        visits: parseNumberText(cells[visitsIndex]),
        amount: parseMoney(cells[amountIndex]),
        custodyDays: null,
        raw,
      });
    }

    console.log(`[曝光] 第${pageNum}页: ${rows.length}行`);

    const nextButton = page.locator('.ant-pagination-next:not(.ant-pagination-disabled)').first();
    if ((await nextButton.count()) === 0 || !(await nextButton.isVisible().catch(() => false))) {
      break;
    }

    await nextButton.click();
    await page.waitForTimeout(2000);
  }

  return products;
}

export async function crawlExposurePage(config: AgentConfig): Promise<ExposureCrawlResult> {
  await clearBrowserProfileLocks(config.browserProfileDir);
  const browser = await chromium.launchPersistentContext(config.browserProfileDir, { headless: false });
  const page = await prepareDashboardPage(browser.pages(), () => browser.newPage());
  let completed = false;

  try {
    await ensureExposurePage(config, page);
    const overview = await extractAllOverviews(page);
    await page.waitForSelector('.ant-table-tbody tr', { timeout: 30000 }).catch(() => undefined);
    const products = await extractProductRows(page);

    console.log(`[曝光] 总体概况: ${overview.length}个周期`);
    console.log(`[曝光] 当前托管商品: ${products.length} 条`);

    completed = true;
    return { overview, products, url: page.url() };
  } finally {
    if (completed || !shouldKeepBrowserOpenOnFailure(process.env.MT_AGENT_KEEP_BROWSER_ON_FAILURE)) {
      await browser.close();
    } else {
      console.error('曝光抓取失败；保留浏览器窗口供检查。');
    }
  }
}
