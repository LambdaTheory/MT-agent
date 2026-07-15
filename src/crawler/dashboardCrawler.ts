import { mkdir, writeFile } from 'node:fs/promises';
import type { Frame, Locator, Page } from 'playwright';
import type { AgentConfig, RawTableData } from '../domain/types.js';
import { ensureAuthenticatedMerchantSession } from './merchantSession.js';
import { shouldKeepBrowserOpenOnFailure } from './failureHandling.js';
import { normalizePageSizeCandidates, readCurrentPageSize, setDashboardPageSize } from './pageSizeProbe.js';
import { dedupeRowsByProductId, isCollectionComplete } from './pagination.js';
import { selectSubAccountIfNeeded } from './subAccount.js';
import { assessDashboardDateReadback, assertDashboardDataDate } from '../publicTraffic/dashboardCaptureDate.js';

const PERIOD_LABELS = {
  '1d': '1日',
  '7d': '7日',
  '30d': '30日',
} as const;

type DashboardTarget = Frame | Page;

export interface DashboardCollectOptions {
  dataDate?: string;
}

export interface DashboardCollectionResult {
  tables: RawTableData[];
  actualPageDate?: string;
}

function normalize(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function waitForDashboardTargetTimeout(target: DashboardTarget, timeout: number): Promise<void> {
  return 'page' in target ? target.page().waitForTimeout(timeout) : target.waitForTimeout(timeout);
}

export function isDashboardEmptyStateText(text: string | null | undefined): boolean {
  const normalized = normalize(text);
  return normalized.includes('未查询到相关数据') || normalized.includes('暂无数据');
}

async function isDashboardEmptyStateVisible(page: DashboardTarget): Promise<boolean> {
  const visibleTable = page.locator('.ant-table table, table, [role="table"]').first();
  if ((await visibleTable.count().catch(() => 0)) > 0 && (await visibleTable.isVisible().catch(() => false))) return false;

  const emptyText = page.locator('.emptyTxt-LkXGcaGA').filter({ hasText: /未查询到相关数据|暂无数据/ }).first();
  if ((await emptyText.count().catch(() => 0)) > 0 && (await emptyText.isVisible().catch(() => false))) return true;
  const text = await page.locator('body').textContent().catch(() => '');
  return isDashboardEmptyStateText(text);
}

async function confirmDashboardEmptyState(page: DashboardTarget): Promise<boolean> {
  if (!(await isDashboardEmptyStateVisible(page))) return false;
  await waitForDashboardTargetTimeout(page, 3000);
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

async function dashboardTargetState(target: DashboardTarget): Promise<'table' | 'empty' | null> {
  return target
    .evaluate(`(() => {
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const hasVisibleTable = Array.from(document.querySelectorAll('.ant-table table, table, [role="table"]')).some((element) => isVisible(element));
      if (hasVisibleTable) return 'table';
      const emptyElements = Array.from(document.querySelectorAll('.emptyTxt-LkXGcaGA'));
      if (emptyElements.some((element) => isVisible(element) && /未查询到相关数据|暂无数据/.test(String(element.textContent ?? '')))) return 'empty';
      return null;
    })()`)
    .catch(() => null) as Promise<'table' | 'empty' | null>;
}

interface DashboardObservableState {
  kind: 'table' | 'empty' | 'none';
  signature: string;
  loading: boolean;
}

async function captureDashboardObservableState(target: DashboardTarget): Promise<DashboardObservableState> {
  return target
    .evaluate(`(() => {
      const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const loading = Array.from(document.querySelectorAll('.ant-spin-spinning, .ant-spin-dot-spin, [aria-busy="true"]')).some((element) => isVisible(element));
      const table = Array.from(document.querySelectorAll('.ant-table table, table, [role="table"]')).find((element) => isVisible(element));
      if (table) return { kind: 'table', signature: normalizeText(table.textContent || '').slice(0, 2000), loading };
      const empty = Array.from(document.querySelectorAll('.emptyTxt-LkXGcaGA')).find((element) => isVisible(element) && /未查询到相关数据|暂无数据/.test(String(element.textContent ?? '')));
      if (empty) return { kind: 'empty', signature: normalizeText(empty.textContent || '').slice(0, 500), loading };
      return { kind: 'none', signature: normalizeText(document.body?.textContent || '').slice(0, 500), loading };
    })()`)
    .catch(() => ({ kind: 'none', signature: 'unreadable', loading: false })) as Promise<DashboardObservableState>;
}

function dashboardObservableStateChanged(before: DashboardObservableState, after: DashboardObservableState): boolean {
  return before.kind !== after.kind || before.signature !== after.signature;
}

function dashboardObservableStateFingerprint(state: DashboardObservableState): string {
  let hash = 0;
  for (const char of state.signature) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return `${state.kind}:${state.signature.length}:${hash >>> 0}:loading=${state.loading}`;
}

async function waitForDashboardRefreshAfterDateSelection(target: DashboardTarget, before: DashboardObservableState, dataDate: string): Promise<void> {
  const deadline = Date.now() + 30000;
  let lastState = before;
  let loadingSeen = false;
  let loadingTransitionObserved = false;

  while (Date.now() < deadline) {
    const current = await captureDashboardObservableState(target);
    lastState = current;
    if (current.loading) loadingSeen = true;
    else if (loadingSeen) loadingTransitionObserved = true;

    const settled = current.kind === 'table' || current.kind === 'empty';
    if (settled && (dashboardObservableStateChanged(before, current) || loadingTransitionObserved)) return;

    await waitForDashboardTargetTimeout(target, 1000);
  }

  throw dashboardDateFailure(
    `Dashboard did not refresh after selecting requested dataDate; before=${dashboardObservableStateFingerprint(before)}; after=${dashboardObservableStateFingerprint(lastState)}; loadingTransitionObserved=${loadingTransitionObserved}`,
    dataDate,
  );
}

async function waitForTableOrEmptyState(page: Page, timeout: number): Promise<DashboardTarget> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const target of [page, ...page.frames()]) {
      if (await dashboardTargetState(target)) return target;
    }
    await page.waitForTimeout(1000);
  }
  throw new Error('Dashboard table or empty-state did not appear within timeout');
}

