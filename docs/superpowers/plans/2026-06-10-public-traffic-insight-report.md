# 公域数据日报洞察增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将公域数据日报升级为包含较昨日结论、独立建议操作、六类问题/机会模块和更完整飞书/Markdown/XLSX 输出的经营决策日报。

**Architecture:** 在现有 `PublicTrafficDataReportContext` 上扩展结论、建议操作和空模块说明；`publicTrafficReport` 读取昨日上下文并把日差分/汇总/累计数据传入分析层；输出层只负责渲染，不内置业务判断。分析仍基于现有抓取结果，不新增页面，不自动修改商品。

**Tech Stack:** Node.js, TypeScript, Vitest, Playwright crawler outputs, xlsx-js-style, Feishu interactive card.

---

## File Structure

- Modify `src/publicTraffic/types.ts`: 增加 `PublicTrafficConclusion`、`PublicTrafficEmptySectionNotes`、`PublicTrafficDataAnalysisInput`，并扩展 `PublicTrafficDataReportContext`。
- Modify `src/publicTraffic/analyzePublicTrafficData.ts`: 生成较昨日结论、六类模块、独立建议操作和空模块说明。
- Modify `src/cli/publicTrafficReport.ts`: 读取昨日 `公域数据上下文`，把 `dailyDelta`、`sevenDaySummary`、`thirtyDaySummary`、`cumulativeProducts`、`previousSummary` 传给分析层。
- Modify `src/publicTraffic/buildPublicTrafficCard.ts`: 飞书卡片新增经营结论、建议操作、新品观察和生命周期治理。
- Modify `src/publicTraffic/buildPublicTrafficFeishu.ts`: webhook/text fallback 同步增强。
- Modify `src/publicTraffic/buildPublicTrafficMarkdown.ts`: Markdown 新增经营结论、建议操作和解释性空模块文案。
- Modify `src/publicTraffic/buildPublicTrafficWorkbook.ts`: XLSX 增加 `建议操作` Sheet，并保留六类模块。
- Modify `tests/analyzePublicTrafficData.test.ts`: 覆盖昨日对比、推荐操作、新品观察、生命周期治理和空模块说明。
- Modify `tests/publicTrafficReport.test.ts`: 覆盖飞书、Markdown、XLSX 输出增强。
- Modify `tests/publicTrafficReportCliBehavior.test.ts`: 覆盖 CLI 读取昨日上下文并传入分析层。

## Task 1: Extend Report Types

**Files:**
- Modify: `src/publicTraffic/types.ts`

- [ ] **Step 1: Add report insight types**

In `src/publicTraffic/types.ts`, after `PublicTrafficDataSummary`, add:

```ts
export interface PublicTrafficConclusion {
  label: string;
  text: string;
}

export interface PublicTrafficEmptySectionNotes {
  lowExposure: string;
  weakClick: string;
  weakConversion: string;
  highPotential: string;
  newProductObservation: string;
  lifecycleGovernance: string;
  recommendedActions: string;
}
```

Then update `PublicTrafficDataReportContext` to:

```ts
export interface PublicTrafficDataReportContext {
  date: string;
  summary: Record<PeriodKey, PublicTrafficDataSummary>;
  conclusions: PublicTrafficConclusion[];
  rows: PublicTrafficProductDataRow[];
  lowExposure: PublicTrafficReportSectionItem[];
  weakClick: PublicTrafficReportSectionItem[];
  weakConversion: PublicTrafficReportSectionItem[];
  highPotential: PublicTrafficReportSectionItem[];
  newProductObservation: PublicTrafficReportSectionItem[];
  lifecycleGovernance: PublicTrafficReportSectionItem[];
  recommendedActions: PublicTrafficReportSectionItem[];
  emptySectionNotes: PublicTrafficEmptySectionNotes;
}
```

Add this input type after `PublicTrafficDataReportContext`:

```ts
export interface PublicTrafficDataAnalysisInput extends PublicTrafficDataContext {
  date: string;
  overview?: ExposureOverviewMetric[];
  previousSummary?: PublicTrafficDataSummary;
  dailyDelta?: ExposureDailyDelta[];
  sevenDaySummary?: ExposureProductSummary[];
  thirtyDaySummary?: ExposureProductSummary[];
  cumulativeProducts?: ExposureCumulativeProduct[];
}
```

- [ ] **Step 2: Run build to see dependent type failures**

Run: `npm run build`

Expected: FAIL because existing report context literals and builders do not provide the new required fields.

- [ ] **Step 3: Do not commit yet**

Leave this task uncommitted until Task 2 provides implementation and tests for the new fields.

