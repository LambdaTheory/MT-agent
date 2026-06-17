import { chromium, type Page } from 'playwright';
import type { AgentConfig } from '../domain/types.js';
import { loadProductIdMapping, type ProductIdMapping } from '../mapping/productIdMapping.js';
import type { ExposureCumulativeProduct, ExposureOverviewMetric } from '../publicTraffic/types.js';
import { extractOverviewFromText } from '../publicTraffic/extractOverviewFromText.js';
import { extractProductIdFromInfo, resolveFallbackProductId } from '../publicTraffic/extractProductIdFromInfo.js';
import { parseMoney, parseNumberText } from '../publicTraffic/exposureNormalize.js';
import { clearBrowserProfileLocks, prepareDashboardPage } from './browserProfile.js';
import { selectSubAccountIfNeeded } from './dashboardCrawler.js';
import { shouldKeepBrowserOpenOnFailure } from './failureHandling.js';
import { notifyLoginRequired } from './loginNotification.js';
import { waitForSettledLoginState } from './loginState.js';

export interface ExposureCrawlResult {
  overview: ExposureOverviewMetric[];
  products: ExposureCumulativeProduct[];
  url: string;
}

const EXPOSURE_URL = 'https://b.alipay.com/page/self-operation-center/custody?custodyChannel=public';
const PERIOD_LABELS: Array<{ label: string; period: ExposureOverviewMetric['period'] }> = [
  { label: '1日', period: '1d' },
];

function normalizeText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function findHeaderIndex(headers: string[], expected: string): number {
  return headers.findIndex((header) => normalizeText(header).includes(expected));
}

export function productNameFromInfo(infoText: string, platformProductId: string): string {
  const escapedProductId = platformProductId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const productIdToken = new RegExp(`\\s*[（(]?\\s*(?:商品ID|平台商品ID|ID)?\\s*[:：]?\\s*${escapedProductId}\\s*[）)]?\\s*`, 'gi');
  return normalizeText(infoText
    .replace(productIdToken, ' ')
    .replace(/^预览\s*/, '')
    .replace(/\s+[¥￥]?\d*\.?\d+\s*(?:~\s*[¥￥]?\d*\.?\d+)?\s*元\/日.*$/i, '')
    .replace(/\s*(?:出售中|已下架)\s*$/g, ''));
}

export function resolveProductNameFromInfo(productTitle: string, infoText: string, platformProductId: string): string {
  const preferred = productNameFromInfo(productTitle, platformProductId);
  return preferred.length > 1 ? preferred : productNameFromInfo(infoText, platformProductId);
}

