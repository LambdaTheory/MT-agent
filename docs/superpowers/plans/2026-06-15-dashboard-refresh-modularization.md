# 访问页补抓与日报重建 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增访问页 `1d/7d/30d` 独立补抓命令，并在首版日报缺失且补抓完整时重建日报和重发飞书。

**Architecture:** 保留 `public-traffic-report` 完整流程不变，只新增访问页质量判定、运行状态文件、基于已有产物的重建函数和补抓编排。补抓命令复用现有 Playwright 登录态和 `collectDashboardPage`，重建复用现有 merge/analyze/report/card 代码。

**Tech Stack:** TypeScript、Node.js fs/promises、Playwright、Vitest、现有 publicTraffic/report/feishu 模块。

---

## File Structure

- Create `src/publicTraffic/dashboardQuality.ts`: 判断访问页 raw 和上下文质量，输出三周期质量摘要。
- Create `src/publicTraffic/publicTrafficRunState.ts`: 读写 `public-traffic-run-state.json`，集中定义状态类型。
- Create `src/publicTraffic/rebuildPublicTrafficReport.ts`: 从当天已有产物和访问页 raw 重建 context/md/xlsx/card。
- Create `src/publicTraffic/dashboardRefresh.ts`: 补抓访问页、判断是否重建重发、更新运行状态。
- Create `src/cli/captureDashboard.ts`: CLI 参数解析和命令输出。
- Modify `src/publicTraffic/paths.ts`: 新增 `publicTrafficRunState`。
- Modify `src/cli/publicTrafficReport.ts`: 首版日报生成后写入运行状态文件；导出必要的日期/发送参数工具。
- Modify `package.json`: 新增 `capture-dashboard` 脚本。
- Tests: `tests/dashboardQuality.test.ts`、`tests/publicTrafficRunState.test.ts`、`tests/rebuildPublicTrafficReport.test.ts`、`tests/dashboardRefresh.test.ts`、`tests/captureDashboardCliSource.test.ts`。

---

### Task 1: 访问页质量判定

**Files:**
- Create: `src/publicTraffic/dashboardQuality.ts`
- Test: `tests/dashboardQuality.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/dashboardQuality.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { RawTableData } from '../src/domain/types.js';
import { assessDashboardQuality, hasDashboardMissingNote } from '../src/publicTraffic/dashboardQuality.js';

function table(period: RawTableData['period'], overrides: Partial<RawTableData> = {}): RawTableData {
  return {
    period,
    headers: ['商品', '访问'],
    rows: [['A', '1']],
    collection: {
      period,
      actualPageSizes: [50],
      pageCount: 1,
      rowCount: 1,
      dedupedRowCount: 1,
      displayedTotalCount: 1,
      pageSizeFallback: false,
      complete: true,
    },
    ...overrides,
  };
}

describe('assessDashboardQuality', () => {
  it('marks all periods complete when raw tables are complete', () => {
    const quality = assessDashboardQuality([table('1d'), table('7d'), table('30d')], []);
    expect(quality.hasMissing).toBe(false);
    expect(quality.periods['1d']).toMatchObject({ complete: true, rowCount: 1 });
    expect(quality.periods['7d']).toMatchObject({ complete: true, rowCount: 1 });
    expect(quality.periods['30d']).toMatchObject({ complete: true, rowCount: 1 });
  });

  it('marks a period missing when collection is incomplete', () => {
    const quality = assessDashboardQuality([table('1d', { collection: { ...table('1d').collection, complete: false } }), table('7d'), table('30d')], []);
    expect(quality.hasMissing).toBe(true);
    expect(quality.periods['1d'].complete).toBe(false);
  });

  it('marks a period missing when rows or headers are empty', () => {
    const quality = assessDashboardQuality([table('1d', { rows: [] }), table('7d', { headers: [] }), table('30d')], []);
    expect(quality.hasMissing).toBe(true);
    expect(quality.periods['1d'].complete).toBe(false);
    expect(quality.periods['7d'].complete).toBe(false);
  });

  it('marks missing periods that are absent from raw tables', () => {
    const quality = assessDashboardQuality([table('1d')], []);
    expect(quality.hasMissing).toBe(true);
    expect(quality.periods['7d'].complete).toBe(false);
    expect(quality.periods['30d'].complete).toBe(false);
  });

  it('detects dashboard missing notes from report context notes', () => {
    expect(hasDashboardMissingNote(['今日访问数据支付宝暂未更新，本期访问量板块指标缺失。'])).toBe(true);
    expect(assessDashboardQuality([table('1d'), table('7d'), table('30d')], ['后链路数据缺失']).hasMissing).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- tests/dashboardQuality.test.ts`

