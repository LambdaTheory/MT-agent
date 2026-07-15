# Rental Bulk Price Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic `rental.bulkPricePlan` and hidden `rental.bulkPriceApply(planId)` tools for business-level rental bulk price changes.

**Architecture:** Follow the existing plan/apply pattern used by `rental.perSpecPricePlan` and `rental.specDimPlan`: the planner-visible plan tool validates and persists a plan, saves a requestRef-backed confirmation request, and returns a Feishu confirmation card; the hidden apply tool loads the persisted plan by `planId`, executes existing rental price client writes per item, records ledger events, and writes a report.

**Tech Stack:** TypeScript ESM, Vitest, existing Agent tool registry, `buildAgentToolConfirmCard`, `saveAgentToolConfirmRequest`, `recordOperationEvent`, `RentalPriceSkillClient`.

## Global Constraints

- LLM parses intent into structured params only; deterministic code generates plans, previews, execution, ledger, and reports.
- High-risk writes must remain confirmation-bound.
- `rental.bulkPriceApply` must be `plannerVisible: false` and accept only `planId`.
- Do not expose raw `rental.batch*` execution as the business-level interface.
- Do not merge to `master` until the whole development task is complete and reviewed.
- Keep first version to absolute price fields per product; relative pricing and product selection are out of scope.

---

## File Structure

- Create `src/feishuBot/rentalBulkPriceHandlers.ts`: validation, plan persistence, confirmation-card response, apply execution, ledger/report writing.
- Modify `src/agentRuntime/toolRegistry.ts`: add schemas and tool definitions for `rental.bulkPricePlan` and `rental.bulkPriceApply`.
- Modify `src/feishuBot/agentToolExecutor.ts`: dispatch both tools.
- Create `tests/rentalBulkPrice.test.ts`: TDD coverage for plan/apply, validation, hidden apply, ledger, and report artifact.

---

### Task 1: Bulk Tool Contract Tests

**Files:**
- Create: `tests/rentalBulkPrice.test.ts`

**Interfaces:**
- Consumes: `executeAgentToolRequest`, `findAgentTool`, `loadOperationLedgerJsonlEntries`.
- Produces: failing assertions that require `rental.bulkPricePlan`, `rental.bulkPriceApply`, and report/ledger behavior.

- [ ] **Step 1: Write failing tests**

Create `tests/rentalBulkPrice.test.ts` with tests for:

```ts
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findAgentTool } from '../src/agentRuntime/toolRegistry.js';
import { loadOperationLedgerJsonlEntries } from '../src/agentRuntime/operationLedger.js';
import { executeAgentToolRequest } from '../src/feishuBot/agentToolExecutor.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

describe('rental bulk price workflow', () => {
  let outputDir: string;

  beforeEach(async () => {
    outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-rental-bulk-'));
  });

  afterEach(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  it('registers planner-visible plan and hidden apply tools', () => {
    expect(findAgentTool('rental.bulkPricePlan')).toMatchObject({ risk: 'high', requiresConfirmation: true });
    expect(findAgentTool('rental.bulkPricePlan')?.plannerVisible).not.toBe(false);
    expect(findAgentTool('rental.bulkPriceApply')).toMatchObject({ risk: 'high', requiresConfirmation: true, plannerVisible: false });
  });

  it('persists a normalized plan and returns a hidden apply confirmation card', async () => {
    const response = await executeAgentToolRequest({
      toolName: 'rental.bulkPricePlan',
      arguments: { items: [{ productId: '648', fields: { rent1day: 88, rent10day: '199.5' } }] },
      reason: '批量设置租赁价',
    }, outputDir, {});

    expect(response.text).toContain('批量租赁改价计划');
    expect(response.card).toBeDefined();
    expect(response.metadata).toMatchObject({ toolName: 'rental.bulkPricePlan', ok: true, productCount: 1 });
    const planId = String(response.metadata?.planId);
    const planPath = String(response.metadata?.planPath);
    expect(planId).toMatch(/^bulk_price_/);
    const plan = JSON.parse(await readFile(planPath, 'utf8')) as { items: Array<{ productId: string; fields: Record<string, string> }> };
    expect(plan.items).toEqual([{ productId: '648', fields: { rent1day: '88.00', rent10day: '199.50' } }]);
    expect(JSON.stringify(response.card)).toContain('rental.bulkPriceApply');
    expect(JSON.stringify(response.card)).toContain(planId);
  });

  it('blocks invalid and conflicting items before confirmation', async () => {
    const response = await executeAgentToolRequest({
      toolName: 'rental.bulkPricePlan',
      arguments: { items: [
        { productId: '../648', fields: { rent1day: 88 } },
        { productId: '649', fields: { nope: 1 } },
        { productId: '650', fields: { rent1day: 88 } },
        { productId: '650', fields: { rent1day: 99 } },
      ] },
      reason: 'invalid bulk plan',
    }, outputDir, {});

    expect(response.card).toBeUndefined();
    expect(response.metadata).toMatchObject({ toolName: 'rental.bulkPricePlan', ok: false, blockedCount: 3 });
  });

  it('applies the persisted plan by planId, writes a report, and records ledger events', async () => {
    const execute = vi.fn(async (request) => ({
      productId: request.productId,
      ok: true,
      lines: ['apply: ok', 'submit: ok', 'verify: ok'],
      audit: { resultFile: `verify-${request.productId}.json`, rollbackFile: `rollback-${request.productId}.json` },
    }));
    const client = { async preview() { throw new Error('preview should not run'); }, execute } as unknown as RentalPriceSkillClient;
    const plan = await executeAgentToolRequest({
      toolName: 'rental.bulkPricePlan',
      arguments: { items: [{ productId: '648', fields: { rent1day: 88 } }, { productId: '649', fields: { rent3day: '66' } }] },
      reason: 'bulk apply',
    }, outputDir, { rentalPriceClient: client });

    const apply = await executeAgentToolRequest({
      toolName: 'rental.bulkPriceApply',
      arguments: { planId: plan.metadata?.planId },
      reason: 'confirmed bulk apply',
    }, outputDir, { rentalPriceClient: client, ledgerContext: { outputDir, runId: 'run-1', decisionId: 'decision-1', missionDate: '2026-07-15' } });

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls.map(([request]) => request)).toEqual([
      { mode: 'explicit_fields', productId: '648', fields: { rent1day: '88.00' } },
      { mode: 'explicit_fields', productId: '649', fields: { rent3day: '66.00' } },
    ]);
    expect(apply.metadata).toMatchObject({ toolName: 'rental.bulkPriceApply', ok: true, planId: plan.metadata?.planId, status: 'completed' });
    const report = JSON.parse(await readFile(String(apply.metadata?.reportPath), 'utf8')) as { results: Array<{ productId: string; ok: boolean }> };
    expect(report.results.map((item) => item.productId)).toEqual(['648', '649']);
    const events = await loadOperationLedgerJsonlEntries(outputDir, '2026-07-15');
    expect(events.some((event) => event.event === 'execution_started' && event.toolName === 'rental.bulkPriceApply')).toBe(true);
    expect(events.some((event) => event.event === 'execution_succeeded' && event.toolName === 'rental.bulkPriceApply')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -- tests/rentalBulkPrice.test.ts`

Expected: FAIL because `rental.bulkPricePlan` and `rental.bulkPriceApply` are not registered or dispatched.

---

### Task 2: Bulk Handler Implementation

**Files:**
- Create: `src/feishuBot/rentalBulkPriceHandlers.ts`
- Test: `tests/rentalBulkPrice.test.ts`

**Interfaces:**
- Produces: `rentalBulkPricePlanResponse(args, reason, client, outputDir, continuation?)` and `rentalBulkPriceApplyResponse(args, client, outputDir, ledgerContext?)`.

- [ ] **Step 1: Implement handler module**

