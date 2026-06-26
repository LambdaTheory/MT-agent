import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { clearBrowserProfileLocks, prepareDashboardPage } from '../crawler/browserProfile.js';
import { selectSubAccountIfNeeded } from '../crawler/dashboardCrawler.js';
import { waitForSettledLoginState } from '../crawler/loginState.js';
import { loadConfig } from '../config/loadConfig.js';
import {
  chooseCancellationButtonLabel,
  extractActivityListProductIds,
  hydrateActivityCancellationProducts,
  matchesActivityListRow,
  type ActivityCancellationPickProduct,
  type ActivityCancellationProduct,
} from './cancelModel.js';
import {
  ALIPAY_ACTIVITY_LIST_URL,
  activityAutomationConfigFromAgentConfig,
  activityAutomationOutputDir,
} from './config.js';
import { readActivitySubmitSession } from './submitSession.js';

export interface ActivityCancellationRequest {
  submitSessionPath: string;
  productIds: string[];
  mappedCount: number;
  startsAt?: string;
  endsAt?: string;
  allowAnyVisibleProduct?: boolean;
}

export interface ActivityCancellationAssistanceResult {
  openedUrl: string;
  requiresManualLogin: boolean;
  lines: string[];
  cancelled?: boolean;
}

export interface ActivityCancellationAssistant {
  open(request: ActivityCancellationRequest): Promise<ActivityCancellationAssistanceResult>;
}

interface ActivityListRowRuntimeSnapshot {
  rowIndex: number;
  rowKey: string;
  productName: string;
  activityTime: string;
  status: string;
  operationText: string;
  operationLabels: string[];
  rowText: string;
  platformProductIds: string[];
  merchantProductIds: string[];
  internalProductIds: string[];
  checkboxDisabled: boolean;
  dataAttributes: Record<string, string>;
}

const ACTIVITY_LIST_HEADERS = ['商品名称', '活动时间', '商品状态', '操作'];
const EMPTY_ACTIVITY_ROW_MARKERS = ['暂无数据'];
const activeCancellationBrowsers = new Set<BrowserContext>();

function normalizeText(value: string | null | undefined): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isLoginUrl(url: string): boolean {
  return /auth\.alipay\.com|login/i.test(url);
}

function pageStillNeedsManualIntervention(url: string): boolean {
  return isLoginUrl(url) || url.includes('select-identity');
}

function isActivityToolLandingPageText(text: string): boolean {
  const normalized = normalizeText(text);
  return normalized.includes('工具特点') && normalized.includes('工具要求');
}

function trackCancellationBrowser(browser: BrowserContext): void {
  activeCancellationBrowsers.add(browser);
  browser.on('close', () => {
    activeCancellationBrowsers.delete(browser);
  });
}

function chooseConfirmButtonLabel(labels: string[]): string | null {
  const patterns: Array<[RegExp, number]> = [
    [/确认移除/u, 720],
    [/确认删除/u, 700],
    [/确认取消/u, 600],
    [/确定/u, 520],
    [/移除/u, 510],
    [/删除/u, 505],
    [/确认/u, 500],
    [/提交/u, 320],
  ];
  return labels
    .map((label) => normalizeText(label))
    .filter((label) => label.length > 0 && patterns.some(([pattern]) => pattern.test(label)))
    .sort((left, right) => {
      const leftScore = patterns.find(([pattern]) => pattern.test(left))?.[1] ?? -1;
      const rightScore = patterns.find(([pattern]) => pattern.test(right))?.[1] ?? -1;
      return rightScore - leftScore;
    })[0]
    ?? null;
}

export function deriveActivityListUrl(submittedUrl: string): string {
  try {
    const url = new URL(submittedUrl);
    const productCode = url.searchParams.get('productCode') ?? undefined;
    const listUrl = new URL(ALIPAY_ACTIVITY_LIST_URL);
    if (productCode) listUrl.searchParams.set('productCode', productCode);
    return listUrl.toString();
  } catch {
    return ALIPAY_ACTIVITY_LIST_URL;
  }
}

