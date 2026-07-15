# Rental Bulk Price Workflow Design

## Goal

Build a business-level rental bulk pricing workflow that prevents the LLM from freely chaining low-level rental write tools for large operations. The LLM may parse user intent into structured parameters, but deterministic code must generate the executable plan, confirmation summary, execution artifact, ledger events, and report.

This design continues the stable rental daemon compatibility work already committed in `1466803 fix: include rental submit expected product id`.

## Scope

Implement two agent tools:

- `rental.bulkPricePlan`: planner-visible, high-risk, confirmation-required. It builds and persists a deterministic bulk pricing plan, then returns a Feishu confirmation card.
- `rental.bulkPriceApply`: hidden from the planner. It accepts only a `planId`, loads the persisted plan, executes it, records ledger events, and returns a concise report.

The first version supports absolute price fields per product. It does not add free-form relative pricing, autonomous product selection, or background daemon lifecycle management.

## Existing Patterns To Reuse

- Tool registration in `src/agentRuntime/toolRegistry.ts`.
- Plan/apply dispatch in `src/feishuBot/agentToolExecutor.ts`.
- Confirmation cards via `buildAgentToolConfirmCard()` and `saveAgentToolConfirmRequest()`.
- Hidden apply tools following `rental.perSpecPricePlan` / `rental.perSpecPriceApply` and `rental.specDimPlan` / `rental.specDimApply`.
- Ledger attribution via `RentalWriteLedgerContext` and `recordOperationEvent()`.
- Batch-runner adapter conventions from `src/feishuBot/rentalBatchHandlers.ts`.

## Tool Contracts

### `rental.bulkPricePlan`

Input schema:

```ts
{
  items: Array<{
    productId: string;
    fields: Record<string, string | number>;
  }>;
  reason?: string;
}
```

Validation rules:

- `items` must be non-empty.
- Every `productId` must be a numeric string.
- Every field name must be an allowed rental price field.
- Every value must be finite and normalized to a two-decimal string.
- Duplicate product IDs collapse into one item only if their normalized fields are identical; conflicting duplicates block the plan.

Output behavior:

- Persist a plan under the MT output directory, for example `output/rental-bulk-price/plans/<planId>.json`.
- Return text summarizing product count, field count, blocked items, and artifact path.
- Return an `AgentToolConfirmCard` whose request is `{ toolName: 'rental.bulkPriceApply', arguments: { planId } }`.
- Confirmation text must be a task brief: what the agent is prepared to execute, affected products, representative field changes, and blocking warnings. It must not expose low-level daemon command details as the primary user-facing structure.

### `rental.bulkPriceApply`

Input schema:

```ts
{ planId: string }
```

Execution rules:

- Load the persisted plan by `planId`.
- Refuse missing, malformed, already-applied, or blocked plans.
- Execute deterministically from the persisted plan, not from card-returned item payloads.
- For each item, call the existing rental price client path that performs apply, submit, verify, audit, and result file generation.
- Record `execution_started`, `execution_succeeded`, or `execution_failed` with `toolName: 'rental.bulkPriceApply'` and product-level subject metadata where possible.
- Persist an execution report next to the plan, including per-item status, result files, failed product IDs, and timestamps.

## Data Model

`RentalBulkPricePlan`:

```ts
{
  version: 1;
  planId: string;
  status: 'planned' | 'applied' | 'failed' | 'blocked';
  createdAt: string;
  reason: string;
  items: Array<{
    productId: string;
    fields: Record<string, string>;
  }>;
  blockedItems: Array<{
    productId?: string;
    reason: string;
  }>;
  summary: {
    productCount: number;
    fieldCount: number;
  };
}
```

`RentalBulkPriceExecutionReport`:

```ts
{
  version: 1;
  planId: string;
  status: 'completed' | 'completed_with_failures' | 'failed';
  startedAt: string;
  finishedAt: string;
  results: Array<{
    productId: string;
    ok: boolean;
    lines: string[];
    resultFile?: string;
    rollbackFile?: string;
  }>;
}
```

## Architecture

Create `src/feishuBot/rentalBulkPriceHandlers.ts` with pure validation helpers and two exported handlers:

- `rentalBulkPricePlanResponse(args, reason, client, outputDir, continuation?)`
- `rentalBulkPriceApplyResponse(args, client, outputDir, ledgerContext?)`

The plan handler is mostly pure and artifact-oriented. It may optionally read current product state for preview if an existing client method supports it, but it must not require browser execution beyond safe reads. The apply handler is the only write path and stays hidden from the planner.

The executor adapter should initially reuse `RentalPriceSkillClient.execute({ mode: 'explicit_fields', productId, fields })` per item rather than exposing raw `batch-runner.js` to the planner. The existing batch-runner remains available for low-level operator workflows, but the business-level bulk tool owns plan identity, confirmation, and report semantics.

## Feishu Approval Summary

The card should answer four questions:

- What operation is prepared: bulk rental price change.
- Which products are affected: count plus first several product IDs.
- Which fields change: unique field names plus representative values.
- What happens after approval: deterministic apply, submit, verify, ledger, and report.

The card must use requestRef-backed confirmation so the full plan is not trusted from callback payloads.

## Error Handling

- Invalid input returns a non-executing response from `rental.bulkPricePlan` with `ok: false` metadata.
- Blocked plans do not produce an apply confirmation card.
- `rental.bulkPriceApply` throws on missing or malformed `planId` and records failure if execution had started.
- Partial item failures do not stop remaining items unless the failure is plan-level corruption. The report marks `completed_with_failures`.

## Tests

Add `tests/rentalBulkPrice.test.ts` covering:

1. Happy path: `bulkPricePlan` persists a normalized plan, returns a confirmation card for hidden `bulkPriceApply`, and `bulkPriceApply` executes every item through a mocked client.
2. Edge path: invalid product IDs, invalid fields, empty items, and conflicting duplicate product IDs are blocked before confirmation.
3. Regression path: the planner registry exposes only `rental.bulkPricePlan`; `rental.bulkPriceApply` is `plannerVisible: false`; the apply path reads the persisted plan by `planId` instead of trusting returned item payloads.
4. Ledger path: apply records start and terminal events with `rental.bulkPriceApply` attribution.
5. Surface path: a `tsx` driver or targeted test exercises plan then apply with mocked client and verifies the report artifact.

## Out Of Scope

- Relative pricing language such as “全部降 10%”. That can be layered later by adding deterministic calculators before plan creation.
- Automatic candidate selection from public traffic or same-SKU data.
- Replacing `rental.batch*` tools.
- Merging to `master`; integration happens only after the whole development task is complete and reviewed.
