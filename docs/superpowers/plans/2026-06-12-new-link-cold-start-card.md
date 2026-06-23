# New Link Cold Start Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Feishu “新品维护池” summary with a “新链接冷启动” panel that scores recent links by live time, daily product-page visits, and deals.

**Architecture:** Keep existing report context and workbook output unchanged. Add card-only helpers in `src/publicTraffic/buildPublicTrafficCard.ts` to derive cold-start rows from `newProductPoolItems` plus existing product metrics, then render a Markdown status summary and prioritized detail list inside the existing collapsible panel. Do not nest Feishu `table` components inside `collapsible_panel`; the Feishu API rejects that structure.

**Tech Stack:** TypeScript, existing Feishu card JSON DSL, Vitest.

---

### Task 1: Add Card-Level Cold Start Tests

**Files:**
- Modify: `tests/publicTrafficReport.test.ts`

- [ ] **Step 1: Write failing tests**

Add a test that builds a context with recent link items and matching report rows, then asserts the card contains `新链接冷启动`, status labels, daily visit thresholds, and no old `新品维护池` header.

- [ ] **Step 2: Run the focused test**

Run: `npx vitest run tests/publicTrafficReport.test.ts -t "新链接冷启动|new product pool"`

Expected: FAIL because the card still renders `新品维护池` and lacks cold-start status output.

### Task 2: Implement Cold Start Card Helpers

**Files:**
- Modify: `src/publicTraffic/buildPublicTrafficCard.ts`

- [ ] **Step 1: Add helper types and calculations**

Add card-local helpers for parsing `submittedAt`, computing live days, daily visits from `7d.dashboardVisits`, and classifying statuses: `强跑通`, `优秀链接`, `访问达标`, `有苗头`, `未启动`, `危险`, `待观察`.

- [ ] **Step 2: Replace the panel renderer**

Replace `newProductPoolPanel()` content with a new-link cold-start panel using the existing `metricCardRow()` and `tableElement()` helpers.

- [ ] **Step 3: Keep ID-only fallback**

If only `newProductPoolIds` exist, show `新链接冷启动（N）` with a markdown list of `商品ID X：待观察`.

### Task 3: Update Existing Assertions

**Files:**
- Modify: `tests/publicTrafficReport.test.ts`

- [ ] **Step 1: Update old card string expectations**

Change expectations from `新品维护池（N）` to `新链接冷启动（N）` where they assert card panel headers.

- [ ] **Step 2: Run focused tests**

Run: `npx vitest run tests/publicTrafficReport.test.ts`

Expected: PASS.

### Task 4: Verify and Run Report

**Files:**
- No source file changes expected.

- [ ] **Step 1: Run build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 2: Run root test suite**

Run explicit root tests or focused report tests if `.worktrees/` pollution appears.

Expected: PASS for changed behavior.

- [ ] **Step 3: Generate one report**

Run: `npm run public-traffic-report -- --send-to personal`

Expected: Report generation succeeds and Feishu card shows `新链接冷启动`.