async function readCancellationProducts(
  submitSession: Awaited<ReturnType<typeof readActivitySubmitSession>>,
): Promise<ActivityCancellationProduct[]> {
  if (submitSession.products.some((product) => product.productName?.trim())) return submitSession.products;
  if (!submitSession.productPickSessionPath) return submitSession.products;
  try {
    const picked = JSON.parse(await readFile(submitSession.productPickSessionPath, 'utf8')) as {
      products?: ActivityCancellationPickProduct[];
    };
    return hydrateActivityCancellationProducts(submitSession.products, picked.products ?? []);
  } catch {
    return submitSession.products;
  }
}

async function waitForManualLoginAndSubAccount(
  page: Page,
  targetUrl: string,
  lines: string[],
): Promise<{ requiresManualLogin: boolean }> {
  let loginState = await waitForSettledLoginState(page, {
    timeoutMs: 15000,
    intervalMs: 1000,
    loginPageGraceMs: 3000,
  });

  if (loginState === 'login-page') {
    lines.push('当前进入支付宝登录页，等待手动登录。');
    await page.waitForURL((currentUrl) => !isLoginUrl(currentUrl.toString()), { timeout: 300000 });
    loginState = await waitForSettledLoginState(page, {
      timeoutMs: 60000,
      intervalMs: 1000,
      loginPageGraceMs: 3000,
    });
  }

  if (loginState === 'select-identity' || page.url().includes('select-identity')) {
    lines.push('已进入子账号选择页，正在尝试切换到目标商家。');
    await selectSubAccountIfNeeded(page);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    loginState = await waitForSettledLoginState(page, {
      timeoutMs: 60000,
      intervalMs: 1000,
      loginPageGraceMs: 3000,
    });
  }

  return {
    requiresManualLogin: loginState === 'login-page' || pageStillNeedsManualIntervention(page.url()),
  };
}

async function openActivityListPage(page: Page, submittedUrl: string): Promise<string> {
  const listUrl = deriveActivityListUrl(submittedUrl);
  const triggers = [
    page.getByText('返回活动列表', { exact: false }).first(),
    page.getByText('活动列表', { exact: false }).first(),
  ];

  for (const trigger of triggers) {
    try {
      if (await trigger.count().catch(() => 0)) {
        await trigger.click({ timeout: 5000 });
        await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => undefined);
        return page.url() || listUrl;
      }
    } catch {
      // fall through
    }
  }

  if (page.url() !== listUrl) {
    await page.goto(listUrl, { waitUntil: 'domcontentloaded' });
  }

  const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  if (isActivityToolLandingPageText(bodyText)) {
    const submitted = new URL(submittedUrl);
    const appId = submitted.searchParams.get('appId');
    const productCode = submitted.searchParams.get('productCode');
    if (appId && productCode) {
      const alternateUrl = `https://b.alipay.com/page/commodity-operation/activity/list?appId=${encodeURIComponent(appId)}&productCode=${encodeURIComponent(productCode)}`;
      await page.goto(alternateUrl, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    }
  }
  return page.url() || listUrl;
}

async function waitForActivityListTable(page: Page): Promise<void> {
  await page.waitForFunction(
    `({ headers }) => {
      const bodyText = String(document.body?.innerText ?? '').replace(/\\s+/g, ' ').trim();
      return headers.every((header) => bodyText.includes(header));
    }`,
    { headers: ACTIVITY_LIST_HEADERS },
    { timeout: 30000 },
  );
}

