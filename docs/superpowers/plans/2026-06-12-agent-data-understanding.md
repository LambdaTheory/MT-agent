# Agent Data Understanding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic data access layer that lets the Feishu Agent answer common operational questions from existing MT-agent report data.

**Architecture:** Add a focused `src/agentData/` module that loads the latest public traffic context and exposes typed query functions. Keep this separate from the Feishu bot transport layer so bot commands can call stable data APIs without knowing JSON file layout.

**Tech Stack:** Node.js, TypeScript, Vitest, existing public traffic report context JSON.

---

## File Structure

- Create `src/agentData/types.ts`: shared query result types for overview, product lookup, problem products, new product pool, order summary, and task items.
- Create `src/agentData/reportDataStore.ts`: load latest report context from `output/latest` or the newest dated output directory.
- Create `src/agentData/publicTrafficQueries.ts`: deterministic query functions over `PublicTrafficDataReportContext`.
- Create `src/agentData/taskPool.ts`: combine low exposure, weak conversion, high potential, new product pool, and order notes into one ranked task list.
- Create `src/agentData/intent.ts`: map common Chinese questions to query intents.
- Add tests under `tests/agentData*.test.ts` with small fixture contexts.
- Do not modify crawler/report generation behavior in this branch.

## Important Context

- `feature/feishu-bot-readonly-command-agent` is a separate branch for the Feishu HTTP bot. This branch should expose data APIs that can later be called by that bot.
- `feature/goods-manager-new-products-v2` adds `newProductPoolItems`. This branch should support both `newProductPoolItems` and old `newProductPoolIds` so merge order stays flexible.
- `config/product-id-map.json` and `config/product-id-map.backup.json` are local runtime artifacts and must not be committed.

### Task 1: Query Types

**Files:**
- Create: `src/agentData/types.ts`
- Test: `tests/agentDataTypesSource.test.ts`

- [ ] **Step 1: Write source-level type export test**

Create `tests/agentDataTypesSource.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('agent data types source', () => {
  it('exports stable Agent query type names', () => {
    const source = readFileSync('src/agentData/types.ts', 'utf8');
    expect(source).toContain('export interface AgentOverviewAnswer');
    expect(source).toContain('export interface AgentProductAnswer');
    expect(source).toContain('export interface AgentTaskItem');
    expect(source).toContain('export type AgentIntent');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/agentDataTypesSource.test.ts`

Expected: FAIL because `src/agentData/types.ts` does not exist.

- [ ] **Step 3: Create type definitions**

Create `src/agentData/types.ts`:

```ts
import type { PeriodKey } from '../domain/types.js';

export interface AgentOverviewMetric {
  period: PeriodKey;
  exposure: number;
  publicVisits: number;
  createdOrders: number;
  shippedOrders: number;
  amount: number;
  exposureVisitRate: number;
  visitShipmentRate: number;
}

export interface AgentOverviewAnswer {
  date: string;
  metrics: AgentOverviewMetric[];
  dataQualityNotes: string[];
}

export interface AgentProductPeriodMetric extends AgentOverviewMetric {}

export interface AgentProductAnswer {
  productId: string;
  productName: string;
  platformProductId: string;
  custodyDays: number | null;
  periods: AgentProductPeriodMetric[];
}

export type AgentProblemType = 'low_exposure' | 'weak_conversion' | 'high_potential' | 'new_product_pool' | 'recommended_action';

export interface AgentProblemProduct {
  type: AgentProblemType;
  productId: string;
  action: string;
  reason: string;
}

export interface AgentNewProductPoolItem {
  productId: string;
  productName: string;
  maintenanceStatus: string;
}

export interface AgentOrderSummary {
  text: string;
}

export interface AgentTaskItem {
  productId: string;
  productName: string;
  taskType: AgentProblemType;
  priority: number;
  reason: string;
  suggestedAction: string;
  status: '待处理';
}

export type AgentIntent =
  | { type: 'overview' }
  | { type: 'product'; keyword: string }
  | { type: 'tasks' }
  | { type: 'problem_products'; problemType: AgentProblemType }
  | { type: 'new_product_pool' }
  | { type: 'order_summary' }
  | { type: 'unknown'; text: string };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/agentDataTypesSource.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agentData/types.ts tests/agentDataTypesSource.test.ts
git commit -m "功能：定义Agent数据查询类型"
```

