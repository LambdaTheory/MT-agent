# Product Display Name Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show concise product names in Feishu public traffic card tables using an optional internal-ID mapping and safe cleanup fallback.

**Architecture:** Add a focused display-name resolver under `src/publicTraffic` and keep it display-only. `buildPublicTrafficCard.ts` will call the resolver for table rows and the new-product pool; raw context, Markdown, Excel, crawlers, and analysis stay unchanged.

**Tech Stack:** Node.js, TypeScript, Vitest, Feishu interactive card JSON.

---

## File Structure

- Create `src/publicTraffic/productDisplayName.ts`: extracts internal IDs, normalizes optional mapping objects, removes known noisy title tokens, truncates fallback names, and resolves the card display name.
- Modify `src/publicTraffic/buildPublicTrafficCard.ts`: replace local `shortProductName` with resolver calls and accept optional card display-name mapping via a third argument.
- Create `config/product-name-map.example.json`: committed sample mapping format; real `config/product-name-map.json` remains optional/local.
- Modify `tests/publicTrafficReport.test.ts`: add failing card-level tests proving Feishu tables use mapped/cleaned/fallback names and Markdown still uses raw names.

### Task 1: Card Display Name Tests

**Files:**
- Modify: `tests/publicTrafficReport.test.ts`

- [ ] **Step 1: Write the failing mapped-name card test**

Add this test inside `describe('public traffic report outputs', () => { ... })` near the other Feishu card tests:

```ts
  it('uses manual product short names only in Feishu card tables', () => {
    const card = buildPublicTrafficCard(context, { markdownPath: 'report.md', workbookPath: 'report.xlsx' }, { productNameMap: { '1001': '佳能 SX70' } });
    const serialized = JSON.stringify(card);

    expect(serialized).toContain('佳能 SX70');
    expect(serialized).not.toContain('公域商品A');
    expect(buildPublicTrafficMarkdown(context)).toContain('公域商品A');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/publicTrafficReport.test.ts -t "uses manual product short names only in Feishu card tables"`

Expected: FAIL because `buildPublicTrafficCard` does not accept the `productNameMap` option yet, or the serialized card still contains `公域商品A`.

- [ ] **Step 3: Write the failing cleanup/fallback card test**

Add this second test near the mapped-name test:

```ts
  it('cleans noisy product names and falls back to ID for empty names in Feishu card tables', () => {
    const noisyContext = makeDataReportContext({
      rows: [
        {
          platformProductId: 'P-251',
          displayProductId: '端内ID 251',
          productName: '佳能 SX70 65倍长焦4K相机演唱会出游日常记录出片神器芝麻免押租赁 ZFB',
          custodyDays: 12,
          periods: {
            '1d': metrics({ exposure: 120, publicVisits: 4, dashboardVisits: 4, shippedOrders: 0 }),
            '7d': metrics({ exposure: 700, publicVisits: 20, dashboardVisits: 18, shippedOrders: 1 }),
            '30d': metrics({ exposure: 3000, publicVisits: 80, dashboardVisits: 70, shippedOrders: 3 }),
          },
        },
        {
          platformProductId: 'P-empty',
          displayProductId: '端内ID 999',
          productName: '  ',
          custodyDays: 12,
          periods: {
            '1d': metrics({ exposure: 80, publicVisits: 1, dashboardVisits: 1, shippedOrders: 0 }),
            '7d': metrics({ exposure: 300, publicVisits: 10, dashboardVisits: 8, shippedOrders: 0 }),
            '30d': metrics({ exposure: 1200, publicVisits: 40, dashboardVisits: 30, shippedOrders: 1 }),
          },
        },
      ],
      weakConversion: [],
      highPotential: [],
      newProductObservation: [],
      recommendedActions: [],
    });

    const serialized = JSON.stringify(buildPublicTrafficCard(noisyContext, { markdownPath: 'report.md', workbookPath: 'report.xlsx' }));

    expect(serialized).toContain('佳能 SX70 65倍长焦4K相机');
    expect(serialized).not.toContain('演唱会');
    expect(serialized).not.toContain('芝麻免押');
    expect(serialized).toContain('端内ID 999');
  });
```

- [ ] **Step 4: Run the cleanup/fallback test to verify it fails**

