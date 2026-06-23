import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import type { AgentConfig } from '../domain/types.js';
import { clearBrowserProfileLocks, prepareDashboardPage } from './browserProfile.js';
import { notifyLoginRequired } from './loginNotification.js';
import { waitForSettledLoginState } from './loginState.js';
import { selectSubAccountIfNeeded } from './subAccount.js';

export interface AuthenticatedMerchantSession {
  browser: BrowserContext;
  page: Page;
}

export interface MerchantSessionOptions {
  acceptDownloads?: boolean;
  stage?: string;
  log?: (message: string) => void;
}

function isLoginUrl(url: string): boolean {
  return /auth\.alipay\.com|login/i.test(url);
}

async function waitForTargetMerchantWorkspace(config: AgentConfig, page: Page): Promise<void> {
  await page.goto(config.targetUrl, { waitUntil: 'domcontentloaded' });
  await selectSubAccountIfNeeded(page);

  if (page.url().includes('select-identity')) {
    throw new Error('Sub-account selection did not complete. The browser reached the account selection page, but the crawler did not successfully enter the target merchant workspace.');
  }

  await page.waitForURL(/assistant-data-analysis\/index\/product\/list/, { timeout: 180000 }).catch(() => undefined);
  await Promise.race([
    page.waitForSelector('.ant-table table', { timeout: 180000 }),
    page.waitForFunction(
      () => Boolean(document.querySelector('.emptyTxt-LkXGcaGA')) || String(document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().includes('未查询到相关数据') || String(document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().includes('暂无数据'),
      undefined,
      { timeout: 180000 },
    ),
  ]);
}

export async function ensureAuthenticatedMerchantSession(config: AgentConfig, options: MerchantSessionOptions = {}): Promise<AuthenticatedMerchantSession> {
  await mkdir(config.browserProfileDir, { recursive: true });
  await clearBrowserProfileLocks(config.browserProfileDir);

  const browser = await chromium.launchPersistentContext(config.browserProfileDir, {
    acceptDownloads: options.acceptDownloads ?? true,
    headless: false,
    viewport: { width: 1920, height: 1080 },
  });
  const page = await prepareDashboardPage(browser.pages(), () => browser.newPage());
  const log = options.log ?? console.log;

  await page.goto(config.targetUrl, { waitUntil: 'domcontentloaded' });
  let loginState = await waitForSettledLoginState(page, { timeoutMs: 60000, intervalMs: 1000 });

  if (loginState === 'login-page') {
    log('检测到支付宝登录页，请在打开的浏览器窗口扫码登录；登录成功后程序会自动继续抓取。');
    await notifyLoginRequired({ page, stage: options.stage ?? 'merchant-session', outputDir: config.outputDir, log });
    await page.waitForURL((currentUrl) => !isLoginUrl(currentUrl.toString()), { timeout: 300000 });
    loginState = await waitForSettledLoginState(page, { timeoutMs: 60000, intervalMs: 1000 });
  }

  if (loginState === 'select-identity' || page.url().includes('select-identity')) {
    await selectSubAccountIfNeeded(page);
  }

  if (loginState === 'login-page' || isLoginUrl(page.url())) {
    throw new Error('支付宝登录未完成，已停止抓取。');
  }

  await waitForTargetMerchantWorkspace(config, page);
  return { browser, page };
}