### Task 2: Public Traffic Query Functions

**Files:**
- Create: `src/agentData/publicTrafficQueries.ts`
- Test: `tests/agentDataPublicTrafficQueries.test.ts`

- [ ] **Step 1: Write failing query tests**

Create `tests/agentDataPublicTrafficQueries.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getLatestOverview, getProductPerformance, getProblemProducts, getNewProductPool } from '../src/agentData/publicTrafficQueries.js';
import type { PublicTrafficDataReportContext } from '../src/publicTraffic/types.js';

const context = {
  date: '2026-06-12',
  summary: {
    '1d': { exposure: 100, publicVisits: 10, dashboardVisits: 8, createdOrders: 2, shippedOrders: 1, amount: 99, exposureVisitRate: 0.1, visitCreatedOrderRate: 0.2, visitShipmentRate: 0.1 },
    '7d': { exposure: 700, publicVisits: 70, dashboardVisits: 60, createdOrders: 8, shippedOrders: 4, amount: 399, exposureVisitRate: 0.1, visitCreatedOrderRate: 0.11, visitShipmentRate: 0.06 },
    '30d': { exposure: 3000, publicVisits: 300, dashboardVisits: 250, createdOrders: 20, shippedOrders: 10, amount: 999, exposureVisitRate: 0.1, visitCreatedOrderRate: 0.07, visitShipmentRate: 0.03 },
  },
  conclusions: [],
  dataQualityNotes: ['后链路数据为空'],
  newProductPoolItems: [{ productId: '701', productName: '新品 Alpha', shortTitle: '', submittedAt: '2026-06-12 09:00:00', merchant: '', alipaySyncStatus: '', alipayCode: '', stock: 0, skuCount: 0, maintenanceStatus: '待维护', note: '' }],
  rows: [{ productName: '佳能 G7X2', platformProductId: 'p-251', displayProductId: '251', custodyDays: 3, periods: {
    '1d': { exposure: 50, publicVisits: 5, dashboardVisits: 4, createdOrders: 1, signedOrders: 0, reviewedOrders: 0, shippedOrders: 1, amount: 49, exposureVisitRate: 0.1, visitCreatedOrderRate: 0.2, visitShipmentRate: 0.2, hasExposureData: true, hasDashboardData: true },
    '7d': { exposure: 200, publicVisits: 20, dashboardVisits: 18, createdOrders: 3, signedOrders: 0, reviewedOrders: 0, shippedOrders: 2, amount: 149, exposureVisitRate: 0.1, visitCreatedOrderRate: 0.15, visitShipmentRate: 0.1, hasExposureData: true, hasDashboardData: true },
    '30d': { exposure: 1000, publicVisits: 100, dashboardVisits: 80, createdOrders: 10, signedOrders: 0, reviewedOrders: 0, shippedOrders: 5, amount: 499, exposureVisitRate: 0.1, visitCreatedOrderRate: 0.1, visitShipmentRate: 0.05, hasExposureData: true, hasDashboardData: true },
  }}],
  lowExposure: [{ identifier: '251', action: '补曝光', reason: '曝光不足' }],
  weakClick: [],
  weakConversion: [{ identifier: '251', action: '提转化', reason: '访问多成交少' }],
  highPotential: [],
  newProductObservation: [],
  lifecycleGovernance: [],
  recommendedActions: [],
  emptySectionNotes: { lowExposure: '', weakClick: '', weakConversion: '', highPotential: '', newProductObservation: '', lifecycleGovernance: '', recommendedActions: '' },
} satisfies PublicTrafficDataReportContext;

describe('agent public traffic queries', () => {
  it('returns overview metrics and quality notes', () => {
    expect(getLatestOverview(context)).toMatchObject({ date: '2026-06-12', dataQualityNotes: ['后链路数据为空'] });
  });

  it('finds a product by display id or product name keyword', () => {
    expect(getProductPerformance(context, '251')?.productName).toBe('佳能 G7X2');
    expect(getProductPerformance(context, 'G7X2')?.productId).toBe('251');
  });

  it('returns problem products and new product pool', () => {
    expect(getProblemProducts(context, 'low_exposure')).toEqual([{ type: 'low_exposure', productId: '251', action: '补曝光', reason: '曝光不足' }]);
    expect(getNewProductPool(context)).toEqual([{ productId: '701', productName: '新品 Alpha', maintenanceStatus: '待维护' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/agentDataPublicTrafficQueries.test.ts`