async function dashboardTimeoutMessage(page: Page): Promise<string> {
  const [url, title, bodyText] = await Promise.all([
    Promise.resolve(page.url()).catch(() => ''),
    page.title().catch(() => ''),
    page.locator('body').innerText({ timeout: 1000 }).catch(() => ''),
  ]);
  const snippet = normalize(bodyText).slice(0, 240);
  const frameUrls = page.frames().map((frame) => frame.url()).filter(Boolean).slice(0, 10).join(' | ');
  return `Dashboard table or empty-state did not appear within 180 seconds. url=${url || 'unknown'} title=${title || 'unknown'} text=${snippet || 'empty'} frames=${frameUrls || 'none'}`;
}

async function waitForTableRefresh(page: DashboardTarget): Promise<void> {
  await waitForDashboardTargetTimeout(page, 2000);
}

async function clickDashboardLocator(locator: Locator): Promise<void> {
  await locator.click().catch(async (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('intercepts pointer events') && !message.includes('Timeout')) throw error;
    await locator.evaluate((element) => {
      const target = element as HTMLElement;
      target.scrollIntoView({ block: 'center', inline: 'center' });
      target.click();
    });
  });
}

async function selectPeriod(page: DashboardTarget, period: keyof typeof PERIOD_LABELS): Promise<void> {
  const label = PERIOD_LABELS[period];
  const target = page.getByText(label, { exact: true }).first();
  await target.waitFor({ state: 'visible', timeout: 30000 });
  await clickDashboardLocator(target);
  await waitForTableRefresh(page);
}

async function readActualPageSize(page: DashboardTarget): Promise<number> {
  try {
    return (await readCurrentPageSize(page)) ?? 10;
  } catch {
    return 10;
  }
}

