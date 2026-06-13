import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, type Locator, type Page } from 'playwright';
import type { AgentConfig, RawTableData } from '../domain/types.js';
import { clearBrowserProfileLocks, prepareDashboardPage } from './browserProfile.js';
import { shouldKeepBrowserOpenOnFailure } from './failureHandling.js';
import { waitForDashboardAfterLogin, waitForSettledLoginState } from './loginState.js';
import { normalizePageSizeCandidates, readCurrentPageSize, setDashboardPageSize } from './pageSizeProbe.js';
import { dedupeRowsByProductId, isCollectionComplete } from './pagination.js';

const PERIOD_LABELS = {
  '1d': '1日',
  '7d': '7日',
  '30d': '30日',
} as const;

function normalize(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

export function isDashboardEmptyStateText(text: string | null | undefined): boolean {
  const normalized = normalize(text);
  return normalized.includes('未查询到相关数据') || normalized.includes('暂无数据');
}

async function isDashboardEmptyStateVisible(page: Page): Promise<boolean> {
  const emptyText = page.locator('.emptyTxt-LkXGcaGA').filter({ hasText: '未查询到相关数据' }).first();
  if ((await emptyText.count().catch(() => 0)) > 0 && (await emptyText.isVisible().catch(() => false))) return true;
  const text = await page.locator('body').textContent().catch(() => '');
  return isDashboardEmptyStateText(text);
}

async function confirmDashboardEmptyState(page: Page): Promise<boolean> {
  if (!(await isDashboardEmptyStateVisible(page))) return false;
  await page.waitForTimeout(10000);
  return isDashboardEmptyStateVisible(page);
}

function emptyDashboardTable(period: keyof typeof PERIOD_LABELS): RawTableData {
  return {
    period,
    headers: [],
    rows: [],
    collection: {
      period,
      actualPageSizes: [],
      pageCount: 0,
      rowCount: 0,
      dedupedRowCount: 0,
      displayedTotalCount: 0,
      pageSizeFallback: false,
      complete: false,
    },
  };
}

async function waitForTableOrEmptyState(page: Page, timeout: number): Promise<void> {
  await Promise.race([
    page.waitForSelector('.ant-table table', { timeout }),
    page.waitForFunction(
      () => Boolean(document.querySelector('.emptyTxt-LkXGcaGA')) || String(document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().includes('未查询到相关数据') || String(document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().includes('暂无数据'),
      undefined,
      { timeout },
    ),
  ]);
}

async function waitForTableRefresh(page: Page): Promise<void> {
  await page.waitForTimeout(2000);
}

async function selectPeriod(page: Page, period: keyof typeof PERIOD_LABELS): Promise<void> {
  const label = PERIOD_LABELS[period];
  const target = page.getByText(label, { exact: true }).first();
  await target.waitFor({ state: 'visible', timeout: 30000 });
  await target.click();
  await waitForTableRefresh(page);
}

async function readActualPageSize(page: Page): Promise<number> {
  try {
    return (await readCurrentPageSize(page)) ?? 10;
  } catch {
    return 10;
  }
}

async function readDisplayedTotal(page: Page): Promise<number | null> {
  try {
    const text = normalize(await page.locator('.ant-pagination, .ant-table-pagination').last().textContent().catch(() => ''));
    const match = text.match(/共\s*(\d+)\s*条/);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

async function isNextDisabled(page: Page): Promise<boolean> {
  const next = page.locator('.ant-pagination-next').last();

  if ((await next.count()) === 0) {
    return true;
  }

  const className = await next.getAttribute('class');
  return Boolean(className?.includes('disabled'));
}

async function goToNextPage(page: Page): Promise<void> {
  const button = page.locator('.ant-pagination-next button, .ant-pagination-next').last();
  await button.click();
  await waitForTableRefresh(page);
}

async function extractCurrentTable(page: Page): Promise<{ headers: string[]; rows: string[][] }> {
  return page.evaluate(`(() => {
    const normalizeText = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const container = document.querySelector('.ant-table');
    if (!container) throw new Error('Could not find .ant-table');
    const table = container.querySelector('table');
    if (!table) throw new Error('Could not find table');

    const sourceHeaders = Array.from(table.querySelectorAll('thead th')).map((cell) => normalizeText(cell.textContent || ''));

    const actionHeaders = new Set(['action', 'actions', '操作']);
    const columnDefinitions = sourceHeaders.flatMap((header, index) => {
      const lower = header.toLowerCase();
      if (header === '' || actionHeaders.has(header) || actionHeaders.has(lower)) return [];
      if (header === '商品信息') return [{ sourceIndex: index, headers: ['商品名称', '商品ID'], readKind: 'product' }];
      if (header === 'SPU信息') return [{ sourceIndex: index, headers: ['SPU名称', 'SPUID'], readKind: 'spu' }];
      return [{ sourceIndex: index, headers: [header], readKind: 'plain' }];
    });

    const rows = [];
    const rowElements = table.querySelectorAll('tbody tr');
    for (const rowEl of rowElements) {
      const cells = Array.from(rowEl.querySelectorAll('td'));
      const row = [];
      for (const definition of columnDefinitions) {
        const cell = cells[definition.sourceIndex];
        if (!cell) {
          definition.readKind === 'plain' ? row.push('') : row.push('', '');
          continue;
        }
        const cellText = normalizeText(cell.textContent || '');
        if (definition.readKind === 'plain') {
          row.push(cellText);
          continue;
        }
        const leafElements = Array.from(cell.querySelectorAll('*')).filter((el) => el.children.length === 0);
        const leafTexts = leafElements.map((el) => normalizeText(el.textContent || '')).filter(Boolean);
        const rawParts = leafTexts.length > 0 ? leafTexts.filter((part, i, arr) => arr.indexOf(part) === i) : [cellText].filter(Boolean);
        const parts = rawParts.filter((part) => !/^复制$|^copy$/i.test(part));
        const idMatchers = definition.readKind === 'product' ? [/商品ID/i, /^id[:：]/i] : [/SPUID/i, /SPU ID/i, /^id[:：]/i];
        const idPart = parts.find((part) => idMatchers.some((matcher) => matcher.test(part))) || parts[1] || '';
        const namePart = parts.find((part) => part !== idPart) || parts[0] || '';
        let normalizedId = idPart;
        if (definition.readKind === 'product') normalizedId = normalizedId.replace(/^商品ID[:：\\s-]*/i, '');
        else normalizedId = normalizedId.replace(/^SPUID[:：\\s-]*/i, '').replace(/^SPU ID[:：\\s-]*/i, '');
        normalizedId = normalizeText(normalizedId.replace(/^ID[:：\\s-]*/i, '').replace(/复制$/i, '').replace(/copy$/i, ''));
        row.push(normalizeText(namePart), normalizedId);
      }
      rows.push(row);
    }
    return { headers: columnDefinitions.flatMap((definition) => definition.headers), rows };
  })()`);
}

async function collectPeriod(page: Page, period: keyof typeof PERIOD_LABELS, pageSize: number, preferredPageSize: number): Promise<RawTableData> {
  await selectPeriod(page, period);
  if (await confirmDashboardEmptyState(page)) {
    return emptyDashboardTable(period);
  }

  await setDashboardPageSize(page, pageSize);
  await waitForTableOrEmptyState(page, 30000);
  if (await confirmDashboardEmptyState(page)) {
    return emptyDashboardTable(period);
  }

  const allRows: string[][] = [];
  let headers: string[] = [];
  const actualPageSizes: number[] = [];
  let pageCount = 0;
  let nextDisabled = false;

  const MAX_PAGES = 100;

  while (pageCount < MAX_PAGES) {
    const table = await extractCurrentTable(page);
    headers = table.headers;
    allRows.push(...table.rows);
    actualPageSizes.push(await readActualPageSize(page));
    pageCount += 1;
    nextDisabled = await isNextDisabled(page);

    if (nextDisabled) {
      break;
    }

    await goToNextPage(page);
  }

  const dedupedRows = dedupeRowsByProductId(headers, allRows);
  const displayedTotalCount = await readDisplayedTotal(page);

  return {
    period,
    headers,
    rows: dedupedRows,
    collection: {
      period,
      actualPageSizes,
      pageCount,
      rowCount: allRows.length,
      dedupedRowCount: dedupedRows.length,
      displayedTotalCount,
      pageSizeFallback: actualPageSizes.some((size) => size !== preferredPageSize),
      complete: isCollectionComplete(dedupedRows.length, displayedTotalCount, nextDisabled),
    },
  };
}

async function collectPeriodWithAdaptivePageSize(page: Page, period: keyof typeof PERIOD_LABELS, preferredPageSize: number): Promise<RawTableData> {
  const candidates = normalizePageSizeCandidates(preferredPageSize);
  let lastError: Error | null = null;

  for (const candidate of candidates) {
    try {
      const table = await collectPeriod(page, period, candidate, preferredPageSize);
      console.log(`[${period}] using ${candidate} 条/页, pages=${table.collection.pageCount}, rows=${table.rows.length}`);
      return table;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`[${period}] page size ${candidate} failed: ${lastError.message}`);
    }
  }

  throw lastError ?? new Error(`[${period}] all page size candidates failed`);
}

export async function selectSubAccountIfNeeded(page: Page): Promise<void> {
  if (!page.url().includes('select-identity')) {
    return;
  }

  const matchers = [/深圳.*米奇/, /米奇.*租赁/];
  const fallbackMatchers = [/米奇/];
  const accountRows = page.locator('.ant-table-tbody tr');

  try {
    await accountRows.first().waitFor({ state: 'visible', timeout: 30000 });
  } catch {
    const bodyText = normalize(await page.locator('body').textContent().catch(() => ''));
    throw new Error(`Reached the account selection page, but account rows did not appear. Visible text: ${bodyText.slice(0, 1000)}`);
  }

  const count = await accountRows.count();

  async function clickAndNavigate(row: Locator): Promise<boolean> {
    await row.locator('h3').first().click();
    await page.waitForTimeout(2000);

    try {
      await page.waitForURL((url) => !url.toString().includes('select-identity'), { timeout: 30000 });
      await page.waitForTimeout(2000);
      return true;
    } catch {
      return false;
    }
  }

  for (let index = 0; index < count; index += 1) {
    const row = accountRows.nth(index);
    const text = normalize(await row.textContent());
    if (matchers.some((matcher) => matcher.test(text)) || fallbackMatchers.some((matcher) => matcher.test(text))) {
      if (await clickAndNavigate(row)) {
        return;
      }

      await row.click();
      try {
        await page.waitForSelector('.ant-table table', { timeout: 10000 });
        return;
      } catch {
        // continue to error
      }
    }
  }

  const visibleAccounts = await accountRows.evaluateAll((rows) => rows.map((row) => String(row.textContent ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean));
  throw new Error(`Reached the account selection page, but could not find the 深圳市米奇租赁有限责任公司 sub-account. Visible accounts: ${visibleAccounts.join(' | ')}`);
}

export async function collectDashboardPage(config: AgentConfig, page: Page): Promise<RawTableData[]> {
  await page.goto(config.targetUrl, { waitUntil: 'domcontentloaded' });
  const loginState = await waitForSettledLoginState(page, { timeoutMs: 60000, intervalMs: 1000 });
  if (loginState === 'login-page') {
    await waitForDashboardAfterLogin(page);
  }

  await selectSubAccountIfNeeded(page);

  if (page.url().includes('select-identity')) {
    throw new Error('Sub-account selection did not complete. The browser reached the account selection page, but the crawler did not successfully enter the target merchant workspace.');
  }

  await page.waitForURL(/assistant-data-analysis\/index\/product\/list/, { timeout: 180000 }).catch(() => undefined);

  try {
    await waitForTableOrEmptyState(page, 180000);
  } catch {
    throw new Error('Dashboard table or empty-state did not appear within 180 seconds. Complete QR login in the opened browser window.');
  }

  const rawDir = `${config.outputDir}/latest`;
  await mkdir(rawDir, { recursive: true });

  const periods = ['1d', '7d', '30d'] as const;
  if (await confirmDashboardEmptyState(page)) {
    const emptyResults = periods.map((period) => emptyDashboardTable(period));
    for (const table of emptyResults) {
      const path = `${rawDir}/raw-${table.period}.json`;
      await writeFile(path, JSON.stringify(table, null, 2), 'utf8');
      console.log(`[${table.period}] saved ${table.rows.length} rows to ${path}`);
    }
    return emptyResults;
  }

  const results: RawTableData[] = [];

  for (const period of periods) {
    const table = await collectPeriodWithAdaptivePageSize(page, period, config.preferredPageSize);
    results.push(table);
    const path = `${rawDir}/raw-${period}.json`;
    await writeFile(path, JSON.stringify(table, null, 2), 'utf8');
    console.log(`[${period}] saved ${table.rows.length} rows to ${path}`);
  }

  return results;
}

export async function crawlDashboard(config: AgentConfig): Promise<RawTableData[]> {
  await mkdir(config.browserProfileDir, { recursive: true });
  await clearBrowserProfileLocks(config.browserProfileDir);
  const browser = await chromium.launchPersistentContext(config.browserProfileDir, { headless: false });
  const page = await prepareDashboardPage(browser.pages(), () => browser.newPage());
  let completed = false;

  try {
    const results = await collectDashboardPage(config, page);
    completed = true;
    return results;
  } finally {
    if (completed || !shouldKeepBrowserOpenOnFailure(process.env.MT_AGENT_KEEP_BROWSER_ON_FAILURE)) {
      await browser.close();
    } else {
      console.error('Crawler failed; keeping browser open for inspection. Set MT_AGENT_KEEP_BROWSER_ON_FAILURE=0 to auto-close on failure.');
    }
  }
}
