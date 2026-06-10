# 公域日报商品总表接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `npm run public-traffic-report` 自动下载当天商品总表、刷新商品 ID 映射，再生成公域数据日报。

**Architecture:** 复用现有 `downloadGoodsExport` 和商品总表解析逻辑，把映射写入能力从 `refreshProductIdMap` CLI 抽成可复用模块。`publicTrafficReport` 在抓取公域数据前先调用刷新流程，并把商品总表和同步日志写到当天输出目录。

**Tech Stack:** Node.js, TypeScript, Playwright, Vitest, xlsx-js-style.

---

## File Structure

- Create `src/mapping/refreshProductIdMapping.ts`: 复用型商品总表解析、备份、写映射、写同步日志能力。
- Modify `src/cli/refreshProductIdMap.ts`: 改用复用模块，保持独立命令行为。
- Modify `src/publicTraffic/paths.ts`: 增加当天商品总表 XLSX 和商品 ID 映射同步日志路径。
- Modify `src/cli/publicTrafficReport.ts`: 在日报开始时下载商品总表、刷新映射，再加载最新映射。
- Modify `tests/publicTrafficPaths.test.ts`: 覆盖中文商品总表路径。
- Create/modify `tests/refreshProductIdMapping.test.ts`: 覆盖复用模块写映射和拒绝低数量映射。
- Modify `tests/publicTrafficReportCliBehavior.test.ts`: 源码级确认公域日报主流程会先刷新商品总表映射。

## Task 1: Extract Reusable Mapping Refresh

**Files:**
- Create: `src/mapping/refreshProductIdMapping.ts`
- Modify: `src/cli/refreshProductIdMap.ts`
- Create: `tests/refreshProductIdMapping.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/refreshProductIdMapping.test.ts` with tests that mock `parseGoodsExportMapping` by using a small generated XLSX fixture is too heavy; instead export and test a pure `writeProductIdMappingResult` function that accepts a parsed result object.

Test expectations:

```ts
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { writeProductIdMappingResult } from '../src/mapping/refreshProductIdMapping.js';

describe('writeProductIdMappingResult', () => {
  it('writes mapping and sync log', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mt-map-'));
    try {
      const mappingPath = join(dir, 'product-id-map.json');
      const logPath = join(dir, 'sync.log');
      const mapping = Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`platform-${index}`, `internal-${index}`]));

      const count = await writeProductIdMappingResult({
        exportPath: 'goods.xlsx',
        mappingPath,
        logPath,
        result: { mapping, skippedRows: [] },
      });

      expect(count).toBe(50);
      expect(JSON.parse(await readFile(mappingPath, 'utf8'))).toMatchObject({ 'platform-0': 'internal-0' });
      expect(await readFile(logPath, 'utf8')).toContain('source=goods.xlsx');
      expect(await readFile(logPath, 'utf8')).toContain('mappingCount=50');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refuses suspiciously small mapping output', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mt-map-'));
    try {
      await expect(writeProductIdMappingResult({
        exportPath: 'goods.xlsx',
        mappingPath: join(dir, 'product-id-map.json'),
        logPath: join(dir, 'sync.log'),
        result: { mapping: { p1: 'i1' }, skippedRows: [] },
      })).rejects.toThrow('Refusing to write product ID mapping');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- tests/refreshProductIdMapping.test.ts`

Expected: FAIL because `refreshProductIdMapping.js` does not exist.

- [ ] **Step 3: Implement reusable module**

Create `src/mapping/refreshProductIdMapping.ts`:

```ts
import { access, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseGoodsExportMapping, type GoodsExportMappingResult } from './goodsExportMapping.js';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export interface WriteProductIdMappingResultInput {
  exportPath: string;
  mappingPath: string;
  logPath: string;
  result: GoodsExportMappingResult;
}

export async function writeProductIdMappingResult(input: WriteProductIdMappingResultInput): Promise<number> {
  const mappingCount = Object.keys(input.result.mapping).length;
  if (mappingCount < 50) {
    throw new Error(`Refusing to write product ID mapping: only ${mappingCount} mappings parsed from ${input.exportPath}`);
  }

  await mkdir(dirname(input.mappingPath), { recursive: true });
  await mkdir(dirname(input.logPath), { recursive: true });

  if (await exists(input.mappingPath)) {
    await copyFile(input.mappingPath, input.mappingPath.replace(/\.json$/, '.backup.json'));
  }

  await writeFile(input.mappingPath, `${JSON.stringify(input.result.mapping, null, 2)}\n`, 'utf8');

  const log = [
    `source=${input.exportPath}`,
    `mappingPath=${input.mappingPath}`,
    `mappingCount=${mappingCount}`,
    `skippedRows=${input.result.skippedRows.length}`,
    ...input.result.skippedRows.map((row) => `skip row=${row.rowNumber} platformProductId=${row.platformProductId} merchantCode=${row.merchantCode} reason=${row.reason}`),
    '',
  ].join('\n');
  await writeFile(input.logPath, log, 'utf8');

  return mappingCount;
}

export async function writeProductIdMappingFromExport(exportPath: string, mappingPath: string, logPath: string): Promise<number> {
  return writeProductIdMappingResult({ exportPath, mappingPath, logPath, result: parseGoodsExportMapping(exportPath) });
}
```

- [ ] **Step 4: Update refresh CLI**

In `src/cli/refreshProductIdMap.ts`, remove local `exists` and `writeMappingFromExport`, and import:

```ts
import { writeProductIdMappingFromExport } from '../mapping/refreshProductIdMapping.js';
```

Then call:

```ts
const mappingCount = await writeProductIdMappingFromExport(exportPath, mappingPath, logPath);
```

- [ ] **Step 5: Run tests/build**

Run:

```powershell
npm test -- tests/refreshProductIdMapping.test.ts
npm run build
```

Expected: both PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/mapping/refreshProductIdMapping.ts src/cli/refreshProductIdMap.ts tests/refreshProductIdMapping.test.ts
git commit -m "功能：抽取商品ID映射刷新逻辑"
```

## Task 2: Add Daily Goods Export Paths

**Files:**
- Modify: `src/publicTraffic/paths.ts`
- Modify: `tests/publicTrafficPaths.test.ts`

- [ ] **Step 1: Add failing path expectations**

In `tests/publicTrafficPaths.test.ts`, expect:

```ts
expect(paths.goodsExportWorkbook).toBe('output/2026-06-10/商品总表_2026-06-10.xlsx');
expect(paths.productIdMappingSyncLog).toBe('output/2026-06-10/商品ID映射同步日志_2026-06-10.log');
```

- [ ] **Step 2: Run path test to verify failure**

Run: `npm test -- tests/publicTrafficPaths.test.ts`

Expected: FAIL because fields do not exist.

- [ ] **Step 3: Add fields**

In `src/publicTraffic/paths.ts`, add to `PublicTrafficPaths`:

```ts
goodsExportWorkbook: string;
productIdMappingSyncLog: string;
```

In `buildPublicTrafficPaths`, add:

```ts
goodsExportWorkbook: `${dir}/商品总表_${date}.xlsx`,
productIdMappingSyncLog: `${dir}/商品ID映射同步日志_${date}.log`,
```

- [ ] **Step 4: Run test/build**

Run:

```powershell
npm test -- tests/publicTrafficPaths.test.ts
npm run build
```

Expected: both PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/publicTraffic/paths.ts tests/publicTrafficPaths.test.ts
git commit -m "功能：新增商品总表日报路径"
```

## Task 3: Wire Goods Export Into Public Traffic Report

**Files:**
- Modify: `src/cli/publicTrafficReport.ts`
- Modify: `tests/publicTrafficReportCliBehavior.test.ts`

- [ ] **Step 1: Add failing source assertions**

In `tests/publicTrafficReportCliBehavior.test.ts`, add a source test:

