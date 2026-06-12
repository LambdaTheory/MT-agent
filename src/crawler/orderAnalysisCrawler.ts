import type { Page } from 'playwright';
import type { AgentConfig } from '../domain/types.js';
import {
  cleanOrderAnalysisIndicator,
  ORDER_ANALYSIS_PAGE_KEYS,
  ORDER_ANALYSIS_PAGE_LABELS,
  resolveOrderAnalysisDataDate,
  type OrderAnalysisCapture,
  type OrderAnalysisIndicator,
  type OrderAnalysisPageData,
  type OrderAnalysisPageKey,
} from '../publicTraffic/orderAnalysis.js';
import { selectSubAccountIfNeeded } from './dashboardCrawler.js';

const ORDER_ANALYSIS_BASE_URL = 'https://b.alipay.com/page/recycle-im/app/assistant-data-analysis/index/order/';
const APP_ID = '2021005181665859';

function orderAnalysisUrl(key: OrderAnalysisPageKey): string {
  return `${ORDER_ANALYSIS_BASE_URL}${key}?appId=${APP_ID}`;
}

async function dismissBlockingOverlays(page: Page): Promise<void> {
  const candidates = [
    page.getByRole('button', { name: /关闭|我知道了|知道了|跳过|以后再说|取消|×|Close/i }),
    page.locator('[aria-label="close"], [aria-label="Close"], .ant-modal-close, .ant-drawer-close').first(),
    page.getByText('我知道了', { exact: true }),
    page.getByText('关闭', { exact: true }),
    page.getByText('跳过', { exact: true }),
    page.getByText('以后再说', { exact: true }),
  ];

  for (const candidate of candidates) {
    const target = candidate.first();
    if ((await target.count().catch(() => 0)) === 0) continue;
    if (!(await target.isVisible().catch(() => false))) continue;
    await target.click({ timeout: 2000 }).catch(() => undefined);
    await page.waitForTimeout(500);
  }
}

async function clickWithOverlayRetry(page: Page, target: ReturnType<Page['getByText']>): Promise<void> {
  await dismissBlockingOverlays(page);
  try {
    await target.click();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('intercepts pointer events')) throw error;
    await dismissBlockingOverlays(page);
    await target.click({ force: true });
  }
}

async function selectOneDayPeriod(page: Page, key: OrderAnalysisPageKey): Promise<void> {
  const target = page.getByText('1日', { exact: true }).first();
  try {
    await target.waitFor({ state: 'visible', timeout: 30000 });
  } catch {
    throw new Error(`订单分析页 ${key} 未找到「1日」日期切换控件`);
  }
  await clickWithOverlayRetry(page, target);
  await page.waitForTimeout(3000);
}

async function expandIndicators(page: Page, key: OrderAnalysisPageKey): Promise<void> {
  const expand = page.getByText('展开', { exact: true }).first();
  if ((await expand.count()) === 0) return;
  const before = await page.locator('.merchant-ui-data-indicator').count();
  await clickWithOverlayRetry(page, expand);
  await page.waitForTimeout(3000);
  const after = await page.locator('.merchant-ui-data-indicator').count();
  if (after <= before) {
    throw new Error(`订单分析页 ${key} 展开后指标数未增加（前 ${before} 后 ${after}），展开可能未生效`);
  }
}

async function extractIndicators(page: Page): Promise<OrderAnalysisIndicator[]> {
  const raw: { label: string; value: string; delta: string }[] = await page
    .locator('.merchant-ui-data-indicator')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        label: String(node.querySelector('.merchant-ui-data-indicator-main-indicator')?.textContent ?? ''),
        value: String(node.querySelector('.merchant-ui-data-indicator-value-content')?.textContent ?? ''),
        delta: String(node.querySelector('.merchant-ui-data-indicator-supplement-items')?.textContent ?? ''),
      })),
    );
  return raw
    .map((item) => cleanOrderAnalysisIndicator(item))
    .filter((item): item is OrderAnalysisIndicator => item !== null);
}

async function readDataDate(page: Page): Promise<string | null> {
  const value = await page.locator('input[placeholder="请选择日期"]').first().inputValue().catch(() => '');
  return resolveOrderAnalysisDataDate(value, new Date().toISOString().slice(0, 10));
}

async function collectOrderAnalysisPage(page: Page, key: OrderAnalysisPageKey): Promise<OrderAnalysisPageData> {
  await page.goto(orderAnalysisUrl(key), { waitUntil: 'domcontentloaded' });
  await selectSubAccountIfNeeded(page);
  if (!page.url().includes(`/order/${key}`)) {
    await page.goto(orderAnalysisUrl(key), { waitUntil: 'domcontentloaded' });
  }
  await page.waitForSelector('.merchant-ui-data-indicator', { timeout: 60000 });
  await dismissBlockingOverlays(page);
  await selectOneDayPeriod(page, key);
  await expandIndicators(page, key);

  const indicators = await extractIndicators(page);
  if (indicators.length === 0) {
    throw new Error(`订单分析页 ${key} 指标为空，页面可能改版或日期切换失败`);
  }

  return {
    key,
    label: ORDER_ANALYSIS_PAGE_LABELS[key],
    dataDate: await readDataDate(page),
    indicators,
  };
}

export async function collectOrderAnalysisPages(_config: AgentConfig, page: Page): Promise<OrderAnalysisCapture> {
  const pages = {} as Record<OrderAnalysisPageKey, OrderAnalysisPageData>;
  for (const key of ORDER_ANALYSIS_PAGE_KEYS) {
    pages[key] = await collectOrderAnalysisPage(page, key);
    console.log(`[订单分析] ${ORDER_ANALYSIS_PAGE_LABELS[key]}: 指标=${pages[key].indicators.length}, 数据日期=${pages[key].dataDate ?? '未知'}`);
  }
  return { capturedAt: new Date().toISOString(), pages };
}