## Task 2: Analyze Conclusions And Insight Modules

**Files:**
- Modify: `tests/analyzePublicTrafficData.test.ts`
- Modify: `src/publicTraffic/analyzePublicTrafficData.ts`

- [ ] **Step 1: Replace the row helper in tests**

In `tests/analyzePublicTrafficData.test.ts`, update the helper so each period can differ:

```ts
function metric(
  exposure: number,
  publicVisits: number,
  dashboardVisits: number,
  shippedOrders: number,
  hasExposureData = true,
  hasDashboardData = true,
) {
  return {
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
    hasExposureData,
    hasDashboardData,
  };
}

function row(
  displayProductId: string,
  oneDay = metric(0, 0, 0, 0),
  sevenDay = oneDay,
  thirtyDay = sevenDay,
  custodyDays: number | null = null,
): PublicTrafficProductDataRow {
  return {
    productName: displayProductId,
    platformProductId: displayProductId,
    displayProductId,
    custodyDays,
    periods: { '1d': oneDay, '7d': sevenDay, '30d': thirtyDay },
  };
}
```

Update existing calls from `row('端内ID 1', 1000, 50, 40, 4)` to `row('端内ID 1', metric(1000, 50, 40, 4))` and similarly for all existing tests.

- [ ] **Step 2: Add failing tests for new analysis output**

Append these tests inside the `describe('analyzePublicTrafficData', ...)` block:

```ts
it('builds multiple conclusions compared with yesterday', () => {
  const report = analyzePublicTrafficData({
    date: '2026-06-10',
    rows: [row('端内ID 1', metric(1200, 80, 60, 6))],
    previousSummary: {
      exposure: 1000,
      publicVisits: 50,
      dashboardVisits: 45,
      createdOrders: 4,
      shippedOrders: 3,
      amount: 300,
      exposureVisitRate: 0.05,
      visitCreatedOrderRate: 0.0889,
      visitShipmentRate: 0.0667,
    },
  });

  expect(report.conclusions.map((item) => item.label)).toEqual(['曝光', '公域访问', '金额', '发货', '曝光到访问率', '访问到发货率']);
  expect(report.conclusions[0].text).toContain('较昨日上升 200');
  expect(report.conclusions[1].text).toContain('较昨日上升 30');
  expect(report.conclusions[3].text).toContain('较昨日上升 3');
  expect(report.conclusions[4].text).toContain('百分点');
});

it('builds baseline conclusions when yesterday summary is missing', () => {
  const report = analyzePublicTrafficData({ date: '2026-06-10', rows: [row('端内ID 1', metric(1000, 50, 40, 4))] });

  expect(report.conclusions.length).toBeGreaterThan(0);
  expect(report.conclusions[0].text).toContain('暂无昨日公域数据上下文');
});

it('builds new product observation from daily new_product deltas', () => {
  const report = analyzePublicTrafficData({
    date: '2026-06-10',
    rows: [row('端内ID 888', metric(12, 0, 0, 0))],
    dailyDelta: [
      {
        date: '2026-06-10',
        productName: '新品',
        platformProductId: '端内ID 888',
        exposure: 12,
        visits: 0,
        amount: 0,
        custodyDays: 1,
        flags: ['new_product'],
      },
    ],
  });

  expect(report.newProductObservation[0]).toMatchObject({
    identifier: '端内ID 888',
    action: '观察 3-7 天，重点看曝光、访问和首单/发货',
  });
});

it('builds lifecycle governance from weak thirty-day performance', () => {
  const report = analyzePublicTrafficData({
    date: '2026-06-10',
    rows: [row('端内ID old', metric(0, 0, 0, 0), metric(5, 0, 0, 0), metric(60, 1, 1, 0), 45)],
  });

  expect(report.lifecycleGovernance[0]).toMatchObject({
    identifier: '端内ID old',
    action: '下架、替换或重做素材',
  });
});

it('builds prioritized recommended actions with executable action text', () => {
  const report = analyzePublicTrafficData({
    date: '2026-06-10',
    rows: [
      row('端内ID conversion', metric(1000, 120, 100, 0)),
      row('端内ID click', metric(2000, 5, 5, 0), metric(5000, 20, 20, 0)),
      row('端内ID potential', metric(1500, 160, 120, 8)),
    ],
  });

  expect(report.recommendedActions[0]).toMatchObject({
    identifier: '端内ID conversion',
    action: '检查价格/押金/库存/风控/履约链路',
  });
  expect(report.recommendedActions.map((item) => item.action).join('\n')).toContain('优化主图、标题、价格露出和首屏卖点');
  expect(report.recommendedActions.map((item) => item.action).join('\n')).toContain('继续放量');
});

it('provides explanatory notes for empty sections', () => {
  const report = analyzePublicTrafficData({ date: '2026-06-10', rows: [] });

  expect(report.emptySectionNotes.lowExposure).toBe('暂无达到阈值的曝光不足商品。');
  expect(report.emptySectionNotes.recommendedActions).toBe('暂无需要立即处理的建议操作。');
});
```