async function readActivityListRows(page: Page): Promise<ActivityListRowRuntimeSnapshot[]> {
  const headersJson = JSON.stringify(ACTIVITY_LIST_HEADERS);
  return page.evaluate(
    `(() => {
      const headers = ${headersJson};
      const normalize = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
      const isVisible = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const tables = Array.from(document.querySelectorAll('table')).filter((table) => {
        if (!isVisible(table)) return false;
        const headerText = Array.from(table.querySelectorAll('thead th')).map((node) => normalize(node.textContent));
        return headers.every((header) => headerText.some((value) => value.includes(header)));
      });
      return tables.flatMap((table) => {
        const headerTexts = Array.from(table.querySelectorAll('thead th')).map((node) => normalize(node.textContent));
        const findHeaderIndex = (keyword) => headerTexts.findIndex((value) => value.includes(keyword));
        const productNameIndex = findHeaderIndex('商品名称');
        const activityTimeIndex = findHeaderIndex('活动时间');
        const statusIndex = findHeaderIndex('商品状态');
        const operationIndex = findHeaderIndex('操作');

        return Array.from(table.querySelectorAll('tbody tr')).map((row, rowIndex) => {
          const cells = Array.from(row.querySelectorAll('td'));
          const operationCell = operationIndex >= 0 ? cells[operationIndex] : undefined;
          const operationLabels = operationCell
            ? Array.from(operationCell.querySelectorAll('button, a, [role="button"]'))
                .map((node) => normalize(node.textContent))
                .filter(Boolean)
            : [];
          const checkbox = row.querySelector('input.ant-checkbox-input, input[type="checkbox"]');
          const dataAttributes = Object.fromEntries(
            Array.from(row.attributes)
              .filter((attribute) => attribute.name.startsWith('data-'))
              .map((attribute) => [attribute.name, attribute.value]),
          );
          return {
            rowIndex,
            rowKey: row.getAttribute('data-row-key') ?? '',
            productName: productNameIndex >= 0 ? normalize(cells[productNameIndex]?.textContent) : '',
            activityTime: activityTimeIndex >= 0 ? normalize(cells[activityTimeIndex]?.textContent) : '',
            status: statusIndex >= 0 ? normalize(cells[statusIndex]?.textContent) : '',
            operationText: operationLabels.join(' '),
            operationLabels,
            rowText: normalize(row.textContent),
            platformProductIds: [],
            merchantProductIds: [],
            internalProductIds: [],
            checkboxDisabled: checkbox instanceof HTMLInputElement ? checkbox.disabled : false,
            dataAttributes,
          };
        });
      });
    })()`,
  );
}

function enrichActivityListRows(rows: ActivityListRowRuntimeSnapshot[]): ActivityListRowRuntimeSnapshot[] {
  return rows.map((row) => {
    const extracted = extractActivityListProductIds(`${row.productName} ${row.rowText}`);
    return {
      ...row,
      platformProductIds: extracted.platformProductIds,
      merchantProductIds: extracted.merchantProductIds,
      internalProductIds: extracted.internalProductIds,
    };
  });
}

function isEmptyActivityListRow(row: ActivityListRowRuntimeSnapshot): boolean {
  if (row.productName || row.activityTime || row.status || row.operationLabels.length > 0) return false;
  const normalizedText = normalizeText(row.rowText);
  return normalizedText.length === 0 || EMPTY_ACTIVITY_ROW_MARKERS.some((marker) => normalizedText.includes(marker));
}

function hasMeaningfulActivityRows(rows: ActivityListRowRuntimeSnapshot[]): boolean {
  return rows.some((row) => !isEmptyActivityListRow(row));
}

async function waitForActivityListRows(page: Page): Promise<ActivityListRowRuntimeSnapshot[]> {
  const deadline = Date.now() + 30000;
  let latestRows: ActivityListRowRuntimeSnapshot[] = [];

  while (Date.now() < deadline) {
    latestRows = enrichActivityListRows(await readActivityListRows(page));
    if (hasMeaningfulActivityRows(latestRows)) return latestRows;
    await page.waitForTimeout(2000);
  }

  return latestRows;
}

function activityListRowSignature(rows: ActivityListRowRuntimeSnapshot[]): string {
  return rows.map((row) => row.rowKey || row.rowText).join(' | ');
}

async function hasNextActivityListPage(page: Page): Promise<boolean> {
  const headersJson = JSON.stringify(ACTIVITY_LIST_HEADERS);
  return page.evaluate(
    `(() => {
      const headers = ${headersJson};
      const normalize = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
      const isVisible = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const table = Array.from(document.querySelectorAll('table')).find((candidate) => {
        if (!isVisible(candidate)) return false;
        const headerText = Array.from(candidate.querySelectorAll('thead th')).map((node) => normalize(node.textContent));
        return headers.every((header) => headerText.some((value) => value.includes(header)));
      });
      const wrapper = table?.closest('.ant-table-wrapper');
      const nextButton = wrapper?.querySelector('.ant-pagination-next:not(.ant-pagination-disabled) button, .ant-pagination-next:not(.ant-pagination-disabled)');
      return nextButton instanceof HTMLElement && isVisible(nextButton);
    })()`,
  );
}