```ts
it('refreshes product id mapping from goods export before loading mapping', async () => {
  const source = await readFile(new URL('../src/cli/publicTrafficReport.ts', import.meta.url), 'utf8');

  expect(source).toContain("import { downloadGoodsExport } from '../crawler/goodsExportCrawler.js';");
  expect(source).toContain("import { writeProductIdMappingFromExport } from '../mapping/refreshProductIdMapping.js';");
  expect(source).toContain('await refreshProductIdMappingForReport(config, paths, log);');
  expect(source.indexOf('await refreshProductIdMappingForReport(config, paths, log);')).toBeLessThan(source.indexOf('const mapping = await loadMappingSafely'));
  expect(source).toContain('paths.goodsExportWorkbook');
  expect(source).toContain('paths.productIdMappingSyncLog');
});
```

- [ ] **Step 2: Run behavior test to verify failure**

Run: `npm test -- tests/publicTrafficReportCliBehavior.test.ts`

Expected: FAIL because imports/helper/call do not exist.

- [ ] **Step 3: Implement report refresh helper**

In `src/cli/publicTrafficReport.ts`, import:

```ts
import { downloadGoodsExport } from '../crawler/goodsExportCrawler.js';
import { writeProductIdMappingFromExport } from '../mapping/refreshProductIdMapping.js';
import type { PublicTrafficReportPaths } from '../publicTraffic/types.js';
```

If `PublicTrafficReportPaths` is not the right type for `buildPublicTrafficPaths`, use `ReturnType<typeof buildPublicTrafficPaths>` in the helper instead.

Add helper near `loadMappingSafely`:

```ts
async function refreshProductIdMappingForReport(config: Awaited<ReturnType<typeof loadConfig>>, paths: ReturnType<typeof buildPublicTrafficPaths>, log: ReturnType<typeof createRunLog>): Promise<void> {
  const mappingPath = config.productIdMappingPath ?? 'config/product-id-map.json';
  log.addEvent('开始下载商品总表并刷新商品ID映射');
  const exportPath = await downloadGoodsExport(config, paths.goodsExportWorkbook);
  const mappingCount = await writeProductIdMappingFromExport(exportPath, mappingPath, paths.productIdMappingSyncLog);
  log.addEvent(`商品ID映射已刷新: ${mappingCount} 条, source=${exportPath}`);
}
```

Call after `await mkdir(paths.dir, { recursive: true });` and before `log.addEvent('开始抓取曝光与后链路数据');`:

```ts
await refreshProductIdMappingForReport(config, paths, log);
```

The call should be inside the existing `try` block so failures are logged and fail the report.

- [ ] **Step 4: Run behavior test/build**

Run:

```powershell
npm test -- tests/publicTrafficReportCliBehavior.test.ts
npm run build
```

Expected: both PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/cli/publicTrafficReport.ts tests/publicTrafficReportCliBehavior.test.ts
git commit -m "功能：公域日报自动刷新商品总表映射"
```

## Task 4: Final Verification

**Files:**
- No source changes unless verification fails.

- [ ] **Step 1: Run full tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 2: Run build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 3: Run live workflow**

Run: `npm run public-traffic-report`

Expected:

- Browser downloads goods export first.
- Report completes.
- Feishu sends.
- `output/YYYY-MM-DD/商品总表_YYYY-MM-DD.xlsx` exists.
- `output/YYYY-MM-DD/商品ID映射同步日志_YYYY-MM-DD.log` exists.
- Existing public traffic outputs still exist.

- [ ] **Step 4: Inspect output directory**

Read/list `output/YYYY-MM-DD/` and verify all expected files are present.

- [ ] **Step 5: Final status**

Run: `git status --short --branch`

Expected: clean.

## Self-Review

- Spec coverage: Plan covers reusable mapping refresh, daily Chinese output paths, publicTrafficReport workflow wiring, test/build/live verification.
- Placeholder scan: No placeholder implementation steps remain.
- Type consistency: `buildPublicTrafficPaths` owns new paths; `publicTrafficReport` consumes those paths.
