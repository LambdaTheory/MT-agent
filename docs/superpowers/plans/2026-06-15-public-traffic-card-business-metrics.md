# Public Traffic Card Business Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace low-value review metrics in the public traffic Feishu/Markdown report with business-facing fulfillment metrics: shipment rate, close rate, and average order value.

**Architecture:** Add shared derived order metric helpers in `orderAnalysis.ts`, then consume them from the Feishu card, Markdown report, and fallback Feishu text. Keep raw order data unchanged and only adjust presentation. Preserve existing missing-data behavior by rendering `-` when a source value cannot be computed.

**Tech Stack:** TypeScript, Vitest, Feishu card JSON builders, Markdown/fallback text builders.

---

## File Structure

- Modify `src/publicTraffic/orderAnalysis.ts`: add reusable derived metric helpers for shipment rate, close rate, AOV, and compact business metric lines.
- Modify `src/publicTraffic/buildPublicTrafficCard.ts`: remove `审出订单` from card order metrics, add business metrics row, keep fulfillment raw metrics in one row.
- Modify `src/publicTraffic/buildPublicTrafficMarkdown.ts`: align one-day overview and derived metric section with the card.
- Modify `src/publicTraffic/buildPublicTrafficFeishu.ts`: align fallback text with business metric wording.
- Modify `tests/publicTrafficReport.test.ts`: update existing expectations and add risk/healthy close-rate coverage.

---

### Task 1: Add Derived Order Metric Helpers

**Files:**
- Modify: `src/publicTraffic/orderAnalysis.ts`
- Test: `tests/orderAnalysisParse.test.ts`

- [ ] **Step 1: Add failing helper tests**

Add this import to `tests/orderAnalysisParse.test.ts`:

```ts
import { businessMetricLines, derivedOrderBusinessMetrics } from '../src/publicTraffic/orderAnalysis.js';
```

If the file already imports from `orderAnalysis.js`, merge these named imports into the existing import.

Add this test block:

```ts
  it('computes derived shipment rate, close rate, and average order value', () => {
    const overview = {
      key: 'overview' as const,
      label: '标准订单分析',
      dataDate: '2026-06-10',
      indicators: [
        { label: '创建订单数', value: '200', delta: '' },
        { label: '签约订单数', value: '100', delta: '' },
        { label: '发货订单数', value: '80', delta: '' },
        { label: '签约完成金额（元）', value: '4,000', delta: '' },
      ],
    };
    const customs = {
      key: 'customs' as const,
      label: '关单分析',
      dataDate: '2026-06-10',
      indicators: [{ label: '关单数', value: '70', delta: '' }],
    };

    expect(derivedOrderBusinessMetrics(overview, customs)).toEqual({
      shipmentRate: '40.00%',
      closeRate: '35.00%',
      closeRateStatus: '达标',
      averageOrderValue: '¥40.00',
    });
    expect(businessMetricLines(overview, customs)).toEqual(['发货率 40.00%｜关单率 35.00%（目标<=35%，达标）｜客单价 ¥40.00']);
  });

  it('marks close rate above 35 percent as risk and handles missing denominators', () => {
    const riskyOverview = {
      key: 'overview' as const,
      label: '标准订单分析',
      dataDate: '2026-06-10',
      indicators: [
        { label: '创建订单数', value: '100', delta: '' },
        { label: '签约订单数', value: '0', delta: '' },
        { label: '发货订单数', value: '20', delta: '' },
        { label: '签约完成金额（元）', value: '0', delta: '' },
      ],
    };
    const riskyCustoms = {
      key: 'customs' as const,
      label: '关单分析',
      dataDate: '2026-06-10',
      indicators: [{ label: '关单数', value: '36', delta: '' }],
    };

    expect(derivedOrderBusinessMetrics(riskyOverview, riskyCustoms)).toEqual({
      shipmentRate: '20.00%',
      closeRate: '36.00%',
      closeRateStatus: '风险',
      averageOrderValue: '-',
    });
  });
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```powershell
npm test -- tests/orderAnalysisParse.test.ts
```

Expected: FAIL because `businessMetricLines` and `derivedOrderBusinessMetrics` are not exported.

- [ ] **Step 3: Implement helpers**

Add these functions to `src/publicTraffic/orderAnalysis.ts` after `findOrderAnalysisNumber()`:

```ts
function formatRate(numerator: number | null, denominator: number | null): string {
  if (numerator === null || denominator === null || denominator <= 0) return '-';
  return `${((numerator / denominator) * 100).toFixed(2)}%`;
}