async function goToNextActivityListPage(page: Page, previousSignature: string): Promise<boolean> {
  const headersJson = JSON.stringify(ACTIVITY_LIST_HEADERS);
  const clicked = await page.evaluate(
    `(() => {
      const headers = ${headersJson};
      const normalize = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
      const isVisible = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const table = Array.from(document.querySelectorAll('table')).find((candidate) => {
        if (!isVisible(candidate)) return false;
        const headerText = Array.from(candidate.querySelectorAll('thead th')).map((node) => normalize(node.textContent));
        return headers.every((header) => headerText.some((value) => value.includes(header)));
      });
      const wrapper = table?.closest('.ant-table-wrapper');
      const nextButton = wrapper?.querySelector('.ant-pagination-next:not(.ant-pagination-disabled) button, .ant-pagination-next:not(.ant-pagination-disabled)');
      if (!(nextButton instanceof HTMLElement) || !isVisible(nextButton)) return false;
      nextButton.click();
      return true;
    })()`,
  );
  if (!clicked) return false;

  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1500);
    const rows = await waitForActivityListRows(page);
    if (activityListRowSignature(rows) !== previousSignature) return true;
  }
  return false;
}

async function findTargetRowsOnActivityListPage(
  page: Page,
  input: { products: ActivityCancellationProduct[]; startsAt?: string; endsAt?: string },
  lines: string[],
): Promise<{ rows: ActivityListRowRuntimeSnapshot[]; matchedRows: ActivityListRowRuntimeSnapshot[]; pageNumber: number }> {
  const seenSignatures = new Set<string>();
  let lastRows: ActivityListRowRuntimeSnapshot[] = [];

  for (let pageNumber = 1; pageNumber <= 30; pageNumber += 1) {
    const rows = await waitForActivityListRows(page);
    const signature = activityListRowSignature(rows);
    if (signature && seenSignatures.has(signature)) {
      lines.push(`活动列表第 ${pageNumber} 页与前页内容重复，停止继续翻页。`);
      return {
        rows,
        matchedRows: rows.filter((row) => matchesActivityListRow(row, input)),
        pageNumber,
      };
    }

    if (signature) seenSignatures.add(signature);
    lastRows = rows;

    const matchedRows = rows.filter((row) => matchesActivityListRow(row, input));
    lines.push(`活动列表第 ${pageNumber} 页：${rows.length} 行，匹配 ${matchedRows.length} 行。`);
    if (matchedRows.length > 0) {
      return { rows, matchedRows, pageNumber };
    }

    if (!(await hasNextActivityListPage(page))) {
      return { rows, matchedRows, pageNumber };
    }

    if (!(await goToNextActivityListPage(page, signature))) {
      lines.push(`活动列表第 ${pageNumber} 页翻页未生效，停止继续翻页。`);
      return { rows, matchedRows, pageNumber };
    }
  }

  return {
    rows: lastRows,
    matchedRows: lastRows.filter((row) => matchesActivityListRow(row, input)),
    pageNumber: Math.min(seenSignatures.size || 1, 30),
  };
}

async function clickActivityRowCheckbox(page: Page, row: ActivityListRowRuntimeSnapshot): Promise<void> {
  const headersJson = JSON.stringify(ACTIVITY_LIST_HEADERS);
  const rowIndexJson = JSON.stringify(row.rowIndex);
  const rowKeyJson = JSON.stringify(row.rowKey);
  await page.evaluate(
    `(() => {
      const headers = ${headersJson};
      const rowIndex = ${rowIndexJson};
      const rowKey = ${rowKeyJson};
      const normalize = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
      const tables = Array.from(document.querySelectorAll('table')).filter((table) => {
        const headerText = Array.from(table.querySelectorAll('thead th')).map((node) => normalize(node.textContent));
        return headers.every((header) => headerText.some((value) => value.includes(header)));
      });
      const table = tables[0];
      const runtimeRows = Array.from(table?.querySelectorAll('tbody tr') ?? []);
      const target = runtimeRows.find((candidate) => candidate.getAttribute('data-row-key') === rowKey) ?? runtimeRows[rowIndex];
      const checkbox = target?.querySelector('input.ant-checkbox-input, input[type="checkbox"]');
      if (checkbox instanceof HTMLInputElement && !checkbox.checked && !checkbox.disabled) checkbox.click();
    })()`,
  );
}

