# Daily Mission 自循环（Plan 模式）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Phase 1 的台账骨架激活成一个能自循环空跑的每日运营流程（plan 模式：自动跑到生成审批卡，执行由人工审批触发）。

**Architecture:** 确定性状态机 Orchestrator 串联 collect → plan → approval，其中只有「分析」一环调用可插拔的 DecisionBuilder（先规则版、后 LLM 版）。所有写操作复用现有确认卡链路。每个操作事件带 `subject/decisionId/runId` 归因锚点，为将来的数据飞轮回边预留。

**Tech Stack:** TypeScript (ESM, `.js` import 后缀), vitest, 复用现有 `LlmProvider` 抽象、Operation Ledger、DailyMissionRun 状态机。

## Global Constraints

- 所有 import 使用 `.js` 后缀（项目 ESM 约定）。
- 写操作一律走人工审批；本阶段不做任何自动执行放开。
- LLM 只产候选决策；本地代码做 schema 校验、风险分类、工具参数复核。
- 每个 Ledger 事件必须携带 `subject`、`decisionId`、`runId`、`at`（飞轮归因锚点）。
- `CollectedContext` 用可选字段 + `missingSources`，不写死数据源全集（为市场价等未来源预留）。
- 测试用 `FakeLlmProvider`，不调真实 LLM。
- 运行测试：`npx vitest run <file> --exclude '**/.worktrees/**'`（在 worktree 内，node 向上解析父级 node_modules）。
- 类型检查：`npx tsc -p tsconfig.json --noEmit`（期望 exit 0）。

---

### Task 1: 给 Operation 事件补归因锚点

**Files:**
- Modify: `src/agentRuntime/operationPlan.ts`
- Modify: `src/agentRuntime/operationLedger.ts`
- Test: `tests/operationLedgerAttribution.test.ts`

**Interfaces:**
- Consumes: 现有 `OperationPlanJournalEntry`、`appendOperationLedgerJsonlEntry`、`appendOperationPlanJournalEntry`、`loadOperationLedgerJsonlEntries`。
- Produces: 扩展后的 `OperationPlanJournalEntry`（新增可选 `runId?: string`、`decisionId?: string`、`toolName?: string`、`subject?: OperationSubject`）；新增 `OperationSubject`；新增 `recordOperationEvent(outputDir, entry)`（同时写 JSONL 和 daily journal store，返回 entry）。

- [ ] **Step 1: 写失败测试**

Create `tests/operationLedgerAttribution.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordOperationEvent, loadOperationLedgerJsonlEntries } from '../src/agentRuntime/operationLedger.js';

describe('operation ledger attribution', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mt-ledger-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('records an event carrying subject, decisionId and runId', async () => {
    await recordOperationEvent(dir, {
      planId: 'plan-1',
      at: '2026-07-01T09:00:00.000Z',
      event: 'execution_succeeded',
      runId: 'run-1',
      decisionId: 'dec-1',
      toolName: 'rental.priceApply',
      subject: { kind: 'product', id: '648' },
    });
    const entries = await loadOperationLedgerJsonlEntries(dir, '2026-07-01');
    expect(entries).toHaveLength(1);
    expect(entries[0].subject).toEqual({ kind: 'product', id: '648' });
    expect(entries[0].decisionId).toBe('dec-1');
    expect(entries[0].runId).toBe('run-1');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/operationLedgerAttribution.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL — `recordOperationEvent` 未导出。

- [ ] **Step 3: 扩展类型**

In `src/agentRuntime/operationPlan.ts`, add before `OperationPlanJournalEntry`:

```ts
export interface OperationSubject {
  kind: 'product' | 'sameSkuGroup' | 'link';
  id: string;
  displayName?: string;
}
```

Extend `OperationPlanJournalEntry`:

```ts
export interface OperationPlanJournalEntry {
  planId: string;
  at: string;
  event: string;
  stepId?: string;
  status?: OperationPlanStepStatus;
  runId?: string;
  decisionId?: string;
  toolName?: string;
  subject?: OperationSubject;
  metadata?: Record<string, unknown>;
}
```

- [ ] **Step 4: 实现 recordOperationEvent**

In `src/agentRuntime/operationLedger.ts`, add near the other append helpers:

```ts
export async function recordOperationEvent(
  outputDir: string,
  entry: OperationPlanJournalEntry,
): Promise<OperationPlanJournalEntry> {
  await appendOperationLedgerJsonlEntry(outputDir, entry);
  await appendOperationPlanJournalEntry(outputDir, entry);
  return entry;
}
```

Add `OperationSubject` to the type import at the top:

```ts
import type { OperationPlan, OperationPlanJournalEntry, OperationSubject } from './operationPlan.js';
```

(`OperationSubject` is re-exported implicitly through `operationPlan.js`; no runtime import needed if only used as type in tests.)

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/operationLedgerAttribution.test.ts --exclude '**/.worktrees/**'`
Expected: PASS (1 test).

- [ ] **Step 6: 回归既有 ledger 测试**

Run: `npx vitest run tests/operationLedger.test.ts --exclude '**/.worktrees/**'`
Expected: PASS（新增字段是可选的，旧测试不受影响）。

- [ ] **Step 7: Commit**

```bash
git add src/agentRuntime/operationPlan.ts src/agentRuntime/operationLedger.ts tests/operationLedgerAttribution.test.ts
git commit -m "给 Operation 事件补 subject/decisionId/runId 归因锚点"
```

---

### Task 2: 把 Ledger 事件接入 rental 写操作执行

**Files:**
- Modify: `src/feishuBot/rentalWriteOperationHandlers.ts`
- Test: `tests/rentalWriteLedger.test.ts`

**Interfaces:**
- Consumes: `recordOperationEvent`（Task 1）、现有 `executeRentalWriteOperationHandler(request, client)`。
- Produces: `executeRentalWriteOperationHandler(request, client, ledgerContext?)`，新增可选第三参 `ledgerContext?: { outputDir: string; runId?: string; decisionId?: string }`；提供时在执行前后写 `execution_started` / `execution_succeeded` / `execution_failed` 事件。无 ledgerContext 时行为与现在完全一致（向后兼容）。

- [ ] **Step 1: 写失败测试**

