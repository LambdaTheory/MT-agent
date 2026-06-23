# Exposure DOM ID Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract exposure product IDs from the page's ID DOM component first, and only accept regex fallback IDs when product mapping validation confirms them.

**Architecture:** Keep regex parsing as a small pure helper in `src/publicTraffic/extractProductIdFromInfo.ts`, add mapping-based fallback validation there, and update `src/crawler/exposureCrawler.ts` to read DOM-specific row data from the exposure table. The downstream merge canonicalization remains as a safety net, not the primary correction path.

**Tech Stack:** TypeScript, Playwright, Vitest, existing public traffic crawler modules.

---

## File Structure

- Modify `src/publicTraffic/extractProductIdFromInfo.ts`: keep `extractProductIdFromInfo`, add `resolveFallbackProductId` for mapping-validated fallback IDs.
- Modify `tests/extractProductId.test.ts`: add tests for exact mapping match, trailing-digit correction, and rejected fallback IDs.
- Modify `src/crawler/exposureCrawler.ts`: enhance exposure table row extraction to include `domProductId` from `[class*="idWrap"] span`, use DOM ID first, then mapping-validated regex fallback.
- Modify or add crawler-focused tests only if an existing Playwright-free seam is available after the helper extraction; otherwise validate via existing unit tests and `publicTrafficReport` tests.

## Task 1: Mapping-Validated Fallback Helper

**Files:**
- Modify: `C:\works\MT-agent\src\publicTraffic\extractProductIdFromInfo.ts`
- Modify: `C:\works\MT-agent\tests\extractProductId.test.ts`

- [ ] **Step 1: Write failing tests for fallback validation**

Add these imports and tests to `tests/extractProductId.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { extractProductIdFromInfo, resolveFallbackProductId } from '../src/publicTraffic/extractProductIdFromInfo.js';

describe('resolveFallbackProductId', () => {
  const mapping = {
    '2026030222000898839075': '251',
    '2026011222000691436531': '333',
  };

  it('accepts an exact mapping hit', () => {
    expect(resolveFallbackProductId('2026030222000898839075', mapping)).toBe('2026030222000898839075');
  });

  it('repairs a trailing price digit when the shortened ID exists in mapping', () => {
    expect(resolveFallbackProductId('20260302220008988390751', mapping)).toBe('2026030222000898839075');
  });

  it('rejects fallback IDs that do not match mapping exactly or after one trailing digit is removed', () => {
    expect(resolveFallbackProductId('20260302220008988390759', mapping)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the targeted test and verify it fails**

Run: `npx vitest run tests/extractProductId.test.ts`

Expected: FAIL because `resolveFallbackProductId` is not exported.

- [ ] **Step 3: Implement minimal helper**

Update `src/publicTraffic/extractProductIdFromInfo.ts` to export the helper:

```ts
type ProductIdMappingLike = Record<string, string>;

const PLATFORM_ID_PATTERN = /\b(20\d{20,})\b/;
const ID_BEFORE_PRICE_PATTERN = /(?:ID|商品ID|平台商品ID)\s*[:：]?\s*(20\d{21,})(?=\.\d{1,2}\s*~)/i;

function hasMapping(mapping: ProductIdMappingLike, platformProductId: string): boolean {
  return Object.prototype.hasOwnProperty.call(mapping, platformProductId);
}

export function resolveFallbackProductId(platformProductId: string | null, mapping: ProductIdMappingLike): string | null {
  if (!platformProductId) return null;
  if (hasMapping(mapping, platformProductId)) return platformProductId;

  const withoutTrailingDigit = platformProductId.slice(0, -1);
  if (hasMapping(mapping, withoutTrailingDigit)) return withoutTrailingDigit;

  return null;
}