- [ ] **Step 3: Run tests to verify failure**

Run: `npm test -- tests/analyzePublicTrafficData.test.ts`

Expected: FAIL because `conclusions`, `recommendedActions`, `emptySectionNotes`, new product observation, and lifecycle governance are missing.

- [ ] **Step 4: Implement analysis helpers**

In `src/publicTraffic/analyzePublicTrafficData.ts`, replace the imports with:

```ts
import type { PeriodKey } from '../domain/types.js';
import type {
  ExposureOverviewMetric,
  PublicTrafficDataAnalysisInput,
  PublicTrafficDataReportContext,
  PublicTrafficDataSummary,
  PublicTrafficEmptySectionNotes,
  PublicTrafficProductDataRow,
  PublicTrafficReportSectionItem,
} from './types.js';
```

Add these helpers after `emptySummary()`:

```ts
const EMPTY_SECTION_NOTES: PublicTrafficEmptySectionNotes = {
  lowExposure: '暂无达到阈值的曝光不足商品。',
  weakClick: '暂无达到阈值的高曝光低点击商品。',
  weakConversion: '暂无达到阈值的高访问低转化商品。',
  highPotential: '暂无达到放量阈值的高潜力商品。',
  newProductObservation: '暂无可识别的新进入公域商品，或今日缺少上一日快照。',
  lifecycleGovernance: '暂无达到长期弱表现阈值的托管商品。',
  recommendedActions: '暂无需要立即处理的建议操作。',
};

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function signedNumber(value: number): string {
  if (value > 0) return `上升 ${Number.isInteger(value) ? value : value.toFixed(2)}`;
  if (value < 0) return `下降 ${Number.isInteger(value) ? Math.abs(value) : Math.abs(value).toFixed(2)}`;
  return '持平 0';
}

function changeText(label: string, current: number, previous: number, unit = ''): string {
  const diff = current - previous;
  const pct = previous > 0 ? `，变化 ${(diff / previous * 100).toFixed(2)}%` : '';
  return `${label} ${current}${unit}，较昨日${signedNumber(diff)}${unit}${pct}`;
}

function pointChangeText(label: string, current: number, previous: number): string {
  const diff = (current - previous) * 100;
  if (diff > 0) return `${label} ${percent(current)}，较昨日上升 ${diff.toFixed(2)} 个百分点`;
  if (diff < 0) return `${label} ${percent(current)}，较昨日下降 ${Math.abs(diff).toFixed(2)} 个百分点`;
  return `${label} ${percent(current)}，较昨日持平`;
}

function buildConclusions(summary: PublicTrafficDataSummary, previous?: PublicTrafficDataSummary) {
  if (!previous) {
    return [
      { label: '基准', text: `暂无昨日公域数据上下文，今日仅展示基准值：曝光 ${summary.exposure}，公域访问 ${summary.publicVisits}，发货 ${summary.shippedOrders}，金额 ¥${summary.amount.toFixed(2)}。` },
    ];
  }

  return [
    { label: '曝光', text: changeText('曝光', summary.exposure, previous.exposure) },
    { label: '公域访问', text: changeText('公域访问', summary.publicVisits, previous.publicVisits) },
    { label: '金额', text: changeText('金额', summary.amount, previous.amount, '元') },
    { label: '发货', text: changeText('发货', summary.shippedOrders, previous.shippedOrders) },
    { label: '曝光到访问率', text: pointChangeText('曝光到访问率', summary.exposureVisitRate, previous.exposureVisitRate) },
    { label: '访问到发货率', text: pointChangeText('访问到发货率', summary.visitShipmentRate, previous.visitShipmentRate) },
  ];
}
```

Update `item` to keep its signature. Add this helper after `item`:

```ts
function byPlatformId(rows: PublicTrafficProductDataRow[]): Map<string, PublicTrafficProductDataRow> {
  return new Map(rows.map((row) => [row.platformProductId, row]));
}

function buildRecommendedActions(sections: {
  weakConversion: PublicTrafficReportSectionItem[];
  weakClick: PublicTrafficReportSectionItem[];
  lifecycleGovernance: PublicTrafficReportSectionItem[];
  highPotential: PublicTrafficReportSectionItem[];
  newProductObservation: PublicTrafficReportSectionItem[];
  lowExposure: PublicTrafficReportSectionItem[];
}): PublicTrafficReportSectionItem[] {
  return [
    ...sections.weakConversion,
    ...sections.weakClick,
    ...sections.lifecycleGovernance,
    ...sections.highPotential,
    ...sections.newProductObservation,
    ...sections.lowExposure,
  ].slice(0, 20);
}
```

