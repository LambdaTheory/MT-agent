# Rental Price Orchestration Remediation Plan

## Background

On 2026-07-16, the x300u rental price operation was intended to apply a relative change: all rental-period prices should decrease by 10 yuan.

The source instruction was:

```text
改价,所有x300u链接所有租期价格-10元
```

The natural-language intent was correct, but the MT-agent orchestration layer collapsed multi-spec products into flat field maps. The generated change files used `__broadcast: true`, so the first spec's adjusted prices were applied to every spec. Rollback files reused the same broadcast shape, and flat verification only checked the first spec-like view, allowing false success reports.

The immediate recovery has been completed separately: all 28 affected products were restored using saved per-spec pre-operation values and per-spec readback verification.

## Goals

- Prevent multi-spec rental price changes from using unsafe flat/broadcast payloads.
- Preserve spec dimension across preview, confirmation, execution, rollback, and verification.
- Make Feishu approval cards readable for operations, not raw JSON confirmations.
- Provide progress feedback for long-running preview and execution flows.
- Keep audit-log cleanup as an out-of-band reminder, not part of this document.

## Non-Goals

- Do not change unrelated rental image, VAS, copy, delist, or spec-dimension workflows.
- Do not expose low-level daemon commands directly to planners or operators.
- Do not cover audit-log cleanup in this plan.
- Do not preserve unsafe backward compatibility for unreleased broadcast price plans.

## P0: Write-Safety Remediation

### Block Flat Broadcast Writes For Multi-Spec Products

Flat rental price payloads are only safe for single-spec products or for explicitly approved broadcast-price operations.

Rules:

- If a product has more than one spec, default price writes must use nested per-spec payloads.
- Flat `fields` payloads must be rejected for multi-spec products.
- Broadcast writes require an explicit `broadcastPrice: true` contract and a separate high-risk approval state.
- Relative changes such as `-10元`, `+5元`, `9折`, or `0.8倍` must never be converted to first-spec absolute broadcast prices.

### Introduce A Canonical PriceChangePlan

All high-risk rental price writes should be represented by one persisted plan artifact.

```ts
type PriceChangePlan = {
  version: 2;
  operationId: string;
  productId: string;
  sourceReadAt: string;
  sourceSnapshotHash: string;
  operationMode: 'per_spec_adjustment' | 'per_spec_absolute' | 'broadcast_absolute';
  changes: Record<string, Record<string, {
    before: string;
    after: string;
  }>>;
};
```

The confirmation card, execution step, rollback step, and verification step must all bind to this plan. Confirmed execution should not recompute target fields from callback JSON.

### Generate Per-Spec Relative Changes

For relative price operations:

1. Read the product and normalize all `specId -> field -> value` data.
2. For each affected spec and rent field, compute `after` from that spec's own `before` value.
3. Persist the full plan with `before` and `after` values.
4. Generate nested daemon changes from `after` values only after approval.

### Make Rollback Per-Spec

Rollback must use the plan's saved `before` values.

Allowed shape:

```json
{
  "specA": { "rent1day": "107.00" },
  "specB": { "rent1day": "277.00" }
}
```

Forbidden shape for multi-spec price rollback:

```json
{
  "__broadcast": true,
  "rent1day": "107.00"
}
```

### Verify Per-Spec With Exact Counts

Execution success requires:

- every planned `productId/specId/field` read back exactly matches the planned `after` value;
- rollback success requires every planned `productId/specId/field` read back exactly matches the planned `before` value;
- verification count is non-zero and equals the planned field count;
- any mismatch marks the operation as failed or recovery-required.

`submit unknown` may only be resolved by full readback match. It must not be treated as success by itself.

### Fail Closed On Missing Safety Artifacts

The following states must block execution:

- audit unavailable;
- plan file missing or hash mismatch;
- rollback values missing;
- verification contract missing or incomplete;
- multi-spec product with flat price fields;
- warning that crosses a high-risk threshold, such as large price drop.

The current fallback that synthesizes a broadcast changes file when audit artifacts are missing must be removed for price writes.

## P1: Feishu Approval Card Redesign

### Design Principle

The Feishu card approves an executable business plan, not a raw JSON payload.

The first screen must answer:

- What will happen?
- How many products, specs, and fields are affected?
- Is this per-spec or broadcast?
- What is the largest price movement?
- Is execution allowed, blocked, or waiting for review?

