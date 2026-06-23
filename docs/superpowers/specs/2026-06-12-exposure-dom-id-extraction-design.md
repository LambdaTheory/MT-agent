# Exposure DOM ID Extraction Design

## Goal

Prevent exposure crawler product IDs from being polluted by adjacent price text, such as parsing `ID: 202603022200089883907515.04 ~ 128.00元/日` as `20260302220008988390751` instead of `2026030222000898839075`.

## Current Problem

The exposure crawler currently reads the whole `商品信息` cell text and extracts the platform product ID with a regex. On the Alipay page, the ID and price are separate DOM components, but their text can be concatenated when read as plain cell text:

- ID component: `div.idWrap___gZnY7 > span`, text like `ID：2026030222000898839075`
- Price component: `span.price___RCP_k`, text like `15.04 ~ 128.00元/日`

When the two text nodes are flattened, the first digit of the price can appear immediately after the ID.

## Chosen Approach

Use DOM-based ID extraction first. Use text regex only as a fallback, and require fallback IDs to pass product mapping validation.

## Data Flow

1. For each exposure table row, identify the `商品信息` cell.
2. Try to read the platform product ID from an ID-specific DOM selector inside that cell:
   - Preferred selector: `[class*="idWrap"] span`
   - Extract only digits after `ID:` / `ID：` from that element's text.
3. If DOM extraction succeeds, use that ID directly.
4. If DOM extraction fails, read the existing flattened cell text and use the current regex fallback.
5. Validate regex fallback output against the product ID mapping:
   - Accept the ID if it exists in `config/product-id-map.json`.
   - If it does not exist, try removing one trailing digit and accept that value if it exists in the mapping.
   - If neither value exists, skip the row and log the skipped ID/text reason.
6. Store only the validated platform ID in exposure snapshots and downstream daily deltas.

## Components

- `src/crawler/exposureCrawler.ts`
  - Extend table row extraction so each row keeps access to the original row/cell locator or a DOM-evaluated extraction result, not only flattened text.
  - Use DOM ID extraction before falling back to text regex.

- `src/publicTraffic/extractProductIdFromInfo.ts`
  - Keep regex extraction as a fallback helper.
  - Add or expose a validation helper that can canonicalize a fallback ID using the mapping.

- `src/publicTraffic/mergePublicTrafficData.ts`
  - Existing canonicalization can remain as a downstream safety net, but it should no longer be the first place that fixes ID + price pollution.

## Error Handling

- DOM extraction failure is not fatal.
- Regex fallback is accepted only when mapping validation succeeds.
- Rows skipped after fallback validation failure are logged with enough context to diagnose selector drift, without exposing secrets.
- If many rows are skipped, the run log should make the issue visible through skipped-row counts.

## Testing

- Add unit tests for fallback validation:
  - Exact mapping hit is accepted.
  - One trailing digit removed and mapping hit is accepted.
  - No mapping hit is rejected.
- Add extraction tests for DOM-shaped row data or a small Playwright-free helper:
  - `idWrap` text returns the clean ID even when price text exists beside it.
  - Regex fallback handles old flattened text only when mapping validation succeeds.
- Existing public traffic tests should continue to pass.

## Non-Goals

- Do not use color or visual style detection for ID extraction.
- Do not parse price text as part of product ID extraction.
- Do not rewrite the whole exposure crawler pagination flow.

## Expected Result

Exposure snapshots should contain the clean platform ID, for example `2026030222000898839075`, not the polluted `20260302220008988390751`. This prevents old products from being misclassified as new products and prevents cumulative exposure from being reported as a one-day delta.
