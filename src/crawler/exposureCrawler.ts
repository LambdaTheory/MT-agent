import type { Page } from 'playwright';
import type { AgentConfig } from '../domain/types.js';
import { loadProductIdMapping, type ProductIdMapping } from '../mapping/productIdMapping.js';
import type { ExposureCumulativeProduct, ExposureOverviewMetric } from '../publicTraffic/types.js';
import { extractOverviewFromText } from '../publicTraffic/extractOverviewFromText.js';
import { extractProductIdFromInfo, resolveFallbackProductId } from '../publicTraffic/extractProductIdFromInfo.js';
import { parseMoney, parseNumberText } from '../publicTraffic/exposureNormalize.js';
import { selectSubAccountIfNeeded } from './subAccount.js';
import { shouldKeepBrowserOpenOnFailure } from './failureHandling.js';
import { ensureAuthenticatedMerchantSession } from './merchantSession.js';

export interface ExposureCrawlResult {
  overview: ExposureOverviewMetric[];
  products: ExposureCumulativeProduct[];
  paginationStats: ExposurePaginationStats;
  url: string;
}

export interface ExposurePaginationStats {
  pageRowCounts: number[];
  uniquePageSignatures: string[];
  duplicatePageSignatures: number;
  maxRepeatedSignatureAttempts: number;
  duplicateProductRows: number;
  skippedProductIdRows: number;
}

const EXPOSURE_URL = 'https://b.alipay.com/page/self-operation-center/custody?custodyChannel=public';
const MIN_RELIABLE_EXPOSURE_PRODUCTS = 200;
const MIN_RELIABLE_EXPOSURE_WINDOWS = 20;
const MAX_EXPOSURE_COLLECTION_ATTEMPTS = 3;
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
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  if (page.url().includes('select-identity')) {
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
  signature: string;
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
    if (!table) return { headers: [], rows: [], signature: '' };
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

    const signature = rows.map((row) => row.cells.join('|')).join('||');
    return { headers, rows, signature };
  })()`);
}

async function waitForTableSignatureChange(page: Page, previousSignature: string): Promise<void> {
  if (await tryWaitForTableSignatureChange(page, previousSignature, 15000)) return;
  throw new Error('曝光翻页后表格未变化');
}

async function tryWaitForTableSignatureChange(page: Page, previousSignature: string, timeoutMs: number): Promise<boolean> {
  const effectiveDeadline = Date.now() + timeoutMs;
  while (Date.now() < effectiveDeadline) {
    await page.waitForTimeout(500);
    const current = await getCurrentTable(page);
    if (current.signature && current.signature !== previousSignature) return true;
  }
  return false;
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

async function scrollCurrentTableForward(page: Page): Promise<boolean> {
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
    const candidates = [
      ...(wrapper ? Array.from(wrapper.querySelectorAll('.ant-table-body, .ant-table-content, [class*="virtual"], [class*="scroll"]')) : []),
      ...(wrapper ? Array.from(wrapper.querySelectorAll('*')) : []),
      document.scrollingElement,
    ].filter((element) => element instanceof Element && isVisible(element));
    const scrollableElements = candidates.filter((element) => element.scrollHeight > element.clientHeight + 4);
    let advanced = false;
    for (const element of scrollableElements) {
      const before = element.scrollTop;
      element.scrollTop = before + Math.max(element.clientHeight || 600, 600);
      advanced = element.scrollTop > before || advanced;
    }
    return advanced;
  })()`);
}

async function wheelCurrentTableForward(page: Page): Promise<boolean> {
  const target = await page.evaluate<{ x: number; y: number } | null>(`(() => {
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
    const scrollTarget = table?.closest('.ant-table-wrapper')?.querySelector('.ant-table-body, .ant-table-content') ?? table;
    const rect = scrollTarget?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return { x: rect.left + rect.width / 2, y: rect.top + Math.min(rect.height - 5, Math.max(5, rect.height / 2)) };
  })()`);
  if (!target) return false;
  await page.mouse.move(target.x, target.y);
  await page.mouse.wheel(0, 900);
  return true;
}

async function keyboardCurrentTableForward(page: Page): Promise<boolean> {
  const focused = await page.evaluate(`(() => {
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
    const target = table?.closest('.ant-table-wrapper') ?? table;
    if (!(target instanceof HTMLElement)) return false;
    target.tabIndex = target.tabIndex >= 0 ? target.tabIndex : -1;
    target.focus();
    return true;
  })()`);
  if (!focused) return false;
  await page.keyboard.press('PageDown');
  return true;
}