Expected: FAIL because `src/publicTraffic/dashboardQuality.ts` does not exist.

- [ ] **Step 3: Implement dashboard quality module**

Create `src/publicTraffic/dashboardQuality.ts`:

```ts
import type { PeriodKey, RawTableData } from '../domain/types.js';

const PERIODS: PeriodKey[] = ['1d', '7d', '30d'];

export interface DashboardPeriodQuality {
  complete: boolean;
  rowCount: number;
  reason?: string;
}

export interface DashboardQualitySummary {
  hasMissing: boolean;
  periods: Record<PeriodKey, DashboardPeriodQuality>;
  notes: string[];
}

export function hasDashboardMissingNote(notes: string[] | undefined): boolean {
  return (notes ?? []).some((note) => /访问数据|访问页|后链路|访问量板块/.test(note) && /缺失|未更新|失败|跳过/.test(note));
}

function assessPeriod(table: RawTableData | undefined): DashboardPeriodQuality {
  if (!table) return { complete: false, rowCount: 0, reason: 'raw 文件缺失' };
  if (table.collection.complete === false) return { complete: false, rowCount: table.collection.rowCount, reason: 'collection.complete=false' };
  if (table.collection.rowCount === 0) return { complete: false, rowCount: 0, reason: 'rowCount=0' };
  if (table.headers.length === 0) return { complete: false, rowCount: table.collection.rowCount, reason: 'headers 为空' };
  if (table.rows.length === 0) return { complete: false, rowCount: table.collection.rowCount, reason: 'rows 为空' };
  return { complete: true, rowCount: table.collection.rowCount };
}

export function assessDashboardQuality(rawTables: RawTableData[], notes: string[] | undefined): DashboardQualitySummary {
  const byPeriod = new Map(rawTables.map((table) => [table.period, table]));
  const periods = Object.fromEntries(PERIODS.map((period) => [period, assessPeriod(byPeriod.get(period))])) as Record<PeriodKey, DashboardPeriodQuality>;
  return {
    hasMissing: hasDashboardMissingNote(notes) || Object.values(periods).some((period) => !period.complete),
    periods,
    notes: notes ?? [],
  };
}

export function formatDashboardQuality(quality: DashboardQualitySummary): string {
  return PERIODS.map((period) => `${period}=${quality.periods[period].complete ? 'complete' : `missing(${quality.periods[period].reason ?? 'unknown'})`}`).join(', ');
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `npm test -- tests/dashboardQuality.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/publicTraffic/dashboardQuality.ts tests/dashboardQuality.test.ts
git commit -m "功能：新增访问页质量判定"
```

---

### Task 2: 运行状态文件

**Files:**
- Create: `src/publicTraffic/publicTrafficRunState.ts`
- Modify: `src/publicTraffic/paths.ts`
- Test: `tests/publicTrafficRunState.test.ts`, `tests/publicTrafficPaths.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/publicTrafficRunState.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { loadPublicTrafficRunState, savePublicTrafficRunState } from '../src/publicTraffic/publicTrafficRunState.js';

