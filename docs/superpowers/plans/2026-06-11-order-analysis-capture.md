# 订单分析页采集与日报数据增强 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 抓取支付宝订单分析四页（overview/delivery/return/customs）1 日指标，落盘 JSON、合并进今日漏斗（飞书卡片+Markdown）、追加日报 xlsx `订单分析` sheet；同时汉化 `商品明细` 表头并接入访问页 4 个新金额列。

**Architecture:** 新增纯函数解析模块 `src/publicTraffic/orderAnalysis.ts`（类型+文本解析）和爬虫 `src/crawler/orderAnalysisCrawler.ts`（复用已登录 page，切「1日」、点展开、抓 `.merchant-ui-data-indicators-items-default` 指标）。结果经 `publicTrafficCrawler` → CLI 落盘 → `analyzePublicTrafficData` 透传进 `PublicTrafficDataReportContext.orderAnalysis` → 卡片/Markdown/xlsx 渲染。金额列走 `normalizeRows → merge → 商品明细` 现有管线，全部可选字段，旧数据兼容。

**Tech Stack:** TypeScript + Playwright + xlsx-js-style + Vitest（运行命令 `npx vitest run <file>`）。

**Spec:** `docs/superpowers/specs/2026-06-11-order-analysis-capture-design.md`

---

## 文件结构

- Create: `src/publicTraffic/orderAnalysis.ts` — 订单分析类型 + 指标文本解析纯函数
- Create: `src/crawler/orderAnalysisCrawler.ts` — 四页抓取
- Create: `tests/orderAnalysisParse.test.ts` — 解析纯函数测试（probe 真实文本 fixture）
- Create: `tests/orderAnalysisCrawlerSource.test.ts` — 爬虫源码 wiring 断言
- Create: `tmp/probe-order-analysis-controls.ts` — 一次性 probe（任务 1 用完即删）
- Modify: `src/crawler/publicTrafficCrawler.ts` — 接入 collectOrderAnalysisPages
- Modify: `src/publicTraffic/paths.ts` — 新增订单分析 JSON 路径
- Modify: `src/cli/publicTrafficReport.ts` — 落盘 + analyze 传参
- Modify: `src/publicTraffic/types.ts` — context/input 增加 orderAnalysis
- Modify: `src/publicTraffic/analyzePublicTrafficData.ts` — 透传 orderAnalysis
- Modify: `src/domain/types.ts` + `src/extractor/normalizeRows.ts` — 4 个可选金额字段
- Modify: `src/publicTraffic/mergePublicTrafficData.ts` — 金额透传
- Modify: `src/publicTraffic/buildPublicTrafficWorkbook.ts` — 商品明细汉化+金额列、订单分析 sheet
- Modify: `src/publicTraffic/buildPublicTrafficCard.ts` — 今日漏斗三行
- Modify: `src/publicTraffic/buildPublicTrafficMarkdown.ts` — 1日总览三行
- Test 修改: `tests/normalizeRows.test.ts`（若无则创建）、`tests/publicTrafficReport.test.ts`、`tests/publicTrafficCliSource.test.ts`

---

### Task 1: 一次性 probe——确认「1日」日期控件与指标项 DOM 结构

**Files:**
- Create: `tmp/probe-order-analysis-controls.ts`

订单分析页与访问数据页同属 assistant-data-analysis 应用，大概率有相同的 `1日/7日/30日` 文本切换控件，但需实证。同时确认 `.merchant-ui-data-indicators-items-default` 每项的叶子文本结构（label/value/delta 是否分节点）。

- [ ] **Step 1: 写 probe 脚本**

```ts
// tmp/probe-order-analysis-controls.ts
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';
import { loadConfig } from '../src/config/loadConfig.js';
import { clearBrowserProfileLocks, prepareDashboardPage } from '../src/crawler/browserProfile.js';
import { selectSubAccountIfNeeded } from '../src/crawler/dashboardCrawler.js';
import { waitForDashboardAfterLogin, waitForSettledLoginState } from '../src/crawler/loginState.js';

const OVERVIEW_URL = 'https://b.alipay.com/page/recycle-im/app/assistant-data-analysis/index/order/overview?appId=2021005181665859';

async function dumpIndicators(page: Page): Promise<unknown[]> {
  return page.locator('.merchant-ui-data-indicators-items').evaluateAll((nodes) =>
    nodes.map((node) => ({
      className: node.className,
      text: String(node.textContent ?? '').replace(/\s+/g, ' ').trim(),
      leafTexts: Array.from(node.querySelectorAll('*'))
        .filter((el) => el.children.length === 0)
        .map((el) => String(el.textContent ?? '').replace(/\s+/g, ' ').trim())
        .filter(Boolean),
    })),
  );
}

async function main(): Promise<void> {
  const config = await loadConfig();
  await mkdir('output/latest', { recursive: true });
  await clearBrowserProfileLocks(config.browserProfileDir);
  const browser = await chromium.launchPersistentContext(config.browserProfileDir, { headless: false });
  const page = await prepareDashboardPage(browser.pages(), () => browser.newPage());

  try {
    await page.goto(OVERVIEW_URL, { waitUntil: 'domcontentloaded' });
    const loginState = await waitForSettledLoginState(page, { timeoutMs: 60000, intervalMs: 1000 });
    if (loginState === 'login-page') {
      console.log('请扫码登录……');
      await waitForDashboardAfterLogin(page);
    }
    await selectSubAccountIfNeeded(page);
    if (!page.url().includes('/order/overview')) {
      await page.goto(OVERVIEW_URL, { waitUntil: 'domcontentloaded' });
    }
    await page.waitForTimeout(5000);

    const controls = await page
      .locator('.ant-radio-button-wrapper, .ant-segmented-item, .ant-tabs-tab, .ant-select-selection-item, button')
      .evaluateAll((nodes) => nodes.map((node) => ({ className: (node as HTMLElement).className, text: String(node.textContent ?? '').replace(/\s+/g, ' ').trim() })).filter((item) => item.text));
    const indicatorsBefore = await dumpIndicators(page);

    let oneDayClicked = false;
    const oneDay = page.getByText('1日', { exact: true }).first();
    if ((await oneDay.count()) > 0) {
      await oneDay.click();
      await page.waitForTimeout(3000);
      oneDayClicked = true;
    }

    const toggles = page.locator('[class*="toggle-"]');
    const toggleTexts = await toggles.evaluateAll((nodes) => nodes.map((node) => String(node.textContent ?? '').trim()));
    for (let i = 0; i < (await toggles.count()); i += 1) {
      if ((await toggles.nth(i).textContent())?.includes('展开')) {
        await toggles.nth(i).click();
        await page.waitForTimeout(500);
      }
    }

    const indicatorsAfter = await dumpIndicators(page);
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const dateMentions = bodyText.replace(/\s+/g, '').match(/\d{4}-\d{2}-\d{2}[^0-9]{0,10}/g) ?? [];

    await writeFile(
      'output/latest/order-analysis-controls-probe.json',
      JSON.stringify({ url: page.url(), oneDayClicked, controls, toggleTexts, indicatorsBefore, indicatorsAfter, dateMentions: dateMentions.slice(0, 30) }, null, 2),
      'utf8',
    );
    console.log(`oneDayClicked=${oneDayClicked} indicators=${indicatorsAfter.length}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: 运行 probe**

