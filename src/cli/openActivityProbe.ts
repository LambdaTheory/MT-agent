import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { readActivitySubmitSession } from '../activityAutomation/submitSession.js';
import { ALIPAY_ACTIVITY_LIST_URL } from '../activityAutomation/config.js';
import { loadConfig } from '../config/loadConfig.js';
import { clearBrowserProfileLocks, prepareDashboardPage } from '../crawler/browserProfile.js';

async function main(): Promise<void> {
  const agentConfig = await loadConfig();
  const submitSession = await readActivitySubmitSession('output/latest/activity-automation/activity-submit-session.json');
  const explicitUrl = process.argv[2]?.trim();
  const targetUrl = explicitUrl || submitSession.submittedUrl || ALIPAY_ACTIVITY_LIST_URL;

  await mkdir(agentConfig.browserProfileDir, { recursive: true });
  await clearBrowserProfileLocks(agentConfig.browserProfileDir);

  const browser = await chromium.launchPersistentContext(agentConfig.browserProfileDir, {
    headless: false,
    viewport: { width: 1600, height: 1000 },
  });
  const page = await prepareDashboardPage(browser.pages(), () => browser.newPage());

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => undefined);
  console.log(`Browser opened at: ${page.url()}`);

  await browser.waitForEvent('close', { timeout: 0 });
}

void main();
