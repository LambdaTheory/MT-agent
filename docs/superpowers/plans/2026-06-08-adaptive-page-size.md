# Adaptive Page Size Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make formal dashboard crawling use the fastest stable page size, falling back from 100 to 50, 20, then 10 when switching or extraction fails.

**Architecture:** Add pure candidate-selection logic in `src/crawler/pageSizeProbe.ts` and reuse Playwright page-size switching in `dashboardCrawler.ts`. Each period selects a stable page size before paginating, records actual page sizes, and falls back safely when a candidate fails.

**Tech Stack:** Node.js, TypeScript, Playwright, Vitest.

---

### Task 1: Candidate Helper

**Files:**
- Modify: `src/crawler/pageSizeProbe.ts`
- Modify: `tests/pageSizeProbe.test.ts`

- [ ] **Step 1: Write failing test**

Add a test for default candidates and fallback selection.

- [ ] **Step 2: Run target test**

Run: `npm test -- tests/pageSizeProbe.test.ts`

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement helper**

Export `DEFAULT_PAGE_SIZE_CANDIDATES = [100, 50, 20, 10]` and `normalizePageSizeCandidates(preferred)` returning preferred first, then defaults without duplicates.

- [ ] **Step 4: Verify target test**

Run: `npm test -- tests/pageSizeProbe.test.ts`

Expected: PASS.

### Task 2: Crawler Integration

**Files:**
- Modify: `src/crawler/dashboardCrawler.ts`
- Test: existing crawler/report tests

- [ ] **Step 1: Wire candidate page sizes**

Change each period collection to try normalized candidates. For each candidate: select period, set page size, extract first page. On failure, log and retry next candidate.

- [ ] **Step 2: Keep safe fallback**

If all candidates fail, return `emptyStats(period)` from existing error path. Successful collection keeps `actualPageSizes` and `pageSizeFallback` based on whether actual sizes differ from selected preferred candidate.

- [ ] **Step 3: Verify**

Run: `npm test`, `npm run build`, then `npm run daily-report` for real verification.

### Self-Review

- Spec coverage: Uses 100 first and falls back to 50/20/10 on failure.
- Placeholder scan: No placeholders remain.
- Type consistency: Candidate helper names are consistent.
