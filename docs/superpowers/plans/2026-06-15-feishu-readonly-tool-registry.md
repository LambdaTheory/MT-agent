# Feishu Readonly Tool Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract Feishu bot read-only Agent queries into an explicit typed registry while keeping side-effect commands outside the registry.

**Architecture:** Refactor `src/feishuBot/readOnlyToolRegistry.ts` as the Feishu-facing registry for read-only tools. Keep `src/agentData/` as the deterministic data-query layer, and make `src/feishuBot/tools.ts` delegate unknown Agent intents through the registry after loading the latest report context.

**Tech Stack:** TypeScript, Vitest, existing Feishu bot dispatcher, existing public traffic report context helpers.

---

## File Structure

- Modify `src/feishuBot/readOnlyToolRegistry.ts`: preserve the existing staged registry file, then refactor it into typed read-only tool definitions, lookup helper, formatter helpers, and stable exported registry.
- Modify `tests/feishuBotReadOnlyToolRegistry.test.ts`: preserve the existing staged test file, then expand it for registry source, behavior, and safety coverage.
- Modify `src/feishuBot/tools.ts`: remove inline Agent intent branching and call the registry for read-only Agent intents.
- Modify `tests/feishuBotTools.test.ts`: add regression coverage for registry-backed Agent intents and improved unknown guidance.
- Do not modify SDK/HTTP dispatcher, Feishu reply transport, report generation, crawler, or active Feishu push paths.

---

### Task 1: Add Registry Tests

**Files:**
- Modify: `tests/feishuBotReadOnlyToolRegistry.test.ts`

- [ ] **Step 1: Write the failing registry test file**

Replace `tests/feishuBotReadOnlyToolRegistry.test.ts` with this content:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findReadOnlyTool, readOnlyTools } from '../src/feishuBot/readOnlyToolRegistry.js';
import type { PublicTrafficDataReportContext } from '../src/publicTraffic/types.js';

const metric = {
  exposure: 100,
  publicVisits: 10,
  dashboardVisits: 8,
  createdOrders: 2,
  signedOrders: 0,
  reviewedOrders: 0,
  shippedOrders: 1,
  amount: 88,
  exposureVisitRate: 0.1,
  visitCreatedOrderRate: 0.2,
  visitShipmentRate: 0.1,
  hasExposureData: true,
  hasDashboardData: true,
};

const context = {
  date: '2026-06-15',
  summary: { '1d': metric, '7d': metric, '30d': metric },
  conclusions: [],
  dataQualityNotes: [],
  rows: [{ productName: '大疆 Pocket 3', platformProductId: 'p701', displayProductId: '端内ID 701', custodyDays: 3, periods: { '1d': metric, '7d': metric, '30d': metric } }],
  lowExposure: [{ identifier: '端内ID 702', action: '补曝光', reason: '曝光不足' }],
  weakClick: [],
  weakConversion: [{ identifier: '端内ID 703', action: '提转化', reason: '访问多成交少' }],
  highPotential: [{ identifier: '端内ID 704', action: '继续放量', reason: '高潜力' }],
  newProductObservation: [],
  lifecycleGovernance: [],
  recommendedActions: [],
  newProductPoolItems: [{ productId: '701', productName: '大疆 Pocket 3', shortTitle: '', submittedAt: '2026-06-15 09:00:00', merchant: '', alipaySyncStatus: '已同步', alipayCode: '', stock: 0, skuCount: 0, maintenanceStatus: '待维护', note: '' }],
  agentData: { removedLinks: [{ productId: '705', platformProductId: 'p705', productName: '已下架链接', removedDate: '2026-06-14', reason: '商品总表缺失', source: 'goods_snapshot_diff' }] },
  orderAnalysis: { runDate: '2026-06-15', pages: { overview: { label: '订单概览', dataDate: '2026-06-14', indicators: [{ label: '发货订单', value: '12' }] } } },
  emptySectionNotes: { lowExposure: '', weakClick: '', weakConversion: '', highPotential: '', newProductObservation: '', lifecycleGovernance: '', recommendedActions: '' },
} as unknown as PublicTrafficDataReportContext;

