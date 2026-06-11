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

### Task 1: 一次性 probe——确认「1日」日期控件与指标项 DOM 结构 ✅ 已完成

- [x] **Step 1-4: probe 已于 2026-06-11 执行（v1/v2/v3 三轮），脚本已删除**

**Probe 结论（后续任务以此为准）：**

1. **「1日」切换有效**：`page.getByText('1日', { exact: true }).first().click()` 生效。切换后指标值从 7 日窗口变为 1 日窗口（签约订单数 542→103），delta 文案从 `较前7日` 变为 `较前日`。
2. **指标节点结构**：每个指标是 `.merchant-ui-data-indicator` 元素（收起态附加 `-default`，展开态附加 `-lighter`），内部用子选择器干净取三段：
   - label：`.merchant-ui-data-indicator-main-indicator`（textContent，如 `签约订单数`）
   - value：`.merchant-ui-data-indicator-value-content`（如 `103`、`3,977`，可含千分位逗号）
   - delta：`.merchant-ui-data-indicator-supplement-items`（如 `较前日+32.1%`，原样保存）
   - 注意：不要用 leaf 节点文本拼接（数值渲染在带子元素的节点里，leaf 取不到数字）；不要正则切整段文本。
3. **展开有效**：`page.getByText('展开', { exact: true }).first().click()` 后约 3 秒，新增 `-lighter` 指标（创建订单数 194、发货订单数 64 等）。展开前 `.merchant-ui-data-indicator` 共 3 个，展开后 7 个左右。
4. **数据日期来源**：页面正文无 `YYYY-MM-DD` 文本；日期在 `input[placeholder="请选择日期"]` 的 value 中，格式 `MM-DD`（如 `06-10`），需结合运行日补全年份（含跨年回退）。overview 1 日数据仅滞后 1 天。

---

### Task 2: 订单分析类型与指标清洗/日期纯函数

**Files:**
- Create: `src/publicTraffic/orderAnalysis.ts`
- Test: `tests/orderAnalysisParse.test.ts`

按 Task 1 probe 结论：DOM 已可直接取 label/value/delta 三段，纯函数只做清洗（trim、过滤空项）和数据日期补年。

- [ ] **Step 1: 写失败测试**

