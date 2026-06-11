# Public Traffic Report Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix exposure product names, adjust report rules, remove file paths from Feishu output, and use internal IDs greater than 700 for new-product observation.

**Architecture:** Keep changes in the existing public traffic pipeline. Make the crawler extract a cleaner product title while preserving full cell text for product ID parsing; make analysis rules explicit in `analyzePublicTrafficData`; keep generated Markdown/XLSX files but stop sending their paths in notifications.

**Tech Stack:** TypeScript, Playwright, Vitest, xlsx-js-style.

---

### Task 1: Red Tests

**Files:**
- Modify: `tests/exposureNormalize.test.ts`
- Create: `tests/publicTrafficDataAnalysis.test.ts`
- Modify: `tests/publicTrafficReport.test.ts`

- [ ] Add tests for cleaning `预览`/price/status noise from exposure product titles.
- [ ] Add tests for low-exposure fallback and internal ID `>700` new product observation.
- [ ] Add tests that Feishu card/text no longer contain local file paths.

### Task 2: Crawler Title Extraction

**Files:**
- Modify: `src/crawler/exposureCrawler.ts`

- [ ] Export a product-title cleaning helper.
- [ ] In browser evaluation, extract each cell's title candidate from inner nodes before falling back to full cell text.
- [ ] Launch Chromium with a large viewport.

### Task 3: Analysis Rules

**Files:**
- Modify: `src/publicTraffic/analyzePublicTrafficData.ts`
- Modify: `src/publicTraffic/types.ts`

- [ ] Add `topExposure` and `warningProducts` sections to report context.
- [ ] Make `newProductObservation` include rows whose display ID is `端内ID N` and `N > 700`.
- [ ] Make low-exposure/warning logic work when exposure data is sparse by using visits/custody data where available.

### Task 4: Outputs

**Files:**
- Modify: `src/publicTraffic/buildPublicTrafficCard.ts`
- Modify: `src/publicTraffic/buildPublicTrafficFeishu.ts`
- Modify: `src/publicTraffic/buildPublicTrafficMarkdown.ts`
- Modify: `src/publicTraffic/buildPublicTrafficWorkbook.ts`

- [ ] Render top exposure and warning products.
- [ ] Remove report file path blocks from Feishu card/text only.
- [ ] Keep Markdown/XLSX generation unchanged as artifacts.

### Task 5: Verification

- [ ] Run targeted Vitest files.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