describe('readOnlyTools', () => {
  it('exports stable read-only tool names and lookup helper', () => {
    expect(readOnlyTools.map((tool) => tool.name)).toEqual([
      'overview',
      'product',
      'new_product_pool',
      'tasks',
      'problem_products',
      'removed_links',
      'order_summary',
    ]);
    expect(findReadOnlyTool({ type: 'product', keyword: '701' })?.name).toBe('product');
    expect(findReadOnlyTool({ type: 'unknown', text: '随便聊聊' })).toBeUndefined();
  });

  it('does not register side-effect bot commands', () => {
    const source = readFileSync('src/feishuBot/readOnlyToolRegistry.ts', 'utf8');
    expect(source).not.toContain('run_public_traffic_report');
    expect(source).not.toContain('resend_latest_report');
    expect(source).not.toContain('push_latest_report_to_group');
  });

  it('answers every registered read-only Agent intent', async () => {
    await expect(findReadOnlyTool({ type: 'overview' })?.run(context, { type: 'overview' })).resolves.toMatchObject({ text: expect.stringContaining('公域日报 2026-06-15') });
    await expect(findReadOnlyTool({ type: 'product', keyword: '701' })?.run(context, { type: 'product', keyword: '701' })).resolves.toMatchObject({ text: expect.stringContaining('端内ID 701') });
    await expect(findReadOnlyTool({ type: 'new_product_pool' })?.run(context, { type: 'new_product_pool' })).resolves.toMatchObject({ text: expect.stringContaining('大疆 Pocket 3') });
    await expect(findReadOnlyTool({ type: 'tasks' })?.run(context, { type: 'tasks' })).resolves.toMatchObject({ text: expect.stringContaining('端内ID 704') });
    await expect(findReadOnlyTool({ type: 'problem_products', problemType: 'weak_conversion' })?.run(context, { type: 'problem_products', problemType: 'weak_conversion' })).resolves.toMatchObject({ text: expect.stringContaining('访问多成交少') });
    await expect(findReadOnlyTool({ type: 'removed_links' })?.run(context, { type: 'removed_links' })).resolves.toMatchObject({ text: expect.stringContaining('2026-06-14') });
    await expect(findReadOnlyTool({ type: 'order_summary' })?.run(context, { type: 'order_summary' })).resolves.toMatchObject({ text: expect.stringContaining('发货订单：12') });
  });
});
```

- [ ] **Step 2: Run the registry test to verify RED**

Run:

```powershell
npm test -- tests/feishuBotReadOnlyToolRegistry.test.ts
```

Expected: FAIL because the existing staged `src/feishuBot/readOnlyToolRegistry.ts` still exports `executeReadOnlyTool()` rather than the approved `readOnlyTools` registry and `findReadOnlyTool()` lookup API.

- [ ] **Step 3: Commit the failing test**

Run:

```powershell
git add tests/feishuBotReadOnlyToolRegistry.test.ts
git commit -m "测试：覆盖飞书只读工具注册表"
```

---

### Task 2: Implement The Readonly Registry

**Files:**
- Modify: `src/feishuBot/readOnlyToolRegistry.ts`
- Test: `tests/feishuBotReadOnlyToolRegistry.test.ts`

- [ ] **Step 1: Create the registry implementation**

Replace `src/feishuBot/readOnlyToolRegistry.ts` with this content:

```ts
import { getLatestOverview, getNewProductPool, getProblemProducts, getProductPerformance, getRemovedLinks } from '../agentData/publicTrafficQueries.js';
import { buildAgentTaskPool } from '../agentData/taskPool.js';
import type { AgentIntent, AgentProblemType } from '../agentData/types.js';
import type { PublicTrafficDataReportContext } from '../publicTraffic/types.js';
import type { BotResponse } from './types.js';

type ReadonlyAgentIntent = Exclude<AgentIntent, { type: 'unknown' }>;

export interface ReadonlyTool<TIntent extends ReadonlyAgentIntent = ReadonlyAgentIntent> {
  name: TIntent['type'];
  description: string;
  intentType: TIntent['type'];
  run(context: PublicTrafficDataReportContext, intent: TIntent): Promise<BotResponse>;
}

function formatTaskLines(items: Array<{ productId: string; suggestedAction: string; reason: string }>): string {
  return items.length > 0 ? items.map((item, index) => `${index + 1}. ${item.productId}：${item.suggestedAction}。原因：${item.reason}`).join('\n') : '暂无待处理任务。';
}

function formatProblemLines(items: Array<{ productId: string; action: string; reason: string }>): string {
  return items.length > 0 ? items.map((item, index) => `${index + 1}. ${item.productId}：${item.action}。原因：${item.reason}`).join('\n') : '暂无匹配问题商品。';
}

function formatRemovedLinkLines(items: Array<{ productId: string; productName: string; removedDate: string; reason: string }>): string {
  return items.length > 0 ? items.map((item, index) => `${index + 1}. ${item.productId}：${item.reason}。下架日期：${item.removedDate}。商品：${item.productName}`).join('\n') : '暂无近7天下架链接。';
}

