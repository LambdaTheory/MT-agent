# Tool Contract Infrastructure and Rental Guardrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve LLM workflow reliability by strengthening generic tool-contract infrastructure and applying only small, current-runtime rental guardrails that prevent schema-valid-but-runtime-invalid calls.

**Architecture:** Do not perform a full `rental.*` contract redesign before the new rental skill version lands. Add reusable planner/schema validation primitives first, then use them to express the few high-risk runtime contracts already enforced today. Keep write-operation safety boundaries unchanged: planner-visible tools may prepare plans/cards, hidden apply/execute tools remain confirmation-bound.

**Tech Stack:** TypeScript ESM with `.js` relative imports, Vitest, existing JSON Schema-style contracts in `src/agentRuntime/toolRegistry.ts`, planner validation in `src/agentRuntime/planner.ts`, continuation in `src/feishuBot/agentToolContinuation.ts`, metadata references in `src/agentRuntime/stepResolution.ts`.

## Global Constraints

- Do not implement a full rental price/spec field catalog in this plan.
- Do not pre-adapt to the not-yet-delivered rental skill version.
- Do not loosen confirmation, hidden-tool, or execution boundaries.
- Do not add new external dependencies or modify `package.json`.
- Do not remove existing legacy runtime fallbacks unless a task explicitly says the planner schema should stop exposing them.
- Any production behavior change must be locked by a failing test first.
- Every task must run the targeted test before implementation and after implementation.
- Each task must be committed separately.
- Final verification must run:
  - `npx vitest run tests/agentRuntimePlanner.test.ts tests/agentRuntimeToolRegistry.test.ts tests/agentToolContinuation.test.ts tests/feishuBotTools.test.ts --exclude '**/.worktrees/**'`
  - `npx tsc -p tsconfig.json --noEmit`
  - `npm run build`

---

## File Structure

| Path | Responsibility |
|---|---|
| `src/agentRuntime/planner.ts` | Local schema validator used by planner, policy, approval cards, and tool argument validation. Add only the schema keywords needed by this plan. |
| `src/agentRuntime/toolRegistry.ts` | Planner-visible tool contracts. Add high-risk rental guardrails and a dedicated `rental.priceSnapshot` schema. |
| `src/agentRuntime/stepResolution.ts` | Metadata storage and placeholder resolution. Add optional result metadata schema validation before storing workflow metadata. |
| `src/feishuBot/agentToolContinuation.ts` | Pass declared result metadata schemas into metadata storage and add continuation tests around resolved placeholders. |
| `tests/agentRuntimePlanner.test.ts` | Validator tests for `oneOf` / `not` behavior through real tool schemas and multi-step placeholder validation. |
| `tests/agentRuntimeToolRegistry.test.ts` | Registry-level contract tests for rental guardrails and price snapshot schema. |
| `tests/agentToolContinuation.test.ts` | Continuation and metadata tests. Expand beyond basic reference resolution. |
| `tests/feishuBotTools.test.ts` | Existing executor E2E safety net for rental price preview/change behavior. Add only focused cases if a task changes runtime-visible behavior. |

---

### Task 1: Add Minimal `oneOf` and `not` Schema Support

**Files:**
- Modify: `src/agentRuntime/planner.ts`
- Test: `tests/agentRuntimePlanner.test.ts`

**Interfaces:**
- Consumes: existing `schemaAllowsArguments(schema, value, options)` and `validateAgentToolArguments(toolName, value)`.
- Produces: planner validation support for:
  - `oneOf`: exactly one subschema must match.
  - `not`: the subschema must not match.
- Do not implement complete JSON Schema. Only implement these two keywords in the same lightweight style as existing `anyOf`.

- [ ] **Step 1: Write the failing validator tests**

Append to `tests/agentRuntimePlanner.test.ts`:

```ts
  it('enforces oneOf and not keywords in local tool schema validation', () => {
    const schema = {
      type: 'object',
      oneOf: [
        { required: ['taskId'] },
        { required: ['rollbackFile'] },
      ],
      not: { required: ['discount', 'adjustmentAmount'] },
      properties: {
        taskId: { type: 'string' },
        rollbackFile: { type: 'string' },
        discount: { type: 'number' },
        adjustmentAmount: { type: 'number' },
      },
      additionalProperties: false,
    };

    expect(schemaAllowsArguments(schema, { taskId: 'task_1_abcd' })).toBe(true);
    expect(schemaAllowsArguments(schema, { rollbackFile: 'output/rental/rollback.json' })).toBe(true);
    expect(schemaAllowsArguments(schema, { taskId: 'task_1_abcd', rollbackFile: 'output/rental/rollback.json' })).toBe(false);
    expect(schemaAllowsArguments(schema, { taskId: 'task_1_abcd', discount: 0.8, adjustmentAmount: -1 })).toBe(false);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run tests/agentRuntimePlanner.test.ts --exclude '**/.worktrees/**'
```