async function clickRowOperation(page: Page, row: ActivityListRowRuntimeSnapshot, label: string): Promise<boolean> {
  const headersJson = JSON.stringify(ACTIVITY_LIST_HEADERS);
  const rowIndexJson = JSON.stringify(row.rowIndex);
  const rowKeyJson = JSON.stringify(row.rowKey);
  const labelJson = JSON.stringify(label);
  return page.evaluate(
    `(() => {
      const headers = ${headersJson};
      const rowIndex = ${rowIndexJson};
      const rowKey = ${rowKeyJson};
      const label = ${labelJson};
      const normalize = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
      const tables = Array.from(document.querySelectorAll('table')).filter((table) => {
        const headerText = Array.from(table.querySelectorAll('thead th')).map((node) => normalize(node.textContent));
        return headers.every((header) => headerText.some((value) => value.includes(header)));
      });
      const table = tables[0];
      const runtimeRows = Array.from(table?.querySelectorAll('tbody tr') ?? []);
      const target = runtimeRows.find((candidate) => candidate.getAttribute('data-row-key') === rowKey) ?? runtimeRows[rowIndex];
      const control = Array.from(target?.querySelectorAll('button, a, [role="button"]') ?? [])
        .find((node) => normalize(node.textContent) === label);
      if (!(control instanceof HTMLElement)) return false;
      control.click();
      return true;
    })()`,
  );
}

async function readVisibleButtonLabels(page: Page): Promise<string[]> {
  return page.evaluate(
    `(() => Array.from(document.querySelectorAll('button, a, [role="button"]'))
      .filter((node) => node instanceof HTMLElement && node.offsetParent !== null && getComputedStyle(node).visibility !== 'hidden')
      .map((node) => String(node.textContent ?? node.getAttribute('aria-label') ?? '').replace(/\\s+/g, ' ').trim())
      .filter(Boolean))()`,
  );
}

async function clickVisibleButtonByLabel(page: Page, label: string): Promise<void> {
  await page.locator('button, a, [role="button"]').filter({ hasText: new RegExp(`^${escapeRegExp(label)}$|${escapeRegExp(label)}`) }).first().click({ timeout: 10000 });
}

async function clickVisibleDialogButtonByLabel(page: Page, label: string): Promise<void> {
  await page.locator('.ant-modal button, [role="dialog"] button, .ant-popover button, .ant-popconfirm button, .ant-popconfirm-buttons button')
    .filter({ hasText: new RegExp(`^${escapeRegExp(label)}$|${escapeRegExp(label)}`) })
    .first()
    .click({ timeout: 10000 });
}

async function clickDialogPrimaryAction(page: Page): Promise<string | null> {
  const selectors = [
    '.ant-modal-confirm-btns .ant-btn-primary',
    '.ant-modal-footer .ant-btn-primary',
    '.ant-popconfirm-buttons .ant-btn-primary',
    '.ant-modal-confirm-btns button:last-child',
    '.ant-modal-footer button:last-child',
    '.ant-popconfirm-buttons button:last-child',
  ];

  for (const selector of selectors) {
    const button = page.locator(selector).last();
    const count = await button.count().catch(() => 0);
    if (count === 0) continue;
    const visible = await button.isVisible().catch(() => false);
    if (!visible) continue;
    const label = normalizeText(await button.textContent().catch(() => ''));
    await button.click({ timeout: 5000 }).catch(() => undefined);
    return label || '确认';
  }

  return null;
}

async function clickVisibleDialogText(page: Page): Promise<string | null> {
  const patterns: Array<[RegExp, string]> = [
    [/确认移除/u, '确认移除'],
    [/确认删除/u, '确认删除'],
    [/确定/u, '确定'],
    [/确认/u, '确认'],
  ];

  for (const [pattern, label] of patterns) {
    const locator = page
      .locator('.ant-modal, [role="dialog"], .ant-popover, .ant-popconfirm, .ant-popconfirm-buttons')
      .locator('*')
      .filter({ hasText: pattern })
      .last();
    const count = await locator.count().catch(() => 0);
    if (count === 0) continue;
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) continue;
    await locator.click({ timeout: 5000 }).catch(() => undefined);
    return label;
  }
  return null;
}