Run: `npx vitest run tests/publicTrafficReport.test.ts -t "cleans noisy product names and falls back to ID for empty names in Feishu card tables"`

Expected: FAIL because the current `shortProductName` only slices raw names and uses `Unknown` for empty names.

### Task 2: Display Name Resolver

**Files:**
- Create: `src/publicTraffic/productDisplayName.ts`
- Modify: `src/publicTraffic/buildPublicTrafficCard.ts`

- [ ] **Step 1: Implement the resolver**

Create `src/publicTraffic/productDisplayName.ts`:

```ts
import type { PublicTrafficProductDataRow } from './types.js';

export type ProductNameMap = Record<string, string>;

const NOISE_TOKENS = ['70天', '芝麻免押', '租赁', '演唱会', '出游', '日常记录', '出片神器', '配置可选', 'ZFB'];
const FALLBACK_LIMIT = 18;
const MAPPED_LIMIT = 24;

export function internalProductId(displayProductId: string): string {
  return displayProductId.replace(/^端内ID\s*/, '').trim();
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? value.slice(0, limit) : value;
}

function cleanProductName(productName: string): string {
  let name = productName.trim();
  for (const token of NOISE_TOKENS) name = name.replaceAll(token, ' ');
  return name.replace(/\s+/g, ' ').trim();
}

export function resolveProductDisplayName(row: PublicTrafficProductDataRow, productNameMap: ProductNameMap = {}): string {
  const internalId = internalProductId(row.displayProductId);
  const mappedName = productNameMap[internalId]?.trim();
  if (mappedName) return truncate(mappedName, MAPPED_LIMIT);

  const cleaned = cleanProductName(row.productName);
  if (cleaned) return truncate(cleaned, FALLBACK_LIMIT);

  return row.displayProductId;
}
```

- [ ] **Step 2: Wire the resolver into the card builder**

Modify `src/publicTraffic/buildPublicTrafficCard.ts`:

```ts
import { resolveProductDisplayName, type ProductNameMap } from './productDisplayName.js';
```

Add a card options type after imports:

```ts
export interface PublicTrafficCardOptions {
  productNameMap?: ProductNameMap;
}
```

Replace the existing `shortProductName` implementation with:

```ts
function shortProductName(row: PublicTrafficProductDataRow, productNameMap: ProductNameMap = {}): string {
  return resolveProductDisplayName(row, productNameMap);
}
```

Thread `productNameMap` through `exposureTopRows`, `exposureBoostRows`, `conversionRows`, `scaleRows`, `metricTables`, and `buildPublicTrafficCard` so all table rows call `shortProductName(row, productNameMap)`.

Change the exported function signature to:

```ts
export function buildPublicTrafficCard(context: PublicTrafficDataReportContext, _paths: PublicTrafficReportPaths, options: PublicTrafficCardOptions = {}): FeishuCardPayload {
```

- [ ] **Step 3: Run the focused card tests**

Run: `npx vitest run tests/publicTrafficReport.test.ts -t "product short names|cleans noisy product names"`

Expected: PASS.

### Task 3: Example Config

**Files:**
- Create: `config/product-name-map.example.json`

- [ ] **Step 1: Add the example mapping file**

Create `config/product-name-map.example.json`:

```json
{
  "251": "佳能 SX70",
  "536": "佳能 G7X3",
  "624": "大疆 Pocket3"
}
```

- [ ] **Step 2: Verify JSON is valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('config/product-name-map.example.json','utf8')); console.log('ok')"`

Expected: `ok`.

### Task 4: Verification

**Files:**
- Test: `tests/publicTrafficReport.test.ts`

- [ ] **Step 1: Run the report tests**

Run: `npx vitest run tests/publicTrafficReport.test.ts`

Expected: PASS.

- [ ] **Step 2: Run the TypeScript build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 3: Inspect relevant diff only**

Run: `git diff -- src/publicTraffic/buildPublicTrafficCard.ts src/publicTraffic/productDisplayName.ts tests/publicTrafficReport.test.ts config/product-name-map.example.json docs/superpowers/plans/2026-06-12-product-display-name-mapping.md`

Expected: Diff includes only the resolver, card integration, tests, example config, and this plan.