Run: `npx tsx tmp/probe-order-analysis-controls.ts`（workdir `C:\works\MT-agent`，可能需扫码）
Expected: 控制台输出 `oneDayClicked=true indicators=N`（N≥5），生成 `output/latest/order-analysis-controls-probe.json`

- [ ] **Step 3: 阅读 probe 结果，记录三件事**

1. 「1日」控件形态（哪个 className 命中、`getByText('1日')` 是否生效）；若 `oneDayClicked=false`，从 `controls` 里找日期控件实际文本/类名，并在 Task 3 中替换 `selectOneDayPeriod` 的选择器。
2. `indicatorsAfter` 每项的 `leafTexts` 结构——确认 Task 2 解析器以整项 text 正则切分是否够用；若 label/value/delta 是独立叶子节点，Task 3 中改为按叶子节点取值（解析器保留为 fallback）。
3. `dateMentions` 里数据日期的实际上下文格式，校对 Task 2 的 `extractOrderAnalysisDataDate` 正则。

- [ ] **Step 4: 删除 probe 脚本并提交发现**

```powershell
Remove-Item -Recurse -Force tmp
```

把发现写进本计划文件 Task 1 末尾（追加 "Probe 结论：…"），提交：

```bash
git add docs/superpowers/plans/2026-06-11-order-analysis-capture.md
git commit -m "计划：补充订单分析页控件probe结论"
```

---

### Task 2: 订单分析类型与指标解析纯函数

**Files:**
- Create: `src/publicTraffic/orderAnalysis.ts`
- Test: `tests/orderAnalysisParse.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/orderAnalysisParse.test.ts
import { describe, expect, it } from 'vitest';
import { extractOrderAnalysisDataDate, parseOrderAnalysisIndicatorText } from '../src/publicTraffic/orderAnalysis.js';

describe('parseOrderAnalysisIndicatorText', () => {
  it('解析计数指标', () => {
    expect(parseOrderAnalysisIndicatorText('签约订单数542较前7日+40.8%')).toEqual({ label: '签约订单数', value: '542', delta: '+40.8%' });
  });

  it('解析万单位金额指标', () => {
    expect(parseOrderAnalysisIndicatorText('签约完成金额（元）2.93万较前7日+20.3%')).toEqual({ label: '签约完成金额（元）', value: '2.93万', delta: '+20.3%' });
  });

  it('解析百分比指标', () => {
    expect(parseOrderAnalysisIndicatorText('签约订单审出率83.0%较前7日+8.36%')).toEqual({ label: '签约订单审出率', value: '83.0%', delta: '+8.36%' });
  });

  it('解析负向变化', () => {
    expect(parseOrderAnalysisIndicatorText('待发货订单数168较前7日-34.4%')).toEqual({ label: '待发货订单数', value: '168', delta: '-34.4%' });
  });

  it('无较前7日时 delta 为空', () => {
    expect(parseOrderAnalysisIndicatorText('平均发货天数3')).toEqual({ label: '平均发货天数', value: '3', delta: '' });
  });

  it('容忍文本中的空白', () => {
    expect(parseOrderAnalysisIndicatorText('关单数 590 较前7日 +31.0%')).toEqual({ label: '关单数', value: '590', delta: '+31.0%' });
  });

  it('非指标文本返回 null', () => {
    expect(parseOrderAnalysisIndicatorText('订单转化漏斗')).toBeNull();
    expect(parseOrderAnalysisIndicatorText('')).toBeNull();
  });
});

describe('extractOrderAnalysisDataDate', () => {
  it('从页面文本提取数据日期', () => {
    expect(extractOrderAnalysisDataDate('……2026-06-08当日数据（06-08）54对比日数据（06-01）48……')).toBe('2026-06-08');
  });

  it('无日期返回 null', () => {
    expect(extractOrderAnalysisDataDate('没有日期的文本')).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/orderAnalysisParse.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

```ts
// src/publicTraffic/orderAnalysis.ts
export type OrderAnalysisPageKey = 'overview' | 'delivery' | 'return' | 'customs';

export const ORDER_ANALYSIS_PAGE_LABELS: Record<OrderAnalysisPageKey, string> = {
  overview: '标准订单分析',
  delivery: '发货分析',
  return: '归还分析',
  customs: '关单分析',
};

export const ORDER_ANALYSIS_PAGE_KEYS: OrderAnalysisPageKey[] = ['overview', 'delivery', 'return', 'customs'];

export interface OrderAnalysisIndicator {
  label: string;
  value: string;
  delta: string;
}

export interface OrderAnalysisPageData {
  key: OrderAnalysisPageKey;
  label: string;
  dataDate: string | null;
  indicators: OrderAnalysisIndicator[];
}