- [ ] **Step 5: Implement enhanced module classification**

Replace the body of `analyzePublicTrafficData` with this implementation:

```ts
export function analyzePublicTrafficData(input: PublicTrafficDataAnalysisInput): PublicTrafficDataReportContext {
  const rows = input.rows;
  const one = (row: PublicTrafficProductDataRow) => row.periods['1d'];
  const seven = (row: PublicTrafficProductDataRow) => row.periods['7d'];
  const thirty = (row: PublicTrafficProductDataRow) => row.periods['30d'];
  const summary = Object.fromEntries(PERIODS.map((period) => [period, applyOverview(summarize(rows, period), input.overview?.find((item) => item.period === period))])) as Record<
    PeriodKey,
    PublicTrafficDataSummary
  >;
  const rowsById = byPlatformId(rows);

  const lowExposure = rows
    .filter((row) => row.custodyDays !== null || one(row).hasExposureData || seven(row).hasExposureData)
    .filter((row) => (one(row).exposure <= 50 && seven(row).exposure <= 300) || (seven(row).publicVisits <= 3 && thirty(row).publicVisits <= 10))
    .filter((row) => one(row).shippedOrders === 0 && seven(row).shippedOrders === 0)
    .sort((a, b) => seven(a).exposure - seven(b).exposure || one(a).exposure - one(b).exposure)
    .slice(0, TOP_N)
    .map((row) => item(row, '检查托管状态、标题、主图、类目和是否继续投放', `1日曝光 ${one(row).exposure}，7日曝光 ${seven(row).exposure}，7日访问 ${seven(row).publicVisits}`));

  const weakClick = rows
    .filter((row) => (one(row).hasExposureData || seven(row).hasExposureData) && (one(row).exposure >= 1000 || seven(row).exposure >= 3000))
    .filter((row) => (one(row).exposure >= 1000 && one(row).exposureVisitRate < 0.01) || (seven(row).exposure >= 3000 && seven(row).exposureVisitRate < 0.015))
    .sort((a, b) => seven(a).exposureVisitRate - seven(b).exposureVisitRate || one(a).exposureVisitRate - one(b).exposureVisitRate || seven(b).exposure - seven(a).exposure)
    .slice(0, TOP_N)
    .map((row) => item(row, '优化主图、标题、价格露出和首屏卖点', `1日曝光 ${one(row).exposure}，1日访问率 ${percent(one(row).exposureVisitRate)}，7日曝光 ${seven(row).exposure}，7日访问率 ${percent(seven(row).exposureVisitRate)}`));

  const weakConversion = rows
    .filter((row) => (one(row).hasDashboardData || seven(row).hasDashboardData) && (one(row).dashboardVisits >= 50 || seven(row).dashboardVisits >= 100))
    .filter((row) => (one(row).dashboardVisits >= 50 && one(row).shippedOrders === 0) || (seven(row).dashboardVisits >= 100 && seven(row).visitShipmentRate < 0.01))
    .sort((a, b) => one(b).dashboardVisits - one(a).dashboardVisits || seven(b).dashboardVisits - seven(a).dashboardVisits)
    .slice(0, TOP_N)
    .map((row) => item(row, '检查价格/押金/库存/风控/履约链路', `1日后链路访问 ${one(row).dashboardVisits}，1日发货 ${one(row).shippedOrders}，7日后链路访问 ${seven(row).dashboardVisits}，7日发货 ${seven(row).shippedOrders}`));

  const highPotential = rows
    .filter((row) => (one(row).hasExposureData || seven(row).hasExposureData) && (one(row).shippedOrders > 0 || seven(row).shippedOrders >= 3 || seven(row).amount >= 500))
    .filter((row) => one(row).publicVisits >= 100 || seven(row).publicVisits >= 300 || seven(row).amount >= 500)
    .sort((a, b) => seven(b).amount - seven(a).amount || seven(b).shippedOrders - seven(a).shippedOrders || one(b).publicVisits - one(a).publicVisits)
    .slice(0, TOP_N)
    .map((row) => item(row, '继续放量，并复制标题/图片/价格结构到同类商品', `7日曝光 ${seven(row).exposure}，7日访问 ${seven(row).publicVisits}，7日发货 ${seven(row).shippedOrders}，7日金额 ${seven(row).amount.toFixed(2)}`));

  const newProductObservation = (input.dailyDelta ?? [])
    .filter((row) => row.flags.includes('new_product'))
    .map((delta) => ({ delta, row: rowsById.get(delta.platformProductId) }))
    .filter(({ row }) => Boolean(row))
    .sort((a, b) => a.delta.exposure - b.delta.exposure || a.delta.visits - b.delta.visits)
    .slice(0, TOP_N)
    .map(({ delta, row }) => item(row as PublicTrafficProductDataRow, '观察 3-7 天，重点看曝光、访问和首单/发货', `新品今日进入公域快照，曝光 ${delta.exposure}，访问 ${delta.visits}，金额 ${delta.amount.toFixed(2)}`));

  const lifecycleGovernance = rows
    .filter((row) => typeof row.custodyDays === 'number' && row.custodyDays >= 30)
    .filter((row) => thirty(row).exposure <= 100 && thirty(row).publicVisits <= 3 && thirty(row).amount <= 1)
    .sort((a, b) => (b.custodyDays ?? 0) - (a.custodyDays ?? 0) || thirty(a).exposure - thirty(b).exposure)
    .slice(0, TOP_N)
    .map((row) => item(row, '下架、替换或重做素材', `已托管 ${row.custodyDays} 天，30日曝光 ${thirty(row).exposure}，访问 ${thirty(row).publicVisits}，金额 ${thirty(row).amount.toFixed(2)}`));

  const recommendedActions = buildRecommendedActions({ weakConversion, weakClick, lifecycleGovernance, highPotential, newProductObservation, lowExposure });

  return {
    date: input.date,
    summary,
    conclusions: buildConclusions(summary['1d'], input.previousSummary),
    rows,
    lowExposure,
    weakClick,
    weakConversion,
    highPotential,
    newProductObservation,
    lifecycleGovernance,
    recommendedActions,
    emptySectionNotes: EMPTY_SECTION_NOTES,
  };
}
```

