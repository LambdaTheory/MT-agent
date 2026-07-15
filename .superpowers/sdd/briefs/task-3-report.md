# Task 3 Report: Locate existing reports by business data date and archive unpaired captures

## Scope implemented

Implemented only Task 3 from `C:\works\MT-agent\.claude\worktrees\dated-dashboard-recapture-design\docs\superpowers\plans\2026-07-14-dated-dashboard-recapture.md`:

- Added public report context lookup by business data date in `src/publicTraffic/reportContextLocator.ts`.
- Added historical dashboard raw archive writer in `src/publicTraffic/historicalDashboardCapture.ts`.
- Adapted `src/feishuBot/reportStore.ts` so `findReportContextByDate(outputDir, date)` delegates to the public locator while preserving its external `{ path, context } | null` return shape and error message for invalid date.
- Added focused tests in `tests/reportContextLocator.test.ts` and `tests/historicalDashboardCapture.test.ts`.

No Task 4 refresh orchestration was started. No external backend, `.env`, browser profile, Playwright capture, Feishu delivery, or PM2 action was run.

## RED results

1. `npm --prefix "C:\works\MT-agent\.claude\worktrees\dated-dashboard-recapture-design" test -- tests/reportContextLocator.test.ts tests/historicalDashboardCapture.test.ts`
   - Result: FAIL as expected.
   - Failure reason: both new modules were missing:
     - `Cannot find module '../src/publicTraffic/historicalDashboardCapture.js'`
     - `Cannot find module '../src/publicTraffic/reportContextLocator.js'`

A first accidental run without `--prefix` executed in this subagent's own isolated worktree and found no test files; it was discarded and immediately rerun against the requested worktree with `npm --prefix`.

## GREEN results

1. `npm --prefix "C:\works\MT-agent\.claude\worktrees\dated-dashboard-recapture-design" test -- tests/reportContextLocator.test.ts tests/historicalDashboardCapture.test.ts tests/feishuBotReportStore.test.ts`
   - Result: PASS.
   - Test files: 3 passed.
   - Tests: 14 passed.

2. `npm --prefix "C:\works\MT-agent\.claude\worktrees\dated-dashboard-recapture-design" run build`
   - Result: PASS.
   - TypeScript compile completed with no diagnostics.

## Files changed

- `src/publicTraffic/reportContextLocator.ts`
  - Exports `LocatedPublicTrafficReport` and `findPublicTrafficReportByDataDate(outputDir, dataDate)`.
  - Scans ISO dated output directories in descending lexical order.
  - Matches `context.date` rather than directory name.
  - Uses `buildPublicTrafficPaths(outputDir, runDate).reportContext` for canonical context path.
  - Also checks legacy `report-context.json` to preserve `findReportContextByDate` compatibility for old reports/tests.
  - Ignores only ENOENT from missing output directory or missing context files.
  - Propagates malformed JSON and other filesystem errors.

- `src/publicTraffic/historicalDashboardCapture.ts`
  - Exports `HistoricalDashboardCaptureManifest` and `saveHistoricalDashboardCapture(...)`.
  - Writes under `outputDir/historical-dashboard-captures/<dataDate>/`.
  - Writes the required Chinese-named raw files:
    - `公域访问数据_1日.json`
    - `公域访问数据_7日.json`
    - `公域访问数据_30日.json`
  - Writes `capture-manifest.json` with `reportContextFound: false`, `rebuild: 'skipped'`, `resend: 'skipped'`, and reason `未找到该业务数据日的既有日报上下文`.
  - Throws if any required period raw table is missing.
  - Does not import rebuild/report send/run-state code.

- `src/feishuBot/reportStore.ts`
  - `findReportContextByDate(outputDir, date)` now delegates to the public locator and adapts its result to `{ path: located.contextPath, context: located.context }`.
  - `findLatestReportContext` and formatter/query helpers were left unchanged.

- `tests/reportContextLocator.test.ts`
  - Verifies a next-day run directory is found by `context.date`.
  - Verifies a same-named directory with a different `context.date` is not treated as a match.
  - Verifies malformed context JSON is propagated.

- `tests/historicalDashboardCapture.test.ts`
  - Verifies all three raw files and the no-report manifest are written.

## Changed compatibility behavior

- `findReportContextByDate(outputDir, date)` retains the same API and invalid-date behavior, but its search is now implemented through `publicTraffic/reportContextLocator`.
- Existing compatibility for legacy `report-context.json` files is preserved inside the public locator. This was required because `tests/feishuBotReportStore.test.ts` still covers old reports that use `report-context.json`.
- The public locator still matches only `context.date`; directory names alone never satisfy a lookup.

## Self-review

- Confirmed no publicTraffic import from `feishuBot/reportStore` was introduced; dependency direction is `feishuBot/reportStore -> publicTraffic/reportContextLocator`.
- Confirmed malformed JSON is not swallowed.
- Confirmed missing context files are the only ignored per-directory context-file error.
- Confirmed historical archive writes only raw files and manifest; no rebuild/resend functions are imported or called.
- Confirmed no `.env`, browser profile, output data, PM2 config, or external-service action was touched.
- Fixed a Windows path separator mismatch by returning `dir` via `join(outputDir, runDate)`.
- Fixed a temporary PowerShell encoding corruption of `reportStore.ts` by restoring the file from Git and reapplying the minimal UTF-8-safe edit.

## Concerns / notes

- The locator intentionally checks both canonical `公域数据上下文_<runDate>.json` and legacy `report-context.json` for compatibility. If future requirements want the new public locator to be canonical-only, the legacy fallback should be removed together with report-store regression updates.
- `saveHistoricalDashboardCapture` writes files sequentially and directly to final paths as requested; it is "atomic-enough" for ordered writes but does not use temp-file rename semantics.