Create `src/feishuBot/rentalBulkPriceHandlers.ts` with:

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildAgentToolConfirmCard, type AgentToolConfirmRequest } from '../agentRuntime/approvalCard.js';
import { recordOperationEvent } from '../agentRuntime/operationLedger.js';
import { saveAgentToolConfirmRequest } from './agentToolConfirmStore.js';
import type { RentalPriceChangeRequest, RentalPriceSkillClient } from './rentalPrice.js';
import type { RentalWriteLedgerContext } from './rentalWriteOperationHandlers.js';
import type { BotResponse } from './types.js';
```

Implement allowed fields, normalization, plan/report paths, JSON read/write, plan response, apply response, and ledger events exactly matching the tests.

- [ ] **Step 2: Run tests**

Run: `npm test -- tests/rentalBulkPrice.test.ts`

Expected: still FAIL until registry and dispatch are wired.

---

### Task 3: Registry And Dispatch Wiring

**Files:**
- Modify: `src/agentRuntime/toolRegistry.ts`
- Modify: `src/feishuBot/agentToolExecutor.ts`
- Test: `tests/rentalBulkPrice.test.ts`

**Interfaces:**
- Consumes: `rentalBulkPricePlanResponse`, `rentalBulkPriceApplyResponse`.
- Produces: working agent tool registration and dispatch.

- [ ] **Step 1: Add schemas and tool entries**

In `toolRegistry.ts`, add `bulkPricePlanArgumentsSchema` and `bulkPriceApplyArgumentsSchema`, then add tool entries near other rental plan/apply tools:

```ts
{
  name: 'rental.bulkPricePlan',
  description: '生成批量租赁改价计划和确认卡；只接受每个商品的绝对价格字段，确认前不会改价。',
  risk: 'high',
  requiresConfirmation: true,
  inputSchema: bulkPricePlanArgumentsSchema,
},
{
  name: 'rental.bulkPriceApply',
  description: '确认后按 planId 执行已持久化的批量租赁改价计划。',
  risk: 'high',
  requiresConfirmation: true,
  plannerVisible: false,
  inputSchema: bulkPriceApplyArgumentsSchema,
},
```

- [ ] **Step 2: Add executor dispatch**

In `agentToolExecutor.ts`, import the handler functions and add switch cases:

```ts
case 'rental.bulkPricePlan':
  return rentalBulkPricePlanResponse(request.arguments, request.reason, options.rentalPriceClient ?? createRentalPriceSkillClient(), outputDir, request.continuation);
case 'rental.bulkPriceApply':
  return rentalBulkPriceApplyResponse(request.arguments, options.rentalPriceClient ?? createRentalPriceSkillClient(), outputDir, options.ledgerContext);
```

- [ ] **Step 3: Run tests to verify GREEN**

Run: `npm test -- tests/rentalBulkPrice.test.ts`

Expected: PASS.

---

### Task 4: Verification And Commit

**Files:**
- All files changed by Tasks 1-3.

**Interfaces:**
- Consumes: complete bulk workflow implementation.
- Produces: verified local commit; no merge to master.

- [ ] **Step 1: Run targeted regression tests**

Run: `npm test -- tests/rentalBulkPrice.test.ts tests/rentalApplyCurrentSubmit.test.ts tests/rentalPriceSpecDim.test.ts tests/feishuBotRentalPriceAction.test.ts tests/feishuBotRentalPrice.test.ts`

Expected: PASS.

- [ ] **Step 2: Run build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 3: Run LSP diagnostics**

Run diagnostics on:
- `src/feishuBot/rentalBulkPriceHandlers.ts`
- `src/agentRuntime/toolRegistry.ts`
- `src/feishuBot/agentToolExecutor.ts`
- `tests/rentalBulkPrice.test.ts`

Expected: no diagnostics.

- [ ] **Step 4: Run real surface driver**

Run a `tsx` driver that calls `executeAgentToolRequest()` for plan then apply with a mocked `RentalPriceSkillClient.execute`, and assert the output report path exists.

Expected: prints JSON containing `{ "ok": true, "status": "completed" }`.

- [ ] **Step 5: Commit**

Run:

```powershell
$env:GIT_MASTER='1'; git add src/feishuBot/rentalBulkPriceHandlers.ts src/agentRuntime/toolRegistry.ts src/feishuBot/agentToolExecutor.ts tests/rentalBulkPrice.test.ts
$env:GIT_MASTER='1'; git commit -m "feat: add rental bulk price workflow" -m "Ultraworked with [Sisyphus](https://github.com/code-yeongyu/oh-my-openagent)" -m "Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>"
```

Expected: one local commit; do not merge to `master`.

---

## Self-Review

- Spec coverage: plan/apply tools, hidden apply, deterministic persisted plan, requestRef card, ledger/report, validation, tests, and no master merge are covered.
- Incomplete-marker scan: clean.
- Type consistency: plan handler signatures match dispatch references; test names match tool names; apply accepts only `planId`.