export interface OrderAnalysisCapture {
  capturedAt: string;
  pages: Record<OrderAnalysisPageKey, OrderAnalysisPageData>;
}

export interface OrderAnalysisResult extends OrderAnalysisCapture {
  runDate: string;
}

const INDICATOR_PATTERN = /^(.+?)(-?\d[\d.,]*(?:万|亿)?%?)(?:较前7日(.*))?$/;

export function parseOrderAnalysisIndicatorText(text: string): OrderAnalysisIndicator | null {
  const normalized = text.replace(/\s+/g, '');
  if (!normalized) return null;
  const match = normalized.match(INDICATOR_PATTERN);
  if (!match || !match[1] || !match[2]) return null;
  return { label: match[1], value: match[2], delta: (match[3] ?? '').trim() };
}

export function extractOrderAnalysisDataDate(bodyText: string): string | null {
  const match = bodyText.replace(/\s+/g, '').match(/(\d{4}-\d{2}-\d{2})当日数据/);
  return match ? match[1] : null;
}

export function findOrderAnalysisIndicator(page: OrderAnalysisPageData | undefined, labels: string[]): string {
  for (const label of labels) {
    const found = page?.indicators.find((item) => item.label === label);
    if (found) return found.value;
  }
  return '-';
}

export function shortDataDate(date: string | null | undefined): string {
  return date ? date.slice(5) : '未知';
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/orderAnalysisParse.test.ts`
Expected: PASS

- [ ] **Step 5: 给 helper 补两组断言（同文件追加）**

```ts
import type { OrderAnalysisPageData } from '../src/publicTraffic/orderAnalysis.js';
import { findOrderAnalysisIndicator, shortDataDate } from '../src/publicTraffic/orderAnalysis.js';

describe('findOrderAnalysisIndicator / shortDataDate', () => {
  const page: OrderAnalysisPageData = {
    key: 'overview',
    label: '标准订单分析',
    dataDate: '2026-06-08',
    indicators: [{ label: '创建订单数', value: '924', delta: '+46.7%' }],
  };

  it('按标签优先级取值，缺失回退 -', () => {
    expect(findOrderAnalysisIndicator(page, ['创建订单数'])).toBe('924');
    expect(findOrderAnalysisIndicator(page, ['不存在', '创建订单数'])).toBe('924');
    expect(findOrderAnalysisIndicator(page, ['不存在'])).toBe('-');
    expect(findOrderAnalysisIndicator(undefined, ['创建订单数'])).toBe('-');
  });

  it('shortDataDate 截取月日，空值返回未知', () => {
    expect(shortDataDate('2026-06-08')).toBe('06-08');
    expect(shortDataDate(null)).toBe('未知');
  });
});
```

Run: `npx vitest run tests/orderAnalysisParse.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/publicTraffic/orderAnalysis.ts tests/orderAnalysisParse.test.ts
git commit -m "功能：订单分析指标解析纯函数"
```

---

### Task 3: 订单分析四页爬虫

**Files:**
- Create: `src/crawler/orderAnalysisCrawler.ts`
- Test: `tests/orderAnalysisCrawlerSource.test.ts`

爬虫依赖真实页面，无法单元测试；按仓库惯例用源码 wiring 断言（参照 `tests/exposureCrawlerSource.test.ts`）。若 Task 1 probe 结论与下面代码的选择器不符，以 probe 结论为准调整。

- [ ] **Step 1: 写失败的源码断言测试**

```ts
// tests/orderAnalysisCrawlerSource.test.ts
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('orderAnalysisCrawler wiring', () => {
  it('覆盖四个页面、1日切换、展开与指标选择器，且空指标抛错', async () => {
    const source = await readFile('src/crawler/orderAnalysisCrawler.ts', 'utf8');
    expect(source).toContain("'overview'");
    expect(source).toContain("'delivery'");
    expect(source).toContain("'return'");
    expect(source).toContain("'customs'");
    expect(source).toContain('assistant-data-analysis/index/order/');
    expect(source).toContain("getByText('1日', { exact: true })");
    expect(source).toContain('展开');
    expect(source).toContain('merchant-ui-data-indicators-items-default');
    expect(source).toContain('selectSubAccountIfNeeded');
    expect(source).toContain('指标为空');
    expect(source).toContain('parseOrderAnalysisIndicatorText');
    expect(source).toContain('extractOrderAnalysisDataDate');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/orderAnalysisCrawlerSource.test.ts`
Expected: FAIL（文件不存在）

- [ ] **Step 3: 写爬虫实现**

```ts
// src/crawler/orderAnalysisCrawler.ts
import type { Page } from 'playwright';
import type { AgentConfig } from '../domain/types.js';
import {
  extractOrderAnalysisDataDate,
  ORDER_ANALYSIS_PAGE_KEYS,
  ORDER_ANALYSIS_PAGE_LABELS,
  parseOrderAnalysisIndicatorText,
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

async function selectOneDayPeriod(page: Page, key: OrderAnalysisPageKey): Promise<void> {
  const target = page.getByText('1日', { exact: true }).first();
  try {
    await target.waitFor({ state: 'visible', timeout: 30000 });
  } catch {
    throw new Error(`订单分析页 ${key} 未找到「1日」日期切换控件`);
  }
  await target.click();
  await page.waitForTimeout(3000);
}

async function expandToggles(page: Page): Promise<void> {
  const toggles = page.locator('[class*="toggle-"]', { hasText: '展开' });
  const count = await toggles.count();
  for (let index = 0; index < count; index += 1) {
    await toggles.nth(index).click().catch(() => undefined);
    await page.waitForTimeout(500);
  }
}

async function extractIndicators(page: Page): Promise<OrderAnalysisIndicator[]> {
  const texts: string[] = await page
    .locator('.merchant-ui-data-indicators-items.merchant-ui-data-indicators-items-default')
    .evaluateAll((nodes) => nodes.map((node) => String(node.textContent ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean));
  return texts
    .map((text) => parseOrderAnalysisIndicatorText(text))
    .filter((item): item is OrderAnalysisIndicator => item !== null);
}

async function collectOrderAnalysisPage(page: Page, key: OrderAnalysisPageKey): Promise<OrderAnalysisPageData> {
  await page.goto(orderAnalysisUrl(key), { waitUntil: 'domcontentloaded' });
  await selectSubAccountIfNeeded(page);
  if (!page.url().includes(`/order/${key}`)) {
    await page.goto(orderAnalysisUrl(key), { waitUntil: 'domcontentloaded' });
  }
  await page.waitForSelector('.merchant-ui-data-indicators-items', { timeout: 60000 });
  await selectOneDayPeriod(page, key);
  await expandToggles(page);

  const indicators = await extractIndicators(page);
  if (indicators.length === 0) {
    throw new Error(`订单分析页 ${key} 指标为空，页面可能改版或日期切换失败`);
  }

  const bodyText = await page.locator('body').innerText().catch(() => '');
  return {
    key,
    label: ORDER_ANALYSIS_PAGE_LABELS[key],
    dataDate: extractOrderAnalysisDataDate(bodyText),
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
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/orderAnalysisCrawlerSource.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/crawler/orderAnalysisCrawler.ts tests/orderAnalysisCrawlerSource.test.ts
git commit -m "功能：订单分析四页爬虫"
```

---

### Task 4: 接入 publicTrafficCrawler

**Files:**
- Modify: `src/crawler/publicTrafficCrawler.ts`
- Test: `tests/publicTrafficCliSource.test.ts`（追加断言）

- [ ] **Step 1: 在现有 wiring 测试追加失败断言**

在 `tests/publicTrafficCliSource.test.ts` 中追加一个 it（保持现有用例不动）：

```ts
it('crawler 接入订单分析抓取', async () => {
  const source = await readFile('src/crawler/publicTrafficCrawler.ts', 'utf8');
  expect(source).toContain('collectOrderAnalysisPages');
  expect(source).toContain('orderAnalysis');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/publicTrafficCliSource.test.ts`
Expected: 新增用例 FAIL

- [ ] **Step 3: 修改 publicTrafficCrawler**

```ts
// src/crawler/publicTrafficCrawler.ts 变更点
import { collectOrderAnalysisPages } from './orderAnalysisCrawler.js';
import type { OrderAnalysisCapture } from '../publicTraffic/orderAnalysis.js';

export interface PublicTrafficSourcesCrawlResult {
  goodsExportPath: string;
  exposure: ExposureCrawlResult;
  dashboard: RawTableData[];
  orderAnalysis: OrderAnalysisCapture;
}

// try 块内 collectDashboardPage 之后追加：
    const orderAnalysis = await collectOrderAnalysisPages(config, page);

    completed = true;
    return { goodsExportPath, exposure, dashboard, orderAnalysis };
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/publicTrafficCliSource.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/crawler/publicTrafficCrawler.ts tests/publicTrafficCliSource.test.ts
git commit -m "功能：主流程接入订单分析抓取"
```

---

### Task 5: paths、CLI 落盘与 context 透传

**Files:**
- Modify: `src/publicTraffic/paths.ts`
- Modify: `src/publicTraffic/types.ts`
- Modify: `src/publicTraffic/analyzePublicTrafficData.ts`
- Modify: `src/cli/publicTrafficReport.ts`
- Test: `tests/publicTrafficCliSource.test.ts`（追加断言）

- [ ] **Step 1: 追加失败断言**

`tests/publicTrafficCliSource.test.ts` 追加：

```ts
it('CLI 落盘订单分析 JSON 并传入分析上下文', async () => {
  const source = await readFile('src/cli/publicTrafficReport.ts', 'utf8');
  expect(source).toContain('paths.orderAnalysis');
  expect(source).toContain('output/latest/order-analysis.json');
  expect(source).toContain('orderAnalysis:');
});

it('paths 定义订单分析中文路径', async () => {
  const source = await readFile('src/publicTraffic/paths.ts', 'utf8');
  expect(source).toContain('订单分析_');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/publicTrafficCliSource.test.ts`
Expected: 新增用例 FAIL

- [ ] **Step 3: 修改 paths.ts**

`PublicTrafficPaths` 接口加 `orderAnalysis: string;`，`buildPublicTrafficPaths` 返回对象加：

```ts
    orderAnalysis: `${dir}/订单分析_${date}.json`,
```

- [ ] **Step 4: 修改 types.ts 与 analyzePublicTrafficData.ts**

`src/publicTraffic/types.ts`：

```ts
import type { OrderAnalysisResult } from './orderAnalysis.js';

// PublicTrafficDataReportContext 增加字段：
  orderAnalysis?: OrderAnalysisResult;

// PublicTrafficDataAnalysisInput 增加字段：
  orderAnalysis?: OrderAnalysisResult;
```

`src/publicTraffic/analyzePublicTrafficData.ts`：在构造返回 context 的对象处加一行透传（在 `date:` 附近）：

```ts
    orderAnalysis: input.orderAnalysis,
```

- [ ] **Step 5: 修改 CLI**

`src/cli/publicTrafficReport.ts` 变更点：

```ts
// 解构 crawl 结果处：
    const { goodsExportPath, exposure: crawlResult, dashboard: rawTables, orderAnalysis: orderAnalysisCapture } = await crawlPublicTrafficSources(config, paths.goodsExportWorkbook);

// 保存累计快照之后追加：
    const orderAnalysis = { ...orderAnalysisCapture, runDate };
    await writeFile(paths.orderAnalysis, JSON.stringify(orderAnalysis, null, 2), 'utf8');
    await writeFile('output/latest/order-analysis.json', JSON.stringify(orderAnalysis, null, 2), 'utf8');
    log.addEvent(`订单分析: ${Object.values(orderAnalysis.pages).map((page) => `${page.label}=${page.indicators.length}条(${page.dataDate ?? '未知'})`).join(', ')}`);

// analyzePublicTrafficData 入参追加：
      orderAnalysis,
```

- [ ] **Step 6: 运行确认通过**

Run: `npx vitest run tests/publicTrafficCliSource.test.ts`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add src/publicTraffic/paths.ts src/publicTraffic/types.ts src/publicTraffic/analyzePublicTrafficData.ts src/cli/publicTrafficReport.ts tests/publicTrafficCliSource.test.ts
git commit -m "功能：订单分析落盘与上下文透传"
```

---

### Task 6: normalizeRows 接入 4 个金额列

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/extractor/normalizeRows.ts`
- Test: `tests/normalizeRows.test.ts`（已存在则追加用例，不存在则创建）

- [ ] **Step 1: 写失败测试**

```ts
// tests/normalizeRows.test.ts（追加或创建）
import { describe, expect, it } from 'vitest';
import type { RawTableData } from '../src/domain/types.js';
import { normalizeRowsForPeriod } from '../src/extractor/normalizeRows.js';

function tableWith(headers: string[], rows: string[][]): RawTableData {
  return {
    period: '1d',
    headers,
    rows,
    collection: { period: '1d', actualPageSizes: [10], pageCount: 1, rowCount: rows.length, dedupedRowCount: rows.length, displayedTotalCount: rows.length, pageSizeFallback: false, complete: true },
  };
}

describe('normalizeRowsForPeriod 金额列', () => {
  const newHeaders = ['商品名称', '商品ID', 'SPU名称', 'SPUID', '频道访问次数', '创建订单数', '签约订单数', '审出订单数', '发货订单数', '创建订单金额', '签约订单金额', '审出订单金额', '发货订单金额'];

  it('解析新表头的 4 个金额列', () => {
    const table = tableWith(newHeaders, [['测试商品', 'P1', 'SPU', 'S1', '10', '5', '4', '3', '2', '500.5', '400', '300', '200']]);
    const [row] = normalizeRowsForPeriod(table);
    expect(row.createdOrderAmount).toBe(500.5);
    expect(row.signedOrderAmount).toBe(400);
    expect(row.reviewedOrderAmount).toBe(300);
    expect(row.shippedOrderAmount).toBe(200);
  });

  it('旧表头缺金额列时为 0，不报错', () => {
    const oldHeaders = ['商品名称', '商品ID', 'SPU名称', 'SPUID', '频道访问次数', '创建订单数', '签约订单数', '审出订单数', '发货订单数'];
    const table = tableWith(oldHeaders, [['测试商品', 'P1', 'SPU', 'S1', '10', '5', '4', '3', '2']]);
    const [row] = normalizeRowsForPeriod(table);
    expect(row.createdOrderAmount).toBe(0);
    expect(row.shippedOrderAmount).toBe(0);
  });

  it('金额列表头不与订单数列冲突', () => {
    const table = tableWith(newHeaders, [['测试商品', 'P1', 'SPU', 'S1', '10', '5', '4', '3', '2', '500', '400', '300', '200']]);
    const [row] = normalizeRowsForPeriod(table);
    expect(row.createdOrders).toBe(5);
    expect(row.shippedOrders).toBe(2);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/normalizeRows.test.ts`
Expected: FAIL（字段不存在）

- [ ] **Step 3: 改 types 与实现**

`src/domain/types.ts` 的 `ProductMetrics` 追加可选字段：

```ts
  createdOrderAmount?: number;
  signedOrderAmount?: number;
  reviewedOrderAmount?: number;
  shippedOrderAmount?: number;
```

`src/extractor/normalizeRows.ts`：

```ts
// HeaderIndexes 追加：
  createdOrderAmount: number;
  signedOrderAmount: number;
  reviewedOrderAmount: number;
  shippedOrderAmount: number;

// OPTIONAL_HEADERS 改为：
const OPTIONAL_HEADERS = new Set<keyof HeaderIndexes>(['spuName', 'spuId', 'createdOrderAmount', 'signedOrderAmount', 'reviewedOrderAmount', 'shippedOrderAmount']);

// findHeaderIndexes 返回对象追加：
    createdOrderAmount: findHeaderIndex(headers, ['创建订单金额']),
    signedOrderAmount: findHeaderIndex(headers, ['签约订单金额']),
    reviewedOrderAmount: findHeaderIndex(headers, ['审出订单金额']),
    shippedOrderAmount: findHeaderIndex(headers, ['发货订单金额']),

// normalizeRowsForPeriod 的 map 返回对象追加：
    createdOrderAmount: indexes.createdOrderAmount >= 0 ? parseCount(row[indexes.createdOrderAmount]) : 0,
    signedOrderAmount: indexes.signedOrderAmount >= 0 ? parseCount(row[indexes.signedOrderAmount]) : 0,
    reviewedOrderAmount: indexes.reviewedOrderAmount >= 0 ? parseCount(row[indexes.reviewedOrderAmount]) : 0,
    shippedOrderAmount: indexes.shippedOrderAmount >= 0 ? parseCount(row[indexes.shippedOrderAmount]) : 0,
```

注意 `findHeaderIndex` 用 `includes` 匹配——`创建订单数` 匹配器不会命中 `创建订单金额` 表头（`'创建订单金额'.includes('创建订单数') === false`），已由测试用例 3 锁定。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/normalizeRows.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/domain/types.ts src/extractor/normalizeRows.ts tests/normalizeRows.test.ts
git commit -m "功能：访问页4个金额列解析"
```

---

### Task 7: merge 透传金额字段

**Files:**
- Modify: `src/publicTraffic/types.ts`
- Modify: `src/publicTraffic/mergePublicTrafficData.ts`
- Test: `tests/publicTrafficDataAnalysis.test.ts`（若 merge 测试在别处，以 `Grep mergePublicTrafficData tests/` 实际位置为准追加）

- [ ] **Step 1: 写失败测试**

在 merge 相关测试文件追加：

```ts
it('透传访问页金额字段', () => {
  const merged = mergePublicTrafficData({
    dashboardRows: [{
      period: '1d', productName: '测试', platformProductId: 'P1',
      visits: 10, createdOrders: 5, signedOrders: 4, reviewedOrders: 3, shippedOrders: 2,
      createdOrderAmount: 500, signedOrderAmount: 400, reviewedOrderAmount: 300, shippedOrderAmount: 200,
    }],
    exposureByPeriod: { '1d': [], '7d': [], '30d': [] },
    cumulativeProducts: [],
    mapping: {},
  });
  const metrics = merged.rows[0].periods['1d'];
  expect(metrics.createdOrderAmount).toBe(500);
  expect(metrics.signedOrderAmount).toBe(400);
  expect(metrics.reviewedOrderAmount).toBe(300);
  expect(metrics.shippedOrderAmount).toBe(200);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/publicTrafficDataAnalysis.test.ts`
Expected: 新增用例 FAIL

- [ ] **Step 3: 改 types 与 merge**

`src/publicTraffic/types.ts` 的 `PublicTrafficPeriodMetrics` 追加可选字段：

```ts
  createdOrderAmount?: number;
  signedOrderAmount?: number;
  reviewedOrderAmount?: number;
  shippedOrderAmount?: number;
```

`src/publicTraffic/mergePublicTrafficData.ts`：

```ts
// emptyPeriod() 返回对象追加：
    createdOrderAmount: 0,
    signedOrderAmount: 0,
    reviewedOrderAmount: 0,
    shippedOrderAmount: 0,

// dashboardRows 循环内 metrics.shippedOrders = ... 之后追加：
    metrics.createdOrderAmount = row.createdOrderAmount ?? 0;
    metrics.signedOrderAmount = row.signedOrderAmount ?? 0;
    metrics.reviewedOrderAmount = row.reviewedOrderAmount ?? 0;
    metrics.shippedOrderAmount = row.shippedOrderAmount ?? 0;
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/publicTrafficDataAnalysis.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/publicTraffic/types.ts src/publicTraffic/mergePublicTrafficData.ts tests/publicTrafficDataAnalysis.test.ts
git commit -m "功能：合并宽表透传金额字段"
```

---

### Task 8: 商品明细汉化 + 金额列 + 订单分析 sheet

**Files:**
- Modify: `src/publicTraffic/buildPublicTrafficWorkbook.ts`
- Test: `tests/publicTrafficReport.test.ts`（追加用例；该文件已有 workbook 相关断言可参照其 fixture 构造方式）

- [ ] **Step 1: 写失败测试**

在 `tests/publicTrafficReport.test.ts` 追加（fixture 构造参照文件内现有 `PublicTrafficDataReportContext` 构造方式；`XLSX.read` 解析 buffer）：

```ts
import XLSX from 'xlsx-js-style';

it('商品明细表头为中文且含金额列', () => {
  const buffer = writePublicTrafficWorkbookBuffer(context); // context 为现有测试 fixture
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets['商品明细'];
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
  const headers = rows[0];
  expect(headers).toContain('平台商品ID');
  expect(headers).toContain('端内ID');
  expect(headers).toContain('商品名称');
  expect(headers).toContain('托管天数');
  expect(headers).toContain('1日曝光量');
  expect(headers).toContain('7日金额（元）');
  expect(headers).toContain('30日访问→发货率');
  expect(headers).toContain('1日创建订单金额（元）');
  expect(headers).toContain('7日签约订单金额（元）');
  expect(headers).toContain('30日发货订单金额（元）');
  expect(headers.some((h) => /^\d+d_/.test(String(h)))).toBe(false);
});

it('包含订单分析 sheet（context 带 orderAnalysis 时）', () => {
  const contextWithOrderAnalysis = {
    ...context,
    orderAnalysis: {
      capturedAt: '2026-06-12T00:00:00.000Z',
      runDate: '2026-06-12',
      pages: {
        overview: { key: 'overview', label: '标准订单分析', dataDate: '2026-06-08', indicators: [{ label: '签约订单数', value: '542', delta: '+40.8%' }] },
        delivery: { key: 'delivery', label: '发货分析', dataDate: '2026-06-06', indicators: [{ label: '发货订单数', value: '336', delta: '+66.3%' }] },
        return: { key: 'return', label: '归还分析', dataDate: null, indicators: [{ label: '归还订单数', value: '105', delta: '-12.8%' }] },
        customs: { key: 'customs', label: '关单分析', dataDate: '2026-06-08', indicators: [{ label: '关单数', value: '590', delta: '+31.0%' }] },
      },
    },
  };
  const buffer = writePublicTrafficWorkbookBuffer(contextWithOrderAnalysis);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  expect(workbook.SheetNames).toContain('订单分析');
  const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets['订单分析'], { header: 1 });
  const flat = rows.map((row) => (row ?? []).join('|')).join('\n');
  expect(flat).toContain('【标准订单分析】数据日期：2026-06-08');
  expect(flat).toContain('签约订单数|542|+40.8%');
  expect(flat).toContain('【归还分析】数据日期：未知');
  expect(flat).toContain('指标|数值|较前7日');
});

it('context 不带 orderAnalysis 时无订单分析 sheet', () => {
  const buffer = writePublicTrafficWorkbookBuffer(context);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  expect(workbook.SheetNames).not.toContain('订单分析');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/publicTrafficReport.test.ts`
Expected: 新增用例 FAIL

- [ ] **Step 3: 改 buildPublicTrafficWorkbook.ts**

detailSheet 替换为中文表头 + 每周期 15 列：

```ts
import { ORDER_ANALYSIS_PAGE_KEYS, type OrderAnalysisResult } from './orderAnalysis.js';

const PERIOD_HEADER_LABELS: Record<PeriodKey, string> = { '1d': '1日', '7d': '7日', '30d': '30日' };

function detailSheet(rows: PublicTrafficProductDataRow[]): XLSX.WorkSheet {
  const periods: PeriodKey[] = ['1d', '7d', '30d'];
  const aoa: (string | number | null)[][] = [
    [
      '平台商品ID',
      '端内ID',
      '商品名称',
      '托管天数',
      ...periods.flatMap((period) => {
        const p = PERIOD_HEADER_LABELS[period];
        return [
          `${p}曝光量`, `${p}公域访问`, `${p}后链路访问`,
          `${p}创建订单`, `${p}签约订单`, `${p}审出订单`, `${p}发货订单`,
          `${p}金额（元）`,
          `${p}创建订单金额（元）`, `${p}签约订单金额（元）`, `${p}审出订单金额（元）`, `${p}发货订单金额（元）`,
          `${p}曝光→访问率`, `${p}访问→创单率`, `${p}访问→发货率`,
        ];
      }),
    ],
  ];
  for (const row of rows) {
    aoa.push([
      row.platformProductId,
      row.displayProductId,
      row.productName,
      row.custodyDays,
      ...periods.flatMap((period) => {
        const metric = row.periods[period];
        return [
          metric.exposure, metric.publicVisits, metric.dashboardVisits,
          metric.createdOrders, metric.signedOrders, metric.reviewedOrders, metric.shippedOrders,
          metric.amount,
          metric.createdOrderAmount ?? 0, metric.signedOrderAmount ?? 0, metric.reviewedOrderAmount ?? 0, metric.shippedOrderAmount ?? 0,
          metric.exposureVisitRate, metric.visitCreatedOrderRate, metric.visitShipmentRate,
        ];
      }),
    ]);
  }
  return XLSX.utils.aoa_to_sheet(aoa);
}

function orderAnalysisSheet(result: OrderAnalysisResult): XLSX.WorkSheet {
  const aoa: string[][] = [];
  for (const key of ORDER_ANALYSIS_PAGE_KEYS) {
    const page = result.pages[key];
    aoa.push([`【${page.label}】数据日期：${page.dataDate ?? '未知'}`]);
    aoa.push(['指标', '数值', '较前7日']);
    for (const item of page.indicators) {
      aoa.push([item.label, item.value, item.delta]);
    }
    aoa.push([]);
  }
  return XLSX.utils.aoa_to_sheet(aoa);
}

// writePublicTrafficWorkbookBuffer 中 '生命周期治理' append 之后追加：
  if (context.orderAnalysis) {
    XLSX.utils.book_append_sheet(workbook, orderAnalysisSheet(context.orderAnalysis), '订单分析');
  }
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/publicTrafficReport.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/publicTraffic/buildPublicTrafficWorkbook.ts tests/publicTrafficReport.test.ts
git commit -m "功能：商品明细汉化、金额列与订单分析sheet"
```

---

### Task 9: 今日漏斗三行（飞书卡片 + Markdown）

**Files:**
- Modify: `src/publicTraffic/buildPublicTrafficCard.ts`
- Modify: `src/publicTraffic/buildPublicTrafficMarkdown.ts`
- Test: `tests/publicTrafficReport.test.ts`（追加用例）

- [ ] **Step 1: 写失败测试**

`tests/publicTrafficReport.test.ts` 追加（`contextWithOrderAnalysis` 复用 Task 8 fixture，建议提为文件级共享 fixture；overview indicators 补全为：创建订单数 924、签约订单数 542、发货订单数 336、签约完成金额（元）2.93万；delivery 补 待发货订单数 168；return 补 逾期订单数 5）：

```ts
it('卡片今日漏斗输出三行并标注数据日期', () => {
  const card = buildPublicTrafficCard(contextWithOrderAnalysis, paths);
  const json = JSON.stringify(card);
  expect(json).toContain('公域（');
  expect(json).toContain('订单（06-08）');
  expect(json).toContain('履约（发货06-06｜归还未知｜关单06-08）');
  expect(json).toContain('创建订单');
  expect(json).toContain('签约金额');
  expect(json).toContain('待发货');
  expect(json).toContain('关单');
});

it('无订单分析时卡片漏斗保持单行旧版', () => {
  const card = buildPublicTrafficCard(context, paths);
  const json = JSON.stringify(card);
  expect(json).not.toContain('履约（');
  expect(json).toContain('今日漏斗');
});

it('Markdown 1日总览输出三行', () => {
  const markdown = buildPublicTrafficMarkdown(contextWithOrderAnalysis);
  expect(markdown).toContain('公域（');
  expect(markdown).toContain('订单（06-08）：创建订单 924｜签约订单 542｜审出订单 -｜发货订单 336｜签约金额 2.93万');
  expect(markdown).toContain('履约（发货06-06｜归还未知｜关单06-08）：待发货 168｜归还 105｜逾期 5｜关单 590');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/publicTrafficReport.test.ts`
Expected: 新增用例 FAIL

- [ ] **Step 3: 改卡片**

`src/publicTraffic/buildPublicTrafficCard.ts`：

```ts
import { findOrderAnalysisIndicator, shortDataDate } from './orderAnalysis.js';

function funnelElements(context: PublicTrafficDataReportContext): Record<string, unknown>[] {
  const one = context.summary['1d'];
  const oa = context.orderAnalysis;
  if (!oa) {
    return [funnelColumnSet(one)];
  }
  const overview = oa.pages.overview;
  const delivery = oa.pages.delivery;
  const returns = oa.pages.return;
  const customs = oa.pages.customs;
  return [
    { tag: 'markdown', content: `公域（${context.date}）` },
    columnSet([
      `曝光\n**${one.exposure}**`,
      `公域访问\n**${one.publicVisits}**`,
      `后链路访问\n**${one.dashboardVisits}**`,
      `金额\n**¥${one.amount.toFixed(2)}**`,
    ]),
    { tag: 'markdown', content: `订单（${shortDataDate(overview?.dataDate)}）` },
    columnSet([
      `创建订单\n**${findOrderAnalysisIndicator(overview, ['创建订单数'])}**`,
      `签约订单\n**${findOrderAnalysisIndicator(overview, ['签约订单数'])}**`,
      `审出订单\n**${findOrderAnalysisIndicator(overview, ['审出订单数'])}**`,
      `发货订单\n**${findOrderAnalysisIndicator(overview, ['发货订单数'])}**`,
      `签约金额\n**${findOrderAnalysisIndicator(overview, ['签约完成金额（元）', '签约完成金额'])}**`,
    ]),
    { tag: 'markdown', content: `履约（发货${shortDataDate(delivery?.dataDate)}｜归还${shortDataDate(returns?.dataDate)}｜关单${shortDataDate(customs?.dataDate)}）` },
    columnSet([
      `待发货\n**${findOrderAnalysisIndicator(delivery, ['待发货订单数'])}**`,
      `归还\n**${findOrderAnalysisIndicator(returns, ['归还订单数'])}**`,
      `逾期\n**${findOrderAnalysisIndicator(returns, ['逾期订单数'])}**`,
      `关单\n**${findOrderAnalysisIndicator(customs, ['关单数'])}**`,
    ]),
  ];
}

// buildPublicTrafficCard 中将
//   funnelColumnSet(one),
// 替换为
//   ...funnelElements(context),
// 保留原 funnelColumnSet 函数作为无订单分析时的 fallback。
```

- [ ] **Step 4: 改 Markdown**

`src/publicTraffic/buildPublicTrafficMarkdown.ts`：

```ts
import { findOrderAnalysisIndicator, shortDataDate } from './orderAnalysis.js';
import type { OrderAnalysisResult } from './orderAnalysis.js';

function oneDayOverviewLines(context: PublicTrafficDataReportContext): string[] {
  const summary = context.summary['1d'];
  const oa = context.orderAnalysis;
  if (!oa) return overviewLines(summary);
  const overview = oa.pages.overview;
  const delivery = oa.pages.delivery;
  const returns = oa.pages.return;
  const customs = oa.pages.customs;
  return [
    `公域（${context.date}）：曝光 ${summary.exposure}｜公域访问 ${summary.publicVisits}｜后链路访问 ${summary.dashboardVisits}｜金额 ¥${summary.amount.toFixed(2)}`,
    `订单（${shortDataDate(overview?.dataDate)}）：创建订单 ${findOrderAnalysisIndicator(overview, ['创建订单数'])}｜签约订单 ${findOrderAnalysisIndicator(overview, ['签约订单数'])}｜审出订单 ${findOrderAnalysisIndicator(overview, ['审出订单数'])}｜发货订单 ${findOrderAnalysisIndicator(overview, ['发货订单数'])}｜签约金额 ${findOrderAnalysisIndicator(overview, ['签约完成金额（元）', '签约完成金额'])}`,
    `履约（发货${shortDataDate(delivery?.dataDate)}｜归还${shortDataDate(returns?.dataDate)}｜关单${shortDataDate(customs?.dataDate)}）：待发货 ${findOrderAnalysisIndicator(delivery, ['待发货订单数'])}｜归还 ${findOrderAnalysisIndicator(returns, ['归还订单数'])}｜逾期 ${findOrderAnalysisIndicator(returns, ['逾期订单数'])}｜关单 ${findOrderAnalysisIndicator(customs, ['关单数'])}`,
    `曝光到访问率 ${(summary.exposureVisitRate * 100).toFixed(2)}%｜访问到下单率 ${(summary.visitCreatedOrderRate * 100).toFixed(2)}%｜访问到发货率 ${(summary.visitShipmentRate * 100).toFixed(2)}%`,
  ];
}

// buildPublicTrafficMarkdown 中将
//   '## 1日总览',
//   ...overviewLines(context.summary['1d']),
// 替换为
//   '## 1日总览',
//   ...oneDayOverviewLines(context),
```

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run tests/publicTrafficReport.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/publicTraffic/buildPublicTrafficCard.ts src/publicTraffic/buildPublicTrafficMarkdown.ts tests/publicTrafficReport.test.ts
git commit -m "功能：今日漏斗合并订单分析三行展示"
```

---

### Task 10: 回归与实跑验证

- [ ] **Step 1: 全量测试**

Run: `npm test`（workdir `C:\works\MT-agent`）
Expected: 全部通过（原 178 个用例 + 新增用例）

- [ ] **Step 2: 编译**

Run: `npm run build`
Expected: 无错误

- [ ] **Step 3: 实跑**

Run: `npm run public-traffic-report`（可能需扫码；耗时数分钟）
Expected:
- 运行日志含 `订单分析: 标准订单分析=N条(...)，…` 字样
- `output/YYYY-MM-DD/订单分析_YYYY-MM-DD.json` 存在且四页 indicators 非空
- `output/YYYY-MM-DD/公域数据日报_YYYY-MM-DD.xlsx` 含 `订单分析` sheet、`商品明细` 中文表头
- 飞书卡片今日漏斗三行、各行带数据日期
- 控制台 fallback 文本 1日总览三行

- [ ] **Step 4: 检查实跑产物中的数据日期与指标合理性**

打开 JSON 核对：overview/delivery/return/customs 的 dataDate 是否合理（允许滞后），1 日指标量级是否明显小于 7 日窗口值（probe 时 7 日签约 542，1 日应显著更小）。若 1 日切换未生效（数值与 7 日窗口一致），回到 Task 3 的 `selectOneDayPeriod` 修正。

- [ ] **Step 5: 提交收尾**

```bash
git status --short
# 确认仅预期文件变更后：
git add <预期文件>
git commit -m "验证：订单分析采集实跑通过"
```

---

## Self-Review 记录

- Spec 覆盖：四页抓取（Task 3）、1日切换（Task 1/3）、失败即整体失败（Task 3 抛错 + Task 4 主流程不捕获）、JSON 落盘（Task 5）、订单分析 sheet（Task 8）、漏斗三行（Task 9）、商品明细汉化（Task 8）、金额列（Task 6/7/8）、测试与回归（各任务 + Task 10）。
- 类型一致性：`OrderAnalysisCapture`（爬虫返回）与 `OrderAnalysisResult`（含 runDate，入 context/xlsx）已区分；`findOrderAnalysisIndicator`/`shortDataDate` 在 Task 2 定义、Task 9 引用。
- 已知不确定点：「1日」控件形态与指标项叶子结构依赖 Task 1 probe 实证；`审出订单数` 可能不在 overview 指标项中（probe 仅见 `签约订单审出率`），缺失时漏斗显示 `-`，属预期行为。
