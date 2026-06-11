# Remove Feishu Card Conclusions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove redundant labels from the public traffic Feishu card while preserving Markdown and text fallback outputs.

**Architecture:** `buildPublicTrafficCard` controls only the Feishu card payload, so the implementation removes the `conclusionBlock()` element, the standalone `今日漏斗` markdown, and the `公域` group label from that card body. Existing `context.conclusions` data remains available for `分析与建议`, Markdown, and fallback text.

**Tech Stack:** TypeScript, Vitest, Feishu Card 2.0 payload builders.

---

### Task 1: Remove Card-Only Redundant Labels

**Files:**
- Modify: `src/publicTraffic/buildPublicTrafficCard.ts`
- Modify: `tests/publicTrafficReport.test.ts`

- [ ] **Step 1: Update the card payload tests first**

In `tests/publicTrafficReport.test.ts`, change card-specific expectations so `buildPublicTrafficCard()` no longer requires `经营结论`, `今日漏斗`, or the `公域` group label, while Markdown and text fallback expectations stay unchanged.

Expected edits:

```ts
expect(serialized).not.toContain('经营结论');
expect(serialized).not.toContain('今日漏斗');
expect(serialized).toContain('分析与建议');
```

And in the compact summary card test, verify the first funnel `column_set` still contains the exposure and order metrics without requiring the `公域` text label.

- [ ] **Step 2: Run the targeted test and verify it fails**

Run: `npx vitest run tests/publicTrafficReport.test.ts`

Expected: FAIL because `buildPublicTrafficCard()` still emits `**经营结论**`, `**今日漏斗**`, and/or `**公域**`.

- [ ] **Step 3: Remove the card-only conclusion element**

In `src/publicTraffic/buildPublicTrafficCard.ts`, remove the `conclusionBlock()` element and the `{ tag: 'markdown', content: '**今日漏斗**' }` element from the `body.elements` array. In `funnelBlock()`, remove the `**公域**` markdown element while preserving the nested metric card `column_set`.

Expected resulting sequence starts with:

```ts
body: {
  elements: [
    funnelBlock(context),
```

If `conclusionBlock()` becomes unused, delete the helper to keep the file clean.

- [ ] **Step 4: Run targeted tests**

Run: `npx vitest run tests/publicTrafficReport.test.ts`

Expected: PASS.

- [ ] **Step 5: Run verification**

Run: `npm run build`

Expected: PASS.

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Send one card from existing context**

Use a temporary script that reads `output/2026-06-11/公域数据上下文_2026-06-11.json`, builds the card with `buildPublicTrafficCard()`, sends with `sendFeishuCard()`, then delete the temporary script.

Expected: `{"sent":true,"channel":"app"}`.

- [ ] **Step 7: Commit implementation**

Run:

```bash
git add src/publicTraffic/buildPublicTrafficCard.ts tests/publicTrafficReport.test.ts
git commit -m "调整：移除公域卡片经营结论"
```

Do not stage `config/product-id-map*.json`, `.understand-anything/`, or `docs/codegraph-analysis.md`.
