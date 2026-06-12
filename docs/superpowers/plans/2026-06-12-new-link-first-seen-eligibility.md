# New Link First-Seen Eligibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Filter goods-manager recent links so `新链接冷启动` only includes synced internal IDs that first appeared in the Alipay goods export within the last 7 days.

**Architecture:** Reuse the existing goods export parsing patterns and `GoodsSnapshotItem` type. Add a small first-seen state module under `src/publicTraffic/` that updates `output/state/goods-first-seen.json`, then have the public traffic CLI filter `fetchRecentGoodsManagerProducts()` results through that state and the current goods export snapshot.

**Tech Stack:** TypeScript, Node fs/promises, xlsx-js-style, Vitest.

---

### Task 1: First-Seen State Unit Tests

**Files:**
- Modify: `tests/goodsSnapshot.test.ts`
- Modify: `src/publicTraffic/goodsSnapshot.ts`

- [ ] Write failing tests for extracting current goods snapshots, preserving existing first-seen dates, adding new internal IDs, and filtering IDs first seen within 7 days.
- [ ] Run `npx vitest run tests/goodsSnapshot.test.ts` and verify failure.
- [ ] Implement first-seen helpers in `goodsSnapshot.ts`.
- [ ] Re-run `npx vitest run tests/goodsSnapshot.test.ts` and verify pass.

### Task 2: Goods-Manager Eligibility Tests

**Files:**
- Modify: `tests/goodsManagerNewProducts.test.ts`
- Modify: `src/publicTraffic/goodsManagerNewProducts.ts`

- [ ] Write failing tests that synced recent goods pass and unsynced goods are excluded.
- [ ] Run `npx vitest run tests/goodsManagerNewProducts.test.ts` and verify failure.
- [ ] Add an option to require synced goods-manager items.
- [ ] Re-run the focused tests and verify pass.

### Task 3: CLI Integration

**Files:**
- Modify: `src/cli/publicTrafficReport.ts`
- Modify: `src/publicTraffic/paths.ts`
- Modify: `tests/publicTrafficReportCliBehavior.test.ts`

- [ ] Add a path for `output/state/goods-first-seen.json`.
- [ ] Update the CLI to parse the current goods export snapshot, update first-seen state, and filter goods-manager results by current goods export membership plus first-seen <= 7 days.
- [ ] Add CLI behavior tests for excluding old first-seen IDs, unsynced IDs, and IDs absent from the goods export.
- [ ] Run `npx vitest run tests/publicTrafficReportCliBehavior.test.ts tests/goodsSnapshot.test.ts tests/goodsManagerNewProducts.test.ts` and verify pass.

### Task 4: Verification

**Files:**
- No new source files expected.

- [ ] Run `npm run build`.
- [ ] Run `npm test`.
- [ ] Inspect generated card JSON from existing context or rerun report only after user confirmation if browser login might be triggered.