function custodyDaysFromText(value: string): number | null {
  const match = /已托管\s*(\d+(?:\.\d+)?)\s*天/.exec(value) ?? /托管\s*(\d+(?:\.\d+)?)\s*天/.exec(value);
  if (!match) return null;
  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

async function ensureExposurePage(config: AgentConfig, page: Page): Promise<void> {
  const url = config.exposureUrl ?? EXPOSURE_URL;
  await page.goto(config.targetUrl, { waitUntil: 'domcontentloaded' });

  let loginState = await waitForSettledLoginState(page, { timeoutMs: 60000, intervalMs: 1000 });
  if (loginState === 'login-page') {
    console.log('检测到支付宝登录页，请扫码登录；登录成功后程序会继续抓取曝光数据。');
    await notifyLoginRequired({ page, stage: 'exposure', outputDir: config.outputDir, log: console.log });
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
  rows: Array<{ cells: string[]; productTitle: string; domProductId: string }>;
}> {
  return page.evaluate(`(() => {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const table = Array.from(document.querySelectorAll('table')).find((candidate) => {
      if (!isVisible(candidate)) return false;
      const headers = Array.from(candidate.querySelectorAll('thead th')).map((cell) => clean(cell.textContent));
      return headers.some((header) => header.includes('商品信息'))
        && headers.some((header) => header.includes('曝光次数'))
        && headers.some((header) => header.includes('商品访问次数'))
        && headers.some((header) => header.includes('交易金额'));
    });
    if (!table) return { headers: [], rows: [] };
    const headers = Array.from(table.querySelectorAll('thead th')).map((cell) => clean(cell.textContent));
    const infoIndex = headers.findIndex((header) => header.includes('商品信息'));
    const titleFromInfoCell = (cell) => {
      const preferred = cell.querySelector('div > div:nth-child(2) > div:first-child');
      const preferredText = clean(preferred?.textContent);
      if (preferredText) return preferredText;

      const candidates = Array.from(cell.querySelectorAll('div, span, a'))
        .map((element) => clean(element.textContent))
        .filter((text) => text && text !== '预览' && !text.includes('商品ID') && !text.includes('平台商品ID') && !text.includes('元/日') && !text.includes('出售中') && !text.includes('已下架'));
      return candidates.sort((a, b) => b.length - a.length)[0] ?? '';
    };
    const idFromInfoCell = (cell) => {
      const idText = clean(cell.querySelector('[class*="idWrap"] span')?.textContent);
      return idText.match(/(?:ID|商品ID|平台商品ID)\s*[:：]?\s*(20\d{20,})/)?.[1] ?? '';
    };
    const rows = Array.from(table.querySelectorAll('tbody tr')).map((row) => {
      const cells = Array.from(row.querySelectorAll('td'));
      const infoCell = infoIndex >= 0 ? cells[infoIndex] : undefined;
      return {
        cells: cells.map((cell) => clean(cell.textContent)),
        productTitle: infoCell ? titleFromInfoCell(infoCell) : '',
        domProductId: infoCell ? idFromInfoCell(infoCell) : '',
      };
    });

    return { headers, rows };
  })()`);
}

async function clickCurrentTableNext(page: Page): Promise<boolean> {
  return page.evaluate(`(() => {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const table = Array.from(document.querySelectorAll('table')).find((candidate) => {
      if (!isVisible(candidate)) return false;
      const headers = Array.from(candidate.querySelectorAll('thead th')).map((cell) => clean(cell.textContent));
      return headers.some((header) => header.includes('商品信息'))
        && headers.some((header) => header.includes('曝光次数'))
        && headers.some((header) => header.includes('商品访问次数'))
        && headers.some((header) => header.includes('交易金额'));
    });
    const wrapper = table?.closest('.ant-table-wrapper');
    const nextButton = wrapper?.querySelector('.ant-pagination-next:not(.ant-pagination-disabled)');
    if (!(nextButton instanceof HTMLElement) || !isVisible(nextButton)) return false;
    nextButton.click();
    return true;
  })()`);
}

async function loadExposureFallbackMapping(config: AgentConfig): Promise<ProductIdMapping> {
  const mappingPath = config.productIdMappingPath ?? 'config/product-id-map.json';
  try {
    return await loadProductIdMapping(mappingPath);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      console.warn(`[曝光] 商品ID映射缺失，正则兜底将跳过未校验ID: ${mappingPath}`);
      return {};
    }
    throw error;
  }
}

async function extractProductRows(page: Page, mapping: ProductIdMapping): Promise<ExposureCumulativeProduct[]> {
  const products: ExposureCumulativeProduct[] = [];
  let pageNum = 0;
  let skippedProductIdRows = 0;

  while (true) {
    pageNum += 1;
    const { headers, rows } = await getCurrentTable(page);
    const infoIndex = findHeaderIndex(headers, '商品信息');
    const exposureIndex = findHeaderIndex(headers, '曝光次数');
    const visitsIndex = findHeaderIndex(headers, '商品访问次数');
    const amountIndex = findHeaderIndex(headers, '交易金额');
    const custodyIndex = headers.findIndex((header) => normalizeText(header).includes('托管状态'));

    if (infoIndex < 0 || exposureIndex < 0 || visitsIndex < 0 || amountIndex < 0) {
      throw new Error(`Missing exposure table columns. Actual headers: ${headers.join(', ')}`);
    }

    for (const { cells, productTitle, domProductId } of rows) {
      const infoText = normalizeText(cells[infoIndex]);
      const regexProductId = extractProductIdFromInfo(infoText);
      const platformProductId = domProductId || resolveFallbackProductId(regexProductId, mapping);
      if (!platformProductId) {
        skippedProductIdRows += 1;
        continue;
      }

      const raw: Record<string, string> = {};
      headers.forEach((header, index) => {
        raw[normalizeText(header) || String(index)] = normalizeText(cells[index]);
      });

      products.push({
        productName: resolveProductNameFromInfo(productTitle, infoText, platformProductId),
        platformProductId,
        exposure: parseNumberText(cells[exposureIndex]),
        visits: parseNumberText(cells[visitsIndex]),
        amount: parseMoney(cells[amountIndex]),
        custodyDays: custodyIndex >= 0 ? custodyDaysFromText(normalizeText(cells[custodyIndex])) : null,
        raw,
      });
    }

    console.log(`[曝光] 第${pageNum}页: ${rows.length}行`);

    if (!(await clickCurrentTableNext(page))) {
      break;
    }

    await page.waitForTimeout(2000);
  }

  if (skippedProductIdRows > 0) {
    console.warn(`[曝光] 跳过${skippedProductIdRows}行: DOM ID 缺失且正则 ID 未命中商品总表映射`);
  }

  return products;
}

export async function collectExposurePage(config: AgentConfig, page: Page): Promise<ExposureCrawlResult> {
  await ensureExposurePage(config, page);
  const overview = await extractAllOverviews(page);
  await page.waitForSelector('.ant-table-tbody tr', { timeout: 30000 }).catch(() => undefined);
  const mapping = await loadExposureFallbackMapping(config);
  const products = await extractProductRows(page, mapping);

  console.log(`[曝光] 总体概况: ${overview.length}个周期`);
  console.log(`[曝光] 当前托管商品: ${products.length} 条`);

  return { overview, products, url: page.url() };
}

export async function crawlExposurePage(config: AgentConfig): Promise<ExposureCrawlResult> {
  await clearBrowserProfileLocks(config.browserProfileDir);
  const browser = await chromium.launchPersistentContext(config.browserProfileDir, { headless: false, viewport: { width: 1920, height: 1080 } });
  const page = await prepareDashboardPage(browser.pages(), () => browser.newPage());
  let completed = false;

  try {
    const result = await collectExposurePage(config, page);
    completed = true;
    return result;
  } finally {
    if (completed || !shouldKeepBrowserOpenOnFailure(process.env.MT_AGENT_KEEP_BROWSER_ON_FAILURE)) {
      await browser.close();
    } else {
      console.error('曝光抓取失败；保留浏览器窗口供检查。');
    }
  }
}