Expected: FAIL because `publicTrafficQueries.ts` does not exist.

- [ ] **Step 3: Implement query functions**

Create `src/agentData/publicTrafficQueries.ts`:

```ts
import type { PeriodKey } from '../domain/types.js';
import type { PublicTrafficDataReportContext, PublicTrafficPeriodMetrics, PublicTrafficReportSectionItem } from '../publicTraffic/types.js';
import type { AgentNewProductPoolItem, AgentOverviewAnswer, AgentOverviewMetric, AgentProblemProduct, AgentProblemType, AgentProductAnswer, AgentProductPeriodMetric } from './types.js';

const periods: PeriodKey[] = ['1d', '7d', '30d'];

function toOverviewMetric(period: PeriodKey, metric: PublicTrafficDataReportContext['summary'][PeriodKey]): AgentOverviewMetric {
  return { period, exposure: metric.exposure, publicVisits: metric.publicVisits, createdOrders: metric.createdOrders, shippedOrders: metric.shippedOrders, amount: metric.amount, exposureVisitRate: metric.exposureVisitRate, visitShipmentRate: metric.visitShipmentRate };
}

function toProductMetric(period: PeriodKey, metric: PublicTrafficPeriodMetrics): AgentProductPeriodMetric {
  return { period, exposure: metric.exposure, publicVisits: metric.publicVisits, createdOrders: metric.createdOrders, shippedOrders: metric.shippedOrders, amount: metric.amount, exposureVisitRate: metric.exposureVisitRate, visitShipmentRate: metric.visitShipmentRate };
}

function sectionItems(type: AgentProblemType, rows: PublicTrafficReportSectionItem[]): AgentProblemProduct[] {
  return rows.map((row) => ({ type, productId: row.identifier, action: row.action, reason: row.reason }));
}

export function getLatestOverview(context: PublicTrafficDataReportContext): AgentOverviewAnswer {
  return { date: context.date, metrics: periods.map((period) => toOverviewMetric(period, context.summary[period])), dataQualityNotes: context.dataQualityNotes ?? [] };
}

export function getProductPerformance(context: PublicTrafficDataReportContext, keyword: string): AgentProductAnswer | null {
  const normalized = keyword.trim().toLowerCase();
  if (!normalized) return null;
  const row = context.rows.find((item) => item.displayProductId.toLowerCase() === normalized || item.platformProductId.toLowerCase() === normalized || item.productName.toLowerCase().includes(normalized));
  if (!row) return null;
  return { productId: row.displayProductId, productName: row.productName, platformProductId: row.platformProductId, custodyDays: row.custodyDays, periods: periods.map((period) => toProductMetric(period, row.periods[period])) };
}

export function getProblemProducts(context: PublicTrafficDataReportContext, type: AgentProblemType): AgentProblemProduct[] {
  if (type === 'low_exposure') return sectionItems(type, context.lowExposure);
  if (type === 'weak_conversion') return sectionItems(type, context.weakConversion);
  if (type === 'high_potential') return sectionItems(type, context.highPotential);
  if (type === 'recommended_action') return sectionItems(type, context.recommendedActions);
  return getNewProductPool(context).map((item) => ({ type: 'new_product_pool', productId: item.productId, action: item.maintenanceStatus, reason: item.productName }));
}

export function getNewProductPool(context: PublicTrafficDataReportContext): AgentNewProductPoolItem[] {
  const items = 'newProductPoolItems' in context && Array.isArray(context.newProductPoolItems) ? context.newProductPoolItems : [];
  if (items.length > 0) return items.map((item) => ({ productId: item.productId, productName: item.productName, maintenanceStatus: item.maintenanceStatus }));
  return (context.newProductPoolIds ?? []).map((productId) => ({ productId, productName: '', maintenanceStatus: '待维护' }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/agentDataPublicTrafficQueries.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agentData/publicTrafficQueries.ts tests/agentDataPublicTrafficQueries.test.ts
git commit -m "功能：新增Agent公域数据查询接口"
```

