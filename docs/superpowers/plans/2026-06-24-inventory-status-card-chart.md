# Inventory Status Card Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the `库存情况` Feishu card so the overview uses percentage-based comparison blocks and native chart components, while the detail view explains `缺日报数据链接` in plain Chinese and shows group contribution ratios.

**Architecture:** Keep the snapshot format unchanged and compute presentation-only aggregates inside `src/feishuBot/inventoryStatusCard.ts`. Reuse the existing `schema: "2.0"` card payload path and add native `chart` elements for structure and top-group distribution without changing query or snapshot contracts.

**Tech Stack:** TypeScript, Vitest, Feishu Card JSON 2.0, native Feishu `chart` component.

---

### Task 1: Lock the target card output with tests

**Files:**
- Modify: `tests/inventoryStatusCard.test.ts`
- Test: `tests/inventoryStatusCard.test.ts`

- [ ] **Step 1: Write the failing test**

Add assertions that the overview card now includes:
- a chart element for link structure
- a chart element for top group contribution
- percentage labels such as `active 占比` and `有数据组占比`
- a plain Chinese label for `缺日报数据链接`

Also add detail assertions for:
- `7日金额贡献`
- `7日访问贡献`
- the explanatory Chinese copy for missing report data

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/inventoryStatusCard.test.ts`

Expected: FAIL because the current card payload does not yet include chart elements or the new text labels.

- [ ] **Step 3: Write minimal implementation**

Implement only the helper functions and card fields needed to satisfy the new assertions.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/inventoryStatusCard.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/inventoryStatusCard.test.ts src/feishuBot/inventoryStatusCard.ts docs/superpowers/plans/2026-06-24-inventory-status-card-chart.md
git commit -m "feat: add charted inventory status card"
```

### Task 2: Implement overview percentage metrics and chart payloads

**Files:**
- Modify: `src/feishuBot/inventoryStatusCard.ts`
- Test: `tests/inventoryStatusCard.test.ts`

- [ ] **Step 1: Write the failing test**

Extend the overview assertions to require:
- four percentage-focused metric cards
- a ring chart for `active / removed / unknown`
- a horizontal bar chart for top same-sku-group `7日金额占比`
- abnormal group lines that say `缺日报数据链接`

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/inventoryStatusCard.test.ts`

Expected: FAIL on missing overview elements or text content.

- [ ] **Step 3: Write minimal implementation**

Add focused helpers in `src/feishuBot/inventoryStatusCard.ts` for:
- summary totals across all groups
- percentage strings and contribution strings
- Feishu chart payload builders
- overview markdown blocks with Chinese copy

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/inventoryStatusCard.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/feishuBot/inventoryStatusCard.ts tests/inventoryStatusCard.test.ts
git commit -m "feat: enhance inventory overview card metrics"
```

### Task 3: Implement detail contribution and clearer missing-data explanation

**Files:**
- Modify: `src/feishuBot/inventoryStatusCard.ts`
- Test: `tests/inventoryStatusCard.test.ts`

- [ ] **Step 1: Write the failing test**

Add detail assertions that require:
- contribution copy for `1日/7日/30日`
- explicit `缺日报数据链接` label
- a short explanation saying the link exists in the registry but had no matched report row this round

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/inventoryStatusCard.test.ts`

Expected: FAIL because the old detail card only shows raw totals.

- [ ] **Step 3: Write minimal implementation**

Compute contribution against snapshot-level totals and render the explanation in detail copy.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/inventoryStatusCard.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/feishuBot/inventoryStatusCard.ts tests/inventoryStatusCard.test.ts
git commit -m "feat: clarify inventory missing report links"
```

### Task 4: Verify targeted behavior and type safety

**Files:**
- Modify: none expected
- Test: `tests/inventoryStatusCard.test.ts`

- [ ] **Step 1: Run targeted tests**

Run: `npm test -- tests/inventoryStatusCard.test.ts`

Expected: PASS

- [ ] **Step 2: Run build verification**

Run: `npm run build`

Expected: TypeScript build succeeds with exit code `0`.

- [ ] **Step 3: Inspect final diff**

Run: `git diff -- src/feishuBot/inventoryStatusCard.ts tests/inventoryStatusCard.test.ts docs/superpowers/plans/2026-06-24-inventory-status-card-chart.md`

Expected: Only the intended inventory card and plan changes are present.
