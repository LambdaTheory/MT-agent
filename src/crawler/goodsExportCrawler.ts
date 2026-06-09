import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { chromium, type BrowserContext, type Locator, type Page } from 'playwright';
import type { AgentConfig } from '../domain/types.js';
import { clearBrowserProfileLocks, prepareDashboardPage } from './browserProfile.js';
import { selectSubAccountIfNeeded } from './dashboardCrawler.js';
import { shouldKeepBrowserOpenOnFailure } from './failureHandling.js';
import { waitForSettledLoginState } from './loginState.js';

const EXPORT_MENU_MATCHERS = [/导出/, /下载/];
const SELECTED_ONLY_MATCHERS = [/已选/, /选中/];

export function findGoodsExportMenuText(texts: string[]): string | null {
  const normalized = texts.map((text) => text.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return (
    normalized.find((text) => /全部/.test(text) && EXPORT_MENU_MATCHERS.some((matcher) => matcher.test(text)))
    ?? normalized.find((text) => EXPORT_MENU_MATCHERS.some((matcher) => matcher.test(text)) && !SELECTED_ONLY_MATCHERS.some((matcher) => matcher.test(text)))
    ?? null
  );
}

async function visibleTexts(locator: Locator): Promise<string[]> {
  return locator.evaluateAll((nodes) => nodes.map((node) => String(node.textContent ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean));
}

async function visibleExportMenuTexts(page: Page): Promise<string[]> {
  const menuItems = page.locator('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item, .ant-dropdown:not(.ant-dropdown-hidden) li');
  try {
    await menuItems.first().waitFor({ state: 'visible', timeout: 3000 });
  } catch {
    return [];
  }

  return visibleTexts(menuItems);
}

async function clickExportMenuItem(page: Page): Promise<void> {
  const menuItems = page.locator('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item:not(.ant-dropdown-menu-item-disabled), .ant-dropdown:not(.ant-dropdown-hidden) li:not(.ant-dropdown-menu-item-disabled)');
  const texts = await visibleExportMenuTexts(page);
  const targetText = findGoodsExportMenuText(texts);
  if (!targetText) {
    throw new Error(`Could not find goods export menu item. Visible menu items: ${texts.join(' | ')}`);
  }

  await menuItems.filter({ hasText: targetText }).first().click();
}

async function clickExportDropdown(page: Page): Promise<void> {
  const dropdowns = page.locator('.ant-btn.ant-dropdown-trigger, .ant-dropdown-trigger');
  const count = await dropdowns.count();

  for (let index = 0; index < count; index += 1) {
    const dropdown = dropdowns.nth(index);
    if (!(await dropdown.isVisible().catch(() => false))) {
      continue;
    }

    await dropdown.click();
    const texts = await visibleExportMenuTexts(page);
    if (findGoodsExportMenuText(texts)) {
      return;
    }

    await page.keyboard.press('Escape').catch(() => undefined);
  }

  const bodyText = (await page.locator('body').textContent().catch(() => '')) ?? '';
  throw new Error(`Could not find a goods export dropdown among ${count} dropdown triggers. url=${page.url()} visibleText=${bodyText.replace(/\s+/g, ' ').trim().slice(0, 1000)}`);
}

async function prepareGoodsExportPage(config: AgentConfig, browser: BrowserContext, page: Page): Promise<void> {
  const url = config.goodsExportUrl ?? 'https://b.alipay.com/page/commerce/goods/list?itemSubType=RENT&itemType=NORMAL_ITEM';
  await page.goto(config.targetUrl, { waitUntil: 'domcontentloaded' });

  let loginState = await waitForSettledLoginState(page, { timeoutMs: 60000, intervalMs: 1000 });
  if (loginState === 'login-page') {
    console.log('检测到支付宝登录页，请在打开的浏览器窗口扫码登录；登录成功后程序会自动继续下载商品总表。');
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

  await page.waitForSelector('.ant-table, .ant-table-wrapper, table', { timeout: 180000 });
  await browser.pages()[0]?.waitForTimeout(1000);
}

export async function downloadGoodsExport(config: AgentConfig, outputPath = 'output/latest/goods-export.xlsx'): Promise<string> {
  await mkdir(config.browserProfileDir, { recursive: true });
  await mkdir(dirname(outputPath), { recursive: true });
  await clearBrowserProfileLocks(config.browserProfileDir);

  const browser = await chromium.launchPersistentContext(config.browserProfileDir, { acceptDownloads: true, headless: false });
  const page = await prepareDashboardPage(browser.pages(), () => browser.newPage());
  let completed = false;

  try {
    await prepareGoodsExportPage(config, browser, page);

    const downloadPromise = page.waitForEvent('download', { timeout: 180000 });
    await clickExportDropdown(page);
    await clickExportMenuItem(page);
    const download = await downloadPromise;
    await download.saveAs(outputPath);

    completed = true;
    return outputPath;
  } finally {
    if (completed || !shouldKeepBrowserOpenOnFailure(process.env.MT_AGENT_KEEP_BROWSER_ON_FAILURE)) {
      await browser.close();
    } else {
      console.error('Goods export failed; keeping browser open for inspection. Set MT_AGENT_KEEP_BROWSER_ON_FAILURE=0 to auto-close on failure.');
    }
  }
}
