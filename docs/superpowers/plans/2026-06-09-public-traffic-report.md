# Public Traffic Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first stable public traffic report iteration: exposure page probe, exposure cumulative snapshots, product daily deltas, 7/30 aggregation, new product observation, state machine, upgraded reports, and Feishu summary.

**Architecture:** Add a new `src/publicTraffic/` feature area while preserving the existing `daily-report` workflow. Existing visit/order/shipment data remains a supporting source; new exposure data is stored under `output/public-traffic/YYYY-MM-DD/` and transformed into deltas, summaries, observations, and report outputs.

**Tech Stack:** Node.js, TypeScript, Playwright, `xlsx-js-style`, Vitest, existing Feishu app API sender.

---

## File Structure

- Create `src/publicTraffic/types.ts`: public traffic domain types.
- Create `src/publicTraffic/paths.ts`: output path builder for `output/public-traffic/YYYY-MM-DD/`.
- Create `src/publicTraffic/exposureNormalize.ts`: normalize exposure overview/table rows from raw text/table data.
- Create `src/publicTraffic/exposureDelta.ts`: compute daily deltas from cumulative snapshots.
- Create `src/publicTraffic/exposureAggregate.ts`: build rolling 7/30 summaries from daily delta files.
- Create `src/publicTraffic/goodsSnapshot.ts`: convert goods export mapping/workbook data into goods-list snapshots and detect new products.
- Create `src/publicTraffic/observationState.ts`: state machine and manual override application.
- Create `src/publicTraffic/buildPublicTrafficReport.ts`: combine data into report context and recommendations.
- Create `src/publicTraffic/buildPublicTrafficMarkdown.ts`: Markdown output.
- Create `src/publicTraffic/buildPublicTrafficWorkbook.ts`: XLSX output.
- Create `src/publicTraffic/buildPublicTrafficFeishu.ts`: medium-density Feishu summary text.
- Create `src/crawler/exposurePageProbe.ts`: Playwright probe that saves diagnostics.
- Create `src/crawler/exposureCrawler.ts`: Playwright crawler for exposure overview and product cumulative rows.
- Create `src/cli/probeExposurePage.ts`: `npm run probe-exposure-page` command.
- Create `src/cli/publicTrafficReport.ts`: `npm run public-traffic-report` command.
- Modify `src/domain/types.ts`: add `exposureUrl?: string` to `AgentConfig`.
- Modify `src/config/loadConfig.ts`: parse optional `exposureUrl`.
- Modify `config/agent.config.json`: add exposure page URL.
- Modify `package.json`: add new scripts.
- Create tests for each pure-data module before implementation.

## Task 1: Config And Public Traffic Paths

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/config/loadConfig.ts`
- Modify: `config/agent.config.json`
- Create: `src/publicTraffic/paths.ts`
- Test: `tests/config.test.ts`
- Test: `tests/publicTrafficPaths.test.ts`

- [ ] **Step 1: Write failing config test**

Add to `tests/config.test.ts`:

```ts
it('parses optional exposure url', () => {
  expect(
    parseAgentConfig({
      targetUrl: 'https://example.com/dashboard',
      exposureUrl: 'https://example.com/exposure',
      periods: ['1d', '7d', '30d'],
      preferredPageSize: 100,
      outputDir: 'output',
      browserProfileDir: '.browser-profile',
    }),
  ).toMatchObject({
    exposureUrl: 'https://example.com/exposure',
  });
});
```

- [ ] **Step 2: Write failing paths test**

Create `tests/publicTrafficPaths.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildPublicTrafficPaths } from '../src/publicTraffic/paths.js';

