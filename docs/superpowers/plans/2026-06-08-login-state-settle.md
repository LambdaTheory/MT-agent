# Login State Settle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Avoid false QR-scan prompts by waiting for the Alipay page state to settle before declaring login is required.

**Architecture:** Replace the current immediate `no table = login-required` classifier with a small state model: `dashboard-ready`, `select-identity`, `login-page`, and `loading-or-unknown`. Add a settle helper that polls state for up to a timeout; the crawler only prompts for QR scan when the state is explicitly `login-page`.

**Tech Stack:** Node.js, TypeScript, Playwright, Vitest.

---

### Task 1: Extend Login State Classification

**Files:**
- Modify: `src/crawler/loginState.ts`
- Test: `tests/loginState.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests proving login pages are distinguished from loading pages:

```ts
it('detects explicit login page state by URL', async () => {
  const state = await classifyLoginState(fakePage({ url: 'https://auth.alipay.com/login', tableCount: 0 }));
  expect(state).toBe('login-page');
});

it('treats non-login pages without tables as loading-or-unknown', async () => {
  const state = await classifyLoginState(fakePage({ url: 'https://b.alipay.com/loading', tableCount: 0 }));
  expect(state).toBe('loading-or-unknown');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/loginState.test.ts`

Expected: FAIL because the classifier still returns `login-required`.

- [ ] **Step 3: Implement minimal classifier change**

Change `LoginState` to:

```ts
export type LoginState = 'dashboard-ready' | 'select-identity' | 'login-page' | 'loading-or-unknown';
```

Return `login-page` only for explicit login URLs; otherwise return `loading-or-unknown`.

- [ ] **Step 4: Run target tests**

Run: `npm test -- tests/loginState.test.ts`

Expected: PASS.

### Task 2: Add Settled-State Polling and Wire Crawler

**Files:**
- Modify: `src/crawler/loginState.ts`
- Modify: `src/crawler/dashboardCrawler.ts`
- Test: `tests/loginState.test.ts`

- [ ] **Step 1: Write failing polling tests**

Add a fake page whose state changes from loading to dashboard and assert no login prompt is needed:

```ts
it('waits through loading state until dashboard is ready', async () => {
  const page = fakeChangingPage([
    { url: 'https://b.alipay.com/loading', tableCount: 0 },
    { url: 'https://b.alipay.com/page/recycle-im/app/assistant-data-analysis/index/product/list', tableCount: 1 },
  ]);
  const state = await waitForSettledLoginState(page, { timeoutMs: 1000, intervalMs: 1 });
  expect(state).toBe('dashboard-ready');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/loginState.test.ts`

Expected: FAIL because `waitForSettledLoginState` is not exported.

- [ ] **Step 3: Implement polling helper**

Add `waitForSettledLoginState(page, { timeoutMs, intervalMs })` that loops until state is not `loading-or-unknown`, then returns it, or returns `loading-or-unknown` after timeout.

- [ ] **Step 4: Wire crawler**

In `src/crawler/dashboardCrawler.ts`, replace immediate `classifyLoginState` use with `waitForSettledLoginState(page, { timeoutMs: 60000, intervalMs: 1000 })`. Call `waitForDashboardAfterLogin` only for `login-page`.

- [ ] **Step 5: Verify**

Run: `npm test`, `npm run build`, then `npm run probe-page-size` to confirm it no longer prints QR prompt unless the page is actually on login.

### Self-Review

- Spec coverage: Addresses repeated false QR prompts and preserves QR scan behavior when login page is explicit.
- Placeholder scan: No placeholders remain.
- Type consistency: Uses `waitForSettledLoginState` consistently in tests and crawler.