- [ ] **Step 6: Run focused tests**

Run: `npm test -- tests/analyzePublicTrafficData.test.ts`

Expected: PASS.

- [ ] **Step 7: Run build**

Run: `npm run build`

Expected: remaining type failures in output tests/builders until Task 3 updates report literals and renderers.

- [ ] **Step 8: Commit analysis changes**

After Task 3 if build cannot pass yet, commit Tasks 1-3 together. If build already passes, commit now:

```bash
git add src/publicTraffic/types.ts src/publicTraffic/analyzePublicTrafficData.ts tests/analyzePublicTrafficData.test.ts
git commit -m "功能：增强公域日报洞察分析"
```

## Task 3: Render Enhanced Feishu And Markdown Output

**Files:**
- Modify: `tests/publicTrafficReport.test.ts`
- Modify: `src/publicTraffic/buildPublicTrafficCard.ts`
- Modify: `src/publicTraffic/buildPublicTrafficFeishu.ts`
- Modify: `src/publicTraffic/buildPublicTrafficMarkdown.ts`

- [ ] **Step 1: Update test context with new fields**

In `tests/publicTrafficReport.test.ts`, update `context` to include:

```ts
  conclusions: [
    { label: '曝光', text: '曝光 1000，较昨日上升 100，变化 11.11%' },
    { label: '公域访问', text: '公域访问 50，较昨日上升 10，变化 25.00%' },
  ],
```

Change `newProductObservation` and `lifecycleGovernance` from empty arrays to:

```ts
  newProductObservation: [{ identifier: '端内ID 777', action: '观察 3-7 天，重点看曝光、访问和首单/发货', reason: '新品今日进入公域快照' }],
  lifecycleGovernance: [{ identifier: '端内ID 222', action: '下架、替换或重做素材', reason: '托管 45 天且30日表现弱' }],
```

Add:

```ts
  recommendedActions: [
    { identifier: '端内ID 900', action: '检查价格/押金/库存/风控/履约链路', reason: '访问有发货弱' },
    { identifier: '端内ID 421', action: '优化主图、标题、价格露出和首屏卖点', reason: '访问率低' },
  ],
  emptySectionNotes: {
    lowExposure: '暂无达到阈值的曝光不足商品。',
    weakClick: '暂无达到阈值的高曝光低点击商品。',
    weakConversion: '暂无达到阈值的高访问低转化商品。',
    highPotential: '暂无达到放量阈值的高潜力商品。',
    newProductObservation: '暂无可识别的新进入公域商品，或今日缺少上一日快照。',
    lifecycleGovernance: '暂无达到长期弱表现阈值的托管商品。',
    recommendedActions: '暂无需要立即处理的建议操作。',
  },
```

