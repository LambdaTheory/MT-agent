# Product Short Model Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert noisy product titles into stable Feishu display names in `品牌 + 短型号` format.

**Architecture:** Extend the existing display-only resolver in `src/publicTraffic/productDisplayName.ts` with a compact model matcher. Manual `端内ID -> 短名` mapping remains highest priority; the model matcher handles the approved product family list; generic cleanup remains the final fallback.

**Tech Stack:** TypeScript, Vitest, Feishu card JSON.

---

## File Structure

- Modify `src/publicTraffic/productDisplayName.ts`: add approved brand/model pattern rules and keep output display-only.
- Modify `tests/productDisplayName.test.ts`: add regression tests for slash-separated same-brand models and representative approved short names.
- Modify `tests/publicTrafficReport.test.ts`: keep card-level expectations aligned with compact output.

### Task 1: Approved Model Tests

**Files:**
- Modify: `tests/productDisplayName.test.ts`

- [ ] **Step 1: Add failing tests for same-brand slash families**

Add tests asserting `松下 ZS220D`, `尼康 A900`, and `富士 instax mini 12` are extracted from noisy titles.

- [ ] **Step 2: Run tests to verify RED**

Run: `npx vitest run tests/productDisplayName.test.ts -t "approved short model"`

Expected: FAIL because the matcher does not yet cover these families.

### Task 2: Model Matcher Implementation

**Files:**
- Modify: `src/publicTraffic/productDisplayName.ts`

- [ ] **Step 1: Add compact model rules**

Implement focused regex rules for the approved list: Canon RF/IXUS/G/CP/EOS/SX, Nikon P/A/B, Panasonic ZS/FZ, Apple iPad/iPod/iPhone, Fujifilm instax/X-half, DJI Action/Pocket/Osmo, Insta360, Sony ZV, vivo, and tripod/lens accessories.

- [ ] **Step 2: Run resolver tests to verify GREEN**

Run: `npx vitest run tests/productDisplayName.test.ts`

Expected: PASS.

### Task 3: Verification And Push

**Files:**
- Test: `tests/productDisplayName.test.ts`
- Test: `tests/publicTrafficReport.test.ts`

- [ ] **Step 1: Run affected tests**

Run: `npx vitest run tests/productDisplayName.test.ts tests/publicTrafficReport.test.ts tests/publicTrafficCliSource.test.ts tests/publicTrafficReportCliBehavior.test.ts`

Expected: PASS.

- [ ] **Step 2: Run build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 3: Inspect generated card names**

Run a `tsx` one-liner against `output/2026-06-12/公域数据上下文_2026-06-12.json` and confirm table names are compact.

- [ ] **Step 4: Send personal Feishu report**

Run: `npm run public-traffic-report -- --send-to personal`

Expected: log contains `飞书通知已发送`.
