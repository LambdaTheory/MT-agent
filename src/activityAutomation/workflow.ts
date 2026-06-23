import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { clearBrowserProfileLocks, prepareDashboardPage } from '../crawler/browserProfile.js';
import { selectSubAccountIfNeeded } from '../crawler/dashboardCrawler.js';
import { waitForSettledLoginState } from '../crawler/loginState.js';
import { fillDifferentialPricingDateRanges, type DifferentialPricingDateFillResult } from './dateFilling.js';
import { fillMissingDifferentialPricingDiscounts, type DifferentialPricingDiscountFillResult } from './discountFilling.js';
import { waitForActivityFormShell } from './pageModel.js';
import { pickDifferentialPricingProducts, type DifferentialPricingProductPickResult } from './productPicker.js';
import { scoutActivityFormPage, type ActivityScoutResult } from './scout.js';
import type { ActivityAutomationConfig } from './config.js';

interface ActivityFormAutomationHooks {
  waitForActivityFormShell?: typeof waitForActivityFormShell;
  pickDifferentialPricingProducts?: typeof pickDifferentialPricingProducts;
  fillDifferentialPricingDateRanges?: typeof fillDifferentialPricingDateRanges;
  fillMissingDifferentialPricingDiscounts?: typeof fillMissingDifferentialPricingDiscounts;
  scoutActivityFormPage?: typeof scoutActivityFormPage;
}

export async function runActivityFormAutomation(
  page: Parameters<typeof waitForActivityFormShell>[0],
  config: ActivityAutomationConfig,
  hooks: ActivityFormAutomationHooks = {},
): Promise<ActivityScoutResult> {
  const waitForShell = hooks.waitForActivityFormShell ?? waitForActivityFormShell;
  const pickProducts = hooks.pickDifferentialPricingProducts ?? pickDifferentialPricingProducts;
  const fillDates = hooks.fillDifferentialPricingDateRanges ?? fillDifferentialPricingDateRanges;
  const fillDiscounts = hooks.fillMissingDifferentialPricingDiscounts ?? fillMissingDifferentialPricingDiscounts;
  const scoutPage = hooks.scoutActivityFormPage ?? scoutActivityFormPage;

  await waitForShell(page);

  let productPickResult: DifferentialPricingProductPickResult | undefined;
  let dateFillResult: DifferentialPricingDateFillResult | undefined;
  let discountFillResult: DifferentialPricingDiscountFillResult | undefined;
  if (config.pickProducts) {
    productPickResult = await pickProducts(page);
    await waitForShell(page);
  }

  if (config.draft.startsAt || config.draft.endsAt) {
    dateFillResult = await fillDates(page, config.draft);
  }

  if (config.fillDiscounts && productPickResult) {
    discountFillResult = await fillDiscounts(page, config.draft.discounts);
  }

  const result = await scoutPage(page, config, productPickResult);
  return {
    ...result,
    productPickResult: productPickResult ?? result.productPickResult,
    dateFillResult,
    discountFillResult,
  };
}

export async function prepareActivityFormPage(config: ActivityAutomationConfig): Promise<ActivityScoutResult> {
  await mkdir(config.browserProfileDir, { recursive: true });
  await clearBrowserProfileLocks(config.browserProfileDir);

  const browser = await chromium.launchPersistentContext(config.browserProfileDir, {
    headless: config.headless,
    viewport: { width: 1920, height: 1080 },
  });
  const page = await prepareDashboardPage(browser.pages(), () => browser.newPage());
  let completed = false;

  try {
    await page.goto(config.targetUrl, { waitUntil: 'domcontentloaded' });
    let loginState = await waitForSettledLoginState(page, { timeoutMs: 60000, intervalMs: 1000 });
    if (loginState === 'login-page') {
      console.log('检测到支付宝登录页，请在打开的浏览器窗口扫码登录；差异化定价侦察模块不会发送登录截图或外部通知。');
      await page.waitForURL((currentUrl) => !/auth\.alipay\.com|login/i.test(currentUrl.toString()), { timeout: 300000 });
      loginState = await waitForSettledLoginState(page, { timeoutMs: 60000, intervalMs: 1000 });
    }

    if (loginState === 'select-identity' || page.url().includes('select-identity')) {
      await selectSubAccountIfNeeded(page);
      await page.goto(config.targetUrl, { waitUntil: 'domcontentloaded' });
    }

    const result = await runActivityFormAutomation(page, config);
    completed = true;
    return result;
  } finally {
    if (completed || !config.keepBrowserOnFailure) {
      await browser.close();
    } else {
      console.error('Activity automation scout failed; keeping browser open for inspection. Set keepBrowserOnFailure=false to auto-close on failure.');
    }
  }
}