function formatNewProductPoolLines(items: Array<{ productId: string; productName: string; maintenanceStatus: string }>): string {
  return items.length > 0 ? items.map((item, index) => `${index + 1}. ${item.productId}：${item.productName || '未命名'}。状态：${item.maintenanceStatus}`).join('\n') : '暂无新链接池商品。';
}

function formatOverviewLines(contextDate: string, metrics: ReturnType<typeof getLatestOverview>['metrics']): string {
  const one = metrics.find((metric) => metric.period === '1d');
  if (!one) return `公域日报 ${contextDate}\n暂无 1 日概况。`;
  return `公域日报 ${contextDate}\n曝光 ${one.exposure}，访问 ${one.publicVisits}，发货 ${one.shippedOrders}，金额 ¥${one.amount.toFixed(2)}`;
}

function formatProductAnswer(answer: ReturnType<typeof getProductPerformance>): string {
  if (!answer) return '暂无匹配商品。';
  const one = answer.periods.find((metric) => metric.period === '1d');
  const seven = answer.periods.find((metric) => metric.period === '7d');
  return [
    `${answer.productId} ${answer.productName}`,
    one ? `1日：曝光 ${one.exposure}，访问 ${one.publicVisits}，发货 ${one.shippedOrders}` : '',
    seven ? `7日：曝光 ${seven.exposure}，访问 ${seven.publicVisits}，发货 ${seven.shippedOrders}` : '',
  ].filter(Boolean).join('\n');
}

function formatOrderSummary(context: { orderAnalysis?: { pages?: Record<string, { label: string; indicators?: Array<{ label: string; value: string }> }> } }): string {
  const overview = context.orderAnalysis?.pages?.overview;
  const indicators = overview?.indicators ?? [];
  if (indicators.length === 0) return '暂无订单概况。';
  return ['订单情况', ...indicators.slice(0, 8).map((item) => `${item.label}：${item.value}`)].join('\n');
}

export const readOnlyTools = [
  {
    name: 'overview',
    description: '查询最新公域日报概况',
    intentType: 'overview',
    async run(context) {
      const overview = getLatestOverview(context);
      return { text: formatOverviewLines(overview.date, overview.metrics) };
    },
  },
  {
    name: 'product',
    description: '按商品 ID、平台 ID 或商品名查询表现',
    intentType: 'product',
    async run(context, intent) {
      return { text: formatProductAnswer(getProductPerformance(context, intent.keyword)) };
    },
  },
  {
    name: 'new_product_pool',
    description: '查询新链接池商品',
    intentType: 'new_product_pool',
    async run(context) {
      return { text: formatNewProductPoolLines(getNewProductPool(context)) };
    },
  },
  {
    name: 'tasks',
    description: '查询待处理任务',
    intentType: 'tasks',
    async run(context) {
      return { text: formatTaskLines(buildAgentTaskPool(context)) };
    },
  },
  {
    name: 'problem_products',
    description: '查询问题商品',
    intentType: 'problem_products',
    async run(context, intent) {
      return { text: formatProblemLines(getProblemProducts(context, intent.problemType as AgentProblemType)) };
    },
  },
  {
    name: 'removed_links',
    description: '查询最近下架链接',
    intentType: 'removed_links',
    async run(context) {
      return { text: formatRemovedLinkLines(getRemovedLinks(context)) };
    },
  },
  {
    name: 'order_summary',
    description: '查询订单分析概况',
    intentType: 'order_summary',
    async run(context) {
      return { text: formatOrderSummary(context) };
    },
  },
] satisfies ReadonlyTool[];