```ts
// tests/orderAnalysisParse.test.ts
import { describe, expect, it } from 'vitest';
import {
  cleanOrderAnalysisIndicator,
  findOrderAnalysisIndicator,
  resolveOrderAnalysisDataDate,
  shortDataDate,
  type OrderAnalysisPageData,
} from '../src/publicTraffic/orderAnalysis.js';

describe('cleanOrderAnalysisIndicator', () => {
  it('清洗正常指标', () => {
    expect(cleanOrderAnalysisIndicator({ label: ' 签约订单数 ', value: ' 103 ', delta: ' 较前日+32.1% ' })).toEqual({
      label: '签约订单数',
      value: '103',
      delta: '较前日+32.1%',
    });
  });

  it('保留千分位与万单位数值原文', () => {
    expect(cleanOrderAnalysisIndicator({ label: '签约完成金额（元）', value: '3,977', delta: '较前日-25.6%' })).toEqual({
      label: '签约完成金额（元）',
      value: '3,977',
      delta: '较前日-25.6%',
    });
  });

  it('delta 缺失时为空字符串', () => {
    expect(cleanOrderAnalysisIndicator({ label: '平均发货天数', value: '3', delta: '' })).toEqual({ label: '平均发货天数', value: '3', delta: '' });
  });

  it('label 或 value 为空返回 null', () => {
    expect(cleanOrderAnalysisIndicator({ label: '', value: '103', delta: '' })).toBeNull();
    expect(cleanOrderAnalysisIndicator({ label: '签约订单数', value: '', delta: '' })).toBeNull();
  });
});

describe('resolveOrderAnalysisDataDate', () => {
  it('MM-DD 补全年份', () => {
    expect(resolveOrderAnalysisDataDate('06-10', '2026-06-11')).toBe('2026-06-10');
  });

  it('跨年回退到上一年', () => {
    expect(resolveOrderAnalysisDataDate('12-31', '2026-01-01')).toBe('2025-12-31');
  });

  it('完整 YYYY-MM-DD 原样通过', () => {
    expect(resolveOrderAnalysisDataDate('2026-06-10', '2026-06-11')).toBe('2026-06-10');
  });

  it('空值或非法格式返回 null', () => {
    expect(resolveOrderAnalysisDataDate('', '2026-06-11')).toBeNull();
    expect(resolveOrderAnalysisDataDate(null, '2026-06-11')).toBeNull();
    expect(resolveOrderAnalysisDataDate('请选择日期', '2026-06-11')).toBeNull();
  });
});

describe('findOrderAnalysisIndicator / shortDataDate', () => {
  const page: OrderAnalysisPageData = {
    key: 'overview',
    label: '标准订单分析',
    dataDate: '2026-06-10',
    indicators: [{ label: '创建订单数', value: '194', delta: '较前日+71.7%' }],
  };

  it('按标签优先级取值，缺失回退 -', () => {
    expect(findOrderAnalysisIndicator(page, ['创建订单数'])).toBe('194');
    expect(findOrderAnalysisIndicator(page, ['不存在', '创建订单数'])).toBe('194');
    expect(findOrderAnalysisIndicator(page, ['不存在'])).toBe('-');
    expect(findOrderAnalysisIndicator(undefined, ['创建订单数'])).toBe('-');
  });

  it('shortDataDate 截取月日，空值返回未知', () => {
    expect(shortDataDate('2026-06-10')).toBe('06-10');
    expect(shortDataDate(null)).toBe('未知');
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

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

export function cleanOrderAnalysisIndicator(raw: { label: string; value: string; delta: string }): OrderAnalysisIndicator | null {
  const label = normalizeText(raw.label);
  const value = normalizeText(raw.value);
  if (!label || !value) return null;
  return { label, value, delta: normalizeText(raw.delta) };
}

export function resolveOrderAnalysisDataDate(rawValue: string | null | undefined, referenceDate: string): string | null {
  const value = normalizeText(rawValue);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (!/^\d{2}-\d{2}$/.test(value)) return null;
  const year = Number(referenceDate.slice(0, 4));
  const candidate = `${year}-${value}`;
  return candidate <= referenceDate ? candidate : `${year - 1}-${value}`;
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

- [ ] **Step 5: 提交**

```bash
git add src/publicTraffic/orderAnalysis.ts tests/orderAnalysisParse.test.ts
git commit -m "功能：订单分析指标清洗与日期纯函数"
```

---

### Task 3: 订单分析四页爬虫

**Files:**
- Create: `src/crawler/orderAnalysisCrawler.ts`
- Test: `tests/orderAnalysisCrawlerSource.test.ts`

爬虫依赖真实页面，无法单元测试；按仓库惯例用源码 wiring 断言（参照 `tests/exposureCrawlerSource.test.ts`）。选择器以 Task 1 probe 结论为准。

- [ ] **Step 1: 写失败的源码断言测试**

```ts
// tests/orderAnalysisCrawlerSource.test.ts
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('orderAnalysisCrawler wiring', () => {
  it('覆盖四个页面、1日切换、展开与指标选择器，且空指标抛错', async () => {
    const source = await readFile('src/crawler/orderAnalysisCrawler.ts', 'utf8');
    expect(source).toContain('assistant-data-analysis/index/order/');
    expect(source).toContain('ORDER_ANALYSIS_PAGE_KEYS');
    expect(source).toContain("getByText('1日', { exact: true })");
    expect(source).toContain("getByText('展开', { exact: true })");
    expect(source).toContain('.merchant-ui-data-indicator');
    expect(source).toContain('merchant-ui-data-indicator-main-indicator');
    expect(source).toContain('merchant-ui-data-indicator-value-content');
    expect(source).toContain('merchant-ui-data-indicator-supplement-items');
    expect(source).toContain('请选择日期');
    expect(source).toContain('selectSubAccountIfNeeded');
    expect(source).toContain('指标为空');
    expect(source).toContain('cleanOrderAnalysisIndicator');
    expect(source).toContain('resolveOrderAnalysisDataDate');
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

async function expandIndicators(page: Page): Promise<void> {
  const expand = page.getByText('展开', { exact: true }).first();
  if ((await expand.count()) === 0) return;
  await expand.click().catch(() => undefined);
  await page.waitForTimeout(3000);
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
  await selectOneDayPeriod(page, key);
  await expandIndicators(page);

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
        overview: { key: 'overview', label: '标准订单分析', dataDate: '2026-06-10', indicators: [{ label: '签约订单数', value: '103', delta: '较前日+32.1%' }] },
        delivery: { key: 'delivery', label: '发货分析', dataDate: '2026-06-10', indicators: [{ label: '发货订单数', value: '64', delta: '较前日-4.48%' }] },
        return: { key: 'return', label: '归还分析', dataDate: null, indicators: [{ label: '归还订单数', value: '15', delta: '较前日-12.8%' }] },
        customs: { key: 'customs', label: '关单分析', dataDate: '2026-06-10', indicators: [{ label: '关单数', value: '90', delta: '较前日+31.0%' }] },
      },
    },
  };
  const buffer = writePublicTrafficWorkbookBuffer(contextWithOrderAnalysis);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  expect(workbook.SheetNames).toContain('订单分析');
  const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets['订单分析'], { header: 1 });
  const flat = rows.map((row) => (row ?? []).join('|')).join('\n');
  expect(flat).toContain('【标准订单分析】数据日期：2026-06-10');
  expect(flat).toContain('签约订单数|103|较前日+32.1%');
  expect(flat).toContain('【归还分析】数据日期：未知');
  expect(flat).toContain('指标|数值|环比');
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
    aoa.push(['指标', '数值', '环比']);
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

`tests/publicTrafficReport.test.ts` 追加（`contextWithOrderAnalysis` 复用 Task 8 fixture，建议提为文件级共享 fixture；overview indicators 补全为：创建订单数 194、签约订单数 103、发货订单数 64、签约完成金额（元）3,977；delivery 补 待发货订单数 168；return 补 逾期订单数 5）：

```ts
it('卡片今日漏斗输出三行并标注数据日期', () => {
  const card = buildPublicTrafficCard(contextWithOrderAnalysis, paths);
  const json = JSON.stringify(card);
  expect(json).toContain('公域（');
  expect(json).toContain('订单（06-10）');
  expect(json).toContain('履约（发货06-10｜归还未知｜关单06-10）');
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
  expect(markdown).toContain('订单（06-10）：创建订单 194｜签约订单 103｜审出订单 -｜发货订单 64｜签约金额 3,977');
  expect(markdown).toContain('履约（发货06-10｜归还未知｜关单06-10）：待发货 168｜归还 15｜逾期 5｜关单 90');
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

### Task 11: 曝光页每页条数提速

**Files:**
- Modify: `src/crawler/exposureCrawler.ts`
- Test: `tests/exposureCrawlerSource.test.ts`（追加断言）

曝光页商品表目前按默认每页条数逐页点「下一页」（258 商品约 26 页、每页等 2 秒）。复用 `pageSizeProbe.ts` 的 `setDashboardPageSize`（通用 antd size-changer 操作，`.ant-pagination-options-size-changer` 取 `.last()`），在分页循环前尽量调大每页条数。**用户实测：曝光页最多开到 50 条/页**，因此取 `min(preferredPageSize, 50)`。曝光页若无 size-changer 控件则保持默认，不影响正确性——必须 best-effort，失败不抛错。

- [ ] **Step 1: 写失败的源码断言测试**

`tests/exposureCrawlerSource.test.ts` 追加一个 it：

```ts
it('曝光页分页前尝试调大每页条数（best-effort，上限50）', async () => {
  const source = await readFile('src/crawler/exposureCrawler.ts', 'utf8');
  expect(source).toContain('setDashboardPageSize');
  expect(source).toContain('EXPOSURE_MAX_PAGE_SIZE = 50');
  expect(source).toContain('Math.min(');
  expect(source).toContain('每页条数调整失败');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/exposureCrawlerSource.test.ts`
Expected: 新增用例 FAIL

- [ ] **Step 3: 改 exposureCrawler.ts**

```ts
// 顶部 import 追加：
import { setDashboardPageSize } from './pageSizeProbe.js';

// 模块级常量（用户实测曝光页 size-changer 最大选项为 50 条/页）：
const EXPOSURE_MAX_PAGE_SIZE = 50;

// 新增函数（放在 extractProductRows 之前）：
async function tryEnlargePageSize(page: Page, preferredPageSize: number): Promise<void> {
  const size = Math.min(preferredPageSize, EXPOSURE_MAX_PAGE_SIZE);
  try {
    await setDashboardPageSize(page, size);
    console.log(`[曝光] 每页条数已调整为 ${size}`);
  } catch (error) {
    console.log(`[曝光] 每页条数调整失败，保持默认: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// 在调用 extractProductRows(page) 之前（collectExposurePage 内商品表就绪后）插入：
  await tryEnlargePageSize(page, config.preferredPageSize);
```

注意：插入点必须在商品表已渲染之后（`extractProductRows` 调用前一行）；`config` 在 `collectExposurePage` 作用域内已有。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/exposureCrawlerSource.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/crawler/exposureCrawler.ts tests/exposureCrawlerSource.test.ts
git commit -m "优化：曝光页调大每页条数提速"
```

Task 10 实跑时验证：运行日志中 `[曝光] 每页条数已调整为 50`（或调整失败提示），且 `[曝光] 第N页` 总页数明显减少（≈6 页）、商品总数不变（≈258）。

---

## Self-Review 记录

- Spec 覆盖：四页抓取（Task 3）、1日切换（Task 1/3）、失败即整体失败（Task 3 抛错 + Task 4 主流程不捕获）、JSON 落盘（Task 5）、订单分析 sheet（Task 8）、漏斗三行（Task 9）、商品明细汉化（Task 8）、金额列（Task 6/7/8）、测试与回归（各任务 + Task 10）。
- 类型一致性：`OrderAnalysisCapture`（爬虫返回）与 `OrderAnalysisResult`（含 runDate，入 context/xlsx）已区分；`findOrderAnalysisIndicator`/`shortDataDate` 在 Task 2 定义、Task 9 引用。
- 已知不确定点（Task 1 probe 已消除大部分）：「1日」切换、展开、指标节点结构、数据日期来源均已实证；`审出订单数` 不在 overview 收起态指标中（probe 见 `签约订单审出率`），若展开态也无此项则漏斗显示 `-`，属预期行为；delivery/return/customs 三页的指标项结构假定与 overview 相同（同一组件库），Task 10 实跑验证。
