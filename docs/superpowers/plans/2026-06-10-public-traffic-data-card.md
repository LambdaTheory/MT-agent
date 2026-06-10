# 公域数据日报卡片 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 聚合支付宝旧 dashboard 页面和公域曝光页面，生成完整公域数据日报，并通过飞书卡片发送。

**Architecture:** 新增聚合层以 `平台商品ID` 合并公域访问数据页面和公域曝光页面数据，新增展示 ID 映射工具优先输出端内 ID。飞书 App API 增加 interactive card 发送能力，public traffic CLI 在单一浏览器登录工作流中抓取两个页面，生成公域数据上下文并发送卡片，webhook 继续纯文本 fallback。输出统一写入 `output/YYYY-MM-DD/`，使用中文业务文件名。

**Tech Stack:** Node.js, TypeScript, Playwright, Vitest, xlsx-js-style, Feishu IM App API.

---

## File Structure

- Create `src/publicTraffic/displayProductId.ts`: 展示商品 ID 映射，端内 ID 优先，平台 ID fallback。
- Create `tests/publicTrafficDisplayProductId.test.ts`: 覆盖映射命中和未命中。
- Modify `src/publicTraffic/types.ts`: 增加公域数据日报聚合类型、问题分组类型和卡片上下文类型。
- Create `src/publicTraffic/mergePublicTrafficData.ts`: 合并 dashboard 1/7/30 商品指标、曝光 1/7/30 汇总、累计托管数据和 ID 映射。
- Create `tests/mergePublicTrafficData.test.ts`: 覆盖同 ID 聚合、缺一侧数据、展示 ID fallback。
- Create `src/publicTraffic/analyzePublicTrafficData.ts`: 基于聚合行输出整体摘要和问题分组。
- Create `tests/analyzePublicTrafficData.test.ts`: 覆盖曝光不足、曝光有但点击弱、点击有但转化弱、高潜力。
- Modify `src/notify/feishuApp.ts`: 增加 `sendFeishuAppCard`，使用 `msg_type: interactive`。
- Modify `src/notify/feishu.ts`: 增加 `sendFeishuCard`，App API 发卡片，webhook fallback 发文本。
- Modify `tests/feishuApp.test.ts`: 覆盖 interactive 请求体。
- Create `src/publicTraffic/buildPublicTrafficCard.ts`: 构建飞书卡片 JSON。
- Modify `src/publicTraffic/buildPublicTrafficFeishu.ts`: 将文本 fallback 改为公域数据日报 v2 文案。
- Modify `tests/publicTrafficReport.test.ts`: 更新为公域数据日报上下文和卡片测试。
- Modify `src/publicTraffic/buildPublicTrafficMarkdown.ts`: 支持新上下文的 1/7/30 明细和问题分组。
- Modify `src/publicTraffic/buildPublicTrafficWorkbook.ts`: 支持新上下文 workbook。
- Modify `src/cli/publicTrafficReport.ts`: 同时抓取 dashboard 和 exposure，加载映射，聚合分析，发送卡片。
- Create `tests/publicTrafficCliSource.test.ts`: 源码级确认 CLI 串联 dashboard crawl 和 card send。
- Modify `src/publicTraffic/paths.ts`: 公域日报路径改为 `output/YYYY-MM-DD/` 和中文文件名。
- Modify crawler orchestration: 公域日报运行时只打开一次浏览器上下文，并在同一登录态抓取曝光页和公域访问数据页。

## Additional Confirmed Requirements

- 公域数据日报结构保持新结构，不回退到旧 `MT每日运营日报` 章节。
- 旧 dashboard 页面在输出命名中称为“公域访问数据”。
- 当日产物集中在 `output/YYYY-MM-DD/`。
- 中文文件名如下：`公域数据日报_YYYY-MM-DD.md`、`公域数据日报_YYYY-MM-DD.xlsx`、`公域数据上下文_YYYY-MM-DD.json`、`公域数据运行日志_YYYY-MM-DD.log`、`公域访问数据_1日.json`、`公域访问数据_7日.json`、`公域访问数据_30日.json`、`公域曝光总览_YYYY-MM-DD.json`、`公域曝光商品快照_YYYY-MM-DD.json`、`公域曝光日差分_YYYY-MM-DD.json`、`公域曝光7日汇总_YYYY-MM-DD.json`、`公域曝光30日汇总_YYYY-MM-DD.json`。
- JSON 是中间数据和排障证据；最终人读输出仍是 Markdown、XLSX、飞书卡片。

## Task 1: Display Product ID Mapping

**Files:**
- Create: `src/publicTraffic/displayProductId.ts`
- Create: `tests/publicTrafficDisplayProductId.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/publicTrafficDisplayProductId.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildDisplayProductId } from '../src/publicTraffic/displayProductId.js';

describe('buildDisplayProductId', () => {
  it('uses internal product id when mapping exists', () => {
    expect(buildDisplayProductId('platform-1', { 'platform-1': '558' })).toBe('端内ID 558');
  });

  it('falls back to platform product id when mapping is missing', () => {
    expect(buildDisplayProductId('platform-2', { 'platform-1': '558' })).toBe('平台商品ID platform-2');
  });

  it('falls back when mapped value is empty', () => {
    expect(buildDisplayProductId('platform-3', { 'platform-3': '' })).toBe('平台商品ID platform-3');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- tests/publicTrafficDisplayProductId.test.ts`

Expected: FAIL because `../src/publicTraffic/displayProductId.js` does not exist.

- [ ] **Step 3: Implement display ID helper**

Create `src/publicTraffic/displayProductId.ts`:

```ts
import type { ProductIdMapping } from '../mapping/productIdMapping.js';

export function buildDisplayProductId(platformProductId: string, mapping: ProductIdMapping): string {
  const internalProductId = mapping[platformProductId]?.trim();
  return internalProductId ? `端内ID ${internalProductId}` : `平台商品ID ${platformProductId}`;
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `npm test -- tests/publicTrafficDisplayProductId.test.ts`

Expected: PASS with 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/publicTraffic/displayProductId.ts tests/publicTrafficDisplayProductId.test.ts
git commit -m "功能：新增公域商品展示ID映射"
```

## Task 2: Merge Dashboard And Exposure Data

**Files:**
- Modify: `src/publicTraffic/types.ts`
- Create: `src/publicTraffic/mergePublicTrafficData.ts`
- Create: `tests/mergePublicTrafficData.test.ts`

- [ ] **Step 1: Write failing aggregation tests**

Create `tests/mergePublicTrafficData.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { PeriodProductMetrics } from '../src/domain/types.js';
import { mergePublicTrafficData } from '../src/publicTraffic/mergePublicTrafficData.js';
import type { ExposureCumulativeProduct, ExposureProductSummary } from '../src/publicTraffic/types.js';

function dashboard(period: '1d' | '7d' | '30d', platformProductId: string, visits: number, shippedOrders: number): PeriodProductMetrics {
  return {
    period,
    productName: `商品${platformProductId}`,
    platformProductId,
    visits,
    createdOrders: Math.floor(visits / 10),
    signedOrders: Math.floor(visits / 20),
    reviewedOrders: Math.floor(visits / 30),
    shippedOrders,
  };
}

function exposure(platformProductId: string, exposureValue: number, visits: number, amount = 0): ExposureProductSummary {
  return {
    productName: `商品${platformProductId}`,
    platformProductId,
    exposure: exposureValue,
    visits,
    amount,
    visitRate: exposureValue > 0 ? visits / exposureValue : 0,
    days: 1,
    flags: [],
  };
}

const cumulative: ExposureCumulativeProduct[] = [
  { productName: '商品p1', platformProductId: 'p1', exposure: 100, visits: 10, amount: 20, custodyDays: 3, raw: {} },
];

describe('mergePublicTrafficData', () => {
  it('joins dashboard and exposure rows by platform product id', () => {
    const result = mergePublicTrafficData({
      dashboardRows: [dashboard('1d', 'p1', 8, 2)],
      exposureByPeriod: { '1d': [exposure('p1', 100, 10, 50)], '7d': [], '30d': [] },
      cumulativeProducts: cumulative,
      mapping: { p1: '558' },
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      platformProductId: 'p1',
      displayProductId: '端内ID 558',
      custodyDays: 3,
    });
    expect(result.rows[0].periods['1d']).toMatchObject({ exposure: 100, publicVisits: 10, dashboardVisits: 8, shippedOrders: 2, amount: 50 });
  });

  it('keeps rows that exist only in exposure data', () => {
    const result = mergePublicTrafficData({
      dashboardRows: [],
      exposureByPeriod: { '1d': [exposure('p2', 40, 0)], '7d': [], '30d': [] },
      cumulativeProducts: [],
      mapping: {},
    });

    expect(result.rows[0].displayProductId).toBe('平台商品ID p2');
    expect(result.rows[0].periods['1d']).toMatchObject({ exposure: 40, publicVisits: 0, dashboardVisits: 0 });
  });

  it('keeps rows that exist only in dashboard data', () => {
    const result = mergePublicTrafficData({
      dashboardRows: [dashboard('7d', 'p3', 70, 4)],
      exposureByPeriod: { '1d': [], '7d': [], '30d': [] },
      cumulativeProducts: [],
      mapping: { p3: '900' },
    });

    expect(result.rows[0].displayProductId).toBe('端内ID 900');
    expect(result.rows[0].periods['7d']).toMatchObject({ exposure: 0, publicVisits: 0, dashboardVisits: 70, shippedOrders: 4 });
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- tests/mergePublicTrafficData.test.ts`

Expected: FAIL because `mergePublicTrafficData` does not exist and new types are missing.

- [ ] **Step 3: Add public traffic data types**

Append these interfaces to `src/publicTraffic/types.ts`:

```ts
import type { PeriodKey } from '../domain/types.js';

export interface PublicTrafficPeriodMetrics {
  exposure: number;
  publicVisits: number;
  dashboardVisits: number;
  createdOrders: number;
  signedOrders: number;
  reviewedOrders: number;
  shippedOrders: number;
  amount: number;
  exposureVisitRate: number;
  visitCreatedOrderRate: number;
  visitShipmentRate: number;
  hasExposureData: boolean;
  hasDashboardData: boolean;
}

export interface PublicTrafficProductDataRow {
  productName: string;
  platformProductId: string;
  displayProductId: string;
  custodyDays: number | null;
  periods: Record<PeriodKey, PublicTrafficPeriodMetrics>;
}

export interface PublicTrafficDataContext {
  rows: PublicTrafficProductDataRow[];
}
```

If `src/publicTraffic/types.ts` currently has only exports, place the `import type` at line 1 above existing exports.

- [ ] **Step 4: Implement merger**

Create `src/publicTraffic/mergePublicTrafficData.ts`:

```ts
import type { PeriodKey, PeriodProductMetrics } from '../domain/types.js';
import type { ProductIdMapping } from '../mapping/productIdMapping.js';
import { buildDisplayProductId } from './displayProductId.js';
import type { ExposureCumulativeProduct, ExposureProductSummary, PublicTrafficDataContext, PublicTrafficPeriodMetrics } from './types.js';

const PERIODS: PeriodKey[] = ['1d', '7d', '30d'];

export interface MergePublicTrafficDataInput {
  dashboardRows: PeriodProductMetrics[];
  exposureByPeriod: Record<PeriodKey, ExposureProductSummary[]>;
  cumulativeProducts: ExposureCumulativeProduct[];
  mapping: ProductIdMapping;
}

function emptyPeriod(): PublicTrafficPeriodMetrics {
  return {
    exposure: 0,
    publicVisits: 0,
    dashboardVisits: 0,
    createdOrders: 0,
    signedOrders: 0,
    reviewedOrders: 0,
    shippedOrders: 0,
    amount: 0,
    exposureVisitRate: 0,
    visitCreatedOrderRate: 0,
    visitShipmentRate: 0,
    hasExposureData: false,
    hasDashboardData: false,
  };
}

function emptyPeriods(): Record<PeriodKey, PublicTrafficPeriodMetrics> {
  return { '1d': emptyPeriod(), '7d': emptyPeriod(), '30d': emptyPeriod() };
}

export function mergePublicTrafficData(input: MergePublicTrafficDataInput): PublicTrafficDataContext {
  const productNames = new Map<string, string>();
  const custodyDays = new Map<string, number | null>();
  const periodRows = new Map<string, Record<PeriodKey, PublicTrafficPeriodMetrics>>();

  function ensure(platformProductId: string): Record<PeriodKey, PublicTrafficPeriodMetrics> {
    const existing = periodRows.get(platformProductId);
    if (existing) return existing;
    const created = emptyPeriods();
    periodRows.set(platformProductId, created);
    return created;
  }

  for (const row of input.cumulativeProducts) {
    productNames.set(row.platformProductId, row.productName);
    custodyDays.set(row.platformProductId, row.custodyDays);
    ensure(row.platformProductId);
  }

  for (const period of PERIODS) {
    for (const row of input.exposureByPeriod[period] ?? []) {
      productNames.set(row.platformProductId, productNames.get(row.platformProductId) || row.productName);
      const metrics = ensure(row.platformProductId)[period];
      metrics.exposure = row.exposure;
      metrics.publicVisits = row.visits;
      metrics.amount = row.amount;
      metrics.exposureVisitRate = row.exposure > 0 ? row.visits / row.exposure : 0;
      metrics.hasExposureData = true;
    }
  }

  for (const row of input.dashboardRows) {
    productNames.set(row.platformProductId, productNames.get(row.platformProductId) || row.productName);
    const metrics = ensure(row.platformProductId)[row.period];
    metrics.dashboardVisits = row.visits;
    metrics.createdOrders = row.createdOrders;
    metrics.signedOrders = row.signedOrders;
    metrics.reviewedOrders = row.reviewedOrders;
    metrics.shippedOrders = row.shippedOrders;
    metrics.visitCreatedOrderRate = row.visits > 0 ? row.createdOrders / row.visits : 0;
    metrics.visitShipmentRate = row.visits > 0 ? row.shippedOrders / row.visits : 0;
    metrics.hasDashboardData = true;
  }

  return {
    rows: Array.from(periodRows.entries())
      .map(([platformProductId, periods]) => ({
        productName: productNames.get(platformProductId) ?? '',
        platformProductId,
        displayProductId: buildDisplayProductId(platformProductId, input.mapping),
        custodyDays: custodyDays.get(platformProductId) ?? null,
        periods,
      }))
      .sort((a, b) => b.periods['1d'].exposure - a.periods['1d'].exposure || b.periods['7d'].exposure - a.periods['7d'].exposure),
  };
}
```

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/mergePublicTrafficData.test.ts tests/publicTrafficDisplayProductId.test.ts`

Expected: PASS.

- [ ] **Step 6: Build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/publicTraffic/types.ts src/publicTraffic/mergePublicTrafficData.ts tests/mergePublicTrafficData.test.ts
git commit -m "功能：聚合公域曝光和后链路数据"
```

## Task 3: Analyze Public Traffic Data Context

**Files:**
- Modify: `src/publicTraffic/types.ts`
- Create: `src/publicTraffic/analyzePublicTrafficData.ts`
- Create: `tests/analyzePublicTrafficData.test.ts`

- [ ] **Step 1: Write failing analysis tests**

Create `tests/analyzePublicTrafficData.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { analyzePublicTrafficData } from '../src/publicTraffic/analyzePublicTrafficData.js';
import type { PublicTrafficProductDataRow } from '../src/publicTraffic/types.js';

function row(displayProductId: string, exposure: number, publicVisits: number, dashboardVisits: number, shippedOrders: number): PublicTrafficProductDataRow {
  const period = {
    exposure,
    publicVisits,
    dashboardVisits,
    createdOrders: shippedOrders,
    signedOrders: 0,
    reviewedOrders: 0,
    shippedOrders,
    amount: shippedOrders * 100,
    exposureVisitRate: exposure > 0 ? publicVisits / exposure : 0,
    visitCreatedOrderRate: dashboardVisits > 0 ? shippedOrders / dashboardVisits : 0,
    visitShipmentRate: dashboardVisits > 0 ? shippedOrders / dashboardVisits : 0,
    hasExposureData: true,
    hasDashboardData: true,
  };
  return {
    productName: displayProductId,
    platformProductId: displayProductId,
    displayProductId,
    custodyDays: null,
    periods: { '1d': period, '7d': period, '30d': period },
  };
}

describe('analyzePublicTrafficData', () => {
  it('builds one-day funnel summary', () => {
    const report = analyzePublicTrafficData({ date: '2026-06-10', rows: [row('端内ID 1', 1000, 50, 40, 4)] });
    expect(report.summary['1d']).toMatchObject({ exposure: 1000, publicVisits: 50, dashboardVisits: 40, shippedOrders: 4, amount: 400 });
    expect(report.summary['1d'].exposureVisitRate).toBeCloseTo(0.05);
  });

  it('classifies problem and opportunity groups', () => {
    const report = analyzePublicTrafficData({
      date: '2026-06-10',
      rows: [
        row('端内ID low', 10, 0, 0, 0),
        row('端内ID click-weak', 2000, 5, 4, 0),
        row('端内ID conversion-weak', 1500, 120, 100, 0),
        row('端内ID potential', 1500, 180, 160, 8),
      ],
    });

    expect(report.lowExposure[0].identifier).toBe('端内ID low');
    expect(report.weakClick[0].identifier).toBe('端内ID click-weak');
    expect(report.weakConversion[0].identifier).toBe('端内ID conversion-weak');
    expect(report.highPotential[0].identifier).toBe('端内ID potential');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- tests/analyzePublicTrafficData.test.ts`