export function findReadOnlyTool(intent: AgentIntent): ReadonlyTool | undefined {
  if (intent.type === 'unknown') return undefined;
  return readOnlyTools.find((tool) => tool.intentType === intent.type);
}
```

- [ ] **Step 2: Run the registry test to verify GREEN**

Run:

```powershell
npm test -- tests/feishuBotReadOnlyToolRegistry.test.ts
```

Expected: PASS for all tests in `feishuBotReadOnlyToolRegistry.test.ts`.

- [ ] **Step 3: Run TypeScript build for registry types**

Run:

```powershell
npm run build
```

Expected: PASS with `tsc -p tsconfig.json` exiting with code 0.

- [ ] **Step 4: Commit the registry implementation**

Run:

```powershell
git add src/feishuBot/readOnlyToolRegistry.ts
git commit -m "功能：新增飞书只读工具注册表"
```

---

### Task 3: Delegate Feishu Bot Agent Intents To The Registry

**Files:**
- Modify: `src/feishuBot/tools.ts`
- Modify: `tests/feishuBotTools.test.ts`
- Test: `tests/feishuBotTools.test.ts`

- [ ] **Step 1: Add failing tests for registry-backed Feishu bot behavior**

Modify `tests/feishuBotTools.test.ts`.

Replace the JSON object in `writeContext()` with this object so the fixture includes named new-pool items and order analysis:

```ts
{
  date: '2026-06-11',
  summary: { '1d': summary, '7d': summary, '30d': summary },
  conclusions: [],
  rows: [
    { productName: 'iPhone 15', platformProductId: '2000000000000000000001', displayProductId: '端内ID 565', custodyDays: 10, periods: { '1d': metric, '7d': metric, '30d': metric } },
    { productName: '大疆 Pocket 3', platformProductId: 'p701', displayProductId: '端内ID 701', custodyDays: 1, periods: { '1d': metric, '7d': metric, '30d': metric } },
  ],
  lowExposure: [{ identifier: '端内ID 565', action: '补曝光', reason: '曝光不足' }],
  weakClick: [],
  weakConversion: [{ identifier: '端内ID 565', action: '提转化', reason: '访问多成交少' }],
  highPotential: [{ identifier: '端内ID 566', action: '继续放量', reason: '高潜力' }],
  newProductObservation: [],
  lifecycleGovernance: [],
  recommendedActions: [],
  newProductPoolIds: ['701'],
  newProductPoolItems: [{ productId: '701', productName: '大疆 Pocket 3', shortTitle: '', submittedAt: '2026-06-11 09:00:00', merchant: '', alipaySyncStatus: '已同步', alipayCode: '', stock: 0, skuCount: 0, maintenanceStatus: '待维护', note: '' }],
  orderAnalysis: { runDate: '2026-06-11', pages: { overview: { label: '订单概览', dataDate: '2026-06-10', indicators: [{ label: '发货订单', value: '12' }] } } },
  agentData: { removedLinks: [{ productId: '701', platformProductId: 'p701', productName: '已下架链接', removedDate: '2026-06-12', reason: '商品总表缺失', source: 'goods_snapshot_diff' }] },
  emptySectionNotes: {},
}
```

Add this test before the removed-link test:

```ts
  it('answers all registry-backed read-only agent data questions', async () => {
    const outputDir = await writeContext();
    await expect(handleBotIntent({ type: 'unknown', text: '今天怎么样' }, outputDir)).resolves.toMatchObject({ text: expect.stringContaining('公域日报 2026-06-11') });
    await expect(handleBotIntent({ type: 'unknown', text: '查701' }, outputDir)).resolves.toMatchObject({ text: expect.stringContaining('端内ID 701') });
    await expect(handleBotIntent({ type: 'unknown', text: '新品池有哪些' }, outputDir)).resolves.toMatchObject({ text: expect.stringContaining('大疆 Pocket 3') });
    await expect(handleBotIntent({ type: 'unknown', text: '订单情况' }, outputDir)).resolves.toMatchObject({ text: expect.stringContaining('发货订单：12') });
  });
```

Add this test at the end of the `describe('handleBotIntent', ...)` block:

```ts
  it('returns read-only guidance for unsupported unknown questions', async () => {
    const outputDir = await writeContext();
    await expect(handleBotIntent({ type: 'unknown', text: '随便聊聊' }, outputDir)).resolves.toEqual({
      text: '我现在可以查：今日概况、商品、新链接池、待处理任务、转化差、曝光低、高潜力、下架链接、订单情况。你可以问“新链接池怎么样”或“查一下721”。',
    });
  });
```

- [ ] **Step 2: Run bot tools test to verify RED**

Run:

```powershell
npm test -- tests/feishuBotTools.test.ts
```

Expected: FAIL because `handleBotIntent()` does not yet use the registry for all read-only Agent intents and still returns the older generic fallback for unsupported unknown text.

- [ ] **Step 3: Refactor `src/feishuBot/tools.ts` to delegate to the registry**

Replace the imports at the top of `src/feishuBot/tools.ts` with:

```ts
import { runPublicTrafficReportCli } from '../cli/publicTrafficReport.js';
import { sendFeishuCard } from '../notify/feishu.js';
import { parseAgentDataIntent } from '../agentData/intent.js';
import { buildPublicTrafficCard } from '../publicTraffic/buildPublicTrafficCard.js';
import { buildPublicTrafficFeishuText } from '../publicTraffic/buildPublicTrafficFeishu.js';
import { findLatestReportContext, formatLatestSummary, formatProductRows, queryProductRows } from './reportStore.js';
import { findReadOnlyTool } from './readOnlyToolRegistry.js';
import type { BotIntent, BotResponse } from './types.js';
```

Remove these helper functions from `src/feishuBot/tools.ts` because the registry owns the Agent read-only formatting:

```ts
function formatTaskLines(items: Array<{ productId: string; suggestedAction: string; reason: string }>): string {
  return items.length > 0 ? items.map((item, index) => `${index + 1}. ${item.productId}：${item.suggestedAction}。原因：${item.reason}`).join('\n') : '暂无待处理任务。';
}

