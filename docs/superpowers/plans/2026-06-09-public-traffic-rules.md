# 公域流量规则分析 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为公域流量日报新增轻量可配置规则分析，让曝光优化、转化优化、新品观察、生命周期治理四个模块输出稳定候选。

**Architecture:** 新增规则配置、规则分析、近期日差分加载三个小模块，并在 `publicTrafficReport` CLI 生成日差分后串联 7/30 聚合和规则分析。分析模块只处理数据，不读写文件；CLI 负责文件读写、日志和报告生成。

**Tech Stack:** Node.js, TypeScript, Vitest, existing publicTraffic modules, Playwright live crawler already wired.

---

## File Structure

- Create `src/publicTraffic/rulesConfig.ts`: 默认阈值、配置类型、JSON 读取和运行时校验。
- Create `src/publicTraffic/analyzePublicTraffic.ts`: 纯函数规则分析，输出四个 `PublicTrafficReportSectionItem[]`。
- Create `src/publicTraffic/recentExposureDeltas.ts`: 从 `output/public-traffic/YYYY-MM-DD/` 读取近 N 日日差分，缺失跳过、损坏失败。
- Modify `src/cli/publicTrafficReport.ts`: 串联规则配置、7/30 聚合、汇总文件写入和 report context 填充。
- Create `config/public-traffic-rules.example.json`: 可复制的中文备注配置样例。
- Test `tests/publicTrafficRulesConfig.test.ts`: 配置默认值、合并和校验。
- Test `tests/analyzePublicTraffic.test.ts`: 四类规则候选生成。
- Test `tests/recentExposureDeltas.test.ts`: 近期日差分加载。
- Test `tests/publicTrafficReportRulesSource.test.ts`: CLI 已写入 7/30 汇总并调用规则分析的轻量回归测试。

## Task 1: Rules Config

**Files:**
- Create: `src/publicTraffic/rulesConfig.ts`
- Create: `tests/publicTrafficRulesConfig.test.ts`
- Create: `config/public-traffic-rules.example.json`

- [ ] **Step 1: Write failing tests**

Create `tests/publicTrafficRulesConfig.test.ts`:

```ts
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG, loadPublicTrafficRulesConfig } from '../src/publicTraffic/rulesConfig.js';

describe('loadPublicTrafficRulesConfig', () => {
  it('uses defaults when config file is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mt-rules-'));
    try {
      await expect(loadPublicTrafficRulesConfig(join(dir, 'missing.json'))).resolves.toEqual(DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('merges partial config with defaults', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mt-rules-'));
    const path = join(dir, 'rules.json');
    try {
      await writeFile(path, JSON.stringify({ topN: 3, exposureOptimization: { highExposure: 500 } }), 'utf8');
      const config = await loadPublicTrafficRulesConfig(path);
      expect(config.topN).toBe(3);
      expect(config.exposureOptimization.highExposure).toBe(500);
      expect(config.exposureOptimization.lowVisitRate).toBe(DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG.exposureOptimization.lowVisitRate);
      expect(config.conversionOptimization.minVisits).toBe(DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG.conversionOptimization.minVisits);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects invalid values', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mt-rules-'));
    const path = join(dir, 'rules.json');
    try {
      await writeFile(path, JSON.stringify({ topN: 0, exposureOptimization: { lowVisitRate: 2 } }), 'utf8');
      await expect(loadPublicTrafficRulesConfig(path)).rejects.toThrow(/Invalid public traffic rules config/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/publicTrafficRulesConfig.test.ts`

Expected: FAIL because `../src/publicTraffic/rulesConfig.js` does not exist.

- [ ] **Step 3: Implement config loader**

Create `src/publicTraffic/rulesConfig.ts`:

```ts
import { readFile } from 'node:fs/promises';

export interface PublicTrafficRulesConfig {
  topN: number;
  exposureOptimization: {
    highExposure: number;
    lowVisitRate: number;
    lowExposure: number;
    potentialVisits: number;
    potentialAmount: number;
  };
  conversionOptimization: {
    minVisits: number;
    weakAmount: number;
    minExposure: number;
  };
  newProductObservation: {
    lowExposure: number;
    zeroVisitMaxExposure: number;
  };
  lifecycleGovernance: {
    minCustodyDays: number;
    weak30dExposure: number;
    weak30dVisits: number;
    weak30dAmount: number;
  };
}

export const DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG: PublicTrafficRulesConfig = {
  topN: 5,
  exposureOptimization: {
    highExposure: 1000,
    lowVisitRate: 0.01,
    lowExposure: 50,
    potentialVisits: 3,
    potentialAmount: 1,
  },
  conversionOptimization: {
    minVisits: 5,
    weakAmount: 1,
    minExposure: 100,
  },
  newProductObservation: {
    lowExposure: 20,
    zeroVisitMaxExposure: 100,
  },
  lifecycleGovernance: {
    minCustodyDays: 30,
    weak30dExposure: 100,
    weak30dVisits: 3,
    weak30dAmount: 1,
  },
};

const DEFAULT_RULES_CONFIG_PATH = 'config/public-traffic-rules.json';

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function mergeSection<T extends Record<string, number>>(defaults: T, override: unknown): T {
  if (!isObject(override)) return defaults;
  return { ...defaults, ...Object.fromEntries(Object.entries(override).filter(([, value]) => typeof value === 'number')) } as T;
}

function assertFiniteNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid public traffic rules config: ${name} must be a finite non-negative number`);
  }
}

function validateConfig(config: PublicTrafficRulesConfig): void {
  if (!Number.isInteger(config.topN) || config.topN <= 0) {
    throw new Error('Invalid public traffic rules config: topN must be a positive integer');
  }

  for (const [sectionName, section] of Object.entries(config)) {
    if (sectionName === 'topN') continue;
    for (const [key, value] of Object.entries(section)) {
      assertFiniteNonNegative(`${sectionName}.${key}`, value);
    }
  }

  if (config.exposureOptimization.lowVisitRate > 1) {
    throw new Error('Invalid public traffic rules config: exposureOptimization.lowVisitRate must be between 0 and 1');
  }
}

export async function loadPublicTrafficRulesConfig(path = DEFAULT_RULES_CONFIG_PATH): Promise<PublicTrafficRulesConfig> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG;
    }
    throw error;
  }

  if (!isObject(parsed)) {
    throw new Error('Invalid public traffic rules config: root must be an object');
  }

  const config: PublicTrafficRulesConfig = {
    topN: typeof parsed.topN === 'number' ? parsed.topN : DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG.topN,
    exposureOptimization: mergeSection(DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG.exposureOptimization, parsed.exposureOptimization),
    conversionOptimization: mergeSection(DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG.conversionOptimization, parsed.conversionOptimization),
    newProductObservation: mergeSection(DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG.newProductObservation, parsed.newProductObservation),
    lifecycleGovernance: mergeSection(DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG.lifecycleGovernance, parsed.lifecycleGovernance),
  };

  validateConfig(config);
  return config;
}
```

- [ ] **Step 4: Add example config**

Create `config/public-traffic-rules.example.json`:

```json
{
  "topN": 5,
  "exposureOptimization": {
    "highExposure": 1000,
    "lowVisitRate": 0.01,
    "lowExposure": 50,
    "potentialVisits": 3,
    "potentialAmount": 1
  },
  "conversionOptimization": {
    "minVisits": 5,
    "weakAmount": 1,
    "minExposure": 100
  },
  "newProductObservation": {
    "lowExposure": 20,
    "zeroVisitMaxExposure": 100
  },
  "lifecycleGovernance": {
    "minCustodyDays": 30,
    "weak30dExposure": 100,
    "weak30dVisits": 3,
    "weak30dAmount": 1
  }
}
```

- [ ] **Step 5: Run tests and build**

Run: `npm test -- tests/publicTrafficRulesConfig.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/publicTraffic/rulesConfig.ts tests/publicTrafficRulesConfig.test.ts config/public-traffic-rules.example.json
git commit -m "功能：新增公域流量规则配置"
```

## Task 2: Rule Analysis Module

**Files:**
- Create: `src/publicTraffic/analyzePublicTraffic.ts`
- Create: `tests/analyzePublicTraffic.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/analyzePublicTraffic.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { analyzePublicTraffic } from '../src/publicTraffic/analyzePublicTraffic.js';
import { DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG } from '../src/publicTraffic/rulesConfig.js';
import type { ExposureCumulativeProduct, ExposureDailyDelta, ExposureProductSummary } from '../src/publicTraffic/types.js';