Expected: FAIL because `analyzePublicTrafficData` does not exist.

- [ ] **Step 3: Add report context types**

Append to `src/publicTraffic/types.ts`:

```ts
export interface PublicTrafficDataSummary {
  exposure: number;
  publicVisits: number;
  dashboardVisits: number;
  createdOrders: number;
  shippedOrders: number;
  amount: number;
  exposureVisitRate: number;
  visitCreatedOrderRate: number;
  visitShipmentRate: number;
}

export interface PublicTrafficDataReportContext {
  date: string;
  summary: Record<PeriodKey, PublicTrafficDataSummary>;
  rows: PublicTrafficProductDataRow[];
  lowExposure: PublicTrafficReportSectionItem[];
  weakClick: PublicTrafficReportSectionItem[];
  weakConversion: PublicTrafficReportSectionItem[];
  highPotential: PublicTrafficReportSectionItem[];
  newProductObservation: PublicTrafficReportSectionItem[];
  lifecycleGovernance: PublicTrafficReportSectionItem[];
}
```

- [ ] **Step 4: Implement analyzer**

Create `src/publicTraffic/analyzePublicTrafficData.ts`:

```ts
import type { PeriodKey } from '../domain/types.js';
import type { PublicTrafficDataContext, PublicTrafficDataReportContext, PublicTrafficDataSummary, PublicTrafficProductDataRow, PublicTrafficReportSectionItem } from './types.js';

const PERIODS: PeriodKey[] = ['1d', '7d', '30d'];
const TOP_N = 5;

function emptySummary(): PublicTrafficDataSummary {
  return { exposure: 0, publicVisits: 0, dashboardVisits: 0, createdOrders: 0, shippedOrders: 0, amount: 0, exposureVisitRate: 0, visitCreatedOrderRate: 0, visitShipmentRate: 0 };
}

function summarize(rows: PublicTrafficProductDataRow[], period: PeriodKey): PublicTrafficDataSummary {
  const summary = rows.reduce((acc, row) => {
    const metrics = row.periods[period];
    acc.exposure += metrics.exposure;
    acc.publicVisits += metrics.publicVisits;
    acc.dashboardVisits += metrics.dashboardVisits;
    acc.createdOrders += metrics.createdOrders;
    acc.shippedOrders += metrics.shippedOrders;
    acc.amount += metrics.amount;
    return acc;
  }, emptySummary());
  summary.exposureVisitRate = summary.exposure > 0 ? summary.publicVisits / summary.exposure : 0;
  summary.visitCreatedOrderRate = summary.dashboardVisits > 0 ? summary.createdOrders / summary.dashboardVisits : 0;
  summary.visitShipmentRate = summary.dashboardVisits > 0 ? summary.shippedOrders / summary.dashboardVisits : 0;
  return summary;
}

function item(row: PublicTrafficProductDataRow, action: string, reason: string): PublicTrafficReportSectionItem {
  return { identifier: row.displayProductId, action, reason };
}

export function analyzePublicTrafficData(input: PublicTrafficDataContext & { date: string }): PublicTrafficDataReportContext {
  const rows = input.rows;
  const one = (row: PublicTrafficProductDataRow) => row.periods['1d'];
  const summary = { '1d': summarize(rows, '1d'), '7d': summarize(rows, '7d'), '30d': summarize(rows, '30d') };

  const lowExposure = rows
    .filter((row) => one(row).exposure <= 50 && one(row).dashboardVisits <= 5 && one(row).shippedOrders === 0)
    .sort((a, b) => one(a).exposure - one(b).exposure)
    .slice(0, TOP_N)
    .map((row) => item(row, '曝光不足', `1日曝光 ${one(row).exposure}，后链路访问 ${one(row).dashboardVisits}，发货 ${one(row).shippedOrders}`));

  const weakClick = rows
    .filter((row) => one(row).exposure >= 1000 && one(row).exposureVisitRate < 0.01)
    .sort((a, b) => one(a).exposureVisitRate - one(b).exposureVisitRate || one(b).exposure - one(a).exposure)
    .slice(0, TOP_N)
    .map((row) => item(row, '曝光有但点击弱', `1日曝光 ${one(row).exposure}，公域访问率 ${(one(row).exposureVisitRate * 100).toFixed(2)}%`));

  const weakConversion = rows
    .filter((row) => one(row).dashboardVisits >= 50 && one(row).shippedOrders === 0)
    .sort((a, b) => one(b).dashboardVisits - one(a).dashboardVisits)
    .slice(0, TOP_N)
    .map((row) => item(row, '点击有但转化弱', `1日后链路访问 ${one(row).dashboardVisits}，发货 ${one(row).shippedOrders}`));

  const highPotential = rows
    .filter((row) => one(row).exposure >= 1000 && one(row).publicVisits >= 100 && one(row).shippedOrders > 0)
    .sort((a, b) => one(b).shippedOrders - one(a).shippedOrders || one(b).publicVisits - one(a).publicVisits)
    .slice(0, TOP_N)
    .map((row) => item(row, '高潜力商品', `1日曝光 ${one(row).exposure}，公域访问 ${one(row).publicVisits}，发货 ${one(row).shippedOrders}`));

  return { date: input.date, summary, rows, lowExposure, weakClick, weakConversion, highPotential, newProductObservation: [], lifecycleGovernance: [] };
}
```