Create `tests/rentalWriteLedger.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeRentalWriteOperationHandler } from '../src/feishuBot/rentalWriteOperationHandlers.js';
import { loadOperationLedgerJsonlEntries } from '../src/agentRuntime/operationLedger.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

function fakeClient(): RentalPriceSkillClient {
  return {
    preview: async () => ({ productId: '648', fields: {}, lines: [], warnings: [] }),
    execute: async () => ({ productId: '648', ok: true, lines: ['done'] }),
    specDiscover: async () => ({ productId: '648', ok: true, dimensions: [] }),
    copy: async () => ({ ok: true, action: 'copy', productId: '648', lines: ['copied'] }),
    delist: async () => ({ ok: true, action: 'delist', productId: '648', lines: ['delisted'] }),
    tenancySet: async () => ({ ok: true, action: 'tenancy-set', productId: '648', lines: [] }),
    specAddAndRefresh: async () => ({ ok: true, action: 'spec-add-and-refresh', productId: '648', lines: [] }),
  } as unknown as RentalPriceSkillClient;
}

describe('rental write ledger', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mt-rw-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('records execution events with attribution when ledgerContext is provided', async () => {
    await executeRentalWriteOperationHandler(
      { toolName: 'rental.delist', arguments: { productId: '648' }, reason: 'test' },
      fakeClient(),
      { outputDir: dir, runId: 'run-1', decisionId: 'dec-1' },
    );
    const date = new Date().toISOString().slice(0, 10);
    const entries = await loadOperationLedgerJsonlEntries(dir, date);
    const events = entries.map((e) => e.event);
    expect(events).toContain('execution_started');
    expect(events).toContain('execution_succeeded');
    expect(entries.every((e) => e.runId === 'run-1' && e.decisionId === 'dec-1')).toBe(true);
    expect(entries.every((e) => e.subject?.id === '648')).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/rentalWriteLedger.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL — handler 只接受 2 个参数，不写事件。

- [ ] **Step 3: 实现事件记录**

In `src/feishuBot/rentalWriteOperationHandlers.ts`, add import and a ledger-context type, then wrap execution:

```ts
import { recordOperationEvent } from '../agentRuntime/operationLedger.js';

export interface RentalWriteLedgerContext {
  outputDir: string;
  runId?: string;
  decisionId?: string;
}