function delta(overrides: Partial<ExposureDailyDelta>): ExposureDailyDelta {
  return {
    date: '2026-06-09',
    productName: '商品',
    platformProductId: '20260603220003308013234',
    exposure: 0,
    visits: 0,
    amount: 0,
    custodyDays: null,
    flags: [],
    ...overrides,
  };
}

function summary(overrides: Partial<ExposureProductSummary>): ExposureProductSummary {
  return {
    productName: '商品',
    platformProductId: '20260603220003308013234',
    exposure: 0,
    visits: 0,
    amount: 0,
    visitRate: 0,
    days: 7,
    flags: [],
    ...overrides,
  };
}

function cumulative(overrides: Partial<ExposureCumulativeProduct>): ExposureCumulativeProduct {
  return {
    productName: '商品',
    platformProductId: '20260603220003308013234',
    exposure: 0,
    visits: 0,
    amount: 0,
    custodyDays: null,
    raw: {},
    ...overrides,
  };
}

describe('analyzePublicTraffic', () => {
  it('creates exposure optimization candidates', () => {
    const result = analyzePublicTraffic({
      date: '2026-06-09',
      dailyDelta: [],
      sevenDaySummary: [summary({ platformProductId: 'high-low', productName: '高曝低访', exposure: 2000, visits: 10, visitRate: 0.005 })],
      thirtyDaySummary: [],
      cumulativeProducts: [],
      config: DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG,
    });

    expect(result.exposureOptimization[0]).toMatchObject({
      identifier: '平台商品ID high-low',
      action: '曝光优化',
    });
    expect(result.exposureOptimization[0]?.reason).toContain('访问率');
  });

  it('creates conversion optimization candidates', () => {
    const result = analyzePublicTraffic({
      date: '2026-06-09',
      dailyDelta: [],
      sevenDaySummary: [summary({ platformProductId: 'visit-no-amount', productName: '有访无成交', exposure: 300, visits: 20, amount: 0, visitRate: 0.066 })],
      thirtyDaySummary: [],
      cumulativeProducts: [],
      config: DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG,
    });

    expect(result.conversionOptimization[0]).toMatchObject({
      identifier: '平台商品ID visit-no-amount',
      action: '转化优化',
    });
    expect(result.conversionOptimization[0]?.reason).toContain('金额 0');
  });

  it('creates new product observation candidates', () => {
    const result = analyzePublicTraffic({
      date: '2026-06-09',
      dailyDelta: [delta({ platformProductId: 'new-low', productName: '新品低曝', exposure: 5, visits: 0, flags: ['new_product'] })],
      sevenDaySummary: [],
      thirtyDaySummary: [],
      cumulativeProducts: [],
      config: DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG,
    });

    expect(result.newProductObservation[0]).toMatchObject({
      identifier: '平台商品ID new-low',
      action: '新品观察',
    });
    expect(result.newProductObservation[0]?.reason).toContain('新品');
  });

  it('creates lifecycle governance candidates only when custody days are present', () => {
    const result = analyzePublicTraffic({
      date: '2026-06-09',
      dailyDelta: [],
      sevenDaySummary: [],
      thirtyDaySummary: [summary({ platformProductId: 'old-weak', productName: '老品弱表现', exposure: 20, visits: 1, amount: 0 })],
      cumulativeProducts: [cumulative({ platformProductId: 'old-weak', productName: '老品弱表现', custodyDays: 45 }), cumulative({ platformProductId: 'unknown-days', custodyDays: null })],
      config: DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG,
    });

    expect(result.lifecycleGovernance).toHaveLength(1);
    expect(result.lifecycleGovernance[0]).toMatchObject({
      identifier: '平台商品ID old-weak',
      action: '生命周期治理',
    });
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/analyzePublicTraffic.test.ts`

Expected: FAIL because `../src/publicTraffic/analyzePublicTraffic.js` does not exist.

- [ ] **Step 3: Implement analysis module**

Create `src/publicTraffic/analyzePublicTraffic.ts`:

```ts
import type { PublicTrafficRulesConfig } from './rulesConfig.js';
import type { ExposureCumulativeProduct, ExposureDailyDelta, ExposureProductSummary, PublicTrafficReportSectionItem } from './types.js';

export interface AnalyzePublicTrafficInput {
  date: string;
  dailyDelta: ExposureDailyDelta[];
  sevenDaySummary: ExposureProductSummary[];
  thirtyDaySummary: ExposureProductSummary[];
  cumulativeProducts: ExposureCumulativeProduct[];
  config: PublicTrafficRulesConfig;
}

export interface AnalyzePublicTrafficResult {
  exposureOptimization: PublicTrafficReportSectionItem[];
  conversionOptimization: PublicTrafficReportSectionItem[];
  newProductObservation: PublicTrafficReportSectionItem[];
  lifecycleGovernance: PublicTrafficReportSectionItem[];
}

function identifier(platformProductId: string): string {
  return `平台商品ID ${platformProductId}`;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function topN<T>(rows: T[], n: number): T[] {
  return rows.slice(0, n);
}

function exposureOptimization(input: AnalyzePublicTrafficInput): PublicTrafficReportSectionItem[] {
  const rules = input.config.exposureOptimization;
  const candidates = input.sevenDaySummary
    .filter((row) => !row.flags.includes('missing'))
    .flatMap((row) => {
      if (row.exposure >= rules.highExposure && row.visitRate <= rules.lowVisitRate) {
        return [{ row, score: row.exposure * (rules.lowVisitRate - row.visitRate + 0.0001), reason: `7日曝光 ${row.exposure}，访问率 ${percent(row.visitRate)}，低于阈值 ${percent(rules.lowVisitRate)}` }];
      }
      if (row.exposure <= rules.lowExposure && (row.visits >= rules.potentialVisits || row.amount >= rules.potentialAmount)) {
        return [{ row, score: row.amount * 100 + row.visits, reason: `7日曝光 ${row.exposure} 偏低，但访问 ${row.visits}、金额 ${row.amount.toFixed(2)} 显示有潜力` }];
      }
      return [];
    })
    .sort((a, b) => b.score - a.score);

  return topN(candidates, input.config.topN).map(({ row, reason }) => ({ identifier: identifier(row.platformProductId), action: '曝光优化', reason }));
}

function conversionOptimization(input: AnalyzePublicTrafficInput): PublicTrafficReportSectionItem[] {
  const rules = input.config.conversionOptimization;
  const candidates = input.sevenDaySummary
    .filter((row) => !row.flags.includes('missing'))
    .filter((row) => row.visits >= rules.minVisits && row.exposure >= rules.minExposure && row.amount <= rules.weakAmount)
    .sort((a, b) => b.visits - a.visits || b.exposure - a.exposure);

  return topN(candidates, input.config.topN).map((row) => ({
    identifier: identifier(row.platformProductId),
    action: '转化优化',
    reason: `7日曝光 ${row.exposure}，访问 ${row.visits}，金额 ${row.amount.toFixed(2)}，低于弱成交阈值 ${rules.weakAmount}`,
  }));
}

function newProductObservation(input: AnalyzePublicTrafficInput): PublicTrafficReportSectionItem[] {
  const rules = input.config.newProductObservation;
  const candidates = input.dailyDelta
    .filter((row) => row.flags.includes('new_product'))
    .filter((row) => row.exposure <= rules.lowExposure || (row.exposure <= rules.zeroVisitMaxExposure && row.visits === 0))
    .sort((a, b) => a.exposure - b.exposure || a.visits - b.visits);

  return topN(candidates, input.config.topN).map((row) => ({
    identifier: identifier(row.platformProductId),
    action: '新品观察',
    reason: `新品今日进入公域快照，曝光 ${row.exposure}，访问 ${row.visits}，建议继续观察`,
  }));
}

function lifecycleGovernance(input: AnalyzePublicTrafficInput): PublicTrafficReportSectionItem[] {
  const rules = input.config.lifecycleGovernance;
  const summaryById = new Map(input.thirtyDaySummary.map((row) => [row.platformProductId, row]));
  const candidates = input.cumulativeProducts
    .filter((row) => typeof row.custodyDays === 'number' && row.custodyDays >= rules.minCustodyDays)
    .map((row) => ({ cumulative: row, summary: summaryById.get(row.platformProductId) }))
    .filter(({ summary }) => Boolean(summary && summary.exposure <= rules.weak30dExposure && summary.visits <= rules.weak30dVisits && summary.amount <= rules.weak30dAmount))
    .sort((a, b) => (b.cumulative.custodyDays ?? 0) - (a.cumulative.custodyDays ?? 0) || (a.summary?.exposure ?? 0) - (b.summary?.exposure ?? 0));

  return topN(candidates, input.config.topN).map(({ cumulative, summary }) => ({
    identifier: identifier(cumulative.platformProductId),
    action: '生命周期治理',
    reason: `已托管 ${cumulative.custodyDays} 天，30日曝光 ${summary?.exposure ?? 0}，访问 ${summary?.visits ?? 0}，金额 ${(summary?.amount ?? 0).toFixed(2)}，表现偏弱`,
  }));
}

export function analyzePublicTraffic(input: AnalyzePublicTrafficInput): AnalyzePublicTrafficResult {
  return {
    exposureOptimization: exposureOptimization(input),
    conversionOptimization: conversionOptimization(input),
    newProductObservation: newProductObservation(input),
    lifecycleGovernance: lifecycleGovernance(input),
  };
}
```

- [ ] **Step 4: Run tests and build**

Run: `npm test -- tests/analyzePublicTraffic.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/publicTraffic/analyzePublicTraffic.ts tests/analyzePublicTraffic.test.ts
git commit -m "功能：新增公域流量规则分析"
```

## Task 3: Recent Exposure Delta Loading

**Files:**
- Create: `src/publicTraffic/recentExposureDeltas.ts`
- Create: `tests/recentExposureDeltas.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/recentExposureDeltas.test.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { loadRecentExposureDeltas } from '../src/publicTraffic/recentExposureDeltas.js';
import { buildPublicTrafficPaths } from '../src/publicTraffic/paths.js';

async function writeDelta(outputDir: string, date: string, id: string): Promise<void> {
  const paths = buildPublicTrafficPaths(outputDir, date);
  await mkdir(paths.dir, { recursive: true });
  await writeFile(
    paths.exposureDailyDelta,
    JSON.stringify([{ date, productName: '商品', platformProductId: id, exposure: 1, visits: 1, amount: 0, custodyDays: null, flags: [] }]),
    'utf8',
  );
}

describe('loadRecentExposureDeltas', () => {
  it('loads available dates and skips missing dates', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-deltas-'));
    try {
      await writeDelta(outputDir, '2026-06-09', 'today');
      await writeDelta(outputDir, '2026-06-07', 'two-days-ago');
      const rows = await loadRecentExposureDeltas(outputDir, '2026-06-09', 3);
      expect(rows.map((row) => row.platformProductId)).toEqual(['today', 'two-days-ago']);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it('rejects corrupt existing delta files', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-deltas-'));
    try {
      const paths = buildPublicTrafficPaths(outputDir, '2026-06-09');
      await mkdir(paths.dir, { recursive: true });
      await writeFile(paths.exposureDailyDelta, '[{"foo":1}]', 'utf8');
      await expect(loadRecentExposureDeltas(outputDir, '2026-06-09', 1)).rejects.toThrow(/Invalid exposure daily delta/);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/recentExposureDeltas.test.ts`

Expected: FAIL because `../src/publicTraffic/recentExposureDeltas.js` does not exist.

- [ ] **Step 3: Implement recent delta loader**

Create `src/publicTraffic/recentExposureDeltas.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { buildPublicTrafficPaths } from './paths.js';
import type { ExposureDailyDelta, ExposureDeltaFlag } from './types.js';

const VALID_FLAGS = new Set<ExposureDeltaFlag>(['new_product', 'missing', 'counter_reset_or_data_error']);

function dateBefore(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function isExposureDailyDelta(value: unknown): value is ExposureDailyDelta {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.date === 'string' &&
    typeof row.productName === 'string' &&
    typeof row.platformProductId === 'string' &&
    typeof row.exposure === 'number' &&
    typeof row.visits === 'number' &&
    typeof row.amount === 'number' &&
    (typeof row.custodyDays === 'number' || row.custodyDays === null) &&
    Array.isArray(row.flags) &&
    row.flags.every((flag) => typeof flag === 'string' && VALID_FLAGS.has(flag as ExposureDeltaFlag))
  );
}

export function parseExposureDailyDeltaSnapshot(text: string): ExposureDailyDelta[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed) || !parsed.every(isExposureDailyDelta)) {
    throw new Error('Invalid exposure daily delta: expected ExposureDailyDelta[]');
  }
  return parsed;
}

export async function loadRecentExposureDeltas(outputDir: string, endDate: string, days: number): Promise<ExposureDailyDelta[]> {
  const rows: ExposureDailyDelta[] = [];

  for (let offset = 0; offset < days; offset += 1) {
    const date = dateBefore(endDate, offset);
    const paths = buildPublicTrafficPaths(outputDir, date);
    try {
      rows.push(...parseExposureDailyDeltaSnapshot(await readFile(paths.exposureDailyDelta, 'utf8')));
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        continue;
      }
      throw error;
    }
  }

  return rows;
}
```

- [ ] **Step 4: Run tests and build**

Run: `npm test -- tests/recentExposureDeltas.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/publicTraffic/recentExposureDeltas.ts tests/recentExposureDeltas.test.ts
git commit -m "功能：读取公域曝光近期日差分"
```

## Task 4: Wire Rules Into Public Traffic CLI

**Files:**
- Modify: `src/cli/publicTrafficReport.ts`
- Create: `tests/publicTrafficReportRulesSource.test.ts`

- [ ] **Step 1: Write failing source-level integration test**

Create `tests/publicTrafficReportRulesSource.test.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('publicTrafficReport rules wiring', () => {
  it('loads recent deltas, writes summaries, and fills report sections from analysis', async () => {
    const source = await readFile(new URL('../src/cli/publicTrafficReport.ts', import.meta.url), 'utf8');

    expect(source).toContain("import { analyzePublicTraffic } from '../publicTraffic/analyzePublicTraffic.js';");
    expect(source).toContain("import { loadPublicTrafficRulesConfig } from '../publicTraffic/rulesConfig.js';");
    expect(source).toContain("import { loadRecentExposureDeltas } from '../publicTraffic/recentExposureDeltas.js';");
    expect(source).toContain('aggregateExposureDeltas(sevenDayDeltas)');
    expect(source).toContain('aggregateExposureDeltas(thirtyDayDeltas)');
    expect(source).toContain('paths.exposure7dSummary');
    expect(source).toContain('paths.exposure30dSummary');
    expect(source).toContain('analysis.exposureOptimization');
    expect(source).toContain('analysis.conversionOptimization');
    expect(source).toContain('analysis.newProductObservation');
    expect(source).toContain('analysis.lifecycleGovernance');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- tests/publicTrafficReportRulesSource.test.ts`

Expected: FAIL because CLI has not imported or called the new modules.

- [ ] **Step 3: Modify CLI imports**

Update the imports at the top of `src/cli/publicTrafficReport.ts` to include:

```ts
import { analyzePublicTraffic } from '../publicTraffic/analyzePublicTraffic.js';
import { aggregateExposureDeltas } from '../publicTraffic/exposureAggregate.js';
import { loadRecentExposureDeltas } from '../publicTraffic/recentExposureDeltas.js';
import { loadPublicTrafficRulesConfig } from '../publicTraffic/rulesConfig.js';
```

- [ ] **Step 4: Wire aggregation and analysis after daily delta write**

Replace the skeleton `context` construction in `runPublicTrafficReportCli` after daily delta write with:

```ts
    const sevenDayDeltas = await loadRecentExposureDeltas(config.outputDir, date, 7);
    const thirtyDayDeltas = await loadRecentExposureDeltas(config.outputDir, date, 30);
    const sevenDaySummary = aggregateExposureDeltas(sevenDayDeltas);
    const thirtyDaySummary = aggregateExposureDeltas(thirtyDayDeltas);
    await writeFile(paths.exposure7dSummary, JSON.stringify(sevenDaySummary, null, 2), 'utf8');
    await writeFile(paths.exposure30dSummary, JSON.stringify(thirtyDaySummary, null, 2), 'utf8');
    log.addEvent(`7日汇总: ${sevenDaySummary.length} 条商品`);
    log.addEvent(`30日汇总: ${thirtyDaySummary.length} 条商品`);

    const rulesConfig = await loadPublicTrafficRulesConfig();
    const analysis = analyzePublicTraffic({
      date,
      dailyDelta,
      sevenDaySummary,
      thirtyDaySummary,
      cumulativeProducts: crawlResult.products,
      config: rulesConfig,
    });
    log.addEvent(
      `规则分析: 曝光优化=${analysis.exposureOptimization.length}, 转化优化=${analysis.conversionOptimization.length}, 新品观察=${analysis.newProductObservation.length}, 生命周期治理=${analysis.lifecycleGovernance.length}`,
    );

    const context: PublicTrafficReportContext = {
      date,
      overview: crawlResult.overview,
      exposureOptimization: analysis.exposureOptimization,
      conversionOptimization: analysis.conversionOptimization,
      newProductObservation: analysis.newProductObservation,
      lifecycleGovernance: analysis.lifecycleGovernance,
    };
```

- [ ] **Step 5: Run tests and build**

Run: `npm test -- tests/publicTrafficReportRulesSource.test.ts`

Expected: PASS.

Run: `npm test`

Expected: all tests PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cli/publicTrafficReport.ts tests/publicTrafficReportRulesSource.test.ts
git commit -m "功能：串联规则分析到公域流量日报"
```

## Task 5: Live Verification

**Files:**
- No planned source changes unless verification reveals a bug.

- [ ] **Step 1: Run live report**

Run: `npm run public-traffic-report`

Expected:

- Browser reaches the public exposure page.
- Overview has 3 periods.
- Product table is scraped.
- CLI writes `exposure-daily-delta.json`, `exposure-7d-summary.json`, `exposure-30d-summary.json`, `report-context.json`, Markdown, XLSX, and `run.log`.
- Console output shows non-empty module counts when current data triggers rules.

- [ ] **Step 2: Inspect generated context and log**

Read:

- `output/public-traffic/YYYY-MM-DD/report-context.json`
- `output/public-traffic/YYYY-MM-DD/run.log`

Expected:

- `report-context.json` contains four arrays from analysis.
- At least `newProductObservation` is likely non-empty on the first run because previous snapshot is absent and rows are flagged `new_product`.
- `run.log` contains `7日汇总`, `30日汇总`, and `规则分析` events.

- [ ] **Step 3: Fix live issues if any**

If live verification reveals incorrect thresholds, selector regressions, or config path issues, write a failing test first, implement the smallest fix, run `npm test`, `npm run build`, and rerun `npm run public-traffic-report`.

- [ ] **Step 4: Commit live fixes if any**

If code changed:

```bash
git add src/publicTraffic/analyzePublicTraffic.ts src/publicTraffic/recentExposureDeltas.ts src/publicTraffic/rulesConfig.ts src/cli/publicTrafficReport.ts tests/analyzePublicTraffic.test.ts tests/recentExposureDeltas.test.ts tests/publicTrafficRulesConfig.test.ts tests/publicTrafficReportRulesSource.test.ts config/public-traffic-rules.example.json
git commit -m "修复：完善公域规则日报验证问题"
```

## Final Verification

- [ ] Run: `npm run build`
- [ ] Run: `npm test`
- [ ] Run: `npm run public-traffic-report`
- [ ] Request final code review for the rule-analysis feature.

## Self-Review Notes

- Spec coverage: config defaults/validation, 7/30 aggregation writing, four rule modules, CLI context fill, logging, missing/corrupt historical file behavior, and report output are covered.
- Out of scope remains excluded: goods-list new product detection, internal ID preferred display, observation-state persistence, visit/order/shipment merge, Feishu Q&A, approval cards, LLM suggestions, and product mutation.
- Type consistency: plan uses existing `ExposureDailyDelta`, `ExposureProductSummary`, `ExposureCumulativeProduct`, and `PublicTrafficReportSectionItem` from `src/publicTraffic/types.ts`.