Expected: FAIL because `oneOf` and `not` are ignored by `schemaAllowsValue`.

- [ ] **Step 3: Implement minimal validator support**

In `src/agentRuntime/planner.ts`, update `schemaAllowsValue` immediately after the existing `anyOf` check:

```ts
  if (Array.isArray(schema.oneOf) && schema.oneOf.filter((item) => schemaAllowsValue(item, value, options)).length !== 1) return false;
  if (schema.not !== undefined && schemaAllowsValue(schema.not, value, options)) return false;
```

- [ ] **Step 4: Run the directed test**

Run:

```bash
npx vitest run tests/agentRuntimePlanner.test.ts --exclude '**/.worktrees/**'
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
$env:GIT_MASTER='1'; git add src/agentRuntime/planner.ts tests/agentRuntimePlanner.test.ts
$env:GIT_MASTER='1'; git commit -m "补齐工具契约组合校验"
```

---

### Task 2: Add High-Risk Rental Schema Guardrails

**Files:**
- Modify: `src/agentRuntime/toolRegistry.ts`
- Test: `tests/agentRuntimeToolRegistry.test.ts`

**Interfaces:**
- Consumes: Task 1 `oneOf` / `not` support.
- Produces stricter planner-visible contracts for current runtime behavior:
  - `rental.priceRollback` requires exactly one of `taskId` or `rollbackFile`; `productId` remains optional filter context.
  - `rental.priceChange` and `rental.pricePreview` reject `discount + adjustmentAmount` together at schema boundary.
  - `rental.priceSnapshot` exposes only `query`, because runtime only reads `query`.
  - `productIds` arrays used by `rental.pricePreview`, `rental.delist`, and `rental.delistBatch` require numeric internal IDs.
- Do not introduce price/spec field catalogs.

- [ ] **Step 1: Write the failing registry tests**

Append focused assertions to the existing rental schema section in `tests/agentRuntimeToolRegistry.test.ts`:

```ts
  it('locks high-risk rental schemas to current runtime guardrails', () => {
    expect(validateAgentToolArguments('rental.priceRollback', { productId: '648' })).toBe(false);
    expect(validateAgentToolArguments('rental.priceRollback', { taskId: 'task_123_abcd' })).toBe(true);
    expect(validateAgentToolArguments('rental.priceRollback', { rollbackFile: 'output/rental/rollback.json' })).toBe(true);
    expect(validateAgentToolArguments('rental.priceRollback', { taskId: 'task_123_abcd', rollbackFile: 'output/rental/rollback.json' })).toBe(false);

    expect(validateAgentToolArguments('rental.pricePreview', { productIds: ['648'], discount: 0.8, adjustmentAmount: -1 })).toBe(false);
    expect(validateAgentToolArguments('rental.priceChange', { productId: '648', discount: 0.8, adjustmentAmount: -1 })).toBe(false);

    expect(validateAgentToolArguments('rental.pricePreview', { productIds: ['abc'], discount: 0.8 })).toBe(false);
    expect(validateAgentToolArguments('rental.delistBatch', { productIds: ['abc'] })).toBe(false);

    expect(findAgentTool('rental.priceSnapshot')?.inputSchema).toMatchObject({
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    });
    expect(validateAgentToolArguments('rental.priceSnapshot', { query: 'x200u', periodDays: 7 })).toBe(false);
  });
```

If `validateAgentToolArguments` is not already imported in this test file, add:

```ts
import { validateAgentToolArguments } from '../src/agentRuntime/planner.js';
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run tests/agentRuntimeToolRegistry.test.ts --exclude '**/.worktrees/**'
```

Expected: FAIL on current permissive schemas.

- [ ] **Step 3: Implement schema guardrails**

In `src/agentRuntime/toolRegistry.ts`, add a reusable numeric ID schema near `productIdArgumentsSchema`:

```ts
const internalProductIdSchema = { type: 'string', pattern: '^\\d+$' };
```

Update these schemas:

```ts
const rentalDelistArgumentsSchema = {
  type: 'object',
  properties: {
    productId: { type: 'string', pattern: '^\\d+(?:[\\s,，;；]+\\d+)*$', description: 'Single internal product id, or a comma/newline separated list for batch delist compatibility.' },
    productIds: { type: 'array', minItems: 1, maxItems: 80, items: internalProductIdSchema, description: 'Internal product ids to delist in one confirmed batch.' },
  },
  minProperties: 1,
  additionalProperties: false,
};

const rentalDelistBatchArgumentsSchema = {
  type: 'object',
  properties: {
    productIds: { type: 'array', minItems: 1, maxItems: 80, items: internalProductIdSchema },
  },
  required: ['productIds'],
  additionalProperties: false,
};
```

Update price schemas with `not`:

```ts
const rentalPriceChangeArgumentsSchema = {
  type: 'object',
  not: { required: ['discount', 'adjustmentAmount'] },
  properties: {
    productId: internalProductIdSchema,
    fields: { type: 'object' },
    discount: { type: ['number', 'string'], description: 'Explicit multiplier only. Use 0.8 for 8-fold, 1.8 for 180%; never use bare fold numbers such as 8.' },
    adjustmentAmount: { type: ['number', 'string'], description: 'Absolute amount to add to every rental price field. Use negative values such as -1 to subtract 1 yuan.' },
    scope: { type: 'string', enum: ['rent_fields'], description: 'Current runtime always applies multiplier/adjustment operations to rental price fields only. Non-rent fields must be passed through explicit fields and named in the reason.' },
  },
  required: ['productId'],
  additionalProperties: false,
};

const rentalPricePreviewArgumentsSchema = {
  type: 'object',
  not: { required: ['discount', 'adjustmentAmount'] },
  properties: {
    productIds: { type: 'array', minItems: 1, maxItems: 24, items: internalProductIdSchema },
    fields: { type: 'object' },
    discount: { type: ['number', 'string'], description: 'Explicit multiplier only. Use 0.8 for 8-fold, 1.8 for 180%; never use bare fold numbers such as 8.' },
    adjustmentAmount: { type: ['number', 'string'], description: 'Absolute amount to add to every rental price field. Use negative values such as -1 to subtract 1 yuan.' },
    scope: { type: 'string', enum: ['rent_fields'], description: 'Current runtime always applies multiplier/adjustment operations to rental price fields only. Non-rent fields must be passed through explicit fields and named in the reason.' },
  },
  required: ['productIds'],
  additionalProperties: false,
};
```

Update rollback and snapshot:

```ts
const rentalPriceRollbackArgumentsSchema = {
  type: 'object',
  oneOf: [
    { required: ['taskId'] },
    { required: ['rollbackFile'] },
  ],
  properties: {
    productId: internalProductIdSchema,
    taskId: { type: 'string', pattern: '^task_\\d+_[a-fA-F0-9]+$' },
    rollbackFile: { type: 'string' },
  },
  additionalProperties: false,
};

const rentalPriceSnapshotArgumentsSchema = {
  type: 'object',
  properties: { query: { type: 'string' } },
  required: ['query'],
  additionalProperties: false,
};
```

Change `rental.priceSnapshot` to use `rentalPriceSnapshotArgumentsSchema`.

- [ ] **Step 4: Run directed tests**

Run:

```bash
npx vitest run tests/agentRuntimeToolRegistry.test.ts tests/feishuBotTools.test.ts --exclude '**/.worktrees/**'
```

Expected: PASS. If `feishuBotTools.test.ts` reveals a legitimate existing call using non-numeric product IDs for these rental tools, stop and inspect before broadening the schema.

- [ ] **Step 5: Commit**

```bash
$env:GIT_MASTER='1'; git add src/agentRuntime/toolRegistry.ts tests/agentRuntimeToolRegistry.test.ts
$env:GIT_MASTER='1'; git commit -m "收紧当前租赁工具契约护栏"
```

---

### Task 3: Validate Stored Result Metadata Against Declared Schemas

**Files:**
- Modify: `src/agentRuntime/stepResolution.ts`
- Modify: `src/feishuBot/agentToolContinuation.ts`
- Test: `tests/agentToolContinuation.test.ts`

**Interfaces:**
- Consumes: existing `schemaAllowsArguments(schema, value)` semantics from `planner.ts`.
- Produces:
  - `rememberStepMetadata(store, stepId, response, resultMetadataSchema?)`.
  - If `response.metadata` exists and matches `resultMetadataSchema`, store it as before.
  - If `response.metadata` exists but does not match `resultMetadataSchema`, store `{ text: response.text, metadataValidationError: stepId }` for that step and for `last`.
  - If no schema is provided, preserve current behavior exactly.