async function confirmCancellationDialog(page: Page): Promise<string | null> {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const primaryAction = await clickDialogPrimaryAction(page);
    if (primaryAction) return primaryAction;

    const labels = await page.evaluate<string[]>(
      `(() => Array.from(document.querySelectorAll('.ant-modal button, [role="dialog"] button, .ant-popover button, .ant-popconfirm button, .ant-popconfirm-buttons button'))
        .filter((node) => node instanceof HTMLElement && node.offsetParent !== null && getComputedStyle(node).visibility !== 'hidden')
        .map((node) => String(node.textContent ?? '').replace(/\\s+/g, ' ').trim())
        .filter(Boolean))()`,
    ).catch(() => []);
    const confirmLabel = chooseConfirmButtonLabel(labels);
    if (confirmLabel) {
      await clickVisibleDialogButtonByLabel(page, confirmLabel);
      return confirmLabel;
    }
    const fallbackLabel = await clickVisibleDialogText(page);
    if (fallbackLabel) return fallbackLabel;
    await page.waitForTimeout(500);
  }
  return null;
}

async function captureActivityListArtifacts(
  outputDir: string,
  page: Page,
  rows: ActivityListRowRuntimeSnapshot[],
): Promise<{ rowsPath: string; bodyPath: string }> {
  const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  const artifactDir = activityAutomationOutputDir({ outputDir });
  await mkdir(artifactDir, { recursive: true });
  const rowsPath = join(artifactDir, 'activity-cancel-list-rows.json');
  const bodyPath = join(artifactDir, 'activity-cancel-list-body.txt');
  await writeFile(rowsPath, `${JSON.stringify({
    capturedAt: new Date().toISOString(),
    url: page.url(),
    rowCount: rows.length,
    rows,
  }, null, 2)}\n`, 'utf8');
  await writeFile(bodyPath, `${bodyText}\n`, 'utf8');
  return { rowsPath, bodyPath };
}

async function captureActivityDialogArtifacts(
  outputDir: string,
  page: Page,
  prefix: string,
): Promise<void> {
  const artifactDir = activityAutomationOutputDir({ outputDir });
  await mkdir(artifactDir, { recursive: true });
  const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  await writeFile(join(artifactDir, `${prefix}.txt`), `${bodyText}\n`, 'utf8');
  await page.screenshot({ path: join(artifactDir, `${prefix}.png`), fullPage: true }).catch(() => undefined);
}

async function verifyCancellationResult(
  page: Page,
  input: { outputDir: string; products: ActivityCancellationProduct[]; startsAt?: string; endsAt?: string },
  expectedMatchedCount: number,
  lines: string[],
): Promise<boolean> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.waitForTimeout(2500);
    if (attempt > 1) {
      await page.goto(page.url(), { waitUntil: 'domcontentloaded' }).catch(() => undefined);
      await page.waitForTimeout(1500);
    }

    await waitForActivityListTable(page);
    const { rows, matchedRows, pageNumber } = await findTargetRowsOnActivityListPage(page, input, []);
    await captureActivityListArtifacts(input.outputDir, page, rows);
    lines.push(`取消回查第 ${attempt} 次：当前页 ${pageNumber}，匹配 ${matchedRows.length}/${expectedMatchedCount} 行。`);

    if (matchedRows.length === 0) return true;
  }

  return false;
}

async function verifyRowRemovedFromCurrentPage(
  page: Page,
  outputDir: string,
  rowKey: string,
  lines: string[],
): Promise<boolean> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.waitForTimeout(2500);
    if (attempt > 1) {
      await page.goto(page.url(), { waitUntil: 'domcontentloaded' }).catch(() => undefined);
      await page.waitForTimeout(1500);
    }

    await waitForActivityListTable(page);
    const rows = await waitForActivityListRows(page);
    await captureActivityListArtifacts(outputDir, page, rows);
    const stillVisible = rows.some((row) => row.rowKey === rowKey);
    lines.push(`单条回查第 ${attempt} 次：rowKey=${rowKey} ${stillVisible ? '仍可见' : '已消失'}。`);
    if (!stillVisible) return true;
  }

  return false;
}