async function advanceCurrentTable(page: Page, previousSignature: string): Promise<boolean> {
  const attempts: Array<() => Promise<boolean>> = [
    () => clickCurrentTableNext(page),
    () => scrollCurrentTableForward(page),
    () => wheelCurrentTableForward(page),
    () => keyboardCurrentTableForward(page),
  ];

  for (const attempt of attempts) {
    if (!(await attempt())) continue;
    if (await tryWaitForTableSignatureChange(page, previousSignature, 4000)) return true;
  }
  return false;
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

async function extractProductRows(page: Page, mapping: ProductIdMapping): Promise<{ products: ExposureCumulativeProduct[]; paginationStats: ExposurePaginationStats }> {
  const productsById = new Map<string, ExposureCumulativeProduct>();
  const pageRowCounts: number[] = [];
  const uniquePageSignatures: string[] = [];
  const seenPageSignatures = new Set<string>();
  let pageNum = 0;
  let skippedProductIdRows = 0;
  let duplicateProductRows = 0;
  let duplicatePageSignatures = 0;
  let repeatedSignatureAttempts = 0;
  let maxRepeatedSignatureAttempts = 0;

  while (true) {
    pageNum += 1;
    const { headers, rows, signature } = await getCurrentTable(page);
    if (seenPageSignatures.has(signature)) {
      duplicatePageSignatures += 1;
      repeatedSignatureAttempts += 1;
      maxRepeatedSignatureAttempts = Math.max(maxRepeatedSignatureAttempts, repeatedSignatureAttempts);
      pageNum -= 1;
      if (repeatedSignatureAttempts >= 20 || !(await advanceCurrentTable(page, signature))) {
        break;
      }
      continue;
    }
    repeatedSignatureAttempts = 0;
    seenPageSignatures.add(signature);
    uniquePageSignatures.push(signature);
    pageRowCounts.push(rows.length);
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
      const platformProductId = domProductId || resolveFallbackProductId(regexProductId, mapping) || regexProductId;
      if (!platformProductId) {
        skippedProductIdRows += 1;
        continue;
      }

      const raw: Record<string, string> = {};
      headers.forEach((header, index) => {
        raw[normalizeText(header) || String(index)] = normalizeText(cells[index]);
      });

      if (productsById.has(platformProductId)) {
        duplicateProductRows += 1;
        continue;
      }

      productsById.set(platformProductId, {
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

    if (!(await advanceCurrentTable(page, signature))) {
      break;
    }
  }

  if (skippedProductIdRows > 0) {
    console.warn(`[曝光] 跳过${skippedProductIdRows}行: DOM ID 缺失且正则 ID 未命中`);
  }

  if (duplicateProductRows > 0) {
    console.warn(`[曝光] 跳过${duplicateProductRows}行: 商品ID重复`);
  }

  return {
    products: Array.from(productsById.values()),
    paginationStats: { pageRowCounts, uniquePageSignatures, duplicatePageSignatures, maxRepeatedSignatureAttempts, duplicateProductRows, skippedProductIdRows },
  };
}

export async function collectExposurePage(config: AgentConfig, page: Page): Promise<ExposureCrawlResult> {
  const mapping = await loadExposureFallbackMapping(config);
  let lastResult: { overview: ExposureOverviewMetric[]; products: ExposureCumulativeProduct[]; paginationStats: ExposurePaginationStats } | null = null;

  for (let attempt = 1; attempt <= MAX_EXPOSURE_COLLECTION_ATTEMPTS; attempt += 1) {
    await ensureExposurePage(config, page);
    const overview = await extractAllOverviews(page);
    await page.waitForSelector('.ant-table-tbody tr', { timeout: 30000 }).catch(() => undefined);
    const { products, paginationStats } = await extractProductRows(page, mapping);
    lastResult = { overview, products, paginationStats };

    const reliable = products.length >= MIN_RELIABLE_EXPOSURE_PRODUCTS && paginationStats.uniquePageSignatures.length >= MIN_RELIABLE_EXPOSURE_WINDOWS;
    if (reliable || attempt === MAX_EXPOSURE_COLLECTION_ATTEMPTS) {
      console.log(`[曝光] 总体概况: ${overview.length}个周期`);
      console.log(`[曝光] 当前托管商品: ${products.length} 条`);
      return { overview, products, paginationStats, url: page.url() };
    }

    console.warn(`[曝光] 第${attempt}次抓取疑似不完整: 商品=${products.length}, 唯一窗口=${paginationStats.uniquePageSignatures.length}; 重新加载托管页重试`);
    await page.waitForTimeout(3000);
  }

  if (!lastResult) throw new Error('曝光商品抓取未产生结果');
  return { ...lastResult, url: page.url() };
}

export async function crawlExposurePage(config: AgentConfig): Promise<ExposureCrawlResult> {
  const { browser, page } = await ensureAuthenticatedMerchantSession(config, { acceptDownloads: false, stage: 'exposure' });
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
