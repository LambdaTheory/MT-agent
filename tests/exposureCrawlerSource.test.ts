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

  it('曝光页分页前尝试调大每页条数（best-effort，上限50）', async () => {
    const source = await readFile(new URL('../src/crawler/exposureCrawler.ts', import.meta.url), 'utf8');

    expect(source).toContain('setDashboardPageSize');
    expect(source).toContain('EXPOSURE_MAX_PAGE_SIZE = 50');
    expect(source).toContain('Math.min(');
    expect(source).toContain('每页条数调整失败');
  });
});

describe('public traffic crawler orchestration', () => {
  it('runs exposure and dashboard page-level collectors in a single persistent context', async () => {
    const source = await readFile(new URL('../src/crawler/publicTrafficCrawler.ts', import.meta.url), 'utf8');

    expect(source).toContain('export async function crawlPublicTrafficSources(');
    expect(source).toContain('await collectExposurePage(config, page);');
    expect(source).toContain('await collectDashboardPage(config, page);');
    expect(source).toContain('chromium.launchPersistentContext');
  });

  it('downloads goods export in the same persistent browser context before traffic pages', async () => {
    const source = await readFile(new URL('../src/crawler/publicTrafficCrawler.ts', import.meta.url), 'utf8');

    expect(source).toContain('goodsExportPath: string');
    expect(source).toContain('await collectGoodsExportPage(config, browser, page, goodsExportPath);');
    expect(source.indexOf('await collectGoodsExportPage')).toBeLessThan(source.indexOf('await collectExposurePage'));
    expect(source).toContain('acceptDownloads: true');
  });
});