- [ ] **Step 5: Run test and build**

Run: `npm test -- tests/analyzePublicTrafficData.test.ts tests/mergePublicTrafficData.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/publicTraffic/types.ts src/publicTraffic/analyzePublicTrafficData.ts tests/analyzePublicTrafficData.test.ts
git commit -m "功能：分析公域数据日报漏斗"
```

## Task 4: Feishu App Interactive Card Sending

**Files:**
- Modify: `src/notify/feishuApp.ts`
- Modify: `src/notify/feishu.ts`
- Modify: `tests/feishuApp.test.ts`
- Create: `tests/feishuCardDelivery.test.ts`

- [ ] **Step 1: Write failing app card test**

Append to `tests/feishuApp.test.ts`:

```ts
import { sendFeishuAppCard } from '../src/notify/feishuApp.js';

it('sends interactive card message to open_id', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (String(url).includes('/auth/v3/tenant_access_token/internal')) {
      return jsonResponse({ code: 0, tenant_access_token: 'token-1' });
    }
    return jsonResponse({ code: 0, data: { message_id: 'msg-1' } });
  };

  const card = { schema: '2.0', header: { title: { tag: 'plain_text', content: '标题' } }, body: { elements: [] } };
  const result = await sendFeishuAppCard(
    { appId: 'cli_test', appSecret: 'secret', receiveIdType: 'open_id', receiveId: 'ou_test' },
    card,
    fetchImpl as typeof fetch,
  );

  expect(result).toEqual({ sent: true, channel: 'app' });
  expect(JSON.parse(String(calls[1].init.body))).toEqual({
    receive_id: 'ou_test',
    msg_type: 'interactive',
    content: JSON.stringify(card),
  });
});
```

- [ ] **Step 2: Write failing delivery fallback test**

Create `tests/feishuCardDelivery.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sendFeishuCard } from '../src/notify/feishu.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('sendFeishuCard', () => {
  it('uses app card delivery when app config exists', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).includes('/auth/v3/tenant_access_token/internal')) return jsonResponse({ code: 0, tenant_access_token: 'token' });
      return jsonResponse({ code: 0 });
    };

    const result = await sendFeishuCard(
      { FEISHU_APP_ID: 'cli', FEISHU_APP_SECRET: 'secret', FEISHU_RECEIVE_ID: 'ou' },
      { schema: '2.0', body: { elements: [] } },
      'fallback text',
      fetchImpl as typeof fetch,
    );

    expect(result).toEqual({ sent: true, channel: 'app' });
    expect(JSON.parse(String(calls[1].init.body)).msg_type).toBe('interactive');
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

Run: `npm test -- tests/feishuApp.test.ts tests/feishuCardDelivery.test.ts`

Expected: FAIL because card send functions do not exist.

- [ ] **Step 4: Implement app card sender**

Modify `src/notify/feishuApp.ts` by adding exported type and function after `sendFeishuAppText`:

```ts
export type FeishuCardPayload = Record<string, unknown>;

async function getTenantAccessToken(config: FeishuAppConfig, fetchImpl: typeof fetch): Promise<{ token: string } | { reason: string }> {
  const tokenResponse = await fetchImpl('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret }),
  });
  const tokenText = await tokenResponse.text();
  if (!tokenResponse.ok) return { reason: `token request failed: http ${tokenResponse.status}: ${tokenText}` };
  const tokenBody = JSON.parse(tokenText) as { code?: number; tenant_access_token?: string };
  if (tokenBody.code !== 0 || !tokenBody.tenant_access_token) return { reason: `token request failed: ${tokenText}` };
  return { token: tokenBody.tenant_access_token };
}

