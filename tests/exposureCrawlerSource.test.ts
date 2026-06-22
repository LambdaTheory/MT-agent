import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('exposureCrawler Playwright evaluation', () => {
  it('does not pass a bundled function object into locator.evaluate for table extraction', async () => {
    const source = await readFile(new URL('../src/crawler/exposureCrawler.ts', import.meta.url), 'utf8');

    expect(source).not.toContain("locator('table').first().evaluate(");
  });

  it('scopes current table and pagination instead of using global selectors', async () => {
    const source = await readFile(new URL('../src/crawler/exposureCrawler.ts', import.meta.url), 'utf8');

    expect(source).not.toContain("document.querySelector('table')");
    expect(source).not.toContain("page.locator('.ant-pagination-next:not(.ant-pagination-disabled)')");
  });

  it('exposes a page-level collection function for shared browser workflows', async () => {
    const source = await readFile(new URL('../src/crawler/exposureCrawler.ts', import.meta.url), 'utf8');

    expect(source).toContain('export async function collectExposurePage(');
    expect(source).toContain('await ensureExposurePage(config, page);');
  });

  it('does not embed a product-price regex literal inside page.evaluate source', async () => {
    const source = await readFile(new URL('../src/crawler/exposureCrawler.ts', import.meta.url), 'utf8');

    expect(source).not.toContain('元\\/日|出售中|已下架');
    expect(source).toContain("text.includes('元/日')");
  });

  it('waits for the product table signature to change after each next-page click', async () => {
    const source = await readFile(new URL('../src/crawler/exposureCrawler.ts', import.meta.url), 'utf8');

    expect(source).toContain('waitForTableSignatureChange');
    expect(source).toContain('previousSignature');
    expect(source).toContain('await page.waitForTimeout(500)');
    expect(source).toContain('曝光翻页后表格未变化');
  });

  it('falls back to scrolling the custody product table when pagination is not visible', async () => {
    const source = await readFile(new URL('../src/crawler/exposureCrawler.ts', import.meta.url), 'utf8');

    expect(source).toContain('scrollCurrentTableForward');
    expect(source).toContain('advanceCurrentTable');
    expect(source).toContain('ant-table-body');
    expect(source).toContain('scrollableElements');
    expect(source).toContain('scrollHeight > element.clientHeight');
    expect(source).toContain('repeatedSignatureAttempts');
    expect(source).toContain('tryWaitForTableSignatureChange');
    expect(source).toContain('waitForCurrentTableToSettle');
    expect(source).toContain('.ant-spin-spinning, .ant-spin-dot-spin');
    expect(source).toContain('wheelCurrentTableForward');
    expect(source).toContain("page.mouse.wheel(0, 900)");
    expect(source).toContain('keyboardCurrentTableForward');
    expect(source).toContain("page.keyboard.press('PageDown')");
  });

  it('deduplicates exposure product IDs while preserving pagination diagnostics', async () => {
    const source = await readFile(new URL('../src/crawler/exposureCrawler.ts', import.meta.url), 'utf8');

    expect(source).toContain('productsById');
    expect(source).toContain('duplicateProductRows');
    expect(source).toContain('duplicatePageSignatures');
    expect(source).toContain('maxRepeatedSignatureAttempts');
    expect(source).toContain('resolveFallbackProductId(regexProductId, mapping) || regexProductId');
    expect(source).toContain('paginationStats');
    expect(source).toContain('pageRowCounts');
    expect(source).toContain('uniquePageSignatures');
  });

  it('retries partial custody table reads before returning exposure products', async () => {
    const source = await readFile(new URL('../src/crawler/exposureCrawler.ts', import.meta.url), 'utf8');

    expect(source).toContain('MIN_RELIABLE_EXPOSURE_PRODUCTS');
    expect(source).toContain('MIN_RELIABLE_EXPOSURE_WINDOWS');
    expect(source).toContain('MAX_EXPOSURE_COLLECTION_ATTEMPTS');
    expect(source).toContain('重新加载托管页重试');
    expect(source).toContain('曝光商品抓取不完整');
    expect(source).not.toContain('if (reliable || attempt === MAX_EXPOSURE_COLLECTION_ATTEMPTS)');
  });
});

describe('public traffic crawler orchestration', () => {
  it('runs exposure and dashboard page-level collectors in a single persistent context', async () => {
    const source = await readFile(new URL('../src/crawler/publicTrafficCrawler.ts', import.meta.url), 'utf8');

    expect(source).toContain('export async function crawlPublicTrafficSources(');
    expect(source).toContain('ensureAuthenticatedMerchantSession(config, { acceptDownloads: true, stage: \'public-traffic-full\' });');
    expect(source).toContain('await collectExposurePage(config, page);');
    expect(source).toContain('await collectDashboardPage(config, page);');
    expect(source).not.toContain('chromium.launchPersistentContext');
  });

  it('downloads goods export in the same persistent browser context before traffic pages', async () => {
    const source = await readFile(new URL('../src/crawler/publicTrafficCrawler.ts', import.meta.url), 'utf8');

    expect(source).toContain('goodsExportPath: string');
    expect(source).toContain('await collectGoodsExportPage(config, browser, page, goodsExportPath);');
    expect(source.indexOf('await collectGoodsExportPage')).toBeLessThan(source.indexOf('await collectExposurePage'));
    expect(source).toContain('acceptDownloads: true');
  });
});
