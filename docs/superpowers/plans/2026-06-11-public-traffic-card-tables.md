# Public Traffic Card Tables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace diagnostic Top lists in the public traffic Feishu card with full paginated Feishu 2.0 tables, while keeping only today's exposure Top10.

**Architecture:** Keep report analysis as the source of section arrays, but remove diagnostic truncation there so every renderer receives full data. Add small table-building helpers inside `buildPublicTrafficCard.ts` and keep tables as root-level `body.elements` because Feishu 2.0 tables cannot be nested. Mirror the section order in Markdown and leave workbook sheet generation unchanged except that it receives full arrays.

**Tech Stack:** TypeScript, Vitest, Feishu card JSON 2.0, Playwright-generated public traffic data, `xlsx-js-style` workbook generation.

---

## File Structure

- Modify `src/publicTraffic/analyzePublicTrafficData.ts`: remove fixed Top5 slicing for diagnostic arrays; retain stable sort order; annotate recommended action rows with source category in a compact, backward-compatible way by embedding the category into the action table builder rather than changing the public type.
- Modify `src/publicTraffic/buildPublicTrafficCard.ts`: remove diagnostic Top markdown blocks; add Feishu 2.0 root-level table helpers; show all conclusions; add fulfillment rate comparison text; keep exposure Top10.
- Modify `src/publicTraffic/buildPublicTrafficMarkdown.ts`: keep exposure Top10 only; output diagnostics/actions as full Markdown tables; move new product observation last.
- Modify `src/publicTraffic/buildPublicTrafficFeishu.ts`: update fallback text to match the new non-Top section names and full arrays.
- Modify `tests/publicTrafficReport.test.ts`: add assertions for table pagination, root-level tables, full row counts, conclusion completeness, and Markdown order.

## Task 1: Card Table Tests

**Files:**
- Modify: `tests/publicTrafficReport.test.ts`

- [ ] **Step 1: Add focused test fixtures**

Add this helper near existing card/markdown tests in `tests/publicTrafficReport.test.ts`:

```ts
function findCardElementsByTag(card: { body?: { elements?: unknown[] } }, tag: string): Record<string, unknown>[] {
  return (card.body?.elements ?? []).filter((element): element is Record<string, unknown> => {
    return Boolean(element && typeof element === 'object' && (element as Record<string, unknown>).tag === tag);
  });
}

function tableRows(table: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(table.rows) ? (table.rows as Record<string, unknown>[]) : [];
}
```

- [ ] **Step 2: Write failing card table test**

Add this test in `tests/publicTrafficReport.test.ts`:

```ts
it('renders full diagnostic sections as paginated root-level Feishu tables', () => {
  const context = makeDataReportContext({
    conclusions: [
      { label: '曝光', text: '曝光 100，较昨日上升 10' },
      { label: '公域访问', text: '公域访问 20，较昨日上升 2' },
      { label: '金额', text: '金额 30元，较昨日上升 3元' },
    ],
    lowExposure: Array.from({ length: 6 }, (_, index) => ({ identifier: `低曝光${index}`, action: '检查托管状态', reason: `低曝光原因${index}` })),
    weakClick: Array.from({ length: 6 }, (_, index) => ({ identifier: `点击弱${index}`, action: '优化主图', reason: `点击弱原因${index}` })),
    weakConversion: Array.from({ length: 6 }, (_, index) => ({ identifier: `转化弱${index}`, action: '检查价格', reason: `转化弱原因${index}` })),
    highPotential: Array.from({ length: 2 }, (_, index) => ({ identifier: `高潜力${index}`, action: '继续放量', reason: `高潜力原因${index}` })),
    lifecycleGovernance: Array.from({ length: 2 }, (_, index) => ({ identifier: `治理${index}`, action: '下架或重做', reason: `治理原因${index}` })),
    recommendedActions: Array.from({ length: 12 }, (_, index) => ({ identifier: `建议${index}`, action: index % 2 === 0 ? '检查价格' : '优化主图', reason: `建议原因${index}` })),
    newProductObservation: Array.from({ length: 11 }, (_, index) => ({ identifier: `新品${index}`, action: '新品数据监控', reason: `新品原因${index}` })),
  });

  const card = buildPublicTrafficCard(context, { markdownPath: 'report.md', workbookPath: 'report.xlsx' });
  const tables = findCardElementsByTag(card, 'table');

  expect(tables).toHaveLength(3);
  expect(tables.every((table) => table.page_size === 10)).toBe(true);
  expect(tables.every((table) => table.row_height === 'auto')).toBe(true);
  expect(tables.every((table) => table.freeze_first_column === true)).toBe(true);
  expect(tableRows(tables[0])).toHaveLength(22);
  expect(tableRows(tables[1])).toHaveLength(12);
  expect(tableRows(tables[2])).toHaveLength(11);

  const cardText = JSON.stringify(card);
  expect(cardText).toContain('曝光 100，较昨日上升 10');
  expect(cardText).toContain('金额 30元，较昨日上升 3元');
  expect(cardText).toContain('今日曝光 Top10');
  expect(cardText).not.toContain('曝光不足 Top5');
  expect(cardText).not.toContain('转化弱 Top5');
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/publicTrafficReport.test.ts -t "renders full diagnostic sections as paginated root-level Feishu tables"`

Expected: FAIL because the current card emits zero table components and still uses Top5 markdown headings.

- [ ] **Step 4: Commit failing test is not committed yet**

Do not commit at red stage. Continue to Task 2.

## Task 2: Remove Analysis Truncation

**Files:**
- Modify: `src/publicTraffic/analyzePublicTrafficData.ts`
- Test: `tests/publicTrafficReport.test.ts`

- [ ] **Step 1: Write failing analysis test**

Add a test that builds more than five low-exposure rows through `analyzePublicTrafficData` and asserts the result is not truncated:

```ts
it('does not truncate diagnostic sections in analysis output', () => {
  const rows = Array.from({ length: 7 }, (_, index) => makeProductDataRow({
    platformProductId: `low-${index}`,
    displayProductId: `端内ID ${index}`,
    custodyDays: 10,
    periods: {
      '1d': makePeriodMetrics({ exposure: index + 1, publicVisits: 0, dashboardVisits: 0, shippedOrders: 0, hasExposureData: true }),
      '7d': makePeriodMetrics({ exposure: index + 1, publicVisits: 0, dashboardVisits: 0, shippedOrders: 0, hasExposureData: true }),
      '30d': makePeriodMetrics({ exposure: index + 1, publicVisits: 0, dashboardVisits: 0, shippedOrders: 0, hasExposureData: true }),
    },
  }));

  const report = analyzePublicTrafficData({ date: '2026-06-11', rows });

  expect(report.lowExposure).toHaveLength(7);
});
```

- [ ] **Step 2: Run analysis test to verify it fails**

Run: `npm test -- tests/publicTrafficReport.test.ts -t "does not truncate diagnostic sections"`

Expected: FAIL with received length 5.

- [ ] **Step 3: Remove Top5 slices from diagnostic arrays**

In `src/publicTraffic/analyzePublicTrafficData.ts`, remove `.slice(0, TOP_N)` from `lowExposure`, `weakClick`, `weakConversion`, `highPotential`, `newProductObservation`, and `lifecycleGovernance`. Remove `const TOP_N = 5;` if unused.

Change `buildRecommendedActions` from:

```ts
  ].slice(0, 20);
```

to:

```ts
  ];
```

- [ ] **Step 4: Run analysis tests**

Run: `npm test -- tests/publicTrafficReport.test.ts -t "does not truncate diagnostic sections"`

Expected: PASS.

- [ ] **Step 5: Commit analysis change**

Run:

```powershell
git add src/publicTraffic/analyzePublicTrafficData.ts tests/publicTrafficReport.test.ts
```

## Task 3: Implement Feishu Root Tables

**Files:**
- Modify: `src/publicTraffic/buildPublicTrafficCard.ts`
- Test: `tests/publicTrafficReport.test.ts`

- [ ] **Step 1: Add table helper types and builders**

In `src/publicTraffic/buildPublicTrafficCard.ts`, add helpers after `columnSet`:

```ts
type TableColumn = {
  name: string;
  display_name: string;
  data_type: 'text' | 'markdown' | 'lark_md' | 'number' | 'options';
  width?: string;
  vertical_align?: 'top' | 'center' | 'bottom';
  horizontal_align?: 'left' | 'center' | 'right';
};

function tableElement(elementId: string, columns: TableColumn[], rows: Record<string, unknown>[]): Record<string, unknown> | null {
  if (rows.length === 0) return null;
  return {
    tag: 'table',
    element_id: elementId,
    page_size: 10,
    row_height: 'auto',
    row_max_height: '124px',
    freeze_first_column: true,
    header_style: {
      text_align: 'left',
      text_size: 'normal',
      background_style: 'grey',
      text_color: 'grey',
      bold: true,
      lines: 1,
    },
    columns,
    rows,
  };
}

function diagnosticRows(context: PublicTrafficDataReportContext): Record<string, unknown>[] {
  const sections: Array<[string, PublicTrafficReportSectionItem[]]> = [
    ['曝光不足', context.lowExposure],
    ['点击弱', context.weakClick],
    ['转化弱', context.weakConversion],
    ['高潜力', context.highPotential],
    ['生命周期治理', context.lifecycleGovernance],
  ];
  return sections.flatMap(([type, items]) => items.map((item) => ({ type, product: item.identifier, action: item.action, reason: item.reason })));
}

function sourceTypeForAction(context: PublicTrafficDataReportContext, item: PublicTrafficReportSectionItem): string {
  const sections: Array<[string, PublicTrafficReportSectionItem[]]> = [
    ['曝光不足', context.lowExposure],
    ['点击弱', context.weakClick],
    ['转化弱', context.weakConversion],
    ['高潜力', context.highPotential],
    ['生命周期治理', context.lifecycleGovernance],
    ['新品观察', context.newProductObservation],
  ];
  return sections.find(([, items]) => items.some((candidate) => candidate.identifier === item.identifier && candidate.action === item.action && candidate.reason === item.reason))?.[0] ?? '';
}

function recommendedActionRows(context: PublicTrafficDataReportContext): Record<string, unknown>[] {
  return [...context.recommendedActions]
    .sort((a, b) => a.action.localeCompare(b.action, 'zh-CN') || a.identifier.localeCompare(b.identifier, 'zh-CN'))
    .map((item) => ({ action: item.action, type: sourceTypeForAction(context, item), product: item.identifier, reason: item.reason }));
}

function newProductRows(context: PublicTrafficDataReportContext): Record<string, unknown>[] {
  return context.newProductObservation.map((item) => ({ product: item.identifier, action: item.action, reason: item.reason }));
}
```

- [ ] **Step 2: Replace diagnostic markdown blocks with root tables**

In `buildPublicTrafficCard`, remove the markdown blocks for `optionalTopText('建议操作'...)`, `optionalTopText('曝光不足 Top5'...)`, `optionalTopText('点击弱 Top5'...)`, `optionalTopText('转化弱 Top5'...)`, `optionalTopText('高潜力 Top5'...)`, `optionalTopText('新品观察 Top5'...)`, and `optionalTopText('生命周期治理 Top5'...)`.

Add table elements as direct items in `body.elements` after `warningText`:

```ts
        ...optionalElement(tableElement(
          'diag_table',
          [
            { name: 'type', display_name: '类型', data_type: 'text', width: '100px', vertical_align: 'top' },
            { name: 'product', display_name: '商品', data_type: 'text', width: '120px', vertical_align: 'top' },
            { name: 'action', display_name: '操作', data_type: 'text', width: '180px', vertical_align: 'top' },
            { name: 'reason', display_name: '原因', data_type: 'text', width: '360px', vertical_align: 'top' },
          ],
          diagnosticRows(context),
        )),
        ...optionalElement(tableElement(
          'action_table',
          [
            { name: 'action', display_name: '操作', data_type: 'text', width: '180px', vertical_align: 'top' },
            { name: 'type', display_name: '类型', data_type: 'text', width: '100px', vertical_align: 'top' },
            { name: 'product', display_name: '商品', data_type: 'text', width: '120px', vertical_align: 'top' },
            { name: 'reason', display_name: '原因', data_type: 'text', width: '360px', vertical_align: 'top' },
          ],
          recommendedActionRows(context),
        )),
        ...optionalElement(tableElement(
          'new_table',
          [
            { name: 'product', display_name: '商品', data_type: 'text', width: '120px', vertical_align: 'top' },
            { name: 'action', display_name: '操作', data_type: 'text', width: '160px', vertical_align: 'top' },
            { name: 'reason', display_name: '原因', data_type: 'text', width: '420px', vertical_align: 'top' },
          ],
          newProductRows(context),
        )),
```

- [ ] **Step 3: Show all conclusions**

Change `conclusionColumnSet` so it no longer slices to three columns. Because too many columns can become narrow, return markdown lines instead:

```ts
function conclusionElement(context: PublicTrafficDataReportContext): { tag: 'markdown'; content: string } {
  const lines = context.conclusions.map((item) => `- **${item.label}**：${item.text}`);
  return { tag: 'markdown', content: `**经营结论**\n${lines.join('\n')}` };
}
```

Replace `conclusionColumnSet(context)` in `body.elements` with `conclusionElement(context)`.

- [ ] **Step 4: Run card table test**

Run: `npm test -- tests/publicTrafficReport.test.ts -t "renders full diagnostic sections as paginated root-level Feishu tables"`

Expected: PASS.

- [ ] **Step 5: Commit card table change**

Run:

```powershell
git add src/publicTraffic/buildPublicTrafficCard.ts tests/publicTrafficReport.test.ts
```

## Task 4: Fulfillment Rate Text

**Files:**
- Modify: `src/publicTraffic/buildPublicTrafficCard.ts`
- Modify: `src/publicTraffic/buildPublicTrafficMarkdown.ts`
- Test: `tests/publicTrafficReport.test.ts`

- [ ] **Step 1: Add test for fulfillment ratio text**

Add a test that verifies fulfillment output includes ratios and a missing-yesterday note when no comparable previous order-analysis snapshot exists:

```ts
it('renders fulfillment as rates with explicit comparison status', () => {
  const context = makeDataReportContext({
    orderAnalysis: makeOrderAnalysisResult({
      overviewMetrics: [
        ['创建订单数', '100'],
        ['签约订单数', '50'],
        ['审出订单数', '25'],
        ['发货订单数', '10'],
      ],
      returnMetrics: [
        ['归还订单数', '4'],
        ['逾期订单数', '1'],
      ],
      customsMetrics: [['关单数', '5']],
    }),
  });

  const card = buildPublicTrafficCard(context, { markdownPath: 'report.md', workbookPath: 'report.xlsx' });
  const text = JSON.stringify(card);

  expect(text).toContain('签约/创建 50.00%');
  expect(text).toContain('审出/签约 50.00%');
  expect(text).toContain('发货/审出 40.00%');
  expect(text).toContain('暂无昨日履约率对比');
});
```

- [ ] **Step 2: Implement rate helpers**

In `buildPublicTrafficCard.ts`, add a safe numeric parser for order-analysis indicator strings and a rate formatter:

```ts
function numericIndicator(page: Parameters<typeof findOrderAnalysisIndicator>[0], names: string[]): number | null {
  const raw = findOrderAnalysisIndicator(page, names);
  const normalized = raw.replace(/,/g, '').replace(/[^0-9.-]/g, '');
  if (!normalized) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return numerator / denominator;
}

function rateWithComparison(label: string, value: number | null): string {
  return `${label} ${value === null ? 'N/A' : percent(value)}｜暂无昨日履约率对比`;
}

function fulfillmentRateText(context: PublicTrafficDataReportContext): string | null {
  const overview = context.orderAnalysis?.pages.overview;
  if (!overview) return null;
  const created = numericIndicator(overview, ['创建订单数']);
  const signed = numericIndicator(overview, ['签约订单数']);
  const reviewed = numericIndicator(overview, ['审出订单数']);
  const shipped = numericIndicator(overview, ['发货订单数']);
  return `**履约比率**\n${[
    rateWithComparison('签约/创建', ratio(signed, created)),
    rateWithComparison('审出/签约', ratio(reviewed, signed)),
    rateWithComparison('发货/审出', ratio(shipped, reviewed)),
  ].join('\n')}`;
}
```

Add `...markdownElement(fulfillmentRateText(context)),` immediately after `rateText(one)` in the card body.

- [ ] **Step 3: Mirror rate text in Markdown**

Add equivalent helper functions to `buildPublicTrafficMarkdown.ts` and append a `## 履约比率` section after `## 1日总览` when order analysis is present. Use the same missing comparison text.

- [ ] **Step 4: Run fulfillment test**

Run: `npm test -- tests/publicTrafficReport.test.ts -t "renders fulfillment as rates"`

Expected: PASS.

- [ ] **Step 5: Commit fulfillment rate change**

Run:

```powershell
git add src/publicTraffic/buildPublicTrafficCard.ts src/publicTraffic/buildPublicTrafficMarkdown.ts tests/publicTrafficReport.test.ts
```

## Task 5: Markdown And Fallback Text

**Files:**
- Modify: `src/publicTraffic/buildPublicTrafficMarkdown.ts`
- Modify: `src/publicTraffic/buildPublicTrafficFeishu.ts`
- Test: `tests/publicTrafficReport.test.ts`

- [ ] **Step 1: Add Markdown order test**

Add this test:

```ts
it('keeps only exposure Top10 wording and places new product observation last in markdown', () => {
  const markdown = buildPublicTrafficMarkdown(makeDataReportContext({
    lowExposure: [{ identifier: 'A', action: '检查托管状态', reason: '曝光不足' }],
    weakConversion: [{ identifier: 'B', action: '检查价格', reason: '转化弱' }],
    recommendedActions: [{ identifier: 'B', action: '检查价格', reason: '转化弱' }],
    newProductObservation: [{ identifier: 'C', action: '新品数据监控', reason: '新品' }],
  }));

  expect(markdown).toContain('## 今日曝光 Top10');
  expect(markdown).not.toContain('Top5');
  expect(markdown.indexOf('## 建议操作')).toBeLessThan(markdown.indexOf('## 新品观察'));
  expect(markdown.trim().endsWith('| C | 新品数据监控 | 新品 |')).toBe(true);
});
```

- [ ] **Step 2: Add Markdown table helper**

In `buildPublicTrafficMarkdown.ts`, add:

```ts
function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '｜').replace(/\r?\n/g, ' ');
}

function appendMarkdownTable(lines: string[], title: string, headers: string[], rows: string[][]): void {
  if (rows.length === 0) return;
  lines.push('', `## ${title}`, `| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`);
  for (const row of rows) {
    lines.push(`| ${row.map(escapeTableCell).join(' | ')} |`);
  }
}
```

- [ ] **Step 3: Replace diagnostic Markdown sections**

Replace individual diagnostic list appends with three table appends in this order:

```ts
  appendMarkdownTable(lines, '诊断问题', ['类型', '商品', '操作', '原因'], [
    ...context.lowExposure.map((item) => ['曝光不足', item.identifier, item.action, item.reason]),
    ...context.weakClick.map((item) => ['点击弱', item.identifier, item.action, item.reason]),
    ...context.weakConversion.map((item) => ['转化弱', item.identifier, item.action, item.reason]),
    ...context.highPotential.map((item) => ['高潜力', item.identifier, item.action, item.reason]),
    ...context.lifecycleGovernance.map((item) => ['生命周期治理', item.identifier, item.action, item.reason]),
  ]);
  appendMarkdownTable(lines, '建议操作', ['操作', '商品', '原因'], [...context.recommendedActions]
    .sort((a, b) => a.action.localeCompare(b.action, 'zh-CN') || a.identifier.localeCompare(b.identifier, 'zh-CN'))
    .map((item) => [item.action, item.identifier, item.reason]));
  appendMarkdownTable(lines, '新品观察', ['商品', '操作', '原因'], context.newProductObservation.map((item) => [item.identifier, item.action, item.reason]));
```

- [ ] **Step 4: Update fallback Feishu text**

In `buildPublicTrafficFeishu.ts`, remove Top5 section names. Use these section titles:

```ts
  appendSection(lines, '诊断问题', [
    ...topLines(context.lowExposure, Number.MAX_SAFE_INTEGER).map((line) => `曝光不足｜${line}`),
    ...topLines(context.weakClick, Number.MAX_SAFE_INTEGER).map((line) => `点击弱｜${line}`),
    ...topLines(context.weakConversion, Number.MAX_SAFE_INTEGER).map((line) => `转化弱｜${line}`),
    ...topLines(context.highPotential, Number.MAX_SAFE_INTEGER).map((line) => `高潜力｜${line}`),
    ...topLines(context.lifecycleGovernance, Number.MAX_SAFE_INTEGER).map((line) => `生命周期治理｜${line}`),
  ]);
  appendSection(lines, '建议操作', topLines(context.recommendedActions, Number.MAX_SAFE_INTEGER));
  appendSection(lines, '新品观察', topLines(context.newProductObservation, Number.MAX_SAFE_INTEGER));
```

- [ ] **Step 5: Run Markdown test**

Run: `npm test -- tests/publicTrafficReport.test.ts -t "keeps only exposure Top10 wording"`

Expected: PASS.

- [ ] **Step 6: Commit Markdown/fallback change**

Run:

```powershell
git add src/publicTraffic/buildPublicTrafficMarkdown.ts src/publicTraffic/buildPublicTrafficFeishu.ts tests/publicTrafficReport.test.ts
```

## Task 6: Full Regression And Build

**Files:**
- No code files unless regressions are found.

- [ ] **Step 1: Run targeted tests**

Run: `npm test -- tests/publicTrafficReport.test.ts`

Expected: all tests in that file PASS.

- [ ] **Step 2: Run all tests**

Run: `npm test`

Expected: all test files PASS.

- [ ] **Step 3: Run TypeScript build**

Run: `npm run build`

Expected: `tsc -p tsconfig.json` exits 0.

- [ ] **Step 4: Inspect final diff**

Run: `git status --short` and `git diff --stat HEAD`.

Expected: only intentional source/test/doc changes remain unstaged or committed; `.env` is not shown.

- [ ] **Step 5: Commit any regression fixes**

If a regression fix was needed, commit only the relevant files:

```powershell
git add src/publicTraffic tests/publicTrafficReport.test.ts
```

## Self-Review

- Spec coverage: card tables, pagination, root-level table constraint, full diagnostic rows, conclusion completeness, fulfillment rates, Markdown order, and workbook full data are covered by Tasks 1-6.
- Placeholder scan: no TBD/TODO placeholders remain; every task includes exact files, commands, and expected outcomes.
- Type consistency: table helper names and row keys are consistent across card and tests; no public type change is required.