export async function sendFeishuAppCard(config: FeishuAppConfig, card: FeishuCardPayload, fetchImpl: typeof fetch = fetch): Promise<FeishuAppSendResult> {
  const token = await getTenantAccessToken(config, fetchImpl);
  if ('reason' in token) return { sent: false, channel: 'app', reason: token.reason };

  const messageResponse = await fetchImpl(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(config.receiveIdType)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.token}` },
    body: JSON.stringify({ receive_id: config.receiveId, msg_type: 'interactive', content: JSON.stringify(card) }),
  });
  const messageText = await messageResponse.text();
  if (!messageResponse.ok) return { sent: false, channel: 'app', reason: `message send failed: http ${messageResponse.status}: ${messageText}` };
  const messageBody = JSON.parse(messageText) as { code?: number };
  if (messageBody.code !== 0) return { sent: false, channel: 'app', reason: `message send failed: ${messageText}` };
  return { sent: true, channel: 'app' };
}
```

Then refactor `sendFeishuAppText` to use `getTenantAccessToken` so token logic is not duplicated. Preserve its existing request body with `msg_type: 'text'`.

- [ ] **Step 5: Implement generic card delivery**

Modify `src/notify/feishu.ts` imports:

```ts
import { sendFeishuAppCard, sendFeishuAppText, type FeishuAppConfig, type FeishuCardPayload } from './feishuApp.js';
```

Add after `sendFeishuText`:

```ts
export async function sendFeishuCard(
  env: FeishuEnv,
  card: FeishuCardPayload,
  fallbackText: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FeishuDeliveryResult> {
  const appConfig = appConfigFromEnv(env);
  if (appConfig) {
    return sendFeishuAppCard(appConfig, card, fetchImpl);
  }

  if (env.FEISHU_WEBHOOK_URL) {
    const result = await sendFeishuWebhookText(env.FEISHU_WEBHOOK_URL, fallbackText, fetchImpl);
    return result.sent ? { sent: true, channel: 'webhook' } : { sent: false, channel: 'webhook', reason: result.reason };
  }

  return { sent: false, channel: 'none', reason: 'missing Feishu app config and webhook url' };
}
```

- [ ] **Step 6: Run tests and build**

Run: `npm test -- tests/feishuApp.test.ts tests/feishuCardDelivery.test.ts tests/feishuDelivery.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/notify/feishuApp.ts src/notify/feishu.ts tests/feishuApp.test.ts tests/feishuCardDelivery.test.ts
git commit -m "功能：支持飞书应用卡片发送"
```

## Task 5: Build Feishu Card And Report Outputs

**Files:**
- Create: `src/publicTraffic/buildPublicTrafficCard.ts`
- Modify: `src/publicTraffic/buildPublicTrafficFeishu.ts`
- Modify: `src/publicTraffic/buildPublicTrafficMarkdown.ts`
- Modify: `src/publicTraffic/buildPublicTrafficWorkbook.ts`
- Modify: `tests/publicTrafficReport.test.ts`

- [ ] **Step 1: Update output tests for data report and card**

Modify `tests/publicTrafficReport.test.ts` to import the card builder and use `PublicTrafficDataReportContext`:

```ts
import { buildPublicTrafficCard } from '../src/publicTraffic/buildPublicTrafficCard.js';
import type { PublicTrafficDataReportContext } from '../src/publicTraffic/types.js';

const context: PublicTrafficDataReportContext = {
  date: '2026-06-10',
  summary: {
    '1d': { exposure: 1000, publicVisits: 50, dashboardVisits: 40, createdOrders: 4, shippedOrders: 2, amount: 300, exposureVisitRate: 0.05, visitCreatedOrderRate: 0.1, visitShipmentRate: 0.05 },
    '7d': { exposure: 7000, publicVisits: 350, dashboardVisits: 280, createdOrders: 20, shippedOrders: 10, amount: 1500, exposureVisitRate: 0.05, visitCreatedOrderRate: 0.0714, visitShipmentRate: 0.0357 },
    '30d': { exposure: 30000, publicVisits: 1500, dashboardVisits: 1200, createdOrders: 80, shippedOrders: 40, amount: 6000, exposureVisitRate: 0.05, visitCreatedOrderRate: 0.0667, visitShipmentRate: 0.0333 },
  },
  rows: [],
  lowExposure: [{ identifier: '端内ID 558', action: '曝光不足', reason: '1日曝光 10' }],
  weakClick: [{ identifier: '端内ID 421', action: '曝光有但点击弱', reason: '访问率低' }],
  weakConversion: [{ identifier: '端内ID 900', action: '点击有但转化弱', reason: '访问有发货弱' }],
  highPotential: [{ identifier: '端内ID 333', action: '高潜力商品', reason: '可继续放量' }],
  newProductObservation: [],
  lifecycleGovernance: [],
};
```

Ensure tests assert:

```ts
expect(buildPublicTrafficFeishuText(context, { markdownPath: 'report.md', workbookPath: 'report.xlsx' })).toContain('公域数据日报 2026-06-10');
expect(buildPublicTrafficMarkdown(context)).toContain('# 公域数据日报 2026-06-10');
const card = buildPublicTrafficCard(context, { markdownPath: 'report.md', workbookPath: 'report.xlsx' });
expect(card.header).toMatchObject({ title: { tag: 'plain_text', content: '公域数据日报 2026-06-10' } });
expect(JSON.stringify(card)).toContain('端内ID 558');
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- tests/publicTrafficReport.test.ts`

Expected: FAIL because builders still expect old context and card builder does not exist.

- [ ] **Step 3: Implement card builder**

Create `src/publicTraffic/buildPublicTrafficCard.ts`:

```ts
import type { FeishuCardPayload } from '../notify/feishuApp.js';
import type { PublicTrafficDataReportContext, PublicTrafficReportPaths, PublicTrafficReportSectionItem } from './types.js';

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function topText(title: string, items: PublicTrafficReportSectionItem[]): string {
  const lines = items.length > 0 ? items.slice(0, 5).map((item, index) => `${index + 1}. ${item.identifier}｜${item.reason}`) : ['无'];
  return `**${title}**\n${lines.join('\n')}`;
}

export function buildPublicTrafficCard(context: PublicTrafficDataReportContext, paths: PublicTrafficReportPaths): FeishuCardPayload {
  const one = context.summary['1d'];
  return {
    schema: '2.0',
    config: { update_multi: true },
    header: {
      title: { tag: 'plain_text', content: `公域数据日报 ${context.date}` },
      template: 'blue',
    },
    body: {
      elements: [
        { tag: 'markdown', content: `**今日漏斗**\n曝光：${one.exposure}\n公域访问：${one.publicVisits}\n后链路访问：${one.dashboardVisits}\n订单：${one.createdOrders}\n发货：${one.shippedOrders}\n金额：¥${one.amount.toFixed(2)}\n曝光到访问率：${percent(one.exposureVisitRate)}\n访问到发货率：${percent(one.visitShipmentRate)}` },
        { tag: 'hr' },
        { tag: 'markdown', content: `**模块数量**\n曝光不足：${context.lowExposure.length}个\n曝光有但点击弱：${context.weakClick.length}个\n点击有但转化弱：${context.weakConversion.length}个\n高潜力商品：${context.highPotential.length}个` },
        { tag: 'hr' },
        { tag: 'markdown', content: topText('曝光不足 Top5', context.lowExposure) },
        { tag: 'markdown', content: topText('点击弱 Top5', context.weakClick) },
        { tag: 'markdown', content: topText('转化弱 Top5', context.weakConversion) },
        { tag: 'markdown', content: `**报告文件**\nMarkdown：${paths.markdownPath}\nXLSX：${paths.workbookPath}` },
      ],
    },
  };
}
```

- [ ] **Step 4: Update text fallback**

Modify `src/publicTraffic/buildPublicTrafficFeishu.ts` to accept `PublicTrafficDataReportContext` and produce v2 text:

```ts
import type { PublicTrafficDataReportContext, PublicTrafficReportPaths, PublicTrafficReportSectionItem } from './types.js';

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function topLines(items: PublicTrafficReportSectionItem[], limit = 5): string[] {
  return items.length > 0 ? items.slice(0, limit).map((item, index) => `${index + 1}. ${item.identifier}｜${item.reason}`) : ['无'];
}

export function buildPublicTrafficFeishuText(context: PublicTrafficDataReportContext, paths: PublicTrafficReportPaths): string {
  const one = context.summary['1d'];
  return [
    `公域数据日报 ${context.date}`,
    '',
    '今日漏斗',
    `曝光：${one.exposure}`,
    `公域访问：${one.publicVisits}`,
    `后链路访问：${one.dashboardVisits}`,
    `订单：${one.createdOrders}`,
    `发货：${one.shippedOrders}`,
    `金额：¥${one.amount.toFixed(2)}`,
    `曝光到访问率：${percent(one.exposureVisitRate)}`,
    `访问到发货率：${percent(one.visitShipmentRate)}`,
    '',
    '模块数量',
    `曝光不足：${context.lowExposure.length}个`,
    `点击弱：${context.weakClick.length}个`,
    `转化弱：${context.weakConversion.length}个`,
    `高潜力：${context.highPotential.length}个`,
    '',
    '曝光不足 Top5',
    ...topLines(context.lowExposure),
    '',
    '点击弱 Top5',
    ...topLines(context.weakClick),
    '',
    `Markdown：${paths.markdownPath}`,
    `XLSX：${paths.workbookPath}`,
  ].join('\n');
}
```

- [ ] **Step 5: Update markdown/workbook builders**

Modify markdown and workbook builders to use `PublicTrafficDataReportContext`. Preserve existing helper style. Required output sections:

```md
# 公域数据日报 YYYY-MM-DD
## 1日总览
## 7日总览
## 30日总览
## 曝光不足
## 曝光有但点击弱
## 点击有但转化弱
## 高潜力商品
## 新品观察
## 生命周期治理
```

Workbook sheet names must be:

```ts
['总览', '商品明细', '曝光不足', '点击弱', '转化弱', '高潜力', '新品观察', '生命周期治理']
```

The `商品明细` sheet should include at least: `platformProductId`, `displayProductId`, `productName`, `custodyDays`, `1d_exposure`, `1d_publicVisits`, `1d_dashboardVisits`, `1d_shippedOrders`, `7d_exposure`, `30d_exposure`.

- [ ] **Step 6: Run output tests and build**

Run: `npm test -- tests/publicTrafficReport.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/publicTraffic/buildPublicTrafficCard.ts src/publicTraffic/buildPublicTrafficFeishu.ts src/publicTraffic/buildPublicTrafficMarkdown.ts src/publicTraffic/buildPublicTrafficWorkbook.ts tests/publicTrafficReport.test.ts
git commit -m "功能：生成公域数据日报卡片"
```

## Task 6: Wire Public Traffic CLI To Two Pages

**Files:**
- Modify: `src/cli/publicTrafficReport.ts`
- Create: `tests/publicTrafficCliSource.test.ts`

- [ ] **Step 1: Write source-level wiring test**

Create `tests/publicTrafficCliSource.test.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function source(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

describe('public traffic CLI wiring', () => {
  it('crawls both exposure page and dashboard page before report generation', async () => {
    const text = await source('../src/cli/publicTrafficReport.ts');
    expect(text).toContain("import { crawlDashboard } from '../crawler/dashboardCrawler.js';");
    expect(text).toContain('const rawTables = await crawlDashboard(config);');
    expect(text.indexOf('const rawTables = await crawlDashboard(config);')).toBeLessThan(text.indexOf('mergePublicTrafficData({'));
  });

  it('loads product mapping and sends a Feishu card', async () => {
    const text = await source('../src/cli/publicTrafficReport.ts');
    expect(text).toContain("import { loadProductIdMapping } from '../mapping/productIdMapping.js';");
    expect(text).toContain('buildPublicTrafficCard(context,');
    expect(text).toContain('sendFeishuCard(process.env, card, fallbackText)');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- tests/publicTrafficCliSource.test.ts`

Expected: FAIL because CLI is not wired to dashboard crawl or card send yet.

- [ ] **Step 3: Add imports to CLI**

Modify `src/cli/publicTrafficReport.ts` imports:

```ts
import { crawlDashboard } from '../crawler/dashboardCrawler.js';
import { normalizeRowsForPeriod } from '../extractor/normalizeRows.js';
import { loadProductIdMapping } from '../mapping/productIdMapping.js';
import { sendFeishuCard } from '../notify/feishu.js';
import { analyzePublicTrafficData } from '../publicTraffic/analyzePublicTrafficData.js';
import { buildPublicTrafficCard } from '../publicTraffic/buildPublicTrafficCard.js';
import { mergePublicTrafficData } from '../publicTraffic/mergePublicTrafficData.js';
```

Remove unused `sendFeishuText` import after card send is wired.

- [ ] **Step 4: Add safe mapping loader**

Inside `src/cli/publicTrafficReport.ts`, add helper near `loadPreviousCumulative`:

```ts
async function loadMappingSafely(path: string | undefined, log: ReturnType<typeof createRunLog>) {
  if (!path) {
    log.addEvent('商品ID映射跳过: 未配置 productIdMappingPath');
    return {};
  }
  try {
    return await loadProductIdMapping(path);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      log.addEvent(`商品ID映射缺失: ${path}`);
      return {};
    }
    throw error;
  }
}
```

- [ ] **Step 5: Wire dashboard crawl and aggregation**

In `runPublicTrafficReportCli`, after exposure crawl and exposure summary writes, add dashboard crawl before analysis:

```ts
log.addEvent('开始抓取后链路数据');
const rawTables = await crawlDashboard(config);
for (const table of rawTables) {
  log.addPeriodStats(table.collection);
}
const dashboardRows = rawTables.flatMap(normalizeRowsForPeriod);
log.addEvent(`后链路数据: ${dashboardRows.length} 条周期商品记录`);

const mapping = await loadMappingSafely(config.productIdMappingPath, log);
const merged = mergePublicTrafficData({
  dashboardRows,
  exposureByPeriod: {
    '1d': dailyDelta.map((row) => ({
      productName: row.productName,
      platformProductId: row.platformProductId,
      exposure: row.exposure,
      visits: row.visits,
      amount: row.amount,
      visitRate: row.exposure > 0 ? row.visits / row.exposure : 0,
      days: 1,
      flags: row.flags,
    })),
    '7d': sevenDaySummary,
    '30d': thirtyDaySummary,
  },
  cumulativeProducts: crawlResult.products,
  mapping,
});
const context = analyzePublicTrafficData({ date, rows: merged.rows });
```

Replace the old `analyzePublicTraffic(...)` call and old `PublicTrafficReportContext` construction with this new `context`.

- [ ] **Step 6: Wire card send**

Replace text-only send with:

```ts
const card = buildPublicTrafficCard(context, {
  markdownPath: paths.markdown,
  workbookPath: paths.workbook,
});
const fallbackText = buildPublicTrafficFeishuText(context, {
  markdownPath: paths.markdown,
  workbookPath: paths.workbook,
});

await sendFeishuCardSafely(card, fallbackText, log);
console.log(fallbackText);
```

Replace `sendFeishuTextSafely` helper with:

```ts
async function sendFeishuCardSafely(card: Record<string, unknown>, fallbackText: string, log: ReturnType<typeof createRunLog>): Promise<void> {
  try {
    const feishuResult = await sendFeishuCard(process.env, card, fallbackText);
    log.addEvent(feishuResult.sent ? '飞书通知已发送' : `飞书通知跳过: ${feishuResult.reason}`);
  } catch (error) {
    log.addEvent(`飞书通知失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}