### Task 3: Task Pool And Intent Mapping

**Files:**
- Create: `src/agentData/taskPool.ts`
- Create: `src/agentData/intent.ts`
- Test: `tests/agentDataTaskPool.test.ts`
- Test: `tests/agentDataIntent.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/agentDataTaskPool.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildAgentTaskPool } from '../src/agentData/taskPool.js';
import type { PublicTrafficDataReportContext } from '../src/publicTraffic/types.js';

const baseContext = {
  date: '2026-06-12',
  summary: { '1d': { exposure: 0, publicVisits: 0, dashboardVisits: 0, createdOrders: 0, shippedOrders: 0, amount: 0, exposureVisitRate: 0, visitCreatedOrderRate: 0, visitShipmentRate: 0 }, '7d': { exposure: 0, publicVisits: 0, dashboardVisits: 0, createdOrders: 0, shippedOrders: 0, amount: 0, exposureVisitRate: 0, visitCreatedOrderRate: 0, visitShipmentRate: 0 }, '30d': { exposure: 0, publicVisits: 0, dashboardVisits: 0, createdOrders: 0, shippedOrders: 0, amount: 0, exposureVisitRate: 0, visitCreatedOrderRate: 0, visitShipmentRate: 0 } },
  conclusions: [], rows: [], lowExposure: [{ identifier: '251', action: '补曝光', reason: '曝光不足' }], weakClick: [], weakConversion: [{ identifier: '252', action: '提转化', reason: '访问多成交少' }], highPotential: [{ identifier: '253', action: '继续放量', reason: '高潜力' }], newProductObservation: [], lifecycleGovernance: [], recommendedActions: [], newProductPoolIds: ['701'], emptySectionNotes: { lowExposure: '', weakClick: '', weakConversion: '', highPotential: '', newProductObservation: '', lifecycleGovernance: '', recommendedActions: '' },
} satisfies PublicTrafficDataReportContext;

describe('buildAgentTaskPool', () => {
  it('combines report actions and new product pool into prioritized tasks', () => {
    expect(buildAgentTaskPool(baseContext).map((item) => [item.productId, item.taskType, item.priority, item.status])).toEqual([
      ['253', 'high_potential', 90, '待处理'],
      ['252', 'weak_conversion', 80, '待处理'],
      ['251', 'low_exposure', 70, '待处理'],
      ['701', 'new_product_pool', 60, '待处理'],
    ]);
  });
});
```

Create `tests/agentDataIntent.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseAgentDataIntent } from '../src/agentData/intent.js';

describe('parseAgentDataIntent', () => {
  it('maps common Chinese questions to deterministic intents', () => {
    expect(parseAgentDataIntent('今天怎么样')).toEqual({ type: 'overview' });
    expect(parseAgentDataIntent('查 251')).toEqual({ type: 'product', keyword: '251' });
    expect(parseAgentDataIntent('今天要处理哪些')).toEqual({ type: 'tasks' });
    expect(parseAgentDataIntent('新品池有哪些')).toEqual({ type: 'new_product_pool' });
    expect(parseAgentDataIntent('转化差的有哪些')).toEqual({ type: 'problem_products', problemType: 'weak_conversion' });
    expect(parseAgentDataIntent('订单情况')).toEqual({ type: 'order_summary' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/agentDataTaskPool.test.ts tests/agentDataIntent.test.ts`