function formatCurrency(numerator: number | null, denominator: number | null): string {
  if (numerator === null || denominator === null || denominator <= 0) return '-';
  return `¥${(numerator / denominator).toFixed(2)}`;
}

function closeRateStatus(closeRate: string): '达标' | '风险' | '-' {
  if (closeRate === '-') return '-';
  const value = Number(closeRate.replace('%', ''));
  if (!Number.isFinite(value)) return '-';
  return value <= 35 ? '达标' : '风险';
}

export interface DerivedOrderBusinessMetrics {
  shipmentRate: string;
  closeRate: string;
  closeRateStatus: '达标' | '风险' | '-';
  averageOrderValue: string;
}

export function derivedOrderBusinessMetrics(overview: OrderAnalysisPageData | undefined, customs: OrderAnalysisPageData | undefined): DerivedOrderBusinessMetrics {
  const created = findOrderAnalysisNumber(overview, ['创建订单数']);
  const signed = findOrderAnalysisNumber(overview, ['签约订单数']);
  const shipped = findOrderAnalysisNumber(overview, ['发货订单数']);
  const signedAmount = findOrderAnalysisNumber(overview, ['签约完成金额（元）', '签约完成金额']);
  const closed = findOrderAnalysisNumber(customs, ['关单数']);
  const closeRate = formatRate(closed, created);
  return {
    shipmentRate: formatRate(shipped, created),
    closeRate,
    closeRateStatus: closeRateStatus(closeRate),
    averageOrderValue: formatCurrency(signedAmount, signed),
  };
}

export function businessMetricLines(overview: OrderAnalysisPageData | undefined, customs: OrderAnalysisPageData | undefined): string[] {
  if (!overview && !customs) return [];
  const metrics = derivedOrderBusinessMetrics(overview, customs);
  const statusText = metrics.closeRateStatus === '-' ? '目标<=35%' : `目标<=35%，${metrics.closeRateStatus}`;
  return [`发货率 ${metrics.shipmentRate}｜关单率 ${metrics.closeRate}（${statusText}）｜客单价 ${metrics.averageOrderValue}`];
}
```

Then replace `formatFulfillmentRate()` usage inside `fulfillmentRateLines()` with `formatRate()` and remove `formatFulfillmentRate()` if no longer used.

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```powershell
npm test -- tests/orderAnalysisParse.test.ts
```

Expected: all `orderAnalysisParse` tests pass.

- [ ] **Step 5: Commit helpers**

Run:

```powershell
git add src/publicTraffic/orderAnalysis.ts tests/orderAnalysisParse.test.ts
git commit -m "功能：新增订单经营指标计算"
```

---

### Task 2: Update Feishu Card Business Metrics

**Files:**
- Modify: `src/publicTraffic/buildPublicTrafficCard.ts`
- Test: `tests/publicTrafficReport.test.ts`

- [ ] **Step 1: Add failing card tests**

Update the existing `卡片漏斗输出三行并省略冗余公域标题` test in `tests/publicTrafficReport.test.ts` to expect business metrics and reject review metrics:

```ts
    expect(json).toContain('订单经营（06-10）');
    expect(json).toContain('经营指标');
    expect(json).toContain('发货率');
    expect(json).toContain('关单率');
    expect(json).toContain('目标<=35%，风险');
    expect(json).toContain('客单价');
    expect(json).not.toContain('审出订单');
```

Add a focused healthy close-rate test after that test:

```ts
  it('卡片关单率低于等于35%时显示达标', () => {
    const healthy = {
      ...contextWithOrderAnalysis,
      orderAnalysis: {
        ...contextWithOrderAnalysis.orderAnalysis!,
        pages: {
          ...contextWithOrderAnalysis.orderAnalysis!.pages,
          overview: {
            ...contextWithOrderAnalysis.orderAnalysis!.pages.overview,
            indicators: [
              { label: '创建订单数', value: '200', delta: '' },
              { label: '签约订单数', value: '100', delta: '' },
              { label: '发货订单数', value: '80', delta: '' },
              { label: '签约完成金额（元）', value: '4,000', delta: '' },
            ],
          },
          customs: { key: 'customs' as const, label: '关单分析', dataDate: '2026-06-10', indicators: [{ label: '关单数', value: '70', delta: '' }] },
        },
      },
    };

    const json = JSON.stringify(buildPublicTrafficCard(healthy, { markdownPath: 'report.md', workbookPath: 'report.xlsx' }));
    expect(json).toContain('关单率');
    expect(json).toContain('35.00%');
    expect(json).toContain('目标<=35%，达标');
  });
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```powershell
npm test -- tests/publicTrafficReport.test.ts
```

