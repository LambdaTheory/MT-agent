import { describe, expect, it } from 'vitest';
import { classifyLoginState, waitForDashboardAfterLogin, waitForSettledLoginState } from '../src/crawler/loginState.js';

describe('classifyLoginState', () => {
  it('detects dashboard-ready state when the table is visible', async () => {
    const state = await classifyLoginState(fakePage({ url: 'https://b.alipay.com/page/recycle-im/app/assistant-data-analysis/index/product/list', tableCount: 1 }));

    expect(state).toBe('dashboard-ready');
  });

  it('detects sub-account selection state by URL', async () => {
    const state = await classifyLoginState(fakePage({ url: 'https://b.alipay.com/page/select-identity', tableCount: 0 }));

    expect(state).toBe('select-identity');
  });

  it('detects explicit login page state by URL', async () => {
    const state = await classifyLoginState(fakePage({ url: 'https://auth.alipay.com/login', tableCount: 0 }));

    expect(state).toBe('login-page');
  });

  it('treats non-login pages without tables as loading-or-unknown', async () => {
    const state = await classifyLoginState(fakePage({ url: 'https://b.alipay.com/loading', tableCount: 0 }));

    expect(state).toBe('loading-or-unknown');
  });
});

function fakePage(input: { url: string; tableCount: number }) {
  return {
    url: () => input.url,
    locator: () => ({ count: async () => input.tableCount }),
  };
}

describe('waitForDashboardAfterLogin', () => {
  it('waits for the dashboard table after manual login', async () => {
    const calls: string[] = [];

    await waitForDashboardAfterLogin({
      waitForURL: async () => {
        calls.push('url');
      },
      waitForSelector: async () => {
        calls.push('table');
      },
    });

    expect(calls).toEqual(['url', 'table']);
  });
});

describe('waitForSettledLoginState', () => {
  it('waits through loading state until dashboard is ready', async () => {
    const page = fakeChangingPage([
      { url: 'https://b.alipay.com/loading', tableCount: 0 },
      { url: 'https://b.alipay.com/page/recycle-im/app/assistant-data-analysis/index/product/list', tableCount: 1 },
    ]);

    const state = await waitForSettledLoginState(page, { timeoutMs: 1000, intervalMs: 1 });

    expect(state).toBe('dashboard-ready');
  });

  it('does not settle on a transient login page that automatically reaches dashboard', async () => {
    const page = fakeTransientLoginPage();

    const state = await waitForSettledLoginState(page, { timeoutMs: 1000, intervalMs: 1, loginPageGraceMs: 50 });

    expect(state).toBe('dashboard-ready');
  });
});

function fakeChangingPage(states: Array<{ url: string; tableCount: number }>) {
  let index = 0;
  return {
    url: () => states[Math.min(index, states.length - 1)]?.url ?? '',
    locator: () => ({
      count: async () => {
        const state = states[Math.min(index, states.length - 1)];
        index += 1;
        return state?.tableCount ?? 0;
      },
    }),
  };
}

function fakeTransientLoginPage() {
  let countCalls = 0;
  return {
    url: () => (countCalls <= 1 ? 'https://auth.alipay.com/login' : 'https://b.alipay.com/page/recycle-im/app/assistant-data-analysis/index/product/list'),
    locator: () => ({
      count: async () => {
        const count = countCalls === 0 ? 0 : 1;
        countCalls += 1;
        return count;
      },
    }),
  };
}