Expected: FAIL because `taskPool.ts` and `intent.ts` do not exist.

- [ ] **Step 3: Implement task pool**

Create `src/agentData/taskPool.ts`:

```ts
import type { PublicTrafficDataReportContext } from '../publicTraffic/types.js';
import { getNewProductPool, getProblemProducts } from './publicTrafficQueries.js';
import type { AgentProblemType, AgentTaskItem } from './types.js';

const priorityByType: Record<AgentProblemType, number> = { high_potential: 90, weak_conversion: 80, low_exposure: 70, new_product_pool: 60, recommended_action: 50 };

export function buildAgentTaskPool(context: PublicTrafficDataReportContext): AgentTaskItem[] {
  const tasks: AgentTaskItem[] = [];
  for (const type of ['high_potential', 'weak_conversion', 'low_exposure', 'recommended_action'] as AgentProblemType[]) {
    for (const item of getProblemProducts(context, type)) {
      tasks.push({ productId: item.productId, productName: '', taskType: type, priority: priorityByType[type], reason: item.reason, suggestedAction: item.action, status: '待处理' });
    }
  }
  for (const item of getNewProductPool(context)) {
    tasks.push({ productId: item.productId, productName: item.productName, taskType: 'new_product_pool', priority: priorityByType.new_product_pool, reason: item.productName || '新品池待维护', suggestedAction: item.maintenanceStatus, status: '待处理' });
  }
  return tasks.sort((a, b) => b.priority - a.priority || a.productId.localeCompare(b.productId));
}
```

- [ ] **Step 4: Implement intent mapping**

Create `src/agentData/intent.ts`:

```ts
import type { AgentIntent } from './types.js';

export function parseAgentDataIntent(input: string): AgentIntent {
  const text = input.replace(/\s+/g, ' ').trim();
  if (/^(今天|今日|最新).*(怎么样|概况|数据)/.test(text)) return { type: 'overview' };
  const product = /^(查|查询|商品)\s+(.+)$/.exec(text);
  if (product) return { type: 'product', keyword: product[2].trim() };
  if (/(要处理|任务|优先)/.test(text)) return { type: 'tasks' };
  if (/新品池|新品维护/.test(text)) return { type: 'new_product_pool' };
  if (/转化差|提转化|成交少/.test(text)) return { type: 'problem_products', problemType: 'weak_conversion' };
  if (/曝光低|补曝光/.test(text)) return { type: 'problem_products', problemType: 'low_exposure' };
  if (/高潜力|继续放量/.test(text)) return { type: 'problem_products', problemType: 'high_potential' };
  if (/订单|发货|归还|关单/.test(text)) return { type: 'order_summary' };
  return { type: 'unknown', text };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/agentDataTaskPool.test.ts tests/agentDataIntent.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/agentData/taskPool.ts src/agentData/intent.ts tests/agentDataTaskPool.test.ts tests/agentDataIntent.test.ts
git commit -m "功能：新增Agent任务池和意图映射"
```

### Task 4: Final Verification

**Files:**
- All `src/agentData/*`
- All `tests/agentData*.test.ts`

- [ ] **Step 1: Run focused Agent data tests**

Run:

```powershell
npm test -- tests/agentDataTypesSource.test.ts tests/agentDataPublicTrafficQueries.test.ts tests/agentDataTaskPool.test.ts tests/agentDataIntent.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Run full suite**

Run:

```powershell
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Run build**

Run:

```powershell
npm run build
```

Expected: TypeScript build exits successfully.

- [ ] **Step 4: Push branch**

Run:

```powershell
git push -u origin feature/agent-data-understanding
```

Expected: branch is available on GitHub for handoff and later review.