### Required First-Screen Fields

- Operation semantics: for example, `逐规格每个租期 -10 元`.
- Write mode: `逐规格写入`, `广播写入`, or `已阻断: 多规格 broadcast`.
- Scope: product count, spec count, field count.
- Risk level: `ok`, `warn`, or `blocked`.
- Max drop and max increase.
- Rollback readiness: per-spec rollback generated or missing.
- Verification contract: expected per-spec verification count.

### Risk Summary Section

Show bounded, readable risk rows instead of raw JSON:

- Top 5 largest drops.
- Count of fields over 20%, 50%, and 70% change.
- Products with audit warnings.
- Products with missing or incomplete readback.
- Any broadcast intent.

Example row format:

```text
商品 801 / 400mm 手柄套装 / rent3day: 353.00 -> 95.00 (-73.1%)
```

### Interaction States

- `blocked`: red header, no confirm button, show `重新生成逐规格计划` and `取消`.
- `warn`: orange header, show risk summary; confirmation depends on policy.
- `ok`: green header, show `确认执行` and `取消`.
- `running`: blue header, no confirm button, show progress.
- `completed`: green header, show per-spec verify result.
- `failed` or `recovery_required`: red header, show failed product and next action.

### Card Red Lines

- Do not put full raw JSON on the first screen.
- Do not show a confirm button when the operation is blocked.
- Do not hide broadcast mode in a details section.
- Do not summarize away max-risk rows.
- Do not claim success without per-spec verification counts.

## P2: Progressive Feishu Feedback For Long Operations

Preview generation may take minutes. The user should receive feedback before the final approval card.

### Preview Progress Card

Immediately send or update a progress card with:

- instruction received;
- product resolution started;
- no write has happened;
- current phase and count.

Suggested phases:

1. parsing instruction;
2. resolving product scope;
3. reading SaaS prices;
4. building per-spec plan;
5. running audit rules;
6. rendering approval card.

### Execution Progress Card

After confirmation, update the same card or a linked execution card:

- current product;
- completed count;
- failed count;
- `submit unknown` count;
- readback match count;
- recovery-required status.

### Completion Card

Final card should include:

- successful products;
- failed products;
- skipped products;
- verify file or summary reference;
- rollback plan reference;
- clear next action if any item failed.

## Regression Test Plan

### P0 Tests

- Multi-spec `adjustmentAmount=-10` does not generate `__broadcast`.
- Multi-spec discount does not generate `__broadcast`.
- Relative changes are computed independently for each spec.
- Rollback artifacts are nested per-spec for multi-spec products.
- Verification checks every planned `specId/field`.
- Flat verification is rejected or bypassed for multi-spec products.
- Missing audit artifacts block execution instead of falling back to broadcast.
- Large change warnings above the hard threshold block confirmation.
- Confirmation cards show write mode, max drop, scope counts, rollback readiness, and verify count.

### P1 Tests

- Blocked approval card has no confirm button.
- Broadcast risk appears in the first screen.
- Risk summary includes top drops and threshold counts.
- Raw JSON is not the primary card body.

### P2 Tests

- Long preview emits a progress card before final confirmation.
- Progress updates never expose a confirm button before the immutable plan is ready.
- Execution progress distinguishes `submit unknown` from verified success.

## Implementation Order

1. Add failing tests for multi-spec relative price plans and flat broadcast rejection.
2. Introduce `PriceChangePlan` and per-spec plan generation.
3. Route relative multi-spec preview through plan generation.
4. Update execution to consume persisted plans only.
5. Update rollback and verification to use per-spec plan data.
6. Add daemon-side defense to reject flat price changes on multi-spec products unless explicitly approved as broadcast.
7. Redesign Feishu approval cards around risk summary and interaction states.
8. Add progressive card updates for preview and execution.
9. Keep audit-log cleanup as a separate operator reminder outside this plan.

## Acceptance Criteria

- No multi-spec relative rental price operation can produce a flat `__broadcast` changes file.
- No multi-spec rollback can use first-spec broadcast rollback values.
- Every successful execution has full per-spec readback verification evidence.
- A high-risk or blocked operation cannot show a normal confirm button.
- Operators can understand the approval card without reading JSON.
- Long-running operations give visible waiting feedback and never imply that a write has happened before confirmation.