async function recordWriteEvent(
  ctx: RentalWriteLedgerContext | undefined,
  event: 'execution_started' | 'execution_succeeded' | 'execution_failed',
  toolName: string,
  productId: string,
): Promise<void> {
  if (!ctx) return;
  await recordOperationEvent(ctx.outputDir, {
    planId: ctx.decisionId ?? ctx.runId ?? 'ad-hoc',
    at: new Date().toISOString(),
    event,
    toolName,
    ...(ctx.runId ? { runId: ctx.runId } : {}),
    ...(ctx.decisionId ? { decisionId: ctx.decisionId } : {}),
    subject: { kind: 'product', id: productId },
  });
}
```

Change the signature and wrap the confirm-request execution branch:

```ts
export async function executeRentalWriteOperationHandler(
  request: AgentToolConfirmRequest,
  client: RentalPriceSkillClient,
  ledgerContext?: RentalWriteLedgerContext,
): Promise<BotResponse> {
  if (request.toolName === 'rental.operationConfirmRequest') {
    const rentalRequest = rentalOperationConfirmRequestFromToolArguments(request.arguments);
    if (!rentalRequest) throw new Error('租赁商品操作参数无效，请重新发起。');
    await recordWriteEvent(ledgerContext, 'execution_started', 'rental.operationConfirmRequest', rentalRequest.productId);
    try {
      const result = await executeRentalOperationConfirmRequest(client, rentalRequest);
      await recordWriteEvent(ledgerContext, result.ok ? 'execution_succeeded' : 'execution_failed', 'rental.operationConfirmRequest', rentalRequest.productId);
      return { text: result.text };
    } catch (error) {
      await recordWriteEvent(ledgerContext, 'execution_failed', 'rental.operationConfirmRequest', rentalRequest.productId);
      throw error;
    }
  }

  const rentalRequest = rentalAgentToolRequest(request.toolName, request.arguments);
  if (!rentalRequest) throw new Error('租赁商品操作参数无效，请重新发起。');
  await recordWriteEvent(ledgerContext, 'execution_started', request.toolName, rentalRequest.productId);
  try {
    const result = await executeRentalOperationConfirmRequest(client, rentalRequest);
    await recordWriteEvent(ledgerContext, result.ok ? 'execution_succeeded' : 'execution_failed', request.toolName, rentalRequest.productId);
    return {
      text: result.text,
      metadata: { ...(result.metadata ?? {}), toolName: request.toolName, ok: result.ok, productId: rentalRequest.productId },
    };
  } catch (error) {
    await recordWriteEvent(ledgerContext, 'execution_failed', request.toolName, rentalRequest.productId);
    throw error;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/rentalWriteLedger.test.ts --exclude '**/.worktrees/**'`
Expected: PASS (1 test).

- [ ] **Step 5: 回归 executor 与既有写操作测试**

Run: `npx vitest run tests/feishuBotTools.test.ts tests/feishuBotRentalPrice.test.ts --exclude '**/.worktrees/**'`
Expected: PASS（未传 ledgerContext，旧行为不变）。

- [ ] **Step 6: Commit**

```bash
git add src/feishuBot/rentalWriteOperationHandlers.ts tests/rentalWriteLedger.test.ts
git commit -m "租赁写操作执行接入 Ledger 归因事件"
```

---

### Task 3: HotspotEventProvider 接口 + 文件实现

**Files:**
- Create: `src/agentRuntime/hotspotEvents.ts`
- Test: `tests/hotspotEvents.test.ts`

**Interfaces:**
- Produces: `HotspotEvent`、`HotspotEventProvider`、`FileHotspotEventProvider`（构造参数 `{ path: string }`）；`listEvents({ date, lookaheadDays })` 返回落在 `[date, date+lookaheadDays]` 内的事件；文件缺失/坏 JSON 返回 `[]`。

- [ ] **Step 1: 写失败测试**

Create `tests/hotspotEvents.test.ts`:

```ts
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileHotspotEventProvider } from '../src/agentRuntime/hotspotEvents.js';

describe('FileHotspotEventProvider', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mt-hot-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('returns events within the lookahead window', async () => {
    const path = join(dir, 'hotspot-events.json');
    await writeFile(path, JSON.stringify([
      { eventId: 'e1', source: 'manual', title: '演唱会A', startsAt: '2026-07-03T00:00:00.000Z', affectedCategories: ['相机'], confidence: 'high' },
      { eventId: 'e2', source: 'manual', title: '演唱会B', startsAt: '2026-07-20T00:00:00.000Z', affectedCategories: ['相机'], confidence: 'low' },
    ]), 'utf8');
    const provider = new FileHotspotEventProvider({ path });
    const events = await provider.listEvents({ date: '2026-07-01', lookaheadDays: 7 });
    expect(events.map((e) => e.eventId)).toEqual(['e1']);
  });

  it('returns empty when file is missing', async () => {
    const provider = new FileHotspotEventProvider({ path: join(dir, 'nope.json') });
    expect(await provider.listEvents({ date: '2026-07-01', lookaheadDays: 7 })).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/hotspotEvents.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**

Create `src/agentRuntime/hotspotEvents.ts`:

```ts
import { readFile } from 'node:fs/promises';

export interface HotspotEvent {
  eventId: string;
  source: 'manual' | 'feishu' | 'api';
  title: string;
  startsAt: string;
  endsAt?: string;
  city?: string;
  venue?: string;
  affectedCategories: string[];
  heatScore?: number;
  confidence: 'low' | 'medium' | 'high';
  rawRef?: string;
}

export interface HotspotEventProvider {
  listEvents(input: { date: string; lookaheadDays: number }): Promise<HotspotEvent[]>;
}

function isHotspotEvent(value: unknown): value is HotspotEvent {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.eventId === 'string' && typeof v.title === 'string' && typeof v.startsAt === 'string' && Array.isArray(v.affectedCategories);
}

export class FileHotspotEventProvider implements HotspotEventProvider {
  constructor(private readonly options: { path: string }) {}

  async listEvents(input: { date: string; lookaheadDays: number }): Promise<HotspotEvent[]> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(this.options.path, 'utf8'));
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    const events = parsed.filter(isHotspotEvent);
    const start = new Date(`${input.date}T00:00:00.000Z`).getTime();
    const end = start + input.lookaheadDays * 24 * 60 * 60 * 1000;
    return events.filter((event) => {
      const at = new Date(event.startsAt).getTime();
      return Number.isFinite(at) && at >= start && at <= end;
    });
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/hotspotEvents.test.ts --exclude '**/.worktrees/**'`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agentRuntime/hotspotEvents.ts tests/hotspotEvents.test.ts
git commit -m "新增 HotspotEventProvider 接口与文件实现"
```

---

### Task 4: CollectedContext 类型 + Collector 汇总

**Files:**
- Create: `src/agentRuntime/dailyMissionContext.ts`
- Test: `tests/dailyMissionContext.test.ts`

**Interfaces:**
- Consumes: `HotspotEvent`（Task 3）、`OperationPlanJournalEntry`（Task 1）、`loadOperationLedgerJsonlEntries`。
- Produces: `CollectedContext`、`ContextCollector`（`collect(input): Promise<Partial<CollectedContext>>`）、`collectDailyMissionContext(collectors, input)`（并行跑所有 collector、合并、失败标记 `missingSources`、恒返回合法 `CollectedContext`）、`collectRecentOperations(outputDir, date, lookbackDays)`。

- [ ] **Step 1: 写失败测试**

Create `tests/dailyMissionContext.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { collectDailyMissionContext, type ContextCollector } from '../src/agentRuntime/dailyMissionContext.js';

describe('collectDailyMissionContext', () => {
  const base = { runId: 'run-1', date: '2026-07-01', outputDir: '/tmp/x' };

  it('merges collector outputs into a single context', async () => {
    const collectors: ContextCollector[] = [
      { name: 'exposure', collect: async () => ({ exposure: { summary: 'ok' } }) },
      { name: 'hotspots', collect: async () => ({ hotspots: [] }) },
    ];
    const ctx = await collectDailyMissionContext(collectors, base);
    expect(ctx.runId).toBe('run-1');
    expect(ctx.exposure).toEqual({ summary: 'ok' });
    expect(ctx.missingSources).toEqual([]);
  });

  it('records missingSources when a collector throws', async () => {
    const collectors: ContextCollector[] = [
      { name: 'sales', collect: async () => { throw new Error('boom'); } },
    ];
    const ctx = await collectDailyMissionContext(collectors, base);
    expect(ctx.missingSources).toContain('sales');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/dailyMissionContext.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**

Create `src/agentRuntime/dailyMissionContext.ts`:

```ts
import type { HotspotEvent } from './hotspotEvents.js';
import type { OperationPlanJournalEntry } from './operationPlan.js';
import { loadOperationLedgerJsonlEntries } from './operationLedger.js';

export interface CollectedContext {
  runId: string;
  date: string;
  collectedAt: string;
  exposure?: Record<string, unknown>;
  sales?: Record<string, unknown>;
  recentOperations?: OperationPlanJournalEntry[];
  hotspots?: HotspotEvent[];
  missingSources: string[];
}

export interface ContextCollectorInput {
  runId: string;
  date: string;
  outputDir: string;
}

export interface ContextCollector {
  name: string;
  collect(input: ContextCollectorInput): Promise<Partial<CollectedContext>>;
}

export async function collectRecentOperations(
  outputDir: string,
  date: string,
  lookbackDays: number,
): Promise<OperationPlanJournalEntry[]> {
  const end = new Date(`${date}T00:00:00.000Z`).getTime();
  const entries: OperationPlanJournalEntry[] = [];
  for (let i = 0; i < lookbackDays; i += 1) {
    const day = new Date(end - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    entries.push(...await loadOperationLedgerJsonlEntries(outputDir, day));
  }
  return entries;
}

export async function collectDailyMissionContext(
  collectors: ContextCollector[],
  input: ContextCollectorInput,
): Promise<CollectedContext> {
  const missingSources: string[] = [];
  const merged: CollectedContext = {
    runId: input.runId,
    date: input.date,
    collectedAt: new Date().toISOString(),
    missingSources,
  };
  const results = await Promise.allSettled(collectors.map((collector) => collector.collect(input)));
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      Object.assign(merged, result.value);
    } else {
      missingSources.push(collectors[index].name);
    }
  });
  merged.missingSources = missingSources;
  return merged;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/dailyMissionContext.test.ts --exclude '**/.worktrees/**'`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agentRuntime/dailyMissionContext.ts tests/dailyMissionContext.test.ts
git commit -m "新增 CollectedContext 与 Collector 汇总（失败标记 missingSources）"
```

---

### Task 5: DecisionRecord 契约 + DecisionPolicy

**Files:**
- Create: `src/agentRuntime/decisionRecord.ts`
- Create: `src/agentRuntime/decisionPolicy.ts`
- Test: `tests/decisionPolicy.test.ts`

**Interfaces:**
- Produces: `DecisionRecord`、`DecisionRecommendation`、`DecisionRisk`、`DecisionSubject`、`isValidDecisionRecord(value)`;`classifyDecisions(records): { observations, approvals }`——`recommendation==='approve_to_execute'` 且证据充分（`evidenceRefs.length>0` 且 `uncertainties.length===0`）且带 `proposedTool` 才进 approvals，否则降级进 observations 并标 `blockedReason`。

- [ ] **Step 1: 写失败测试**

Create `tests/decisionPolicy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { classifyDecisions } from '../src/agentRuntime/decisionPolicy.js';
import type { DecisionRecord } from '../src/agentRuntime/decisionRecord.js';

function record(over: Partial<DecisionRecord>): DecisionRecord {
  return {
    decisionId: 'd', runId: 'r', title: 't', subjects: [{ kind: 'product', id: '648' }],
    operationType: 'price_down', recommendation: 'approve_to_execute', risk: 'write',
    rationale: ['因为曝光下降'], evidenceRefs: ['exposure'], uncertainties: [],
    proposedTool: { toolName: 'rental.pricePreview', arguments: { productIds: ['648'] } },
    ...over,
  };
}

describe('classifyDecisions', () => {
  it('routes a well-evidenced executable decision into approvals', () => {
    const { approvals, observations } = classifyDecisions([record({})]);
    expect(approvals).toHaveLength(1);
    expect(observations).toHaveLength(0);
  });

  it('downgrades an executable decision with uncertainties to observation', () => {
    const { approvals, observations } = classifyDecisions([record({ uncertainties: ['不确定库存'] })]);
    expect(approvals).toHaveLength(0);
    expect(observations).toHaveLength(1);
    expect(observations[0].blockedReason).toBeTruthy();
  });

  it('keeps observe recommendations as observations', () => {
    const { observations } = classifyDecisions([record({ recommendation: 'observe' })]);
    expect(observations).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/decisionPolicy.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现契约**

Create `src/agentRuntime/decisionRecord.ts`:

```ts
export type DecisionRecommendation = 'observe' | 'approve_to_execute' | 'skip';
export type DecisionRisk = 'read' | 'write' | 'high';

export interface DecisionSubject {
  kind: 'product' | 'sameSkuGroup' | 'link';
  id: string;
  displayName?: string;
}

export interface DecisionRecord {
  decisionId: string;
  runId: string;
  title: string;
  subjects: DecisionSubject[];
  operationType: 'price_up' | 'price_down' | 'new_link' | 'delist' | 'observe';
  recommendation: DecisionRecommendation;
  risk: DecisionRisk;
  rationale: string[];
  evidenceRefs: string[];
  proposedTool?: { toolName: string; arguments: Record<string, unknown> };
  uncertainties: string[];
  blockedReason?: string;
}

const RECOMMENDATIONS: DecisionRecommendation[] = ['observe', 'approve_to_execute', 'skip'];

export function isValidDecisionRecord(value: unknown): value is DecisionRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.decisionId === 'string'
    && typeof v.title === 'string'
    && Array.isArray(v.subjects)
    && typeof v.recommendation === 'string'
    && RECOMMENDATIONS.includes(v.recommendation as DecisionRecommendation)
    && Array.isArray(v.rationale)
    && Array.isArray(v.evidenceRefs)
    && Array.isArray(v.uncertainties);
}
```

- [ ] **Step 4: 实现 policy**

Create `src/agentRuntime/decisionPolicy.ts`:

```ts
import type { DecisionRecord } from './decisionRecord.js';

export interface ClassifiedDecisions {
  approvals: DecisionRecord[];
  observations: DecisionRecord[];
}

export function classifyDecisions(records: DecisionRecord[]): ClassifiedDecisions {
  const approvals: DecisionRecord[] = [];
  const observations: DecisionRecord[] = [];
  for (const record of records) {
    const executable = record.recommendation === 'approve_to_execute';
    const evidenced = record.evidenceRefs.length > 0 && record.uncertainties.length === 0;
    const hasTool = Boolean(record.proposedTool);
    if (executable && evidenced && hasTool) {
      approvals.push(record);
    } else if (executable) {
      const reason = !hasTool ? '缺少可执行工具参数' : record.uncertainties.length > 0 ? '存在不确定项' : '证据不足';
      observations.push({ ...record, recommendation: 'observe', blockedReason: reason });
    } else {
      observations.push(record);
    }
  }
  return { approvals, observations };
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/decisionPolicy.test.ts --exclude '**/.worktrees/**'`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/agentRuntime/decisionRecord.ts src/agentRuntime/decisionPolicy.ts tests/decisionPolicy.test.ts
git commit -m "新增 DecisionRecord 契约与 DecisionPolicy 分流"
```

---

### Task 6: RuleBasedDecisionBuilder（确定性回退）

**Files:**
- Create: `src/agentRuntime/decisionBuilder.ts`
- Test: `tests/ruleBasedDecisionBuilder.test.ts`

**Interfaces:**
- Consumes: `CollectedContext`（Task 4）、`DecisionRecord`（Task 5）。
- Produces: `DecisionBuilder`（`build(context): Promise<DecisionRecord[]>`）、`RuleBasedDecisionBuilder`。本阶段规则：对每个热点事件产出一条 `observe` 决策（"热点临近，观察相关品类"），保证循环在无 LLM 时也能产出非空且安全（全观察）的决策集。

- [ ] **Step 1: 写失败测试**

Create `tests/ruleBasedDecisionBuilder.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { RuleBasedDecisionBuilder } from '../src/agentRuntime/decisionBuilder.js';
import type { CollectedContext } from '../src/agentRuntime/dailyMissionContext.js';

describe('RuleBasedDecisionBuilder', () => {
  it('produces one observe decision per hotspot', async () => {
    const context: CollectedContext = {
      runId: 'run-1', date: '2026-07-01', collectedAt: '2026-07-01T09:00:00.000Z',
      missingSources: [],
      hotspots: [{ eventId: 'e1', source: 'manual', title: '演唱会A', startsAt: '2026-07-03T00:00:00.000Z', affectedCategories: ['相机'], confidence: 'high' }],
    };
    const builder = new RuleBasedDecisionBuilder();
    const decisions = await builder.build(context);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].recommendation).toBe('observe');
    expect(decisions[0].runId).toBe('run-1');
  });

  it('returns empty when there is no hotspot context', async () => {
    const context: CollectedContext = { runId: 'r', date: '2026-07-01', collectedAt: 'x', missingSources: [] };
    expect(await new RuleBasedDecisionBuilder().build(context)).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/ruleBasedDecisionBuilder.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**

Create `src/agentRuntime/decisionBuilder.ts`:

```ts
import type { CollectedContext } from './dailyMissionContext.js';
import type { DecisionRecord } from './decisionRecord.js';

export interface DecisionBuilder {
  build(context: CollectedContext): Promise<DecisionRecord[]>;
}

export class RuleBasedDecisionBuilder implements DecisionBuilder {
  async build(context: CollectedContext): Promise<DecisionRecord[]> {
    const hotspots = context.hotspots ?? [];
    return hotspots.map((event, index) => ({
      decisionId: `${context.runId}-obs-${index + 1}`,
      runId: context.runId,
      title: `热点临近：${event.title}`,
      subjects: event.affectedCategories.map((category) => ({ kind: 'product' as const, id: category, displayName: category })),
      operationType: 'observe' as const,
      recommendation: 'observe' as const,
      risk: 'read' as const,
      rationale: [`热点事件 ${event.title} 将在 ${event.startsAt} 开始，建议观察相关品类。`],
      evidenceRefs: [`hotspots.${event.eventId}`],
      uncertainties: [],
    }));
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/ruleBasedDecisionBuilder.test.ts --exclude '**/.worktrees/**'`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agentRuntime/decisionBuilder.ts tests/ruleBasedDecisionBuilder.test.ts
git commit -m "新增 RuleBasedDecisionBuilder 确定性回退"
```

---

### Task 7: LlmDecisionBuilder（复用 LlmProvider）

**Files:**
- Modify: `src/agentRuntime/decisionBuilder.ts`
- Test: `tests/llmDecisionBuilder.test.ts`

**Interfaces:**
- Consumes: `LlmProvider`（`src/llm/provider.ts`）、`isValidDecisionRecord`（Task 5）、`CollectedContext`。
- Produces: `LlmDecisionBuilder`（构造 `{ provider: LlmProvider }`）。行为：把 context 序列化进 prompt，要求返回 `{ "decisions": DecisionRecord[] }`;对每条用 `isValidDecisionRecord` 校验，非法条目丢弃;所有产出强制 `runId = context.runId`;LLM 返回非数组或全非法时返回 `[]`（绝不抛错、绝不生成执行请求）。

- [ ] **Step 1: 写失败测试**

Create `tests/llmDecisionBuilder.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { LlmDecisionBuilder } from '../src/agentRuntime/decisionBuilder.js';
import { FakeLlmProvider } from '../src/llm/fakeProvider.js';
import type { CollectedContext } from '../src/agentRuntime/dailyMissionContext.js';

const context: CollectedContext = { runId: 'run-9', date: '2026-07-01', collectedAt: 'x', missingSources: [] };

describe('LlmDecisionBuilder', () => {
  it('parses valid decisions and forces runId', async () => {
    const provider = new FakeLlmProvider(JSON.stringify({ decisions: [{
      decisionId: 'd1', runId: 'WRONG', title: '降价', subjects: [{ kind: 'product', id: '648' }],
      operationType: 'price_down', recommendation: 'observe', risk: 'read',
      rationale: ['曝光下降'], evidenceRefs: ['exposure'], uncertainties: [],
    }] }));
    const decisions = await new LlmDecisionBuilder({ provider }).build(context);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].runId).toBe('run-9');
  });

  it('drops invalid decisions and never throws', async () => {
    const provider = new FakeLlmProvider(JSON.stringify({ decisions: [{ nonsense: true }] }));
    expect(await new LlmDecisionBuilder({ provider }).build(context)).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/llmDecisionBuilder.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL — `LlmDecisionBuilder` 未导出。

- [ ] **Step 3: 实现**

Append to `src/agentRuntime/decisionBuilder.ts`:

```ts
import type { LlmProvider } from '../llm/provider.js';
import { isValidDecisionRecord } from './decisionRecord.js';

const DECISION_SYSTEM_PROMPT = [
  '你是租赁商品运营决策助手。基于给定的运营上下文 JSON，产出结构化决策。',
  '只输出 JSON，形如 {"decisions": DecisionRecord[]}。',
  '每条 DecisionRecord 必含 decisionId, runId, title, subjects, operationType, recommendation, risk, rationale, evidenceRefs, uncertainties。',
  'recommendation 取值 observe|approve_to_execute|skip；不确定时用 observe。evidenceRefs 必须引用上下文中的字段。',
].join('\n');

export class LlmDecisionBuilder implements DecisionBuilder {
  constructor(private readonly options: { provider: LlmProvider }) {}

  async build(context: CollectedContext): Promise<DecisionRecord[]> {
    const result = await this.options.provider.generateJson({
      messages: [
        { role: 'system', content: DECISION_SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(context) },
      ],
      temperature: 0,
    });
    const raw = result.json.decisions;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(isValidDecisionRecord)
      .map((record) => ({ ...record, runId: context.runId }));
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/llmDecisionBuilder.test.ts tests/ruleBasedDecisionBuilder.test.ts --exclude '**/.worktrees/**'`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agentRuntime/decisionBuilder.ts tests/llmDecisionBuilder.test.ts
git commit -m "新增 LlmDecisionBuilder（复用 LlmProvider，非法降级不执行）"
```

---

### Task 8: DailyMissionOrchestrator（plan 模式）

**Files:**
- Create: `src/agentRuntime/dailyMissionOrchestrator.ts`
- Test: `tests/dailyMissionOrchestrator.test.ts`

**Interfaces:**
- Consumes: `createDailyMissionRun`/`transitionDailyMissionRun`/`saveDailyMissionRun`、`collectDailyMissionContext`、`DecisionBuilder`、`classifyDecisions`、`recordOperationEvent`、`dailyMissionArtifactPath`。
- Produces: `runDailyMissionPlan(input)`，`input: { outputDir, date, runId, trigger, collectors, decisionBuilder }`;跑 collecting→planning→waiting_approval，写 collected-context.json / decisions.json / approval-request.json，写 `data_collected` / `decision_created` / `approval_requested` 事件，返回 `{ run, context, decisions, classified }`;**不执行任何写操作**。

- [ ] **Step 1: 写失败测试**

Create `tests/dailyMissionOrchestrator.test.ts`:

```ts
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDailyMissionPlan } from '../src/agentRuntime/dailyMissionOrchestrator.js';
import { RuleBasedDecisionBuilder } from '../src/agentRuntime/decisionBuilder.js';
import { loadOperationLedgerJsonlEntries } from '../src/agentRuntime/operationLedger.js';
import type { ContextCollector } from '../src/agentRuntime/dailyMissionContext.js';

describe('runDailyMissionPlan', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mt-orch-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('runs collect→plan→waiting_approval and writes artifacts + events', async () => {
    const collectors: ContextCollector[] = [
      { name: 'hotspots', collect: async () => ({ hotspots: [{ eventId: 'e1', source: 'manual', title: '演唱会A', startsAt: '2026-07-03T00:00:00.000Z', affectedCategories: ['相机'], confidence: 'high' }] }) },
    ];
    const result = await runDailyMissionPlan({
      outputDir: dir, date: '2026-07-01', runId: 'run-1', trigger: 'manual',
      collectors, decisionBuilder: new RuleBasedDecisionBuilder(),
    });
    expect(result.run.status).toBe('waiting_approval');
    expect(result.decisions.length).toBeGreaterThan(0);

    const ctxRaw = await readFile(join(dir, 'daily-mission', '2026-07-01', 'collected-context.json'), 'utf8');
    expect(JSON.parse(ctxRaw).runId).toBe('run-1');

    const events = (await loadOperationLedgerJsonlEntries(dir, '2026-07-01')).map((e) => e.event);
    expect(events).toContain('data_collected');
    expect(events).toContain('decision_created');
    expect(events).toContain('approval_requested');
    expect(events).not.toContain('execution_started');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/dailyMissionOrchestrator.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**

Create `src/agentRuntime/dailyMissionOrchestrator.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { collectDailyMissionContext, type CollectedContext, type ContextCollector } from './dailyMissionContext.js';
import { classifyDecisions, type ClassifiedDecisions } from './decisionPolicy.js';
import type { DecisionBuilder } from './decisionBuilder.js';
import type { DecisionRecord } from './decisionRecord.js';
import { dailyMissionArtifactPath } from './dailyMissionArtifacts.js';
import { recordOperationEvent } from './operationLedger.js';
import { addDailyMissionArtifact, createDailyMissionRun, saveDailyMissionRun, transitionDailyMissionRun, type DailyMissionRun, type DailyMissionRunTrigger } from './dailyMissionRun.js';

export interface RunDailyMissionPlanInput {
  outputDir: string;
  date: string;
  runId: string;
  trigger: DailyMissionRunTrigger;
  collectors: ContextCollector[];
  decisionBuilder: DecisionBuilder;
}

export interface RunDailyMissionPlanResult {
  run: DailyMissionRun;
  context: CollectedContext;
  decisions: DecisionRecord[];
  classified: ClassifiedDecisions;
}

async function writeArtifact(outputDir: string, date: string, name: Parameters<typeof dailyMissionArtifactPath>[2], value: unknown): Promise<string> {
  const path = dailyMissionArtifactPath(outputDir, date, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return path;
}

export async function runDailyMissionPlan(input: RunDailyMissionPlanInput): Promise<RunDailyMissionPlanResult> {
  const now = () => new Date().toISOString();
  let run = createDailyMissionRun({ runId: input.runId, date: input.date, trigger: input.trigger, startedAt: now() });

  const context = await collectDailyMissionContext(input.collectors, { runId: input.runId, date: input.date, outputDir: input.outputDir });
  const ctxPath = await writeArtifact(input.outputDir, input.date, 'collectedContext', context);
  run = addDailyMissionArtifact(run, { type: 'collectedContext', path: ctxPath });
  await recordOperationEvent(input.outputDir, { planId: input.runId, at: now(), event: 'data_collected', runId: input.runId });

  run = transitionDailyMissionRun(run, 'planning', now());
  const decisions = await input.decisionBuilder.build(context);
  const decPath = await writeArtifact(input.outputDir, input.date, 'decisions', decisions);
  run = addDailyMissionArtifact(run, { type: 'decisions', path: decPath });
  for (const decision of decisions) {
    await recordOperationEvent(input.outputDir, { planId: decision.decisionId, at: now(), event: 'decision_created', runId: input.runId, decisionId: decision.decisionId, subject: decision.subjects[0] });
  }

  const classified = classifyDecisions(decisions);
  const apPath = await writeArtifact(input.outputDir, input.date, 'approvalRequest', classified);
  run = addDailyMissionArtifact(run, { type: 'approvalRequest', path: apPath });

  run = transitionDailyMissionRun(run, 'waiting_approval', now());
  for (const decision of classified.approvals) {
    await recordOperationEvent(input.outputDir, { planId: decision.decisionId, at: now(), event: 'approval_requested', runId: input.runId, decisionId: decision.decisionId, subject: decision.subjects[0] });
  }
  await saveDailyMissionRun(input.outputDir, run);
  return { run, context, decisions, classified };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/dailyMissionOrchestrator.test.ts --exclude '**/.worktrees/**'`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/agentRuntime/dailyMissionOrchestrator.ts tests/dailyMissionOrchestrator.test.ts
git commit -m "新增 DailyMissionOrchestrator（plan 模式，跑到 waiting_approval 不执行写操作）"
```

---

### Task 9: JournalWriter

**Files:**
- Create: `src/agentRuntime/dailyJournalWriter.ts`
- Test: `tests/dailyJournalWriter.test.ts`

**Interfaces:**
- Consumes: `CollectedContext`、`DecisionRecord`、`ClassifiedDecisions`、`dailyMissionArtifactPath`、`recordOperationEvent`。
- Produces: `writeDailyJournal(input)`，`input: { outputDir, date, runId, context, decisions, classified }`;写 `daily-journal.json` 和 `daily-journal.md`，写 `journal_written` 事件，返回 `{ jsonPath, markdownPath }`。

- [ ] **Step 1: 写失败测试**

Create `tests/dailyJournalWriter.test.ts`:

```ts
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeDailyJournal } from '../src/agentRuntime/dailyJournalWriter.js';

describe('writeDailyJournal', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mt-journal-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('writes json and markdown journals', async () => {
    const { jsonPath, markdownPath } = await writeDailyJournal({
      outputDir: dir, date: '2026-07-01', runId: 'run-1',
      context: { runId: 'run-1', date: '2026-07-01', collectedAt: 'x', missingSources: ['sales'] },
      decisions: [],
      classified: { approvals: [], observations: [] },
    });
    const md = await readFile(markdownPath, 'utf8');
    expect(md).toContain('2026-07-01');
    expect(md).toContain('缺失数据源');
    const json = JSON.parse(await readFile(jsonPath, 'utf8'));
    expect(json.runId).toBe('run-1');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/dailyJournalWriter.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**

Create `src/agentRuntime/dailyJournalWriter.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { CollectedContext } from './dailyMissionContext.js';
import type { ClassifiedDecisions } from './decisionPolicy.js';
import type { DecisionRecord } from './decisionRecord.js';
import { dailyMissionArtifactPath } from './dailyMissionArtifacts.js';
import { recordOperationEvent } from './operationLedger.js';

export interface WriteDailyJournalInput {
  outputDir: string;
  date: string;
  runId: string;
  context: CollectedContext;
  decisions: DecisionRecord[];
  classified: ClassifiedDecisions;
}

export interface DailyJournalPaths {
  jsonPath: string;
  markdownPath: string;
}

function renderMarkdown(input: WriteDailyJournalInput): string {
  const { date, context, classified } = input;
  return [
    `# 运营日报 ${date}`,
    '',
    `- 数据源缺失：${context.missingSources.length ? context.missingSources.join('、') : '无'}`,
    `- 热点事件：${(context.hotspots ?? []).map((h) => h.title).join('、') || '无'}`,
    `- 待审批执行项：${classified.approvals.length}`,
    `- 观察项：${classified.observations.length}`,
    '',
    '## 观察项',
    ...(classified.observations.map((d) => `- ${d.title}${d.blockedReason ? `（${d.blockedReason}）` : ''}`)),
    '',
    '## 待审批执行项',
    ...(classified.approvals.map((d) => `- ${d.title} → ${d.proposedTool?.toolName ?? ''}`)),
  ].join('\n');
}

export async function writeDailyJournal(input: WriteDailyJournalInput): Promise<DailyJournalPaths> {
  const jsonPath = dailyMissionArtifactPath(input.outputDir, input.date, 'dailyJournalJson');
  const markdownPath = dailyMissionArtifactPath(input.outputDir, input.date, 'dailyJournalMarkdown');
  await mkdir(dirname(jsonPath), { recursive: true });
  const journal = {
    runId: input.runId,
    date: input.date,
    missingSources: input.context.missingSources,
    decisions: input.decisions,
    approvals: input.classified.approvals.map((d) => d.decisionId),
    observations: input.classified.observations.map((d) => d.decisionId),
  };
  await writeFile(jsonPath, `${JSON.stringify(journal, null, 2)}\n`, 'utf8');
  await writeFile(markdownPath, `${renderMarkdown(input)}\n`, 'utf8');
  await recordOperationEvent(input.outputDir, { planId: input.runId, at: new Date().toISOString(), event: 'journal_written', runId: input.runId });
  return { jsonPath, markdownPath };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/dailyJournalWriter.test.ts --exclude '**/.worktrees/**'`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/agentRuntime/dailyJournalWriter.ts tests/dailyJournalWriter.test.ts
git commit -m "新增 JournalWriter（写 daily-journal.json/md 与 journal_written 事件）"
```

---

### Task 10: CLI 触发 + 审计查询

**Files:**
- Create: `src/cli/dailyMissionRun.ts`
- Create: `src/cli/dailyMissionAudit.ts`
- Modify: `package.json`（scripts）
- Test: `tests/dailyMissionAudit.test.ts`

**Interfaces:**
- Consumes: `runDailyMissionPlan`、`writeDailyJournal`、`FileHotspotEventProvider`、`RuleBasedDecisionBuilder`、`loadOperationLedgerJsonlEntries`、`loadDailyMissionRun`。
- Produces: `buildDailyMissionAuditSummary(outputDir, date)`（纯函数，读 ledger + mission run，返回 `{ date, status, events, approvals, executions }` 摘要文本行）;两个 CLI 入口调用它。CLI 采用与现有 `src/cli/*.ts` 一致的顶层 async 执行风格。

- [ ] **Step 1: 写失败测试（审计摘要纯函数）**

Create `tests/dailyMissionAudit.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildDailyMissionAuditSummary } from '../src/cli/dailyMissionAudit.js';
import { recordOperationEvent } from '../src/agentRuntime/operationLedger.js';

describe('buildDailyMissionAuditSummary', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mt-audit-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('summarizes ledger events for a date', async () => {
    await recordOperationEvent(dir, { planId: 'p', at: '2026-07-01T09:00:00.000Z', event: 'decision_created', runId: 'run-1', decisionId: 'd1' });
    await recordOperationEvent(dir, { planId: 'p', at: '2026-07-01T09:05:00.000Z', event: 'approval_requested', runId: 'run-1', decisionId: 'd1' });
    const summary = await buildDailyMissionAuditSummary(dir, '2026-07-01');
    expect(summary.eventCounts.decision_created).toBe(1);
    expect(summary.eventCounts.approval_requested).toBe(1);
    expect(summary.lines.join('\n')).toContain('2026-07-01');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/dailyMissionAudit.test.ts --exclude '**/.worktrees/**'`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现审计模块**

Create `src/cli/dailyMissionAudit.ts`:

```ts
import { loadOperationLedgerJsonlEntries } from '../agentRuntime/operationLedger.js';
import { loadDailyMissionRun } from '../agentRuntime/dailyMissionRun.js';

export interface DailyMissionAuditSummary {
  date: string;
  status: string;
  eventCounts: Record<string, number>;
  lines: string[];
}

export async function buildDailyMissionAuditSummary(outputDir: string, date: string): Promise<DailyMissionAuditSummary> {
  const entries = await loadOperationLedgerJsonlEntries(outputDir, date);
  const run = await loadDailyMissionRun(outputDir, date);
  const eventCounts: Record<string, number> = {};
  for (const entry of entries) eventCounts[entry.event] = (eventCounts[entry.event] ?? 0) + 1;
  const lines = [
    `Daily Mission 审计：${date}`,
    `状态：${run?.status ?? '无 run'}`,
    `事件总数：${entries.length}`,
    ...Object.entries(eventCounts).map(([event, count]) => `- ${event}: ${count}`),
  ];
  return { date, status: run?.status ?? 'none', eventCounts, lines };
}

async function main(): Promise<void> {
  const dateArg = process.argv.find((arg) => arg.startsWith('--date='))?.split('=')[1];
  const outputDir = process.env.MT_OUTPUT_DIR ?? 'output';
  const date = dateArg ?? new Date().toISOString().slice(0, 10);
  const summary = await buildDailyMissionAuditSummary(outputDir, date);
  console.log(summary.lines.join('\n'));
}

if (process.argv[1] && process.argv[1].endsWith('dailyMissionAudit.ts')) {
  void main();
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/dailyMissionAudit.test.ts --exclude '**/.worktrees/**'`
Expected: PASS (1 test).

- [ ] **Step 5: 实现 run CLI**

Create `src/cli/dailyMissionRun.ts`:

```ts
import { join } from 'node:path';
import { runDailyMissionPlan } from '../agentRuntime/dailyMissionOrchestrator.js';
import { writeDailyJournal } from '../agentRuntime/dailyJournalWriter.js';
import { RuleBasedDecisionBuilder } from '../agentRuntime/decisionBuilder.js';
import { FileHotspotEventProvider } from '../agentRuntime/hotspotEvents.js';
import type { ContextCollector } from '../agentRuntime/dailyMissionContext.js';

async function main(): Promise<void> {
  const dateArg = process.argv.find((arg) => arg.startsWith('--date='))?.split('=')[1];
  const outputDir = process.env.MT_OUTPUT_DIR ?? 'output';
  const date = dateArg ?? new Date().toISOString().slice(0, 10);
  const runId = `run-${date}-${Date.now()}`;

  const hotspotProvider = new FileHotspotEventProvider({ path: join(outputDir, 'daily-mission', date, 'hotspot-events.json') });
  const collectors: ContextCollector[] = [
    { name: 'hotspots', collect: async () => ({ hotspots: await hotspotProvider.listEvents({ date, lookaheadDays: 7 }) }) },
  ];

  const result = await runDailyMissionPlan({ outputDir, date, runId, trigger: 'manual', collectors, decisionBuilder: new RuleBasedDecisionBuilder() });
  await writeDailyJournal({ outputDir, date, runId, context: result.context, decisions: result.decisions, classified: result.classified });
  console.log(`Daily Mission plan 完成：${date}，状态 ${result.run.status}，待审批 ${result.classified.approvals.length} 项，观察 ${result.classified.observations.length} 项。`);
}

void main();
```

- [ ] **Step 6: 加 package.json scripts**

In `package.json` `scripts`, add:

```json
    "daily-mission-run": "tsx src/cli/dailyMissionRun.ts",
    "daily-mission-audit": "tsx src/cli/dailyMissionAudit.ts",
```

- [ ] **Step 7: 冒烟运行 run CLI**

Run: `MT_OUTPUT_DIR=$(mktemp -d) npx tsx src/cli/dailyMissionRun.ts --date=2026-07-01`
Expected: 打印 "Daily Mission plan 完成：2026-07-01，状态 waiting_approval，待审批 0 项，观察 0 项。"（无热点文件时观察 0）。

- [ ] **Step 8: Commit**

```bash
git add src/cli/dailyMissionRun.ts src/cli/dailyMissionAudit.ts package.json tests/dailyMissionAudit.test.ts
git commit -m "新增 dailyMission run/audit CLI 入口"
```

---

### Task 11: 集成回归 + 类型检查

**Files:**
- Test: `tests/dailyMissionIntegration.test.ts`

**Interfaces:**
- Consumes: `runDailyMissionPlan`、`writeDailyJournal`、`RuleBasedDecisionBuilder`、`FileHotspotEventProvider`、`loadOperationLedgerJsonlEntries`。
- Produces: 一个端到端集成测试，模拟一天 plan run，断言产物齐全、无写操作被自动执行、journal 生成。

- [ ] **Step 1: 写集成测试**

Create `tests/dailyMissionIntegration.test.ts`:

```ts
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDailyMissionPlan } from '../src/agentRuntime/dailyMissionOrchestrator.js';
import { writeDailyJournal } from '../src/agentRuntime/dailyJournalWriter.js';
import { RuleBasedDecisionBuilder } from '../src/agentRuntime/decisionBuilder.js';
import { FileHotspotEventProvider } from '../src/agentRuntime/hotspotEvents.js';
import { loadOperationLedgerJsonlEntries } from '../src/agentRuntime/operationLedger.js';
import type { ContextCollector } from '../src/agentRuntime/dailyMissionContext.js';

describe('daily mission integration', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mt-int-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('runs a full plan cycle without executing any write op', async () => {
    const hotspotDir = join(dir, 'daily-mission', '2026-07-01');
    await mkdir(hotspotDir, { recursive: true });
    await writeFile(join(hotspotDir, 'hotspot-events.json'), JSON.stringify([
      { eventId: 'e1', source: 'manual', title: '演唱会A', startsAt: '2026-07-03T00:00:00.000Z', affectedCategories: ['相机'], confidence: 'high' },
    ]), 'utf8');

    const provider = new FileHotspotEventProvider({ path: join(hotspotDir, 'hotspot-events.json') });
    const collectors: ContextCollector[] = [
      { name: 'hotspots', collect: async () => ({ hotspots: await provider.listEvents({ date: '2026-07-01', lookaheadDays: 7 }) }) },
    ];
    const result = await runDailyMissionPlan({ outputDir: dir, date: '2026-07-01', runId: 'run-1', trigger: 'scheduled', collectors, decisionBuilder: new RuleBasedDecisionBuilder() });
    await writeDailyJournal({ outputDir: dir, date: '2026-07-01', runId: 'run-1', context: result.context, decisions: result.decisions, classified: result.classified });

    expect(result.run.status).toBe('waiting_approval');
    expect(result.decisions.length).toBe(1);
    const events = (await loadOperationLedgerJsonlEntries(dir, '2026-07-01')).map((e) => e.event);
    expect(events).toContain('data_collected');
    expect(events).toContain('journal_written');
    expect(events).not.toContain('execution_started');
    const md = await readFile(join(hotspotDir, 'daily-journal.md'), 'utf8');
    expect(md).toContain('演唱会A');
  });
});
```

- [ ] **Step 2: 运行集成测试**

Run: `npx vitest run tests/dailyMissionIntegration.test.ts --exclude '**/.worktrees/**'`
Expected: PASS (1 test).

- [ ] **Step 3: 全量回归**

Run: `npx vitest run --exclude '**/.worktrees/**' --exclude '**/node_modules/**'`
Expected: 全部通过（含 Phase 1 既有测试 + 本阶段新增）。

- [ ] **Step 4: 类型检查**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: exit 0。

- [ ] **Step 5: Commit**

```bash
git add tests/dailyMissionIntegration.test.ts
git commit -m "新增 Daily Mission 端到端集成测试（plan 模式，无写操作）"
```

---

## 后续阶段（本计划非目标，记录以备接续）

- **审批回调 → 执行**：把 `classified.approvals` 通过现有确认卡发出，审批回调触发 `executeRentalWriteOperationHandler(request, client, { outputDir, runId, decisionId })`，driver 仍是确定性状态机。
- **ApiHotspotEventProvider**：替换 `FileHotspotEventProvider`，`HotspotEvent` 结构不变。
- **MarketPriceCollector**：新增 collector 塞进 `CollectedContext`，喂给 DecisionBuilder 做定价判断（飞轮数据入口）。
- **飞轮回边**：DecisionBuilder 读历史 Ledger 事件的成败，产出更准的决策。
- **Scheduler**：cron / PM2 每日固定时间触发 `daily-mission-run`。

---

## Self-Review

**Spec 覆盖：**
- 步骤1 获取数据 → Task 4 Collectors（exposure/sales 通过 collector 插槽，本阶段先接 hotspots，exposure/sales collector 复用现有能力在后续接线）✓
- 步骤2a 近期操作 → Task 4 `collectRecentOperations` ✓
- 步骤2b 热点 → Task 3 HotspotProvider ✓
- 步骤3 分析 → Task 5/6/7 DecisionRecord + Builder ✓
- 步骤4 操作 → 复用现有工具，Task 8 只生成审批不执行 ✓
- 步骤5 审批/记录 → Task 8 approval-request + Task 2 Ledger + Task 9 Journal ✓
- 自循环触发 → Task 10 CLI ✓
- 实时审计 → Task 10 audit ✓
- 飞轮归因锚点 → Task 1 subject/decisionId/runId ✓

**注意**：exposure/sales 的真实 collector 接线（把 `publicTraffic` / `orderAnalysis` 包成 ContextCollector）本计划留了插槽（Task 4 的 collectors 数组），但没有单独任务把它们接进 CLI——CLI 当前只接 hotspots collector。这是有意的最小闭环：先让循环空跑通，exposure/sales collector 作为紧接的增量（一个 collector 一个小任务）在本计划完成后补。已在后续阶段说明。

**Placeholder 扫描：** 无 TBD/TODO；每个 code step 均为完整代码。

**类型一致性：** `ContextCollector.collect` 返回 `Partial<CollectedContext>`（Task4）→ Orchestrator 合并（Task8）一致；`DecisionRecord` 字段在 Task5 定义、Task6/7/8/9 引用一致；`recordOperationEvent` 签名 Task1 定义、Task2/8/9/10 调用一致；`dailyMissionArtifactPath` 的 artifact name（`collectedContext`/`decisions`/`approvalRequest`/`dailyJournalJson`/`dailyJournalMarkdown`）与 Phase 1 `DAILY_MISSION_ARTIFACT_FILENAMES` 键一致。