describe('public traffic run state', () => {
  it('returns null for a missing state file and saves readable JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mt-agent-state-'));
    const path = join(dir, 'public-traffic-run-state.json');
    try {
      await expect(loadPublicTrafficRunState(path)).resolves.toBeNull();
      await savePublicTrafficRunState(path, {
        date: '2026-06-15',
        firstReportSent: true,
        firstReportGeneratedAt: '2026-06-15T01:00:00.000Z',
        firstDashboardQuality: {
          hasMissing: false,
          notes: [],
          periods: {
            '1d': { complete: true, rowCount: 1 },
            '7d': { complete: true, rowCount: 1 },
            '30d': { complete: true, rowCount: 1 },
          },
        },
        dashboardRefreshResent: false,
      });
      const loaded = await loadPublicTrafficRunState(path);
      expect(loaded?.date).toBe('2026-06-15');
      expect(loaded?.firstDashboardQuality.hasMissing).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
```

Modify `tests/publicTrafficPaths.test.ts` to assert:

```ts
expect(buildPublicTrafficPaths('output', '2026-06-15').publicTrafficRunState).toBe('output/2026-06-15/public-traffic-run-state.json');
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/publicTrafficRunState.test.ts tests/publicTrafficPaths.test.ts`

Expected: FAIL because run state module and path do not exist.

- [ ] **Step 3: Implement run state module and path**

Add `publicTrafficRunState` to `PublicTrafficPaths` and `buildPublicTrafficPaths` in `src/publicTraffic/paths.ts`:

```ts
publicTrafficRunState: `${dir}/public-traffic-run-state.json`,
```

Create `src/publicTraffic/publicTrafficRunState.ts`:

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { DashboardQualitySummary } from './dashboardQuality.js';

export interface PublicTrafficRunState {
  date: string;
  firstReportSent: boolean;
  firstReportGeneratedAt: string;
  firstDashboardQuality: DashboardQualitySummary;
  dashboardRefreshResent: boolean;
  dashboardRefreshResentAt?: string;
  dashboardRefreshDecision?: 'saved_raw_only' | 'rebuilt_and_resent' | 'first_report_complete' | 'refresh_still_missing' | 'already_resent';
}

export async function loadPublicTrafficRunState(path: string): Promise<PublicTrafficRunState | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as PublicTrafficRunState;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function savePublicTrafficRunState(path: string, state: PublicTrafficRunState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- tests/publicTrafficRunState.test.ts tests/publicTrafficPaths.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/publicTraffic/publicTrafficRunState.ts src/publicTraffic/paths.ts tests/publicTrafficRunState.test.ts tests/publicTrafficPaths.test.ts
git commit -m "功能：记录公域日报运行状态"
```

---

### Task 3: 基于已有产物重建日报

**Files:**
- Create: `src/publicTraffic/rebuildPublicTrafficReport.ts`
- Test: `tests/rebuildPublicTrafficReport.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/rebuildPublicTrafficReport.test.ts` with temp output files for one product. Assert rebuilt context keeps `newProductPoolItems`, keeps `agentData.removedLinks`, removes dashboard missing note, and writes markdown/workbook/context.

Use this focused assertion shape:

```ts
expect(context.dataQualityNotes).toContain('访问页数据已于 12:00 补抓更新，本报告为重建版。');
expect(context.dataQualityNotes?.some((note) => note.includes('暂未更新'))).toBe(false);
expect(context.newProductPoolItems?.[0]?.productId).toBe('101');
expect(context.agentData?.removedLinks[0]?.productId).toBe('900');
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- tests/rebuildPublicTrafficReport.test.ts`

Expected: FAIL because rebuild module does not exist.

- [ ] **Step 3: Implement rebuild function**

Create `src/publicTraffic/rebuildPublicTrafficReport.ts` with exported function:

```ts
export interface RebuildPublicTrafficReportInput {
  outputDir: string;
  date: string;
  productIdMappingPath?: string;
  refreshedAt?: string;
  sendTo?: 'personal' | 'group' | 'both';
  send?: boolean;
}

export interface RebuildPublicTrafficReportResult {
  context: PublicTrafficDataReportContext;
  markdownPath: string;
  workbookPath: string;
  sent: boolean;
  sendReason?: string;
}
```

Implementation requirements:

- Read paths from `buildPublicTrafficPaths(input.outputDir, input.date)`.
- Load prior context from `paths.reportContext`.
- Load three dashboard raw files from `paths.publicVisitRaw`.
- Normalize with `normalizeDashboardRowsForReport(rawTables, log)` or equivalent exported helper.
- Load mapping with `loadProductIdMapping(input.productIdMappingPath)` when configured, otherwise `{}`.
- Load exposure files and order analysis.
- Call `mergePublicTrafficData` and `analyzePublicTrafficData`.
- Preserve prior `newProductPoolItems`, `newProductPoolIds`, and `agentData`.
- Filter old dashboard missing notes and append rebuild note.
- Write `paths.reportContext`, `paths.markdown`, `paths.workbook`.
- If `send=true`, build card/text and call `sendFeishuCard` with `FEISHU_SEND_TO` override when provided.

- [ ] **Step 4: Run test to verify pass**

Run: `npm test -- tests/rebuildPublicTrafficReport.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/publicTraffic/rebuildPublicTrafficReport.ts tests/rebuildPublicTrafficReport.test.ts
git commit -m "功能：支持基于产物重建公域日报"
```

---

### Task 4: 访问页补抓编排

**Files:**
- Create: `src/publicTraffic/dashboardRefresh.ts`
- Test: `tests/dashboardRefresh.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/dashboardRefresh.test.ts` with dependency injection for capture/rebuild/send decisions:

```ts
import { describe, expect, it, vi } from 'vitest';
import { decideDashboardRefreshAction } from '../src/publicTraffic/dashboardRefresh.js';

const complete = { hasMissing: false, notes: [], periods: { '1d': { complete: true, rowCount: 1 }, '7d': { complete: true, rowCount: 1 }, '30d': { complete: true, rowCount: 1 } } };
const missing = { hasMissing: true, notes: ['后链路数据缺失'], periods: { '1d': { complete: false, rowCount: 0 }, '7d': { complete: true, rowCount: 1 }, '30d': { complete: true, rowCount: 1 } } };

describe('decideDashboardRefreshAction', () => {
  it('saves raw only when first report is complete', () => {
    expect(decideDashboardRefreshAction({ firstQuality: complete, refreshQuality: complete, alreadyResent: false })).toBe('first_report_complete');
  });

  it('saves raw only when refresh is still missing', () => {
    expect(decideDashboardRefreshAction({ firstQuality: missing, refreshQuality: missing, alreadyResent: false })).toBe('refresh_still_missing');
  });

  it('rebuilds and resends when first report is missing and refresh is complete', () => {
    expect(decideDashboardRefreshAction({ firstQuality: missing, refreshQuality: complete, alreadyResent: false })).toBe('rebuilt_and_resent');
  });

  it('does not resend again after a successful refresh resend', () => {
    expect(decideDashboardRefreshAction({ firstQuality: missing, refreshQuality: complete, alreadyResent: true })).toBe('already_resent');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- tests/dashboardRefresh.test.ts`

Expected: FAIL because dashboard refresh module does not exist.

- [ ] **Step 3: Implement refresh decision and orchestration**

Create `src/publicTraffic/dashboardRefresh.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import type { AgentConfig, RawTableData } from '../domain/types.js';
import { clearBrowserProfileLocks, prepareDashboardPage } from '../crawler/browserProfile.js';
import { collectDashboardPage } from '../crawler/dashboardCrawler.js';
import { shouldKeepBrowserOpenOnFailure } from '../crawler/failureHandling.js';
import { buildPublicTrafficPaths } from './paths.js';
import { assessDashboardQuality, type DashboardQualitySummary, formatDashboardQuality } from './dashboardQuality.js';
import { loadPublicTrafficRunState, savePublicTrafficRunState } from './publicTrafficRunState.js';
import { rebuildPublicTrafficReport } from './rebuildPublicTrafficReport.js';

export type DashboardRefreshDecision = 'first_report_complete' | 'refresh_still_missing' | 'rebuilt_and_resent' | 'already_resent';

export function decideDashboardRefreshAction(input: { firstQuality: DashboardQualitySummary; refreshQuality: DashboardQualitySummary; alreadyResent: boolean }): DashboardRefreshDecision {
  if (input.alreadyResent) return 'already_resent';
  if (!input.firstQuality.hasMissing) return 'first_report_complete';
  if (input.refreshQuality.hasMissing) return 'refresh_still_missing';
  return 'rebuilt_and_resent';
}
```

Then add `captureDashboardRawTables(config)` that opens browser, calls `collectDashboardPage(config, page)`, and closes browser with the same failure policy as `crawlPublicTrafficSources`.

Then add `runDashboardRefresh({ config, date, sendTo })` that:

- Captures raw tables.
- Writes `paths.publicVisitRaw[period]` for each table.
- Assesses refresh quality.
- Loads state; if missing, derive first quality from refresh quality and save raw-only decision.
- Calls `decideDashboardRefreshAction`.
- Calls `rebuildPublicTrafficReport({ outputDir: config.outputDir, date, productIdMappingPath: config.productIdMappingPath, send: true, sendTo })` only when decision is `rebuilt_and_resent`.
- Updates state decision and `dashboardRefreshResent`.
- Returns printable result.

- [ ] **Step 4: Run test to verify pass**

Run: `npm test -- tests/dashboardRefresh.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/publicTraffic/dashboardRefresh.ts tests/dashboardRefresh.test.ts
git commit -m "功能：新增访问页补抓决策编排"
```

---

### Task 5: CLI 和首版状态接入

**Files:**
- Create: `src/cli/captureDashboard.ts`
- Modify: `src/cli/publicTrafficReport.ts`
- Modify: `package.json`
- Test: `tests/captureDashboardCliSource.test.ts`, `tests/publicTrafficReportCliBehavior.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/captureDashboardCliSource.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('capture dashboard cli source', () => {
  it('loads env/config and calls dashboard refresh', () => {
    const source = readFileSync('src/cli/captureDashboard.ts', 'utf8');
    expect(source).toContain('loadEnv');
    expect(source).toContain('loadConfig');
    expect(source).toContain('runDashboardRefresh');
    expect(source).toContain('--date');
    expect(source).toContain('--send-to');
  });

  it('package exposes capture-dashboard script', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.scripts['capture-dashboard']).toBe('tsx src/cli/captureDashboard.ts');
  });
});
```

Extend existing public traffic CLI behavior test to verify `publicTrafficReport.ts` writes `savePublicTrafficRunState` after report generation.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/captureDashboardCliSource.test.ts tests/publicTrafficReportCliBehavior.test.ts`

Expected: FAIL because CLI and script do not exist.

- [ ] **Step 3: Implement CLI and state writing**

Create `src/cli/captureDashboard.ts`:

```ts
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../config/loadConfig.js';
import { loadEnv } from '../config/loadEnv.js';
import { runDashboardRefresh } from '../publicTraffic/dashboardRefresh.js';

type FeishuSendTo = 'personal' | 'group' | 'both';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseArgValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : argv.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
}

function parseSendTo(argv: string[]): FeishuSendTo | undefined {
  const value = parseArgValue(argv, '--send-to');
  if (!value) return undefined;
  if (value === 'personal' || value === 'group' || value === 'both') return value;
  throw new Error(`Invalid --send-to value: ${value}. Expected personal, group, or both.`);
}

export async function runCaptureDashboardCli(argv = process.argv.slice(2)): Promise<void> {
  await loadEnv();
  const config = await loadConfig();
  const result = await runDashboardRefresh({ config, date: parseArgValue(argv, '--date') ?? today(), sendTo: parseSendTo(argv) });
  console.log(`访问页补抓完成: ${result.refreshQualityText}`);
  console.log(`首版日报访问页状态: ${result.firstQualityText}`);
  console.log(`决策: ${result.message}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCaptureDashboardCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
```

Add package script:

```json
"capture-dashboard": "tsx src/cli/captureDashboard.ts"
```

In `src/cli/publicTrafficReport.ts`, after `sendFeishuCardSafely`, save run state with `assessDashboardQuality(rawTables, context.dataQualityNotes)` and `savePublicTrafficRunState(paths.publicTrafficRunState, state)`.

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- tests/captureDashboardCliSource.test.ts tests/publicTrafficReportCliBehavior.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/cli/captureDashboard.ts src/cli/publicTrafficReport.ts package.json tests/captureDashboardCliSource.test.ts tests/publicTrafficReportCliBehavior.test.ts
git commit -m "功能：接入访问页补抓命令"
```

---

### Task 6: Final Verification

**Files:**
- All touched files

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- tests/dashboardQuality.test.ts tests/publicTrafficRunState.test.ts tests/rebuildPublicTrafficReport.test.ts tests/dashboardRefresh.test.ts tests/captureDashboardCliSource.test.ts tests/publicTrafficPaths.test.ts tests/publicTrafficReportCliBehavior.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Run master-scoped full test suite**

Run:

```bash
npm test -- --exclude ".worktrees/**"
```

Expected: all tests pass.

- [ ] **Step 3: Run TypeScript build**

Run:

```bash
npm run build
```

Expected: build exits 0.

- [ ] **Step 4: Inspect git status and log**

Run:

```bash
git status --short --branch
git log --oneline --decorate -8
```

Expected: branch is `feature/dashboard-refresh-modularization`; status is clean after final commit.

- [ ] **Step 5: Commit final fixes if needed**

If verification required fixes, commit them:

```bash
git add <fixed-files>
git commit -m "修正：完善访问页补抓验证"
```

If no fixes are needed, do not create an empty commit.
