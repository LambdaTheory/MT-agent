# Task 2 Report: Select and verify requested dashboard data date

## Status

Completed and committed as `bf9faf2 feat: select requested dashboard data date`.

## Scope restoration

The prior agent had uncommitted modifications outside Task 2. I restored both to `HEAD` before completing the task:

- `src/publicTraffic/dashboardRefresh.ts`
- `tests/exposureCrawlerSource.test.ts`

I also removed the prior agent's extra dashboard source assertion about month-navigation order because it was not requested by the Task 2 plan. The retained test additions exactly cover the two planned source assertions: requested-date selection/readback occurs before the period loop, and automatic sub-account selection remains present.

Untracked planning/scratch artifacts were left untouched and excluded from the commit:

- `.superpowers/`
- `docs/superpowers/plans/2026-07-14-dated-dashboard-recapture.md`

## Changes retained

### `src/crawler/dashboardCrawler.ts`

- Imported Task 1's `assertDashboardDataDate` and `assessDashboardDateReadback`.
- Added the planned exported `DashboardCollectOptions` and `DashboardCollectionResult` interfaces.
- Added optional date-picker selection via `selectDashboardDataDate(page, target, dataDate)`.
  - Validates `dataDate` before picker interaction.
  - Uses `input[placeholder="请选择日期"]` and opens the closest visible Ant picker when available.
  - Aligns the visible calendar panel to the requested year/month, using month controls for nearby dates and year controls for distant dates.
  - Rejects a picker whose visible month cannot be read instead of clicking a potentially wrong day.
  - Prefers full-date cell metadata and otherwise restricts fallback day matching to in-view, non-disabled Ant picker cells.
  - Optionally confirms visible `确定`/`OK`, polls the input value for 30 seconds, and confirms it through `assessDashboardDateReadback`.
  - Emits stage-specific, non-sensitive errors with requested date and displayed picker value where relevant.
- Made `collectDashboardPage(config, page, options)` return `{ tables, actualPageDate? }`; date selection executes only when `options.dataDate` is supplied, after target/iframe resolution and before the initial empty-state test or period loop.
- Preserved page navigation, automatic sub-account selection, iframe support, empty-state confirmation, adaptive pagination, and collection of all three periods.
- Preserved `crawlDashboard(): Promise<RawTableData[]>` by returning `result.tables`.

### `src/crawler/publicTrafficCrawler.ts`

- Kept the regular daily-report call date-free and converted the new result contract back to the raw array with `(await collectDashboardPage(config, page)).tables`.

### `tests/dashboardCrawlerSource.test.ts`

- Added the two planned source-level regression assertions for date selection/readback ordering and continued automatic sub-account selection.

## TDD evidence

The prior agent had already written the Task 2 source tests and production implementation before this repair started. Therefore a clean pre-implementation RED run could not be reconstructed without discarding required in-scope work. The current focused test was initially run before the review hardening and was already GREEN:

```text
npm test -- tests/dashboardCrawlerSource.test.ts
PASS: 1 test file, 6 tests
```

After correcting review-identified reachable picker safeguards, the same focused test was run again and passed. This report records the unavailable RED evidence explicitly rather than claiming a fabricated RED phase.

## Validation

Commands executed from the Task 2 worktree:

```text
npm test -- tests/dashboardCrawlerSource.test.ts
PASS: 1 test file, 6 tests

npm run build
PASS: tsc -p tsconfig.json (exit 0)

git diff --check
PASS: no whitespace errors
```

No real Playwright/browser/backend capture, `.env` or profile access, Feishu delivery, or PM2 restart was performed.

## Self-review

- Confirmed the commit contains only the three Task 2 planned files.
- Confirmed `publicTrafficCrawler` provides no explicit `dataDate`, preserving the existing daily-report date behavior.
- Confirmed date selection runs only when requested and before initial empty-state/period collection.
- Confirmed both empty and non-empty return paths expose `tables` and only include `actualPageDate` after confirmed readback.
- Confirmed review follow-up fixed three picker hazards: bounded month-only navigation for historical dates, proceeding after unreadable calendar state, and selecting an adjacent-month date by day number.
- Confirmed `git diff --check` and TypeScript compilation pass.

## Concerns