describe('buildPublicTrafficPaths', () => {
  it('builds public traffic output paths for a date', () => {
    expect(buildPublicTrafficPaths('output', '2026-06-09')).toEqual({
      dir: 'output/public-traffic/2026-06-09',
      exposureOverview: 'output/public-traffic/2026-06-09/exposure-overview.json',
      exposureCumulativeProducts: 'output/public-traffic/2026-06-09/exposure-cumulative-products.json',
      exposureDailyDelta: 'output/public-traffic/2026-06-09/exposure-daily-delta.json',
      exposure7dSummary: 'output/public-traffic/2026-06-09/exposure-7d-summary.json',
      exposure30dSummary: 'output/public-traffic/2026-06-09/exposure-30d-summary.json',
      goodsListSnapshot: 'output/public-traffic/2026-06-09/goods-list-snapshot.json',
      newProductObservation: 'output/public-traffic/2026-06-09/new-product-observation.json',
      observationState: 'output/public-traffic/2026-06-09/observation-state.json',
      markdown: 'output/public-traffic/2026-06-09/public-traffic-report.md',
      workbook: 'output/public-traffic/2026-06-09/public-traffic-report.xlsx',
      reportContext: 'output/public-traffic/2026-06-09/report-context.json',
      log: 'output/public-traffic/2026-06-09/run.log',
    });
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

Run: `npm test -- tests/config.test.ts tests/publicTrafficPaths.test.ts`

Expected: FAIL because `exposureUrl` is not parsed and `src/publicTraffic/paths.ts` does not exist.

- [ ] **Step 4: Implement config and paths**

Modify `src/domain/types.ts`:

```ts
export interface AgentConfig {
  targetUrl: string;
  periods: PeriodKey[];
  preferredPageSize: number;
  outputDir: string;
  browserProfileDir: string;
  productIdMappingPath?: string;
  goodsExportUrl?: string;
  exposureUrl?: string;
}
```

Modify `src/config/loadConfig.ts` return object:

```ts
exposureUrl: optionalString(record.exposureUrl, 'exposureUrl'),
```

Modify `config/agent.config.json`:

```json
"exposureUrl": "https://b.alipay.com/page/self-operation-center/custody?custodyChannel=public"
```

Create `src/publicTraffic/paths.ts`:

```ts
export interface PublicTrafficPaths {
  dir: string;
  exposureOverview: string;
  exposureCumulativeProducts: string;
  exposureDailyDelta: string;
  exposure7dSummary: string;
  exposure30dSummary: string;
  goodsListSnapshot: string;
  newProductObservation: string;
  observationState: string;
  markdown: string;
  workbook: string;
  reportContext: string;
  log: string;
}

export function buildPublicTrafficPaths(outputDir: string, date: string): PublicTrafficPaths {
  const dir = `${outputDir}/public-traffic/${date}`;
  return {
    dir,
    exposureOverview: `${dir}/exposure-overview.json`,
    exposureCumulativeProducts: `${dir}/exposure-cumulative-products.json`,
    exposureDailyDelta: `${dir}/exposure-daily-delta.json`,
    exposure7dSummary: `${dir}/exposure-7d-summary.json`,
    exposure30dSummary: `${dir}/exposure-30d-summary.json`,
    goodsListSnapshot: `${dir}/goods-list-snapshot.json`,
    newProductObservation: `${dir}/new-product-observation.json`,
    observationState: `${dir}/observation-state.json`,
    markdown: `${dir}/public-traffic-report.md`,
    workbook: `${dir}/public-traffic-report.xlsx`,
    reportContext: `${dir}/report-context.json`,
    log: `${dir}/run.log`,
  };
}
```

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- tests/config.test.ts tests/publicTrafficPaths.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

Commit:

```bash
git add config/agent.config.json src/domain/types.ts src/config/loadConfig.ts src/publicTraffic/paths.ts tests/config.test.ts tests/publicTrafficPaths.test.ts
git commit -m "feat: add public traffic config and paths"
```

## Task 2: Public Traffic Domain Types And Exposure Normalization

**Files:**
- Create: `src/publicTraffic/types.ts`
- Create: `src/publicTraffic/exposureNormalize.ts`
- Test: `tests/exposureNormalize.test.ts`

- [ ] **Step 1: Write failing exposure normalization test**

Create `tests/exposureNormalize.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { normalizeExposureProductRows, parseMoney, parseNumberText } from '../src/publicTraffic/exposureNormalize.js';

describe('exposure normalization', () => {
  it('parses number and money text', () => {
    expect(parseNumberText('48,103.0')).toBe(48103);
    expect(parseNumberText('3.31%')).toBe(3.31);
    expect(parseMoney('¥3,018.80')).toBe(3018.8);
  });

  it('normalizes exposure cumulative product rows', () => {
    const rows = normalizeExposureProductRows(
      ['商品名称', '商品ID', '曝光', '访问', '交易金额', '托管天数'],
      [['DJI Pocket 3', '2026052122000827682227', '5,801', '159', '¥119.00', '23天']],
    );

    expect(rows).toEqual([
      {
        productName: 'DJI Pocket 3',
        platformProductId: '2026052122000827682227',
        exposure: 5801,
        visits: 159,
        amount: 119,
        custodyDays: 23,
        raw: {
          商品名称: 'DJI Pocket 3',
          商品ID: '2026052122000827682227',
          曝光: '5,801',
          访问: '159',
          交易金额: '¥119.00',
          托管天数: '23天',
        },
      },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- tests/exposureNormalize.test.ts`

Expected: FAIL because modules do not exist.

- [ ] **Step 3: Implement types and normalization**

Create `src/publicTraffic/types.ts`:

```ts
export interface ExposureOverviewMetric {
  period: '1d' | '7d' | '30d';
  exposure: number;
  visits: number;
  conversionRate: number;
  amount: number;
}

export interface ExposureCumulativeProduct {
  productName: string;
  platformProductId: string;
  exposure: number;
  visits: number;
  amount: number;
  custodyDays: number | null;
  raw: Record<string, string>;
}
```

Create `src/publicTraffic/exposureNormalize.ts`:

```ts
import type { ExposureCumulativeProduct } from './types.js';

function normalize(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function findColumn(headers: string[], candidates: string[]): number {
  const normalized = headers.map(normalize);
  const index = normalized.findIndex((header) => candidates.some((candidate) => header.includes(candidate)));
  if (index < 0) {
    throw new Error(`Missing exposure column: ${candidates.join('/')}. Actual headers: ${headers.join(', ')}`);
  }
  return index;
}

export function parseNumberText(value: unknown): number {
  const cleaned = normalize(value).replace(/[,%，]/g, '').replace(/天$/, '');
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseMoney(value: unknown): number {
  return parseNumberText(normalize(value).replace(/[¥￥]/g, ''));
}

export function normalizeExposureProductRows(headers: string[], rows: string[][]): ExposureCumulativeProduct[] {
  const nameIndex = findColumn(headers, ['商品名称', '商品']);
  const idIndex = findColumn(headers, ['商品ID', '平台商品ID', '平台侧编码']);
  const exposureIndex = findColumn(headers, ['曝光']);
  const visitsIndex = findColumn(headers, ['访问']);
  const amountIndex = findColumn(headers, ['金额', '收入', '交易']);
  const custodyIndex = headers.findIndex((header) => normalize(header).includes('托管'));

  return rows
    .map((row) => {
      const raw: Record<string, string> = {};
      headers.forEach((header, index) => {
        raw[normalize(header)] = normalize(row[index]);
      });

      return {
        productName: normalize(row[nameIndex]),
        platformProductId: normalize(row[idIndex]),
        exposure: parseNumberText(row[exposureIndex]),
        visits: parseNumberText(row[visitsIndex]),
        amount: parseMoney(row[amountIndex]),
        custodyDays: custodyIndex >= 0 ? parseNumberText(row[custodyIndex]) : null,
        raw,
      };
    })
    .filter((row) => row.platformProductId);
}
```

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- tests/exposureNormalize.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

Commit:

```bash
git add src/publicTraffic/types.ts src/publicTraffic/exposureNormalize.ts tests/exposureNormalize.test.ts
git commit -m "feat: normalize exposure product rows"
```

## Task 3: Exposure Delta And Rolling Aggregation

**Files:**
- Modify: `src/publicTraffic/types.ts`
- Create: `src/publicTraffic/exposureDelta.ts`
- Create: `src/publicTraffic/exposureAggregate.ts`
- Test: `tests/exposureDelta.test.ts`
- Test: `tests/exposureAggregate.test.ts`

- [ ] **Step 1: Write failing delta test**

Create `tests/exposureDelta.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeExposureDailyDelta } from '../src/publicTraffic/exposureDelta.js';
import type { ExposureCumulativeProduct } from '../src/publicTraffic/types.js';

const oldRows: ExposureCumulativeProduct[] = [
  { productName: 'A', platformProductId: '1001', exposure: 100, visits: 10, amount: 20, custodyDays: 5, raw: {} },
  { productName: 'B', platformProductId: '1002', exposure: 50, visits: 5, amount: 0, custodyDays: 10, raw: {} },
];

const newRows: ExposureCumulativeProduct[] = [
  { productName: 'A', platformProductId: '1001', exposure: 130, visits: 14, amount: 35, custodyDays: 6, raw: {} },
  { productName: 'C', platformProductId: '1003', exposure: 8, visits: 1, amount: 0, custodyDays: 1, raw: {} },
  { productName: 'B', platformProductId: '1002', exposure: 40, visits: 4, amount: 0, custodyDays: 11, raw: {} },
];

describe('computeExposureDailyDelta', () => {
  it('computes deltas and flags new and reset rows', () => {
    expect(computeExposureDailyDelta('2026-06-09', oldRows, newRows)).toEqual([
      { date: '2026-06-09', productName: 'A', platformProductId: '1001', exposure: 30, visits: 4, amount: 15, custodyDays: 6, flags: [] },
      { date: '2026-06-09', productName: 'C', platformProductId: '1003', exposure: 8, visits: 1, amount: 0, custodyDays: 1, flags: ['new_product'] },
      { date: '2026-06-09', productName: 'B', platformProductId: '1002', exposure: 0, visits: 0, amount: 0, custodyDays: 11, flags: ['counter_reset_or_data_error'] },
    ]);
  });
});
```

- [ ] **Step 2: Write failing aggregation test**

Create `tests/exposureAggregate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { aggregateExposureDeltas } from '../src/publicTraffic/exposureAggregate.js';

describe('aggregateExposureDeltas', () => {
  it('aggregates deltas by product id', () => {
    expect(
      aggregateExposureDeltas([
        { date: '2026-06-08', productName: 'A', platformProductId: '1001', exposure: 10, visits: 1, amount: 2, custodyDays: 5, flags: [] },
        { date: '2026-06-09', productName: 'A', platformProductId: '1001', exposure: 20, visits: 3, amount: 5, custodyDays: 6, flags: [] },
      ]),
    ).toEqual([
      {
        productName: 'A',
        platformProductId: '1001',
        exposure: 30,
        visits: 4,
        amount: 7,
        visitRate: 4 / 30,
        days: 2,
        flags: [],
      },
    ]);
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

Run: `npm test -- tests/exposureDelta.test.ts tests/exposureAggregate.test.ts`

Expected: FAIL because modules and types are missing.

- [ ] **Step 4: Implement delta and aggregation**

Extend `src/publicTraffic/types.ts`:

```ts
export type ExposureDeltaFlag = 'new_product' | 'missing' | 'counter_reset_or_data_error';

export interface ExposureDailyDelta {
  date: string;
  productName: string;
  platformProductId: string;
  exposure: number;
  visits: number;
  amount: number;
  custodyDays: number | null;
  flags: ExposureDeltaFlag[];
}

export interface ExposureProductSummary {
  productName: string;
  platformProductId: string;
  exposure: number;
  visits: number;
  amount: number;
  visitRate: number;
  days: number;
  flags: ExposureDeltaFlag[];
}
```

Create `src/publicTraffic/exposureDelta.ts`:

```ts
import type { ExposureCumulativeProduct, ExposureDailyDelta } from './types.js';

function byId(rows: ExposureCumulativeProduct[]): Map<string, ExposureCumulativeProduct> {
  return new Map(rows.map((row) => [row.platformProductId, row]));
}

export function computeExposureDailyDelta(date: string, previous: ExposureCumulativeProduct[], current: ExposureCumulativeProduct[]): ExposureDailyDelta[] {
  const previousById = byId(previous);

  return current.map((row) => {
    const old = previousById.get(row.platformProductId);
    if (!old) {
      return { date, productName: row.productName, platformProductId: row.platformProductId, exposure: row.exposure, visits: row.visits, amount: row.amount, custodyDays: row.custodyDays, flags: ['new_product'] };
    }

    const exposure = row.exposure - old.exposure;
    const visits = row.visits - old.visits;
    const amount = row.amount - old.amount;
    if (exposure < 0 || visits < 0 || amount < 0) {
      return { date, productName: row.productName, platformProductId: row.platformProductId, exposure: 0, visits: 0, amount: 0, custodyDays: row.custodyDays, flags: ['counter_reset_or_data_error'] };
    }

    return { date, productName: row.productName, platformProductId: row.platformProductId, exposure, visits, amount, custodyDays: row.custodyDays, flags: [] };
  });
}
```

Create `src/publicTraffic/exposureAggregate.ts`:

```ts
import type { ExposureDailyDelta, ExposureDeltaFlag, ExposureProductSummary } from './types.js';

export function aggregateExposureDeltas(rows: ExposureDailyDelta[]): ExposureProductSummary[] {
  const grouped = new Map<string, ExposureProductSummary & { flagSet: Set<ExposureDeltaFlag> }>();

  for (const row of rows) {
    const existing = grouped.get(row.platformProductId) ?? {
      productName: row.productName,
      platformProductId: row.platformProductId,
      exposure: 0,
      visits: 0,
      amount: 0,
      visitRate: 0,
      days: 0,
      flags: [],
      flagSet: new Set<ExposureDeltaFlag>(),
    };

    existing.productName = row.productName || existing.productName;
    existing.exposure += row.exposure;
    existing.visits += row.visits;
    existing.amount += row.amount;
    existing.days += 1;
    row.flags.forEach((flag) => existing.flagSet.add(flag));
    grouped.set(row.platformProductId, existing);
  }

  return Array.from(grouped.values()).map(({ flagSet, ...row }) => ({
    ...row,
    visitRate: row.exposure > 0 ? row.visits / row.exposure : 0,
    flags: Array.from(flagSet),
  }));
}
```

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- tests/exposureDelta.test.ts tests/exposureAggregate.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

Commit:

```bash
git add src/publicTraffic/types.ts src/publicTraffic/exposureDelta.ts src/publicTraffic/exposureAggregate.ts tests/exposureDelta.test.ts tests/exposureAggregate.test.ts
git commit -m "feat: compute exposure deltas and summaries"
```

## Task 4: Goods Snapshot And New Product Detection

**Files:**
- Modify: `src/publicTraffic/types.ts`
- Create: `src/publicTraffic/goodsSnapshot.ts`
- Test: `tests/goodsSnapshot.test.ts`

- [ ] **Step 1: Write failing goods snapshot test**

Create `tests/goodsSnapshot.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { detectNewGoods, latestInternalIds } from '../src/publicTraffic/goodsSnapshot.js';

describe('goods snapshot', () => {
  it('detects new internal product ids from snapshots', () => {
    expect(
      detectNewGoods(
        '2026-06-09',
        [{ platformProductId: 'p1', internalProductId: '100', productName: 'Old' }],
        [
          { platformProductId: 'p1', internalProductId: '100', productName: 'Old' },
          { platformProductId: 'p2', internalProductId: '105', productName: 'New' },
        ],
      ),
    ).toEqual([{ date: '2026-06-09', platformProductId: 'p2', internalProductId: '105', productName: 'New', source: 'goods_diff' }]);
  });

  it('finds largest internal ids as recent candidates', () => {
    expect(
      latestInternalIds([
        { platformProductId: 'p1', internalProductId: '100', productName: 'A' },
        { platformProductId: 'p2', internalProductId: '120', productName: 'B' },
        { platformProductId: 'p3', internalProductId: '110', productName: 'C' },
      ], 2),
    ).toEqual([
      { platformProductId: 'p2', internalProductId: '120', productName: 'B' },
      { platformProductId: 'p3', internalProductId: '110', productName: 'C' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- tests/goodsSnapshot.test.ts`

Expected: FAIL because `goodsSnapshot.ts` does not exist.

- [ ] **Step 3: Implement goods snapshot helpers**

Extend `src/publicTraffic/types.ts`:

```ts
export interface GoodsSnapshotItem {
  platformProductId: string;
  internalProductId: string;
  productName: string;
}

export interface NewProductObservationItem extends GoodsSnapshotItem {
  date: string;
  source: 'goods_diff' | 'recent_internal_id';
}
```

Create `src/publicTraffic/goodsSnapshot.ts`:

```ts
import type { GoodsSnapshotItem, NewProductObservationItem } from './types.js';

function internalIdNumber(item: GoodsSnapshotItem): number {
  const parsed = Number.parseInt(item.internalProductId, 10);
  return Number.isFinite(parsed) ? parsed : -1;
}

export function detectNewGoods(date: string, previous: GoodsSnapshotItem[], current: GoodsSnapshotItem[]): NewProductObservationItem[] {
  const previousIds = new Set(previous.map((item) => item.internalProductId));
  return current
    .filter((item) => item.internalProductId && !previousIds.has(item.internalProductId))
    .map((item) => ({ ...item, date, source: 'goods_diff' }));
}

export function latestInternalIds(items: GoodsSnapshotItem[], limit: number): GoodsSnapshotItem[] {
  return [...items].sort((left, right) => internalIdNumber(right) - internalIdNumber(left)).slice(0, limit);
}
```

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- tests/goodsSnapshot.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

Commit:

```bash
git add src/publicTraffic/types.ts src/publicTraffic/goodsSnapshot.ts tests/goodsSnapshot.test.ts
git commit -m "feat: detect new goods from snapshots"
```

## Task 5: Observation State Machine And Manual Overrides

**Files:**
- Modify: `src/publicTraffic/types.ts`
- Create: `src/publicTraffic/observationState.ts`
- Create: `config/product-observation-overrides.example.json`
- Test: `tests/observationState.test.ts`

- [ ] **Step 1: Write failing observation tests**

Create `tests/observationState.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyObservationOverrides, transitionObservationState } from '../src/publicTraffic/observationState.js';

describe('observation state', () => {
  it('moves repeated abnormal watching products to candidate action', () => {
    expect(
      transitionObservationState({ platformProductId: 'p1', state: 'watching', abnormalDays: 2, cooldownUntil: null, note: '' }, { abnormal: true, improved: false, newProduct: false }, '2026-06-09'),
    ).toMatchObject({ platformProductId: 'p1', state: 'candidate_action', abnormalDays: 3 });
  });

  it('keeps cooldown products in cooldown until date passes', () => {
    expect(
      transitionObservationState({ platformProductId: 'p1', state: 'cooldown', abnormalDays: 5, cooldownUntil: '2026-06-10', note: '' }, { abnormal: true, improved: false, newProduct: false }, '2026-06-09'),
    ).toMatchObject({ state: 'cooldown', cooldownUntil: '2026-06-10' });
  });

  it('applies manual override by internal id', () => {
    expect(
      applyObservationOverrides(
        [{ platformProductId: 'p1', internalProductId: '558', state: 'candidate_action', abnormalDays: 3, cooldownUntil: null, note: '' }],
        [{ internalProductId: '558', state: 'cooldown', cooldownUntil: '2026-06-16', note: '已人工处理，观察7天' }],
      ),
    ).toEqual([{ platformProductId: 'p1', internalProductId: '558', state: 'cooldown', abnormalDays: 3, cooldownUntil: '2026-06-16', note: '已人工处理，观察7天' }]);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- tests/observationState.test.ts`

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement observation state**

Extend `src/publicTraffic/types.ts`:

```ts
export type ObservationStateName = 'new_observation' | 'watching' | 'candidate_action' | 'cooldown' | 'resolved_or_stable';

export interface ProductObservationState {
  platformProductId: string;
  internalProductId?: string;
  state: ObservationStateName;
  abnormalDays: number;
  cooldownUntil: string | null;
  note: string;
}

export interface ProductObservationSignal {
  abnormal: boolean;
  improved: boolean;
  newProduct: boolean;
}

export interface ProductObservationOverride {
  platformProductId?: string;
  internalProductId?: string;
  state: ObservationStateName;
  cooldownUntil?: string | null;
  note?: string;
}
```

Create `src/publicTraffic/observationState.ts`:

```ts
import type { ProductObservationOverride, ProductObservationSignal, ProductObservationState } from './types.js';

export function transitionObservationState(current: ProductObservationState, signal: ProductObservationSignal, date: string): ProductObservationState {
  if (current.state === 'cooldown' && current.cooldownUntil && current.cooldownUntil >= date) {
    return current;
  }

  if (signal.newProduct) {
    return { ...current, state: 'new_observation', abnormalDays: signal.abnormal ? current.abnormalDays + 1 : current.abnormalDays };
  }

  if (signal.improved) {
    return { ...current, state: 'resolved_or_stable', abnormalDays: 0, cooldownUntil: null };
  }

  const abnormalDays = signal.abnormal ? current.abnormalDays + 1 : 0;
  if (abnormalDays >= 3) {
    return { ...current, state: 'candidate_action', abnormalDays, cooldownUntil: null };
  }

  if (signal.abnormal) {
    return { ...current, state: 'watching', abnormalDays, cooldownUntil: null };
  }

  return { ...current, state: 'resolved_or_stable', abnormalDays: 0, cooldownUntil: null };
}

function matchesOverride(state: ProductObservationState, override: ProductObservationOverride): boolean {
  return Boolean((override.internalProductId && state.internalProductId === override.internalProductId) || (override.platformProductId && state.platformProductId === override.platformProductId));
}

export function applyObservationOverrides(states: ProductObservationState[], overrides: ProductObservationOverride[]): ProductObservationState[] {
  return states.map((state) => {
    const override = overrides.find((item) => matchesOverride(state, item));
    if (!override) return state;
    return {
      ...state,
      state: override.state,
      cooldownUntil: override.cooldownUntil ?? state.cooldownUntil,
      note: override.note ?? state.note,
    };
  });
}
```

Create `config/product-observation-overrides.example.json`:

```json
[
  {
    "internalProductId": "558",
    "state": "cooldown",
    "cooldownUntil": "2026-06-16",
    "note": "已人工处理，观察7天"
  }
]
```

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- tests/observationState.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

Commit:

```bash
git add src/publicTraffic/types.ts src/publicTraffic/observationState.ts tests/observationState.test.ts config/product-observation-overrides.example.json
git commit -m "feat: add product observation state machine"
```

## Task 6: Exposure Page Probe Command

**Files:**
- Create: `src/crawler/exposurePageProbe.ts`
- Create: `src/cli/probeExposurePage.ts`
- Modify: `package.json`
- Test: `tests/exposureProbe.test.ts`

- [ ] **Step 1: Write failing helper test**

Create `tests/exposureProbe.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { summarizeExposureProbeText } from '../src/crawler/exposurePageProbe.js';

describe('summarizeExposureProbeText', () => {
  it('keeps useful visible controls and metrics', () => {
    expect(summarizeExposureProbeText(['曝光', '访问', '交易金额', '', '   ', '导出商品']).controls).toEqual(['曝光', '访问', '交易金额', '导出商品']);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- tests/exposureProbe.test.ts`

Expected: FAIL because probe module does not exist.

- [ ] **Step 3: Implement probe module and CLI**

Create `src/crawler/exposurePageProbe.ts` with a pure helper and Playwright probe:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import type { AgentConfig } from '../domain/types.js';
import { clearBrowserProfileLocks, prepareDashboardPage } from './browserProfile.js';
import { selectSubAccountIfNeeded } from './dashboardCrawler.js';
import { shouldKeepBrowserOpenOnFailure } from './failureHandling.js';
import { waitForSettledLoginState } from './loginState.js';

export interface ExposureProbeSummary {
  url?: string;
  controls: string[];
  tables?: Array<{ headers: string[]; sampleRows: string[][] }>;
}

export function summarizeExposureProbeText(texts: string[]): ExposureProbeSummary {
  return { controls: texts.map((text) => text.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 200) };
}

async function ensureExposurePage(config: AgentConfig, page: Awaited<ReturnType<typeof chromium.launchPersistentContext>>['pages'][number]): Promise<void> {
  const url = config.exposureUrl ?? 'https://b.alipay.com/page/self-operation-center/custody?custodyChannel=public';
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const state = await waitForSettledLoginState(page, { timeoutMs: 60000, intervalMs: 1000 });
  if (state === 'login-page') {
    console.log('检测到支付宝登录页，请扫码登录；登录成功后程序会继续探测曝光页面。');
    await page.waitForURL((currentUrl) => !/auth\.alipay\.com|login/i.test(currentUrl.toString()), { timeout: 300000 });
  }
  if (page.url().includes('select-identity')) {
    await selectSubAccountIfNeeded(page);
  }
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
}

export async function probeExposurePage(config: AgentConfig, outputPath = 'output/latest/exposure-page-probe.json'): Promise<void> {
  await mkdir('output/latest', { recursive: true });
  await clearBrowserProfileLocks(config.browserProfileDir);
  const browser = await chromium.launchPersistentContext(config.browserProfileDir, { headless: false });
  const page = await prepareDashboardPage(browser.pages(), () => browser.newPage());
  let completed = false;

  try {
    await ensureExposurePage(config, page);
    const controls = await page.locator('button, .ant-tabs-tab, .ant-select-selection-item, .ant-radio-button-wrapper, label, .ant-btn').evaluateAll((nodes) => nodes.map((node) => String(node.textContent ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean));
    const tables = await page.locator('table').evaluateAll((tables) => tables.map((table) => {
      const headers = Array.from(table.querySelectorAll('thead th')).map((cell) => String(cell.textContent ?? '').replace(/\s+/g, ' ').trim());
      const sampleRows = Array.from(table.querySelectorAll('tbody tr')).slice(0, 5).map((row) => Array.from(row.querySelectorAll('td')).map((cell) => String(cell.textContent ?? '').replace(/\s+/g, ' ').trim()));
      return { headers, sampleRows };
    }));
    await writeFile(outputPath, JSON.stringify({ url: page.url(), controls: summarizeExposureProbeText(controls).controls, tables }, null, 2), 'utf8');
    completed = true;
  } finally {
    if (completed || !shouldKeepBrowserOpenOnFailure(process.env.MT_AGENT_KEEP_BROWSER_ON_FAILURE)) {
      await browser.close();
    } else {
      console.error('Exposure probe failed; keeping browser open for inspection.');
    }
  }
}
```

Create `src/cli/probeExposurePage.ts`:

```ts
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../config/loadConfig.js';
import { probeExposurePage } from '../crawler/exposurePageProbe.js';

export async function runProbeExposurePageCli(): Promise<void> {
  const config = await loadConfig();
  await probeExposurePage(config);
  console.log('Wrote exposure page probe to output/latest/exposure-page-probe.json');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runProbeExposurePageCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
```

Modify `package.json` scripts:

```json
"probe-exposure-page": "tsx src/cli/probeExposurePage.ts"
```

- [ ] **Step 4: Run tests, build, live probe, and commit**

Run: `npm test -- tests/exposureProbe.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

Run: `npm run probe-exposure-page`

Expected: writes `output/latest/exposure-page-probe.json`. If login appears, scan QR. If probe fails, inspect the kept browser and fix selectors with evidence.

Commit:

```bash
git add package.json src/crawler/exposurePageProbe.ts src/cli/probeExposurePage.ts tests/exposureProbe.test.ts
git commit -m "feat: add exposure page probe"
```

## Task 7: Report Context, Markdown, Feishu Summary, And Workbook Skeleton

**Files:**
- Create: `src/publicTraffic/buildPublicTrafficReport.ts`
- Create: `src/publicTraffic/buildPublicTrafficMarkdown.ts`
- Create: `src/publicTraffic/buildPublicTrafficFeishu.ts`
- Create: `src/publicTraffic/buildPublicTrafficWorkbook.ts`
- Test: `tests/publicTrafficReport.test.ts`

- [ ] **Step 1: Write failing report test**

Create `tests/publicTrafficReport.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildPublicTrafficFeishuText } from '../src/publicTraffic/buildPublicTrafficFeishu.js';
import { buildPublicTrafficMarkdown } from '../src/publicTraffic/buildPublicTrafficMarkdown.js';

const context = {
  date: '2026-06-09',
  overview: [{ period: '1d' as const, exposure: 48103, visits: 1591, conversionRate: 3.31, amount: 3018.8 }],
  exposureOptimization: [{ identifier: '端内ID 558', action: '曝光优化', reason: '高曝光低访问' }],
  conversionOptimization: [{ identifier: '端内ID 421', action: '转化优化', reason: '有访问无金额' }],
  newProductObservation: [{ identifier: '端内ID 900', action: '新品观察', reason: '新品未进推广' }],
  lifecycleGovernance: [{ identifier: '端内ID 333', action: '生命周期治理', reason: '托管久且低曝光' }],
};

describe('public traffic report outputs', () => {
  it('builds markdown sections', () => {
    const markdown = buildPublicTrafficMarkdown(context);
    expect(markdown).toContain('# 公域流量日报 2026-06-09');
    expect(markdown).toContain('## 曝光优化');
    expect(markdown).toContain('端内ID 558');
  });

  it('builds medium-density Feishu text', () => {
    const text = buildPublicTrafficFeishuText(context, { markdownPath: 'report.md', workbookPath: 'report.xlsx' });
    expect(text).toContain('公域流量日报 2026-06-09');
    expect(text).toContain('曝光：48103');
    expect(text).toContain('新品观察：1个');
    expect(text).toContain('Markdown：report.md');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- tests/publicTrafficReport.test.ts`

Expected: FAIL because modules do not exist.

- [ ] **Step 3: Implement report skeletons**

Create `src/publicTraffic/buildPublicTrafficMarkdown.ts`:

```ts
type SectionItem = { identifier: string; action: string; reason: string };
type Context = { date: string; exposureOptimization: SectionItem[]; conversionOptimization: SectionItem[]; newProductObservation: SectionItem[]; lifecycleGovernance: SectionItem[] };

function linesFor(items: SectionItem[]): string[] {
  return items.length > 0 ? items.map((item, index) => `${index + 1}. ${item.identifier}：${item.action}。原因：${item.reason}`) : ['无'];
}

export function buildPublicTrafficMarkdown(context: Context): string {
  return [
    `# 公域流量日报 ${context.date}`,
    '',
    '## 曝光优化',
    ...linesFor(context.exposureOptimization),
    '',
    '## 转化优化',
    ...linesFor(context.conversionOptimization),
    '',
    '## 新品观察',
    ...linesFor(context.newProductObservation),
    '',
    '## 生命周期治理',
    ...linesFor(context.lifecycleGovernance),
    '',
  ].join('\n');
}
```

Create `src/publicTraffic/buildPublicTrafficFeishu.ts`:

```ts
type Overview = { period: '1d' | '7d' | '30d'; exposure: number; visits: number; conversionRate: number; amount: number };
type SectionItem = { identifier: string; action: string; reason: string };
type Context = { date: string; overview: Overview[]; exposureOptimization: SectionItem[]; conversionOptimization: SectionItem[]; newProductObservation: SectionItem[]; lifecycleGovernance: SectionItem[] };
type Paths = { markdownPath: string; workbookPath: string };

function topLines(items: SectionItem[], limit = 5): string[] {
  return items.length > 0 ? items.slice(0, limit).map((item, index) => `${index + 1}. ${item.identifier}｜${item.reason}`) : ['无'];
}

export function buildPublicTrafficFeishuText(context: Context, paths: Paths): string {
  const one = context.overview.find((item) => item.period === '1d') ?? { exposure: 0, visits: 0, conversionRate: 0, amount: 0 };
  return [
    `公域流量日报 ${context.date}`,
    '',
    '今日总览',
    `曝光：${one.exposure}`,
    `访问：${one.visits}`,
    `转化率：${one.conversionRate}%`,
    `金额：¥${one.amount.toFixed(2)}`,
    '',
    '模块数量',
    `曝光优化：${context.exposureOptimization.length}个`,
    `转化优化：${context.conversionOptimization.length}个`,
    `新品观察：${context.newProductObservation.length}个`,
    `生命周期治理：${context.lifecycleGovernance.length}个`,
    '',
    '曝光优化 Top5',
    ...topLines(context.exposureOptimization),
    '',
    '转化优化 Top5',
    ...topLines(context.conversionOptimization),
    '',
    `Markdown：${paths.markdownPath}`,
    `XLSX：${paths.workbookPath}`,
  ].join('\n');
}
```

Create `src/publicTraffic/buildPublicTrafficReport.ts` with a pass-through context builder for this milestone:

```ts
export function buildPublicTrafficReportContext<T>(context: T): T {
  return context;
}
```

Create `src/publicTraffic/buildPublicTrafficWorkbook.ts` with a minimal workbook writer:

```ts
import XLSX from 'xlsx-js-style';

export function writePublicTrafficWorkbookBuffer(context: unknown): Buffer {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(Array.isArray(context) ? context : [context as Record<string, unknown>]);
  XLSX.utils.book_append_sheet(workbook, sheet, '公域流量日报');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
```

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- tests/publicTrafficReport.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

Commit:

```bash
git add src/publicTraffic/buildPublicTrafficReport.ts src/publicTraffic/buildPublicTrafficMarkdown.ts src/publicTraffic/buildPublicTrafficFeishu.ts src/publicTraffic/buildPublicTrafficWorkbook.ts tests/publicTrafficReport.test.ts
git commit -m "feat: add public traffic report outputs"
```

## Task 8: Public Traffic Report CLI Skeleton

**Files:**
- Create: `src/cli/publicTrafficReport.ts`
- Modify: `package.json`

- [ ] **Step 1: Implement CLI skeleton**

Create `src/cli/publicTrafficReport.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../config/loadConfig.js';
import { maybeSendFeishuTestMessage } from '../notify/feishu.js';
import { buildPublicTrafficFeishuText } from '../publicTraffic/buildPublicTrafficFeishu.js';
import { buildPublicTrafficMarkdown } from '../publicTraffic/buildPublicTrafficMarkdown.js';
import { writePublicTrafficWorkbookBuffer } from '../publicTraffic/buildPublicTrafficWorkbook.js';
import { buildPublicTrafficPaths } from '../publicTraffic/paths.js';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function runPublicTrafficReportCli(): Promise<void> {
  const config = await loadConfig();
  const date = today();
  const paths = buildPublicTrafficPaths(config.outputDir, date);
  await mkdir(paths.dir, { recursive: true });

  const context = {
    date,
    overview: [],
    exposureOptimization: [],
    conversionOptimization: [],
    newProductObservation: [],
    lifecycleGovernance: [],
  };

  await writeFile(paths.reportContext, JSON.stringify(context, null, 2), 'utf8');
  await writeFile(paths.markdown, buildPublicTrafficMarkdown(context), 'utf8');
  await writeFile(paths.workbook, writePublicTrafficWorkbookBuffer(context));
  await writeFile(paths.log, `date=${date}\nstatus=skeleton\n`, 'utf8');

  const text = buildPublicTrafficFeishuText(context, { markdownPath: paths.markdown, workbookPath: paths.workbook });
  const result = await maybeSendFeishuTestMessage();
  console.log(`Wrote public traffic report skeleton to ${paths.dir}`);
  console.log(`Feishu connectivity check: ${result.sent ? 'sent' : result.reason}`);
  console.log(text);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPublicTrafficReportCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
```

Modify `package.json` scripts:

```json
"public-traffic-report": "tsx src/cli/publicTrafficReport.ts"
```

- [ ] **Step 2: Run build and skeleton command**

Run: `npm run build`

Expected: PASS.

Run: `npm run public-traffic-report`

Expected: writes skeleton files under `output/public-traffic/YYYY-MM-DD/`.

- [ ] **Step 3: Commit**

```bash
git add package.json src/cli/publicTrafficReport.ts
git commit -m "feat: add public traffic report command"
```

## Task 9: Full Verification

**Files:**
- No source changes unless verification reveals a bug.

- [ ] **Step 1: Run full test suite**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 2: Run build**

Run: `npm run build`

Expected: TypeScript build passes.

- [ ] **Step 3: Run live probe**

Run: `npm run probe-exposure-page`

Expected: `output/latest/exposure-page-probe.json` exists and contains page URL, controls, and table samples.

- [ ] **Step 4: Run skeleton public traffic report**

Run: `npm run public-traffic-report`

Expected: public traffic output directory contains `report-context.json`, `public-traffic-report.md`, `public-traffic-report.xlsx`, and `run.log`.

- [ ] **Step 5: Inspect git status**

Run: `git status --short`

Expected: no unexpected untracked source files; `output/` remains ignored.

## Self-Review

- Spec coverage: This plan covers config, output paths, exposure normalization, cumulative delta, 7/30 aggregation, goods snapshot/new product detection, observation state/manual overrides, exposure probe, report outputs, and command skeleton.
- Deferred items remain deferred: product execution, Feishu Q&A, interactive approvals, LLM copywriting, cloud deployment, and archival compression are not implemented here.
- Scope note: This plan builds the first stable foundation and skeleton. The next plan should wire live exposure crawler results into `public-traffic-report`, then merge existing visit/order/shipment data into the report context.