async function attemptAutomatedCancellation(
  page: Page,
  input: {
    outputDir: string;
    products: ActivityCancellationProduct[];
    startsAt?: string;
    endsAt?: string;
    allowAnyVisibleProduct?: boolean;
  },
): Promise<{ lines: string[]; cancelled: boolean }> {
  const lines = ['开始尝试读取活动列表表格。'];
  let stage = 'init';

  try {
    stage = 'gotoActivityList';
    const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
    if (isActivityToolLandingPageText(bodyText)) {
      throw new Error('当前仍停留在差异化定价工具首页，未进入活动列表表格页。');
    }

    stage = 'waitForActivityListTable';
    await waitForActivityListTable(page);
    lines.push('已检测到活动列表表头。');

    stage = 'readActivityListRows';
    const { rows, matchedRows, pageNumber } = await findTargetRowsOnActivityListPage(page, input, lines);
    lines.push(`已读取列表行数据：${rows.length} 行。`);

    stage = 'captureActivityListArtifacts';
    const artifacts = await captureActivityListArtifacts(input.outputDir, page, rows);
    lines.push(`活动列表行数: ${rows.length}`);
    lines.push(`匹配到的目标行: ${matchedRows.length}`);
    lines.push(`当前停留页码: ${pageNumber}`);
    lines.push(`列表快照: ${artifacts.rowsPath}`);

    const anyVisibleRows = input.allowAnyVisibleProduct
      ? rows.filter((row) => Boolean(chooseCancellationButtonLabel(row.operationLabels)))
      : [];
    const effectiveRows = input.allowAnyVisibleProduct
      ? anyVisibleRows.slice(0, 1)
      : matchedRows;

    if (matchedRows.length === 0 || input.allowAnyVisibleProduct) {
      if (effectiveRows.length > 0) {
        lines.push(`切换为 MVP 模式，尝试取消当前页任意 1 条可移除活动。`);
      } else {
        const visibleNames = rows
          .slice(0, 5)
          .map((row) => `${row.productName}${row.platformProductIds[0] ? ` [${row.platformProductIds[0]}]` : ''}`)
          .filter(Boolean)
          .join(' | ');
        lines.push(`当前可见商品: ${visibleNames || '无'}`);
        return { lines, cancelled: false };
      }
    }

    if (effectiveRows.length === 1 || input.allowAnyVisibleProduct) {
      const targetRow = effectiveRows[0];
      if (!targetRow) return { lines, cancelled: false };
      stage = 'clickSingleRowOperation';
      const rowActionLabel = chooseCancellationButtonLabel(targetRow.operationLabels ?? []);
      if (rowActionLabel) {
        const clicked = await clickRowOperation(page, targetRow, rowActionLabel);
        if (clicked) {
          lines.push(`已点击行内操作: ${rowActionLabel}`);
          stage = 'confirmSingleRowOperation';
          const confirmLabel = await confirmCancellationDialog(page);
          if (!confirmLabel) {
            lines.push('未检测到确认移除按钮，单行取消未完成。');
            return { lines, cancelled: false };
          }
          lines.push(`已点击确认按钮: ${confirmLabel}`);
          stage = 'verifySingleRowCancellation';
          const verified = input.allowAnyVisibleProduct
            ? await verifyRowRemovedFromCurrentPage(page, input.outputDir, targetRow.rowKey, lines)
            : await verifyCancellationResult(page, input, 1, lines);
          if (!verified) {
            lines.push('取消回查未通过，目标活动仍可见。');
            return { lines, cancelled: false };
          }
          lines.push('取消回查通过，目标活动已从列表消失。');
          return { lines, cancelled: true };
        }
      }
    }

    if (matchedRows.length === 0 || input.allowAnyVisibleProduct) {
      const visibleNames = rows
        .slice(0, 5)
        .map((row) => `${row.productName}${row.platformProductIds[0] ? ` [${row.platformProductIds[0]}]` : ''}`)
        .filter(Boolean)
        .join(' | ');
      lines.push(`当前可见商品: ${visibleNames || '无'}`);
      return { lines, cancelled: false };
    }

    stage = 'clickRowCheckboxes';
    for (const row of matchedRows) {
      await clickActivityRowCheckbox(page, row);
    }
    lines.push(`已勾选目标行: ${matchedRows.length}`);

    stage = 'readVisibleButtons';
    const visibleButtons = await readVisibleButtonLabels(page);
    const batchLabel = chooseCancellationButtonLabel(visibleButtons);
    if (!batchLabel) {
      lines.push(`当前可点击按钮: ${visibleButtons.slice(0, 10).join(' | ') || '无'}`);
      return { lines, cancelled: false };
    }

    stage = 'clickBatchCancel';
    await clickVisibleButtonByLabel(page, batchLabel);
    lines.push(`已点击批量取消按钮: ${batchLabel}`);
    await captureActivityDialogArtifacts(input.outputDir, page, 'activity-cancel-confirm-dialog');

    stage = 'confirmBatchCancel';
    const confirmLabel = await confirmCancellationDialog(page);
    if (!confirmLabel) {
      lines.push('未检测到确认移除按钮，批量取消未完成。');
      return { lines, cancelled: false };
    }
    lines.push(`已点击确认按钮: ${confirmLabel}`);
    stage = 'verifyBatchCancellation';
    const verified = await verifyCancellationResult(page, input, matchedRows.length, lines);
    if (!verified) {
      lines.push('取消回查未通过，目标活动仍可见。');
      return { lines, cancelled: false };
    }
    lines.push('取消回查通过，目标活动已从列表消失。');
    return { lines, cancelled: true };
  } catch (error) {
    lines.push(`阶段 ${stage} 执行失败：${error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)}`);
    return { lines, cancelled: false };
  }
}

