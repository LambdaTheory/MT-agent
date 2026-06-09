# Login State Reuse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse the persistent browser login state and, when login has expired, wait for QR login before continuing the dashboard crawl automatically.

**Architecture:** Add a small login/session helper around Playwright page state. The crawler will navigate to the dashboard, detect whether the table is already available, whether sub-account selection is needed, or whether login/QR completion must be waited for, then continue into the existing data collection flow.

**Tech Stack:** Node.js, TypeScript, Playwright, Vitest.

---

### Task 1: Login State Helper

**Files:**
- Create: `src/crawler/loginState.ts`
- Test: `tests/loginState.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { classifyLoginState } from '../src/crawler/loginState.js';

describe('classifyLoginState', () => {
  it('detects dashboard-ready state when the table is visible', async () => {
    const state = await classifyLoginState(fakePage({ url: 'https://b.alipay.com/page/recycle-im/app/assistant-data-analysis/index/product/list', tableCount: 1 }));
    expect(state).toBe('dashboard-ready');
  });

  it('detects sub-account selection state by URL', async () => {
    const state = await classifyLoginState(fakePage({ url: 'https://b.alipay.com/page/select-identity', tableCount: 0 }));
    expect(state).toBe('select-identity');
  });

  it('detects login-required state when dashboard table is not present', async () => {
    const state = await classifyLoginState(fakePage({ url: 'https://auth.alipay.com/login', tableCount: 0 }));
    expect(state).toBe('login-required');
  });
});

function fakePage(input: { url: string; tableCount: number }) {
  return {
    url: () => input.url,
    locator: () => ({ count: async () => input.tableCount }),
  };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/loginState.test.ts`

Expected: FAIL because `src/crawler/loginState.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { Page } from 'playwright';

export type LoginState = 'dashboard-ready' | 'select-identity' | 'login-required';

type LoginStatePage = Pick<Page, 'url' | 'locator'>;

export async function classifyLoginState(page: LoginStatePage): Promise<LoginState> {
  if (page.url().includes('select-identity')) {
    return 'select-identity';
  }

  if ((await page.locator('.ant-table table').count()) > 0) {
    return 'dashboard-ready';
  }

  return 'login-required';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/loginState.test.ts`

Expected: PASS.

### Task 2: QR Wait Flow Integration

**Files:**
- Modify: `src/crawler/dashboardCrawler.ts`
- Test: `tests/loginState.test.ts`

- [ ] **Step 1: Write failing test for QR wait behavior**

```ts
import { describe, expect, it } from 'vitest';
import { waitForDashboardAfterLogin } from '../src/crawler/loginState.js';

describe('waitForDashboardAfterLogin', () => {
  it('waits for the dashboard table after manual login', async () => {
    const calls: string[] = [];
    await waitForDashboardAfterLogin({
      waitForURL: async () => calls.push('url'),
      waitForSelector: async () => calls.push('table'),
    });

    expect(calls).toEqual(['url', 'table']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/loginState.test.ts`

Expected: FAIL because `waitForDashboardAfterLogin` is not exported.

- [ ] **Step 3: Implement minimal wait helper**

```ts
import type { Page } from 'playwright';

type LoginWaitPage = Pick<Page, 'waitForURL' | 'waitForSelector'>;

export async function waitForDashboardAfterLogin(page: LoginWaitPage): Promise<void> {
  console.log('登录态已过期，请在打开的浏览器窗口扫码登录。登录成功后程序会自动继续抓取。');
  await page.waitForURL(/assistant-data-analysis\/index\/product\/list|select-identity/, { timeout: 300000 });
  await page.waitForSelector('.ant-table table', { timeout: 300000 });
}
```

- [ ] **Step 4: Wire into crawler**

In `src/crawler/dashboardCrawler.ts`, after `page.goto(config.targetUrl, ...)`:

```ts
const loginState = await classifyLoginState(page);
if (loginState === 'login-required') {
  await waitForDashboardAfterLogin(page);
}
await selectSubAccountIfNeeded(page);
```

Keep the existing final `waitForSelector('.ant-table table', { timeout: 180000 })` as the last safety check.

- [ ] **Step 5: Run full verification**

Run: `npm test`

Expected: all tests pass.

Run: `npm run build`

Expected: TypeScript build passes.

Run: `npm run rebuild-latest`

Expected: report rebuild still works without launching browser.

### Self-Review

- Spec coverage: Login reuse is handled by existing persistent profile plus explicit state detection; expired login waits for QR and continues.
- Placeholder scan: No placeholders remain.
- Type consistency: Helper names are `classifyLoginState` and `waitForDashboardAfterLogin`; crawler imports these exact names.