```

- [ ] **Step 7: Run tests and build**

Run: `npm test -- tests/publicTrafficCliSource.test.ts tests/publicTrafficReport.test.ts tests/mergePublicTrafficData.test.ts tests/analyzePublicTrafficData.test.ts`

Expected: PASS.

Run: `npm test`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/cli/publicTrafficReport.ts tests/publicTrafficCliSource.test.ts
git commit -m "功能：串联双页公域数据日报"
```

## Task 7: Local Live Verification

**Files:**
- No source changes unless verification reveals a bug.

- [ ] **Step 1: Verify `.env` remains ignored**

Run: `git status --short`

Expected: no `.env` entry.

- [ ] **Step 2: Run live report**

Run: `npm run public-traffic-report`

Expected:

- Browser may request Alipay login.
- Exposure page crawl completes.
- Dashboard page crawl completes for `1d`, `7d`, `30d`.
- Console prints `公域数据日报 YYYY-MM-DD`.
- `output/public-traffic/YYYY-MM-DD/run.log` contains `飞书通知已发送`.
- Feishu receives an interactive card, not a plain text App API message.

- [ ] **Step 3: Inspect generated report files**

Open generated files by path shown in console:

- `output/public-traffic/YYYY-MM-DD/report-context.json`
- `output/public-traffic/YYYY-MM-DD/public-traffic-report.md`
- `output/public-traffic/YYYY-MM-DD/public-traffic-report.xlsx`