Also update the `empty` context in the empty-section test to clear `recommendedActions` but retain `emptySectionNotes`.

- [ ] **Step 2: Add failing renderer expectations**

Update renderer tests with these expectations:

```ts
expect(markdown).toContain('## 经营结论');
expect(markdown).toContain('曝光 1000，较昨日上升 100');
expect(markdown).toContain('## 建议操作');
expect(markdown).toContain('端内ID 900：检查价格/押金/库存/风控/履约链路。原因：访问有发货弱');
expect(markdown).toContain('## 新品观察');
expect(markdown).toContain('端内ID 777');
expect(markdown).toContain('## 生命周期治理');
expect(markdown).toContain('端内ID 222');
```

For Feishu text test add:

```ts
expect(text).toContain('经营结论');
expect(text).toContain('建议操作');
expect(text).toContain('端内ID 900｜检查价格/押金/库存/风控/履约链路｜访问有发货弱');
expect(text).toContain('新品观察 Top5');
expect(text).toContain('生命周期治理 Top5');
```

For card test add:

```ts
const serialized = JSON.stringify(card);
expect(serialized).toContain('经营结论');
expect(serialized).toContain('建议操作');
expect(serialized).toContain('检查价格/押金/库存/风控/履约链路');
expect(serialized).toContain('新品观察 Top5');
expect(serialized).toContain('生命周期治理 Top5');
```

For empty-section test add:

```ts
expect(markdown).toContain('## 建议操作\n暂无需要立即处理的建议操作。');
expect(markdown).toContain('## 曝光不足\n暂无达到阈值的曝光不足商品。');
expect(text).toContain('建议操作\n暂无需要立即处理的建议操作。');
```

- [ ] **Step 3: Run renderer tests to verify failure**

Run: `npm test -- tests/publicTrafficReport.test.ts`

Expected: FAIL because renderers do not output new sections or action text.

- [ ] **Step 4: Update Feishu text renderer**

In `src/publicTraffic/buildPublicTrafficFeishu.ts`, update `toDataContext` legacy adapter to populate new fields:

```ts
    conclusions: [{ label: '基准', text: `暂无昨日公域数据上下文，今日仅展示基准值：曝光 ${context.overview[0]?.exposure ?? 0}。` }],
```

and add `recommendedActions: []` plus `emptySectionNotes` with the same strings as Task 2.

Replace `topLines` with:

```ts
function topLines(items: PublicTrafficReportSectionItem[], emptyNote: string, limit = 5): string[] {
  return items.length > 0 ? items.slice(0, limit).map((item, index) => `${index + 1}. ${item.identifier}｜${item.action}｜${item.reason}`) : [emptyNote];
}
```

In `buildPublicTrafficFeishuText`, insert after title:

```ts
    '经营结论',
    ...context.conclusions.map((item) => `${item.label}：${item.text}`),
    '',
```

Insert after module counts:

```ts
    '建议操作',
    ...topLines(context.recommendedActions, context.emptySectionNotes.recommendedActions, 8),
    '',
```

Add sections for high potential, new product, lifecycle, and pass empty notes to every `topLines` call.

- [ ] **Step 5: Update Feishu card renderer**

In `src/publicTraffic/buildPublicTrafficCard.ts`, change `topText` to:

```ts
function topText(title: string, items: PublicTrafficReportSectionItem[], emptyNote: string, limit = 5): string {
  const lines = items.length > 0 ? items.slice(0, limit).map((item, index) => `${index + 1}. ${item.identifier}｜${item.action}｜${item.reason}`) : [emptyNote];
  return `**${title}**\n${lines.join('\n')}`;
}
```

Add before 今日漏斗:

```ts
        { tag: 'markdown', content: `**经营结论**\n${context.conclusions.map((item) => `${item.label}：${item.text}`).join('\n')}` },
        { tag: 'hr' },
```

Add after module count:

```ts
        { tag: 'markdown', content: topText('建议操作', context.recommendedActions, context.emptySectionNotes.recommendedActions, 8) },
        { tag: 'hr' },
```

Update existing `topText` calls to include notes, and add:

```ts
        { tag: 'markdown', content: topText('高潜力 Top5', context.highPotential, context.emptySectionNotes.highPotential) },
        { tag: 'markdown', content: topText('新品观察 Top5', context.newProductObservation, context.emptySectionNotes.newProductObservation) },
        { tag: 'markdown', content: topText('生命周期治理 Top5', context.lifecycleGovernance, context.emptySectionNotes.lifecycleGovernance) },
```

