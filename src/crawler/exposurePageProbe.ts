import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';
import type { AgentConfig } from '../domain/types.js';
import { clearBrowserProfileLocks, prepareDashboardPage } from './browserProfile.js';
import { selectSubAccountIfNeeded } from './dashboardCrawler.js';
import { shouldKeepBrowserOpenOnFailure } from './failureHandling.js';
import { notifyLoginRequired } from './loginNotification.js';
import { waitForSettledLoginState } from './loginState.js';

export interface ExposureProbeTable {
  headers: string[];
  sampleRows: string[][];
}

export interface ExposureProbeSummary {
  controls: string[];
}

export interface ExposureProbeResult {
  url?: string;
  title?: string;
  controls: string[];
  tables: ExposureProbeTable[];
  bodyTextSnippet: string;
  warning?: string;
}

const EXPOSURE_CONTENT_SELECTOR = 'table, .ant-table, .ant-tabs-tab, .ant-btn';
const CONTENT_WAIT_TIMEOUT_MS = 30000;

export function summarizeExposureProbeText(texts: string[]): ExposureProbeSummary {
  return { controls: texts.map((text) => text.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 200) };
}

async function waitForExposureContent(page: Page): Promise<boolean> {
  try {
    await page.waitForFunction(
      (selector: string) => {
        const hasElements = document.querySelector(selector) !== null;
        const bodyText = document.body?.innerText?.trim() ?? '';
        return hasElements || bodyText.length > 0;
      },
      EXPOSURE_CONTENT_SELECTOR,
      { timeout: CONTENT_WAIT_TIMEOUT_MS },
    );
    return true;
  } catch {
    return false;
  }
}

async function ensureExposurePage(config: AgentConfig, page: Page): Promise<boolean> {
  const url = config.exposureUrl ?? 'https://b.alipay.com/page/self-operation-center/custody?custodyChannel=public';
  await page.goto(config.targetUrl, { waitUntil: 'domcontentloaded' });

  let loginState = await waitForSettledLoginState(page, { timeoutMs: 60000, intervalMs: 1000 });
  if (loginState === 'login-page') {
    console.log('检测到支付宝登录页，请扫码登录；登录成功后程序会继续探测曝光页面。');
    await notifyLoginRequired({ page, stage: 'exposure-page-probe', outputDir: config.outputDir, log: console.log });
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

  return waitForExposureContent(page);
}

export async function probeExposurePage(config: AgentConfig, outputPath = 'output/latest/exposure-page-probe.json'): Promise<void> {
  await mkdir('output/latest', { recursive: true });
  await clearBrowserProfileLocks(config.browserProfileDir);
  const browser = await chromium.launchPersistentContext(config.browserProfileDir, { headless: false });
  const page = await prepareDashboardPage(browser.pages(), () => browser.newPage());
  let completed = false;

  try {
    const contentVisible = await ensureExposurePage(config, page);
    const controls = await page.locator('button, .ant-tabs-tab, .ant-select-selection-item, .ant-radio-button-wrapper, label, .ant-btn').evaluateAll((nodes) => nodes.map((node) => String(node.textContent ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean));
    const tables = await page.locator('table').evaluateAll((tables) => tables.map((table) => {
      const headers = Array.from(table.querySelectorAll('thead th')).map((cell) => String(cell.textContent ?? '').replace(/\s+/g, ' ').trim());
      const sampleRows = Array.from(table.querySelectorAll('tbody tr')).slice(0, 5).map((row) => Array.from(row.querySelectorAll('td')).map((cell) => String(cell.textContent ?? '').replace(/\s+/g, ' ').trim()));
      return { headers, sampleRows };
    }));
    const title = await page.title().catch(() => '');
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const bodyTextSnippet = bodyText.replace(/\s+/g, ' ').trim().slice(0, 2000);
    const summarizedControls = summarizeExposureProbeText(controls).controls;

    const warnings: string[] = [];
    if (!contentVisible) {
      warnings.push('Exposure page content did not become visible within the timeout.');
    }
    if (summarizedControls.length === 0 && tables.length === 0) {
      warnings.push('No controls or tables were found on the exposure page.');
    }

    const result: ExposureProbeResult = {
      url: page.url(),
      title,
      controls: summarizedControls,
      tables,
      bodyTextSnippet,
      ...(warnings.length > 0 ? { warning: warnings.join(' ') } : {}),
    };
    await writeFile(outputPath, JSON.stringify(result, null, 2), 'utf8');
    completed = true;
  } finally {
    if (completed || !shouldKeepBrowserOpenOnFailure(process.env.MT_AGENT_KEEP_BROWSER_ON_FAILURE)) {
      await browser.close();
    } else {
      console.error('Exposure probe failed; keeping browser open for inspection.');
    }
  }
}