Expected:

- `report-context.json` includes `summary`, `rows`, `lowExposure`, `weakClick`, `weakConversion`, and `highPotential`.
- Markdown title is `公域数据日报 YYYY-MM-DD`.
- Workbook includes sheets `总览`, `商品明细`, `曝光不足`, `点击弱`, `转化弱`, `高潜力`, `新品观察`, `生命周期治理`.
- Product identifiers in card/report use `端内ID ...` where mapping exists and `平台商品ID ...` where missing.

- [ ] **Step 4: Final verification**

Run: `npm test`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

Run: `git status --short`

Expected: only intentional generated output changes, or no changes if outputs are ignored. `.env` must not appear.

- [ ] **Step 5: Commit verification fixes if needed**

If source code changed during verification:

```bash
git add src tests
git commit -m "修复：完善公域数据日报卡片验证"
```

Do not add `.env` or generated output files unless the repository already tracks those exact outputs intentionally.

## Final Review

- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Verify `git status --short` does not include `.env`.
- [ ] Request code review for the implementation range.

## Self-Review Notes

- Spec coverage: two main pages, platform ID join, internal ID display fallback, 1/7/30 detail retention, 1d card summary, App API interactive card, webhook text fallback, and live verification are covered.
- Placeholder scan: this plan contains no unfinished placeholder markers; all implementation tasks include concrete file paths, commands, and expected outcomes.
- Type consistency: `PublicTrafficDataReportContext`, `PublicTrafficProductDataRow`, `PublicTrafficPeriodMetrics`, `sendFeishuCard`, and `buildPublicTrafficCard` are introduced before use in later tasks.