- [ ] **Step 6: Update Markdown renderer**

In `src/publicTraffic/buildPublicTrafficMarkdown.ts`, update `toDataContext` legacy adapter similarly to Task 3 Step 4.

Replace `linesFor` with:

```ts
function linesFor(items: PublicTrafficReportSectionItem[], emptyNote: string): string[] {
  return items.length > 0 ? items.map((item, index) => `${index + 1}. ${item.identifier}：${item.action}。原因：${item.reason}`) : [emptyNote];
}
```

In `buildPublicTrafficMarkdown`, add before `## 1日总览`:

```ts
    '## 经营结论',
    ...context.conclusions.map((item) => `- ${item.label}：${item.text}`),
    '',
```

Add before `## 曝光不足`:

```ts
    '## 建议操作',
    ...linesFor(context.recommendedActions, context.emptySectionNotes.recommendedActions),
    '',
```

Update all module `linesFor` calls to pass the corresponding note.

- [ ] **Step 7: Run renderer tests**

Run: `npm test -- tests/publicTrafficReport.test.ts`

Expected: PASS.

- [ ] **Step 8: Run analysis and renderer tests together**

Run: `npm test -- tests/analyzePublicTrafficData.test.ts tests/publicTrafficReport.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit render changes**

```bash
git add src/publicTraffic/types.ts src/publicTraffic/analyzePublicTrafficData.ts src/publicTraffic/buildPublicTrafficCard.ts src/publicTraffic/buildPublicTrafficFeishu.ts src/publicTraffic/buildPublicTrafficMarkdown.ts tests/analyzePublicTrafficData.test.ts tests/publicTrafficReport.test.ts
git commit -m "功能：增强公域日报飞书和Markdown洞察"
```

## Task 4: Add Recommended Actions To Workbook

**Files:**
- Modify: `tests/publicTrafficReport.test.ts`
- Modify: `src/publicTraffic/buildPublicTrafficWorkbook.ts`

- [ ] **Step 1: Add failing workbook expectation**

In the workbook test in `tests/publicTrafficReport.test.ts`, update expected sheet names to:

```ts
expect(workbook.SheetNames).toEqual(['总览', '建议操作', '商品明细', '曝光不足', '点击弱', '转化弱', '高潜力', '新品观察', '生命周期治理']);
```

Add after reading `overview`:

```ts
const actions = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['建议操作']);
expect(actions[0]).toMatchObject({ identifier: '端内ID 900', action: '检查价格/押金/库存/风控/履约链路', reason: '访问有发货弱' });
```

- [ ] **Step 2: Run workbook test to verify failure**

Run: `npm test -- tests/publicTrafficReport.test.ts`

Expected: FAIL because `建议操作` sheet does not exist.

- [ ] **Step 3: Update workbook builder**

In `src/publicTraffic/buildPublicTrafficWorkbook.ts`, find where data context sheets are appended. Insert the recommended actions sheet immediately after `总览`:

```ts
appendSheet(workbook, '建议操作', sectionRows(context.recommendedActions, context.emptySectionNotes.recommendedActions));
```

If `sectionRows` currently accepts only items, change it to:

```ts
function sectionRows(items: PublicTrafficReportSectionItem[], emptyNote = '无'): Array<Record<string, string>> {
  return items.length > 0
    ? items.map((item) => ({ identifier: item.identifier, action: item.action, reason: item.reason }))
    : [{ identifier: '', action: '', reason: emptyNote }];
}
```

Update all existing module sheets to pass `context.emptySectionNotes.<section>`.

- [ ] **Step 4: Run workbook test**

Run: `npm test -- tests/publicTrafficReport.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit workbook changes**

```bash
git add src/publicTraffic/buildPublicTrafficWorkbook.ts tests/publicTrafficReport.test.ts
git commit -m "功能：新增公域日报建议操作表"
```

## Task 5: Wire Yesterday Summary Into CLI

**Files:**
- Modify: `src/cli/publicTrafficReport.ts`
- Modify: `tests/publicTrafficReportCliBehavior.test.ts`

- [ ] **Step 1: Add failing source/behavior assertions**

In `tests/publicTrafficReportCliBehavior.test.ts`, add a source-level test if mocking the full CLI is too heavy:

```ts
it('loads previous public traffic report context for yesterday comparisons', async () => {
  const source = await readFile(new URL('../src/cli/publicTrafficReport.ts', import.meta.url), 'utf8');

  expect(source).toContain('loadPreviousReportSummary');
  expect(source).toContain('previousSummary');
  expect(source).toContain('dailyDelta,');
  expect(source).toContain('sevenDaySummary,');
  expect(source).toContain('thirtyDaySummary,');
  expect(source).toContain('cumulativeProducts: crawlResult.products');
});
```