async function readDisplayedTotal(page: DashboardTarget): Promise<number | null> {
  try {
    const text = normalize(await page.locator('.ant-pagination, .ant-table-pagination').last().textContent().catch(() => ''));
    const match = text.match(/共\s*(\d+)\s*条/);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

async function isNextDisabled(page: DashboardTarget): Promise<boolean> {
  const next = page.locator('.ant-pagination-next').last();

  if ((await next.count()) === 0) {
    return true;
  }

  const className = await next.getAttribute('class');
  return Boolean(className?.includes('disabled'));
}

async function goToNextPage(page: DashboardTarget): Promise<void> {
  const button = page.locator('.ant-pagination-next button, .ant-pagination-next').last();
  await button.click();
  await waitForTableRefresh(page);
}

async function extractCurrentTable(page: DashboardTarget): Promise<{ headers: string[]; rows: string[][] }> {
  return page.evaluate(`(() => {
    const normalizeText = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const table = Array.from(document.querySelectorAll('.ant-table table, table, [role="table"]')).find((element) => isVisible(element));
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

async function collectPeriod(page: DashboardTarget, period: keyof typeof PERIOD_LABELS, pageSize: number, preferredPageSize: number): Promise<RawTableData> {
  await selectPeriod(page, period);
  if (await confirmDashboardEmptyState(page)) {
    return emptyDashboardTable(period);
  }

  await setDashboardPageSize(page, pageSize);
  await waitForDashboardTargetTableOrEmptyState(page, 30000);
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

async function waitForDashboardTargetTableOrEmptyState(target: DashboardTarget, timeout: number): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await dashboardTargetState(target)) return;
    await waitForDashboardTargetTimeout(target, 1000);
  }
  throw new Error('Dashboard target table or empty-state did not appear within timeout');
}

function dashboardDateFailure(message: string, dataDate: string, displayedValue?: string): Error {
  return new Error(`${message}; dataDate=${dataDate}${displayedValue === undefined ? '' : `; displayedValue=${displayedValue || 'empty'}`}`);
}

function parseDashboardDateParts(dataDate: string): { year: number; month: number; day: number; dayText: string } {
  const [year, month, day] = dataDate.split('-').map(Number);
  return { year, month, day, dayText: String(day) };
}

async function visibleLocator(locator: Locator): Promise<Locator | null> {
  const count = await locator.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  return null;
}

async function readVisibleAntPickerPanelDate(target: DashboardTarget): Promise<{ year: number; month: number } | null> {
  const panelText = await target
    .locator('.ant-picker-panel:visible, .ant-picker-dropdown:not(.ant-picker-dropdown-hidden)')
    .first()
    .innerText({ timeout: 1000 })
    .catch(() => '');
  const normalizedPanel = normalize(panelText);
  const yearMatch = normalizedPanel.match(/(20\d{2}|19\d{2})\s*年?/);
  const monthMatch = normalizedPanel.match(/(?:年\s*)?(1[0-2]|0?[1-9])\s*月/);
  if (!yearMatch || !monthMatch) return null;
  return { year: Number(yearMatch[1]), month: Number(monthMatch[1]) };
}

async function clickVisibleDashboardPickerControl(target: DashboardTarget, selectors: string[], names: RegExp[]): Promise<boolean> {
  for (const selector of selectors) {
    const control = await visibleLocator(target.locator(selector));
    if (control) {
      await control.click();
      return true;
    }
  }

  for (const name of names) {
    const control = await visibleLocator(target.getByRole('button', { name }));
    if (control) {
      await control.click();
      return true;
    }
  }

  return false;
}

async function waitForVisibleDashboardPickerPanel(target: DashboardTarget, dataDate: string): Promise<Locator> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const visiblePanel = await visibleLocator(target.locator('.ant-picker-panel, .ant-picker-dropdown'));
    if (visiblePanel) return visiblePanel;
    await waitForDashboardTargetTimeout(target, 200);
  }
  throw dashboardDateFailure('Dashboard date picker panel was not visible', dataDate);
}

async function alignDashboardDatePickerMonth(target: DashboardTarget, dataDate: string): Promise<void> {
  const { year, month } = parseDashboardDateParts(dataDate);
  const deadline = Date.now() + 30000;

  while (Date.now() < deadline) {
    await waitForVisibleDashboardPickerPanel(target, dataDate);

    const panelDate = await readVisibleAntPickerPanelDate(target);
    if (!panelDate) throw dashboardDateFailure('Dashboard date picker month could not be read', dataDate);
    if (panelDate.year === year && panelDate.month === month) return;

    const panelIndex = panelDate.year * 12 + panelDate.month;
    const requestedIndex = year * 12 + month;
    const useYearJump = Math.abs(requestedIndex - panelIndex) >= 12;
    const clicked = panelIndex > requestedIndex
      ? await clickVisibleDashboardPickerControl(
          target,
          useYearJump ? ['.ant-picker-header-super-prev-btn', '.ant-picker-header-prev-btn'] : ['.ant-picker-header-prev-btn'],
          useYearJump ? [/previous year|上一年/i, /previous month|上个月|prev/i] : [/previous month|上个月|prev/i],
        )
      : await clickVisibleDashboardPickerControl(
          target,
          useYearJump ? ['.ant-picker-header-super-next-btn', '.ant-picker-header-next-btn'] : ['.ant-picker-header-next-btn'],
          useYearJump ? [/next year|下一年/i, /next month|下个月|next/i] : [/next month|下个月|next/i],
        );

    if (!clicked) throw dashboardDateFailure('Dashboard date picker navigation control was not found', dataDate);
    await waitForDashboardTargetTimeout(target, 300);
  }

  throw dashboardDateFailure('Dashboard date picker did not navigate to requested month', dataDate);
}

async function clickDashboardDateCell(target: DashboardTarget, dataDate: string): Promise<void> {
  const { dayText } = parseDashboardDateParts(dataDate);
  const preferredCell = target
    .locator(`td:not(.ant-picker-cell-disabled)[title*="${dataDate}"], td:not(.ant-picker-cell-disabled)[data-value*="${dataDate}"], td:not(.ant-picker-cell-disabled)[aria-label*="${dataDate}"]`)
    .first();
  if ((await preferredCell.count().catch(() => 0)) > 0 && (await preferredCell.isVisible().catch(() => false))) {
    await preferredCell.click();
    return;
  }

  const visibleCells = target.locator('td.ant-picker-cell-in-view:not(.ant-picker-cell-disabled) .ant-picker-cell-inner').filter({ hasText: new RegExp(`^${dayText}$`) });
  const dateCell = await visibleLocator(visibleCells);
  if (!dateCell) throw dashboardDateFailure('Dashboard date picker requested day was not found', dataDate);
  await dateCell.click();
}

async function confirmDashboardDatePickerIfNeeded(target: DashboardTarget): Promise<void> {
  const confirmButton =
    (await visibleLocator(target.getByRole('button', { name: /^(确定|OK)$/i }))) ??
    (await visibleLocator(target.getByText(/^(确定|OK)$/i, { exact: true })));
  if (confirmButton) await confirmButton.click();
}

async function waitForDashboardDateReadback(input: Locator, target: DashboardTarget, dataDate: string): Promise<string> {
  const deadline = Date.now() + 30000;
  let lastValue = '';

  while (Date.now() < deadline) {
    lastValue = await input.inputValue({ timeout: 1000 }).catch(() => '');
    const readback = assessDashboardDateReadback(dataDate, lastValue);
    if (readback.confirmed) return dataDate;
    await waitForDashboardTargetTimeout(target, 1000);
  }

  throw dashboardDateFailure('Dashboard date picker did not confirm requested dataDate', dataDate, lastValue);
}

export async function selectDashboardDataDate(page: Page, target: DashboardTarget, dataDate: string): Promise<string> {
  void page;
  const requestedDate = assertDashboardDataDate(dataDate);
  const input = target.locator('input[placeholder="请选择日期"]').first();

  if ((await input.count().catch(() => 0)) === 0 || !(await input.isVisible().catch(() => false))) {
    throw dashboardDateFailure('Dashboard date picker was not found', requestedDate);
  }

  const currentValue = await input.inputValue({ timeout: 1000 }).catch(() => '');
  if (assessDashboardDateReadback(requestedDate, currentValue).confirmed) return requestedDate;

  const preSelectionState = await captureDashboardObservableState(target);
  const pickerShell = input.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " ant-picker ")][1]');
  if ((await pickerShell.count().catch(() => 0)) > 0 && (await pickerShell.first().isVisible().catch(() => false))) await clickDashboardLocator(pickerShell.first());
  else await clickDashboardLocator(input);

  await alignDashboardDatePickerMonth(target, requestedDate);
  await clickDashboardDateCell(target, requestedDate);
  await confirmDashboardDatePickerIfNeeded(target);
  const refreshAfterSelection = waitForDashboardRefreshAfterDateSelection(target, preSelectionState, requestedDate).then(
    () => null,
    (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
  );
  const confirmedDate = await waitForDashboardDateReadback(input, target, requestedDate);
  const refreshError = await refreshAfterSelection;
  if (refreshError) throw refreshError;
  return confirmedDate;
}
async function collectPeriodWithAdaptivePageSize(page: DashboardTarget, period: keyof typeof PERIOD_LABELS, preferredPageSize: number): Promise<RawTableData> {
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

export { selectSubAccountIfNeeded } from './subAccount.js';

export async function collectDashboardPage(
  config: AgentConfig,
  page: Page,
  options: DashboardCollectOptions = {},
): Promise<DashboardCollectionResult> {
  await page.goto(config.targetUrl, { waitUntil: 'domcontentloaded' });
  await selectSubAccountIfNeeded(page);

  if (page.url().includes('select-identity')) {
    throw new Error('Sub-account selection did not complete. The browser reached the account selection page, but the crawler did not successfully enter the target merchant workspace.');
  }

  await page.waitForURL(/assistant-data-analysis\/index\/product\/list/, { timeout: 180000 }).catch(() => undefined);

  let dashboardTarget: DashboardTarget;
  try {
    dashboardTarget = await waitForTableOrEmptyState(page, 180000);
  } catch {
    throw new Error(await dashboardTimeoutMessage(page));
  }

  const actualPageDate = options.dataDate ? await selectDashboardDataDate(page, dashboardTarget, options.dataDate) : undefined;

  const rawDir = `${config.outputDir}/latest`;
  await mkdir(rawDir, { recursive: true });

  const periods = ['1d', '7d', '30d'] as const;
  if (await confirmDashboardEmptyState(dashboardTarget)) {
    const emptyResults = periods.map((period) => emptyDashboardTable(period));
    for (const table of emptyResults) {
      const path = `${rawDir}/raw-${table.period}.json`;
      await writeFile(path, JSON.stringify(table, null, 2), 'utf8');
      console.log(`[${table.period}] saved ${table.rows.length} rows to ${path}`);
    }
    return { tables: emptyResults, ...(actualPageDate ? { actualPageDate } : {}) };
  }

  const results: RawTableData[] = [];

  for (const period of periods) {
    const table = await collectPeriodWithAdaptivePageSize(dashboardTarget, period, config.preferredPageSize);
    results.push(table);
    const path = `${rawDir}/raw-${period}.json`;
    await writeFile(path, JSON.stringify(table, null, 2), 'utf8');
    console.log(`[${period}] saved ${table.rows.length} rows to ${path}`);
  }

  return { tables: results, ...(actualPageDate ? { actualPageDate } : {}) };
}

export async function crawlDashboard(config: AgentConfig): Promise<RawTableData[]> {
  const { browser, page } = await ensureAuthenticatedMerchantSession(config, { acceptDownloads: false, stage: 'dashboard' });
  let completed = false;

  try {
    const result = await collectDashboardPage(config, page);
    completed = true;
    return result.tables;
  } finally {
    if (completed || !shouldKeepBrowserOpenOnFailure(process.env.MT_AGENT_KEEP_BROWSER_ON_FAILURE)) {
      await browser.close();
    } else {
      console.error('Crawler failed; keeping browser open for inspection. Set MT_AGENT_KEEP_BROWSER_ON_FAILURE=0 to auto-close on failure.');
    }
  }
}