function formatProblemLines(items: Array<{ productId: string; action: string; reason: string }>): string {
  return items.length > 0 ? items.map((item, index) => `${index + 1}. ${item.productId}：${item.action}。原因：${item.reason}`).join('\n') : '暂无匹配问题商品。';
}

function formatRemovedLinkLines(items: Array<{ productId: string; productName: string; removedDate: string; reason: string }>): string {
  return items.length > 0 ? items.map((item, index) => `${index + 1}. ${item.productId}：${item.reason}。下架日期：${item.removedDate}。商品：${item.productName}`).join('\n') : '暂无近7天下架链接。';
}
```

Add this constant below `let running = false;`:

```ts
const UNKNOWN_GUIDANCE = '我现在可以查：今日概况、商品、新链接池、待处理任务、转化差、曝光低、高潜力、下架链接、订单情况。你可以问“新链接池怎么样”或“查一下721”。';
```

Replace the `if (intent.type === 'unknown') { ... }` block with:

```ts
  if (intent.type === 'unknown') {
    const dataIntent = parseAgentDataIntent(intent.text);
    const tool = findReadOnlyTool(dataIntent);
    if (!tool) return { text: UNKNOWN_GUIDANCE };

    const latest = await findLatestReportContext(outputDir);
    return latest ? tool.run(latest.context, dataIntent) : { text: '还没有找到公域日报上下文。' };
  }
```

- [ ] **Step 4: Run bot tools test to verify GREEN**

Run:

```powershell
npm test -- tests/feishuBotTools.test.ts
```

Expected: PASS for all tests in `feishuBotTools.test.ts`.

- [ ] **Step 5: Run focused registry and bot tests**

Run:

```powershell
npm test -- tests/feishuBotReadOnlyToolRegistry.test.ts tests/feishuBotTools.test.ts tests/agentDataIntent.test.ts tests/agentDataPublicTrafficQueries.test.ts tests/agentDataTaskPool.test.ts
```

Expected: PASS for all selected tests.

- [ ] **Step 6: Commit the bot delegation change**

Run:

```powershell
git add src/feishuBot/tools.ts tests/feishuBotTools.test.ts
git commit -m "功能：飞书机器人通过只读注册表回答Agent查询"
```

---

### Task 4: Final Verification

**Files:**
- No code changes expected.

- [ ] **Step 1: Run focused Feishu and Agent test suite**

Run:

```powershell
npm test -- tests/feishuBotReadOnlyToolRegistry.test.ts tests/feishuBotTools.test.ts tests/feishuBotIntent.test.ts tests/feishuBotDispatcher.test.ts tests/feishuBotSdkClient.test.ts tests/feishuBotServer.test.ts tests/agentDataIntent.test.ts tests/agentDataPublicTrafficQueries.test.ts tests/agentDataTaskPool.test.ts
```

Expected: PASS for all selected tests.

- [ ] **Step 2: Run TypeScript build**

Run:

```powershell
npm run build
```

Expected: PASS with `tsc -p tsconfig.json` exiting with code 0.

- [ ] **Step 3: Run full tests for this worktree**

Run:

```powershell
npm test
```

Expected: PASS for the complete worktree test suite.

- [ ] **Step 4: Inspect final history and status**

Run:

```powershell
git status --short --branch
git log --oneline -5
```

Expected: worktree is clean on `feature/feishu-readonly-tool-registry`; latest commits include the spec, plan, registry test, registry implementation, and bot delegation changes.

---

## Self-Review Notes

- Spec coverage: The plan creates a dedicated registry, keeps `agentData` as the query layer, excludes side-effect bot commands, preserves dispatcher behavior, covers all seven read-only Agent intents, and adds tests for registry behavior and safety.
- Placeholder scan: The plan contains exact file paths, concrete code snippets, commands, expected outcomes, and commit messages.
- Type consistency: The plan uses existing `AgentIntent`, `PublicTrafficDataReportContext`, `BotResponse`, `findLatestReportContext()`, and `handleBotIntent()` boundaries. Registry lookup accepts `AgentIntent` and returns no tool for `unknown`, matching the spec.