- [ ] **Step 2: Run CLI behavior test to verify failure**

Run: `npm test -- tests/publicTrafficReportCliBehavior.test.ts`

Expected: FAIL because the CLI does not load previous report summary or pass enrichment inputs.

- [ ] **Step 3: Implement previous summary loader**

In `src/cli/publicTrafficReport.ts`, update the type import:

```ts
import type { ExposureCumulativeProduct, PublicTrafficDataReportContext, PublicTrafficDataSummary } from '../publicTraffic/types.js';
```

Add after `loadPreviousCumulative`:

```ts
async function loadPreviousReportSummary(outputDir: string, date: string, log: ReturnType<typeof createRunLog>): Promise<PublicTrafficDataSummary | undefined> {
  const prev = buildPublicTrafficPaths(outputDir, yesterday(date));
  try {
    const parsed = JSON.parse(await readFile(prev.reportContext, 'utf8')) as Partial<PublicTrafficDataReportContext>;
    return parsed.summary?.['1d'];
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      log.addEvent('昨日公域数据上下文缺失: 结论使用今日基准值');
      return undefined;
    }
    log.addEvent(`昨日公域数据上下文读取失败: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}
```

- [ ] **Step 4: Pass enrichment inputs into analysis**

Before calling `analyzePublicTrafficData`, add:

```ts
    const previousSummary = await loadPreviousReportSummary(config.outputDir, date, log);
```

Change the call to:

```ts
    const context = analyzePublicTrafficData({
      date,
      rows: merged.rows,
      overview: crawlResult.overview,
      previousSummary,
      dailyDelta,
      sevenDaySummary,
      thirtyDaySummary,
      cumulativeProducts: crawlResult.products,
    });
```

Update the log event to include new modules:

```ts
    log.addEvent(
      `规则分析: 曝光不足=${context.lowExposure.length}, 点击弱=${context.weakClick.length}, 转化弱=${context.weakConversion.length}, 高潜力=${context.highPotential.length}, 新品观察=${context.newProductObservation.length}, 生命周期治理=${context.lifecycleGovernance.length}, 建议操作=${context.recommendedActions.length}`,
    );
```

- [ ] **Step 5: Run CLI behavior test**

Run: `npm test -- tests/publicTrafficReportCliBehavior.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit CLI wiring**

```bash
git add src/cli/publicTrafficReport.ts tests/publicTrafficReportCliBehavior.test.ts
git commit -m "功能：接入公域日报昨日对比上下文"
```

## Task 6: Final Verification And Review

**Files:**
- No planned source changes unless verification fails.

- [ ] **Step 1: Run full test suite**

Run: `npm test`

Expected: PASS with all test files and tests passing.

- [ ] **Step 2: Run build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 3: Run live report if credentials/browser state are available**

Run: `npm run public-traffic-report`

Expected: Report completes, Feishu sends, and generated output includes:

- `经营结论`
- `建议操作`
- `新品观察`
- `生命周期治理`
- yesterday comparison lines if yesterday context exists, otherwise baseline explanation.

- [ ] **Step 4: Inspect generated report files**

Check:

- `output/YYYY-MM-DD/公域数据日报_YYYY-MM-DD.md`
- `output/YYYY-MM-DD/公域数据日报_YYYY-MM-DD.xlsx`
- `output/YYYY-MM-DD/公域数据上下文_YYYY-MM-DD.json`
- `output/YYYY-MM-DD/公域数据运行日志_YYYY-MM-DD.log`

Expected: Markdown and JSON contain `conclusions`, `recommendedActions`, new/lifecycle modules, and action text.

- [ ] **Step 5: Request code review**

Use `superpowers:requesting-code-review` with base `c1f46d1` and current `HEAD`. Include this plan and the spec path in the review prompt.

- [ ] **Step 6: Fix review findings or document no findings**

If review returns Critical or Important findings, fix them with tests before completion. If no findings, proceed to final verification.

- [ ] **Step 7: Final status**

Run: `git status --short --branch`

Expected: clean worktree after all intended commits.

## Self-Review

- Spec coverage: The plan covers yesterday conclusions, independent recommended actions, new product observation, lifecycle governance, empty module notes, Feishu/Markdown/XLSX output, CLI wiring, tests, build, and live verification.
- Placeholder scan: No TBD/TODO placeholders remain; each task includes exact files, code snippets, commands, and expected outcomes.
- Type consistency: `PublicTrafficDataReportContext` is extended once in Task 1 and the same fields are used across analysis, CLI, and renderers.