- This task does not make metadata fields required; it only rejects metadata shapes that violate declared schemas.

- [ ] **Step 1: Write failing tests for metadata storage**

Replace `tests/agentToolContinuation.test.ts` with existing reference tests plus this new case:

```ts
import { describe, expect, it } from 'vitest';
import { rememberStepMetadata, resolvePlannerArguments } from '../src/agentRuntime/stepResolution.js';

describe('agent tool continuation metadata references', () => {
  it('resolves common data and strategy metadata shapes for later steps', () => {
    expect(resolvePlannerArguments({ productIds: '${agg.productIds}' }, {
      agg: { productIds: ['648', '649'] },
    })).toEqual({ ok: true, value: { productIds: ['648', '649'] } });

    expect(resolvePlannerArguments({ sourceProductId: '${resolve.productIds[0]}' }, {
      resolve: { productIds: ['388'] },
    })).toEqual({ ok: true, value: { sourceProductId: '388' } });

    expect(resolvePlannerArguments({ sourceProductId: '${agg.items[0].internalProductId}' }, {
      agg: { items: [{ internalProductId: '648' }] },
    })).toEqual({ ok: true, value: { sourceProductId: '648' } });

    expect(resolvePlannerArguments({ productIds: '${explain.candidateProductIds}' }, {
      explain: { candidateProductIds: ['681'] },
    })).toEqual({ ok: true, value: { productIds: ['681'] } });

    expect(resolvePlannerArguments({ sourceProductId: '${safe.sourceProductId}' }, {
      safe: { sourceProductId: '680' },
    })).toEqual({ ok: true, value: { sourceProductId: '680' } });
  });

  it('stores fallback text metadata when declared result metadata schema is violated', () => {
    const store: Record<string, unknown> = {};
    rememberStepMetadata(store, 'rank', {
      text: 'ranked product',
      metadata: { productIds: '648' },
    }, {
      type: 'object',
      properties: {
        productIds: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: false,
    });

    expect(store.rank).toEqual({ text: 'ranked product', metadataValidationError: 'rank' });
    expect(store.last).toEqual({ text: 'ranked product', metadataValidationError: 'rank' });
    expect(resolvePlannerArguments({ productIds: '${rank.productIds}' }, store)).toEqual({ ok: false, reference: 'rank.productIds' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run tests/agentToolContinuation.test.ts --exclude '**/.worktrees/**'
```

Expected: FAIL because `rememberStepMetadata` accepts only 3 parameters and stores invalid metadata as-is.

- [ ] **Step 3: Implement optional metadata validation**

In `src/agentRuntime/stepResolution.ts`, import schema validation:

```ts
import { schemaAllowsArguments } from './planner.js';
```

Update `rememberStepMetadata`:

```ts
export function rememberStepMetadata(store: AgentStepMetadataStore, stepId: string, response: AgentStepResponseLike, resultMetadataSchema?: unknown): void {
  const candidate = response.metadata ?? { text: response.text };
  const metadata = resultMetadataSchema !== undefined && response.metadata !== undefined && !schemaAllowsArguments(resultMetadataSchema, response.metadata)
    ? { text: response.text, metadataValidationError: stepId }
    : candidate;
  store[stepId] = metadata;
  store.last = metadata;
}
```

In `src/feishuBot/agentToolContinuation.ts`, pass each tool's schema into both metadata storage calls:

```ts
rememberStepMetadata(input.metadataStore, stepId, response, tool.resultMetadataSchema);
```

and in `continueAgentPlannerStepsAfterResponse`:

```ts
const currentTool = findAgentTool(request.toolName);
rememberStepMetadata(metadataStore, continuation.currentStepId, response, currentTool?.resultMetadataSchema);
```

- [ ] **Step 4: Run directed tests**

Run:

```bash
npx vitest run tests/agentToolContinuation.test.ts tests/feishuBotTools.test.ts --exclude '**/.worktrees/**'
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
$env:GIT_MASTER='1'; git add src/agentRuntime/stepResolution.ts src/feishuBot/agentToolContinuation.ts tests/agentToolContinuation.test.ts
$env:GIT_MASTER='1'; git commit -m "校验多步骤工具结果元数据契约"
```

---

### Task 4: Lock Continuation Runtime Validation After Placeholder Resolution

**Files:**
- Modify: `tests/agentToolContinuation.test.ts`
- Modify only if test exposes a real gap: `src/feishuBot/agentToolContinuation.ts`