Expected: FAIL because the card still shows `订单（06-10）`, `审出订单`, and lacks business metrics.

- [ ] **Step 3: Update card imports and helper**

Change the import in `src/publicTraffic/buildPublicTrafficCard.ts` from:

```ts
import { findOrderAnalysisIndicator, fulfillmentRateLines, shortDataDate } from './orderAnalysis.js';
```

to:

```ts
import { businessMetricLines, findOrderAnalysisIndicator, shortDataDate } from './orderAnalysis.js';
```

Replace `fulfillmentRateText()` with:

```ts
function businessMetricText(context: PublicTrafficDataReportContext): string | null {
  const lines = businessMetricLines(context.orderAnalysis?.pages.overview, context.orderAnalysis?.pages.customs);
  return lines.length > 0 ? ['**经营指标**', ...lines].join('\n') : null;
}
```

- [ ] **Step 4: Update card funnel groups**

In `funnelElements()`, replace the order and fulfillment groups with:

```ts
    nestedFunnelColumnSet([
      { title: `订单经营（${shortDataDate(overview?.dataDate)}）`, metrics: [orderMetric(overview, '创建订单', ['创建订单数']), orderMetric(overview, '签约订单', ['签约订单数']), orderMetric(overview, '发货订单', ['发货订单数'])] },
      { title: '金额', metrics: [orderMetric(overview, '签约金额', ['签约完成金额（元）', '签约完成金额']), ['公域金额', `¥${one.amount.toFixed(2)}`]] },
    ], 'funnel_order'),
    nestedFunnelColumnSet([
      { title: `履约（发货${shortDataDate(delivery?.dataDate)}｜归还${shortDataDate(returns?.dataDate)}｜关单${shortDataDate(customs?.dataDate)}）`, metrics: [orderMetric(delivery, '待发货', ['待发货订单数']), orderMetric(returns, '归还', ['归还订单数']), orderMetric(returns, '逾期', ['逾期订单数']), orderMetric(customs, '关单', ['关单数'])] },
    ], 'funnel_fulfillment'),
```

In `buildPublicTrafficCard()` body elements, replace:

```ts
        ...markdownElement(fulfillmentRateText(context)),
```

with:

```ts
        ...markdownElement(businessMetricText(context)),
```

- [ ] **Step 5: Run tests to verify GREEN**

Run:

```powershell
npm test -- tests/publicTrafficReport.test.ts
```

Expected: all `publicTrafficReport` tests pass after updating any old expectations that explicitly required `审出/签约` in the card.

- [ ] **Step 6: Commit card changes**

Run:

```powershell
git add src/publicTraffic/buildPublicTrafficCard.ts tests/publicTrafficReport.test.ts
git commit -m "功能：公域日报卡片展示经营指标"
```

---

### Task 3: Align Markdown and Feishu Fallback Text

**Files:**
- Modify: `src/publicTraffic/buildPublicTrafficMarkdown.ts`
- Modify: `src/publicTraffic/buildPublicTrafficFeishu.ts`
- Test: `tests/publicTrafficReport.test.ts`

- [ ] **Step 1: Add/update failing text tests**

Update `Markdown 1日总览输出三行` in `tests/publicTrafficReport.test.ts` to expect no `审出订单` and include business metrics:

```ts
    expect(markdown).toContain('订单经营（06-10）：创建订单 194｜签约订单 103｜发货订单 64｜签约金额 3,977');
    expect(markdown).not.toContain('审出订单');
    expect(markdown).toContain('经营指标：发货率 32.99%｜关单率 46.39%（目标<=35%，风险）｜客单价 ¥38.61');
```

Add fallback text expectations to the medium-density Feishu text test near existing rate assertions:

```ts
    expect(text).toContain('发货率');
    expect(text).toContain('关单率');
    expect(text).toContain('客单价');
    expect(text).not.toContain('审出订单');
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```powershell
npm test -- tests/publicTrafficReport.test.ts
```

Expected: FAIL because Markdown/fallback still use old overview/rate wording.

- [ ] **Step 3: Update Markdown builder**

Change import in `src/publicTraffic/buildPublicTrafficMarkdown.ts` from:

```ts
import { findOrderAnalysisIndicator, fulfillmentRateLines, shortDataDate } from './orderAnalysis.js';
```

to:

```ts
import { businessMetricLines, findOrderAnalysisIndicator, shortDataDate } from './orderAnalysis.js';
```

In `oneDayOverviewLines()`, replace the order line with:

```ts
    `订单经营（${shortDataDate(overview?.dataDate)}）：创建订单 ${findOrderAnalysisIndicator(overview, ['创建订单数'])}｜签约订单 ${findOrderAnalysisIndicator(overview, ['签约订单数'])}｜发货订单 ${findOrderAnalysisIndicator(overview, ['发货订单数'])}｜签约金额 ${findOrderAnalysisIndicator(overview, ['签约完成金额（元）', '签约完成金额'])}`,
```

Insert a business metric line after the fulfillment line:

```ts
    `经营指标：${businessMetricLines(overview, customs).join('') || '发货率 -｜关单率 -（目标<=35%）｜客单价 -'}`,
```

Remove this line from `buildPublicTrafficMarkdown()`:

```ts
  appendMarkdownSection(lines, '履约比率', fulfillmentRateLines(context.orderAnalysis?.pages.overview));
```

- [ ] **Step 4: Update fallback text builder**

In `src/publicTraffic/buildPublicTrafficFeishu.ts`, add import:

```ts
import { businessMetricLines } from './orderAnalysis.js';
```

Change `funnelLines()` signature to:

```ts
function funnelLines(context: PublicTrafficDataReportContext): string[] {
  const summary = context.summary['1d'];
  const business = businessMetricLines(context.orderAnalysis?.pages.overview, context.orderAnalysis?.pages.customs);
  return [
    `曝光 ${summary.exposure}｜公域访问 ${summary.publicVisits}｜商品页访问 ${summary.dashboardVisits}｜订单 ${summary.createdOrders}｜发货 ${summary.shippedOrders}｜金额 ¥${summary.amount.toFixed(2)}`,
    ...(business.length ? business : [`曝光到访问率 ${percent(summary.exposureVisitRate)}｜访问到发货率 ${percent(summary.visitShipmentRate)}`]),
  ];
}
```

Then replace:

```ts
    ...funnelLines(one),
```

with:

```ts
    ...funnelLines(context),
```

- [ ] **Step 5: Run tests to verify GREEN**

Run:

```powershell
npm test -- tests/publicTrafficReport.test.ts
```

Expected: all `publicTrafficReport` tests pass.

- [ ] **Step 6: Commit text changes**

Run:

```powershell
git add src/publicTraffic/buildPublicTrafficMarkdown.ts src/publicTraffic/buildPublicTrafficFeishu.ts tests/publicTrafficReport.test.ts
git commit -m "功能：日报文本同步经营指标口径"
```

---

### Task 4: Final Verification

**Files:**
- No code changes expected.

- [ ] **Step 1: Run focused tests**

Run:

```powershell
npm test -- tests/orderAnalysisParse.test.ts tests/publicTrafficReport.test.ts
```

Expected: both files pass.

- [ ] **Step 2: Run build**

Run:

```powershell
npm run build
```

Expected: `tsc -p tsconfig.json` exits with code 0.

- [ ] **Step 3: Inspect status and diff**

Run:

```powershell
git status -sb
git diff --stat
```

Expected: no uncommitted changes in the feature worktree, or only explicitly documented local artifacts.

---

## Self-Review Notes

- Spec coverage: Tasks cover derived metric definitions, card changes, Markdown/fallback text changes, risk/healthy threshold tests, missing-data behavior, and final verification.
- Placeholder scan: No TBD/TODO placeholders remain; each task has file paths, code snippets, commands, and expected results.
- Type consistency: The plan introduces `DerivedOrderBusinessMetrics`, `derivedOrderBusinessMetrics()`, and `businessMetricLines()` in `orderAnalysis.ts`, then imports those exact names in card/Markdown/fallback builders.