- The test suite is intentionally source-level for this browser behavior; it validates presence and ordering but does not exercise a real Ant picker. The task prohibited a real backend/browser run.
- Picker markup can vary across Ant versions/locales. The implementation fails explicitly rather than writing unverified data when the picker panel, controls, date cell, or readback cannot be confirmed.
- The working tree retains untracked `.superpowers/` and plan artifacts supplied by the workflow; they were not added to the Task 2 commit.
---

## Reviewer Findings Fix Report

### Status

Fixed all Critical/Important Task 2 reviewer findings and the minor missing-picker diagnostic note.

### Files changed

- `src/publicTraffic/dashboardRefresh.ts`
  - Adapted `captureDashboardRawTables()` to the new `collectDashboardPage()` result contract by returning `dashboard.tables`, preserving its `Promise<RawTableData[]>` API.
- `src/crawler/dashboardCrawler.ts`
  - Added a pre-selection dashboard observable state snapshot before opening/selecting the date picker.
  - Added `waitForDashboardRefreshAfterDateSelection()` to require either a changed table/empty-state fingerprint or a post-selection loading-to-settled transition before collection continues.
  - Started refresh observation immediately after picker confirmation so fast loading transitions during input readback are not missed, then awaited the observer after `waitForDashboardDateReadback()` confirms the requested date.
  - Kept timeout diagnostics condition-based and non-sensitive by reporting pre/post observable fingerprints and `loadingTransitionObserved` through `dashboardDateFailure(..., dataDate)`.
  - Updated the missing date-picker error to include the requested `dataDate`.
- `tests/dashboardCrawlerSource.test.ts`
  - Added a focused source-level regression assertion that the date selection flow captures a pre-selection observable state, starts the stale-state refresh guard before readback completes, and awaits it after readback before returning.
- `tests/exposureCrawlerSource.test.ts`
  - Updated the public traffic source assertion to require `collectDashboardPage(config, page)` without an explicit date and `.tables` access.
  - Added coverage for the dashboard refresh compatibility wrapper returning raw table arrays from `.tables`.

### RED evidence

Command run from the target worktree via npm prefix:

```text
npm --prefix "C:\works\MT-agent\.claude\worktrees\dated-dashboard-recapture-design" test -- tests/dashboardCrawlerSource.test.ts tests/exposureCrawlerSource.test.ts
```

Expected failures were observed before production edits:

```text
FAIL tests/dashboardCrawlerSource.test.ts > guards against stale pre-selection dashboard state after date readback
AssertionError: expected source to contain 'captureDashboardObservableState'

FAIL tests/exposureCrawlerSource.test.ts > adapts dashboard collection result objects back to raw table arrays
AssertionError: expected refresh .tables access to be greater than collectDashboardPage call index
```

### GREEN / final verification

Commands run from the target worktree via npm prefix where applicable:

```text
npm --prefix "C:\works\MT-agent\.claude\worktrees\dated-dashboard-recapture-design" test -- tests/dashboardCrawlerSource.test.ts tests/exposureCrawlerSource.test.ts
PASS: 2 test files, 20 tests

npm --prefix "C:\works\MT-agent\.claude\worktrees\dated-dashboard-recapture-design" run build
PASS: tsc -p tsconfig.json

git -C "C:\works\MT-agent\.claude\worktrees\dated-dashboard-recapture-design" diff --check
PASS: no whitespace errors
```

No real browser/backend capture, `.env`, or profile access was performed.

### Self-review

- Confirmed `captureDashboardRawTables()` now returns `RawTableData[]` by unwrapping `.tables` and does not request a date.
- Confirmed `crawlPublicTrafficSources()` still invokes `collectDashboardPage(config, page)` without explicit `dataDate` and accesses `.tables`.
- Confirmed the stale-state guard no longer accepts a pre-existing visible table/empty state immediately after date readback; it requires either a changed observable fingerprint or a post-selection loading-to-settled transition.
- Confirmed the refresh observer starts before awaiting input readback, so fast loading transitions are less likely to be missed.
- Confirmed timeout diagnostics retain requested `dataDate` and include non-sensitive observable fingerprints rather than table contents.
- Confirmed the implementation remains limited to Task 2 compatibility/stale-state fixes and does not implement Task 4.

### Concerns

- The regression coverage remains source-level because the task explicitly prohibited real backend capture/profile access. It validates the stale-state guard structure and compatibility contracts, not a live Ant picker render.
- `git diff --check` reports Git line-ending warnings for touched LF files on Windows, but exits 0 with no whitespace errors.