export function createActivityCancellationAssistant(): ActivityCancellationAssistant {
  return {
    async open(request) {
      const agentConfig = await loadConfig();
      const config = activityAutomationConfigFromAgentConfig(agentConfig, {
        headless: false,
        keepBrowserOnFailure: true,
      });
      const submitSession = await readActivitySubmitSession(request.submitSessionPath);
      const cancellationProducts = await readCancellationProducts(submitSession);

      await mkdir(config.browserProfileDir, { recursive: true });
      await clearBrowserProfileLocks(config.browserProfileDir);

      const browser = await chromium.launchPersistentContext(config.browserProfileDir, {
        headless: false,
        viewport: { width: 1920, height: 1080 },
      });
      trackCancellationBrowser(browser);

      const page = await prepareDashboardPage(browser.pages(), () => browser.newPage());
      const lines = ['已在本机打开差异化定价活动列表页，准备尝试自动取消。'];

      try {
        await page.goto(submitSession.submittedUrl, { waitUntil: 'domcontentloaded' });
        const login = await waitForManualLoginAndSubAccount(page, submitSession.submittedUrl, lines);
        const openedUrl = await openActivityListPage(page, submitSession.submittedUrl);
        lines.push('已尝试进入差异化定价活动列表页。');

        const readyForAutomation = !pageStillNeedsManualIntervention(openedUrl);
        if (readyForAutomation) {
          const automated = await attemptAutomatedCancellation(page, {
            outputDir: config.outputDir,
            products: cancellationProducts,
            startsAt: request.startsAt,
            endsAt: request.endsAt,
            allowAnyVisibleProduct: request.allowAnyVisibleProduct,
          });
          lines.push(...automated.lines);
          if (automated.cancelled) {
            lines.push('已完成自动取消尝试。');
            return {
              openedUrl,
              requiresManualLogin: false,
              lines,
              cancelled: true,
            };
          }
        }

        if (!submitSession.activityId) {
          lines.push('提交记录里没有捕获到活动 ID，请在活动列表页按商品名称或活动时间辅助核对。');
        }
        lines.push(login.requiresManualLogin
          ? '请先在已打开的浏览器中完成登录与子账号切换，脚本才能继续抓取活动列表。'
          : '自动取消尚未完全确认，请在已打开的活动列表页继续检查并补充确认。');

        return {
          openedUrl,
          requiresManualLogin: !readyForAutomation,
          lines,
          cancelled: false,
        };
      } catch (error) {
        lines.push(`浏览器已打开，但页面定位未完成：${error instanceof Error ? error.message : String(error)}`);
        lines.push('请在已打开的浏览器窗口中继续检查并完成取消。');
        return {
          openedUrl: page.url() || deriveActivityListUrl(submitSession.submittedUrl),
          requiresManualLogin: true,
          lines,
          cancelled: false,
        };
      }
    },
  };
}