export function extractProductIdFromInfo(text: string): string | null {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const priceAdjacentMatch = normalized.match(ID_BEFORE_PRICE_PATTERN);
  if (priceAdjacentMatch?.[1]) {
    return priceAdjacentMatch[1].slice(0, -1);
  }

  const match = normalized.match(PLATFORM_ID_PATTERN);
  return match ? match[1] : null;
}
```

- [ ] **Step 4: Run targeted tests**

Run: `npx vitest run tests/extractProductId.test.ts`

Expected: PASS.

## Task 2: DOM-First Exposure Row Extraction

**Files:**
- Modify: `C:\works\MT-agent\src\crawler\exposureCrawler.ts`
- Modify: `C:\works\MT-agent\src\cli\publicTrafficReport.ts` only if mapping is not already available at crawler call site.
- Test: `C:\works\MT-agent\tests\extractProductId.test.ts`
- Test: `C:\works\MT-agent\tests\publicTrafficReport.test.ts`

- [ ] **Step 1: Add DOM extraction support to the table row shape**

In `src/crawler/exposureCrawler.ts`, update the local row object returned by `getCurrentTable(page)` so each row includes `domProductId` read from the `商品信息` cell:

```ts
const domProductId = normalizeText(
  infoCell
    ?.querySelector('[class*="idWrap"] span')
    ?.textContent ?? '',
).match(/(?:ID|商品ID|平台商品ID)\s*[:：]?\s*(20\d{20,})/)?.[1] ?? '';
```

Use class-substring selectors instead of exact hashed class names so CSS module hash changes do not break extraction.

- [ ] **Step 2: Pass product mapping into exposure row extraction**

Change `extractProductRows(page)` to accept the product ID mapping already loaded in `runPublicTrafficReportCli`:

```ts
async function extractProductRows(page: Page, mapping: ProductIdMapping): Promise<ExposureCumulativeProduct[]> {
```

Then pass `mapping` through `collectExposurePage` / `crawlPublicTrafficSources` only if needed by the current call graph. If passing through the crawler stack would be invasive, load the mapping once in `collectExposurePage` from config and keep the change local.

- [ ] **Step 3: Use DOM ID first, mapping-validated regex second**

In the loop that currently does this:

```ts
const platformProductId = extractProductIdFromInfo(infoText);
if (!platformProductId) {
  continue;
}
```

replace it with:

```ts
const regexProductId = extractProductIdFromInfo(infoText);
const platformProductId = domProductId || resolveFallbackProductId(regexProductId, mapping);
if (!platformProductId) {
  skippedProductIdRows += 1;
  continue;
}
```

Keep `domProductId` unmodified when present. Only apply mapping validation to regex fallback.

- [ ] **Step 4: Log skipped fallback rows**

Track skipped rows in `extractProductRows`:

```ts
let skippedProductIdRows = 0;
```

After pagination completes, emit:

```ts
if (skippedProductIdRows > 0) {
  console.warn(`[曝光] 跳过${skippedProductIdRows}行: DOM ID 缺失且正则 ID 未命中商品总表映射`);
}
```

- [ ] **Step 5: Run targeted tests**

Run: `npx vitest run tests/extractProductId.test.ts tests/publicTrafficReport.test.ts`

Expected: PASS.

## Task 3: Verify Build And Existing Source Checks

**Files:**
- No planned source changes.

- [ ] **Step 1: Run the public traffic source and report tests**

Run: `npx vitest run tests/publicTrafficCliSource.test.ts tests/publicTrafficReportRulesSource.test.ts tests/publicTrafficReport.test.ts tests/extractProductId.test.ts`

Expected: PASS.

- [ ] **Step 2: Run build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 3: Do not commit unless explicitly requested**

Leave changes in the working tree for user review. Do not run `git commit` unless the user asks for a commit.

## Self-Review

- Spec coverage: DOM-first ID extraction, regex fallback mapping validation, skip logging, no color detection, and no pagination rewrite are all covered.
- Placeholder scan: no TBD/TODO placeholders remain.
- Type consistency: `resolveFallbackProductId(platformProductId, mapping)` is defined before crawler use; mapping type is a plain record compatible with current product ID mapping.
