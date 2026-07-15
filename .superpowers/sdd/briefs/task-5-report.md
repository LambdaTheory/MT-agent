# Task 5 Report: Thread business date through CLI, exact Bot intent, confirmation, and tool execution

## Status

Completed Task 5 input-path migration. No Task 6 card builder, SDK delivery, or HTTP server result-presentation behavior was implemented.

## Scope Implemented

- Migrated dashboard refresh CLI and Feishu agent executor calls from deprecated `{ date }` to canonical `{ dataDate, sendTo }`.
- Defaulted omitted refresh dates to `previousShanghaiDate()` (Asia/Shanghai yesterday), not UTC `today()`.
- Validated explicit refresh dates at input boundaries via `assertDashboardDataDate()` after existing short-date normalization in the agent executor.
- Extended exact Bot intent refresh variant to preserve `date?: string` from existing `parseDateHint()`.
- Preserved refresh intent `date` through dispatcher canonicalization.
- Passed refresh confirmation arguments with both optional `date` and optional `sendTo`.
- Updated confirmation reason copy to state target business data date, `1日、7日、30日`, and possible rebuild/resend.
- Updated runtime registry description and `date` schema description to clarify business data cutoff date, default yesterday, and not report directory date.
- Stabilized one date-dependent existing `feishuBotTools` test that was failing because its closed-order fixture aged out of the current 7-day observation window.

## TDD Evidence

### RED

Ran in target worktree:

```powershell
npm --prefix "C:\works\MT-agent\.claude\worktrees\dated-dashboard-recapture-design" test -- tests/feishuBotIntent.test.ts tests/agentToolExecutorPublicTraffic.test.ts tests/captureDashboardCliSource.test.ts tests/agentRuntimeToolRegistry.test.ts
```

Observed expected failures before production changes:

- `tests/captureDashboardCliSource.test.ts`: CLI source did not contain `previousShanghaiDate`, `assertDashboardDataDate`, or canonical `dataDate`.
- `tests/agentRuntimeToolRegistry.test.ts`: registry still used old refresh description/schema copy.
- `tests/feishuBotIntent.test.ts`: refresh exact command did not preserve `date`.
- `tests/agentToolExecutorPublicTraffic.test.ts`: executor still called `runDashboardRefresh` with `{ date }` and no Shanghai-yesterday default test.

### GREEN

After implementation and one isolated date-dependent test stabilization, ran:

```powershell
npm --prefix "C:\works\MT-agent\.claude\worktrees\dated-dashboard-recapture-design" test -- tests/feishuBotIntent.test.ts tests/feishuBotTools.test.ts tests/agentToolExecutorPublicTraffic.test.ts tests/captureDashboardCliSource.test.ts tests/agentRuntimeToolRegistry.test.ts
```

Result: PASS — 5 files, 155 tests.

Then ran:

```powershell
npm --prefix "C:\works\MT-agent\.claude\worktrees\dated-dashboard-recapture-design" run build
```

Result: PASS — `tsc -p tsconfig.json` completed with no diagnostics.

## Static Checks

Checked the Task 5 refresh input paths for legacy refresh patterns:

- `src/cli/captureDashboard.ts`: no `runDashboardRefresh({ ... date: ... })` and no `?? today()` fallback.
- `src/feishuBot/agentToolExecutor.ts`: the only remaining `?? today()` match is in `system.dataHealth`, not `publicTraffic.refreshDashboard`.

## Files Changed

- `src/cli/captureDashboard.ts`
- `src/feishuBot/types.ts`
- `src/feishuBot/intent.ts`
- `src/feishuBot/dispatcher.ts`
- `src/feishuBot/tools.ts`
- `src/feishuBot/agentToolExecutor.ts`
- `src/agentRuntime/toolRegistry.ts`
- `tests/feishuBotIntent.test.ts`
- `tests/agentToolExecutorPublicTraffic.test.ts`
- `tests/captureDashboardCliSource.test.ts`
- `tests/agentRuntimeToolRegistry.test.ts`
- `tests/feishuBotTools.test.ts` (date-dependent non-Task-5 test stabilization only)

## External Action Boundary

No real Playwright backend capture was run. No Feishu delivery was sent. No PM2 restart was performed. No `.env`, browser profile, external backend, or output data was read or modified.

## Concerns / Notes

- The plan-listed focused suite includes `tests/feishuBotTools.test.ts`; one unrelated closed-order observation test depended on the current calendar date and failed because 2026-07-05/06 fixtures were outside the current 7-day window. I fixed the test by freezing time to 2026-07-07 for that case.
- `DashboardRefreshResult` textual rendering remains the existing temporary text fallback; dedicated result cards and SDK/server presentation are intentionally left for Task 6.
- The deprecated `{ date }` bridge inside `runDashboardRefresh` remains untouched for compatibility until Task 6/removal cleanup.
