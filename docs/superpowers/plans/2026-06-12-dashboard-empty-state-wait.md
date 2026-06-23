# Dashboard Empty State Wait Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the public visits page shows `未查询到相关数据`, wait 10 seconds, then skip that period if the empty state remains.

**Architecture:** Keep the existing dashboard crawler empty table behavior, but make empty-state detection component-aware and delayed. Add source tests to prevent immediate skip regressions.

**Tech Stack:** TypeScript, Playwright, Vitest.

---

## Task 1: Delay Empty-State Skip

**Files:**
- Modify: `tests/dashboardCrawlerSource.test.ts`
- Modify: `src/crawler/dashboardCrawler.ts`

- [ ] Add a failing source test expecting `.emptyTxt-LkXGcaGA`, `confirmDashboardEmptyState`, and `waitForTimeout(10000)`.
- [ ] Run `npx vitest run tests/dashboardCrawlerSource.test.ts` and confirm failure.
- [ ] Implement `confirmDashboardEmptyState(page)` that checks `.emptyTxt-LkXGcaGA`, waits 10 seconds, then checks again.
- [ ] Replace immediate empty-state returns in `collectPeriod` with `confirmDashboardEmptyState`.
- [ ] Run `npx vitest run tests/dashboardCrawlerSource.test.ts tests/dashboardEmptyState.test.ts`.
- [ ] Run `npm run build`.