**Interfaces:**
- Consumes: current `continueAgentPlannerSteps` flow:
  - resolves placeholders through `resolvePlannerArguments`
  - calls `reviewAgentToolArguments`
  - validates final args through `validateAgentToolArguments`
- Produces tests proving resolved placeholder values are revalidated before execution or confirmation.

- [ ] **Step 1: Write failing or locking tests**

Append to `tests/agentToolContinuation.test.ts`:

```ts
import { continueAgentPlannerSteps } from '../src/feishuBot/agentToolContinuation.js';

describe('agent tool continuation execution contracts', () => {
  it('stops before execution when a resolved placeholder violates the target tool schema', async () => {
    const textParts = ['Agent 多步骤计划：bad product ids'];
    const response = await continueAgentPlannerSteps({
      goal: 'bad product ids',
      reason: 'metadata shape mismatch must not execute',
      steps: [
        { toolName: 'rental.pricePreview', arguments: { productIds: '${rank.productIds}', discount: 0.8 }, reason: 'preview price' },
      ],
      baseIndex: 0,
      totalSteps: 1,
      metadataStore: { rank: { productIds: ['abc'] } },
      textParts,
      outputDir: 'output',
      options: {},
      sourceText: 'preview abc',
    });

    expect(response?.text).toContain('需要结构化参数');
    expect(response?.metadata).toMatchObject({ ok: false, needsClarification: true });
  });
});
```

- [ ] **Step 2: Run directed test**

Run:

```bash
npx vitest run tests/agentToolContinuation.test.ts --exclude '**/.worktrees/**'
```

Expected: PASS if current `reviewAgentToolArguments` already catches it after Task 2. If it fails by executing the tool, fix `continueAgentPlannerSteps` by ensuring `reviewAgentToolArguments` remains before confirmation/execution and uses the stricter schema.

- [ ] **Step 3: Commit**

If only tests changed:

```bash
$env:GIT_MASTER='1'; git add tests/agentToolContinuation.test.ts
$env:GIT_MASTER='1'; git commit -m "锁定占位符解析后的工具参数复验"
```

If production code changed:

```bash
$env:GIT_MASTER='1'; git add src/feishuBot/agentToolContinuation.ts tests/agentToolContinuation.test.ts
$env:GIT_MASTER='1'; git commit -m "复验多步骤占位符解析后的工具参数"
```

---

### Task 5: Final Regression and Contract Audit Notes

**Files:**
- Modify: no production files expected.
- Optional docs update only if implementation diverges from this plan: `docs/superpowers/plans/2026-07-14-tool-contract-infra-and-rental-guardrails.md`

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: verified branch ready for local merge or PR.

- [ ] **Step 1: Run focused regression**

Run:

```bash
npx vitest run tests/agentRuntimePlanner.test.ts tests/agentRuntimeToolRegistry.test.ts tests/agentToolContinuation.test.ts tests/feishuBotTools.test.ts --exclude '**/.worktrees/**'
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npx tsc -p tsconfig.json --noEmit
```

Expected: exit 0.

- [ ] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected: exit 0.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
$env:GIT_MASTER='1'; git status --short
$env:GIT_MASTER='1'; git diff --stat master...HEAD
$env:GIT_MASTER='1'; git log --oneline master..HEAD
```

Expected: only planned source/test files changed; commits are task-sized.

- [ ] **Step 5: Commit any plan correction**

Only if implementation required a plan correction:

```bash
$env:GIT_MASTER='1'; git add docs/superpowers/plans/2026-07-14-tool-contract-infra-and-rental-guardrails.md
$env:GIT_MASTER='1'; git commit -m "记录工具契约护栏执行修正"
```

If no correction was required, do not create an empty commit.

---

## Out of Scope

- Full rental skill vNext integration.
- Price field catalog design beyond preventing current runtime-invalid planner calls.
- Spec field catalog design.
- Rental daemon protocol redesign.
- Changing `operations.refreshActivityPlan` legacy runtime fallback behavior.
- Rewriting all result metadata schemas to require every field.

## Self-Review

- Spec coverage: This plan covers generic schema composition validation, current high-risk rental schema/runtime mismatches, metadata contract validation, and continuation validation tests.
- Placeholder scan: No task uses open-ended placeholders; every code/task step names concrete files and commands.
- Type consistency: `rememberStepMetadata` gains an optional fourth parameter; call sites in `agentToolContinuation.ts` pass `tool.resultMetadataSchema` or `currentTool?.resultMetadataSchema`.
